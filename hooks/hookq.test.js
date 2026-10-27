/**
 * Tests for the HOOKQ row (mods P1W, plan R5.8): questions and merges are recorded by hooks, not by skill text.
 *   A. depth-0 AskUserQuestion (PreToolUse, exact matcher) adds an entry to decision/2; PostToolUse (hosted in audit-log.js) and
 *      SessionEnd (hosted in awaiting-owner.js) close only the entry this session's hook added.
 *   B. a successful merge into the integration branch, for a session whose marker has a root, runs the W1b writer
 *      DETACHED (hosted in audit-log.js's PostToolUse process), once per (root, HEAD sha).
 *
 * RED record: this file run against the base tree (w/int4 15966420, HOOKQ_ROOT=<base checkout>) -> see report run-w/hookq/red.txt
 * (counts copied below once recorded).
 * RED (base tree): 7 passed / 18 failed of 25 — the 7 are negative-only cases (nothing
 * written) and hygiene, which pass trivially without the feature; every positive path is red. The negatives are proven by
 * the mutation controls (run-w/hookq/mut-*.txt).
 *
 * INT5 follow-ups (mods P1W INT5): +2 tests (audit-log in the `.*` PostToolUse group + README matcher; markerRoot parity with the
 * shared readSessionRecord). RED before the change: 25 passed / 2 failed of 27 (run-w/int5/red.txt); GREEN 27/27.
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

const entriesOf = (repo, file) => readJ(path.join(decDir(repo), file)).decisions;
const allEntries = (repo) => decFiles(repo).flatMap((f) => entriesOf(repo, f));

const q = (text, labels) => ({ question: text, header: 'h', multiSelect: false, options: (labels || []).map((l) => ({ label: l, description: `${l} desc` })) });
const pre = (repo, sid, questions, over = {}) => ({
  session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', cwd: repo, tool_input: { questions }, ...over,
});
const postAsk = (repo, sid, over = {}) => ({
  session_id: sid, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', cwd: repo,
  tool_input: { questions: [q('x', ['a', 'b'])] }, tool_response: { answers: {} }, ...over,
});

// ---------- wiring ----------

const { parseChainCommand } = require('../scripts/lib/chain-command.js');
// A hook command "hosts" a stem when it is that hook's own script or a post-tool-chain registration naming it
// (the shared parser expands the chain; the depth-0 ruling of the guard port folds intent-capture, audit-log and log-error into one process).
const hostsStem = (cmd, stem) => {
  const chain = parseChainCommand(cmd);
  return chain ? chain.members.includes(stem) : cmd.includes(`/hooks/${stem}.js`);
};

test('wiring: ONE new PreToolUse entry with the exact matcher AskUserQuestion; no new PostToolUse process; classified', () => {
  const groups = HOOKS.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('/hooks/ask-decision.js')));
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].matcher, 'AskUserQuestion');
  const postCmds = HOOKS.PostToolUse.filter((g) => !g.matcher || g.matcher === '.*').flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(!postCmds.some((c) => c.includes('ask-decision') || c.includes('merge-task-status')), 'hosted in audit-log.js, no own process');
  // 5 = the former 7 minus the 2 folded into post-tool-chain (intent-capture + audit-log + log-error in one process; guard port, depth-0 ruling (a))
  assert.strictEqual(postCmds.length, 5);
  const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', 'hook-classes.json'), 'utf8'));
  assert.ok(JSON.stringify(classes).includes('"ask-decision"'));
  const readme = fs.readFileSync(path.join(ROOT, 'hooks', 'README.md'), 'utf8');
  assert.ok(readme.includes('AUTOPILOT_ASK_DECISION') && readme.includes('AUTOPILOT_MERGE_TASK_STATUS'));
});

// ---------- A: AskUserQuestion opens / closes a decision file ----------

test('A: 1 question with 3 options -> a decision/2 entry with question, options (label + description), root, session, source, origin', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a1', 'job-a1');
  run(ASK, pre(repo, 'sess-a1', [q('Ship it now?', ['yes', 'no', 'later'])]), e.env);
  const files = decFiles(repo);
  assert.strictEqual(files.length, 1, files.join());
  assert.match(files[0], /--job-a1\.json$/);
  const d = readJ(path.join(decDir(repo), files[0]));
  assert.strictEqual(d.schema, 'autopilot.decision/2');
  assert.strictEqual(d.root_run_id, 'job-a1');
  assert.strictEqual(d.decisions.length, 1);
  const e1 = d.decisions[0];
  assert.match(e1.id, /^d-[0-9a-f]{8}$/);
  assert.strictEqual(e1.question, 'Ship it now?');
  assert.deepStrictEqual(e1.options, [{ label: 'yes', description: 'yes desc' }, { label: 'no', description: 'no desc' }, { label: 'later', description: 'later desc' }]);
  assert.strictEqual(e1.opened_by_session, 'sess-a1');
  assert.strictEqual(e1.origin, 'ask_user_question');
  assert.strictEqual(e1.source, 'depth-0 AskUserQuestion');
  assert.ok(Number.isFinite(Date.parse(e1.opened_at)));
});

test('A: 3 questions -> first question text + （共 3 題）, first question options; single option -> options null', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a2', 'job-a2');
  run(ASK, pre(repo, 'sess-a2', [q('First?', ['x', 'y']), q('Second?', ['p', 'q']), q('Third?', ['m', 'n'])]), e.env);
  let d = allEntries(repo);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].question, 'First?（共 3 題）');
  assert.deepStrictEqual(d[0].options.map((o) => o.label), ['x', 'y']);
  run(ASK, pre(repo, 'sess-a2', [q('Only one option?', ['lonely'])]), e.env);
  d = allEntries(repo);
  assert.strictEqual(d.length, 1, 'same session supersedes its own earlier unanswered entry');
  assert.strictEqual(d[0].options, null);
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

test('A: a hand-opened entry (open-decision.js, no origin) is never overwritten or closed by the hook; the hook\'s entry sits beside it', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a7', 'job-a7');
  const env = { ...e.env, AUTOPILOT_SESSION_ID: 'sess-a7' };
  const r = spawnSync('node', [OPEN, 'open', '--not-authorized', 'irreversible', '--question', 'By hand', '--option', 'one', '--option', 'two', '--cwd', repo], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  const hand = allEntries(repo);
  assert.strictEqual(hand.length, 1);
  assert.ok(!('origin' in hand[0]));
  run(ASK, pre(repo, 'sess-a7', [q('Hook question?', ['a', 'b'])]), e.env);
  assert.deepStrictEqual(allEntries(repo).map((x) => x.question).sort(), ['By hand', 'Hook question?'], 'the hook ADDS: the hand-opened entry is still there');
  assert.deepStrictEqual(allEntries(repo).find((x) => x.question === 'By hand'), hand[0], 'untouched by the open leg');
  run(AUDIT, postAsk(repo, 'sess-a7'), e.env);
  run(ATTN, { session_id: 'sess-a7', hook_event_name: 'SessionEnd', cwd: repo }, e.env);
  assert.deepStrictEqual(allEntries(repo), hand, 'the close legs remove the hook\'s entry and leave the hand-opened one');
});

test('A: the same session adds an entry by hand next to the hook\'s -> the close legs remove only the hook\'s', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-a8', 'job-a8');
  run(ASK, pre(repo, 'sess-a8', [q('Hook first?', ['a', 'b'])]), e.env);
  const env = { ...e.env, AUTOPILOT_SESSION_ID: 'sess-a8' };
  const r = spawnSync('node', [OPEN, 'open', '--not-authorized', 'irreversible', '--question', 'Then by hand', '--cwd', repo], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  const both = allEntries(repo);
  assert.strictEqual(both.length, 2);
  const hand = both.find((x) => x.question === 'Then by hand');
  assert.ok(!('origin' in hand) && hand.opened_by_session === 'sess-a8');
  run(AUDIT, postAsk(repo, 'sess-a8'), e.env);
  run(ATTN, { session_id: 'sess-a8', hook_event_name: 'SessionEnd', cwd: repo }, e.env);
  assert.deepStrictEqual(allEntries(repo), [hand], 'same session id, but no origin: not the hook\'s entry');
});

test('A: session A never closes session B\'s entry (other roots, and the same root: both entries coexist, each closes only its own)', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-A', 'job-A'); marker(e, 'sess-B', 'job-B');
  run(ASK, pre(repo, 'sess-A', [q('A asks?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-B', [q('B asks?', ['a', 'b'])]), e.env);
  assert.strictEqual(decFiles(repo).length, 2);
  run(AUDIT, postAsk(repo, 'sess-A'), e.env);
  const left = decFiles(repo);
  assert.strictEqual(left.length, 1);
  assert.match(left[0], /--job-B\.json$/);
  // same root: C and D (both hook-opened) coexist in ONE file; C's close removes C's entry and leaves D's
  marker(e, 'sess-C', 'job-shared'); marker(e, 'sess-D', 'job-shared');
  run(ASK, pre(repo, 'sess-C', [q('C asks?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-D', [q('D asks?', ['a', 'b'])]), e.env);
  const sharedFile = decFiles(repo).find((f) => /--job-shared\.json$/.test(f));
  assert.deepStrictEqual(entriesOf(repo, sharedFile).map((x) => x.opened_by_session).sort(), ['sess-C', 'sess-D'], 'D did not overwrite C');
  run(AUDIT, postAsk(repo, 'sess-C'), e.env);
  const shared = decFiles(repo).find((f) => /--job-shared\.json$/.test(f));
  assert.ok(shared, 'D\'s file survives C\'s close');
  assert.deepStrictEqual(entriesOf(repo, shared).map((x) => x.opened_by_session), ['sess-D']);
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

test('wiring: audit-log.js sits in the `.*` PostToolUse group (the AskUserQuestion close leg is hosted there); README matcher wording agrees', () => {
  const g = HOOKS.PostToolUse.filter((x) => x.hooks.some((h) => hostsStem(h.command, 'audit-log')));
  assert.strictEqual(g.length, 1, 'audit-log.js is hosted in exactly one PostToolUse group (directly or via the chain argv)');
  assert.strictEqual(g[0].hooks.filter((h) => hostsStem(h.command, 'audit-log')).length, 1, 'and exactly one process in that group hosts it');
  assert.strictEqual(g[0].matcher, '.*', 'the close leg needs every tool, AskUserQuestion included');
  const readme = fs.readFileSync(path.join(ROOT, 'hooks', 'README.md'), 'utf8');
  const row = readme.split('\n').find((l) => /^\| audit-log \| PostToolUse \|/.test(l));
  assert.ok(row, 'audit-log row in the Tier A table');
  assert.ok(/^\| audit-log \| PostToolUse \| \.\* \|/.test(row), 'README matcher column is `.*`, as in hooks.json');
});

test('A: markerRoot reads the marker through the shared plain-inclusive reader (expiry, normalised id, level validity decided there)', () => {
  const e = mkEnv();
  const wr = (name, rec) => fs.writeFileSync(path.join(e.markers, `${name}.json`), JSON.stringify(rec));
  const future = new Date(Date.now() + 3600e3).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  wr('mr-live', { level: null, root_run_id: 'job-live', expires_at: future });
  wr('mr-exp', { level: null, root_run_id: 'job-exp', expires_at: past });
  wr('mr_odd_id', { level: null, root_run_id: 'job-odd', expires_at: future });
  wr('mr-orch', { level: 'l5', root_run_id: 'job-orch', expires_at: future });
  wr('mr-badlevel', { level: 'zz', root_run_id: 'job-bad', expires_at: future });
  wr('mr-badroot', { level: null, root_run_id: '../x', expires_at: future });
  const shared = (sid) => {
    // the shared reader's own decision for this session, env-keyed, in a child (so this process env stays clean)
    const code = "const m=require(process.argv[1]).readSessionRecord();process.stdout.write(JSON.stringify(m&&typeof m.root_run_id==='string'&&/^[A-Za-z0-9._-]+$/.test(m.root_run_id)&&m.root_run_id!=='.'&&m.root_run_id!=='..'?m.root_run_id:null))";
    return JSON.parse(execFileSync('node', ['-e', code, path.join(ROOT, 'scripts', 'session-mode.js')], { env: { ...e.env, AUTOPILOT_SESSION_ID: sid }, encoding: 'utf8' }));
  };
  const prev = process.env.AUTOPILOT_SESSION_MODE_DIR;
  process.env.AUTOPILOT_SESSION_MODE_DIR = e.markers;
  try {
    const { markerRoot } = require(path.join(ROOT, 'hooks', 'ask-decision.js'));
    const cases = [['mr-live', 'job-live'], ['mr-exp', null], ['mr/odd id', 'job-odd'], ['mr-orch', 'job-orch'], ['mr-badlevel', null], ['mr-badroot', null], ['mr-absent', null]];
    for (const [sid, want] of cases) {
      assert.strictEqual(markerRoot(sid), want, `markerRoot(${sid})`);
      assert.strictEqual(markerRoot(sid), shared(sid), `parity with the shared reader for ${sid}`);
    }
  } finally {
    if (prev === undefined) delete process.env.AUTOPILOT_SESSION_MODE_DIR; else process.env.AUTOPILOT_SESSION_MODE_DIR = prev;
  }
});

// ---------- BL-0163 follow-ups: the close guard's second check, close on a repo with no decisions, orphaned questions ----------

function pointerOf(e, sid) { return path.join(e.live, 'ask-decision', `${sid}.json`); }

test('BL-0163 isOurs: a pointer that names an entry the session did not open (a hand-opened one, or another session\'s) closes nothing', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-g1', 'job-g'); marker(e, 'sess-g2', 'job-g');
  run(ASK, pre(repo, 'sess-g1', [q('G1 asks?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-g2', [q('G2 asks?', ['a', 'b'])]), e.env);
  const r = spawnSync('node', [OPEN, 'open', '--not-authorized', 'irreversible', '--question', 'By hand', '--cwd', repo, '--root-run-id', 'job-g'], { encoding: 'utf8', env: { ...e.env, AUTOPILOT_SESSION_ID: 'sess-g1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  const before = allEntries(repo);
  assert.strictEqual(before.length, 3);
  const g2 = before.find((x) => x.opened_by_session === 'sess-g2' && x.origin);
  const hand = before.find((x) => !x.origin);
  // a stale / wrong pointer: sess-g1's pointer now names the hand-opened entry, then sess-g2's entry. Only the second check can refuse both.
  for (const victim of [hand, g2]) {
    const ptr = readJ(pointerOf(e, 'sess-g1'));
    fs.writeFileSync(pointerOf(e, 'sess-g1'), JSON.stringify({ ...ptr, decision_id: victim.id }));
    run(AUDIT, postAsk(repo, 'sess-g1'), e.env);
    assert.ok(allEntries(repo).some((x) => x.id === victim.id), `sess-g1's pointer at ${victim.question} must not close it`);
    assert.strictEqual(allEntries(repo).length, 3, 'nothing was removed');
    assert.ok(!fs.existsSync(pointerOf(e, 'sess-g1')), 'the pointer itself is consumed either way');
    fs.writeFileSync(pointerOf(e, 'sess-g1'), JSON.stringify({ ...ptr, decision_id: victim.id }));
  }
  // direct: the library guard says no -> absent and the entry stays; with no guard the same id closes
  const { closeDecisionById } = require(OPEN);
  const file = path.join(decDir(repo), decFiles(repo)[0]);
  assert.strictEqual(closeDecisionById(file, hand.id, () => false).status, 'absent');
  assert.ok(allEntries(repo).some((x) => x.id === hand.id));
  assert.strictEqual(closeDecisionById(file, hand.id, (v) => v.origin === 'ask_user_question').status, 'absent', 'hand-opened: no origin');
  assert.strictEqual(closeDecisionById(file, hand.id).status, 'closed', 'control: without a guard it closes');
});

test('BL-0163 close on a repo that never opened a decision creates no decisions/ directory or lock file; a later open still works', () => {
  const repo = mkRepo(); const e = mkEnv();
  const common = path.join(repo, '.git', 'autopilot');
  const r = spawnSync('node', [OPEN, 'close', '--id', 'd-deadbeef', '--cwd', repo], { encoding: 'utf8', env: e.env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /not open: d-deadbeef/);
  assert.ok(!fs.existsSync(path.join(common, 'decisions')), 'no decisions/ dir created by a close');
  const { closeDecisionById } = require(OPEN);
  assert.strictEqual(closeDecisionById(path.join(common, 'decisions', 'nope.json'), 'd-1').status, 'absent');
  assert.ok(!fs.existsSync(path.join(common, 'decisions')), 'nor by the library call');
  const o = spawnSync('node', [OPEN, 'open', '--not-authorized', 'irreversible', '--question', 'Later?', '--cwd', repo], { encoding: 'utf8', env: e.env });
  assert.strictEqual(o.status, 0, o.stderr);
  assert.strictEqual(allEntries(repo).length, 1);
});

test('BL-0163 orphan: a hook-opened question whose asker left no turn file is orphaned (derived, not by age); live, hand-opened or unjudgeable ones are not; nothing is removed', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-o1', 'job-o'); marker(e, 'sess-o2', 'job-o');
  const turn = (sid) => { fs.mkdirSync(path.join(e.live, 'turn'), { recursive: true }); fs.writeFileSync(path.join(e.live, 'turn', `${sid}.json`), JSON.stringify({ schema: 'autopilot.session-turn/1', session_id: sid, state: 'active' })); };
  turn('sess-o1'); turn('sess-o2'); // both askers have a turn file when they open: their entries are turn_tracked
  run(ASK, pre(repo, 'sess-o1', [q('Alive asks?', ['a', 'b'])]), e.env);
  run(ASK, pre(repo, 'sess-o2', [q('Dead asks?', ['a', 'b'])]), e.env);
  const hand = spawnSync('node', [OPEN, 'open', '--not-authorized', 'irreversible', '--question', 'By hand', '--cwd', repo, '--root-run-id', 'job-o'], { encoding: 'utf8', env: { ...e.env, AUTOPILOT_SESSION_ID: 'sess-o3' } });
  assert.strictEqual(hand.status, 0, hand.stderr);
  fs.rmSync(path.join(e.live, 'turn', 'sess-o2.json')); // sess-o1 stays alive; sess-o2's turn file is gone (it ended); the hand-opening sess-o3 never had one
  const { scopeFromCwd } = require(path.join(ROOT, 'src', 'status', 'project-key.js'));
  const { commonDirOf } = require(path.join(ROOT, 'src', 'status', 'scope-key.js'));
  const { readDecision } = require(path.join(ROOT, 'src', 'status', 'decision-input.js'));
  const { readWatchInputs } = require(path.join(ROOT, 'src', 'status', 'watch-inputs.js'));
  const sc = scopeFromCwd(repo);
  const read = (liveBase) => readDecision({ commonDir: commonDirOf(sc.repo_identity), key: sc.project_key, root: 'job-o', identity: sc.repo_identity, nowMs: Date.now(), liveBase });
  const orphanedBy = (liveBase) => Object.fromEntries(read(liveBase).value.map((d) => [d.question, d.orphaned]));
  assert.deepStrictEqual(orphanedBy(e.live), { 'Alive asks?': false, 'Dead asks?': true, 'By hand': false }, 'only the hook-opened entry with no turn file');
  assert.strictEqual(allEntries(repo).length, 3, 'labelled, never removed');
  assert.ok(read(e.live).value.every((d) => d.stale === false), 'age plays no part: all fresh, one is still orphaned');
  turn('sess-o2');
  assert.strictEqual(orphanedBy(e.live)['Dead asks?'], false, 'control: the asker\'s turn file back -> not orphaned');
  fs.rmSync(path.join(e.live, 'turn', 'sess-o2.json'));
  assert.strictEqual(orphanedBy(e.live)['Dead asks?'], true);
  assert.deepStrictEqual(Object.values(orphanedBy(path.join(e.live, 'no-such-dir'))), [false, false, false], 'an unavailable live dir cannot judge: nothing is called orphaned');
  assert.deepStrictEqual(Object.values(orphanedBy(undefined)), [false, false, false], 'no liveBase: nothing is called orphaned');
  // the watcher's input carries the flag, and its change signature moves when it flips (so the page is republished)
  const wi = (liveBase) => readWatchInputs({ env: e.env, key: sc.project_key, identity: sc.repo_identity, root: 'job-o', nowMs: Date.now(), liveBase, autopilotHome: e.home, markers: [], progressReceipt: null });
  const w1 = wi(e.live);
  assert.strictEqual(w1.assemble.decision.value.filter((d) => d.orphaned).length, 1);
  turn('sess-o2');
  assert.notStrictEqual(wi(e.live).signature, w1.signature, 'the signature changes when an entry stops being orphaned');
});

test('BL-0163 turn_tracked: no turn file at open (awaiting-owner off) -> never orphaned; turn file at open then deleted -> orphaned; an entry without the field (old format) -> never orphaned', () => {
  const e = mkEnv(); const repo = mkRepo();
  marker(e, 'sess-t1', 'job-t'); marker(e, 'sess-t2', 'job-t');
  run(ASK, pre(repo, 'sess-t1', [q('No tracking?', ['a', 'b'])]), e.env); // (a) no turn file exists at open
  fs.mkdirSync(path.join(e.live, 'turn'), { recursive: true });
  fs.writeFileSync(path.join(e.live, 'turn', 'sess-t2.json'), JSON.stringify({ schema: 'autopilot.session-turn/1', session_id: 'sess-t2', state: 'active' }));
  run(ASK, pre(repo, 'sess-t2', [q('Tracked?', ['a', 'b'])]), e.env); // (b) a turn file exists at open
  const byQ = (q2) => allEntries(repo).find((x) => x.question === q2);
  assert.ok(!('turn_tracked' in byQ('No tracking?')), 'no turn file at open: no field');
  assert.strictEqual(byQ('Tracked?').turn_tracked, true);
  // (c) an old-format entry: origin + session, no turn_tracked field
  const file = path.join(decDir(repo), decFiles(repo)[0]);
  const doc = readJ(file);
  doc.decisions.push({ ...byQ('Tracked?'), id: 'd-0ld0ld01', question: 'Old format?', opened_by_session: 'sess-t3' });
  delete doc.decisions[doc.decisions.length - 1].turn_tracked;
  fs.writeFileSync(file, JSON.stringify(doc));
  const { scopeFromCwd } = require(path.join(ROOT, 'src', 'status', 'project-key.js'));
  const { commonDirOf } = require(path.join(ROOT, 'src', 'status', 'scope-key.js'));
  const { readDecision } = require(path.join(ROOT, 'src', 'status', 'decision-input.js'));
  const sc = scopeFromCwd(repo);
  const orph = () => Object.fromEntries(readDecision({ commonDir: commonDirOf(sc.repo_identity), key: sc.project_key, root: 'job-t', identity: sc.repo_identity, nowMs: Date.now(), liveBase: e.live }).value.map((d) => [d.question, d.orphaned]));
  assert.deepStrictEqual(orph(), { 'No tracking?': false, 'Tracked?': false, 'Old format?': false }, 'sess-t2 still has its turn file');
  fs.rmSync(path.join(e.live, 'turn', 'sess-t2.json'));
  assert.deepStrictEqual(orph(), { 'No tracking?': false, 'Tracked?': true, 'Old format?': false }, 'only the entry that saw a turn file at open is orphaned once it is gone');
});

test('BL-0163 non-BMP session id: the stored opened_by_session matches the turn file name, so a live session is not labelled orphaned', () => {
  const e = mkEnv(); const repo = mkRepo();
  const sid = 's\u{1F600}x'; // sanitizeSessionId (per code point) -> s_x ; a UTF-16-unit slice would give s__x
  fs.mkdirSync(path.join(e.live, 'turn'), { recursive: true });
  fs.writeFileSync(path.join(e.live, 'turn', 's_x.json'), JSON.stringify({ schema: 'autopilot.session-turn/1', session_id: sid, state: 'active' }));
  run(ASK, pre(repo, sid, [q('Emoji session asks?', ['a', 'b'])]), e.env);
  const entry = allEntries(repo)[0];
  assert.strictEqual(entry.opened_by_session, 's_x');
  assert.strictEqual(entry.turn_tracked, true);
  const { scopeFromCwd } = require(path.join(ROOT, 'src', 'status', 'project-key.js'));
  const { commonDirOf } = require(path.join(ROOT, 'src', 'status', 'scope-key.js'));
  const { readDecision } = require(path.join(ROOT, 'src', 'status', 'decision-input.js'));
  const sc = scopeFromCwd(repo);
  const view = () => readDecision({ commonDir: commonDirOf(sc.repo_identity), key: sc.project_key, root: null, identity: sc.repo_identity, nowMs: Date.now(), liveBase: e.live }).value[0];
  assert.strictEqual(view().orphaned, false, 'the session is alive: its turn file is there');
  fs.rmSync(path.join(e.live, 'turn', 's_x.json'));
  assert.strictEqual(view().orphaned, true, 'control: once the file is gone the same entry is orphaned');
});

test('hygiene: nothing of this run survives teardown (detached writers stopped, dirs removed)', () => {
  teardown();
  assert.deepStrictEqual(ownPids(), []);
  for (const d of fs.readdirSync(SHM)) assert.ok(!d.includes(`-${RUN}-`), `leftover in ${SHM}: ${d}`);
  for (const d of fs.readdirSync(os.tmpdir())) assert.ok(!d.includes(`-${RUN}-`), `leftover in ${os.tmpdir()}: ${d}`);
});
