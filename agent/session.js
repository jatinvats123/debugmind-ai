const { TOOL_DEFINITIONS } = require('./tools');
const { SYSTEM_PROMPT, buildIntakeMessage } = require('./prompts');
const { runJest, runSpecificTest, summarizeForModel } = require('./testRunner');
const { getCallGraph } = require('./callGraph');
const { runSnippet } = require('./snippet');

const MAX_TURNS = 45;

class BugSession {
  constructor({ client, model, effort, projectRoot, fileOps, logger, bugNum, target, currentSummary, priorFixes, maxAttempts = 4 }) {
    this.client = client;
    this.model = model;
    this.effort = effort;
    this.projectRoot = projectRoot;
    this.fileOps = fileOps;
    this.logger = logger;
    this.bugNum = bugNum;
    this.target = target;
    this.priorFixes = priorFixes;
    this.maxAttempts = maxAttempts;

    this.baselinePassing = new Set(currentSummary.passing);
    this.baselineFailing = new Set(currentSummary.failing.map((f) => f.fullName));
    this.allFailing = currentSummary.failing;

    // protocol state
    this.hypotheses = [];
    this.confirmations = [];
    this.learnings = [];
    this.attempts = 0;
    this.pendingFailure = null; // { learningRecorded: boolean }
    this.verifiedSuccess = false;
    this.budgetExhausted = false;
    this.harnessForcedReview = false;
    this.verificationRuns = 0;
    this.snippetProbes = 0;
  }

  // ---------- verdict computation ----------
  evaluateFullRun(summary) {
    const failingNames = new Set(summary.failing.map((f) => f.fullName));
    const targetPassing = summary.passing.includes(this.target.fullName);
    const regressions = [...this.baselinePassing].filter((t) => failingNames.has(t));
    const sideEffectFixed = [...this.baselineFailing].filter(
      (t) => t !== this.target.fullName && summary.passing.includes(t)
    );
    return { targetPassing, regressions, sideEffectFixed };
  }

  // ---------- tool execution with guards ----------
  executeTool(name, input) {
    const fo = this.fileOps;
    try {
      switch (name) {
        case 'list_files': {
          const entries = fo.listFiles(input.directory || '.');
          return { text: entries.map((e) => (e.type === 'dir' ? e.name : `${e.name} (${e.size} bytes)`)).join('\n') || '(empty)' };
        }
        case 'read_file':
          return { text: fo.readFile(input.path) };
        case 'search_codebase': {
          const { matches, truncated } = fo.search(input.query);
          if (matches.length === 0) return { text: `No matches for "${input.query}".` };
          const lines = matches.map((m) => `${m.file}:${m.line}: ${m.text}`);
          if (truncated) lines.push('…[more matches truncated]');
          return { text: lines.join('\n') };
        }
        case 'get_call_graph': {
          const graph = getCallGraph(this.projectRoot, input.functionName);
          return { text: JSON.stringify(graph, null, 2) };
        }
        case 'run_specific_test': {
          const summary = runSpecificTest(this.projectRoot, input.testName);
          if (summary.error) return { text: summarizeForModel(summary), isError: true };
          if (summary.numTotalTests === 0) {
            return { text: `No tests matched "${input.testName}". Use the exact name from the failure output.`, isError: true };
          }
          return { text: summarizeForModel(summary) };
        }
        case 'run_snippet': {
          this.snippetProbes += 1;
          const res = runSnippet(this.projectRoot, input.code);
          const parts = [`exit code: ${res.exitCode}${res.timedOut ? ' (TIMED OUT)' : ''}`];
          if (res.stdout) parts.push(`--- stdout ---\n${res.stdout}`);
          if (res.stderr) parts.push(`--- stderr ---\n${res.stderr}`);
          return { text: parts.join('\n') };
        }
        case 'diff_check': {
          const d = fo.diffCheck(input.path);
          return { text: d.patch };
        }

        case 'run_tests':
          return this.handleRunTests();

        case 'edit_file':
          return this.handleEditFile(input);

        case 'revert_file':
          return this.handleRevertFile(input);

        case 'record_hypotheses':
          return this.handleRecordHypotheses(input);

        case 'confirm_hypothesis':
          return this.handleConfirmHypothesis(input);

        case 'record_learning':
          return this.handleRecordLearning(input);

        case 'finish_bug':
          return this.handleFinishBug(input);

        default:
          return { text: `Unknown tool "${name}".`, isError: true };
      }
    } catch (e) {
      return { text: `ERROR: ${e.message}`, isError: true };
    }
  }

