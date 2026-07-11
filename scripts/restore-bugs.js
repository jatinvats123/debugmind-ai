/** Restore the intentionally-buggy state of src/ + server.js from .buggy-baseline/. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, '.buggy-baseline');

if (!fs.existsSync(src)) {
  console.error('.buggy-baseline/ not found — run scripts/snapshot-bugs.js first (with the bugs in place).');
  process.exit(1);
}

fs.rmSync(path.join(root, 'src'), { recursive: true, force: true });
fs.cpSync(path.join(src, 'src'), path.join(root, 'src'), { recursive: true });
fs.copyFileSync(path.join(src, 'server.js'), path.join(root, 'server.js'));

console.log('Restored the intentionally-buggy src/ and server.js from .buggy-baseline/');
