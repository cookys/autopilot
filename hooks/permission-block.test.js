/**
 * Tests for the BLOCKED_ON_PERMISSION detection (rm-block item 4, lane permwatch).
 *   - hook path: hooks/awaiting-owner.js on the REAL PermissionRequest + Notification(permission_prompt) payloads captured from a
 *     Claude Code 2.1.318 session under bypassPermissions (hooks/fixtures/permission-block-real.jsonl; the Notification came 6.0 s
 *     after the PermissionRequest)
 *   - pane path: scripts/lib/permission-prompt-detect.js + scripts/permission-prompt-watch.js on a real captured pane
 *     (hooks/fixtures/permission-prompt-pane.txt) and variants of it.
 * Detection only: nothing here sends keys; tmux is never started (the watch CLI reads --text-file).
 * Run: node --test hooks/permission-block.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ATTN = process.env.PB_ATTN || path.join(ROOT, 'hooks', 'awaiting-owner.js');
const WATCH = path.join(ROOT, 'scripts', 'permission-prompt-watch.js');
const detect = require('../scripts/lib/permission-prompt-detect.js');
const EV = fs.readFileSync(path.join(__dirname, 'fixtures', 'permission-block-real.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const [PERM, NOTIF] = EV;
const PANE = fs.readFileSync(path.join(__dirname, 'fixtures', 'permission-prompt-pane.txt'), 'utf8');
const SID = PERM.session_id;

function mkEnv(extra = {}) {
  const live = fs.mkdtempSync(path.join(fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir(), 'pb-live-'));
  fs.chmodSync(live, 0o700);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-repo-'));
  spawnSync('git', ['init', '-q', repo]);
  const env = { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'pb-home-')), AUTOPILOT_LIVE_DIR: live, TMUX_PANE: '%7', ...extra };
  delete env.AUTOPILOT_ROOT_RUN_ID;
  return { live, repo, env };
}
function feed(env, ev) {
  const r = spawnSync('node', [ATTN], { input: JSON.stringify(ev), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}
const attnFile = (live) => path.join(live, 'attention', `${SID}.json`);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function cards(repo) {
  const dir = path.join(repo, '.git', 'autopilot', 'decisions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => readJ(path.join(dir, f)).decisions || []);
}
const inRepo = (ev, repo) => ({ ...ev, cwd: repo });

// ---------- hook path ----------

test('Notification permission_prompt marks the entry BLOCKED_ON_PERMISSION and opens exactly one card', () => {
  const { live, repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  assert.strictEqual(readJ(attnFile(live)).pending[0].state, undefined, 'PermissionRequest alone is not yet BLOCKED (a prompt answered in seconds must not notify)');
  assert.strictEqual(cards(repo).length, 0);
  feed(env, inRepo(NOTIF, repo));
  const a = readJ(attnFile(live));
  const e = a.pending[0];
  assert.strictEqual(e.state, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(e.pane_id, '%7');
  assert.strictEqual(e.cwd, repo);
  assert.match(e.summary, /^Bash: rm -rf "\$\(cat cfg-pw\)" victim-b/);
  const cs = cards(repo);
  assert.strictEqual(cs.length, 1);
  assert.strictEqual(cs[0].origin, 'permission_prompt');
  assert.strictEqual(cs[0].opened_by_session, SID);
  assert.match(cs[0].question, /權限確認框/);
  assert.match(cs[0].question, /rm -rf/);
  assert.match(cs[0].background, /pane %7/);
  assert.ok(cs[0].background.includes(repo) && cs[0].background.includes(SID));
  assert.strictEqual(e.decision_id, cs[0].id);
});

test('duplicate Notification (and duplicate PermissionRequest) opens no second card', () => {
  const { live, repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  feed(env, inRepo(NOTIF, repo));
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  assert.strictEqual(cards(repo).length, 1);
  assert.strictEqual(readJ(attnFile(live)).pending.length, 1);
  assert.strictEqual(readJ(attnFile(live)).pending[0].state, 'BLOCKED_ON_PERMISSION');
});

test('clear on resolve: PostToolUse (approved) closes the card and removes the state', () => {
  const { live, repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  assert.strictEqual(cards(repo).length, 1);
  feed(env, inRepo({ ...PERM, hook_event_name: 'PostToolUse', tool_response: {} }, repo));
  assert.ok(!fs.existsSync(attnFile(live)));
  assert.strictEqual(cards(repo).length, 0);
});

test('clear on deny (UserPromptSubmit) and on SessionEnd', () => {
  for (const end of ['UserPromptSubmit', 'SessionEnd']) {
    const { live, repo, env } = mkEnv();
    feed(env, inRepo(PERM, repo));
    feed(env, inRepo(NOTIF, repo));
    assert.strictEqual(cards(repo).length, 1, end);
    feed(env, inRepo({ session_id: SID, hook_event_name: end }, repo));
    assert.ok(!fs.existsSync(attnFile(live)), end);
    assert.strictEqual(cards(repo).length, 0, end);
  }
});

test('a prompt answered before the Notification leaves no card; a late Notification cannot resurrect one', () => {
  const { live, repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo({ ...PERM, hook_event_name: 'PostToolUse', tool_response: {} }, repo));
  feed(env, inRepo(NOTIF, repo));
  assert.ok(!fs.existsSync(attnFile(live)));
  assert.strictEqual(cards(repo).length, 0);
});

test("another session's card is never closed", () => {
  const { live, repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  const other = { ...PERM, session_id: 'other-session' };
  feed(env, inRepo(other, repo));
  feed(env, inRepo({ ...other, hook_event_name: 'SessionEnd' }, repo));
  assert.strictEqual(cards(repo).length, 1);
  assert.ok(fs.existsSync(attnFile(live)));
});

test('cwd outside a git repo: state is still written, no card, exit 0', () => {
  const { live, env } = mkEnv();
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-plain-'));
  feed(env, inRepo(PERM, plain));
  feed(env, inRepo(NOTIF, plain));
  const e = readJ(attnFile(live)).pending[0];
  assert.strictEqual(e.state, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(e.decision_id, undefined);
});

test('knob AUTOPILOT_AWAITING_OWNER=off: no state, no card', () => {
  const { live, repo, env } = mkEnv({ AUTOPILOT_AWAITING_OWNER: 'off' });
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  assert.ok(!fs.existsSync(attnFile(live)));
  assert.strictEqual(cards(repo).length, 0);
});

// ---------- pane path: detector ----------

test('detector: the real prompt frame is recognised, with reason and command', () => {
  const f = detect.frameOf(PANE);
  assert.ok(f);
  assert.match(f.reason, /^Dangerous rm operation on statically-unresolvable target/);
  assert.match(f.command, /^rm -rf "\$\(cat cfg-pw\)" victim-b$/);
  assert.ok(f.frame.includes('Do you want to proceed?') && f.frame.includes('1. Yes') && f.frame.includes('2. No') && /Esc to cancel · Tab to amend$/.test(f.frame), 'frame is the exact dialog text');
});

test('detector: held 10 s -> trigger once; the countdown ticking does not reset the hold', () => {
  let s = detect.step(null, PANE, 0);
  assert.strictEqual(s.trigger, false);
  s = detect.step(s.state, PANE.replace('1:58', '1:54'), 5000);
  assert.strictEqual(s.trigger, false);
  s = detect.step(s.state, PANE.replace('1:58', '1:49'), 10000);
  assert.strictEqual(s.trigger, true);
  s = detect.step(s.state, PANE.replace('1:58', '1:44'), 15000);
  assert.strictEqual(s.trigger, false, 'reported once');
});

test('detector: a prompt gone after 5 s never triggers and clears nothing', () => {
  let s = detect.step(null, PANE, 0);
  s = detect.step(s.state, PANE, 5000);
  assert.strictEqual(s.trigger, false);
  s = detect.step(s.state, 'ordinary pane\n❯ \n', 6000);
  assert.deepStrictEqual(s, { state: null, trigger: false, clear: false });
  s = detect.step(s.state, PANE, 20000);
  assert.strictEqual(s.trigger, false, 'a returning frame restarts the 10 s hold');
});

test('detector: the same words in a code block the model printed do not trigger', () => {
  const printed = [
    '❯ show me the dialog text',
    '',
    '● Here is what the prompt looks like:',
    '',
    '  ```',
    ...PANE.trimEnd().split('\n').slice(-9).map((l) => `  ${l}`),
    '  ```',
    '',
    '────────────────────────────────────────',
    '❯ ',
    '────────────────────────────────────────',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');
  assert.strictEqual(detect.frameOf(printed), null);
  let s = detect.step(null, printed, 0);
  s = detect.step(s.state, printed, 60000);
  assert.strictEqual(s.trigger, false);
  // even when the printed block is the last thing streamed so far, the dialog's own frame (rules, side bar) is missing
  const bare = ['Dangerous rm operation on statically-unresolvable target', 'Do you want to proceed?', '1. Yes', '2. No', 'Esc to cancel · Tab to amend'].join('\n');
  assert.strictEqual(detect.frameOf(bare), null);
});

test('detector: a frame whose choices or footer are missing is not a prompt', () => {
  assert.strictEqual(detect.frameOf(PANE.replace(/^ ❯ 1\. Yes.*\n/m, '')), null);
  assert.strictEqual(detect.frameOf(`${PANE}✻ Thinking…\n`), null);
});

test('detector: clear fires only for a frame that was reported', () => {
  let s = detect.step(null, PANE, 0);
  s = detect.step(s.state, PANE, 10000);
  assert.strictEqual(s.trigger, true);
  s = detect.step(s.state, 'back to normal\n', 11000);
  assert.strictEqual(s.clear, true);
});

// ---------- pane path: the watch CLI end to end (text file, no tmux) ----------

function watch(env, repo, stateDir, textFile, nowMs, extra = []) {
  const r = spawnSync('node', [WATCH, '--pane', '%7', '--cwd', repo, '--state-dir', stateDir, '--text-file', textFile, '--now-ms', String(nowMs), ...extra], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}

test('watch CLI: pending -> BLOCKED_ON_PERMISSION with one card -> repeat reports no new card -> cleared closes it', () => {
  const { repo, env } = mkEnv();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const text = path.join(stateDir, 'pane.txt');
  fs.writeFileSync(text, PANE);
  assert.strictEqual(watch(env, repo, stateDir, text, 1000).verdict, 'pending');
  assert.strictEqual(cards(repo).length, 0);
  const hit = watch(env, repo, stateDir, text, 11500);
  assert.strictEqual(hit.verdict, 'BLOCKED_ON_PERMISSION');
  assert.match(hit.command, /rm -rf/);
  assert.ok(hit.frame.includes('Dangerous rm operation'));
  const rec = readJ(path.join(stateDir, fs.readdirSync(stateDir).find((f) => /^_7-[0-9a-f]{8}\.json$/.test(f))));
  assert.ok(rec.fired && rec.pane === '%7' && rec.session === 'pane-_7' && rec.cwd === repo && rec.frame === hit.frame && rec.command === hit.command, 'state record carries frame, command, pane, session, cwd');
  assert.strictEqual(cards(repo).length, 1);
  assert.strictEqual(watch(env, repo, stateDir, text, 20000).verdict, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(cards(repo).length, 1, 'no second card for the same prompt');
  fs.writeFileSync(text, 'prompt answered, normal screen\n');
  assert.strictEqual(watch(env, repo, stateDir, text, 21000).verdict, 'cleared');
  assert.strictEqual(cards(repo).length, 0);
  assert.strictEqual(watch(env, repo, stateDir, text, 22000).verdict, 'idle');
});

test('watch CLI: prompt gone after 5 s -> no card ever', () => {
  const { repo, env } = mkEnv();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const text = path.join(stateDir, 'pane.txt');
  fs.writeFileSync(text, PANE);
  watch(env, repo, stateDir, text, 0);
  watch(env, repo, stateDir, text, 5000);
  fs.writeFileSync(text, 'normal\n');
  assert.strictEqual(watch(env, repo, stateDir, text, 6000).verdict, 'idle');
  assert.strictEqual(cards(repo).length, 0);
});

test('watch CLI: the hook got there first (attention says BLOCKED) -> no second card', () => {
  const { live, repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  assert.strictEqual(cards(repo).length, 1);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const text = path.join(stateDir, 'pane.txt');
  fs.writeFileSync(text, PANE);
  watch(env, repo, stateDir, text, 0, ['--session', SID]);
  const hit = watch(env, repo, stateDir, text, 11000, ['--session', SID]);
  assert.strictEqual(hit.verdict, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(hit.card, null);
  assert.strictEqual(cards(repo).length, 1);
  assert.ok(fs.existsSync(attnFile(live)));
});

test('watch CLI: usage error exits 2', () => {
  const r = spawnSync('node', [WATCH, '--pane'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
});

// ---------- g1 review classes B, C, D ----------

function watchRaw(env, repo, stateDir, args) {
  return spawnSync('node', [WATCH, '--pane', '%7', '--cwd', repo, '--state-dir', stateDir, ...args], { encoding: 'utf8', env });
}
function firePrompt(env, repo, stateDir, extra = []) {
  const text = path.join(stateDir, 'pane.txt');
  fs.writeFileSync(text, PANE);
  watch(env, repo, stateDir, text, 0, extra);
  return watch(env, repo, stateDir, text, 11000, extra);
}

test('class B: the pane is gone (capture fails) -> the watcher closes the card it opened and drops its state, exit 3', () => {
  const { repo, env } = mkEnv();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const sock = path.join(stateDir, 'no-such.sock');
  assert.strictEqual(firePrompt(env, repo, stateDir, ['--socket', sock]).verdict, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(cards(repo).length, 1);
  const r = watchRaw(env, repo, stateDir, ['--socket', sock]);
  assert.strictEqual(r.status, 3, r.stderr);
  assert.strictEqual(cards(repo).length, 0, 'the card of a vanished pane is closed');
  assert.deepStrictEqual(fs.readdirSync(stateDir).filter((f) => f.endsWith('.json')), [], 'the state record is removed');
});

test('class C: the hook opened the card first, the watcher (same session) opens no second one', () => {
  const { repo, env } = mkEnv();
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const hit = firePrompt(env, repo, stateDir, ['--session', SID]);
  assert.strictEqual(hit.verdict, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(cards(repo).length, 1, 'one card for one prompt');
});

test('class C: the watcher opened the card first (same session and socket), the hook then opens no second one', () => {
  const { repo, env } = mkEnv({ TMUX: '/x/a.sock,4242,0' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  firePrompt(env, repo, stateDir, ['--session', SID, '--socket', '/x/a.sock']);
  assert.strictEqual(cards(repo).length, 1);
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  assert.strictEqual(cards(repo).length, 1, 'one card for one prompt');
});

test('class D: a run with a different --session than the one that opened the card still closes it', () => {
  const { repo, env } = mkEnv();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  firePrompt(env, repo, stateDir);
  assert.strictEqual(cards(repo).length, 1);
  const empty = path.join(stateDir, 'empty.txt');
  fs.writeFileSync(empty, 'normal screen\n');
  assert.strictEqual(watch(env, repo, stateDir, empty, 13000, ['--session', 'OTHER']).verdict, 'cleared');
  assert.strictEqual(cards(repo).length, 0, 'closed with the session that opened it, not the current one');
});

test('class D: two tmux servers with the same pane id keep separate state', () => {
  const { repo, env } = mkEnv();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const text = path.join(stateDir, 'pane.txt');
  fs.writeFileSync(text, PANE);
  watch(env, repo, stateDir, text, 0, ['--socket', '/x/a.sock']);
  watch(env, repo, stateDir, text, 0, ['--socket', '/x/b.sock']);
  assert.strictEqual(fs.readdirSync(stateDir).filter((f) => f.endsWith('.json')).length, 2);
});

// ---------- g2: a card is reused only by the same session and the same tmux socket ----------

test("g2: an old open card of session S1 is not reused by a new prompt of S2 in the same pane and cwd; S1's card stays", () => {
  const { repo, env } = mkEnv();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  firePrompt(env, repo, stateDir, ['--session', 'S1-died-without-sessionend']);
  assert.strictEqual(cards(repo).length, 1);
  feed(env, inRepo(PERM, repo));
  feed(env, inRepo(NOTIF, repo));
  const all = cards(repo);
  assert.strictEqual(all.length, 2, 'the new session gets its own card');
  assert.ok(all.some((c) => c.background.includes(`session ${SID}`)));
  assert.ok(all.some((c) => c.background.includes('session S1-died-without-sessionend')), "the other owner's card is left open");
});

test('g2: two tmux sockets with the same pane id and cwd get two cards; closing one leaves the other open', () => {
  const { repo, env } = mkEnv();
  const sA = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  const sB = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-state-'));
  assert.strictEqual(firePrompt(env, repo, sA, ['--session', SID, '--socket', '/x/a.sock']).verdict, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(firePrompt(env, repo, sB, ['--session', SID, '--socket', '/x/b.sock']).verdict, 'BLOCKED_ON_PERMISSION');
  assert.strictEqual(cards(repo).length, 2, 'one card per socket');
  const empty = path.join(sA, 'empty.txt');
  fs.writeFileSync(empty, 'normal screen\n');
  assert.strictEqual(watch(env, repo, sA, empty, 13000, ['--session', SID, '--socket', '/x/a.sock']).verdict, 'cleared');
  const left = cards(repo);
  assert.strictEqual(left.length, 1, 'the second prompt is still blocked and keeps its card');
  assert.ok(left[0].background.includes('socket /x/b.sock'));
});
