/**
 * Fixture loading, workspace construction, and bug injection.
 *
 * Every benchmark run happens in a disposable workspace copied from
 * benchmark/app, never in the repository's own src/. That isolation means a
 * benchmark run can never corrupt the demo application or the Phase 1 replay
 * cassette, and a crashed run leaves nothing to clean up by hand.
 */
const fs = require('fs');
const path = require('path');

const BENCH_DIR = __dirname;
const APP_DIR = path.join(BENCH_DIR, 'app');
const BUGS_DIR = path.join(BENCH_DIR, 'bugs');
const REPO_ROOT = path.resolve(BENCH_DIR, '..');

/** Load every fixture definition, in id order. */
function loadFixtures({ only = null } = {}) {
  const files = fs
    .readdirSync(BUGS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
  const fixtures = files.map((f) => {
    const fixture = require(path.join(BUGS_DIR, f));
    fixture._file = `benchmark/bugs/${f}`;
    return fixture;
  });

  validateShape(fixtures);
  if (!only || only.length === 0) return fixtures;
  const wanted = new Set(only);
  return fixtures.filter((f) => wanted.has(f.id) || wanted.has(f.category));
}

function validateShape(fixtures) {
  const seen = new Set();
  for (const f of fixtures) {
    for (const key of ['id', 'category', 'difficulty', 'description', 'expectedResolution']) {
      if (!f[key]) throw new Error(`${f._file}: missing required field "${key}"`);
    }
    if (seen.has(f.id)) throw new Error(`duplicate fixture id: ${f.id}`);
    seen.add(f.id);
    if (!['fixed', 'needs_human_review'].includes(f.expectedResolution)) {
      throw new Error(`${f._file}: expectedResolution must be "fixed" or "needs_human_review"`);
    }
    if (!Array.isArray(f.expectedFailing) || f.expectedFailing.length === 0) {
      throw new Error(`${f._file}: expectedFailing must list at least one test name`);
    }
  }
}

/**
 * Create a clean workspace containing the pristine app.
 *
 * The workspace lives inside the repo so Node still resolves jest and express
 * from the repository's node_modules, which keeps each run cheap — no install
 * per fixture.
 */
function createWorkspace(workspaceDir) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.cpSync(path.join(APP_DIR, 'src'), path.join(workspaceDir, 'src'), { recursive: true });
  fs.cpSync(path.join(APP_DIR, 'tests'), path.join(workspaceDir, 'tests'), { recursive: true });

  // Minimal manifest so jest treats the workspace as the project root.
  fs.writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'benchmark-workspace',
        version: '1.0.0',
        private: true,
        scripts: { test: 'jest' },
        jest: { testEnvironment: 'node' },
      },
      null,
      2
    )
  );
  return workspaceDir;
}

function destroyWorkspace(workspaceDir) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

/** Inject a fixture's bug into an existing workspace. */
function applyFixture(workspaceDir, fixture) {
  for (const edit of fixture.edits || []) {
    const target = path.join(workspaceDir, edit.file);
    if (!fs.existsSync(target)) {
      throw new Error(`${fixture.id}: edit target ${edit.file} does not exist in the workspace`);
    }
    const before = fs.readFileSync(target, 'utf8');
    const occurrences = before.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `${fixture.id}: patch did not apply — "find" text not present in ${edit.file}. ` +
          'The fixture has drifted from benchmark/app and must be updated.'
      );
    }
    if (occurrences > 1) {
      throw new Error(`${fixture.id}: "find" text is ambiguous in ${edit.file} (${occurrences} matches)`);
    }
    fs.writeFileSync(target, before.replace(edit.find, edit.replace));
  }

  for (const added of fixture.addFiles || []) {
    const target = path.join(workspaceDir, added.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, added.content);
  }
}

module.exports = {
  loadFixtures,
  createWorkspace,
  destroyWorkspace,
  applyFixture,
  APP_DIR,
  BUGS_DIR,
  REPO_ROOT,
};
