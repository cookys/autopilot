/**
 * Tests for scripts/lib/live-state-dir.js — resolveLiveDir probe order/acceptance rule,
 * sanitizeSessionId (shared writer/reader vector file), readLive schema+freshness gate,
 * modelFamily grammar.
 * Run: node --test scripts/lib/live-state-dir.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const LIB = path.join(__dirname, 'live-state-dir.js');
const {
  resolveLiveDir, sanitizeSessionId, readLive, modelFamily,
} = require(LIB);

// The shared vector file lives at <repo>/hooks/tests/fixtures/; this test file exists at two depths
// (scripts/lib and platforms/codex/plugin/scripts/lib), so walk up until the fixture is found.
function findVectorFile() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, 'hooks', 'tests', 'fixtures', 'session-id-vectors.json');
    if (fs.existsSync(cand)) return cand;
    dir = path.dirname(dir);
  }
  throw new Error('session-id-vectors.json not found above ' + __dirname);
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Fake `findmnt` on PATH: a tiny node script reading FSTYPE decisions from an env var
// (JSON map of substring→fstype, plus a "*" default) so different candidate directories
// can resolve to different filesystem types within one process invocation.
function makeFakeFindmnt(dir, rules) {
  const bin = path.join(dir, 'findmnt');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const rules = ${JSON.stringify(rules)};
const target = process.argv[3] || '';
let out = rules['*'] || '';
for (const k of Object.keys(rules)) {
  if (k !== '*' && target.includes(k)) { out = rules[k]; break; }
}
if (!out) { process.exit(1); }
process.stdout.write(out + '\\n');
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

function execSyncWithPath(fakeBinDir) {
  const env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` };
  return (cmd, opts) => execSync(cmd, { ...opts, env });
}

function execSyncNoFindmnt() {
  // A PATH with no findmnt binary anywhere on it.
  const env = { ...process.env, PATH: '/nonexistent-bin-dir' };
  return (cmd, opts) => execSync(cmd, { ...opts, env });
}

test('resolveLiveDir: tmpfs candidate is chosen (shm)', () => {
  const bindir = mkTmp('findmnt-tmpfs-');
  makeFakeFindmnt(bindir, { '*': 'tmpfs' });
  const warnings = [];
  const r = resolveLiveDir({
    env: {}, // no override, no XDG_RUNTIME_DIR ⇒ falls to /dev/shm/autopilot-<uid>
    execSync: execSyncWithPath(bindir),
    warn: (m) => warnings.push(m),
  });
  assert.strictEqual(r.source, 'shm');
  assert.match(r.base, /^\/dev\/shm\/autopilot-/);
  assert.strictEqual(warnings.length, 0);
});

test('resolveLiveDir: ext4 everywhere ⇒ ~/.autopilot fallback + exactly one warning', () => {
  const bindir = mkTmp('findmnt-ext4-');
  makeFakeFindmnt(bindir, { '*': 'ext4' });
  const warnings = [];
  const r = resolveLiveDir({
    env: {},
    execSync: execSyncWithPath(bindir),
    warn: (m) => warnings.push(m),
  });
  assert.strictEqual(r.source, 'ssd-fallback');
  assert.strictEqual(r.base, path.join(os.homedir(), '.autopilot'));
  assert.strictEqual(warnings.length, 1, 'exactly one warning line');
});

test('resolveLiveDir: findmnt absent ⇒ falls back to /proc/mounts fixture (longest-prefix)', () => {
  const fixtureDir = mkTmp('procmounts-');
  const procMounts = path.join(fixtureDir, 'mounts');
  // Longest-prefix match: /dev/shm is tmpfs, / is ext4. A candidate under /dev/shm/... must
  // resolve to tmpfs via the /dev/shm row, not the root row.
  fs.writeFileSync(procMounts, [
    'rootfs / ext4 rw 0 0',
    'tmpfs /dev/shm tmpfs rw 0 0',
  ].join('\n'));
  const r = resolveLiveDir({
    env: {},
    execSync: execSyncNoFindmnt(),
    procMountsPath: procMounts,
    warn: () => {},
  });
  assert.strictEqual(r.source, 'shm');
  assert.match(r.base, /^\/dev\/shm\/autopilot-/);
});

test('resolveLiveDir: findmnt absent + /proc/mounts fixture with no RAM mounts ⇒ ssd-fallback', () => {
  const fixtureDir = mkTmp('procmounts-none-');
  const procMounts = path.join(fixtureDir, 'mounts');
  fs.writeFileSync(procMounts, [
    'rootfs / ext4 rw 0 0',
  ].join('\n'));
  const warnings = [];
  const r = resolveLiveDir({
    env: {},
    execSync: execSyncNoFindmnt(),
    procMountsPath: procMounts,
    warn: (m) => warnings.push(m),
  });
  assert.strictEqual(r.source, 'ssd-fallback');
  assert.strictEqual(warnings.length, 1);
});

test('resolveLiveDir: rejected ext4 override + tmpfs XDG ⇒ XDG chosen (override skipped, not fatal)', () => {
  const bindir = mkTmp('findmnt-mixed-');
  makeFakeFindmnt(bindir, { 'override-dir': 'ext4', 'xdg-dir': 'tmpfs', '*': 'ext4' });
  const overrideDir = mkTmp('override-dir-');
  const xdgParent = mkTmp('xdg-dir-');
  const warnings = [];
  const r = resolveLiveDir({
    env: { AUTOPILOT_LIVE_DIR: overrideDir, XDG_RUNTIME_DIR: xdgParent },
    execSync: execSyncWithPath(bindir),
    warn: (m) => warnings.push(m),
  });
  assert.strictEqual(r.source, 'xdg');
  assert.strictEqual(r.base, path.join(xdgParent, 'autopilot'));
  assert.strictEqual(warnings.length, 0);
});

test('resolveLiveDir: accepted tmpfs override wins over everything else', () => {
  const bindir = mkTmp('findmnt-override-ok-');
  makeFakeFindmnt(bindir, { '*': 'tmpfs' });
  const overrideDir = mkTmp('override-ok-');
  const r = resolveLiveDir({
    env: { AUTOPILOT_LIVE_DIR: overrideDir, XDG_RUNTIME_DIR: mkTmp('xdg-unused-') },
    execSync: execSyncWithPath(bindir),
    warn: () => {},
  });
  assert.strictEqual(r.source, 'override');
  assert.strictEqual(r.base, overrideDir);
});

// ---- sanitizeSessionId: shared vector file ----

test('sanitizeSessionId: shared vector file (writer/reader contract)', () => {
  const vectors = JSON.parse(fs.readFileSync(
    findVectorFile(), 'utf8',
  ));
  assert.ok(vectors.length >= 6, 'vector file should carry at least the 6 spec cases');
  for (const v of vectors) {
    assert.strictEqual(sanitizeSessionId(v.input), v.expected, `vector ${JSON.stringify(v.input)}`);
  }
});

test('sanitizeSessionId: non-string input ⇒ unknown', () => {
  assert.strictEqual(sanitizeSessionId(undefined), 'unknown');
  assert.strictEqual(sanitizeSessionId(null), 'unknown');
  assert.strictEqual(sanitizeSessionId(42), 'unknown');
});

// ---- readLive ----

function writeLiveFile(base, sid, kind, obj) {
  const dir = path.join(base, 'context');
  fs.mkdirSync(dir, { recursive: true });
  const name = kind === 'tasks' ? `${sid}.tasks.json` : `${sid}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
}

test('readLive: fresh main file ⇒ returned', () => {
  const base = mkTmp('live-fresh-');
  const now = Date.parse('2026-09-05T12:00:00Z');
  writeLiveFile(base, 'sid1', 'main', {
    schema_version: 1, session_id: 'sid1', written_at: new Date(now - 1000).toISOString(),
    context_window: { context_window_size: 1000000 },
  });
  const r = readLive(base, 'sid1', { kind: 'main', nowMs: now });
  assert.ok(r);
  assert.strictEqual(r.context_window.context_window_size, 1000000);
});

test('readLive: stale (>120s) ⇒ null', () => {
  const base = mkTmp('live-stale-');
  const now = Date.parse('2026-09-05T12:00:00Z');
  writeLiveFile(base, 'sid1', 'main', {
    schema_version: 1, written_at: new Date(now - 121000).toISOString(),
  });
  assert.strictEqual(readLive(base, 'sid1', { kind: 'main', nowMs: now }), null);
});

test('readLive: exactly at the 120s boundary is fresh, one ms past is stale', () => {
  const base = mkTmp('live-boundary-');
  const now = Date.parse('2026-09-05T12:00:00Z');
  writeLiveFile(base, 'sidA', 'main', { schema_version: 1, written_at: new Date(now - 120000).toISOString() });
  writeLiveFile(base, 'sidB', 'main', { schema_version: 1, written_at: new Date(now - 120001).toISOString() });
  assert.notStrictEqual(readLive(base, 'sidA', { kind: 'main', nowMs: now }), null);
  assert.strictEqual(readLive(base, 'sidB', { kind: 'main', nowMs: now }), null);
});

test('readLive: schema_version 2 ⇒ null', () => {
  const base = mkTmp('live-schema2-');
  writeLiveFile(base, 'sid1', 'main', { schema_version: 2, written_at: new Date().toISOString() });
  assert.strictEqual(readLive(base, 'sid1', { kind: 'main' }), null);
});

test('readLive: missing schema_version ⇒ null', () => {
  const base = mkTmp('live-noschema-');
  writeLiveFile(base, 'sid1', 'main', { written_at: new Date().toISOString() });
  assert.strictEqual(readLive(base, 'sid1', { kind: 'main' }), null);
});

test('readLive: non-integer schema_version ⇒ null', () => {
  const base = mkTmp('live-floatschema-');
  writeLiveFile(base, 'sid1', 'main', { schema_version: 1.5, written_at: new Date().toISOString() });
  assert.strictEqual(readLive(base, 'sid1', { kind: 'main' }), null);
});

test('readLive: missing file ⇒ null', () => {
  const base = mkTmp('live-missing-');
  assert.strictEqual(readLive(base, 'no-such-sid', { kind: 'main' }), null);
});

test('readLive: malformed JSON ⇒ null', () => {
  const base = mkTmp('live-malformed-');
  const dir = path.join(base, 'context');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sid1.json'), '{{{not json');
  assert.strictEqual(readLive(base, 'sid1', { kind: 'main' }), null);
});

test('readLive: wrong session id ⇒ null (no file at that path)', () => {
  const base = mkTmp('live-wrongsid-');
  writeLiveFile(base, 'sid-real', 'main', { schema_version: 1, written_at: new Date().toISOString() });
  assert.strictEqual(readLive(base, 'sid-other', { kind: 'main' }), null);
});

test('readLive: tasks kind reads the .tasks.json file, independent freshness', () => {
  const base = mkTmp('live-tasks-');
  const now = Date.parse('2026-09-05T12:00:00Z');
  writeLiveFile(base, 'sid1', 'tasks', {
    schema_version: 1, written_at: new Date(now - 1000).toISOString(),
    tasks: [{ id: 'a1', tokenCount: 57490, contextWindowSize: 200000 }],
  });
  const r = readLive(base, 'sid1', { kind: 'tasks', nowMs: now });
  assert.ok(r);
  assert.strictEqual(r.tasks[0].id, 'a1');
});

// ---- modelFamily ----

test('modelFamily: positive vectors', () => {
  assert.strictEqual(modelFamily('claude-fable-5-1'), 'fable');
  assert.strictEqual(modelFamily('CLAUDE-OPUS-4-8[1m]'), 'opus');
  assert.strictEqual(modelFamily('claude-sonnet-5'), 'sonnet');
});

test('modelFamily: negative vectors ⇒ unknown', () => {
  assert.strictEqual(modelFamily('fable-ish'), 'unknown');
  assert.strictEqual(modelFamily('claude-fable'), 'unknown');
  assert.strictEqual(modelFamily('fable'), 'unknown');
  assert.strictEqual(modelFamily(''), 'unknown');
  assert.strictEqual(modelFamily(undefined), 'unknown');
});
