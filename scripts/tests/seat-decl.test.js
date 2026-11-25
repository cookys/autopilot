'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { COLUMNS, parseSeatDecl, loginEntries } = require('../lib/seat-decl');

const row = (o) => COLUMNS.map((c) => (o[c] === undefined ? '-' : o[c])).join('\t');
const A = row({ seat: 'alpha--claude', host: 'host-a', os_account: 'team', harness: 'claude', profile: 'p1', lead: 'lead-x' });
const B = row({ seat: 'beta--claude', host: 'host-a', os_account: 'team', harness: 'claude', profile: 'p2' });

test('parses 14 columns and maps "-" to null', () => {
  const rows = parseSeatDecl(`# header\n${A}\n\n${B}\n`);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].lead, 'lead-x');
  assert.strictEqual(rows[1].lead, null);
});

test('wrong column count is an error that names the line', () => {
  assert.throws(() => parseSeatDecl(`${A}\nonly\ttwo\n`), /:2: expected 14/);
});

test('a repeated (host, seat) key is an error; same seat on another host is fine', () => {
  assert.throws(() => parseSeatDecl(`${A}\n${A}\n`), /repeats line 1/);
  const other = row({ seat: 'alpha--claude', host: 'host-b', os_account: 'team', profile: 'p1' });
  assert.strictEqual(parseSeatDecl(`${A}\n${other}\n`).length, 2);
});

test('seat and host are required', () => {
  assert.throws(() => parseSeatDecl(row({ seat: '-', host: 'h' })), /required/);
});

test('loginEntries groups profiles per (host, os_account)', () => {
  const e = loginEntries(parseSeatDecl(`${A}\n${B}\n`));
  assert.deepStrictEqual(e, [{ host: 'host-a', os_account: 'team', profiles: ['p1', 'p2'] }]);
});

test('login-checklist --seat-decl reads the tsv, and a bad column count exits 2 with the line', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-decl-'));
  const good = path.join(dir, 'good.tsv');
  const bad = path.join(dir, 'bad.tsv');
  fs.writeFileSync(good, `${A}\n${B}\n`);
  fs.writeFileSync(bad, `${A}\nshort\n`);
  const cli = path.join(__dirname, '..', 'login-checklist.js');
  const ok = spawnSync(process.execPath, [cli, '--seat-decl', good, '--json'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.deepStrictEqual(JSON.parse(ok.stdout).map((i) => i.profile).sort(), ['p1', 'p2']);
  const no = spawnSync(process.execPath, [cli, '--seat-decl', bad], { encoding: 'utf8' });
  assert.strictEqual(no.status, 2);
  assert.match(no.stderr, /:2: expected 14/);
});
