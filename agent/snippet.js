const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SNIPPET_FILE = '.agent-snippet.js';
const DEFAULT_TIMEOUT_MS = 30000;

// Node's permission model (stable flag from v22) is what actually sandboxes the
// probe. Without it we fall back to integrity checking alone and say so loudly.
const NODE_MAJOR = parseInt(process.versions.node.split('.')[0], 10);
const SUPPORTS_PERMISSION_MODEL = NODE_MAJOR >= 22;

/** Paths a probe legitimately needs to read: app source, its deps, and the test files. */
function readAllowList(projectRoot, snippetPath) {
  return [
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'tests'),
    path.join(projectRoot, 'node_modules'),
    path.join(projectRoot, 'package.json'),
    path.join(projectRoot, 'server.js'),
    snippetPath,
  ].filter((p) => p === snippetPath || fs.existsSync(p));
}

/**
 * Environment for the child. The API key is stripped: a probe has no business
 * calling the model provider, and the permission model does not gate network
 * access, so scrubbing the credential is the control that prevents exfiltration.
 */
function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/API_KEY|AUTH_TOKEN|SECRET|CREDENTIAL|PASSWORD/i.test(key)) delete env[key];
  }
  return env;
}

/** Content hash of every file under a directory — used to prove nothing was tampered with. */
function hashTree(root) {
  if (!fs.existsSync(root)) return 'absent';
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        hash.update(path.relative(root, full).replace(/\\/g, '/'));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

/** Files whose integrity must hold across a probe: the ground-truth suite and its config. */
function integritySnapshot(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  return {
    tests: hashTree(path.join(projectRoot, 'tests')),
    packageJson: fs.existsSync(pkgPath)
      ? crypto.createHash('sha256').update(fs.readFileSync(pkgPath)).digest('hex')
      : 'absent',
  };
}

/**
 * Run a throwaway Node script — the agent's non-destructive probe for testing a
 * hypothesis without editing application code.
 *
 * Three layers of containment, because this tool is the one place model-authored
 * code executes:
 *   1. Node permission model: read access limited to src/, tests/, node_modules
 *      and package.json; NO write access anywhere; no child processes; no workers.
 *   2. Credential scrubbing: API keys removed from the child environment.
 *   3. Integrity verification: tests/ and package.json are hashed before and
 *      after; a mismatch is reported to the caller as a tamper event.
 */
function runSnippet(projectRoot, code, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const snippetPath = path.join(projectRoot, SNIPPET_FILE);
  const before = integritySnapshot(projectRoot);
  fs.writeFileSync(snippetPath, code);

  const args = [];
  if (SUPPORTS_PERMISSION_MODEL) {
    args.push('--permission');
    for (const allowed of readAllowList(projectRoot, snippetPath)) {
      args.push(`--allow-fs-read=${allowed}`);
    }
  }
  args.push(snippetPath);

  try {
    const res = spawnSync(process.execPath, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: childEnv(),
    });

    const after = integritySnapshot(projectRoot);
    const tampered = before.tests !== after.tests || before.packageJson !== after.packageJson;

    return {
      exitCode: res.status,
      stdout: (res.stdout || '').slice(0, 6000),
      stderr: (res.stderr || '').slice(0, 4000),
      timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
      sandboxed: SUPPORTS_PERMISSION_MODEL,
      tampered,
      tamperDetail: tampered
        ? `probe modified protected files (tests hash ${before.tests.slice(0, 12)} -> ${after.tests.slice(0, 12)}, package.json ${before.packageJson.slice(0, 12)} -> ${after.packageJson.slice(0, 12)})`
        : null,
    };
  } finally {
    try {
      fs.unlinkSync(snippetPath);
    } catch {
      /* already gone */
    }
  }
}

module.exports = { runSnippet, SUPPORTS_PERMISSION_MODEL, integritySnapshot, hashTree };
