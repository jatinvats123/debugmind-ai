/**
 * Tests for the agent itself, kept separate from the demo application's suite.
 *
 * The root `npm test` asserts the demo fixture's shape (14 pass / 7 fail by
 * design); mixing agent tests into it would break that contract and confuse the
 * thing being measured with the thing doing the measuring.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/agent-tests/**/*.test.js'],
  collectCoverageFrom: [
    'agent/**/*.js',
    // pricing.json is data; index.js is the CLI wrapper, exercised end-to-end by
    // the offline replay rather than by unit tests.
    '!agent/pricing.json',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  // Workspaces are created and torn down per test; jest must not treat them as
  // test roots or watch them.
  testPathIgnorePatterns: ['/node_modules/', '/.agent-test-workspaces/', '/.bench-workspace'],
  modulePathIgnorePatterns: ['/.agent-test-workspaces/', '/.bench-workspace'],
  // Runs whether the suite passed or failed, so workspaces never accumulate.
  globalTeardown: '<rootDir>/agent-tests/helpers/teardown.js',
};
