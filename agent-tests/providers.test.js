/**
 * Provider abstraction, including a full offline bug session.
 *
 * CI must never call a real API, so the end-to-end test below drives the entire
 * reasoning loop from a synthetic cassette — proving the loop works without a key.
 */
const fs = require('fs');
const path = require('path');
const { MockProvider, RecordingProvider, hashRequest, createProvider } = require('../agent/providers');
const { BugSession } = require('../agent/session');
const { FileOps } = require('../agent/fileOps');
const { createWorkspace, removeWorkspace, read, stubLogger } = require('./helpers/workspace');

jest.setTimeout(120000);

let dir;
beforeEach(() => { dir = createWorkspace('provider'); });
afterEach(() => removeWorkspace(dir));

const cassette = (turns, meta = {}) => {
  const file = path.join(dir, 'cassette.json');
  fs.writeFileSync(file, JSON.stringify({ meta: { model: 'mock', ...meta }, turns }, null, 2));
  return file;
};

const turn = (toolCalls, text = '') => ({
  response: {
    text,
    thoughts: [],
    toolCalls,
    raw: { role: 'model', parts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })) },
    finishReason: 'STOP',
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  },
});

describe('createProvider', () => {
  it('builds a mock provider without any credentials', async () => {
    const file = cassette([turn([{ name: 'run_tests', args: {} }])]);
    const provider = createProvider({ provider: 'mock', cassettePath: file });
    await expect(provider.preflight()).resolves.toBeUndefined();
    expect(provider.describe().provider).toBe('MockProvider');
  });

  it('requires a key for the real backend', () => {
    expect(() => createProvider({ provider: 'gemini' })).toThrow(/API key/i);
  });

  it('rejects an unknown backend', () => {
    expect(() => createProvider({ provider: 'nope' })).toThrow(/Unknown provider/);
  });

  it('rejects a mock provider with no cassette', () => {
    expect(() => createProvider({ provider: 'mock' })).toThrow(/cassettePath/);
  });
});

describe('MockProvider', () => {
  it('replays recorded turns in order', async () => {
    const file = cassette([
      turn([{ name: 'read_file', args: { path: 'src/greet.js' } }]),
      turn([{ name: 'run_tests', args: {} }]),
    ]);
    const provider = new MockProvider({ cassettePath: file });

    const first = await provider.generateWithTools({ system: 's', toolDefs: [], contents: [] });
    const second = await provider.generateWithTools({ system: 's', toolDefs: [], contents: [] });

    expect(first.toolCalls[0].name).toBe('read_file');
    expect(second.toolCalls[0].name).toBe('run_tests');
  });

  it('throws a clear error when the cassette runs out', async () => {
    const provider = new MockProvider({ cassettePath: cassette([turn([{ name: 'run_tests', args: {} }])]) });
    await provider.generateWithTools({ system: 's', toolDefs: [], contents: [] });
    await expect(provider.generateWithTools({ system: 's', toolDefs: [], contents: [] })).rejects.toThrow(/exhausted/i);
  });

  it('detects drift and names the diverging conversation entry', async () => {
    const request = { system: 's', toolDefs: [], contents: [{ role: 'user', parts: [{ text: 'original' }] }] };
    const recorded = turn([{ name: 'run_tests', args: {} }]);
    recorded.requestHash = hashRequest(request);
    recorded.requestParts = require('../agent/providers/mock').hashParts(request.contents);

    const provider = new MockProvider({ cassettePath: cassette([recorded]) });
    const drifted = { ...request, contents: [{ role: 'user', parts: [{ text: 'CHANGED' }] }] };

    await expect(provider.generateWithTools(drifted)).rejects.toThrow(/drift.*entry 0/is);
  });

  it('only warns about drift in sequential mode', async () => {
    const request = { system: 's', toolDefs: [], contents: [{ role: 'user', parts: [{ text: 'a' }] }] };
    const recorded = turn([{ name: 'run_tests', args: {} }]);
    recorded.requestHash = 'deadbeefdeadbeef';

    const provider = new MockProvider({ cassettePath: cassette([recorded]), matchMode: 'sequential' });
    await expect(provider.generateWithTools(request)).resolves.toBeDefined();
    expect(provider.drift).toHaveLength(1);
  });
});

