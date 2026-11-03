/**
 * Tests for scripts/lib/account-audit.js — key allowlist, outcome set, pre-attempt rule,
 * token / sk-ant- rejection (N5b), status rendering in UTC+8 and no leak (N5c audit half).
 * Run: node --test scripts/lib/account-audit.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./account-audit.js');

const TOKEN = 'FAKE-oat01-ABCDEFGHIJKLMNOP';
const NOW = Date.UTC(2026, 10, 3, 4, 5, 6, 7);
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'acct-audit-')); }
function ok(over) { return { alias: 'spare', purpose: 'dispatch-review', attempt: 2, outcome: 'rate_limited', ...over }; }
function rejects(input, tokens) {
  const dir = tmp();
  const file = path.join(dir, 'a.jsonl');
  assert.throws(() => A.appendAudit(input, { path: file, now: NOW, tokens }), /audit:/);
  assert.strictEqual(fs.existsSync(file), false, 'rejected record must not create or write the file');
}

test('writes exactly the six keys, 0600, one line, Taipei ts_local', () => {
  const file = path.join(tmp(), 'sub', 'a.jsonl');
  A.appendAudit(ok(), { path: file, now: NOW });
  A.appendAudit(ok({ alias: 'main', attempt: 3, outcome: 'ok' }), { path: file, now: NOW + 1 });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  const rec = JSON.parse(lines[0]);
  assert.deepStrictEqual(Object.keys(rec), A.AUDIT_KEYS);
  assert.strictEqual(rec.ts_local, '2026-11-03T12:05:06.007+08:00');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
});

test('N5b: extra keys are rejected', () => {
  for (const k of ['used', 'run', 'mode', 'class']) rejects(ok({ [k]: 'x' }));
});

test('N5b: unknown outcome, bad purpose, bad alias, bad attempt are rejected', () => {
  rejects(ok({ outcome: 'weird' }));
  rejects(ok({ purpose: 'has space' }));
  rejects(ok({ purpose: 'a'.repeat(60) }));
  rejects(ok({ purpose: '' }));
  rejects(ok({ alias: 'Bad_Alias' }));
  rejects(ok({ alias: 'a'.repeat(25) }));
  rejects(ok({ attempt: '2' }));
  rejects(ok({ attempt: -1 }));
});

test('N5b: alias "-" with attempt 0 only on pre-attempt outcomes', () => {
  rejects(ok({ alias: '-', attempt: 0, outcome: 'rate_limited' }));
  rejects(ok({ alias: '-', attempt: 0, outcome: 'ok' }));
  rejects(ok({ alias: '-', attempt: 1, outcome: 'no_account' }));
  rejects(ok({ alias: 'spare', attempt: 0, outcome: 'ok' }));
  rejects(ok({ alias: 'spare', attempt: 1, outcome: 'no_account' }));
  const file = path.join(tmp(), 'a.jsonl');
  for (const outcome of A.PRE_ATTEMPT_OUTCOMES) {
    A.appendAudit(ok({ alias: '-', attempt: 0, outcome }), { path: file, now: NOW });
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8').trim().split('\n').length, A.PRE_ATTEMPT_OUTCOMES.length);
});

test('N5b: live token and sk-ant- shapes are rejected in any value', () => {
  rejects(ok({ purpose: 'x-' + TOKEN.toLowerCase() }), [TOKEN.toLowerCase()]);
  rejects(ok({ alias: TOKEN }), [TOKEN]);
  rejects(ok({ purpose: 'sk-ant-oat01-zzz' }));
  rejects(ok({ purpose: 'SK-ANT-oat01' }));
  // token containing only grammar-valid characters is still caught by the live-token check
  rejects(ok({ purpose: 'sekret-value' }), ['sekret-value']);
});

test('N5b: the closed outcome set matches the plan', () => {
  assert.deepStrictEqual(A.OUTCOMES, [
    'ok', 'rate_limited', 'auth_failed', 'child_error', 'timeout', 'other_failure',
    'token_scrubbed', 'all_tight', 'all_limited', 'no_account', 'invalid_config',
    'quota_schema_unsupported', 'mode_off']);
});

test('refuses to append through a symlink and to a group-readable file', () => {
  const dir = tmp();
  const real = path.join(dir, 'real');
  fs.writeFileSync(real, '', { mode: 0o600 });
  const link = path.join(dir, 'link.jsonl');
  fs.symlinkSync(real, link);
  assert.throws(() => A.appendAudit(ok(), { path: link, now: NOW }));
  const loose = path.join(dir, 'loose.jsonl');
  fs.writeFileSync(loose, '', { mode: 0o644 });
  fs.chmodSync(loose, 0o644);
  assert.throws(() => A.appendAudit(ok(), { path: loose, now: NOW }), /0600/);
  assert.strictEqual(fs.readFileSync(loose, 'utf8'), '');
});

test('auditPath honours XDG_STATE_HOME, else the home default', () => {
  assert.strictEqual(A.auditPath({ XDG_STATE_HOME: '/x/state' }, '/h'), '/x/state/autopilot/accounts-audit.jsonl');
  assert.strictEqual(A.auditPath({}, '/h'), '/h/.local/state/autopilot/accounts-audit.jsonl');
  assert.strictEqual(A.auditPath({ XDG_STATE_HOME: 'rel' }, '/h'), '/h/.local/state/autopilot/accounts-audit.jsonl');
});

test('formatTaipei crosses the date line', () => {
  assert.strictEqual(A.formatTaipei(Date.UTC(2026, 11, 31, 20, 0, 0, 0)), '2027-01-01T04:00:00.000+08:00');
});

test('N5c (audit half): status shows UTC+8, ENOENT is empty, tampered lines are never echoed', () => {
  const dir = tmp();
  const file = path.join(dir, 'a.jsonl');
  assert.deepStrictEqual(A.readAudit(file), { records: [], invalid: 0 });
  A.appendAudit(ok(), { path: file, now: NOW });
  // tamper: a line carrying a token, a line with an extra key, and garbage
  fs.appendFileSync(file, JSON.stringify({ ...A.buildRecord(ok(), NOW), purpose: 'tok-' + TOKEN }) + '\n');
  fs.appendFileSync(file, JSON.stringify({ ...A.buildRecord(ok(), NOW), used: 0.93 }) + '\n');
  fs.appendFileSync(file, 'not json ' + TOKEN + '\n');
  const res = A.readAudit(file, { tokens: [TOKEN] });
  assert.strictEqual(res.records.length, 1);
  assert.strictEqual(res.invalid, 3);
  const out = A.renderStatus(res).join('\n');
  assert.match(out, /^2026-11-03 12:05:06 \+08:00 alias=spare purpose=dispatch-review attempt=2 outcome=rate_limited/m);
  assert.ok(!out.includes(TOKEN), 'status output must not contain the token');
  assert.ok(!/sk-ant-/.test(out));
  assert.match(out, /3 unreadable audit line/);
});

test('negative control: skipping validation lets a token through (proves the guard is what blocks it)', () => {
  const file = path.join(tmp(), 'a.jsonl');
  const bad = { ...A.buildRecord(ok(), NOW), purpose: 'tok-' + TOKEN.toLowerCase() };
  // a naive writer (no validateRecord) would persist it; the real reader/writer path refuses it
  fs.writeFileSync(file, JSON.stringify(bad) + '\n');
  assert.strictEqual(A.validateRecord(bad, { tokens: [TOKEN.toLowerCase()] }).ok, false);
  assert.strictEqual(A.validateRecord(bad, { tokens: [] }).ok, true, 'without the live-token list only the grammar blocks it');
});
