/** Snapshot the current (buggy) src/ + server.js into .buggy-baseline/ so agent runs can be repeated. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dest = path.join(root, '.buggy-baseline');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(dest, 'src'), { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(dest, 'server.js'));

console.log('Snapshotted buggy state of src/ and server.js into .buggy-baseline/');
