/**
 * Run manifest — everything needed to explain, compare, or reproduce a run.
 *
 * Benchmark numbers are only defensible if you can say exactly what produced
 * them. The manifest pins that down: resolved model version (not just the
 * alias), sampling parameters, and content hashes of the system prompt and tool
 * schemas, so a changed prompt can never be mistaken for a changed model.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function gitInfo(projectRoot) {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return {
    commit: run(['rev-parse', 'HEAD']),
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: run(['status', '--porcelain']) ? true : false,
  };
}

async function buildManifest({ projectRoot, provider, systemPrompt, toolDefs, config, baseline }) {
  let resolvedModel = null;
  if (typeof provider.resolveModelVersion === 'function') {
    resolvedModel = await provider.resolveModelVersion();
  }

  return {
    schemaVersion: 1,
    runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`,
    startedAt: new Date().toISOString(),
    agentVersion: readPackageVersion(projectRoot),
    provider: provider.describe(),
    // The alias (e.g. gemini-3.1-flash-lite) can silently move; the resolved
    // version is what actually served the run.
    resolvedModel,
    determinism: {
      temperature: provider.temperature,
      note:
        provider.temperature === 0
          ? 'temperature=0 reduces but does not eliminate variance; provider-side sampling and model updates still apply'
          : 'temperature > 0 — runs are explicitly non-deterministic',
    },
    hashes: {
      systemPrompt: sha256(systemPrompt),
      toolSchemas: sha256(JSON.stringify(toolDefs)),
      appSource: hashSourceTree(projectRoot),
    },
    config,
    runtime: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    git: gitInfo(projectRoot),
    baseline,
  };
}

function readPackageVersion(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

/** Hash of the application source under test, so a run is tied to the code it debugged. */
function hashSourceTree(projectRoot) {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        hash.update(path.relative(projectRoot, full).replace(/\\/g, '/'));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(path.join(projectRoot, 'src'));
  const serverJs = path.join(projectRoot, 'server.js');
  if (fs.existsSync(serverJs)) hash.update(fs.readFileSync(serverJs));
  return hash.digest('hex');
}

module.exports = { buildManifest, sha256, hashSourceTree };