  handleRunTests() {
    const summary = runJest(this.projectRoot);
    let text = summarizeForModel(summary);
    if (summary.error) return { text, isError: true };

    const modified = this.fileOps.modifiedSinceSessionStart();
    if (modified.length === 0) {
      return { text: text + '\n\n[HARNESS] Informational run — no edits are currently applied.' };
    }

    // Edits are live: this run is a verification attempt.
    this.verificationRuns += 1;
    const { targetPassing, regressions, sideEffectFixed } = this.evaluateFullRun(summary);

    if (targetPassing && regressions.length === 0) {
      this.verifiedSuccess = true;
      let verdict = `\n\n[HARNESS VERDICT: VERIFICATION PASSED] Target test passes and all ${this.baselinePassing.size} previously-passing tests still pass.`;
      if (sideEffectFixed.length > 0) {
        verdict += ` Side effect: ${sideEffectFixed.length} other previously-failing test(s) now also pass: ${sideEffectFixed.join('; ')}.`;
      }
      verdict += ' You may now call finish_bug(status="fixed").';
      this.logger.harness('verification PASSED', { targetPassing, regressions, sideEffectFixed });
      return { text: text + verdict };
    }

    // Failed attempt
    this.verifiedSuccess = false;
    this.attempts += 1;
    this.pendingFailure = { learningRecorded: false };
    const problems = [];
    if (!targetPassing) problems.push('the target test still fails');
    if (regressions.length > 0) problems.push(`REGRESSIONS — previously-passing tests now fail: ${regressions.join('; ')}`);
    const detail = problems.join(' AND ');
    this.logger.attemptFailed(this.attempts, this.maxAttempts, detail);

    let verdict = `\n\n[HARNESS VERDICT: ATTEMPT ${this.attempts}/${this.maxAttempts} FAILED] ${detail}.`;
    if (this.attempts >= this.maxAttempts) {
      this.budgetExhausted = true;
      verdict +=
        ' The attempt budget is EXHAUSTED. Revert every modified file (revert_file), then call finish_bug(status="needs_human_review") with a full attempts_narrative.';
    } else {
      verdict +=
        ` Required next steps: (1) revert_file on each modified file [${modified.join(', ')}], (2) record_learning, (3) form a revised hypothesis. edit_file stays locked until then.`;
    }
    return { text: text + verdict };
  }

  handleEditFile(input) {
    if (this.confirmations.length === 0) {
      return {
        text:
          '[HARNESS GUARD] edit_file is locked: no confirmed hypothesis. Record 2-3 hypotheses (record_hypotheses), verify the leading one — preferably with a run_snippet probe — then confirm_hypothesis. Guess-and-check editing is not permitted.',
        isError: true,
      };
    }
    if (this.pendingFailure) {
      const modified = this.fileOps.modifiedSinceSessionStart();
      const needs = [];
      if (modified.length > 0) needs.push(`revert_file on: ${modified.join(', ')}`);
      if (!this.pendingFailure.learningRecorded) needs.push('record_learning');
      return {
        text: `[HARNESS GUARD] edit_file is locked after the failed attempt. Still required: ${needs.join(' AND ')}.`,
        isError: true,
      };
    }
    const { rel, patch } = this.fileOps.editFile(input.path, input.changes);
    this.verifiedSuccess = false;
    this.logger.event('fix_applied', { file: rel, reason: input.reason, patch });
    return { text: `Edit applied to ${rel}.\n${patch}\nNow verify with the FULL suite (run_tests).` };
  }

  handleRevertFile(input) {
    const res = this.fileOps.revertFile(input.path);
    this.verifiedSuccess = false;
    this.logger.event('revert', { file: res.rel, restoredTo: res.restoredTo });
    this.maybeClearPendingFailure();
    return { text: `Reverted ${res.rel} to ${res.restoredTo}.` };
  }

  handleRecordHypotheses(input) {
    const hs = input.hypotheses || [];
    if (hs.length < 2) {
      return {
        text: '[HARNESS GUARD] Record at least 2 ranked hypotheses (2-3 expected). If you are certain of one cause, still state the strongest alternative and why it is less likely.',
        isError: true,
      };
    }
    this.hypotheses.push(...hs);
    this.logger.hypotheses(hs);
    return {
      text: `Recorded ${hs.length} hypotheses (${hs.map((h) => h.id).join(', ')}). Next: verify the leading one non-destructively (run_snippet / run_specific_test) before editing.`,
    };
  }