describe('RecordingProvider', () => {
  it('captures turns from the wrapped provider into a cassette', async () => {
    const inner = {
      model: 'inner', temperature: 0,
      describe: () => ({ provider: 'Fake', model: 'inner', temperature: 0 }),
      preflight: async () => {},
      generateWithTools: async () => turn([{ name: 'run_tests', args: {} }]).response,
      generate: async () => turn([]).response,
    };
    const out = path.join(dir, 'recorded.cassette.json');
    const recorder = new RecordingProvider({ inner, cassettePath: out });
    recorder.onRetry = () => {}; // must not throw despite the base-class accessor ordering

    await recorder.generateWithTools({ system: 's', toolDefs: [], contents: [] });

    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(written.turns).toHaveLength(1);
    expect(written.turns[0].requestHash).toEqual(expect.any(String));
    expect(written.turns[0].requestParts).toEqual(expect.any(Array));
    expect(written.meta.provider).toBe('Fake');
  });
});

describe('a full bug session, offline', () => {
  it('drives hypothesis, probe, fix and verification with no API key', async () => {
    const goodEdit = {
      path: 'src/greet.js',
      changes: [{ old_string: "function greet(name) {\n  return 'Hi ' + name;", new_string: "function greet(name) {\n  return 'Hello ' + name;" }],
      reason: 'greet must say Hello',
    };
    // Keep `shout` passing by updating its expectation source too — the fix has
    // to satisfy the whole suite, not just the target.
    const shoutFix = {
      path: 'src/greet.js',
      changes: [{ old_string: 'return greet(name).toUpperCase();', new_string: "return 'HI ' + name.toUpperCase();" }],
      reason: 'keep shout stable while greet changes',
    };

    const file = cassette([
      turn([{ name: 'read_file', args: { path: 'tests/greet.test.js' } }], '[PHASE: INTAKE] reading the test'),
      turn([
        {
          name: 'record_hypotheses',
          args: {
            hypotheses: [
              { id: 'H1', summary: 'greet uses Hi', suspected_location: 'src/greet.js:2', reasoning: 'source says Hi', likelihood: 'high' },
              { id: 'H2', summary: 'test is wrong', suspected_location: 'tests/greet.test.js:5', reasoning: 'less likely', likelihood: 'low' },
            ],
          },
        },
      ]),
      turn([{ name: 'run_snippet', args: { code: "console.log(require('./src/greet').greet('Bob'))", purpose: 'observe greet' } }]),
      turn([{ name: 'confirm_hypothesis', args: { id: 'H1', method: 'snippet_probe', evidence: 'printed "Hi Bob"', confidence: 0.95 } }]),
      turn([{ name: 'edit_file', args: shoutFix }]),
      turn([{ name: 'edit_file', args: goodEdit }]),
      turn([{ name: 'run_tests', args: {} }]),
      turn([
        {
          name: 'finish_bug',
          args: {
            status: 'fixed',
            root_cause: 'greet returned the wrong prefix',
            fix_summary: 'greet now says Hello; shout no longer depends on its prefix',
            confidence: 0.95,
            confidence_rationale: 'probe reproduced it, suite verified the fix',
          },
        },
      ]),
    ]);

    const fileOps = new FileOps(dir);
    fileOps.snapshotAgentStart();

    const session = new BugSession({
      provider: new MockProvider({ cassettePath: file }),
      model: 'mock',
      projectRoot: dir,
      fileOps,
      logger: stubLogger(),
      bugNum: 1,
      target: { fullName: 'greet greets with Hello', file: 'tests/greet.test.js', message: 'Expected "Hello Bob"' },
      currentSummary: {
        passing: ['shout shouts the greeting', 'adds'],
        failing: [{ fullName: 'greet greets with Hello', file: 'tests/greet.test.js', message: 'Expected "Hello Bob"' }],
      },
      priorFixes: [],
    });

    const result = await session.run();

    expect(result.status).toBe('fixed');
    expect(result.validation.regressions).toEqual([]);
    expect(result.protocol.hypotheses).toHaveLength(2);
    expect(result.protocol.confirmations[0].methodVerifiedByHarness).toBe(true);
    expect(result.protocol.snippetProbes).toBe(1);
    expect(read(dir, 'src/greet.js')).toContain("'Hello '");
  });
});
