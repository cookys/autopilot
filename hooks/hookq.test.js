/**
 * Tests for the HOOKQ row (mods P1W, plan R5.8): questions and merges are recorded by hooks, not by skill text.
 *   A. depth-0 AskUserQuestion (PreToolUse, exact matcher) opens decision/1; PostToolUse (hosted in audit-log.js) and
 *      SessionEnd (hosted in awaiting-owner.js) close only a file this session's hook opened.
 *   B. a successful merge into the integration branch, for a session whose marker has a root, runs the W1b writer
 *      DETACHED (hosted in audit-log.js's PostToolUse process), once per (root, HEAD sha).
 *
 * RED record: this file run against the base tree (w/int4 15966420, HOOKQ_ROOT=<base checkout>) -> see report run-w/hookq/red.txt
 * (counts copied below once recorded).
 * RED (base tree): 7 passed / 18 failed of 25 — the 7 are negative-only cases (nothing
 * written) and hygiene, which pass trivially without the feature; every positive path is red. The negatives are proven by
 * the mutation controls (run-w/hookq/mut-*.txt).
 *
 * Hygiene: every temp dir carries a per-run tag under /dev/shm (XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR,
 * AUTOPILOT_TASK_STATUS_DIR) or the OS tmp dir (HOME, AUTOPILOT_SESSION_MODE_DIR, repos); teardown removes them and
 * waits for the detached writers this run started (environ AUTOPILOT_TASK_STATUS_DIR check); the LAST test fails when
 * anything of this run survives. No watcher is ever started (AUTOPILOT_RUNS_WATCH_AUTOSTART=0).
 *
 * Run: node --test hooks/hookq.test.js      (HOOKQ_ROOT=<tree> aims it at another tree)
 */
'use strict';

