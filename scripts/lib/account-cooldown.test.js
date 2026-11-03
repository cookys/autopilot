'use strict';
// Tests for account-cooldown.js (N7 cooldown half). Run: node --test scripts/lib/account-cooldown.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cd = require('./account-cooldown');
const { pick } = require('./account-pick');

const NOW = 1_800_000_000_000;
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'acctcd-')); }

test('computeUntil: earliest future tight reset, else default minutes', () => {
  assert.strictEqual(cd.computeUntil({ nowMs: NOW, tightResets: [NOW / 1000 + 600, NOW / 1000 + 60] }), NOW + 60_000);
  assert.strictEqual(cd.computeUntil({ nowMs: NOW, tightResets: [NOW / 1000 - 5] }), NOW + 30 * 60_000);
  assert.strictEqual(cd.computeUntil({ nowMs: NOW }), NOW + 30 * 60_000);
  assert.strictEqual(cd.computeUntil({ nowMs: NOW, defaultMinutes: 5 }), NOW + 5 * 60_000);
});

test('write then read round trip, 0600 file in 0700 dir', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    cd.writeCooldown('main', NOW + 1000, { dir, nowMs: NOW });
    assert.strictEqual(cd.readCooldown('main', { dir, nowMs: NOW }), NOW + 1000);
    assert.strictEqual(fs.statSync(path.join(dir, 'main.json')).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
    const body = fs.readFileSync(path.join(dir, 'main.json'), 'utf8');
    assert.deepStrictEqual(Object.keys(JSON.parse(body)).sort(), ['alias', 'cooldown_until_ms', 'schema', 'written_at_ms']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bad alias, corrupt and foreign-schema files', () => {
  const root = tmp();
  try {
    assert.throws(() => cd.writeCooldown('../x', NOW, { dir: root }));
    fs.writeFileSync(path.join(root, 'a.json'), '{bad');
    assert.strictEqual(cd.readCooldown('a', { dir: root }), null);
    fs.writeFileSync(path.join(root, 'b.json'), JSON.stringify({ schema: 'x', alias: 'b', cooldown_until_ms: 1 }));
    assert.strictEqual(cd.readCooldown('b', { dir: root }), null);
    assert.strictEqual(cd.readCooldown('absent', { dir: root }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('N7: after both aliases are cooled, pick skips both until cooldown_until', () => {
  const root = tmp();
  try {
    cd.writeCooldown('a', NOW + 60_000, { dir: root, nowMs: NOW });
    cd.writeCooldown('b', NOW + 120_000, { dir: root, nowMs: NOW });
    const accounts = [{ alias: 'a', priority: 1 }, { alias: 'b', priority: 2 }];
    const cooldowns = cd.readAllCooldowns(['a', 'b'], { dir: root, nowMs: NOW });
    const r = pick({ accounts, cooldowns, nowMs: NOW + 1000 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'no_account_available');
    assert.deepStrictEqual(r.dropped.map((d) => d.reason), ['cooldown', 'cooldown']);
    const later = pick({ accounts, cooldowns, nowMs: NOW + 60_000 });
    assert.strictEqual(later.choice.alias, 'a');
    assert.strictEqual(cd.isCooling(NOW + 60_000, NOW + 60_000), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('clearCooldown removes the file', () => {
  const root = tmp();
  try {
    cd.writeCooldown('a', NOW, { dir: root });
    assert.strictEqual(cd.clearCooldown('a', { dir: root }), true);
    assert.strictEqual(cd.readCooldown('a', { dir: root }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('write: pre-placed symlink at a temp name is never followed; target untouched', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    fs.mkdirSync(dir, { mode: 0o700 });
    const victim = path.join(root, 'victim');
    fs.writeFileSync(victim, 'KEEP');
    // symlink on the final name: rename replaces the link itself, never writes through it
    fs.symlinkSync(victim, path.join(dir, 'a.json'));
    cd.writeCooldown('a', NOW, { dir, nowMs: NOW });
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'KEEP');
    assert.strictEqual(fs.lstatSync(path.join(dir, 'a.json')).isSymbolicLink(), false);
    // O_EXCL|O_NOFOLLOW on the temp name: a symlink there makes the open fail, target untouched
    const real = require('crypto').randomBytes;
    require('crypto').randomBytes = () => Buffer.from('aabbccddeeff', 'hex');
    try {
      fs.symlinkSync(victim, path.join(dir, `b.json.${process.pid}.aabbccddeeff.tmp`));
      assert.throws(() => cd.writeCooldown('b', NOW, { dir, nowMs: NOW }));
    } finally { require('crypto').randomBytes = real; }
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'KEEP');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('write: pre-existing 0644 file of the same name ends as a fresh 0600 file', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'a.json'), 'old', { mode: 0o644 });
    fs.chmodSync(path.join(dir, 'a.json'), 0o644);
    cd.writeCooldown('a', NOW, { dir, nowMs: NOW });
    assert.strictEqual(fs.statSync(path.join(dir, 'a.json')).mode & 0o777, 0o600);
    assert.strictEqual(cd.readCooldown('a', { dir, nowMs: NOW }), NOW);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('write: cooldown dir that is a symlink or 0755 is refused; no temp files left', () => {
  const root = tmp();
  try {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    const link = path.join(root, 'link');
    fs.symlinkSync(real, link);
    assert.throws(() => cd.writeCooldown('a', NOW, { dir: link }));
    const open = path.join(root, 'open');
    fs.mkdirSync(open); fs.chmodSync(open, 0o755);
    assert.throws(() => cd.writeCooldown('a', NOW, { dir: open }));
    assert.deepStrictEqual(fs.readdirSync(real), []);
    assert.deepStrictEqual(fs.readdirSync(open), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('read TOCTOU: file swapped for a symlink after the check is not followed', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    cd.writeCooldown('a', NOW + 1000, { dir, nowMs: NOW });
    const secret = path.join(root, 'secret.json');
    fs.writeFileSync(secret, JSON.stringify({ schema: cd.SCHEMA, alias: 'a', cooldown_until_ms: NOW + 5 }));
    const beforeOpen = (f) => { fs.unlinkSync(f); fs.symlinkSync(secret, f); };
    assert.strictEqual(cd.readCooldown('a', { dir, nowMs: NOW, beforeOpen }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('read clamps cooldown_until_ms beyond now + 7 days', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    cd.writeCooldown('a', NOW + 365 * 86400e3, { dir, nowMs: NOW });
    assert.strictEqual(cd.readCooldown('a', { dir, nowMs: NOW }), NOW + 7 * 86400e3);
    cd.writeCooldown('b', NOW + 86400e3, { dir, nowMs: NOW });
    assert.strictEqual(cd.readCooldown('b', { dir, nowMs: NOW }), NOW + 86400e3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('alias grammar is enforced on write and clear; error never echoes the input', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    const bad = ['../x', ['FAKE', 'sk', 'ant', 'oat01', 'abcdefghijklmnop'].join('-'), 'A', '', 'a'.repeat(25)];
    for (const b of bad) {
      for (const fn of [() => cd.writeCooldown(b, NOW, { dir }), () => cd.clearCooldown(b, { dir })]) {
        try { fn(); assert.fail('should throw'); } catch (e) {
          assert.ok(!/assert/i.test(e.name), 'must throw, not assert');
          assert.ok(!String(e.message).includes(b || '\u0000'), 'message must not echo alias');
        }
      }
    }
    assert.ok(!fs.existsSync(path.join(root, 'x.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('FIFO at the cooldown path returns null within 5 s (open must not block)', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'cd');
    fs.mkdirSync(dir, { mode: 0o700 });
    require('child_process').execFileSync('mkfifo', [path.join(dir, 'a.json')]);
    const r = require('child_process').spawnSync(process.execPath, ['-e',
      `process.stdout.write(String(require(${JSON.stringify(path.join(__dirname, 'account-cooldown.js'))}).readCooldown('a',{dir:${JSON.stringify(dir)}})))`],
      { timeout: 5000 });
    assert.strictEqual(r.error, undefined, 'read blocked on FIFO');
    assert.strictEqual(r.stdout.toString(), 'null');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