  handleConfirmHypothesis(input) {
    const known = this.hypotheses.find((h) => h.id === input.id);
    if (!known) {
      return {
        text: `[HARNESS GUARD] No recorded hypothesis with id "${input.id}". Recorded ids: ${this.hypotheses.map((h) => h.id).join(', ') || '(none)'}.`,
        isError: true,
      };
    }
    this.confirmations.push({ ...input, at: new Date().toISOString() });
    this.logger.confirmation(input);
    let note = `Hypothesis ${input.id} confirmed. edit_file is now unlocked.`;
    if (input.method === 'code_reading') {
      note += ' (Confirmed by code reading only — consider a run_snippet probe for stronger evidence, and calibrate final confidence accordingly.)';
    }
    return { text: note };
  }

  handleRecordLearning(input) {
    this.learnings.push({ ...input, afterAttempt: this.attempts, at: new Date().toISOString() });
    this.logger.learning(input);
    if (this.pendingFailure) this.pendingFailure.learningRecorded = true;
    this.maybeClearPendingFailure();
    const stillModified = this.fileOps.modifiedSinceSessionStart();
    const revertNote =
      stillModified.length > 0
        ? ` Reminder: still modified and needing revert: ${stillModified.join(', ')}.`
        : '';
    return { text: `Learning recorded.${revertNote}` };
  }

  maybeClearPendingFailure() {
    if (
      this.pendingFailure &&
      this.pendingFailure.learningRecorded &&
      this.fileOps.modifiedSinceSessionStart().length === 0
    ) {
      this.pendingFailure = null;
      this.logger.harness('failed-attempt cleanup complete — edit_file unlocked for the next attempt');
    }
  }

  handleFinishBug(input) {
    if (input.status === 'fixed') {
      const modified = this.fileOps.modifiedSinceSessionStart();
      if (modified.length === 0) {
        return {
          text: '[HARNESS GUARD] finish_bug(fixed) rejected: no application file differs from session start, so nothing was fixed.',
          isError: true,
        };
      }
      // Independent validation — never trust the claim.
      this.logger.harness('independently validating the fix (full suite re-run)…');
      const summary = runJest(this.projectRoot);
      if (summary.error) {
        return { text: `[HARNESS] Validation run errored: ${summary.error}`, isError: true };
      }
      const { targetPassing, regressions, sideEffectFixed } = this.evaluateFullRun(summary);
      if (targetPassing && regressions.length === 0) {
        return {
          finish: {
            ...input,
            files_changed: input.files_changed && input.files_changed.length > 0 ? input.files_changed : modified,
            attempts: this.attempts + 1, // successful attempt included
            sideEffectFixed,
            validation: { targetPassing, regressions: [], validatedBy: 'harness full-suite re-run' },
          },
          text: 'Fix validated by the harness. Session complete.',
        };
      }
      // False/premature claim
      if (!this.pendingFailure) {
        this.attempts += 1;
        this.pendingFailure = { learningRecorded: false };
        this.logger.attemptFailed(this.attempts, this.maxAttempts, 'finish_bug(fixed) claim failed harness validation');
        if (this.attempts >= this.maxAttempts) this.budgetExhausted = true;
      }
      const problems = [];
      if (!targetPassing) problems.push('target test still fails');
      if (regressions.length > 0) problems.push(`regressions: ${regressions.join('; ')}`);
      return {
        text: `[HARNESS] finish_bug(fixed) REJECTED by independent validation: ${problems.join(' AND ')}. ${
          this.budgetExhausted
            ? 'Attempt budget exhausted — revert everything and finish with needs_human_review.'
            : 'Revert, record_learning, and revise your hypothesis.'
        }`,
        isError: true,
      };
    }

    if (input.status === 'needs_human_review') {
      if (!this.budgetExhausted && !this.harnessForcedReview) {
        return {
          text: `[HARNESS GUARD] needs_human_review rejected: only ${this.attempts}/${this.maxAttempts} attempts used. Keep investigating — form a new hypothesis and test it.`,
          isError: true,
        };
      }
      const restored = this.fileOps.restoreSessionStart();
      if (restored.length > 0) {
        this.logger.harness(`auto-restored un-reverted files before review handoff: ${restored.join(', ')}`);
      }
      return {
        finish: { ...input, attempts: this.attempts, autoRestoredFiles: restored },
        text: 'Recorded as needs_human_review.',
      };
    }

    return { text: `Unknown finish status "${input.status}".`, isError: true };
  }

