'use strict';

// session-mode.js bind-campaign-root (mods P1W SCOPE, gate run l5g): an /l5-/l6 session's marker records the
// Mission root of the campaign it launched (additive `campaign_roots`), so the band can follow it.
// RED before the change (verb absent -> exit 2 "Usage"): 17 tests, 8 pass (negative cases, vacuous) / 9 fail: run-w/land/scope-bind-red.txt.
// GREEN: 19 tests (+3 after mutation survivors: cwd-keyed marker with no session id, a marker file of another session, the live / dead lock holder).
// Mutation controls: run-w/land/scope-mut-bind-*.txt.
//
// Isolated: every marker lives in a temp AUTOPILOT_SESSION_MODE_DIR, HOME is a temp dir.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'session-mode.js');
const IDENT = 'git-common-dir:/tmp/some-repo/.git';
const SID = 'bind-sess-1';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bind-root-'));
  const markers = path.join(dir, 'markers');
  fs.mkdirSync(markers, { recursive: true });
  return { dir, markers, home: path.join(dir, 'home') };
}

function writeMarker(sb, over = {}, sid = SID) {
  const now = Date.now();
  const marker = {
    session_id: sid, level: 'l5', repo_root: '/tmp/some-repo',
    started_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 3600e3).toISOString(),
    repo_identity: IDENT, project_key: 'a1b2c3d4e5f60718', root_run_id: 'job-1-abc',
    ...over,
  };
  fs.writeFileSync(path.join(sb.markers, `${sid}.json`), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

const read = (sb, sid = SID) => JSON.parse(fs.readFileSync(path.join(sb.markers, `${sid}.json`), 'utf8'));
const raw = (sb, sid = SID) => fs.readFileSync(path.join(sb.markers, `${sid}.json`), 'utf8');

function envOf(sb, extra = {}) {
  const env = { ...process.env, HOME: sb.home, AUTOPILOT_SESSION_MODE_DIR: sb.markers, AUTOPILOT_SESSION_ID: SID, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra };
  for (const k of Object.keys(extra)) if (extra[k] === null) delete env[k];
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CODEX_THREAD_ID']) if (!(k in extra)) delete env[k];
  return env;
}

function bind(sb, args, extra = {}, cwd = undefined) {
  return spawnSync('node', [CLI, 'bind-campaign-root', ...args], { env: envOf(sb, extra), encoding: 'utf8', input: '', cwd });
}

test('binds the root onto the caller\'s own marker and changes nothing else', () => {
  const sb = sandbox();
  const before = writeMarker(sb);
  const r = bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = read(sb);
  assert.deepStrictEqual(after.campaign_roots, ['mission-aaa']);
  const { campaign_roots: _c, ...rest } = after;
  assert.deepStrictEqual(rest, before, 'every other field is untouched');
  assert.strictEqual(after.root_run_id, 'job-1-abc', 'the job root stays the marker root');
});

test('binds only the calling session: another session\'s marker is never read or written', () => {
  const sb = sandbox();
  writeMarker(sb, {}, SID);
  writeMarker(sb, {}, 'other-sess');
  const otherBefore = raw(sb, 'other-sess');
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
  assert.strictEqual(raw(sb, 'other-sess'), otherBefore);
  assert.deepStrictEqual(read(sb).campaign_roots, ['mission-aaa']);
});

test('refuses (non-zero, one stderr line, marker unchanged) when the caller has no marker', () => {
  const sb = sandbox();
  writeMarker(sb, {}, 'other-sess');
  const otherBefore = raw(sb, 'other-sess');
  const r = bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]);
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.strictEqual(raw(sb, 'other-sess'), otherBefore, 'a foreign marker is not a fallback');
  assert.ok(!fs.existsSync(path.join(sb.markers, `${SID}.json`)), 'never creates a marker');
});

test('refuses without an explicit session id even when a marker is keyed by the cwd fallback', () => {
  const sb = sandbox();
  // an unbound caller's getSessionId() is its normalised cwd: a marker named that way exists, the environment names no session
  const cwdSid = sb.dir.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  writeMarker(sb, {}, cwdSid);
  const before = raw(sb, cwdSid);
  const r = bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT], { AUTOPILOT_SESSION_ID: null }, sb.dir);
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.strictEqual(raw(sb, cwdSid), before, 'the cwd-keyed marker is not this process\'s');
});

test('refuses a marker file whose own session_id is another session\'s', () => {
  const sb = sandbox();
  writeMarker(sb, { session_id: 'someone-else' });
  const before = raw(sb);
  const r = bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]);
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(raw(sb), before);
});

test('the marker lock: a live holder makes the bind time out (exit 1, marker untouched); a dead holder\'s lock is stolen', () => {
  const sb = sandbox();
  writeMarker(sb);
  const before = raw(sb);
  const lock = path.join(sb.markers, `${SID}.json.lock`);
  fs.writeFileSync(lock, String(process.pid)); // this test process is alive
  const blocked = bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT], { AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS: '400' });
  assert.strictEqual(blocked.status, 1, blocked.stderr);
  assert.strictEqual(blocked.stderr.trim().split('\n').length, 1, blocked.stderr);
  assert.strictEqual(raw(sb), before, 'a timed-out bind leaves the marker untouched');
  fs.unlinkSync(lock);
  fs.writeFileSync(lock, '999999999'); // no such process
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
  assert.deepStrictEqual(read(sb).campaign_roots, ['mission-aaa']);
});

