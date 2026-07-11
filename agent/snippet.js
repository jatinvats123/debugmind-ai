const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SNIPPET_FILE = '.agent-snippet.js';

/**
 * Run a throwaway Node script in the project root — the agent's non-destructive
 * probe for testing hypotheses without editing application code.
 * The snippet can require project modules with require('./src/...').
 */
function runSnippet(projectRoot, code) {
  const snippetPath = path.join(projectRoot, SNIPPET_FILE);
  fs.writeFileSync(snippetPath, code);
  try {
    const res = spawnSync(process.execPath, [snippetPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      exitCode: res.status,
      stdout: (res.stdout || '').slice(0, 6000),
      stderr: (res.stderr || '').slice(0, 4000),
      timedOut: res.signal === 'SIGTERM' || res.error?.code === 'ETIMEDOUT',
    };
  } finally {
    try {
      fs.unlinkSync(snippetPath);
    } catch {
      /* already gone */
    }
  }
}

module.exports = { runSnippet };
