/**
 * Final-report generation: builds the structured report from session results +
 * logged events, and renders debug-report.md.
 *
 * Shared by the orchestrator (live runs) and scripts/regenerate-report.js
 * (rebuild the report from an existing debug-log.json without re-running).
 */

// ---------- enhancement 1: verification-based confidence (0-100%) ----------

const METHOD_BASES = {
  snippet_probe: 85,
  isolated_test: 78,
  code_reading: 60,
  none: 45,
};

const METHOD_DESCRIPTIONS = {
  snippet_probe: 'root cause reproduced with a runtime probe before editing',
  isolated_test: 'hypothesis confirmed via an isolated test run',
  code_reading: 'hypothesis confirmed by code reading only (no runtime observation)',
  none: 'no explicit hypothesis confirmation was recorded',
};

function computeConfidenceScore(session) {
  if (session.status !== 'fixed') {
    return { percent: 0, rationale: 'No fix survived — the bug was handed off for human review.' };
  }
  const confirmations = (session.protocol && session.protocol.confirmations) || [];
  const last = confirmations[confirmations.length - 1];
  const method = last ? last.method : 'none';

  let score = METHOD_BASES[method] ?? METHOD_BASES.none;
  const parts = [METHOD_DESCRIPTIONS[method] ?? METHOD_DESCRIPTIONS.none];

  if (session.validation) {
    score += 10;
    parts.push('fix validated by an independent harness full-suite re-run');
  }

  const failed = (session.protocol && session.protocol.failedAttempts) || 0;
  if (failed > 0) {
    score -= 10 * failed;
    parts.push(`${failed} failed fix attempt(s) preceded the final fix, so part of the earlier reasoning was wrong`);
  } else {
    parts.push('fixed on the first attempt');
  }

  const sideFx = (session.sideEffectFixed || []).length;
  if (sideFx > 0) {
    score += 3;
    parts.push(`the fix also resolved ${sideFx} other failing test(s), corroborating the root cause`);
  }

  // Never a perfect score — some inference always remains.
  score = Math.max(5, Math.min(98, Math.round(score)));
  const selfReported = typeof session.confidence === 'number' ? ` (Agent self-reported ${session.confidence}.)` : '';
  return { percent: score, rationale: parts.join('; ') + '.' + selfReported };
}

// ---------- enhancement 2: before/after snippets from logged patches ----------

