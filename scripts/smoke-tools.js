/**
 * Offline smoke test for every agent tool — no API calls.
 * Verifies the tool layer works before spending tokens on live runs.
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const { FileOps } = require('../agent/fileOps');
const { runJest, runSpecificTest, summarizeForModel } = require('../agent/testRunner');
const { getCallGraph } = require('../agent/callGraph');
const { runSnippet } = require('../agent/snippet');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name} ${detail}`);
  }
}

(async () => {
  const fo = new FileOps(root);
  fo.snapshotAgentStart();
  fo.snapshotSessionStart();

  // list_files
  const rootList = fo.listFiles('.');
  check('list_files root shows src/ and tests/', rootList.some((e) => e.name === 'src/') && rootList.some((e) => e.name === 'tests/'));
  check('list_files hides agent internals', !rootList.some((e) => ['agent/', 'scripts/', '.buggy-baseline/', 'node_modules/'].includes(e.name)));

  // read_file
  const cart = fo.readFile('src/models/cart.js');
  check('read_file returns numbered lines', /^\s+1 \| /.test(cart));

  // read guard
  let guarded = false;
  try { fo.readFile('agent/index.js'); } catch { guarded = true; }
  check('read_file blocks agent/ internals', guarded);

  // search
  const search = fo.search('unitPrice');
  check('search_codebase finds unitPrice in checkoutService', search.matches.some((m) => m.file.includes('checkoutService')), JSON.stringify(search.matches));

  // call graph
  const cg = c => getCallGraph(root, c);
  const sub = cg('calculateSubtotal');
  check('call graph finds calculateSubtotal definition', sub.found && sub.definedAt.some((d) => d.file === 'src/services/checkoutService.js'));
  check('call graph finds calculateTotals as caller', sub.callers.some((c) => c.callingFunction === 'calculateTotals'));
  const reserve = cg('reserveStock');
  check('call graph: reserveStock called from checkout', reserve.callers.some((c) => c.callingFunction === 'checkout'));
  const missing = cg('calcSubtotal');
  check('call graph suggests near-matches for unknown names', missing.found === false && missing.didYouMean.includes('calculateSubtotal'), JSON.stringify(missing.didYouMean));

  // snippet
  const probe = runSnippet(root, `
    const { calculateSubtotal } = require('./src/services/checkoutService');
    console.log('RESULT:', calculateSubtotal([{ price: 10, quantity: 2 }]));
  `);
  check('run_snippet exposes the NaN symptom', probe.stdout.includes('RESULT: NaN'), probe.stdout + probe.stderr);

  // edit + diff + revert roundtrip
  const before = fs.readFileSync(path.join(root, 'src/data/coupons.js'), 'utf8');
  const edit = fo.editFile('src/data/coupons.js', [{ old_string: 'SAVE10', new_string: 'SAVE10X' }]);
  check('edit_file produces a patch', edit.patch.includes('-  { code: \'SAVE10\''));
  const diff = fo.diffCheck('src/data/coupons.js');
  check('diff_check reports the change', diff.changed === true);
  check('modifiedSinceSessionStart tracks the file', fo.modifiedSinceSessionStart().includes('src/data/coupons.js'));
  fo.revertFile('src/data/coupons.js');
  check('revert_file restores content', fs.readFileSync(path.join(root, 'src/data/coupons.js'), 'utf8') === before);
  check('after revert nothing is modified', fo.modifiedSinceSessionStart().length === 0);

  // edit guards
  let testGuard = false;
  try { fo.editFile('tests/cart.test.js', [{ old_string: 'x', new_string: 'y' }]); } catch { testGuard = true; }
  check('edit_file blocks tests/', testGuard);
  let uniqueGuard = false;
  try { fo.editFile('src/models/cart.js', [{ old_string: 'productId', new_string: 'x' }]); } catch (e) { uniqueGuard = e.message.includes('more than once'); }
  check('edit_file rejects ambiguous old_string', uniqueGuard);

  // test runner
  console.log('  … running full jest suite (once)');
  const suite = runJest(root);
  check('run_tests parses jest JSON', !suite.error, suite.error);
  check('baseline is 14 passed / 7 failed', suite.numPassedTests === 14 && suite.numFailedTests === 7, `got ${suite.numPassedTests}/${suite.numFailedTests}`);
  check('failing entries carry messages', suite.failing.every((f) => f.message && f.message.length > 10));
  check('summarizeForModel emits readable text', summarizeForModel(suite).includes('FAILING TESTS'));

  console.log('  … running one isolated test');
  const single = runSpecificTest(root, 'rejects checkout when the cart is empty');
  check('run_specific_test isolates one test', !single.error && single.numTotalTests >= 1 && single.numFailedTests === 0, JSON.stringify({ total: single.numTotalTests, failed: single.numFailedTests }));

  console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
