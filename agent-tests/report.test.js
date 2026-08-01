/**
 * Report generation, including a snapshot.
 *
 * The report is the project's primary output, so its shape is pinned. Inputs are
 * fixed here (no clocks, no live runs) so the snapshot is deterministic.
 */
const {
  buildReport, renderMarkdown, computeConfidenceScore, rateDifficulty, extractDiffs, condensePatch,
} = require('../agent/report');

const PATCH = `Index: src/greet.js
--- src/greet.js\tbefore edit
+++ src/greet.js\tafter edit
@@ -1,3 +1,3 @@
 function greet(name) {
-  return 'Hi ' + name;
+  return 'Hello ' + name;
 }
`;

/** A session that was fixed cleanly, first attempt, probe-confirmed. */
function cleanSession(overrides = {}) {
  return {
    bugNum: 1,
    target: { fullName: 'greet greets with Hello', file: 'tests/greet.test.js', message: 'Expected "Hello Bob"\n  at greet.test.js:5' },
    status: 'fixed',
    root_cause: 'greet returned the wrong prefix',
    fix_summary: 'changed the prefix to Hello',
    files_changed: ['src/greet.js'],
    confidence: 0.95,
    confidence_rationale: 'probe reproduced it',
    attempts: 1,
    durationSeconds: 42,
    sideEffectFixed: [],
    validation: { targetPassing: true, regressions: [], validatedBy: 'harness full-suite re-run' },
    protocol: {
      hypotheses: [
        { id: 'H1', summary: 'wrong prefix', suspected_location: 'src/greet.js:2', reasoning: 'source says Hi', likelihood: 'high' },
        { id: 'H2', summary: 'test wrong', suspected_location: 'tests/greet.test.js:5', reasoning: 'unlikely', likelihood: 'low' },
      ],
      confirmations: [
        { id: 'H1', method: 'snippet_probe', evidence: 'probe printed "Hi Bob"', confidence: 0.95, methodVerifiedByHarness: true, evidenceObserved: { probesSinceHypotheses: 1, isolatedRunsSinceHypotheses: 0 } },
      ],
      learnings: [],
      failedAttempts: 0,
      snippetProbes: 1,
      isolatedTestRuns: 0,
    },
    ...overrides,
  };
}

const EVENTS = [
  { bug: 1, type: 'tool_call', tool: 'read_file', input: { path: 'tests/greet.test.js' } },
  { bug: 1, type: 'tool_call', tool: 'read_file', input: { path: 'src/greet.js' } },
  { bug: 1, type: 'tool_call', tool: 'get_call_graph', input: { functionName: 'greet' } },
  { bug: 1, type: 'tool_call', tool: 'run_snippet', input: { purpose: 'observe greet output' } },
  { bug: 1, type: 'tool_result', tool: 'run_snippet', result: 'exit code: 0\n--- stdout ---\nHi Bob\n' },
  { bug: 1, type: 'fix_applied', file: 'src/greet.js', reason: 'prefix must be Hello', patch: PATCH },
];

