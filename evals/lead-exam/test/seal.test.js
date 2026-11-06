'use strict';
// items.json is frozen with scripts/rubric-freeze.js; any byte change after sealing must be caught.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const FREEZE = path.join(ROOT, 'scripts', 'rubric-freeze.js');
const ITEMS = path.join(__dirname, '..', 'items.json');
const SEAL = path.join(__dirname, '..', 'items.seal.json');
const check = (spec, seal) => spawnSync(process.execPath, [FREEZE, 'check', spec, seal], { encoding: 'utf8' });

test('the committed items.json matches its seal', () => {
  const r = check(ITEMS, SEAL);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('a one-byte change to a copy of items.json fails the seal check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-seal-'));
  try {
    const copy = path.join(dir, 'items.json');
    fs.writeFileSync(copy, `${fs.readFileSync(ITEMS, 'utf8')} `);
    const r = check(copy, SEAL);
    assert.notStrictEqual(r.status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
