/** Unit tests for the mechanical tool layer: files, probes, tests, call graph. */
const fs = require('fs');
const path = require('path');
const { FileOps, isEditable, isVisible, isSecretPath } = require('../agent/fileOps');
const { runSnippet, integritySnapshot } = require('../agent/snippet');
const { runJest, runSpecificTest, summarizeForModel } = require('../agent/testRunner');
const { getCallGraph } = require('../agent/callGraph');
const { createWorkspace, removeWorkspace, read } = require('./helpers/workspace');

jest.setTimeout(120000);

let dir;
let fo;
beforeEach(() => {
  dir = createWorkspace('tools');
  fo = new FileOps(dir);
  fo.snapshotAgentStart();
  fo.snapshotSessionStart();
});
afterEach(() => removeWorkspace(dir));

describe('path guards', () => {
  it.each([
    ['src/app.js', true],
    ['server.js', true],
    ['SRC/app.js', true],
    ['tests/x.test.js', false],
    ['src/../tests/x.js', false],
    ['package.json', false],
    ['../outside.js', false],
  ])('isEditable(%s) === %s', (p, expected) => {
    expect(isEditable(p)).toBe(expected);
  });

  it.each(['.env', '.env.local', '.env.production', 'nested/.env.test'])('treats %s as a secret', (p) => {
    expect(isSecretPath(p.toLowerCase())).toBe(true);
    expect(isVisible(p)).toBe(false);
  });

  it.each(['agent/session.js', 'AGENT/session.js', 'Agent/Session.js', 'node_modules/x', '.git/config'])(
    'hides %s from the agent',
    (p) => {
      expect(isVisible(p)).toBe(false);
    }
  );
});

describe('read_file / list_files / search_codebase', () => {
  it('returns file contents with line numbers', () => {
    const out = fo.readFile('src/greet.js');
    expect(out).toMatch(/^\s+1 \| function greet/);
  });

  it('rejects a missing file with a useful message', () => {
    expect(() => fo.readFile('src/nope.js')).toThrow(/does not exist/);
  });

  it('rejects reading a directory', () => {
    expect(() => fo.readFile('src')).toThrow(/directory/i);
  });

  it('lists entries without leaking sizes (kept deterministic for replay fixtures)', () => {
    const entries = fo.listFiles('.');
    expect(entries.some((e) => e.name === 'src/')).toBe(true);
    expect(entries.every((e) => e.size === undefined)).toBe(true);
    expect(entries.some((e) => e.name === '.env')).toBe(false);
  });

  it('searches across src and tests with file:line results', () => {
    const { matches } = fo.search('toUpperCase');
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe('src/greet.js');
    expect(matches[0].line).toBeGreaterThan(0);
  });

  it('falls back to a literal search when the query is not valid regex', () => {
    expect(() => fo.search('greet(')).not.toThrow();
  });
});

describe('edit_file / revert_file / diff_check', () => {
  it('applies a unique replacement and reports a patch', () => {
    const { patch } = fo.editFile('src/greet.js', [{ old_string: "'Hi '", new_string: "'Hello '" }]);
    expect(read(dir, 'src/greet.js')).toContain("'Hello '");
    expect(patch).toMatch(/-.*'Hi '/);
    expect(patch).toMatch(/\+.*'Hello '/);
  });

  it('refuses an old_string that appears more than once', () => {
    expect(() => fo.editFile('src/greet.js', [{ old_string: 'name', new_string: 'x' }])).toThrow(/more than once/);
  });

  it('refuses an old_string that is absent', () => {
    expect(() => fo.editFile('src/greet.js', [{ old_string: 'nonexistent', new_string: 'x' }])).toThrow(/not found/);
  });

  it('refuses to create new files', () => {
    expect(() => fo.editFile('src/new.js', [{ old_string: 'a', new_string: 'b' }])).toThrow(/does not exist/);
  });

  it('reverts edits one step at a time', () => {
    const original = read(dir, 'src/greet.js');
    fo.editFile('src/greet.js', [{ old_string: "'Hi '", new_string: "'Hello '" }]);
    fo.editFile('src/greet.js', [{ old_string: "'Hello '", new_string: "'Hey '" }]);

    fo.revertFile('src/greet.js');
    expect(read(dir, 'src/greet.js')).toContain("'Hello '");

    fo.revertFile('src/greet.js');
    expect(read(dir, 'src/greet.js')).toBe(original);
  });

  it('throws when there is nothing to revert', () => {
    expect(() => fo.revertFile('src/greet.js')).toThrow(/No edits to revert/);
  });

  it('tracks modification against the session snapshot', () => {
    expect(fo.modifiedSinceSessionStart()).toHaveLength(0);
    fo.editFile('src/greet.js', [{ old_string: "'Hi '", new_string: "'Hello '" }]);
    expect(fo.modifiedSinceSessionStart()).toEqual(['src/greet.js']);
    fo.restoreSessionStart();
    expect(fo.modifiedSinceSessionStart()).toHaveLength(0);
  });

  it('diff_check reports changes since the agent started', () => {
    expect(fo.diffCheck('src/greet.js').changed).toBe(false);
    fo.editFile('src/greet.js', [{ old_string: "'Hi '", new_string: "'Hello '" }]);
    const diff = fo.diffCheck('src/greet.js');
    expect(diff.changed).toBe(true);
    expect(diff.patch).toMatch(/Hello/);
  });
});

