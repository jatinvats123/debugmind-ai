/**
 * The multi-bug loop: queue construction, per-bug sessions, cross-bug side
 * effect detection, budget stops and report emission — all driven offline.
 */
const fs = require('fs');
const path = require('path');
const { Orchestrator } = require('../agent/orchestrator');
const { MockProvider } = require('../agent/providers');
const { Budget } = require('../agent/budget');
const { Logger } = require('../agent/logger');
const { createWorkspace, removeWorkspace, read } = require('./helpers/workspace');

jest.setTimeout(180000);

let dir;
let quiet;
beforeEach(() => {
  dir = createWorkspace('orch');
  // Two independent bugs, deliberately uncoupled so each is one edit.
  fs.writeFileSync(path.join(dir, 'src/a.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
  fs.writeFileSync(path.join(dir, 'src/b.js'), 'function mul(a, b) {\n  return a + b;\n}\n\nmodule.exports = { mul };\n');
  fs.writeFileSync(
    path.join(dir, 'tests/ab.test.js'),
    "const { add } = require('../src/a');\nconst { mul } = require('../src/b');\n\nit('adds two numbers', () => {\n  expect(add(1, 2)).toBe(3);\n});\n\nit('multiplies two numbers', () => {\n  expect(mul(2, 3)).toBe(6);\n});\n"
  );
  fs.rmSync(path.join(dir, 'tests/greet.test.js'));
  fs.rmSync(path.join(dir, 'tests/math.test.js'));
  quiet = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  quiet.mockRestore();
  removeWorkspace(dir);
});

const turn = (toolCalls) => ({
  response: {
    text: '',
    thoughts: [],
    toolCalls,
    raw: { role: 'model', parts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) },
    finishReason: 'STOP',
    usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
});

const hypotheses = (id) => [
  { id, summary: 'wrong operator', suspected_location: 'src/x.js:2', reasoning: 'source uses the wrong operator', likelihood: 'high' },
  { id: `${id}b`, summary: 'test is wrong', suspected_location: 'tests/ab.test.js:1', reasoning: 'less likely', likelihood: 'low' },
];

/** Six turns that fix one bug the legitimate way. */
const fixSequence = (id, file, from, to) => [
  turn([{ name: 'record_hypotheses', args: { hypotheses: hypotheses(id) } }]),
  turn([{ name: 'run_snippet', args: { code: "console.log('probe')", purpose: 'observe the operator' } }]),
  turn([{ name: 'confirm_hypothesis', args: { id, method: 'snippet_probe', evidence: 'probe showed the wrong result', confidence: 0.95 } }]),
  turn([{ name: 'edit_file', args: { path: file, changes: [{ old_string: from, new_string: to }], reason: 'use the correct operator' } }]),
  turn([{ name: 'run_tests', args: {} }]),
  turn([
    {
      name: 'finish_bug',
      args: {
        status: 'fixed',
        root_cause: `${file} used the wrong operator`,
        fix_summary: `corrected the operator in ${file}`,
        confidence: 0.95,
        confidence_rationale: 'probe reproduced it and the suite verified the fix',
      },
    },
  ]),
];

function cassetteFile(turns) {
  const file = path.join(dir, 'cassette.json');
  fs.writeFileSync(file, JSON.stringify({ meta: { model: 'mock' }, turns }, null, 2));
  return file;
}

function orchestrator(turns, extra = {}) {
  const logger = new Logger(dir, 'debug-log.json', 'debug-trace.jsonl');
  return new Orchestrator({
    provider: new MockProvider({ cassettePath: cassetteFile(turns) }),
    model: 'mock',
    effort: 'high',
    projectRoot: dir,
    logger,
    maxAttempts: 4,
    ...extra,
  });
}

describe('a multi-bug run', () => {
  it('works through every failing test and reports each one', async () => {
    const report = await orchestrator([
      ...fixSequence('H1', 'src/a.js', 'return a - b;', 'return a + b;'),
      ...fixSequence('H2', 'src/b.js', 'return a + b;', 'return a * b;'),
    ]).run();

    expect(report.bugs).toHaveLength(2);
    expect(report.bugs.every((b) => b.status === 'fixed')).toBe(true);
    expect(report.finalTestState).toMatchObject({ failed: 0, total: 2 });
    expect(read(dir, 'src/a.js')).toContain('a + b');
    expect(read(dir, 'src/b.js')).toContain('a * b');
  });

  it('writes the report, the log and the trace, and archives the run', async () => {
    await orchestrator([
      ...fixSequence('H1', 'src/a.js', 'return a - b;', 'return a + b;'),
      ...fixSequence('H2', 'src/b.js', 'return a + b;', 'return a * b;'),
    ]).run();

    expect(fs.existsSync(path.join(dir, 'debug-report.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'debug-trace.jsonl'))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'agent-runs')).length).toBeGreaterThan(0);

    const md = read(dir, 'debug-report.md');
    expect(md).toMatch(/Why the agent believed this/);
    expect(md).toMatch(/Run manifest/);
  });

  it('records a manifest pinning the model, prompt and source', async () => {
    const orch = orchestrator([
      ...fixSequence('H1', 'src/a.js', 'return a - b;', 'return a + b;'),
      ...fixSequence('H2', 'src/b.js', 'return a + b;', 'return a * b;'),
    ]);
    await orch.run();

    // MockProvider identifies itself by cassette, which is what makes a replayed
    // run traceable back to the fixture that produced it.
    expect(orch.manifest.provider.model).toBe('mock:cassette.json');
    expect(orch.manifest.provider.provider).toBe('MockProvider');
    expect(orch.manifest.hashes.systemPrompt).toEqual(expect.any(String));
    expect(orch.manifest.baseline.failed).toBe(2);
  });
});

describe('cross-bug awareness', () => {
  it('notices when one fix also resolves another failing test', async () => {
    // Both tests depend on the same function, so a single fix clears both.
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'function add(a, b) {\n  return a - b;\n}\n\nmodule.exports = { add };\n');
    fs.writeFileSync(
      path.join(dir, 'tests/ab.test.js'),
      "const { add } = require('../src/a');\n\nit('adds two numbers', () => {\n  expect(add(1, 2)).toBe(3);\n});\n\nit('adds larger numbers', () => {\n  expect(add(10, 5)).toBe(15);\n});\n"
    );

    const orch = orchestrator(fixSequence('H1', 'src/a.js', 'return a - b;', 'return a + b;'));
    const report = await orch.run();

    // The queue is sorted, so the target is whichever test sorts first; the
    // other one is cleared as a side effect of the same fix.
    expect(report.bugs).toHaveLength(1); // the second test stopped failing on its own
    expect(report.bugs[0].symptom.test).toBe('adds larger numbers');
    expect(report.bugs[0].sideEffectFixed).toEqual(['adds two numbers']);
    expect(report.finalTestState.failed).toBe(0);
  });
});

describe('limits', () => {
  it('stops before the next bug when the budget is spent', async () => {
    const budget = new Budget({ projectRoot: dir, model: 'mock', maxApiCalls: 6 });
    const report = await orchestrator(
      [...fixSequence('H1', 'src/a.js', 'return a - b;', 'return a + b;'), ...fixSequence('H2', 'src/b.js', 'return a + b;', 'return a * b;')],
      { budget }
    ).run();

    expect(report.bugs).toHaveLength(1);
    expect(report.finalTestState.failed).toBe(1); // the second bug was never attempted
    expect(budget.summary().aborted.limit).toBe('api_calls');
  });

  it('honours the bug-session cap', async () => {
    const report = await orchestrator(fixSequence('H1', 'src/a.js', 'return a - b;', 'return a + b;'), {
      maxBugSessions: 1,
    }).run();

    expect(report.bugs).toHaveLength(1);
  });

  it('debugs only tests matching a target filter', async () => {
    const report = await orchestrator(fixSequence('H2', 'src/b.js', 'return a + b;', 'return a * b;'), {
      targetFilter: 'multiplies',
    }).run();

    expect(report.bugs).toHaveLength(1);
    expect(report.bugs[0].symptom.test).toMatch(/multiplies/);
  });
});
