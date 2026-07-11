#!/usr/bin/env node
/**
 * Autonomous debugging agent — CLI entry point.
 *
 * Usage:
 *   node agent/index.js [--restore] [--target "<test name substring>"]
 *                       [--model <model-id>] [--effort low|medium|high|xhigh|max]
 *                       [--max-attempts N]
 *
 * Requires GEMINI_API_KEY (env var or .env file at the project root).
 */
const fs = require('fs');
const path = require('path');
const { GeminiClient } = require('./llm');
const { Orchestrator } = require('./orchestrator');
const { Logger } = require('./logger');

const projectRoot = path.resolve(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function parseArgs(argv) {
  const args = { restore: false, target: null, model: null, effort: null, maxAttempts: 4 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--restore':
        args.restore = true;
        break;
      case '--target':
        args.target = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--effort':
        args.effort = argv[++i];
        break;
      case '--max-attempts':
        args.maxAttempts = parseInt(argv[++i], 10) || 4;
        break;
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        process.exit(1);
    }
  }
  return args;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (args.restore) {
    require(path.join(projectRoot, 'scripts', 'restore-bugs.js'));
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error(
      'No API credentials found. Set GEMINI_API_KEY in the environment or in a .env file at the project root.'
    );
    process.exit(1);
  }

  // Default chosen empirically: free-tier keys have no quota for 2.5-pro (limit 0)
  // and only 20 req/day for gemini-3-flash; 3.1-flash-lite completes a full run.
  const model = args.model || process.env.AGENT_MODEL || 'gemini-3.1-flash-lite';
  const effort = args.effort || process.env.AGENT_EFFORT || 'high';

  const client = new GeminiClient({ apiKey, model, effort });
  const logger = new Logger(projectRoot);
  client.onRetry = (msg) => logger.harness(msg);

  try {
    await client.preflight();
  } catch (e) {
    console.error(`Pre-flight call to ${model} failed: ${e.message}`);
    try {
      const models = (await client.listModels()).filter((m) => m.startsWith('gemini')).slice(0, 20);
      console.error(`Models available to this key include:\n  ${models.join('\n  ')}`);
    } catch {
      /* listing also failed — key is likely invalid */
    }
    process.exit(1);
  }

  const orchestrator = new Orchestrator({
    client,
    model,
    effort,
    projectRoot,
    logger,
    maxAttempts: args.maxAttempts,
    targetFilter: args.target,
  });

  try {
    await orchestrator.run();
  } catch (e) {
    console.error(`\nFATAL: ${e.message}`);
    logger.event('fatal_error', { error: e.message, stack: e.stack });
    process.exit(1);
  }
}

main();