const test = require('node:test');
const { afterEach, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = process.env.HOOKQ_ROOT || path.join(__dirname, '..');
const ASK = path.join(ROOT, 'hooks', 'ask-decision.js');
const AUDIT = path.join(ROOT, 'hooks', 'audit-log.js');
const ATTN = path.join(ROOT, 'hooks', 'awaiting-owner.js');
const OPEN = path.join(ROOT, 'scripts', 'open-decision.js');
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;

const RUN = crypto.randomBytes(4).toString('hex');
const SHM = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const created = [];
const track = (d) => { created.push(d); return d; };
function shm(prefix) { const d = track(fs.mkdtempSync(path.join(SHM, `${prefix}${RUN}-`))); fs.chmodSync(d, 0o700); return d; }
function tmp(prefix) { return track(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${RUN}-`))); }
const STATUS_PREFIX = path.join(SHM, `hq-status-${RUN}-`);

function ownPids() {
  const out = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const env = fs.readFileSync(`/proc/${name}/environ`, 'utf8').split('\0');
      const l = env.find((e) => e.startsWith('AUTOPILOT_TASK_STATUS_DIR='));
      if (l && l.slice('AUTOPILOT_TASK_STATUS_DIR='.length).startsWith(STATUS_PREFIX)) out.push(Number(name));
    } catch { /* gone */ }
  }
  return out;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function settle() { // detached writers finish by themselves; wait, then SIGKILL stragglers (environ-checked)
  for (let i = 0; i < 100 && ownPids().length; i++) sleep(100);
  for (const pid of ownPids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}
function teardown() { settle(); while (created.length) fs.rmSync(created.pop(), { recursive: true, force: true }); }
afterEach(teardown);
after(teardown);

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf8' }).trim();
function mkRepo(branch = 'develop') {
  const r = tmp('hq-repo-');
  execFileSync('git', ['init', '-q', '-b', branch, r]);
  git(r, 'commit', '-q', '--allow-empty', '-m', 'init');
  return r;
}
function mkEnv() {
  const live = shm('hq-live-');
  const xdg = shm('hq-xdg-');
  const status = fs.mkdtempSync(`${STATUS_PREFIX}`); track(status); fs.chmodSync(status, 0o700);
  const home = tmp('hq-home-');
  const markers = tmp('hq-markers-');
  const env = {
    ...process.env, HOME: home, XDG_RUNTIME_DIR: xdg, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_TASK_STATUS_DIR: status,
    AUTOPILOT_SESSION_MODE_DIR: markers, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
  };
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'AUTOPILOT_ASK_DECISION', 'AUTOPILOT_MERGE_TASK_STATUS', 'AUTOPILOT_ROOT_RUN_ID']) delete env[k];
  return { live, status, home, markers, env };
}
function marker(e, sid, root, level = null) {
  fs.writeFileSync(path.join(e.markers, `${sid}.json`), JSON.stringify({
    level, root_run_id: root, expires_at: new Date(Date.now() + 3600e3).toISOString(),
  }));
}
function run(script, payload, env, args = []) {
  const r = spawnSync('node', [script, ...args], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `exit 0 expected, got ${r.status}: ${r.stderr}`);
  return r;
}
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const decDir = (repo) => path.join(repo, '.git', 'autopilot', 'decisions');
const decFiles = (repo) => (fs.existsSync(decDir(repo)) ? fs.readdirSync(decDir(repo)).filter((f) => f.endsWith('.json')).sort() : []);

const q = (text, labels) => ({ question: text, header: 'h', multiSelect: false, options: (labels || []).map((l) => ({ label: l, description: `${l} desc` })) });
const pre = (repo, sid, questions, over = {}) => ({
  session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', cwd: repo, tool_input: { questions }, ...over,
});
const postAsk = (repo, sid, over = {}) => ({
  session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', cwd: repo,
  tool_input: { questions: [q('x', ['a', 'b'])] }, tool_response: { answers: {} }, ...over,
});

// ---------- wiring ----------

test('wiring: ONE new PreToolUse entry with the exact matcher AskUserQuestion; no new PostToolUse process; classified', () => {
  const groups = HOOKS.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('/hooks/ask-decision.js')));
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].matcher, 'AskUserQuestion');
  const postCmds = HOOKS.PostToolUse.filter((g) => !g.matcher || g.matcher === '.*').flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(!postCmds.some((c) => c.includes('ask-decision') || c.includes('merge-task-status')), 'hosted in audit-log.js, no own process');
  assert.strictEqual(postCmds.length, 7);
  const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', 'hook-classes.json'), 'utf8'));
  assert.ok(JSON.stringify(classes).includes('"ask-decision"'));
  const readme = fs.readFileSync(path.join(ROOT, 'hooks', 'README.md'), 'utf8');
  assert.ok(readme.includes('AUTOPILOT_ASK_DECISION') && readme.includes('AUTOPILOT_MERGE_TASK_STATUS'));
});

// ---------- A: AskUserQuestion opens / closes a decision file ----------

test('A: 1 question with 3 options -> decision/1 with question, options, not_authorized null, root, session, source', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a1', 'job-a1');
  run(ASK, pre(repo, 'sess-a1', [q('Ship it now?', ['yes', 'no', 'later'])]), e.env);
  const files = decFiles(repo);
  assert.strictEqual(files.length, 1, files.join());
  assert.match(files[0], /--job-a1\.json$/);
  const d = readJ(path.join(decDir(repo), files[0]));
  assert.strictEqual(d.schema, 'autopilot.decision/1');
  assert.strictEqual(d.question, 'Ship it now?');
  assert.deepStrictEqual(d.options, ['yes', 'no', 'later']);
  assert.strictEqual(d.not_authorized, null);
  assert.strictEqual(d.root_run_id, 'job-a1');
  assert.strictEqual(d.opened_by_session, 'sess-a1');
  assert.strictEqual(d.source, 'ask_user_question');
  assert.ok(Number.isFinite(Date.parse(d.opened_at)));
});

test('A: 3 questions -> first question text + （共 3 題）, first question options; single option -> options null', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a2', 'job-a2');
  run(ASK, pre(repo, 'sess-a2', [q('First?', ['x', 'y']), q('Second?', ['p', 'q']), q('Third?', ['m', 'n'])]), e.env);
  let d = readJ(path.join(decDir(repo), decFiles(repo)[0]));
  assert.strictEqual(d.question, 'First?（共 3 題）');
  assert.deepStrictEqual(d.options, ['x', 'y']);
  run(ASK, pre(repo, 'sess-a2', [q('Only one option?', ['lonely'])]), e.env);
  d = readJ(path.join(decDir(repo), decFiles(repo)[0]));
  assert.strictEqual(d.options, null);
  assert.strictEqual(decFiles(repo).length, 1, 'same session replaces its own earlier file');
});

test('A: a subagent payload (agent_id) opens nothing; neither does a payload without a session id or a question', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a3', 'job-a3');
  run(ASK, pre(repo, 'sess-a3', [q('Sub?', ['a', 'b'])], { agent_id: 'agent-1', agent_type: 'general-purpose' }), e.env);
  run(ASK, pre(repo, '', [q('No session?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-a3', []), e.env);
  run(ASK, pre(repo, 'sess-a3', [q('Other tool?', ['a', 'b'])], { tool_name: 'Read' }), e.env);
  assert.deepStrictEqual(decFiles(repo), []);
});

test('A: PostToolUse (hosted in audit-log.js) closes the file; a subagent PostToolUse and a different tool do not', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a4', 'job-a4');
  run(ASK, pre(repo, 'sess-a4', [q('Close me?', ['a', 'b'])]), e.env);
  assert.strictEqual(decFiles(repo).length, 1);
  run(AUDIT, postAsk(repo, 'sess-a4', { tool_name: 'Read' }), e.env);
  run(AUDIT, postAsk(repo, 'sess-a4', { agent_id: 'agent-1' }), e.env);
  assert.strictEqual(decFiles(repo).length, 1, 'unanswered / foreign events keep the question open');
  run(AUDIT, postAsk(repo, 'sess-a4'), e.env);
  assert.deepStrictEqual(decFiles(repo), []);
});

test('A: SessionEnd (hosted in awaiting-owner.js) closes the file', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a5', 'job-a5');
  run(ASK, pre(repo, 'sess-a5', [q('End?', ['a', 'b'])]), e.env);
  run(ATTN, { session_id: 'sess-a5', hook_event_name: 'SessionEnd', cwd: repo }, e.env);
  assert.deepStrictEqual(decFiles(repo), []);
});

test('A: an unanswered question stays — a Bash PostToolUse, however much later, never closes it', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a6', 'job-a6');
  run(ASK, pre(repo, 'sess-a6', [q('Still there?', ['a', 'b'])]), e.env);
  run(AUDIT, { session_id: 'sess-a6', hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' }, tool_response: {} }, e.env);
  assert.strictEqual(decFiles(repo).length, 1);
});

test('A: a hand-opened file (open-decision.js, no source) is never overwritten or closed by the hook', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a7', 'job-a7');
  const env = { ...e.env, AUTOPILOT_SESSION_ID: 'sess-a7' };
  const r = spawnSync('node', [OPEN, 'open', '--question', 'By hand', '--option', 'one', '--option', 'two', '--cwd', repo], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  const f = path.join(decDir(repo), decFiles(repo)[0]);
  const before = fs.readFileSync(f, 'utf8');
  assert.ok(!('source' in JSON.parse(before)));
  run(ASK, pre(repo, 'sess-a7', [q('Hook question?', ['a', 'b'])]), e.env);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before, 'hand-opened file untouched by the open leg');
  run(AUDIT, postAsk(repo, 'sess-a7'), e.env);
  run(ATTN, { session_id: 'sess-a7', hook_event_name: 'SessionEnd', cwd: repo }, e.env);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before, 'and by the close legs');
});

test('A: the same session replaced the hook\'s file by hand (--replace, no source) -> the close legs leave it', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a8', 'job-a8');
  run(ASK, pre(repo, 'sess-a8', [q('Hook first?', ['a', 'b'])]), e.env);
  const env = { ...e.env, AUTOPILOT_SESSION_ID: 'sess-a8' };
  const r = spawnSync('node', [OPEN, 'open', '--replace', '--question', 'Then by hand', '--cwd', repo], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  const f = path.join(decDir(repo), decFiles(repo)[0]);
  const before = fs.readFileSync(f, 'utf8');
  assert.ok(!('source' in JSON.parse(before)) && JSON.parse(before).opened_by_session === 'sess-a8');
  run(AUDIT, postAsk(repo, 'sess-a8'), e.env);
  run(ATTN, { session_id: 'sess-a8', hook_event_name: 'SessionEnd', cwd: repo }, e.env);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before, 'same session id, but no source: not the hook\'s file');
});

test('A: session A never closes session B\'s file (other roots, and the same root after B replaced A)', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-A', 'job-A'); marker(e, 'sess-B', 'job-B');
  run(ASK, pre(repo, 'sess-A', [q('A asks?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-B', [q('B asks?', ['a', 'b'])]), e.env);
  assert.strictEqual(decFiles(repo).length, 2);
  run(AUDIT, postAsk(repo, 'sess-A'), e.env);
  const left = decFiles(repo);
  assert.strictEqual(left.length, 1);
  assert.match(left[0], /--job-B\.json$/);
  // same root: B (hook-opened) replaces A's file; A's close must leave it
  marker(e, 'sess-C', 'job-shared'); marker(e, 'sess-D', 'job-shared');
  run(ASK, pre(repo, 'sess-C', [q('C asks?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-D', [q('D asks?', ['a', 'b'])]), e.env);
  run(AUDIT, postAsk(repo, 'sess-C'), e.env);
  const shared = decFiles(repo).find((f) => /--job-shared\.json$/.test(f));
  assert.ok(shared, 'D\'s file survives C\'s close');
  assert.strictEqual(readJ(path.join(decDir(repo), shared)).opened_by_session, 'sess-D');
});

test('A: knob AUTOPILOT_ASK_DECISION=off -> nothing opened, nothing closed', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a9', 'job-a9');
  run(ASK, pre(repo, 'sess-a9', [q('Off?', ['a', 'b'])]), { ...e.env, AUTOPILOT_ASK_DECISION: 'off' });
  assert.deepStrictEqual(decFiles(repo), []);
  run(ASK, pre(repo, 'sess-a9', [q('On?', ['a', 'b'])]), e.env);
  run(AUDIT, postAsk(repo, 'sess-a9'), { ...e.env, AUTOPILOT_ASK_DECISION: 'off' });
  assert.strictEqual(decFiles(repo).length, 1, 'knob off: the close leg is off too');
});

test('A: no marker -> the unbound scope; fail-open (not a git repo, garbage stdin) exits 0 and writes nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  run(ASK, pre(repo, 'sess-a10', [q('Unbound?', ['a', 'b'])]), e.env);
  const f = decFiles(repo);
  assert.strictEqual(f.length, 1);
  assert.ok(!f[0].includes('--'), 'unbound scope key has no root segment');
  assert.strictEqual(readJ(path.join(decDir(repo), f[0])).root_run_id, null);
  const notRepo = tmp('hq-plain-');
  const r = run(ASK, pre(notRepo, 'sess-a10', [q('Nowhere?', ['a', 'b'])]), e.env);
  assert.ok(!fs.existsSync(path.join(notRepo, '.git')));
  assert.ok(/fail-open/.test(r.stderr) || r.stderr === '');
  const g = spawnSync('node', [ASK], { input: '{not json', encoding: 'utf8', env: e.env });
  assert.strictEqual(g.status, 0);
});

test('A: latency of the AskUserQuestion PreToolUse entry is recorded (informational, bound 1.5 s median)', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-lat', 'job-lat');
  const samples = [];
  for (let i = 0; i < 9; i++) {
    const t = process.hrtime.bigint();
    run(ASK, pre(repo, 'sess-lat', [q(`Latency ${i}?`, ['a', 'b'])]), e.env);
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const median = samples[4];
  process.stdout.write(`# ask-decision PreToolUse latency ms (sorted): ${samples.map((x) => x.toFixed(0)).join(' ')} median=${median.toFixed(0)}\n`);
  assert.ok(median < 1500);
});

// ---------- B: merge into the integration branch -> task-status input ----------

const lib = () => require(path.join(ROOT, 'hooks', 'merge-task-status-lib.js'));

test('B: classify — merge forms count, quoted / heredoc text and merge --abort do not', () => {
  const { classify, mask } = lib();
  const yes = ['git merge feat', 'git merge --no-ff -m "msg" w/x', 'git -C /a/b merge x', 'git pull', 'git pull --rebase origin develop',
    'cd /r && git merge x', 'gh pr merge 5 --squash', 'git push origin develop', 'git push origin HEAD:develop', 'git add . && git commit -m x && git merge y',
    'git -c user.name=t merge y'];
  const no = ['echo "git merge x"', "echo 'git pull'", 'cat <<EOF\ngit merge x\nEOF', 'cat <<\'EOF\'\ngh pr merge 1\nEOF', 'git merge --abort', 'git merge --quit',
    'git push origin feat', 'git status', 'git commit -m "merge develop into x"', 'git log --merges', 'echo merge', '# git merge x'];
  for (const c of yes) assert.ok(classify(c, ['develop', 'main']), `should match: ${JSON.stringify(c)}`);
  for (const c of no) assert.strictEqual(classify(c, ['develop', 'main']), null, `should NOT match: ${JSON.stringify(c)}`);
  assert.strictEqual(mask('echo "a b"').length, 'echo "a b"'.length);
});

function bashPost(repo, sid, command, over = {}) {
  return { session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: repo, tool_input: { command }, tool_response: { stdout: 'ok', stderr: '' }, ...over };
}
const stampFile = (e, root) => path.join(e.live, 'merge-task-status', `${root}.json`);
const bundle = (e, root) => path.join(e.status, `${root}.json`);
function waitFor(file, ms = 20000) { const t = Date.now(); while (!fs.existsSync(file) && Date.now() - t < ms) sleep(100); return fs.existsSync(file); }
function mergeFeature(repo, name = 'feat') {
  git(repo, 'checkout', '-q', '-b', name);
  fs.writeFileSync(path.join(repo, `${name}.txt`), name);
  git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', name);
  git(repo, 'checkout', '-q', 'develop');
  git(repo, 'merge', '-q', '--no-ff', '-m', `merge ${name}`, name);
}

test('B: plain-session marker with a root + `git merge` on develop -> the bundle is written (detached) under AUTOPILOT_TASK_STATUS_DIR', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b1', 'job-b1');
  mergeFeature(repo);
  const t = Date.now();
  run(AUDIT, bashPost(repo, 'sess-b1', 'git merge --no-ff feat'), e.env);
  const hookMs = Date.now() - t;
  assert.ok(fs.existsSync(stampFile(e, 'job-b1')), 'stamp written before the spawn');
  assert.strictEqual(readJ(stampFile(e, 'job-b1')).sha, git(repo, 'rev-parse', 'HEAD'));
  assert.ok(waitFor(bundle(e, 'job-b1')), 'writer produced the bundle');
  const b = readJ(bundle(e, 'job-b1'));
  assert.ok(JSON.stringify(b).includes('job-b1'));
  process.stdout.write(`# merge-task-status hook wall ms (merge-form, detached writer): ${hookMs}\n`);
});

