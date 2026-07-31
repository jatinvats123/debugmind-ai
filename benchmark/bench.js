#!/usr/bin/env node
/**
 * Benchmark CLI.
 *
 * Runs fixtures through the agent (guarded and/or unguarded) and writes
 * BENCHMARK.md. Results are persisted per fixture/arm under benchmark/results/,
 * so a run that is interrupted — by a quota cap, say — can be resumed, and the
 * report can be regenerated without spending another token.
 *
 * Any cell with no recorded run is rendered as TODO(run-required) rather than
 * estimated. A missing number is honest; an invented one is not.
 *
 *   node benchmark/bench.js --arms guarded            # guarded arm only
 *   node benchmark/bench.js --only 01-off-by-one-shipping-band
 *   node benchmark/bench.js --regenerate              # rebuild the report only
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadFixtures } = require('./fixtures');
const { runFixture } = require('./runner');

const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const LOG_DIR = path.join(__dirname, 'logs');
const OUT_FILE = path.join(REPO_ROOT, 'BENCHMARK.md');
const TODO = '`TODO(run-required)`';

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', bold: '\x1b[1m', cyan: '\x1b[36m' };

function loadDotEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function parseArgs(argv) {
  const args = {
    arms: ['guarded', 'unguarded'],
    only: [],
    model: process.env.AGENT_MODEL || 'gemini-3.1-flash-lite',
    effort: process.env.AGENT_EFFORT || 'high',
    temperature: 0,
    maxAttempts: 4,
    maxApiCalls: 60,
    regenerate: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--arms') args.arms = argv[++i].split(',').map((s) => s.trim());
    else if (flag === '--only') args.only = argv[++i].split(',').map((s) => s.trim());
    else if (flag === '--model') args.model = argv[++i];
    else if (flag === '--effort') args.effort = argv[++i];
    else if (flag === '--temperature') args.temperature = parseFloat(argv[++i]);
    else if (flag === '--max-attempts') args.maxAttempts = parseInt(argv[++i], 10);
    else if (flag === '--max-api-calls') args.maxApiCalls = parseInt(argv[++i], 10);
    else if (flag === '--regenerate') args.regenerate = true;
    else if (flag === '--force') args.force = true;
    else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

const resultPath = (id, arm) => path.join(RESULTS_DIR, `${id}--${arm}.json`);

function loadResult(id, arm) {
  const p = resultPath(id, arm);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveResult(result) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(resultPath(result.fixtureId, result.arm), JSON.stringify(result, null, 2));
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// ---------- aggregation ----------

function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmt(value, digits = 1, suffix = '') {
  if (value === null || value === undefined) return TODO;
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function fmtInt(value) {
  if (value === null || value === undefined) return TODO;
  return Math.round(value).toLocaleString();
}

function summarize(results) {
  if (results.length === 0) return null;
  const correct = results.filter((r) => r.correct).length;
  const costs = results.map((r) => r.estimatedCostUsd).filter((c) => typeof c === 'number');
  return {
    n: results.length,
    correct,
    resolutionRate: (correct / results.length) * 100,
    meanAttempts: mean(results.map((r) => r.attempts)),
    meanRegressions: mean(results.map((r) => r.regressionCount)),
    totalRegressions: results.reduce((s, r) => s + r.regressionCount, 0),
    tamperCount: results.filter((r) => r.testsTampered).length,
    meanSeconds: mean(results.map((r) => r.wallClockSeconds)),
    meanTokens: mean(results.map((r) => r.tokens)),
    meanApiCalls: mean(results.map((r) => r.apiCalls)),
    meanCost: costs.length === results.length ? mean(costs) : null,
    errors: results.filter((r) => r.error).length,
  };
}

// ---------- report ----------

function outcomeLabel(result) {
  if (!result) return TODO;
  const icons = {
    resolved: '✅ resolved',
    'correct-escalation': '✅ escalated (correct)',
    escalated: '⚠️ escalated',
    incorrect: '❌ incorrect',
    error: '💥 error',
  };
  return icons[result.outcome] || result.outcome;
}

function renderReport({ fixtures, arms, args, runMeta }) {
  const L = [];
  const byArm = {};
  for (const arm of arms) {
    byArm[arm] = fixtures.map((f) => loadResult(f.id, arm)).filter(Boolean);
  }

  const totalCells = fixtures.length * arms.length;
  const filledCells = arms.reduce((sum, arm) => sum + byArm[arm].length, 0);

  L.push('# DebugMind — Benchmark');
  L.push('');
  L.push(
    'Measured results for the autonomous debugging agent against a 12-bug fixture suite. ' +
      'Every number below comes from an actual run; cells with no run are marked ' +
      `${TODO} rather than estimated.`
  );
  L.push('');
  L.push(`- **Coverage:** ${filledCells}/${totalCells} fixture×arm runs recorded`);
  L.push(`- **Model:** \`${runMeta.model}\` @ temperature ${runMeta.temperature}, effort ${runMeta.effort}`);
  L.push(`- **Attempt budget:** ${runMeta.maxAttempts} failed attempts per bug`);
  if (runMeta.commit) L.push(`- **Commit:** \`${runMeta.commit}\``);
  L.push(`- **Generated:** ${new Date().toISOString()}`);
  L.push('');
  L.push('Reproduce with `npm run bench` (needs `GEMINI_API_KEY`). Validate the fixtures themselves with `npm run bench:validate` — no key required.');
  L.push('');

  L.push('## How outcomes are scored');
  L.push('');
  L.push(
    'The verdict is computed against the **pristine test suite, restored after the agent finishes**. ' +
      'The unguarded arm is permitted to edit tests; restoring the real ones means an agent that ' +
      '"fixed" a bug by weakening a test is scored as incorrect, and the tampering is reported ' +
      'separately. No agent can influence its own grade.'
  );
  L.push('');
  L.push('- **resolved** — every test the fixture declared failing now passes, with zero regressions.');
  L.push('- **escalated (correct)** — the fixture is the unfixable one and the agent correctly reported `needs_human_review` without leaving damage behind.');
  L.push('- **escalated** — gave up on a fixture that was solvable.');
  L.push('- **incorrect** — claimed done but the pristine suite disagrees, or regressed something.');
  L.push('');

  // ---- headline comparison ----
  L.push('## Guarded vs unguarded');
  L.push('');
  L.push(
    'Same model, same tools, same attempt budget. The unguarded arm has the three behavioural ' +
      'guardrails removed: no hypothesis required before editing, no forced revert after a failed ' +
      'attempt, and tests are writable. It is not a strawman — it is still told to verify with the ' +
      'full suite and to fix causes rather than symptoms.'
  );
  L.push('');
  L.push('| Metric | ' + arms.map((a) => (a === 'guarded' ? 'Guarded' : 'Unguarded')).join(' | ') + ' |');
  L.push('|---|' + arms.map(() => '---').join('|') + '|');

  const summaries = {};
  for (const arm of arms) summaries[arm] = summarize(byArm[arm]);

  const row = (label, fn) =>
    L.push(`| ${label} | ` + arms.map((a) => (summaries[a] ? fn(summaries[a]) : TODO)).join(' | ') + ' |');

  row('Fixtures run', (s) => `${s.n} / ${fixtures.length}`);
  row('Correct outcomes', (s) => `${s.correct} / ${s.n}`);
  row('**Resolution rate**', (s) => `**${fmt(s.resolutionRate, 1, '%')}**`);
  row('Mean attempts per fixture', (s) => fmt(s.meanAttempts, 2));
  row('**Regressions introduced (total)**', (s) => `**${s.totalRegressions}**`);
  row('Mean regressions per fixture', (s) => fmt(s.meanRegressions, 2));
  row('Test files tampered with', (s) => `${s.tamperCount}`);
  row('Mean wall clock', (s) => fmt(s.meanSeconds, 0, 's'));
  row('Mean tokens per fixture', (s) => fmtInt(s.meanTokens));
  row('Mean API calls per fixture', (s) => fmt(s.meanApiCalls, 1));
  row('Mean cost per fixture', (s) => (s.meanCost === null ? '_unpriced_' : `$${s.meanCost.toFixed(4)}`));
  row('Harness/API errors', (s) => `${s.errors}`);
  L.push('');
  L.push(
    '> Cost is reported only when `agent/pricing.json` carries a verified rate for the model. ' +
      'Token counts are measured; dollar figures are deliberately not estimated from stale rates.'
  );
  L.push('');

  // ---- per fixture ----
  L.push('## Per-fixture results');
  L.push('');
  L.push('| # | Fixture | Category | Diff. | Expected | ' + arms.map((a) => `${a} outcome`).join(' | ') + ' | ' + arms.map((a) => `${a} att.`).join(' | ') + ' |');
  L.push('|---|---|---|---|---|' + arms.map(() => '---').join('|') + '|' + arms.map(() => '---').join('|') + '|');
  fixtures.forEach((f, i) => {
    const cells = arms.map((a) => outcomeLabel(loadResult(f.id, a)));
    const attempts = arms.map((a) => {
      const r = loadResult(f.id, a);
      return r ? String(r.attempts) : TODO;
    });
    L.push(
      `| ${i + 1} | \`${f.id}\` | ${f.category} | ${f.difficulty} | ${f.expectedResolution === 'fixed' ? 'fix' : '**escalate**'} | ` +
        cells.join(' | ') + ' | ' + attempts.join(' | ') + ' |'
    );
  });
  L.push('');

  // ---- per category ----
  L.push('## By category');
  L.push('');
  L.push('| Category | Fixtures | ' + arms.map((a) => `${a} solved`).join(' | ') + ' |');
  L.push('|---|---|' + arms.map(() => '---').join('|') + '|');
  const categories = [...new Set(fixtures.map((f) => f.category))].sort();
  for (const category of categories) {
    const inCat = fixtures.filter((f) => f.category === category);
    const cells = arms.map((arm) => {
      const results = inCat.map((f) => loadResult(f.id, arm)).filter(Boolean);
      if (results.length === 0) return TODO;
      return `${results.filter((r) => r.correct).length} / ${results.length}`;
    });
    L.push(`| ${category} | ${inCat.length} | ${cells.join(' | ')} |`);
  }
  L.push('');

  // ---- by difficulty ----
  L.push('## By difficulty');
  L.push('');
  L.push('| Difficulty | Fixtures | ' + arms.map((a) => `${a} solved`).join(' | ') + ' |');
  L.push('|---|---|' + arms.map(() => '---').join('|') + '|');
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const inDiff = fixtures.filter((f) => f.difficulty === difficulty);
    if (inDiff.length === 0) continue;
    const cells = arms.map((arm) => {
      const results = inDiff.map((f) => loadResult(f.id, arm)).filter(Boolean);
      if (results.length === 0) return TODO;
      return `${results.filter((r) => r.correct).length} / ${results.length}`;
    });
    L.push(`| ${difficulty} | ${inDiff.length} | ${cells.join(' | ')} |`);
  }
  L.push('');

  // ---- notable detail ----
  const withRegressions = arms.flatMap((a) => byArm[a]).filter((r) => r.regressionCount > 0);
  const tampered = arms.flatMap((a) => byArm[a]).filter((r) => r.testsTampered);
  if (withRegressions.length > 0 || tampered.length > 0) {
    L.push('## Notable failures');
    L.push('');
    for (const r of withRegressions) {
      L.push(
        `- **${r.fixtureId}** (${r.arm}) left ${r.regressionCount} regression(s): ` +
          r.regressions.slice(0, 3).map((t) => `\`${t}\``).join(', ') +
          (r.regressions.length > 3 ? ` and ${r.regressions.length - 3} more` : '')
      );
    }
    for (const r of tampered) {
      L.push(`- **${r.fixtureId}** (${r.arm}) modified the test suite during the run.`);
    }
    L.push('');
  }

  if (filledCells < totalCells) {
    L.push('## Unrun cells');
    L.push('');
    L.push(
      `${totalCells - filledCells} of ${totalCells} fixture×arm combinations have not been run yet and are marked ` +
        `${TODO}. They are unrun, not failed. Run \`npm run bench\` to fill them in; results accumulate in ` +
        '`benchmark/results/` so an interrupted run resumes rather than restarting.'
    );
    L.push('');
  }

  return L.join('\n');
}

// ---------- main ----------

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures({ only: args.only });
  const runMeta = {
    model: args.model,
    effort: args.effort,
    temperature: args.temperature,
    maxAttempts: args.maxAttempts,
    commit: gitCommit(),
  };

  if (!args.regenerate) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY required to run the benchmark. Use --regenerate to rebuild the report from existing results.');
      process.exit(1);
    }

    const plan = [];
    for (const arm of args.arms) {
      for (const fixture of fixtures) {
        if (!args.force && loadResult(fixture.id, arm)) continue;
        plan.push({ fixture, arm });
      }
    }

    console.log(`${C.bold}Benchmark: ${plan.length} run(s) queued${C.reset} ${C.gray}(${fixtures.length} fixtures x ${args.arms.length} arm(s); already-recorded runs skipped unless --force)${C.reset}\n`);

    let index = 0;
    for (const { fixture, arm } of plan) {
      index += 1;
      const label = `${C.gray}[${index}/${plan.length}]${C.reset} ${fixture.id} ${C.cyan}${arm}${C.reset}`;
      process.stdout.write(`${label} … `);
      try {
        const result = await runFixture({
          fixture,
          arm,
          model: args.model,
          effort: args.effort,
          apiKey,
          temperature: args.temperature,
          maxAttempts: args.maxAttempts,
          budgetLimits: { maxApiCalls: args.maxApiCalls },
          workspaceDir: path.join(REPO_ROOT, `.bench-workspace-${arm}`),
          logDir: LOG_DIR,
        });
        saveResult(result);
        const ok = result.correct;
        console.log(
          `${ok ? C.green + '✓' : C.red + '✗'} ${result.outcome}${C.reset} ` +
            `${C.gray}(${result.attempts} attempts, ${result.regressionCount} regressions, ${result.apiCalls} calls, ${result.wallClockSeconds}s)${C.reset}`
        );
      } catch (e) {
        console.log(`${C.red}💥 ${e.message.slice(0, 120)}${C.reset}`);
        // Quota exhaustion should stop the run cleanly, leaving prior results intact.
        if (/quota|exhausted/i.test(e.message)) {
          console.log(`\n${C.yellow}Stopping: provider quota exhausted. Recorded results are kept; re-run later to continue.${C.reset}`);
          break;
        }
      }
    }
    console.log();
  }

  const report = renderReport({ fixtures, arms: args.arms, args, runMeta });
  fs.writeFileSync(OUT_FILE, report);
  console.log(`${C.bold}Wrote ${path.relative(REPO_ROOT, OUT_FILE)}${C.reset}`);

  const recorded = args.arms.reduce(
    (sum, arm) => sum + fixtures.filter((f) => loadResult(f.id, arm)).length,
    0
  );
  const total = fixtures.length * args.arms.length;
  console.log(`${C.gray}${recorded}/${total} fixture x arm runs recorded${recorded < total ? ' — remaining cells marked TODO(run-required)' : ''}${C.reset}`);
}

main().catch((e) => {
  console.error(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
