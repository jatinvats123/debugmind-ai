const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ANSI_RE = /\[[0-9;]*m/g;

function stripAnsi(s) {
  return typeof s === 'string' ? s.replace(ANSI_RE, '') : s;
}

function findJestBin(projectRoot) {
  const p = path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  if (fs.existsSync(p)) return p;
  return require.resolve('jest/bin/jest', { paths: [projectRoot] });
}

function trimMessage(msg, max = 1500) {
  msg = stripAnsi(msg || '');
  // Drop node_modules stack frames — noise for the agent.
  const lines = msg.split('\n').filter((l) => !l.includes('node_modules'));
  msg = lines.join('\n');
  if (msg.length > max) msg = msg.slice(0, max) + '\n…[error output truncated]';
  return msg;
}

/**
 * Run jest and return a structured summary.
 * @param {string} projectRoot
 * @param {string[]} extraArgs e.g. ['-t', 'escaped test name']
 */
function runJest(projectRoot, extraArgs = []) {
  const jestBin = findJestBin(projectRoot);
  const res = spawnSync(
    process.execPath,
    [jestBin, '--json', '--runInBand', ...extraArgs],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
    }
  );

  if (res.error) {
    return { error: `Failed to spawn jest: ${res.error.message}` };
  }

  const stdout = res.stdout || '';
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return {
      error: 'Could not parse jest JSON output',
      stderr: trimMessage(res.stderr, 3000),
    };
  }

  let json;
  try {
    json = JSON.parse(stdout.slice(start, end + 1));
  } catch (e) {
    return { error: `Jest JSON parse failed: ${e.message}` };
  }

  const failing = [];
  const passing = [];
  const consoleOutput = [];

  for (const tr of json.testResults || []) {
    const file = path.relative(projectRoot, tr.name || tr.testFilePath || '').replace(/\\/g, '/');
    for (const a of tr.assertionResults || []) {
      if (a.status === 'passed') {
        passing.push(a.fullName);
      } else if (a.status === 'failed') {
        failing.push({
          fullName: a.fullName,
          file,
          message: trimMessage((a.failureMessages || []).join('\n')),
        });
      }
    }
    // Test-file level failure (e.g. syntax error introduced by a bad edit)
    if ((tr.assertionResults || []).length === 0 && tr.status === 'failed') {
      failing.push({
        fullName: `<test file failed to run: ${file}>`,
        file,
        message: trimMessage(tr.message || tr.failureMessage || 'unknown load error', 2500),
      });
    }
    if (tr.console && tr.console.length > 0) {
      const msgs = tr.console
        .map((c) => `[${c.type}] ${stripAnsi(c.message)}`)
        .join('\n');
      consoleOutput.push({ file, output: msgs.slice(0, 1500) });
    }
  }

  return {
    numTotalTests: json.numTotalTests,
    numPassedTests: json.numPassedTests,
    numFailedTests: json.numFailedTests + Math.max(0, failing.length - json.numFailedTests),
    success: json.success,
    failing,
    passing,
    consoleOutput,
  };
}

function escapeForJestT(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runSpecificTest(projectRoot, testName) {
  return runJest(projectRoot, ['-t', escapeForJestT(testName)]);
}

/** Compact serialization of a summary for the model. */
function summarizeForModel(summary, { includePassing = false } = {}) {
  if (summary.error) return `TEST RUN ERROR: ${summary.error}\n${summary.stderr || ''}`;
  const lines = [
    `${summary.numPassedTests} passed, ${summary.numFailedTests} failed, ${summary.numTotalTests} total`,
  ];
  if (summary.failing.length > 0) {
    lines.push('', 'FAILING TESTS:');
    for (const f of summary.failing) {
      lines.push(`--- ✗ ${f.fullName} (${f.file}) ---`);
      lines.push(f.message);
    }
  }
  if (includePassing && summary.passing.length > 0) {
    lines.push('', 'PASSING TESTS:');
    for (const p of summary.passing) lines.push(`  ✓ ${p}`);
  }
  if (summary.consoleOutput && summary.consoleOutput.length > 0) {
    lines.push('', 'CONSOLE OUTPUT CAPTURED DURING TESTS:');
    for (const c of summary.consoleOutput) lines.push(`[${c.file}]\n${c.output}`);
  }
  let out = lines.join('\n');
  if (out.length > 12000) out = out.slice(0, 12000) + '\n…[output truncated]';
  return out;
}

module.exports = { runJest, runSpecificTest, summarizeForModel, escapeForJestT };
