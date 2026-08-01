/**
 * Disposable project workspaces for agent tests.
 *
 * Agent tests must never touch the repo's own src/ or tests/ — the tools under
 * test write files, revert them, and run jest. Each test gets its own throwaway
 * project instead.
 *
 * Workspaces live inside the repo (not os.tmpdir) so Node's upward module
 * resolution finds the repo's node_modules, which is how the test runner locates
 * jest when it executes inside the workspace.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.join(REPO_ROOT, '.agent-test-workspaces');

/**
 * A deliberately tiny app with a built-in regression trap.
 *
 * `shout` is built on `greet`, so the obvious fix for the failing greet test
 * ("Hi " -> "Hello ") breaks the passing shout test. That gives guardrail tests
 * a realistic way to produce a regression on demand.
 */
const FIXTURE = {
  'package.json': JSON.stringify(
    { name: 'agent-test-fixture', version: '1.0.0', jest: { testEnvironment: 'node' } },
    null,
    2
  ),
  'src/greet.js': `function greet(name) {
  return 'Hi ' + name;
}

function shout(name) {
  return greet(name).toUpperCase();
}

module.exports = { greet, shout };
`,
  'src/math.js': `function add(a, b) {
  return a + b;
}

module.exports = { add };
`,
  'tests/greet.test.js': `const { greet, shout } = require('../src/greet');

describe('greet', () => {
  it('greets with Hello', () => {
    expect(greet('Bob')).toBe('Hello Bob');
  });
});

describe('shout', () => {
  it('shouts the greeting', () => {
    expect(shout('Bob')).toBe('HI BOB');
  });
});
`,
  'tests/math.test.js': `const { add } = require('../src/math');

it('adds', () => {
  expect(add(1, 2)).toBe(3);
});
`,
  'server.js': `module.exports = 'server';\n`,
  '.env': 'SECRET_TOKEN=must-not-be-readable\n',
};

/** Create a workspace and return its absolute path. */
function createWorkspace(label = 'ws') {
  fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(WORKSPACE_ROOT, `${label}-`));
  for (const [rel, content] of Object.entries(FIXTURE)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

function removeWorkspace(dir) {
  if (dir && dir.startsWith(WORKSPACE_ROOT)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function cleanAll() {
  fs.rmSync(WORKSPACE_ROOT, { recursive: true, force: true });
}

const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const write = (dir, rel, content) => fs.writeFileSync(path.join(dir, rel), content);

/** Logger stub: records events, prints nothing. */
function stubLogger() {
  const events = [];
  const handler = {
    get(target, prop) {
      if (prop === 'events') return events;
      if (prop === 'structure') return { usage: {}, events };
      if (prop in target) return target[prop];
      return (...args) => {
        events.push({ method: String(prop), args });
      };
    },
  };
  return new Proxy({}, handler);
}

module.exports = {
  REPO_ROOT,
  WORKSPACE_ROOT,
  createWorkspace,
  removeWorkspace,
  cleanAll,
  read,
  write,
  stubLogger,
  FIXTURE,
  tmpdir: os.tmpdir,
};
