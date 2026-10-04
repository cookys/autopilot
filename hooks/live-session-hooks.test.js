/**
 * Tests for session-tasks.js (W1d) and awaiting-owner.js (W1e) — mods P1W row W1de.
 * Black-box: spawns the real hooks and replays the REAL payload lines captured by spike S10/S11
 * (Claude Code 2.1.289, interactive tmux): hooks/fixtures/live-session-s10-events.jsonl.
 * Fixture index map: 0 UPS, 1 PermReq Bash, 2 Notif permission_prompt, 3 PostToolUse Bash, 4 Stop,
 * 5 UPS, 6 PermReq Bash, 7 Notif, 8 UPS, 9 PermReq AskUserQuestion, 10 Notif, 11 PostToolUse AUQ,
 * 12 Stop, 13 Notif idle_prompt, 14 UPS, 15 PostToolUse ToolSearch, 16/18/20 TaskCreated 1/2/3,
 * 17/19/21 PostToolUse TaskCreate, 22 TaskUpdate->in_progress(1), 23 TaskCompleted(1),
 * 24 TaskUpdate->completed(1), 25 TaskList, 26 Stop, 27 Notif idle_prompt.
 *
 * RED record (before the hooks existed — hooks moved away, 2026-10-04): 24 tests, 0 pass, 24 fail.
 *
 * Run: node --test hooks/live-session-hooks.test.js
 * Mutation runs: LIVE_HOOKS_ROOT=<copy of repo root with a broken hooks/> (see report).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn, execFileSync } = require('child_process');

const ROOT = process.env.LIVE_HOOKS_ROOT || path.join(__dirname, '..');
const TASKS = path.join(ROOT, 'hooks', 'session-tasks.js');
const ATTN = path.join(ROOT, 'hooks', 'awaiting-owner.js');
const EV = fs.readFileSync(path.join(__dirname, 'fixtures', 'live-session-s10-events.jsonl'), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l));
const SID = EV[0].session_id;

function shm(prefix) {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix));
}
function mkEnv(extra = {}) {
  const live = shm('lsh-live-');
  fs.chmodSync(live, 0o700);
  return { live, env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-home-')), AUTOPILOT_LIVE_DIR: live, ...extra } };
}
function run(hook, payload, env) {
  const r = spawnSync('node', [hook], { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
  return r;
}
const tasksFile = (live, sid = SID) => path.join(live, 'tasks', `${sid}.json`);
const attnFile = (live, sid = SID) => path.join(live, 'attention', `${sid}.json`);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const feedT = (env, i, over = {}) => run(TASKS, { ...EV[i], ...over }, env);
const feedA = (env, i, over = {}) => run(ATTN, { ...EV[i], ...over }, env);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---------- W1e: attention ----------

test('A approve: PermissionRequest starts, Notification heartbeats, PostToolUse(Bash) ends', () => {
  const { live, env } = mkEnv();
  feedA(env, 0);
  assert.ok(!fs.existsSync(attnFile(live)));
  feedA(env, 1);
  const a = readJ(attnFile(live));
  assert.strictEqual(a.schema, 'autopilot.attention/1');
  assert.strictEqual(a.session_id, SID);
  assert.strictEqual(a.kind, 'permission');
  assert.strictEqual(a.tool_name, 'Bash');
  assert.strictEqual(a.summary, 'Bash: touch /tmp/s10-probe-a1.txt');
  assert.strictEqual(a.project_key, null);
  assert.ok(a.since && a.updated_at);
  sleepSync(15);
  feedA(env, 2);
  const b = readJ(attnFile(live));
  assert.strictEqual(b.since, a.since, 'heartbeat keeps since');
  assert.notStrictEqual(b.updated_at, a.updated_at);
  feedA(env, 3);
  assert.ok(!fs.existsSync(attnFile(live)), 'attention file must be REMOVED after its end signal');
});

test('A deny: no end event; the file lingers until the next UserPromptSubmit', () => {
  const { live, env } = mkEnv();
  feedA(env, 5); feedA(env, 6); feedA(env, 7);
  assert.strictEqual(readJ(attnFile(live)).kind, 'permission');
  feedA(env, 8);
  assert.ok(!fs.existsSync(attnFile(live)), 'UserPromptSubmit ends everything');
});

test('B AskUserQuestion: kind question with the question text; PostToolUse(AskUserQuestion) ends', () => {
  const { live, env } = mkEnv();
  feedA(env, 9);
  const a = readJ(attnFile(live));
  assert.strictEqual(a.kind, 'question');
  assert.strictEqual(a.tool_name, 'AskUserQuestion');
  assert.strictEqual(a.summary, 'Which color do you prefer?');
  feedA(env, 10);
  assert.strictEqual(readJ(attnFile(live)).kind, 'question');
  feedA(env, 11);
  assert.ok(!fs.existsSync(attnFile(live)));
});

test('C idle: Stop does NOT start idle; idle_prompt does; UserPromptSubmit ends it', () => {
  const { live, env } = mkEnv();
  feedA(env, 12);
  assert.ok(!fs.existsSync(attnFile(live)), 'Stop alone must not create an idle file');
  feedA(env, 13);
  const a = readJ(attnFile(live));
  assert.strictEqual(a.kind, 'idle');
  assert.strictEqual(a.tool_name, null);
  feedA(env, 14);
  assert.ok(!fs.existsSync(attnFile(live)));
});

test('Stop clears a lingering permission file (safety end)', () => {
  const { live, env } = mkEnv();
  feedA(env, 1);
  feedA(env, 4);
  assert.ok(!fs.existsSync(attnFile(live)));
});

test('idle_prompt never overrides a pending permission/question', () => {
  const { live, env } = mkEnv();
  feedA(env, 9);
  feedA(env, 13);
  assert.strictEqual(readJ(attnFile(live)).kind, 'question');
});

test('out of order: a late permission_prompt Notification cannot resurrect an ended wait', () => {
  const { live, env } = mkEnv();
  feedA(env, 1); feedA(env, 3); feedA(env, 2);
  assert.ok(!fs.existsSync(attnFile(live)));
});

test('PostToolUse of a DIFFERENT tool does not end the wait', () => {
  const { live, env } = mkEnv();
  feedA(env, 1);
  feedA(env, 15); // ToolSearch
  assert.strictEqual(readJ(attnFile(live)).kind, 'permission');
});

test('duplicate PermissionRequest keeps the original since', () => {
  const { live, env } = mkEnv();
  feedA(env, 1);
  const a = readJ(attnFile(live));
  sleepSync(15);
  feedA(env, 1);
  const b = readJ(attnFile(live));
  assert.strictEqual(b.since, a.since);
});

test('summary is redacted and truncated', () => {
  const { live, env } = mkEnv();
  const secret = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';
  feedA(env, 1, { tool_input: { command: `curl -H "x: ${secret}" --token=hunter2 ${'x'.repeat(400)}` } });
  const a = readJ(attnFile(live));
  assert.ok(!a.summary.includes(secret) && !a.summary.includes('hunter2'), a.summary);
  assert.ok(a.summary.includes('<REDACTED>'));
  assert.ok(a.summary.length <= 120);
});

test('attention: knob off, missing session_id, garbage stdin -> no file, exit 0', () => {
  const { live, env } = mkEnv({ AUTOPILOT_AWAITING_OWNER: 'off' });
  feedA(env, 1);
  assert.ok(!fs.existsSync(path.join(live, 'attention')));
  const on = mkEnv();
  run(ATTN, { ...EV[1], session_id: undefined }, on.env);
  run(ATTN, '{}', on.env);
  run(ATTN, 'not json', on.env);
  run(ATTN, '', on.env);
  assert.ok(!fs.existsSync(path.join(on.live, 'attention')));
});

test('attention: another session id is never touched', () => {
  const { live, env } = mkEnv();
  feedA(env, 1, { session_id: 'other-session' });
  const before = fs.readFileSync(attnFile(live, 'other-session'), 'utf8');
  feedA(env, 8); feedA(env, 9); feedA(env, 11); feedA(env, 4); // all for SID
  assert.strictEqual(fs.readFileSync(attnFile(live, 'other-session'), 'utf8'), before);
});

// ---------- W1d: tasks ----------

test('D replay: tasks fold, counts, current, replay idempotent', () => {
  const { live, env } = mkEnv();
  feedT(env, 14);   // UserPromptSubmit: ignored
  feedT(env, 15);   // ToolSearch: ignored
  assert.ok(!fs.existsSync(tasksFile(live)));
  feedT(env, 16);
  let s = readJ(tasksFile(live));
  assert.strictEqual(s.schema, 'autopilot.session-tasks/1');
  assert.strictEqual(s.session_id, SID);
  assert.strictEqual(s.project_key, null);
  assert.deepStrictEqual(s.tasks.map((t) => [t.id, t.subject, t.status]), [['1', 'alpha', 'pending']]);
  assert.deepStrictEqual(s.counts, { total: 1, completed: 0, in_progress: 0 });
  assert.strictEqual(s.current, null);
  const first = s.first_created_at;
  assert.ok(first && s.updated_at);
  const bytes = fs.readFileSync(tasksFile(live), 'utf8');
  feedT(env, 17);   // PostToolUse TaskCreate duplicate: no change, no rewrite
  assert.strictEqual(fs.readFileSync(tasksFile(live), 'utf8'), bytes);
  for (const i of [18, 19, 20, 21]) feedT(env, i);
  s = readJ(tasksFile(live));
  assert.deepStrictEqual(s.counts, { total: 3, completed: 0, in_progress: 0 });
  feedT(env, 22);   // alpha -> in_progress
  s = readJ(tasksFile(live));
  assert.deepStrictEqual(s.counts, { total: 3, completed: 0, in_progress: 1 });
  assert.deepStrictEqual(s.current, { id: '1', subject: 'alpha' });
  feedT(env, 23);   // TaskCompleted(1)
  s = readJ(tasksFile(live));
  assert.deepStrictEqual(s.counts, { total: 3, completed: 1, in_progress: 0 });
  assert.strictEqual(s.current, null);
  feedT(env, 24);   // TaskUpdate completed duplicate (from=in_progress != current)
  feedT(env, 25);   // TaskList snapshot
  s = readJ(tasksFile(live));
  assert.deepStrictEqual(s.tasks.map((t) => t.status), ['completed', 'pending', 'pending']);
  assert.strictEqual(s.first_created_at, first);
  const done = fs.readFileSync(tasksFile(live), 'utf8');
  for (let i = 16; i <= 25; i++) feedT(env, i); // full replay
  assert.strictEqual(fs.readFileSync(tasksFile(live), 'utf8'), done, 'replay must be byte-idempotent');
});

test('out of order: TaskCompleted before TaskCreated, stale in_progress after completed', () => {
  const { live, env } = mkEnv();
  feedT(env, 23);
  feedT(env, 16);
  feedT(env, 22);
  const s = readJ(tasksFile(live));
  assert.deepStrictEqual(s.tasks.map((t) => [t.id, t.subject, t.status]), [['1', 'alpha', 'completed']]);
  assert.strictEqual(s.current, null);
});

test('current = the most recently started in_progress task', () => {
  const { live, env } = mkEnv();
  for (const i of [16, 18, 20]) feedT(env, i);
  const upd = (id, from, to) => feedT(env, 22, { tool_input: { taskId: id, status: to }, tool_response: { success: true, taskId: id, updatedFields: ['status'], statusChange: { from, to } } });
  upd('1', 'pending', 'in_progress');
  upd('2', 'pending', 'in_progress');
  assert.deepStrictEqual(readJ(tasksFile(live)).current, { id: '2', subject: 'beta' });
  upd('2', 'in_progress', 'completed');
  assert.deepStrictEqual(readJ(tasksFile(live)).current, { id: '1', subject: 'alpha' });
  upd('3', 'pending', 'in_progress');
  assert.deepStrictEqual(readJ(tasksFile(live)).current, { id: '3', subject: 'gamma' });
  assert.deepStrictEqual(readJ(tasksFile(live)).counts, { total: 3, completed: 1, in_progress: 2 });
});

test('deleted tasks stay listed but leave the counts', () => {
  const { live, env } = mkEnv();
  feedT(env, 16); feedT(env, 18);
  feedT(env, 22, { tool_input: { taskId: '2', status: 'deleted' }, tool_response: { success: true, taskId: '2', updatedFields: ['status'], statusChange: { from: 'pending', to: 'deleted' } } });
  const s = readJ(tasksFile(live));
  assert.deepStrictEqual(s.tasks.map((t) => t.status), ['pending', 'deleted']);
  assert.deepStrictEqual(s.counts, { total: 1, completed: 0, in_progress: 0 });
});

test('TaskList with a stringified tool_response is accepted', () => {
  const { live, env } = mkEnv();
  feedT(env, 25, { tool_response: JSON.stringify(EV[25].tool_response) });
  const s = readJ(tasksFile(live));
  assert.strictEqual(s.tasks.length, 3);
  assert.deepStrictEqual(s.counts, { total: 3, completed: 1, in_progress: 0 });
});

test('project_key resolved from a git cwd via src/status/project-key.js', () => {
  const { live, env } = mkEnv();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lsh-repo-'));
  execFileSync('git', ['init', '-q', repo]);
  feedT(env, 16, { cwd: repo });
  const { scopeFromCwd } = require('../src/status/project-key.js');
  const want = scopeFromCwd(repo).project_key;
  assert.ok(want);
  assert.strictEqual(readJ(tasksFile(live)).project_key, want);
  assert.strictEqual(readJ(tasksFile(live)).cwd, repo);
});

test('tasks: knob off, missing session_id, garbage -> no file, exit 0', () => {
  const off = mkEnv({ AUTOPILOT_SESSION_TASKS: 'off' });
  feedT(off.env, 16);
  assert.ok(!fs.existsSync(path.join(off.live, 'tasks')));
  const on = mkEnv();
  run(TASKS, { ...EV[16], session_id: undefined }, on.env);
  run(TASKS, '{}', on.env); run(TASKS, 'garbage', on.env); run(TASKS, '', on.env);
  assert.ok(!fs.existsSync(path.join(on.live, 'tasks')));
});

test('tasks: a file from another session id is never modified', () => {
  const { live, env } = mkEnv();
  feedT(env, 16, { session_id: 'other-session' });
  const before = fs.readFileSync(tasksFile(live, 'other-session'), 'utf8');
  for (const i of [16, 18, 22, 23, 25]) feedT(env, i);
  assert.strictEqual(fs.readFileSync(tasksFile(live, 'other-session'), 'utf8'), before);
  assert.ok(fs.existsSync(tasksFile(live)));
});

test('tasks: corrupt existing file is replaced, never throws', () => {
  const { live, env } = mkEnv();
  fs.mkdirSync(path.join(live, 'tasks'), { recursive: true });
  fs.writeFileSync(tasksFile(live), '{not json');
  feedT(env, 16);
  assert.strictEqual(readJ(tasksFile(live)).tasks.length, 1);
});

function spawnAsync(hook, payload, env) {
  return new Promise((resolve) => {
    const c = spawn('node', [hook], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    c.on('close', (code) => resolve({ code, err }));
    c.stdin.end(JSON.stringify(payload));
  });
}

test('concurrency: N parallel hook invocations lose no update (tasks)', async () => {
  const { live, env } = mkEnv();
  const N = 16;
  const rs = await Promise.all(Array.from({ length: N }, (_, k) => spawnAsync(TASKS, {
    ...EV[16], task_id: String(k + 1), task_subject: `t${k + 1}`,
  }, env)));
  assert.ok(rs.every((r) => r.code === 0), JSON.stringify(rs));
  const s = readJ(tasksFile(live));
  assert.strictEqual(s.tasks.length, N, `lost updates: got ${s.tasks.length}/${N}`);
  assert.strictEqual(s.counts.total, N);
  assert.ok(!fs.readdirSync(path.join(live, 'tasks')).some((f) => f.includes('.lock') || f.includes('.tmp-')), 'no lock/tmp residue');
});

test('concurrency: attention end signal vs heartbeats leaves no resurrected file', async () => {
  const { live, env } = mkEnv();
  feedA(env, 1);
  await Promise.all([
    ...Array.from({ length: 6 }, () => spawnAsync(ATTN, EV[2], env)),
    spawnAsync(ATTN, EV[3], env),
  ]);
  // Heartbeats that ran after the end signal must not recreate the file.
  await Promise.all(Array.from({ length: 4 }, () => spawnAsync(ATTN, EV[2], env)));
  assert.ok(!fs.existsSync(attnFile(live)));
});

test('wiring: hooks.json registers both hooks with exact matchers, never Task/Agent', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const find = (ev, stem) => (h[ev] || []).filter((g) => g.hooks.some((x) => x.command.includes(`/hooks/${stem}.js`)));
  for (const ev of ['TaskCreated', 'TaskCompleted']) assert.strictEqual(find(ev, 'session-tasks').length, 1, ev);
  const pt = find('PostToolUse', 'session-tasks');
  assert.strictEqual(pt.length, 1);
  assert.strictEqual(pt[0].matcher, 'TaskCreate|TaskUpdate|TaskList');
  for (const ev of ['PermissionRequest', 'Notification', 'Stop', 'PostToolUse', 'UserPromptSubmit', 'SessionEnd']) {
    assert.strictEqual(find(ev, 'awaiting-owner').length, 1, ev);
  }
  for (const g of [...pt, ...find('PermissionRequest', 'awaiting-owner')]) assert.ok(!/(^|\|)(Task|Agent)(\||$)/.test(g.matcher || ''));
});