for (const [name, over] of [
  ['an expired marker', () => ({ expires_at: new Date(Date.now() - 1000).toISOString() })],
  ['a level below l5 (l3)', () => ({ level: 'l3' })],
  ['a level below l5 (l4)', () => ({ level: 'l4' })],
  ['a plain-session marker (level null)', () => ({ level: null })],
]) {
  test(`refuses ${name}`, () => {
    const sb = sandbox();
    writeMarker(sb, over());
    const before = raw(sb);
    const r = bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]);
    assert.notStrictEqual(r.status, 0);
    assert.strictEqual(r.stderr.trim().split('\n').length, 1, r.stderr);
    assert.strictEqual(raw(sb), before);
  });
}

test('accepts l6 as well as l5', () => {
  const sb = sandbox();
  writeMarker(sb, { level: 'l6' });
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
});

test('refuses a repo identity that is not the marker\'s, and a call that names none', () => {
  const sb = sandbox();
  writeMarker(sb);
  const before = raw(sb);
  const mismatch = bind(sb, ['--root', 'mission-aaa', '--repo-identity', 'git-common-dir:/tmp/elsewhere/.git']);
  assert.notStrictEqual(mismatch.status, 0);
  assert.strictEqual(mismatch.stderr.trim().split('\n').length, 1, mismatch.stderr);
  const none = bind(sb, ['--root', 'mission-aaa']);
  assert.notStrictEqual(none.status, 0);
  assert.strictEqual(raw(sb), before);
});

test('the repo identity can be derived from --repo-root (a real git repo)', () => {
  const sb = sandbox();
  const repo = path.join(sb.dir, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'develop', repo]);
  const common = fs.realpathSync(path.join(repo, '.git'));
  writeMarker(sb, { repo_root: repo, repo_identity: `git-common-dir:${common}` });
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-root', repo]).status, 0);
  assert.deepStrictEqual(read(sb).campaign_roots, ['mission-aaa']);
  const other = path.join(sb.dir, 'other');
  fs.mkdirSync(other);
  execFileSync('git', ['init', '-q', '-b', 'develop', other]);
  assert.notStrictEqual(bind(sb, ['--root', 'mission-bbb', '--repo-root', other]).status, 0);
  assert.deepStrictEqual(read(sb).campaign_roots, ['mission-aaa']);
});

test('refuses an unsafe or missing root id', () => {
  const sb = sandbox();
  writeMarker(sb);
  const before = raw(sb);
  for (const bad of ['../x', 'a/b', 'a b', '', '.', '..', 'x'.repeat(129), 'ä']) {
    const r = bind(sb, ['--root', bad, '--repo-identity', IDENT]);
    assert.notStrictEqual(r.status, 0, `root ${JSON.stringify(bad)} must be refused`);
  }
  assert.notStrictEqual(bind(sb, ['--repo-identity', IDENT]).status, 0);
  assert.strictEqual(raw(sb), before);
});

test('idempotent: binding the same root twice leaves the file byte-identical; the marker\'s own root is not a campaign root', () => {
  const sb = sandbox();
  writeMarker(sb);
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
  const once = raw(sb);
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
  assert.strictEqual(raw(sb), once);
  assert.strictEqual(bind(sb, ['--root', 'job-1-abc', '--repo-identity', IDENT]).status, 0);
  assert.strictEqual(raw(sb), once, 'binding the marker root itself adds nothing');
});

test('newest last: a re-bound older root moves to the end', () => {
  const sb = sandbox();
  writeMarker(sb);
  for (const r of ['m-1', 'm-2', 'm-1']) assert.strictEqual(bind(sb, ['--root', r, '--repo-identity', IDENT]).status, 0);
  assert.deepStrictEqual(read(sb).campaign_roots, ['m-2', 'm-1']);
});

test('bounded to 8, the oldest dropped first', () => {
  const sb = sandbox();
  writeMarker(sb);
  for (let i = 1; i <= 11; i += 1) assert.strictEqual(bind(sb, ['--root', `m-${i}`, '--repo-identity', IDENT]).status, 0);
  assert.deepStrictEqual(read(sb).campaign_roots, ['m-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9', 'm-10', 'm-11']);
});

test('concurrent binds serialise on the marker lock: every root lands, the file is whole JSON', async () => {
  const sb = sandbox();
  writeMarker(sb);
  const roots = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6'];
  const results = await Promise.all(roots.map((root) => new Promise((resolve) => {
    const child = spawn('node', [CLI, 'bind-campaign-root', '--root', root, '--repo-identity', IDENT], { env: envOf(sb), stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err }));
  })));
  for (const r of results) assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual([...read(sb).campaign_roots].sort(), [...roots].sort());
});

test('set --size (init merge) and a later bind keep each other\'s fields (additive field survives the init writer)', () => {
  const sb = sandbox();
  writeMarker(sb);
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
  const r = spawnSync('node', [CLI, 'set', '--size', 'M'], { env: envOf(sb), encoding: 'utf8', input: '' });
  assert.strictEqual(r.status, 0, r.stderr);
  const m = read(sb);
  assert.deepStrictEqual(m.campaign_roots, ['mission-aaa']);
  assert.strictEqual(m.size, 'M');
  assert.strictEqual(m.phase, undefined);
});

test('the removed phase flag is rejected (P2b) and leaves campaign_roots untouched', () => {
  const sb = sandbox();
  writeMarker(sb);
  assert.strictEqual(bind(sb, ['--root', 'mission-aaa', '--repo-identity', IDENT]).status, 0);
  const r = spawnSync('node', [CLI, 'set', '--phase', 'review'], { env: envOf(sb), encoding: 'utf8', input: '' }); // stage-vocab-allow
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /stage-advance\.js --to <node>/);
  assert.deepStrictEqual(read(sb).campaign_roots, ['mission-aaa']);
});
