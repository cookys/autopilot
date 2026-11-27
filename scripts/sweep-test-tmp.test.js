'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sweep } = require('./sweep-test-tmp');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeptest-'));
const old = new Date(Date.now() - 3 * 3600 * 1000);
const mk = (n, aged) => { const p = path.join(root, n); fs.mkdirSync(path.join(p, 'sub'), { recursive: true }); fs.writeFileSync(path.join(p, 'sub', 'f'), 'x'); if (aged) fs.utimesSync(p, old, old); return p; };
const oldHit = mk('autopilot-test-old', true);
const fresh = mk('autopilot-test-fresh', false);
const other = mk('keep-me-old', true); // negative control: wrong prefix, old
fs.mkdirSync(path.join(root, 'nest'));
const nested = path.join(root, 'nest', 'autopilot-test-deep'); fs.mkdirSync(nested); fs.utimesSync(nested, old, old); // not one level down

let r = sweep({ root, dry: true });
assert.strictEqual(r.matched, 1); assert.ok(fs.existsSync(oldHit), 'dry run removes nothing');
r = sweep({ root });
assert.strictEqual(r.removed, 1); assert.ok(!fs.existsSync(oldHit), 'old prefixed dir removed');
assert.ok(fs.existsSync(fresh), 'fresh dir kept (mmin<=60)');
assert.ok(fs.existsSync(other), 'other prefix kept');
assert.ok(fs.existsSync(nested), 'nested dir kept (one level only)');
fs.rmSync(root, { recursive: true, force: true });
console.log('sweep-test-tmp: all assertions passed');