/** Condense a unified diff to changed lines ±1 line of context. */
function condensePatch(patch) {
  const lines = patch.split('\n');
  const hunkLines = [];
  let inHunk = false;
  for (const l of lines) {
    if (l.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (inHunk) hunkLines.push(l);
  }
  const keep = new Set();
  hunkLines.forEach((l, i) => {
    if (l.startsWith('+') || l.startsWith('-')) {
      keep.add(i - 1);
      keep.add(i);
      keep.add(i + 1);
    }
  });
  const out = [];
  let lastKept = -2;
  hunkLines.forEach((l, i) => {
    if (!keep.has(i)) return;
    if (i > lastKept + 1 && out.length > 0) out.push('  …');
    out.push(l);
    lastKept = i;
  });
  return out.join('\n').trimEnd();
}

function extractDiffs(session, events) {
  if (session.status !== 'fixed') return [];
  const fixes = (events || []).filter((e) => e.type === 'fix_applied' && e.bug === session.bugNum && e.patch);
  // Failed attempts are reverted before the next edit, so the LAST patch per file is the one that stuck.
  const lastPerFile = new Map();
  for (const f of fixes) lastPerFile.set(f.file, f);
  const files = session.files_changed && session.files_changed.length > 0 ? session.files_changed : [...lastPerFile.keys()];
  const diffs = [];
  for (const file of files) {
    const f = lastPerFile.get(file);
    if (f) diffs.push({ file, snippet: condensePatch(f.patch) });
  }
  return diffs;
}

// ---------- enhancement 3: difficulty rating ----------

function rateDifficulty(session, events) {
  const bugEvents = (events || []).filter((e) => e.bug === session.bugNum && e.type === 'tool_call');
  const allReads = new Set(
    bugEvents.filter((e) => e.tool === 'read_file' && e.input && e.input.path).map((e) => e.input.path)
  );
  // Trace depth through application code is what makes a bug hard to localize;
  // reading the failing test itself is table stakes, so tests are excluded.
  const appFilesTraced = [...allReads].filter((p) => !p.startsWith('tests/')).length;
  const crossFileLookups = bugEvents.filter((e) => e.tool === 'search_codebase' || e.tool === 'get_call_graph').length;
  const hypotheses = ((session.protocol && session.protocol.hypotheses) || []).length;
  const failed = (session.protocol && session.protocol.failedAttempts) || 0;

  // Weighted score: wrong turns dominate, then trace depth, then hypothesis churn.
  const score = failed * 3 + Math.max(0, appFilesTraced - 2) + Math.max(0, hypotheses - 2);
  let rating;
  if (session.status !== 'fixed' || score >= 5) rating = 'Hard';
  else if (score >= 2) rating = 'Medium';
  else rating = 'Easy';

  const fixedFiles = session.files_changed || [];
  let justification = `${hypotheses} hypotheses considered, ${failed} failed attempt(s), ${appFilesTraced} application file(s) traced (${allReads.size} incl. tests)` +
    (crossFileLookups > 0 ? ` plus ${crossFileLookups} cross-file lookup(s)` : '');
  if (session.status === 'fixed' && fixedFiles.length > 0) {
    justification += `; symptom surfaced in ${session.target.file} but the root cause lived in ${fixedFiles.join(', ')}`;
  }
  return { rating, justification };
}

// ---------- report assembly ----------

function buildReport({ sessions, finalTestState, usage, durationSeconds, events, completedAt }) {
  return {
    completedAt: completedAt || new Date().toISOString(),
    durationSeconds,
    finalTestState,
    usage,
    bugs: sessions.map((s) => ({
      bugNum: s.bugNum,
      symptom: {
        test: s.target.fullName,
        file: s.target.file,
        error: (s.target.message || '').split('\n').slice(0, 6).join('\n'),
      },
      status: s.status,
      difficulty: rateDifficulty(s, events),
      confidenceScore: computeConfidenceScore(s),
      diffs: extractDiffs(s, events),
      hypothesesConsidered: (s.protocol.hypotheses || []).map((h) => ({
        ...h,
        outcome: (s.protocol.confirmations || []).some((c) => c.id === h.id)
          ? 'confirmed'
          : s.status === 'fixed'
            ? 'not pursued / implicitly rejected'
            : 'unresolved',
      })),
      rejectedViaFailedAttempts: s.protocol.learnings || [],
      verificationMethods: [
        ...(s.protocol.confirmations || []).map((c) => `hypothesis ${c.id}: ${c.method} — ${c.evidence}`),
        ...(s.validation ? [s.validation.validatedBy] : []),
      ],
      rootCause: s.root_cause,
      fixApplied: s.status === 'fixed' ? { summary: s.fix_summary, files: s.files_changed } : null,
      confidence: s.confidence,
      confidenceRationale: s.confidence_rationale,
      attempts: s.attempts,
      failedAttempts: s.protocol.failedAttempts,
      snippetProbes: s.protocol.snippetProbes,
      sideEffectFixed: s.sideEffectFixed || [],
      attemptsNarrative: s.attempts_narrative,
      durationSeconds: s.durationSeconds,
    })),
  };
}

function renderMarkdown(report) {
  const L = [];
  L.push('# Autonomous Debugging Agent — Final Report');
  L.push('');
  L.push(`- Completed: ${report.completedAt}`);
  L.push(`- Duration: ${report.durationSeconds}s`);
  L.push(
    `- Final test state: **${report.finalTestState.passed}/${report.finalTestState.total} passing**` +
      (report.finalTestState.failed > 0 ? ` — still failing: ${report.finalTestState.stillFailing.join('; ')}` : '')
  );
  L.push(
    `- Token usage: ${report.usage.apiCalls} API calls, ${report.usage.inputTokens} in / ${report.usage.outputTokens} out (cache: ${report.usage.cacheReadTokens} read, ${report.usage.cacheWriteTokens} written)`
  );
  L.push('');
  for (const b of report.bugs) {
    L.push(`## Bug #${b.bugNum}: ${b.symptom.test}`);
    L.push('');
    L.push(
      `**Status:** ${b.status === 'fixed' ? '✅ fixed' : '⚠️ needs human review'} | ` +
        `**Difficulty:** ${b.difficulty.rating} | ` +
        `**Confidence:** ${b.confidenceScore.percent}% | ` +
        `**Attempts:** ${b.attempts} (${b.failedAttempts} failed) | **Duration:** ${b.durationSeconds}s`
    );
    L.push('');
    L.push(`**Difficulty rationale:** ${b.difficulty.justification}`);
    L.push('');
    L.push(`**Symptom** (${b.symptom.file}):`);
    L.push('```');
    L.push(b.symptom.error);
    L.push('```');
    L.push('');
    L.push('**Hypotheses considered:**');
    for (const h of b.hypothesesConsidered) {
      L.push(`- \`${h.id}\` (${h.likelihood} likelihood → **${h.outcome}**) ${h.summary}`);
      L.push(`  - location: ${h.suspected_location}`);
      L.push(`  - reasoning: ${h.reasoning}`);
    }
    if (b.rejectedViaFailedAttempts.length > 0) {
      L.push('');
      L.push('**Failed attempts and what they ruled out:**');
      for (const l of b.rejectedViaFailedAttempts) {
        L.push(`- attempt ${l.afterAttempt}: ${l.failed_attempt_summary}`);
        L.push(`  - rules out: ${l.what_it_rules_out}`);
        L.push(`  - revised thinking: ${l.revised_thinking}`);
      }
    }
    L.push('');
    L.push('**Verification methods:**');
    for (const v of b.verificationMethods) L.push(`- ${v}`);
    if (b.snippetProbes > 0) L.push(`- (${b.snippetProbes} non-destructive snippet probe(s) run)`);
    L.push('');
    L.push(`**Root cause:** ${b.rootCause}`);
    if (b.fixApplied) {
      L.push('');
      L.push(`**Fix:** ${b.fixApplied.summary}`);
      L.push(`Files changed: ${(b.fixApplied.files || []).join(', ')}`);
    }
    if (b.diffs.length > 0) {
      L.push('');
      L.push('**What changed (before → after):**');
      for (const d of b.diffs) {
        L.push('');
        L.push(`\`${d.file}\`:`);
        L.push('```diff');
        L.push(d.snippet);
        L.push('```');
      }
    }
    if (b.sideEffectFixed.length > 0) {
      L.push('');
      L.push(`**Cross-bug side effects:** also fixed ${b.sideEffectFixed.join('; ')}`);
    }
    if (b.attemptsNarrative) {
      L.push('');
      L.push(`**Attempts narrative:** ${b.attemptsNarrative}`);
    }
    L.push('');
    L.push(`**Confidence rationale:** ${b.confidenceScore.rationale}`);
    L.push('');
  }
  return L.join('\n');
}

module.exports = { buildReport, renderMarkdown, computeConfidenceScore, extractDiffs, rateDifficulty, condensePatch };