test('B: a subagent (agent_id) merging also fires; `git push origin develop` and `gh pr merge` too', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b2', 'job-b2');
  mergeFeature(repo);
  run(AUDIT, bashPost(repo, 'sess-b2', 'git push origin develop', { agent_id: 'foreman-1' }), e.env);
  assert.ok(waitFor(bundle(e, 'job-b2')));
  const e2 = mkEnv(); const repo2 = mkRepo();
  marker(e2, 'sess-b2b', 'job-b2b');
  run(AUDIT, bashPost(repo2, 'sess-b2b', 'gh pr merge 7 --squash'), e2.env);
  assert.ok(fs.existsSync(stampFile(e2, 'job-b2b')));
});

test('B: the same command on a feature branch (current branch != integration target) writes nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b3', 'job-b3');
  git(repo, 'checkout', '-q', '-b', 'feature-x');
  run(AUDIT, bashPost(repo, 'sess-b3', 'git merge develop'), e.env);
  sleep(500);
  assert.ok(!fs.existsSync(stampFile(e, 'job-b3')) && !fs.existsSync(bundle(e, 'job-b3')));
});

test('B: no root (no marker, or an expired one) -> nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  run(AUDIT, bashPost(repo, 'sess-b4', 'git merge feat'), e.env);
  fs.writeFileSync(path.join(e.markers, 'sess-b4x.json'), JSON.stringify({ level: null, root_run_id: 'job-b4x', expires_at: new Date(Date.now() - 1000).toISOString() }));
  run(AUDIT, bashPost(repo, 'sess-b4x', 'git merge feat'), e.env);
  fs.writeFileSync(path.join(e.markers, 'sess-b4y.json'), JSON.stringify({ level: null, root_run_id: null, expires_at: new Date(Date.now() + 1e6).toISOString() }));
  run(AUDIT, bashPost(repo, 'sess-b4y', 'git merge feat'), e.env);
  sleep(500);
  assert.deepStrictEqual(fs.existsSync(path.join(e.live, 'merge-task-status')) ? fs.readdirSync(path.join(e.live, 'merge-task-status')) : [], []);
  assert.deepStrictEqual(fs.readdirSync(e.status), []);
});

