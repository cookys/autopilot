'use strict';
// Tests for account-quota.js (N10 interpretation half, N15). Run: node --test scripts/lib/account-quota.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const q = require('./account-quota');

const NOW = 1_800_000_000_000;
function snap(over) {
  return Object.assign({
    schema: 'codeforge.quota/1', alias: 'main', root: null, written_at_ms: NOW - 1000,
    five_hour: { pct: 0.5, resets_at: NOW / 1000 + 3600 },
    seven_day: { pct: 0.2, resets_at: NOW / 1000 + 86400 },
  }, over || {});
}

test('max of the present windows is used', () => {
  const r = q.interpretSnapshot(snap(), { alias: 'main', nowMs: NOW });
  assert.strictEqual(r.state, 'known');
  assert.strictEqual(r.used, 0.5);
  assert.strictEqual(r.source, 'snapshot');
});

test('expired window is ignored, all expired is unknown', () => {
  const s = snap({ five_hour: { pct: 0.99, resets_at: NOW / 1000 - 1 } });
  const r = q.interpretSnapshot(s, { alias: 'main', nowMs: NOW });
  assert.strictEqual(r.used, 0.2);
  const s2 = snap({ five_hour: { pct: 0.99, resets_at: NOW / 1000 - 1 }, seven_day: null });
  assert.strictEqual(q.interpretSnapshot(s2, { alias: 'main', nowMs: NOW }).state, 'unknown');
});

test('snapshot older than 6 h is dropped; just inside is kept', () => {
  assert.strictEqual(q.interpretSnapshot(snap({ written_at_ms: NOW - 6 * 3600e3 - 1 }), { alias: 'main', nowMs: NOW }).note, 'quota_stale');
  assert.strictEqual(q.interpretSnapshot(snap({ written_at_ms: NOW - 6 * 3600e3 }), { alias: 'main', nowMs: NOW }).state, 'known');
});

test('N15 unsupported schema is unknown with its own note, no crash', () => {
  const r = q.interpretSnapshot(snap({ schema: 'codeforge.quota/9' }), { alias: 'main', nowMs: NOW });
  assert.strictEqual(r.state, 'unknown');
  assert.strictEqual(r.note, 'quota_schema_unsupported');
});

test('root and alias mismatch are ignored', () => {
  const root = q.hash8('/some/dir');
  const ok = q.interpretSnapshot(snap({ root }), { alias: 'main', expectedRoot: root, nowMs: NOW });
  assert.strictEqual(ok.state, 'known');
  const bad = q.interpretSnapshot(snap({ root }), { alias: 'main', expectedRoot: q.hash8('/other'), nowMs: NOW });
  assert.strictEqual(bad.note, 'snapshot_root_mismatch');
  assert.strictEqual(q.interpretSnapshot(snap({ alias: 'spare' }), { alias: 'main', nowMs: NOW }).note, 'snapshot_root_mismatch');
  // null root is accepted
  assert.strictEqual(q.interpretSnapshot(snap({ root: null }), { alias: 'main', expectedRoot: root, nowMs: NOW }).state, 'known');
});

test('malformed pct / missing written_at is unknown', () => {
  assert.strictEqual(q.interpretSnapshot(snap({ five_hour: { pct: 2, resets_at: NOW / 1000 + 5 } }), { alias: 'main', nowMs: NOW }).state, 'unknown');
  assert.strictEqual(q.interpretSnapshot(snap({ written_at_ms: undefined }), { alias: 'main', nowMs: NOW }).state, 'unknown');
  assert.strictEqual(q.interpretSnapshot(null, { alias: 'main', nowMs: NOW }).state, 'unknown');
});

test('tight_resets lists windows at or above 0.90', () => {
  const s = snap({ five_hour: { pct: 0.9, resets_at: NOW / 1000 + 100 } });
  assert.deepStrictEqual(q.interpretSnapshot(s, { alias: 'main', nowMs: NOW }).tight_resets, [NOW / 1000 + 100]);
});

test('readQuota reads the file; symlink, oversize, absent handled', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'acctq-'));
  try {
    const dir = q.quotaDir(base);
    fs.mkdirSync(dir, { recursive: true });
    assert.strictEqual(q.readQuota('main', { liveBase: base, nowMs: NOW }).state, 'unknown');
    fs.writeFileSync(path.join(dir, 'main.json'), JSON.stringify(snap()));
    assert.strictEqual(q.readQuota('main', { liveBase: base, nowMs: NOW }).state, 'known');
    fs.symlinkSync(path.join(dir, 'main.json'), path.join(dir, 'link.json'));
    assert.strictEqual(q.readQuota('link', { liveBase: base, nowMs: NOW }).note, 'quota_invalid');
    fs.writeFileSync(path.join(dir, 'big.json'), ' '.repeat(5000));
    assert.strictEqual(q.readQuota('big', { liveBase: base, nowMs: NOW }).note, 'quota_invalid');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{nope');
    assert.strictEqual(q.readQuota('bad', { liveBase: base, nowMs: NOW }).note, 'quota_invalid');
    assert.strictEqual(q.readQuota('../x', { liveBase: base, nowMs: NOW }).note, 'quota_invalid');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('read TOCTOU: snapshot swapped for a symlink after the check is unknown', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'acctq-'));
  try {
    const dir = q.quotaDir(base);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.json'), JSON.stringify(snap()));
    const secret = path.join(base, 'other.json');
    fs.writeFileSync(secret, JSON.stringify(snap()));
    const beforeOpen = (f) => { fs.unlinkSync(f); fs.symlinkSync(secret, f); };
    const r = q.readQuota('main', { liveBase: base, nowMs: NOW, beforeOpen });
    assert.strictEqual(r.state, 'unknown');
    assert.strictEqual(r.note, 'quota_invalid');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
