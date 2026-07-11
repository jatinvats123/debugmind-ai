const fs = require('fs');
const path = require('path');
const { BugSession } = require('./session');
const { FileOps } = require('./fileOps');
const { runJest } = require('./testRunner');
const { C } = require('./logger');
const { buildReport, renderMarkdown } = require('./report');

const MAX_BUG_SESSIONS = 6;

class Orchestrator {
  constructor({ client, model, effort, projectRoot, logger, maxAttempts = 4, targetFilter = null }) {
    this.client = client;
    this.model = model;
    this.effort = effort;
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.maxAttempts = maxAttempts;
    this.targetFilter = targetFilter;
    this.fileOps = new FileOps(projectRoot);
  }

  async run() {
    const startedAt = Date.now();
    this.logger.runStart({ model: this.model, effort: this.effort, projectRoot: this.projectRoot, maxAttempts: this.maxAttempts });
    this.fileOps.snapshotAgentStart();

    let currentSummary = runJest(this.projectRoot);
    if (currentSummary.error) {
      throw new Error(`Baseline test run failed: ${currentSummary.error}`);
    }
    this.logger.baseline(currentSummary);

    const sessions = [];
    const priorFixes = [];
    const reviewSet = new Set();
    let bugNum = 0;

    const buildQueue = (summary) =>
      summary.failing.filter(
        (f) =>
          !reviewSet.has(f.fullName) &&
          !f.fullName.startsWith('<test file failed') &&
          (!this.targetFilter || f.fullName.includes(this.targetFilter))
      );

    let queue = buildQueue(currentSummary);
    if (queue.length === 0) {
      console.log(`${C.green}All tests passing — nothing to debug.${C.reset}`);
    }

    while (queue.length > 0 && bugNum < MAX_BUG_SESSIONS) {
      bugNum += 1;
      const target = queue[0];
      const sessionStart = Date.now();

      const session = new BugSession({
        client: this.client,
        model: this.model,
        effort: this.effort,
        projectRoot: this.projectRoot,
        fileOps: this.fileOps,
        logger: this.logger,
        bugNum,
        target,
        currentSummary,
        priorFixes,
        maxAttempts: this.maxAttempts,
      });

      const result = await session.run();
      result.durationSeconds = Math.round((Date.now() - sessionStart) / 1000);
      sessions.push(result);
      this.logger.addSession(result);

      if (result.status === 'fixed') {
        this.logger.bugResolved(result);
        priorFixes.push(result);
      } else {
        this.logger.bugNeedsReview(result);
        reviewSet.add(target.fullName);
      }

      // Cross-bug awareness: re-run the suite and diff the failing set.
      const newSummary = runJest(this.projectRoot);
      if (newSummary.error) throw new Error(`Post-session test run failed: ${newSummary.error}`);
      const prevFailing = new Set(currentSummary.failing.map((f) => f.fullName));
      const newFailing = new Set(newSummary.failing.map((f) => f.fullName));
      const check = {
        afterBug: bugNum,
        target: target.fullName,
        sideEffectFixed: [...prevFailing].filter((t) => t !== target.fullName && !newFailing.has(t)),
        newlyBroken: [...newFailing].filter((t) => !prevFailing.has(t)),
        remainingFailing: [...newFailing],
      };
      this.logger.crossBugCheck(check);
      currentSummary = newSummary;
      queue = buildQueue(currentSummary);
    }

    if (queue.length > 0 && bugNum >= MAX_BUG_SESSIONS) {
      this.logger.harness(`session cap (${MAX_BUG_SESSIONS}) reached with ${queue.length} failing test(s) remaining`);
    }

    const report = this.buildReport(sessions, currentSummary, Math.round((Date.now() - startedAt) / 1000));
    this.logger.finalReport(report);
    this.writeMarkdownReport(report);
    this.archiveRun();
    this.printFinalSummary(report);
    return report;
  }

  buildReport(sessions, finalSummary, durationSeconds) {
    return buildReport({
      sessions,
      finalTestState: {
        passed: finalSummary.numPassedTests,
        failed: finalSummary.numFailedTests,
        total: finalSummary.numTotalTests,
        stillFailing: finalSummary.failing.map((f) => f.fullName),
      },
      usage: this.logger.structure.usage,
      durationSeconds,
      events: this.logger.structure.events,
    });
  }

  writeMarkdownReport(report) {
    fs.writeFileSync(path.join(this.projectRoot, 'debug-report.md'), renderMarkdown(report));
  }

  archiveRun() {
    const runsDir = path.join(this.projectRoot, 'agent-runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(path.join(this.projectRoot, 'debug-log.json'), path.join(runsDir, `run-${stamp}.json`));
    fs.copyFileSync(path.join(this.projectRoot, 'debug-report.md'), path.join(runsDir, `run-${stamp}-report.md`));
  }

  printFinalSummary(report) {
    this.logger.banner('FINAL REPORT', C.bold);
    for (const b of report.bugs) {
      const icon = b.status === 'fixed' ? `${C.green}✅ FIXED` : `${C.red}⚠ NEEDS HUMAN REVIEW`;
      console.log(`\n${icon}${C.reset} ${C.bold}Bug #${b.bugNum}${C.reset} — ${b.symptom.test}`);
      console.log(`   root cause: ${b.rootCause}`);
      console.log(
        `   confidence: ${b.confidenceScore.percent}% (verification-based) | difficulty: ${b.difficulty.rating} | attempts: ${b.attempts} | hypotheses: ${b.hypothesesConsidered.length} | probes: ${b.snippetProbes}`
      );
      if (b.sideEffectFixed.length > 0) console.log(`   ${C.cyan}also fixed: ${b.sideEffectFixed.join('; ')}${C.reset}`);
    }
    const ts = report.finalTestState;
    const color = ts.failed === 0 ? C.green : C.yellow;
    console.log(`\n${color}${C.bold}Final test state: ${ts.passed}/${ts.total} passing${C.reset}`);
    if (ts.failed > 0) console.log(`${C.red}Still failing: ${ts.stillFailing.join('; ')}${C.reset}`);
    const u = report.usage;
    console.log(
      `${C.gray}Usage: ${u.apiCalls} API calls | ${u.inputTokens.toLocaleString()} input + ${u.outputTokens.toLocaleString()} output tokens | cache ${u.cacheReadTokens.toLocaleString()} read / ${u.cacheWriteTokens.toLocaleString()} written${C.reset}`
    );
    console.log(`${C.gray}Logs: debug-log.json (structured) | debug-report.md (readable) | agent-runs/ (archived)${C.reset}`);
  }
}

module.exports = { Orchestrator };
