/**
 * Global teardown: sweep the workspace root.
 *
 * Each test removes its own workspace, but a test that throws before its
 * afterEach — or a file still held open on Windows — can leave one behind. This
 * guarantees the directory never accumulates across runs regardless of outcome.
 */
const { cleanAll } = require('./workspace');

module.exports = async () => {
  try {
    cleanAll();
  } catch {
    /* a locked file is not worth failing the run over */
  }
};
