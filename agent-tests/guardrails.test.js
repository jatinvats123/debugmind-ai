/**
 * The highest-value tests in the repo.
 *
 * The project's claim is that the debugging protocol is enforced by the harness
 * rather than requested in the prompt. That is only true if it survives a
 * deliberately uncooperative agent, so these tests drive the session directly —
 * no model involved — and assert that the harness refuses.
 */
const fs = require('fs');
const path = require('path');
const { BugSession } = require('../agent/session');
const { FileOps } = require('../agent/fileOps');
const { createWorkspace, removeWorkspace, read, stubLogger } = require('./helpers/workspace');

jest.setTimeout(120000);

const TARGET = 'greet greets with Hello';
const PASSING = ['shout shouts the greeting', 'adds'];

/** A session wired to a fresh workspace, with the failing greet test as target. */
function makeSession(dir, overrides = {}) {
  const fileOps = new FileOps(dir);
  fileOps.snapshotAgentStart();
  fileOps.snapshotSessionStart();

  return new BugSession({
    provider: {},
    model: 'test',
    effort: 'high',
    projectRoot: dir,
    fileOps,
    logger: stubLogger(),
    bugNum: 1,
    target: { fullName: TARGET, file: 'tests/greet.test.js', message: 'Expected "Hello Bob"' },
    currentSummary: {
      passing: [...PASSING],
      failing: [{ fullName: TARGET, file: 'tests/greet.test.js', message: 'Expected "Hello Bob"' }],
    },
    priorFixes: [],
    maxAttempts: 4,
    ...overrides,
  });
}

const HYPOTHESES = [
  { id: 'H1', summary: 'greet uses the wrong prefix', suspected_location: 'src/greet.js:2', reasoning: 'reads Hi', likelihood: 'high' },
  { id: 'H2', summary: 'the test is wrong', suspected_location: 'tests/greet.test.js:5', reasoning: 'alternative', likelihood: 'low' },
];

/** Record hypotheses, run a probe, confirm — the legitimate route to unlocking edits. */
function unlockEditing(session) {
  session.executeTool('record_hypotheses', { hypotheses: HYPOTHESES });
  session.executeTool('run_snippet', { code: "console.log(require('./src/greet').greet('Bob'))", purpose: 'observe' });
  return session.executeTool('confirm_hypothesis', {
    id: 'H1',
    method: 'snippet_probe',
    evidence: 'probe printed "Hi Bob"',
    confidence: 0.95,
  });
}

const editGreet = (from, to) => ({
  path: 'src/greet.js',
  changes: [{ old_string: `return '${from} ' + name;`, new_string: `return '${to} ' + name;` }],
  reason: 'fix the prefix',
});

describe('guardrail: no editing before a confirmed hypothesis', () => {
  let dir;
  beforeEach(() => { dir = createWorkspace('guard-lock'); });
  afterEach(() => removeWorkspace(dir));

  it('rejects edit_file when nothing has been hypothesised', () => {
    const session = makeSession(dir);
    const result = session.executeTool('edit_file', editGreet('Hi', 'Hello'));

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/locked/i);
    expect(read(dir, 'src/greet.js')).toContain("'Hi '"); // file untouched
  });

  it('still rejects after hypotheses are recorded but none confirmed', () => {
    const session = makeSession(dir);
    session.executeTool('record_hypotheses', { hypotheses: HYPOTHESES });

    const result = session.executeTool('edit_file', editGreet('Hi', 'Hello'));
    expect(result.isError).toBe(true);
    expect(read(dir, 'src/greet.js')).toContain("'Hi '");
  });

  it('rejects a confirmation that claims a probe which never ran', () => {
    const session = makeSession(dir);
    session.executeTool('record_hypotheses', { hypotheses: HYPOTHESES });

    const confirmation = session.executeTool('confirm_hypothesis', {
      id: 'H1', method: 'snippet_probe', evidence: 'trust me', confidence: 0.99,
    });

    expect(confirmation.isError).toBe(true);
    expect(session.executeTool('edit_file', editGreet('Hi', 'Hello')).isError).toBe(true);
  });

  it('unlocks editing once a hypothesis is confirmed by a real probe', () => {
    const session = makeSession(dir);
    expect(unlockEditing(session).isError).toBeFalsy();

    const result = session.executeTool('edit_file', editGreet('Hi', 'Hello'));
    expect(result.isError).toBeFalsy();
    expect(read(dir, 'src/greet.js')).toContain("'Hello '");
  });
});

