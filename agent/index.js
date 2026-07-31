#!/usr/bin/env node
/**
 * Autonomous debugging agent — CLI entry point.
 *
 * Usage:
 *   node agent/index.js [options]
 *
 *   --restore                 restore the buggy baseline before running
 *   --unguarded               DISABLE the guardrails (benchmark control arm only)
 *   --provider gemini|mock    backend (default gemini; mock needs no API key)
 *   --cassette <path>         cassette to replay (mock) or record into
 *   --record                  record this run's provider turns to --cassette
 *   --model <id>              model id (default gemini-3.1-flash-lite)
 *   --temperature <n>         sampling temperature (default 0)
 *   --effort low|medium|high|xhigh
 *   --max-attempts <n>        failed fix attempts per bug (default 4)
 *   --max-bugs <n>            bug sessions per run (default 6)
 *   --target "<substring>"    only debug tests matching this substring
 *   --max-tokens <n>          abort once total tokens exceed this
 *   --max-cost <usd>          abort once estimated cost exceeds this
 *   --max-minutes <n>         abort once wall-clock exceeds this
 *   --max-api-calls <n>       abort after this many provider calls
 *
 * Requires GEMINI_API_KEY (env or .env file) unless --provider mock.
 */
const fs = require('fs');
const path = require('path');
const { createProvider } = require('./providers');
const { Orchestrator } = require('./orchestrator');
const { Logger } = require('./logger');
const { Budget } = require('./budget');

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

const FLAGS = {
  '--restore': (a) => (a.restore = true),
  '--unguarded': (a) => (a.guarded = false),
  '--record': (a) => (a.record = true),
  '--provider': (a, v) => (a.provider = v),
  '--cassette': (a, v) => (a.cassette = v),
  '--target': (a, v) => (a.target = v),
  '--model': (a, v) => (a.model = v),
  '--effort': (a, v) => (a.effort = v),
  '--temperature': (a, v) => (a.temperature = parseFloat(v)),
  '--max-attempts': (a, v) => (a.maxAttempts = parseInt(v, 10)),
  '--max-bugs': (a, v) => (a.maxBugs = parseInt(v, 10)),
  '--max-tokens': (a, v) => (a.maxTokens = parseInt(v, 10)),
  '--max-cost': (a, v) => (a.maxCostUsd = parseFloat(v)),
  '--max-minutes': (a, v) => (a.maxMinutes = parseFloat(v)),
  '--max-api-calls': (a, v) => (a.maxApiCalls = parseInt(v, 10)),
};

function parseArgs(argv) {
  const args = {
    restore: false,
    record: false,
    guarded: true,
    provider: process.env.AGENT_PROVIDER || 'gemini',
    cassette: null,
    target: null,
    model: null,
    effort: null,
    temperature: 0,
    maxAttempts: 4,
    maxBugs: 6,
    maxTokens: null,
    maxCostUsd: null,
    maxMinutes: null,
    maxApiCalls: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, '').replace(/\/\*\*|\s\*\s?/g, ''));
      process.exit(0);
    }
    const handler = FLAGS[flag];
    if (!handler) {
      console.error(`Unknown argument: ${flag}\nRun with --help for usage.`);
      process.exit(1);
    }
    handler(args, handler.length > 1 ? argv[++i] : undefined);
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
  if (args.provider === 'gemini' && !apiKey) {
    console.error(
      'No API credentials found. Set GEMINI_API_KEY in the environment or in a .env file at the project root,\n' +
        'or run offline against a recorded cassette: --provider mock --cassette fixtures/<name>.cassette.json'
    );
    process.exit(1);
  }
  if (args.provider === 'mock' && !args.cassette) {
    console.error('--provider mock requires --cassette <path to .cassette.json>');
    process.exit(1);
  }

  const model = args.model || process.env.AGENT_MODEL || 'gemini-3.1-flash-lite';
  const effort = args.effort || process.env.AGENT_EFFORT || 'high';

  const logger = new Logger(projectRoot);
  const provider = createProvider({
    provider: args.provider,
    apiKey,
    model,
    temperature: args.temperature,
    effort,
    cassettePath: args.cassette,
    record: args.record,
  });
  provider.onRetry = (msg) => logger.harness(msg);

  try {
    await provider.preflight();
  } catch (e) {
    console.error(`Pre-flight failed for ${args.provider}/${model}: ${e.message}`);
    if (args.provider === 'gemini' && typeof provider.listModels === 'function') {
      try {
        const models = (await provider.listModels()).filter((m) => m.startsWith('gemini')).slice(0, 20);
        console.error(`Models available to this key include:\n  ${models.join('\n  ')}`);
      } catch {
        /* listing also failed — key is likely invalid */
      }
    }
    process.exit(1);
  }

  const budget = new Budget({
    projectRoot,
    model,
    maxTokens: args.maxTokens,
    maxCostUsd: args.maxCostUsd,
    maxWallClockMs: args.maxMinutes != null ? args.maxMinutes * 60000 : null,
    maxApiCalls: args.maxApiCalls,
  });

  const orchestrator = new Orchestrator({
    provider,
    model,
    effort,
    projectRoot,
    logger,
    maxAttempts: args.maxAttempts,
    targetFilter: args.target,
    guarded: args.guarded,
    budget,
    maxBugSessions: args.maxBugs,
  });

  try {
    await orchestrator.run();
    if (typeof provider.flush === 'function') provider.flush();
  } catch (e) {
    console.error(`\nFATAL: ${e.message}`);
    logger.event('fatal_error', { error: e.message, stack: e.stack });
    process.exit(1);
  }
}

main();