const REPORT_INPUT = {
  sessions: [cleanSession()],
  finalTestState: { passed: 3, failed: 0, total: 3, stillFailing: [] },
  usage: { apiCalls: 8, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
  durationSeconds: 42,
  events: EVENTS,
  completedAt: '2026-01-01T00:00:00.000Z',
  budget: { estimatedCostUsd: null, costNote: 'unpriced: no verified rate for "mock"', aborted: null },
  manifest: {
    runId: 'fixed-run-id',
    provider: { provider: 'MockProvider', model: 'mock', temperature: 0 },
    resolvedModel: { version: 'v1' },
    determinism: { note: 'temperature=0' },
    hashes: { systemPrompt: 'a'.repeat(64), toolSchemas: 'b'.repeat(64), appSource: 'c'.repeat(64) },
    runtime: { node: 'v24.0.0', platform: 'test' },
    git: { commit: 'abcdef1234', branch: 'test', dirty: false },
  },
};

describe('confidence scoring', () => {
  it('scores a probe-confirmed, independently validated, first-attempt fix highest', () => {
    const { percent, rationale } = computeConfidenceScore(cleanSession());
    expect(percent).toBeGreaterThanOrEqual(95);
    expect(rationale).toMatch(/runtime probe/);
  });

  it('scores code-reading confirmation lower than a probe', () => {
    const reading = cleanSession({
      protocol: { ...cleanSession().protocol, confirmations: [{ id: 'H1', method: 'code_reading', evidence: 'read it', confidence: 0.7, methodVerifiedByHarness: false }] },
    });
    expect(computeConfidenceScore(reading).percent).toBeLessThan(computeConfidenceScore(cleanSession()).percent);
  });

  it('penalises each failed attempt', () => {
    const withFailures = cleanSession({ protocol: { ...cleanSession().protocol, failedAttempts: 2 } });
    expect(computeConfidenceScore(withFailures).percent).toBeLessThan(computeConfidenceScore(cleanSession()).percent);
  });

  it('never reports confidence for an unresolved bug', () => {
    const escalated = cleanSession({ status: 'needs_human_review' });
    expect(computeConfidenceScore(escalated).percent).toBe(0);
  });

  it('is capped below certainty', () => {
    const perfect = cleanSession({ sideEffectFixed: ['another test'] });
    expect(computeConfidenceScore(perfect).percent).toBeLessThanOrEqual(98);
  });
});

describe('difficulty rating', () => {
  it('rates a shallow single-file fix as easy', () => {
    const { rating } = rateDifficulty(cleanSession(), EVENTS.slice(0, 2));
    expect(rating).toBe('Easy');
  });

  it('escalates difficulty with failed attempts', () => {
    const hard = cleanSession({ protocol: { ...cleanSession().protocol, failedAttempts: 2 } });
    expect(rateDifficulty(hard, EVENTS).rating).toBe('Hard');
  });

  it('always rates an unresolved bug hard', () => {
    expect(rateDifficulty(cleanSession({ status: 'needs_human_review' }), EVENTS).rating).toBe('Hard');
  });

  it('excludes test files from the trace-depth count', () => {
    const { justification } = rateDifficulty(cleanSession(), EVENTS);
    expect(justification).toMatch(/1 application file\(s\) traced \(2 incl. tests\)/);
  });
});

describe('diff extraction', () => {
  it('condenses a patch to changed lines with context', () => {
    const condensed = condensePatch(PATCH);
    expect(condensed).toMatch(/-\s+return 'Hi '/);
    expect(condensed).toMatch(/\+\s+return 'Hello '/);
    expect(condensed).not.toMatch(/^Index:/m);
  });

  it('returns no diffs for an unresolved bug', () => {
    expect(extractDiffs(cleanSession({ status: 'needs_human_review' }), EVENTS)).toEqual([]);
  });
});

describe('evidence trail', () => {
  const report = buildReport(REPORT_INPUT);
  const trail = report.bugs[0].evidenceTrail;

  it('starts from the symptom', () => {
    expect(trail[0].step).toBe('symptom');
    expect(trail[0].detail).toMatch(/greets with Hello/);
  });

  it('records what was read and traced', () => {
    const exploration = trail.find((t) => t.step === 'exploration');
    expect(exploration.detail).toMatch(/src\/greet\.js/);
    expect(exploration.detail).toMatch(/traced call graph for/);
  });

  it('quotes what the probe actually observed', () => {
    const probe = trail.find((t) => t.step === 'probe');
    expect(probe.detail).toBe('observe greet output');
    expect(probe.observed).toMatch(/Hi Bob/);
  });

  it('states whether the harness corroborated the confirmation', () => {
    const confirmed = trail.find((t) => t.step.startsWith('confirmed'));
    expect(confirmed.detail).toMatch(/corroborated by the harness/);
  });

  it('ends with independent verification', () => {
    expect(trail[trail.length - 1].step).toBe('verification');
  });
});

describe('markdown rendering', () => {
  it('reports cost as unpriced rather than inventing a figure', () => {
    const md = renderMarkdown(buildReport(REPORT_INPUT));
    expect(md).toMatch(/not reported — unpriced/);
    expect(md).not.toMatch(/\$\d/);
  });

  it('includes the reproducibility manifest', () => {
    const md = renderMarkdown(buildReport(REPORT_INPUT));
    expect(md).toMatch(/System prompt hash/);
    expect(md).toMatch(/Temperature: 0/);
  });

  it('matches the pinned snapshot', () => {
    expect(renderMarkdown(buildReport(REPORT_INPUT))).toMatchSnapshot();
  });
});