describe('run_snippet (probe execution)', () => {
  it('runs project code and captures stdout', () => {
    const res = runSnippet(dir, "console.log('value:', require('./src/math').add(2,3))");
    expect(res.stdout).toMatch(/value: 5/);
    expect(res.exitCode).toBe(0);
    expect(res.tampered).toBe(false);
  });

  it('reports a non-zero exit and stderr without throwing', () => {
    const res = runSnippet(dir, "throw new Error('probe blew up')");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/probe blew up/);
  });

  it('scrubs credentials from the child environment', () => {
    process.env.GEMINI_API_KEY = 'AIza-should-not-reach-the-probe';
    try {
      const res = runSnippet(dir, "console.log('key:', process.env.GEMINI_API_KEY || 'absent')");
      expect(res.stdout).toMatch(/key: absent/);
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it('detects tampering with protected files', () => {
    const before = integritySnapshot(dir);
    fs.appendFileSync(path.join(dir, 'tests/math.test.js'), '\n// touched\n');
    expect(integritySnapshot(dir).tests).not.toBe(before.tests);
  });
});

describe('run_tests / run_specific_test', () => {
  it('parses results and reports the failing test with its message', () => {
    const summary = runJest(dir);
    expect(summary.error).toBeUndefined();
    expect(summary.numFailedTests).toBe(1);
    expect(summary.failing[0].fullName).toBe('greet greets with Hello');
    expect(summary.failing[0].message).toMatch(/Hello Bob/);
    expect(summary.passing).toContain('adds');
  });

  it('sorts results deterministically across runs', () => {
    const a = runJest(dir).passing;
    const b = runJest(dir).passing;
    expect(a).toEqual(b);
    expect([...a]).toEqual([...a].sort());
  });

  it('isolates a single test by name', () => {
    const summary = runSpecificTest(dir, 'adds');
    // `jest -t` still reports every test in the matched files, marking the
    // non-matching ones skipped — so the meaningful assertion is which tests
    // actually executed, not the reported total.
    expect(summary.passing).toEqual(['adds']);
    expect(summary.numFailedTests).toBe(0);
  });

  it('summarises for the model with failure detail', () => {
    const text = summarizeForModel(runJest(dir));
    expect(text).toMatch(/FAILING TESTS/);
    expect(text).toMatch(/greets with Hello/);
  });
});

describe('get_call_graph', () => {
  it('finds callers and callees across the project', () => {
    const graph = getCallGraph(dir, 'greet');
    expect(graph.found).toBe(true);
    expect(graph.definedAt.some((d) => d.file === 'src/greet.js')).toBe(true);
    expect(graph.callers.some((c) => c.callingFunction === 'shout')).toBe(true);
  });

  it('suggests near matches for an unknown name', () => {
    const graph = getCallGraph(dir, 'gret');
    expect(graph.found).toBe(false);
    expect(graph.didYouMean).toContain('greet');
  });
});
