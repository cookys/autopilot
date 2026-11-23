'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('fleet regression checks successful and corrupt fetches in an isolated home', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-regress-test-'));
  try {
    const fake = path.join(dir, 'fleet');
    fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs');
const crypto = require('crypto');
const a = process.argv.slice(2);
if (!process.env.HOME.includes('fleet-tools-regress-')) process.exit(9);
if (a[0] === 'upload') console.log(crypto.createHash('sha256').update(fs.readFileSync(a[1])).digest('hex'));
else if (a[0] === 'fetch') fs.writeFileSync(a[2], process.env.CORRUPT ? 'wrong' : 'fleet tools regression fixture\\n');
else if (a[0] === 'watch' && a[1] === '--until-file') console.log('watch_id: 01ARZ3NDEKTSV4RRFFQ69G5FAV');
else if (a[0] !== 'watch' || a[1] !== '--cancel' || a[2] !== '01ARZ3NDEKTSV4RRFFQ69G5FAV') process.exit(2);
`, { mode: 0o755 });
    for (const corrupt of [false, true]) {
      const result = spawnSync(process.execPath, [path.join(__dirname, 'fleet-tools-regress.js')], { encoding: 'utf8', env: { ...process.env, FLEET_BIN: fake, CORRUPT: corrupt ? '1' : '' } });
      assert.equal(result.status, corrupt ? 1 : 0, result.stdout + result.stderr);
      assert.match(result.stdout, corrupt ? /FAIL fetch sha256 mismatch/ : /PASS fetch ok/);
      assert.match(result.stdout, /PASS upload ok/);
      assert.match(result.stdout, /PASS watch ok/);
      assert.match(result.stdout, corrupt ? /AUDIT fleet-tools-regress FAIL/ : /AUDIT fleet-tools-regress PASS/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
