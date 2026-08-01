/** Context management, budgets, manifests and the structured logger. */
const fs = require('fs');
const path = require('path');
const { pruneContents, measure } = require('../agent/context');
const { Budget } = require('../agent/budget');
const { buildManifest, hashSourceTree, sha256 } = require('../agent/manifest');
const { Logger } = require('../agent/logger');
const { createWorkspace, removeWorkspace } = require('./helpers/workspace');

jest.setTimeout(60000);

let dir;
beforeEach(() => { dir = createWorkspace('support'); });
afterEach(() => removeWorkspace(dir));

// ---------- context ----------

const bulkyResult = (name, size) => ({
  role: 'user',
  parts: [{ functionResponse: { name, response: { result: 'x'.repeat(size) } } }],
});

function longConversation() {
  const contents = [{ role: 'user', parts: [{ text: 'INTAKE: the failing test is …' }] }];
  for (let i = 0; i < 30; i++) {
    contents.push({ role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: `src/f${i}.js` } } }] });
    contents.push(bulkyResult('read_file', 6000));
  }
  return contents;
}

describe('context pruning', () => {
  it('leaves a short conversation untouched', () => {
    const contents = [{ role: 'user', parts: [{ text: 'small' }] }];
    const result = pruneContents(contents);
    expect(result.pruned).toBe(false);
    expect(result.contents).toBe(contents);
  });

  it('shrinks a long conversation once past the trigger', () => {
    const result = pruneContents(longConversation());
    expect(result.pruned).toBe(true);
    expect(result.prunedChars).toBeLessThan(result.originalChars);
    expect(result.elidedParts).toBeGreaterThan(0);
  });

  it('pins the intake message', () => {
    const result = pruneContents(longConversation());
    expect(JSON.stringify(result.contents[0])).toContain('INTAKE: the failing test');
  });

  it('keeps recent turns verbatim', () => {
    const contents = longConversation();
    const result = pruneContents(contents, { keepRecentTurns: 4 });
    const tail = result.contents.slice(-4);
    expect(JSON.stringify(tail)).not.toContain('elided by context manager');
  });

  it('never elides protocol results, however old', () => {
    const contents = longConversation();
    contents.splice(2, 0, bulkyResult('record_hypotheses', 8000), bulkyResult('run_tests', 8000));
    const result = pruneContents(contents);

    const serialized = JSON.stringify(result.contents);
    const elidedNames = (serialized.match(/elided by context manager: (\w+)/g) || []).join(' ');
    expect(elidedNames).not.toMatch(/record_hypotheses|run_tests|confirm_hypothesis|record_learning|finish_bug/);
  });

  it('preserves the sequence of what was already tried', () => {
    const result = pruneContents(longConversation());
    const calls = JSON.stringify(result.contents).match(/"functionCall"/g) || [];
    expect(calls).toHaveLength(30); // every tool call survives; only payloads shrink
  });

  it('is pure — the caller keeps the full history', () => {
    const contents = longConversation();
    const before = measure(contents);
    pruneContents(contents);
    expect(measure(contents)).toBe(before);
  });
});

// ---------- budget ----------

