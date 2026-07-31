#!/usr/bin/env node
/**
 * Fixture validation — run this before trusting any benchmark number.
 *
 * Checks, for every fixture:
 *   1. The pristine app is fully green (otherwise "failing" means nothing).
 *   2. The patch still applies (fixtures drift as the app evolves).
 *   3. Injecting the bug fails EXACTLY the tests the fixture claims, no more
 *      and no fewer. An unexpected extra failure means the fixture is dirtier
 *      than documented; a missing one means the test suite does not actually
 *      catch the bug and the fixture is untestable.
 *
 * Requires no API key: this is pure fixture hygiene.
 */
const path = require('path');
const { loadFixtures, createWorkspace, destroyWorkspace, applyFixture } = require('./fixtures');
const { runJest } = require('../agent/testRunner');

const WORKSPACE = path.join(__dirname, '..', '.bench-workspace-validate');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', gray: '\x1b[90m', bold: '\x1b[1m',
};

function diff(expected, actual) {
  const exp = new Set(expected);
  const act = new Set(actual);
  return {
    missing: [...exp].filter((t) => !act.has(t)),
    unexpected: [...act].filter((t) => !exp.has(t)),
  };
}

function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const fixtures = loadFixtures({ only });
  let failures = 0;

  console.log(`${C.bold}Validating ${fixtures.length} fixture(s)${C.reset}\n`);

  // 1. Baseline must be green.
  createWorkspace(WORKSPACE);
  const baseline = runJest(WORKSPACE);
  if (baseline.error) {
    console.error(`${C.red}Baseline test run failed to execute: ${baseline.error}${C.reset}`);
    process.exit(1);
  }
  if (baseline.numFailedTests > 0) {
    console.error(
      `${C.red}✗ Pristine app is NOT green: ${baseline.numFailedTests} failing.${C.reset}\n` +
        baseline.failing.map((f) => `    ${f.fullName}`).join('\n')
    );
    destroyWorkspace(WORKSPACE);
    process.exit(1);
  }
  console.log(`${C.green}✓ baseline green: ${baseline.numPassedTests} tests pass${C.reset}\n`);
  const baselinePassing = new Set(baseline.passing);

  // 2 + 3. Each fixture applies and fails exactly what it claims.
  for (const fixture of fixtures) {
    createWorkspace(WORKSPACE);
    try {
      applyFixture(WORKSPACE, fixture);
    } catch (e) {
      console.log(`${C.red}✗ ${fixture.id}${C.reset}\n    ${e.message}`);
      failures++;
      continue;
    }

    const result = runJest(WORKSPACE);
    if (result.error) {
      console.log(`${C.red}✗ ${fixture.id}${C.reset}\n    test run failed: ${result.error}`);
      failures++;
      continue;
    }

    const actualFailing = result.failing.map((f) => f.fullName);
    const { missing, unexpected } = diff(fixture.expectedFailing, actualFailing);

    // A fixture must not break tests outside the app's own suite shape.
    const brokeUnrelated = unexpected.filter((t) => baselinePassing.has(t));

    if (missing.length === 0 && unexpected.length === 0) {
      console.log(
        `${C.green}✓${C.reset} ${fixture.id} ${C.gray}[${fixture.category}/${fixture.difficulty}] ` +
          `→ ${actualFailing.length} failing, as declared${C.reset}`
      );
    } else {
      failures++;
      console.log(`${C.red}✗${C.reset} ${fixture.id} ${C.gray}[${fixture.category}]${C.reset}`);
      if (missing.length) {
        console.log(`    ${C.yellow}declared failing but actually passed:${C.reset}`);
        missing.forEach((t) => console.log(`      - ${t}`));
      }
      if (unexpected.length) {
        console.log(`    ${C.yellow}failed but not declared:${C.reset}`);
        unexpected.forEach((t) => console.log(`      + ${t}${brokeUnrelated.includes(t) ? ' (was passing on baseline)' : ''}`));
      }
    }
  }

  destroyWorkspace(WORKSPACE);

  console.log();
  if (failures === 0) {
    console.log(`${C.green}${C.bold}All ${fixtures.length} fixtures valid.${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}${C.bold}${failures} fixture(s) invalid — fix these before benchmarking.${C.reset}`);
  process.exit(1);
}

main();
