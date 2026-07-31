const fs = require('fs');
const path = require('path');
const { createTwoFilesPatch } = require('diff');

// Directories/files the agent must never see or touch — its own machinery.
// Compared case-insensitively: NTFS/APFS resolve `AGENT/` and `agent/` to the
// same directory, so a case-sensitive check is not a control at all.
const HIDDEN = new Set([
  'node_modules',
  '.git',
  '.buggy-baseline',
  'agent',
  'scripts',
  'agent-runs',
  'fixtures',
  'debug-log.json',
  'debug-report.md',
  'audit.md',
  '.agent-snippet.js',
  'package-lock.json',
]);

/**
 * Normalise a path for guard comparison: backslashes to slashes, `.`/`..`
 * segments collapsed, lowercased. Collapsing is what makes the guards safe to
 * call on raw model input — `src/../tests/x.js` must not read as `src/…`.
 */
function normalizeForGuard(relPath) {
  const slashed = String(relPath).replace(/\\/g, '/');
  const collapsed = path.posix.normalize(slashed).replace(/^\.\//, '').replace(/\/+$/, '');
  return collapsed.toLowerCase();
}

/** Secrets are matched by prefix so .env.local / .env.production are covered too. */
function isSecretPath(normPath) {
  return normPath.split('/').some((segment) => segment === '.env' || segment.startsWith('.env.'));
}

// Files the agent may EDIT. Tests are ground truth (read-only); package.json is config.
function isEditable(relPath) {
  const norm = normalizeForGuard(relPath);
  if (norm.startsWith('..')) return false;
  return norm === 'server.js' || norm.startsWith('src/');
}

function isVisible(relPath) {
  const norm = normalizeForGuard(relPath);
  if (norm.startsWith('..')) return false;
  if (isSecretPath(norm)) return false;
  const top = norm.split('/')[0];
  return !HIDDEN.has(top) && !HIDDEN.has(norm);
}

class FileOps {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   * @param {boolean} [options.allowTestEdits] Widen the edit allow-list to
   *   include tests/. Only the unguarded benchmark arm sets this — it is the
   *   control condition being measured, never a convenience for the real agent.
   */
  constructor(projectRoot, { allowTestEdits = false } = {}) {
    this.projectRoot = projectRoot;
    this.allowTestEdits = allowTestEdits;
    this.agentStartOriginals = new Map(); // relPath -> content at agent start
    this.sessionOriginals = new Map(); // relPath -> content at bug-session start
    this.revertStacks = new Map(); // relPath -> [contentBeforeEdit1, contentBeforeEdit2, ...]
  }

  resolve(relPath) {
    const abs = path.resolve(this.projectRoot, relPath);
    const rel = path.relative(this.projectRoot, abs).replace(/\\/g, '/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Path "${relPath}" escapes the project root — not allowed.`);
    }
    if (!isVisible(rel)) {
      throw new Error(`Path "${rel}" is outside the debuggable application (agent internals are off-limits).`);
    }
    return { abs, rel };
  }

  snapshotAgentStart() {
    this.agentStartOriginals.clear();
    for (const rel of this._editableFiles()) {
      this.agentStartOriginals.set(rel, fs.readFileSync(path.join(this.projectRoot, rel), 'utf8'));
    }
  }

  snapshotSessionStart() {
    this.sessionOriginals.clear();
    this.revertStacks.clear();
    for (const rel of this._editableFiles()) {
      this.sessionOriginals.set(rel, fs.readFileSync(path.join(this.projectRoot, rel), 'utf8'));
    }
  }

  _editableFiles() {
    const out = [];
    const roots = ['src'];
    // Tracked so that test edits are snapshotted, revertable and visible to
    // modifiedSinceSessionStart — otherwise unguarded tampering would be invisible.
    if (this.allowTestEdits) roots.push('tests');
    for (const root of roots) {
      const srcDir = path.join(this.projectRoot, root);
      if (!fs.existsSync(srcDir)) continue;
      const stack = [srcDir];
      while (stack.length) {
        const dir = stack.pop();
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) stack.push(full);
          else if (e.name.endsWith('.js'))
            out.push(path.relative(this.projectRoot, full).replace(/\\/g, '/'));
        }
      }
    }
    if (fs.existsSync(path.join(this.projectRoot, 'server.js'))) out.push('server.js');
    return out;
  }

  /** Files whose current content differs from the session-start snapshot. */
  modifiedSinceSessionStart() {
    const modified = [];
    for (const [rel, original] of this.sessionOriginals) {
      const current = fs.readFileSync(path.join(this.projectRoot, rel), 'utf8');
      if (current !== original) modified.push(rel);
    }
    return modified;
  }

  restoreSessionStart() {
    const restored = [];
    for (const rel of this.modifiedSinceSessionStart()) {
      fs.writeFileSync(path.join(this.projectRoot, rel), this.sessionOriginals.get(rel));
      restored.push(rel);
    }
    this.revertStacks.clear();
    return restored;
  }

  listFiles(directory = '.') {
    const { abs, rel } = this.resolve(directory || '.');
    if (!fs.existsSync(abs)) throw new Error(`Directory "${directory}" does not exist.`);
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) throw new Error(`"${directory}" is a file, not a directory. Use read_file.`);

    const entries = [];
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === '' || rel === '.' ? e.name : `${rel}/${e.name}`;
      if (!isVisible(childRel)) continue;
      // Deliberately no file size: it is noise for debugging, and it made tool
      // output vary with unrelated repo edits, which broke replay fixtures.
      entries.push(
        e.isDirectory() ? { name: e.name + '/', type: 'dir' } : { name: e.name, type: 'file' }
      );
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return entries;
  }

  readFile(relPath) {
    const { abs, rel } = this.resolve(relPath);
    if (!fs.existsSync(abs)) throw new Error(`File "${rel}" does not exist.`);
    if (fs.statSync(abs).isDirectory()) throw new Error(`"${rel}" is a directory. Use list_files.`);
    const content = fs.readFileSync(abs, 'utf8');
    const numbered = content
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
      .join('\n');
    return numbered;
  }

  search(query) {
    let regex;
    try {
      regex = new RegExp(query, 'i');
    } catch {
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const matches = [];
    const searchRoots = ['src', 'tests'];
    const files = [];
    for (const dir of searchRoots) {
      const abs = path.join(this.projectRoot, dir);
      if (!fs.existsSync(abs)) continue;
      const stack = [abs];
      while (stack.length) {
        const d = stack.pop();
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) stack.push(full);
          else if (/\.(js|json|md)$/.test(e.name)) files.push(full);
        }
      }
    }
    for (const f of ['server.js', 'package.json', 'README.md']) {
      const abs = path.join(this.projectRoot, f);
      if (fs.existsSync(abs)) files.push(abs);
    }

    for (const file of files) {
      const rel = path.relative(this.projectRoot, file).replace(/\\/g, '/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (regex.test(line)) {
          matches.push({ file: rel, line: i + 1, text: line.trim().slice(0, 200) });
        }
      });
      if (matches.length > 60) return { matches: matches.slice(0, 60), truncated: true };
    }
    return { matches, truncated: false };
  }

  editFile(relPath, changes, { requireEditable = true } = {}) {
    const { abs, rel } = this.resolve(relPath);
    const editable = isEditable(rel) || (this.allowTestEdits && normalizeForGuard(rel).startsWith('tests/'));
    if (requireEditable && !editable) {
      throw new Error(
        `Editing "${rel}" is not allowed. Tests define expected behavior and are read-only ground truth; ` +
          `only application source files (src/**, server.js) may be edited.`
      );
    }
    if (!fs.existsSync(abs)) throw new Error(`File "${rel}" does not exist. edit_file cannot create new files.`);
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new Error('Provide a non-empty "changes" array of {old_string, new_string} objects.');
    }

    const before = fs.readFileSync(abs, 'utf8');
    let working = before;
    for (const [i, ch] of changes.entries()) {
      if (typeof ch.old_string !== 'string' || typeof ch.new_string !== 'string') {
        throw new Error(`changes[${i}] must have string old_string and new_string.`);
      }
      const first = working.indexOf(ch.old_string);
      if (first === -1) {
        throw new Error(
          `changes[${i}]: old_string not found in ${rel}. Re-read the file and match the exact current text (including whitespace).`
        );
      }
      if (working.indexOf(ch.old_string, first + 1) !== -1) {
        throw new Error(
          `changes[${i}]: old_string appears more than once in ${rel}. Include more surrounding context to make it unique.`
        );
      }
      working = working.slice(0, first) + ch.new_string + working.slice(first + ch.old_string.length);
    }

    if (!this.revertStacks.has(rel)) this.revertStacks.set(rel, []);
    this.revertStacks.get(rel).push(before);
    fs.writeFileSync(abs, working);

    const patch = createTwoFilesPatch(rel, rel, before, working, 'before edit', 'after edit');
    return { rel, patch };
  }

  revertFile(relPath) {
    const { abs, rel } = this.resolve(relPath);
    const stack = this.revertStacks.get(rel);
    if (!stack || stack.length === 0) {
      // Fall back: if the file differs from session start (e.g. edits made before a crash), restore that.
      const sessionOriginal = this.sessionOriginals.get(rel);
      const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      if (sessionOriginal !== undefined && current !== null && current !== sessionOriginal) {
        fs.writeFileSync(abs, sessionOriginal);
        return { rel, restoredTo: 'session start (no edit stack entries remained)' };
      }
      throw new Error(`No edits to revert for "${rel}".`);
    }
    const previous = stack.pop();
    fs.writeFileSync(abs, previous);
    return { rel, restoredTo: `state before the most recent edit (${stack.length} earlier edit(s) remain)` };
  }

  diffCheck(relPath) {
    const { abs, rel } = this.resolve(relPath);
    const original = this.agentStartOriginals.get(rel);
    if (original === undefined) {
      throw new Error(`"${rel}" is not a tracked application source file (only src/** and server.js are tracked).`);
    }
    const current = fs.readFileSync(abs, 'utf8');
    if (current === original) return { rel, changed: false, patch: '(no changes since the agent started)' };
    const patch = createTwoFilesPatch(rel, rel, original, current, 'agent start', 'current');
    return { rel, changed: true, patch };
  }
}

module.exports = { FileOps, isEditable, isVisible, isSecretPath, normalizeForGuard };
