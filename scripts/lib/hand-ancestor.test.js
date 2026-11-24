'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { handAncestor } = require('./hand-ancestor');

function fakeProc(chain) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-anc-'));
  chain.forEach(([pid, ppid, cmd]) => {
    const dir = path.join(root, String(pid));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'stat'), `${pid} (x) S ${ppid} 0 0`);
    fs.writeFileSync(path.join(dir, 'cmdline'), cmd.split(' ').join('\0'));
  });
  return root;
}

// agy -> bash -> node (the suite runner): refused
let root = fakeProc([[300, 200, 'node scripts/affected-suites.js --run'], [200, 100, 'bash -c x'], [100, 2, '/usr/local/bin/agy -p brief']]);
const hit = handAncestor(300, root);
assert.ok(hit && hit.pid === 100, 'agy ancestor must be found');

// dispatch-hetero.sh -> node (the rail own verify step): allowed
root = fakeProc([[300, 200, 'node scripts/affected-suites.js --run'], [200, 100, 'bash scripts/dispatch-hetero.sh --runner agy'], [100, 2, 'bash']]);
assert.strictEqual(handAncestor(300, root), null, 'the rail verify step must pass');

// depth-0 shell: allowed; unreadable proc: allowed
root = fakeProc([[300, 100, 'node scripts/affected-suites.js --run'], [100, 2, '-zsh']]);
assert.strictEqual(handAncestor(300, root), null);
assert.strictEqual(handAncestor(999, root), null);
console.log('all tests passed');