describe('budget', () => {
  const usage = { input_tokens: 100, output_tokens: 50 };

  it('accumulates tokens and calls per step', () => {
    const budget = new Budget({ projectRoot: dir, model: 'mock' });
    budget.record(usage);
    budget.record(usage);
    expect(budget.totals.apiCalls).toBe(2);
    expect(budget.totalTokens).toBe(300);
    expect(budget.steps).toHaveLength(2);
  });

  it('reports cost as unpriced rather than estimating', () => {
    const budget = new Budget({ projectRoot: dir, model: 'model-with-no-price' });
    budget.record(usage);
    const cost = budget.estimateCost();
    expect(cost.usd).toBeNull();
    expect(cost.reason).toMatch(/unpriced/);
    expect(budget.summary().estimatedCostUsd).toBeNull();
  });

  it('stays silent while within budget', () => {
    const budget = new Budget({ projectRoot: dir, model: 'mock', maxTokens: 10000 });
    budget.record(usage);
    expect(budget.check()).toBeNull();
  });

  it('trips the token ceiling', () => {
    const budget = new Budget({ projectRoot: dir, model: 'mock', maxTokens: 200 });
    budget.record(usage);
    budget.record(usage);
    const violation = budget.check();
    expect(violation.limit).toBe('tokens');
    expect(budget.summary().aborted).not.toBeNull();
  });

  it('trips the API-call ceiling', () => {
    const budget = new Budget({ projectRoot: dir, model: 'mock', maxApiCalls: 1 });
    budget.record(usage);
    expect(budget.check().limit).toBe('api_calls');
  });

  it('trips the wall-clock ceiling', () => {
    const budget = new Budget({ projectRoot: dir, model: 'mock', maxWallClockMs: -1 });
    expect(budget.check().limit).toBe('wall_clock');
  });

  it('cannot trip a cost ceiling it has no price for', () => {
    const budget = new Budget({ projectRoot: dir, model: 'unpriced', maxCostUsd: 0.000001 });
    budget.record({ input_tokens: 1e9, output_tokens: 1e9 });
    expect(budget.check()).toBeNull();
  });
});

// ---------- manifest ----------

describe('manifest', () => {
  const provider = {
    model: 'mock', temperature: 0,
    describe: () => ({ provider: 'MockProvider', model: 'mock', temperature: 0 }),
    resolveModelVersion: async () => ({ name: 'mock', version: 'v1' }),
  };

  it('captures provider, hashes and runtime', async () => {
    const manifest = await buildManifest({
      projectRoot: dir, provider, systemPrompt: 'prompt', toolDefs: [{ name: 'run_tests' }],
      config: {}, baseline: { passed: 2, failed: 1, total: 3, failing: ['x'] },
    });

    expect(manifest.provider.model).toBe('mock');
    expect(manifest.resolvedModel.version).toBe('v1');
    expect(manifest.hashes.systemPrompt).toBe(sha256('prompt'));
    expect(manifest.hashes.appSource).toEqual(expect.any(String));
    expect(manifest.runtime.node).toBe(process.version);
    expect(manifest.baseline.failed).toBe(1);
  });

  it('changes the source hash when application code changes', async () => {
    const before = hashSourceTree(dir);
    fs.appendFileSync(path.join(dir, 'src/greet.js'), '\n// changed\n');
    expect(hashSourceTree(dir)).not.toBe(before);
  });

  it('separates a prompt change from a model change', async () => {
    const a = await buildManifest({ projectRoot: dir, provider, systemPrompt: 'v1', toolDefs: [], config: {}, baseline: {} });
    const b = await buildManifest({ projectRoot: dir, provider, systemPrompt: 'v2', toolDefs: [], config: {}, baseline: {} });
    expect(a.hashes.systemPrompt).not.toBe(b.hashes.systemPrompt);
    expect(a.provider.model).toBe(b.provider.model);
  });
});

// ---------- logger ----------

describe('logger trace', () => {
  it('appends one JSON object per line as events happen', () => {
    const logger = new Logger(dir, 'log.json', 'trace.jsonl');
    logger.event('a', { x: 1 });
    logger.event('b', { y: 2 });

    const lines = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0].type).toBe('a');
    expect(parsed[1].seq).toBe(2);
    expect(parsed[0].elapsedMs).toEqual(expect.any(Number));
  });

  it('records per-turn tokens and latency', () => {
    const logger = new Logger(dir, 'log.json', 'trace.jsonl');
    logger.usage({ input_tokens: 10, output_tokens: 4 }, 1234);

    const turn = JSON.parse(fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').trim());
    expect(turn.type).toBe('model_turn');
    expect(turn.durationMs).toBe(1234);
    expect(turn.inputTokens).toBe(10);
    expect(turn.cumulativeTokens).toBe(14);
  });

  it('leaves a valid prefix if a run dies mid-write', () => {
    const logger = new Logger(dir, 'log.json', 'trace.jsonl');
    logger.event('first');
    fs.appendFileSync(path.join(dir, 'trace.jsonl'), '{"partial":');

    const lines = fs.readFileSync(path.join(dir, 'trace.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