test('B: a failed command (is_error / interrupted / non-zero exit field) writes nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b5', 'job-b5');
  for (const resp of [{ is_error: true }, { interrupted: true }, { exit_code: 1 }]) {
    run(AUDIT, bashPost(repo, 'sess-b5', 'git merge feat', { tool_response: resp }), e.env);
  }
  sleep(500);
  assert.ok(!fs.existsSync(stampFile(e, 'job-b5')) && !fs.existsSync(bundle(e, 'job-b5')));
});

test('B: a merge mentioned inside a heredoc / echo / quoted string writes nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b6', 'job-b6');
  for (const c of ['echo "git merge feat"', 'cat <<EOF\ngit merge feat\nEOF', "git commit -m 'git pull then gh pr merge'"]) {
    run(AUDIT, bashPost(repo, 'sess-b6', c), e.env);
  }
  sleep(500);
  assert.ok(!fs.existsSync(stampFile(e, 'job-b6')) && !fs.existsSync(bundle(e, 'job-b6')));
});

test('B: repeating at the same HEAD writes once; a new HEAD writes again', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b7', 'job-b7');
  mergeFeature(repo);
  run(AUDIT, bashPost(repo, 'sess-b7', 'git merge feat'), e.env);
  assert.ok(waitFor(bundle(e, 'job-b7')));
  settle();
  const first = fs.statSync(bundle(e, 'job-b7')).mtimeMs;
  fs.unlinkSync(bundle(e, 'job-b7'));
  run(AUDIT, bashPost(repo, 'sess-b7', 'git merge feat'), e.env);
  sleep(1500);
  assert.ok(!fs.existsSync(bundle(e, 'job-b7')), 'same (root, HEAD): no second write');
  mergeFeature(repo, 'feat2');
  run(AUDIT, bashPost(repo, 'sess-b7', 'git merge feat2'), e.env);
  assert.ok(waitFor(bundle(e, 'job-b7')), 'new HEAD: written again');
  assert.ok(fs.statSync(bundle(e, 'job-b7')).mtimeMs >= first);
});