describe('guardrail: tests are read-only ground truth', () => {
  let dir;
  beforeEach(() => { dir = createWorkspace('guard-tests'); });
  afterEach(() => removeWorkspace(dir));

  it('refuses to edit a file under tests/ even with editing unlocked', () => {
    const session = makeSession(dir);
    unlockEditing(session);
    const before = read(dir, 'tests/greet.test.js');

    const result = session.executeTool('edit_file', {
      path: 'tests/greet.test.js',
      changes: [{ old_string: "toBe('Hello Bob')", new_string: "toBe('Hi Bob')" }],
      reason: 'weaken the test',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not allowed|read-only/i);
    expect(read(dir, 'tests/greet.test.js')).toBe(before);
  });

  it('refuses traversal spellings that resolve into tests/', () => {
    const session = makeSession(dir);
    unlockEditing(session);

    for (const spelling of ['src/../tests/greet.test.js', 'src/./../tests/greet.test.js']) {
      const result = session.executeTool('edit_file', {
        path: spelling,
        changes: [{ old_string: "toBe('Hello Bob')", new_string: "toBe('Hi Bob')" }],
        reason: 'sneak in',
      });
      expect(result.isError).toBe(true);
    }
    expect(read(dir, 'tests/greet.test.js')).toContain("toBe('Hello Bob')");
  });

  it('a sandboxed probe cannot write to tests/ either', () => {
    const session = makeSession(dir);
    const before = read(dir, 'tests/greet.test.js');

    const result = session.executeTool('run_snippet', {
      code: `const fs=require('fs');
             try { fs.writeFileSync('tests/greet.test.js','tampered'); console.log('WROTE'); }
             catch (e) { console.log('BLOCKED', e.code); }`,
      purpose: 'attempt to tamper',
    });

    expect(read(dir, 'tests/greet.test.js')).toBe(before);
    expect(result.text).toMatch(/BLOCKED/);
  });

  it('a probe cannot read .env or spawn a child process', () => {
    const session = makeSession(dir);

    const result = session.executeTool('run_snippet', {
      code: `const fs=require('fs');
             try { fs.readFileSync('.env','utf8'); console.log('READ_ENV'); } catch(e){ console.log('ENV_BLOCKED'); }
             try { require('child_process').execSync('echo hi'); console.log('SPAWNED'); } catch(e){ console.log('SPAWN_BLOCKED'); }`,
      purpose: 'attempt to escape',
    });

    expect(result.text).toMatch(/ENV_BLOCKED/);
    expect(result.text).toMatch(/SPAWN_BLOCKED/);
    expect(result.text).not.toMatch(/must-not-be-readable/);
  });
});

describe('guardrail: paths outside the allow-list', () => {
  let dir;
  beforeEach(() => { dir = createWorkspace('guard-paths'); });
  afterEach(() => removeWorkspace(dir));

  it.each([
    ['package.json', 'config outside the allow-list'],
    ['../escape.js', 'outside the project root'],
    ['.env', 'a secret'],
  ])('refuses to edit %s', (target) => {
    const session = makeSession(dir);
    unlockEditing(session);

    const result = session.executeTool('edit_file', {
      path: target,
      changes: [{ old_string: 'a', new_string: 'b' }],
      reason: 'should not be possible',
    });

    expect(result.isError).toBe(true);
  });

  it('refuses to read agent internals or secrets, in any casing', () => {
    const session = makeSession(dir);
    for (const target of ['.env', '.env.local', 'agent/session.js', 'AGENT/session.js']) {
      expect(session.executeTool('read_file', { path: target }).isError).toBe(true);
    }
  });
});

describe('guardrail: a regression fails the attempt and forces cleanup', () => {
  let dir;
  beforeEach(() => { dir = createWorkspace('guard-regress'); });
  afterEach(() => removeWorkspace(dir));

  it('counts the attempt, re-locks editing, and demands revert + learning', () => {
    const session = makeSession(dir);
    unlockEditing(session);

    // Fixes the target test but breaks `shout`, which builds on greet.
    session.executeTool('edit_file', editGreet('Hi', 'Hello'));
    const verdict = session.executeTool('run_tests', {});

    expect(verdict.text).toMatch(/ATTEMPT 1\/4 FAILED/);
    expect(verdict.text).toMatch(/REGRESSIONS/i);
    expect(session.attempts).toBe(1);

    // Editing is locked again until the failure is cleaned up.
    const blocked = session.executeTool('edit_file', editGreet('Hello', 'Hey'));
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toMatch(/revert_file|record_learning/);

    // Reverting alone is not enough — the learning is still required.
    session.executeTool('revert_file', { path: 'src/greet.js' });
    expect(read(dir, 'src/greet.js')).toContain("'Hi '");
    expect(session.executeTool('edit_file', editGreet('Hi', 'Hey')).isError).toBe(true);

    session.executeTool('record_learning', {
      failed_attempt_summary: 'changing the prefix broke shout',
      what_it_rules_out: 'a naive prefix swap',
      revised_thinking: 'shout must be considered too',
    });

    // Both conditions met: editing is available again.
    expect(session.executeTool('edit_file', editGreet('Hi', 'Hey')).isError).toBeFalsy();
    expect(session.learnings).toHaveLength(1);
  });

  it('rejects finish_bug("fixed") when the suite disagrees, and counts it as an attempt', () => {
    const session = makeSession(dir);
    unlockEditing(session);
    session.executeTool('edit_file', editGreet('Hi', 'Hello')); // regresses shout

    const result = session.executeTool('finish_bug', {
      status: 'fixed',
      root_cause: 'prefix',
      fix_summary: 'changed the prefix',
      confidence: 0.9,
      confidence_rationale: 'confident',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/REJECTED/);
    expect(session.attempts).toBe(1);
  });
});

describe('guardrail: exhausting the attempt budget', () => {
  let dir;
  beforeEach(() => { dir = createWorkspace('guard-budget'); });
  afterEach(() => removeWorkspace(dir));

  it('refuses early escalation, then escalates cleanly and restores the baseline', () => {
    const session = makeSession(dir, { maxAttempts: 2 });
    const pristine = read(dir, 'src/greet.js');

    // Escalation is not available while attempts remain.
    const premature = session.executeTool('finish_bug', {
      status: 'needs_human_review',
      root_cause: 'giving up early',
      fix_summary: 'no',
      confidence: 0,
      confidence_rationale: 'none',
    });
    expect(premature.isError).toBe(true);

    // Burn the budget with two regressing attempts.
    for (let i = 0; i < 2; i++) {
      if (i > 0) {
        session.executeTool('record_hypotheses', { hypotheses: HYPOTHESES });
        session.executeTool('run_snippet', { code: 'console.log(1)', purpose: 'probe' });
        session.executeTool('confirm_hypothesis', { id: 'H1', method: 'snippet_probe', evidence: 'again', confidence: 0.9 });
      } else {
        unlockEditing(session);
      }
      session.executeTool('edit_file', editGreet('Hi', i === 0 ? 'Hello' : 'Hello'));
      session.executeTool('run_tests', {});
      session.executeTool('revert_file', { path: 'src/greet.js' });
      session.executeTool('record_learning', {
        failed_attempt_summary: `attempt ${i + 1}`,
        what_it_rules_out: 'that approach',
        revised_thinking: 'try another',
      });
    }

    expect(session.attempts).toBe(2);
    expect(session.budgetExhausted).toBe(true);

    const escalation = session.executeTool('finish_bug', {
      status: 'needs_human_review',
      root_cause: 'greet and shout disagree',
      fix_summary: 'needs a human decision',
      confidence: 0,
      confidence_rationale: 'exhausted budget',
      attempts_narrative: 'tried the prefix swap twice',
    });

    expect(escalation.isError).toBeFalsy();
    expect(escalation.finish.status).toBe('needs_human_review');
    // The repository must be left exactly as it was found.
    expect(read(dir, 'src/greet.js')).toBe(pristine);
    expect(fs.readFileSync(path.join(dir, 'tests/greet.test.js'), 'utf8')).toBe(
      require('./helpers/workspace').FIXTURE['tests/greet.test.js']
    );
  });
});
