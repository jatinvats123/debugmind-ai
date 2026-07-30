const fs = require('fs');
const path = require('path');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const PHASE_COLORS = {
  INTAKE: C.cyan,
  EXPLORATION: C.blue,
  HYPOTHESIS: C.magenta,
  TESTING: C.yellow,
  FIX: C.green,
  VERIFICATION: C.cyan,
  'FAILURE-HANDLING': C.red,
  REPORT: C.bold,
};

function truncate(str, max) {
  if (typeof str !== 'string') str = JSON.stringify(str);
  if (str.length <= max) return str;
  return str.slice(0, max) + ` …[truncated, ${str.length} chars total]`;
}

class Logger {
  constructor(projectRoot, logFileName = 'debug-log.json') {
    this.projectRoot = projectRoot;
    this.logPath = path.join(projectRoot, logFileName);
    this.seq = 0;
    this.structure = {
      run: null,
      manifest: null,
      baseline: null,
      sessions: [],
      events: [],
      crossBugChecks: [],
      finalReport: null,
      usage: {
        apiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
    this.currentBug = null;
    this.currentPhase = null;
  }

  flush() {
    fs.writeFileSync(this.logPath, JSON.stringify(this.structure, null, 2));
  }

  event(type, data = {}) {
    const evt = {
      seq: ++this.seq,
      t: new Date().toISOString(),
      bug: this.currentBug,
      phase: this.currentPhase,
      type,
      ...data,
    };
    this.structure.events.push(evt);
    this.flush();
    return evt;
  }

  // ---- console helpers ----
  banner(text, color = C.bold) {
    const line = '═'.repeat(Math.max(8, 72 - text.length));
    console.log(`\n${color}══════ ${text} ${line.slice(0, 72 - text.length)}${C.reset}`);
  }

  setPhase(phase) {
    if (phase === this.currentPhase) return;
    this.currentPhase = phase;
    const color = PHASE_COLORS[phase] || C.bold;
    console.log(`\n${color}${C.bold}[PHASE: ${phase}]${C.reset}`);
    this.event('phase_change', { newPhase: phase });
  }

  runStart(info) {
    this.structure.run = { startedAt: new Date().toISOString(), ...info };
    this.banner(`AUTONOMOUS DEBUGGING AGENT — model: ${info.model}`);
    this.event('run_start', info);
  }

  manifest(manifest) {
    this.structure.manifest = manifest;
    const p = manifest.provider || {};
    const resolved = manifest.resolvedModel && manifest.resolvedModel.version;
    console.log(
      `  ${C.gray}run ${manifest.runId} | ${p.provider} ${p.model}${resolved ? ` (resolved ${resolved})` : ''} | temp ${p.temperature} | prompt ${manifest.hashes.systemPrompt.slice(0, 8)} | src ${manifest.hashes.appSource.slice(0, 8)}${C.reset}`
    );
    this.event('run_manifest', { manifest });
  }

  baseline(summary) {
    this.structure.baseline = summary;
    this.banner('BASELINE TEST RUN', C.cyan);
    console.log(
      `  ${C.green}${summary.numPassedTests} passing${C.reset} / ${C.red}${summary.numFailedTests} failing${C.reset} (of ${summary.numTotalTests})`
    );
    for (const f of summary.failing) {
      console.log(`  ${C.red}✗${C.reset} ${f.fullName} ${C.gray}(${f.file})${C.reset}`);
    }
    this.event('baseline_tests', { summary });
  }

  bugStart(bugNum, target, remainingFailures) {
    this.currentBug = bugNum;
    this.currentPhase = null;
    this.banner(`BUG #${bugNum}: ${target.fullName}`, C.yellow);
    console.log(`  ${C.gray}test file: ${target.file} | ${remainingFailures} test(s) currently failing${C.reset}`);
    this.event('bug_start', { target, remainingFailures });
  }

  modelText(text) {
    // Detect and surface phase markers the model emits.
    const m = text.match(/\[PHASE:\s*([A-Z _-]+?)\s*\]/i);
    if (m) this.setPhase(m[1].toUpperCase().replace(/\s+/g, '-').replace('HYPOTHESIS-FORMATION', 'HYPOTHESIS'));
    const cleaned = text.replace(/\[PHASE:\s*[A-Z _-]+?\s*\]\s*/gi, '').trim();
    if (cleaned) {
      for (const line of cleaned.split('\n')) {
        console.log(`  ${C.reset}${line}${C.reset}`);
      }
    }
    this.event('model_text', { text });
  }

  modelThinking(text) {
    if (!text || !text.trim()) return;
    const preview = truncate(text.trim(), 500);
    for (const line of preview.split('\n')) {
      console.log(`  ${C.gray}· ${line}${C.reset}`);
    }
    this.event('model_thinking', { text });
  }

  toolCall(name, input) {
    const inputStr = truncate(JSON.stringify(input), 220);
    console.log(`  ${C.blue}→ ${name}${C.reset}${C.gray}(${inputStr})${C.reset}`);
    this.event('tool_call', { tool: name, input });
  }

  toolResult(name, result, isError = false) {
    const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
    const color = isError ? C.red : C.gray;
    console.log(`  ${color}← ${truncate(resultStr, 300)}${C.reset}`);
    this.event('tool_result', {
      tool: name,
      isError,
      result: truncate(resultStr, 20000),
    });
  }

  harness(message, data = {}) {
    console.log(`  ${C.yellow}⚖ HARNESS: ${message}${C.reset}`);
    this.event('harness', { message, ...data });
  }

  hypotheses(hypotheses) {
    for (const h of hypotheses) {
      console.log(
        `  ${C.magenta}◆ [${h.id}] (${h.likelihood}) ${h.summary}${C.reset}\n    ${C.gray}${truncate(h.reasoning, 300)}${C.reset}`
      );
    }
    this.event('hypotheses_recorded', { hypotheses });
  }

  confirmation(conf) {
    console.log(
      `  ${C.magenta}✓ hypothesis ${conf.id} confirmed via ${conf.method} (confidence ${conf.confidence})${C.reset}`
    );
    this.event('hypothesis_confirmed', conf);
  }

  learning(learning) {
    console.log(`  ${C.red}✎ LEARNING: ${truncate(learning.what_it_rules_out, 300)}${C.reset}`);
    this.event('learning_recorded', learning);
  }

  attemptFailed(attemptNum, maxAttempts, detail) {
    console.log(
      `  ${C.red}${C.bold}✗ ATTEMPT ${attemptNum}/${maxAttempts} FAILED${C.reset} ${C.gray}${truncate(detail, 200)}${C.reset}`
    );
    this.event('attempt_failed', { attemptNum, maxAttempts, detail });
  }

  bugResolved(result) {
    this.banner(`BUG #${this.currentBug} RESOLVED (${result.attempts} attempt(s), confidence ${result.confidence})`, C.green);
    console.log(`  root cause: ${result.root_cause}`);
    this.event('bug_resolved', result);
    this.currentBug = null;
    this.currentPhase = null;
  }

  bugNeedsReview(result) {
    this.banner(`BUG #${this.currentBug} NEEDS HUMAN REVIEW`, C.red);
    console.log(`  ${truncate(result.summary || result.fix_summary || '', 400)}`);
    this.event('bug_needs_review', result);
    this.currentBug = null;
    this.currentPhase = null;
  }

  crossBugCheck(check) {
    this.structure.crossBugChecks.push(check);
    if (check.sideEffectFixed.length > 0) {
      console.log(
        `  ${C.cyan}⇄ CROSS-BUG: fix also resolved ${check.sideEffectFixed.length} other failing test(s):${C.reset}`
      );
      for (const t of check.sideEffectFixed) console.log(`    ${C.green}✓${C.reset} ${t}`);
    }
    if (check.newlyBroken.length > 0) {
      console.log(`  ${C.red}⇄ CROSS-BUG: fix broke ${check.newlyBroken.length} test(s)!${C.reset}`);
      for (const t of check.newlyBroken) console.log(`    ${C.red}✗${C.reset} ${t}`);
    }
    this.event('cross_bug_check', check);
  }

  usage(u) {
    this.structure.usage.apiCalls += 1;
    this.structure.usage.inputTokens += u.input_tokens || 0;
    this.structure.usage.outputTokens += u.output_tokens || 0;
    this.structure.usage.cacheReadTokens += u.cache_read_input_tokens || 0;
    this.structure.usage.cacheWriteTokens += u.cache_creation_input_tokens || 0;
    this.flush();
  }

  addSession(sessionRecord) {
    this.structure.sessions.push(sessionRecord);
    this.flush();
  }

  finalReport(report) {
    this.structure.finalReport = report;
    this.flush();
  }
}

module.exports = { Logger, C, truncate };