test('B: knob AUTOPILOT_MERGE_TASK_STATUS=off -> nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b8', 'job-b8');
  run(AUDIT, bashPost(repo, 'sess-b8', 'git merge feat'), { ...e.env, AUTOPILOT_MERGE_TASK_STATUS: 'off' });
  sleep(500);
  assert.ok(!fs.existsSync(stampFile(e, 'job-b8')) && !fs.existsSync(bundle(e, 'job-b8')));
});

test('B: integration target follows origin/HEAD (a repo whose default is main)', () => {
  const e = mkEnv(); const repo = mkRepo('main');
  marker(e, 'sess-b9', 'job-b9');
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  run(AUDIT, bashPost(repo, 'sess-b9', 'git pull'), e.env);
  assert.ok(fs.existsSync(stampFile(e, 'job-b9')), 'on main with origin/HEAD=main: the target');
});

test('B: the audit log still records the command and the hosted legs never fail the hook (garbage cwd)', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-b10', 'job-b10');
  const r = run(AUDIT, bashPost(path.join(repo, 'does-not-exist'), 'sess-b10', 'git merge feat'), e.env);
  assert.strictEqual(r.status, 0);
  const log = path.join(e.home, '.claude', 'bash-commands.log');
  assert.ok(fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('git merge feat'));
});

test('hygiene: nothing of this run survives teardown (detached writers stopped, dirs removed)', () => {
  teardown();
  assert.deepStrictEqual(ownPids(), []);
  for (const d of fs.readdirSync(SHM)) assert.ok(!d.includes(`-${RUN}-`), `leftover in ${SHM}: ${d}`);
  for (const d of fs.readdirSync(os.tmpdir())) assert.ok(!d.includes(`-${RUN}-`), `leftover in ${os.tmpdir()}: ${d}`);
});