  // ---------- conversation loop ----------
  async run() {
    this.fileOps.snapshotSessionStart();
    this.logger.bugStart(this.bugNum, this.target, this.allFailing.length);

    const intake = buildIntakeMessage({
      bugNum: this.bugNum,
      target: this.target,
      allFailing: this.allFailing,
      priorFixes: this.priorFixes,
      attemptBudget: this.maxAttempts,
    });
    const contents = [{ role: 'user', parts: [{ text: intake }] }];

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      let res;
      try {
        res = await this.client.chat({ system: SYSTEM_PROMPT, toolDefs: TOOL_DEFINITIONS, contents });
      } catch (e) {
        this.logger.harness(`API error: ${e.message} — aborting session`);
        return this.forceReview(`API failure: ${e.message}`);
      }

      this.logger.usage(res.usage);
      const candidate = res.candidate;
      const parts = (candidate && candidate.content && candidate.content.parts) || [];

      for (const p of parts) {
        if (p.thought && p.text) this.logger.modelThinking(p.text);
        else if (p.text) this.logger.modelText(p.text);
      }

      const finishReason = candidate && candidate.finishReason;
      if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT' || finishReason === 'RECITATION') {
        this.logger.harness(`model response blocked (${finishReason}) — aborting session`);
        return this.forceReview(`Model response blocked: ${finishReason}.`);
      }

      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

      if (functionCalls.length === 0) {
        if (candidate && candidate.content) contents.push(candidate.content);
        const nudge =
          finishReason === 'MAX_TOKENS'
            ? '[HARNESS] Your response was truncated by the token limit. Continue more concisely.'
            : '[HARNESS] You ended your turn without a tool call. Continue the protocol with tools; when the bug is closed out, call finish_bug.';
        contents.push({ role: 'user', parts: [{ text: nudge }] });
        continue;
      }

      contents.push(candidate.content);

      const responseParts = [];
      let finished = null;
      for (const fc of functionCalls) {
        const input = fc.args || {};
        this.logger.toolCall(fc.name, input);
        const result = finished
          ? { text: '[HARNESS] Session already finished; call ignored.', isError: true }
          : this.executeTool(fc.name, input);
        this.logger.toolResult(fc.name, result.text, !!result.isError);
        const fr = {
          name: fc.name,
          response: result.isError ? { error: result.text } : { result: result.text },
        };
        if (fc.id) fr.id = fc.id;
        responseParts.push({ functionResponse: fr });
        if (result.finish) finished = result.finish;
      }

      if (finished) {
        return this.buildResult(finished);
      }
      contents.push({ role: 'user', parts: responseParts });
    }

    // Turn cap hit.
    this.logger.harness(`turn cap (${MAX_TURNS}) reached — forcing session closure`);
    if (this.verifiedSuccess) {
      const summary = runJest(this.projectRoot);
      const { targetPassing, regressions, sideEffectFixed } = this.evaluateFullRun(summary);
      if (targetPassing && regressions.length === 0) {
        return this.buildResult({
          status: 'fixed',
          root_cause: this.confirmations.length > 0 ? `(harness-closed) ${this.confirmations[this.confirmations.length - 1].evidence}` : '(harness-closed, see log)',
          fix_summary: '(session hit turn cap after a passing verification; closed by harness)',
          files_changed: this.fileOps.modifiedSinceSessionStart(),
          confidence: 0.7,
          confidence_rationale: 'Fix verified by tests, but the model did not deliver a final report before the turn cap.',
          attempts: this.attempts + 1,
          sideEffectFixed,
          validation: { targetPassing, regressions: [], validatedBy: 'harness (turn-cap closure)' },
        });
      }
    }
    return this.forceReview('Turn cap reached without a verified fix.');
  }

  forceReview(reason) {
    this.harnessForcedReview = true;
    const restored = this.fileOps.restoreSessionStart();
    if (restored.length > 0) this.logger.harness(`restored files: ${restored.join(', ')}`);
    return this.buildResult({
      status: 'needs_human_review',
      root_cause: 'undetermined',
      fix_summary: reason,
      confidence: 0,
      confidence_rationale: reason,
      attempts: this.attempts,
      attempts_narrative: `Harness-forced review: ${reason}. Attempts used: ${this.attempts}. See structured log for full history.`,
      autoRestoredFiles: restored,
    });
  }

  buildResult(finish) {
    return {
      bugNum: this.bugNum,
      target: this.target,
      ...finish,
      protocol: {
        hypotheses: this.hypotheses,
        confirmations: this.confirmations,
        learnings: this.learnings,
        failedAttempts: this.attempts,
        verificationRuns: this.verificationRuns,
        snippetProbes: this.snippetProbes,
      },
    };
  }
}

module.exports = { BugSession };
