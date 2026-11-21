'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const checker = path.join(__dirname, 'check-config-docs.js');

test('the develop settings reference corruption is rejected', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-config-docs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const reference = path.join(dir, 'settings-reference.md');
  const broken = execFileSync('git', ['show', '3d477a30a:docs/guide/settings-reference.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  fs.writeFileSync(reference, broken);

  const result = spawnSync(process.execPath, [checker, '--reference', reference], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /FAIL reference_embedded_heading:/);
  assert.match(result.stdout, /FAIL reference_duplicate_key:/);
});
