'use strict';

/**
 * Tests for scripts/lib/workflow-snapshot.js (plan 2026-10-13-workflow-snapshot-at-compaction, P1).
 * Run: node --test scripts/lib/workflow-snapshot.test.js
 *
 * Each source: present, absent, malformed. Plus the size bound, the expiry rule, the dispatch and
 * roster filters. Mutation records for the behaviours are in the commit message / plan evidence.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collect, render, snapshotText, isAgentRunning, scanRunningAdvisory } = require('./workflow-snapshot.js');

const SID = 'snap-session-1';
const KEY = '0123456789abcdef';
const NOW = Date.parse('2026-10-13T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function mk() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfsnap-'));
  const dirs = {
    sessionMode: path.join(root, 'sm'),
    live: path.join(root, 'live'),
    taskCard: path.join(root, 'tc'),
    dispatchRuns: path.join(root, 'runs'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const cwd = path.join(root, 'repo');
  fs.mkdirSync(path.join(cwd, 'docs', 'projects', 'p1', 'ledger'), { recursive: true });
  return { root, dirs, cwd, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function put(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
}
const GIT = () => '# branch.oid 1234567890abcdef\n# branch.head feat/x\n1 .M N... 100644 100644 100644 a b f1\n? f2\n';

function fullFixture(f, over = {}) {
  put(path.join(f.dirs.sessionMode, `${SID}.json`), {
    session_id: SID, level: 'l5', size: 'M', stage: 'plan', unit: 'phase:1/3:alpha', root_run_id: 'job-root-1',
    campaign_roots: ['camp-root-2'], project_key: KEY, task_seq: 2,
    expires_at: iso(NOW + 3600e3), ...over.marker,
  });
  put(path.join(f.dirs.taskCard, `${SID}.json`), {
    schema: 'autopilot.task-card/1', goal: 'ship the snapshot', success: ['tests green', 'no stdout noise'],
    plan: 'docs/plans/p.md', review_ledger: '/x/ledger', ledger: path.join(f.cwd, 'docs/projects/p1/ledger/decisions.jsonl'),
    requirements: ['fail-open'], ...over.card,
  });
  put(path.join(f.dirs.live, 'tasks', `${SID}.json`), {
    schema: 'autopilot.session-tasks/1', updated_at: iso(NOW - 60e3),
    tasks: [{ id: '1', subject: 'write collector', status: 'completed' }, { id: '2', subject: 'write hook tests', status: 'in_progress' }, { id: '3', subject: 'wire docs', status: 'pending' }],
  });
  put(path.join(f.dirs.live, 'review-rounds', `${KEY}.json`), {
    schema: 'autopilot.review-round/1', phase: 'full', generation: 2, head: '1234567890', converged: false, at: iso(NOW - 600e3),
    seats: [{ id: 's0', family: 'anthropic', verdict: 'SHIP-AS-IS' }, { id: 's1', family: 'zhipu', verdict: 'FIX-THEN-SHIP' }],
  });
  put(path.join(f.cwd, 'docs/projects/p1/ledger/decisions.jsonl'),
    [{ kind: 'note', text: 'n' }, { kind: 'decision', decision_id: 'd1', rationale: 'use tmpfs' }, { kind: 'decision', decision_id: 'd2', rationale: 'keep tail short' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  put(path.join(f.dirs.dispatchRuns, 'run-a.manifest.json'), { run_id: 'run-a', role: 'author', runner: 'grok', model: 'grok-4.6', root_run_id: 'job-root-1', pid: process.pid, started_at: iso(NOW - 120e3), ended_at: null });
  put(path.join(f.dirs.live, 'agents', SID, 'ag1.json'), { schema: 'autopilot.agent-activity/1', agent_id: 'ag1', agent_type: 'autopilot:reviewer', last_tool_at: iso(NOW - 30e3), last_tool_name: 'Bash' });
}
const run = (f, extra = {}) => collect({ sessionId: SID, cwd: f.cwd, now: NOW, dirs: f.dirs, git: GIT, ...extra });
const text = (s) => s.lines.join('\n');

test('every source present: the lines name each fact', () => {
  const f = mk();
  try {
    fullFixture(f);
    const s = run(f);
    const t = text(s);
    assert.match(t, /session: level l5 · size M · stage plan · unit phase:1\/3:alpha · task #2 · root job-root-1/);
    assert.match(t, /next legal node after plan: implement/);
    assert.match(t, /git: branch feat\/x @ 12345678, 2 changed paths/);
    assert.match(t, /task card — goal: ship the snapshot/);
    assert.match(t, /success criteria: tests green \| no stdout noise/);
    assert.match(t, /session tasks: 1\/3 completed/);
    assert.match(t, /\[doing\] #2 write hook tests/);
    assert.match(t, /code review: phase full generation 2 head 12345678 not converged; anthropic=SHIP-AS-IS zhipu=FIX-THEN-SHIP/);
    assert.match(t, /decision ledger \(task card\): last 2/);
    assert.match(t, /decision d2: keep tail short/);
    assert.match(t, /dispatches in flight: 1/);
    assert.match(t, /author grok\/grok-4\.6 run run-a/);
    assert.match(t, /subagents: 1 recorded, 1 running/);
    assert.match(t, /autopilot:reviewer ag1 last tool Bash/);
    for (const k of ['session', 'next legal node', 'git', 'task card', 'session tasks', 'code review', 'decision ledger', 'dispatches', 'subagents']) {
      assert.strictEqual(s.sources[k], 'ok', k);
    }
    assert.strictEqual(s.sources['plan review'], 'absent');
  } finally { f.cleanup(); }
});

test('nothing on disk: every source is a named absent line and no value is invented', () => {
  const f = mk();
  try {
    const s = collect({ sessionId: SID, cwd: f.cwd, now: NOW, dirs: f.dirs, git: () => null });
    for (const [k, v] of Object.entries(s.sources)) assert.strictEqual(v, 'absent', k);
    const t = text(s);
    for (const name of ['session', 'next legal node', 'git', 'task card', 'session tasks', 'code review', 'plan review', 'decision ledger', 'dispatches', 'subagents']) {
      assert.match(t, new RegExp(`${name}: absent \\(`), name);
    }
    assert.doesNotMatch(t, /stage plan|level l|branch /);
  } finally { f.cleanup(); }
});

test('malformed files read as absent and never throw', () => {
  const f = mk();
  try {
    fullFixture(f);
    put(path.join(f.dirs.sessionMode, `${SID}.json`), '{not json');
    put(path.join(f.dirs.taskCard, `${SID}.json`), '[]');
    put(path.join(f.dirs.live, 'tasks', `${SID}.json`), '{"tasks":"x"}');
    put(path.join(f.dirs.live, 'review-rounds', `${KEY}.json`), 'xx');
    put(path.join(f.dirs.live, 'agents', SID, 'ag1.json'), '{{{');
    put(path.join(f.dirs.dispatchRuns, 'run-a.manifest.json'), 'garbage');
    put(path.join(f.cwd, 'docs/projects/p1/ledger/decisions.jsonl'), 'not json\nstill not\n');
    const s = run(f);
    assert.strictEqual(s.sources.session, 'absent');
    assert.strictEqual(s.sources['task card'], 'absent');
    assert.strictEqual(s.sources['session tasks'], 'absent');
    assert.strictEqual(s.sources['code review'], 'absent');
    assert.strictEqual(s.sources['decision ledger'], 'absent');
    assert.match(text(s), /subagents: 1 recorded, 0 running/);
    assert.match(text(s), /dispatches: .*absent|dispatches: none in flight/);
  } finally { f.cleanup(); }
});

test('an expired marker is absent, like session-mode readSessionRecord', () => {
  const f = mk();
  try {
    fullFixture(f, { marker: { expires_at: iso(NOW - 1000) } });
    const s = run(f);
    assert.strictEqual(s.sources.session, 'absent');
    assert.match(text(s), /session: absent \(no unexpired session-mode marker\)/);
  } finally { f.cleanup(); }
});

test('no marker stage: the stage file supplies size and current stage for the next legal node', () => {
  const f = mk();
  try {
    fullFixture(f, { marker: { stage: null, size: null } });
    put(path.join(f.dirs.live, 'stage', `${SID}.json`), { schema: 'autopilot.stage-walk/1', size: 'S', current: 'verify', bug: false, urgent: false });
    const s = run(f);
    assert.match(text(s), /next legal node after verify: implement, qc-gate \(from stage file\)/);
  } finally { f.cleanup(); }
});

test('an unknown stage or size is absent, not a crash of the whole snapshot', () => {
  const f = mk();
  try {
    fullFixture(f, { marker: { stage: 'bogus-stage' } });
    const s = run(f);
    assert.match(text(s), /next legal node: absent \(unknown stage bogus-stage\)/);
    assert.strictEqual(s.sources.git, 'ok');
  } finally { f.cleanup(); }
});

test('code review: a round recorded at another head is flagged, one at this checkout\'s head is not', () => {
  const f = mk();
  try {
    fullFixture(f);
    assert.doesNotMatch(text(run(f)), /head differs/);
    put(path.join(f.dirs.live, 'review-rounds', `${KEY}.json`), {
      schema: 'autopilot.review-round/1', phase: 'full', generation: 1, head: 'fedcba9876', converged: true, at: iso(NOW - 600e3), seats: [],
    });
    const t = text(run(f));
    assert.match(t, /code review: phase full generation 1 head fedcba98 converged.*\[head differs: round reviewed fedcba98, this checkout is at 12345678;/);
    const noGit = text(run(f, { git: () => null }));
    assert.doesNotMatch(noGit, /head differs/);
    assert.match(noGit, /code review: .*\[head not compared; shared by every worktree\]/); // HEAD unknown: say the round was not compared
    assert.doesNotMatch(text(run(f)), /head not compared/);
  } finally { f.cleanup(); }
});

test('dispatches: another root, an ended run and a dead pid are not in flight', () => {
  const f = mk();
  try {
    fullFixture(f);
    const base = { role: 'author', runner: 'r', model: 'm', started_at: iso(NOW - 1000) };
    put(path.join(f.dirs.dispatchRuns, 'other.manifest.json'), { ...base, run_id: 'other', root_run_id: 'someone-else', pid: process.pid, ended_at: null });
    put(path.join(f.dirs.dispatchRuns, 'ended.manifest.json'), { ...base, run_id: 'ended', root_run_id: 'job-root-1', pid: process.pid, ended_at: iso(NOW) });
    put(path.join(f.dirs.dispatchRuns, 'dead.manifest.json'), { ...base, run_id: 'dead', root_run_id: 'job-root-1', pid: 2147483000, ended_at: null });
    put(path.join(f.dirs.dispatchRuns, 'camp.manifest.json'), { ...base, run_id: 'camp', root_run_id: 'camp-root-2', pid: process.pid, ended_at: null });
    const t = text(run(f));
    assert.match(t, /dispatches in flight: 2/);
    assert.match(t, /run run-a/);
    assert.match(t, /run camp/);
    assert.doesNotMatch(t, /run (other|ended|dead)/);
  } finally { f.cleanup(); }
});

test('roster: only the newest 40 files are read; ended and silent agents are not running', () => {
  const f = mk();
  try {
    fullFixture(f);
    const dir = path.join(f.dirs.live, 'agents', SID);
    for (let i = 0; i < 120; i++) {
      const file = path.join(dir, `old${i}.json`);
      put(file, { agent_id: `old${i}`, agent_type: 'x', last_tool_at: iso(NOW - 5e3), ended_at: iso(NOW - 4e3) });
      const t = new Date(1e12 + i * 1000); // far older than the freshly written ag1 / silent
      fs.utimesSync(file, t, t);
    }
    put(path.join(dir, 'silent.json'), { agent_id: 'silent', agent_type: 'x', last_tool_at: iso(NOW - 3 * 3600e3) });
    const s = run(f);
    assert.match(text(s), /subagents: 122 recorded, 1 running \(newest 40 read\)/);
    assert.doesNotMatch(text(s), / silent /);
  } finally { f.cleanup(); }
});

test('size bound: render never exceeds maxBytes, cuts on a line and says how many lines went', () => {
  const f = mk();
  try {
    fullFixture(f);
    const tasks = [];
    for (let i = 0; i < 80; i++) tasks.push({ id: String(i), subject: 'x'.repeat(500), status: 'pending' });
    put(path.join(f.dirs.live, 'tasks', `${SID}.json`), { updated_at: iso(NOW), tasks });
    const s = run(f);
    const full = render(s, { maxBytes: 100000 });
    assert.ok(full.split('\n').filter((l) => l.startsWith('  - [todo]')).length <= 6, 'open tasks are capped at 6');
    const small = render(s, { maxBytes: 700 });
    assert.ok(Buffer.byteLength(small) <= 700, `got ${Buffer.byteLength(small)}`);
    assert.match(small, /\.\.\. \d+ lines omitted$/);
    assert.ok(Buffer.byteLength(render(s, { maxBytes: 3000 })) <= 3000);
    assert.ok(Buffer.byteLength(snapshotText({ sessionId: SID, cwd: f.cwd, now: NOW, dirs: f.dirs, git: GIT, maxBytes: 3000 })) <= 3000);
  } finally { f.cleanup(); }
});

test('no session id: one absent line, the other session-keyed sources are not read', () => {
  const f = mk();
  try {
    const s = collect({ sessionId: '', cwd: f.cwd, now: NOW, dirs: f.dirs, git: GIT });
    assert.match(text(s), /session: absent \(the hook payload carried no session id\)/);
    assert.strictEqual(s.sources.git, 'ok');
    assert.strictEqual(s.sources['task card'], undefined);
  } finally { f.cleanup(); }
});

test('the decision ledger without a task card falls back to the newest project ledger under 24h, and says so', () => {
  const f = mk();
  try {
    fullFixture(f);
    fs.rmSync(path.join(f.dirs.taskCard, `${SID}.json`));
    const led = path.join(f.cwd, 'docs/projects/p1/ledger/decisions.jsonl');
    fs.utimesSync(led, new Date(NOW - 60e3), new Date(NOW - 60e3)); // mtime pinned to the fixed clock
    const t = text(run(f));
    assert.match(t, /decision ledger \(newest docs\/projects\/\*\/ledger by mtime, under 24h, may be another session's in this checkout\)/);
  } finally { f.cleanup(); }
});

// # RED at 6648ef275: 4 failed before the extract — isAgentRunning is not a function (ASSERT parity); scanRunningAdvisory is not a function (ASSERT older_running_stamp_included, ASSERT oversized_dir_op_budget, ASSERT malformed_not_counted / duplicate_agent_id / unreadable_directory). 12 existing tests passed.
// P1 subagent concurrency advisory. Temp dirs only (os.tmpdir), never ~/.autopilot.
// Oracle is the pre-extraction srcRoster inline rule (workflow-snapshot.js before isAgentRunning):
//   if (!a || a.ended_at) not running;
//   t = Date.parse(a.last_tool_at);
//   if (Number.isFinite(t) && now - t > 30min) not running;
//   otherwise running (missing or unparseable last_tool_at still running).
const AGENT_STALE_ORACLE_MS = 30 * 60 * 1000;
function oracleIsAgentRunning(a, now) {
  if (!a || a.ended_at) return false;
  const t = Date.parse(a.last_tool_at);
  if (Number.isFinite(t) && now - t > AGENT_STALE_ORACLE_MS) return false;
  return true;
}

test('parity: isAgentRunning matches the original inline rule and srcRoster text is unchanged', () => {
  const now = NOW;
  const table = [
    ['ended', { ended_at: iso(now - 500), last_tool_at: iso(now - 1000) }],
    ['fresh', { last_tool_at: iso(now - 30e3) }],
    ['stale', { last_tool_at: iso(now - AGENT_STALE_ORACLE_MS - 1) }],
    ['unparseable last_tool_at', { last_tool_at: 'not-a-date' }],
    ['missing last_tool_at', { agent_id: 'notime' }],
  ];
  for (const [name, stamp] of table) {
    assert.strictEqual(
      isAgentRunning(stamp, now),
      oracleIsAgentRunning(stamp, now),
      `ASSERT parity ${name}`,
    );
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-parity-'));
  try {
    const live = path.join(root, 'live');
    const dir = path.join(live, 'agents', 'sess1');
    fs.mkdirSync(dir, { recursive: true });
    const stamps = [
      ['ended.json', { agent_id: 'ended', agent_type: 'reviewer', last_tool_at: iso(now - 1000), last_tool_name: 'Read', ended_at: iso(now - 500) }, 5],
      ['fresh.json', { agent_id: 'fresh', agent_type: 'autopilot:reviewer', last_tool_at: iso(now - 30e3), last_tool_name: 'Bash' }, 1],
      ['stale.json', { agent_id: 'stale', agent_type: 'x', last_tool_at: iso(now - 31 * 60e3), last_tool_name: 'Edit' }, 4],
      ['badtime.json', { agent_id: 'badtime', agent_type: 'worker', last_tool_at: 'nope', last_tool_name: 'Grep' }, 2],
      ['notime.json', { agent_id: 'notime', agent_type: 'worker' }, 3],
    ];
    for (const [n, obj, ord] of stamps) {
      const file = path.join(dir, n);
      fs.writeFileSync(file, JSON.stringify(obj));
      const t = new Date(now - ord * 1000);
      fs.utimesSync(file, t, t);
    }
    const s = collect({ sessionId: 'sess1', cwd: root, now, dirs: { live }, git: () => '' });
    const expected = [
      'subagents: 5 recorded, 3 running (newest 5 read)',
      '  - autopilot:reviewer fresh last tool Bash 30s ago',
      '  - worker badtime last tool Grep',
      '  - worker notime last tool none yet',
    ].join('\n');
    assert.strictEqual((s.bySource.subagents || []).join('\n'), expected, 'ASSERT parity srcRoster');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('older_running_stamp_included: advisory counts a running stamp older than 40 newer ended stamps', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-older-'));
  try {
    const dir = path.join(root, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 40; i++) {
      const file = path.join(dir, `ended-${String(i).padStart(2, '0')}.json`);
      fs.writeFileSync(file, JSON.stringify({
        agent_id: `ended-${i}`, ended_at: iso(NOW), last_tool_at: iso(NOW),
      }));
      const t = new Date(NOW - i * 1000);
      fs.utimesSync(file, t, t);
    }
    const old = path.join(dir, 'running-old.json');
    fs.writeFileSync(old, JSON.stringify({
      agent_id: 'still-running', agent_type: 'worker', last_tool_at: iso(NOW - 1000),
    }));
    const oldT = new Date(NOW - 86_400_000);
    fs.utimesSync(old, oldT, oldT);
    const res = scanRunningAdvisory(dir, { now: NOW });
    assert.strictEqual(res.count, 1, 'ASSERT older_running_stamp_included');
    assert.strictEqual(res.partial, false, 'ASSERT older_running_stamp_included');
    assert.strictEqual(typeof res.ops, 'number', 'ASSERT older_running_stamp_included');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('oversized_dir_op_budget: advisory walk stays inside 200 ops and never stats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-oversize-'));
  const origReadDir = fs.readdirSync;
  const origStat = fs.statSync;
  const origRead = fs.readFileSync;
  let calls = 0;
  let statCalls = 0;
  let wrapped = false;
  try {
    const dir = path.join(root, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 4999; i++) {
      fs.writeFileSync(path.join(dir, `e${String(i).padStart(4, '0')}.json`), JSON.stringify({
        agent_id: `e${i}`, ended_at: iso(NOW), last_tool_at: iso(NOW),
      }));
    }
    // Name sorts late; readdir order is filesystem order, so this stamp may sit outside the inspected subset.
    fs.writeFileSync(path.join(dir, 'zzz-running.json'), JSON.stringify({
      agent_id: 'only-running', last_tool_at: iso(NOW - 1000),
    }));
    fs.readdirSync = function wrappedReaddir(...args) {
      if (wrapped) calls += 1;
      return origReadDir.apply(this, args);
    };
    fs.statSync = function wrappedStat(...args) {
      if (wrapped) { calls += 1; statCalls += 1; }
      return origStat.apply(this, args);
    };
    fs.readFileSync = function wrappedRead(...args) {
      if (wrapped) calls += 1;
      return origRead.apply(this, args);
    };
    wrapped = true;
    const res = scanRunningAdvisory(dir, { now: NOW, opsBudget: 200, wallMs: 30000 });
    wrapped = false;
    assert.ok(calls <= 200, `ASSERT oversized_dir_op_budget calls=${calls}`);
    assert.strictEqual(statCalls, 0, 'ASSERT oversized_dir_op_budget statSync');
    assert.strictEqual(res.partial, true, 'ASSERT oversized_dir_op_budget');
    assert.ok(res.count >= 0, `ASSERT oversized_dir_op_budget count=${res.count}`);
  } finally {
    wrapped = false;
    fs.readdirSync = origReadDir;
    fs.statSync = origStat;
    fs.readFileSync = origRead;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('malformed stamps are not counted; duplicate agent_id counts once; unreadable directory does not throw', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-bad-'));
  try {
    const dir = path.join(root, 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.json'), '{');
    fs.writeFileSync(path.join(dir, 'arr.json'), '[]');
    fs.writeFileSync(path.join(dir, 'running.json'), JSON.stringify({
      agent_id: 'live', last_tool_at: iso(NOW - 1000),
    }));
    const locked = path.join(dir, 'locked.json');
    fs.writeFileSync(locked, JSON.stringify({ agent_id: 'locked', last_tool_at: iso(NOW) }));
    fs.chmodSync(locked, 0);
    const malformed = scanRunningAdvisory(dir, { now: NOW });
    assert.strictEqual(malformed.count, 1, 'ASSERT malformed_not_counted');
    assert.strictEqual(malformed.partial, false, 'ASSERT malformed_not_counted');

    const dup = path.join(root, 'dup');
    fs.mkdirSync(dup);
    fs.writeFileSync(path.join(dup, 'a.json'), JSON.stringify({ agent_id: 'same', last_tool_at: iso(NOW) }));
    fs.writeFileSync(path.join(dup, 'b.json'), JSON.stringify({ agent_id: 'same', last_tool_at: iso(NOW) }));
    fs.writeFileSync(path.join(dup, 'c.json'), JSON.stringify({ agent_id: 'other', last_tool_at: iso(NOW) }));
    const dups = scanRunningAdvisory(dup, { now: NOW });
    assert.strictEqual(dups.count, 2, 'ASSERT duplicate_agent_id');

    const missing = path.join(root, 'no-such-dir');
    let threw = false;
    let unread;
    try { unread = scanRunningAdvisory(missing, { now: NOW }); } catch { threw = true; }
    assert.strictEqual(threw, false, 'ASSERT unreadable_directory');
    assert.strictEqual(unread.count, 0, 'ASSERT unreadable_directory');
    assert.strictEqual(unread.partial, false, 'ASSERT unreadable_directory');

    const blocked = path.join(root, 'blocked');
    fs.mkdirSync(blocked);
    fs.chmodSync(blocked, 0);
    let threwDir = false;
    let blockedRes;
    try { blockedRes = scanRunningAdvisory(blocked, { now: NOW }); } catch { threwDir = true; }
    fs.chmodSync(blocked, 0o755);
    assert.strictEqual(threwDir, false, 'ASSERT unreadable_directory');
    assert.strictEqual(blockedRes.count, 0, 'ASSERT unreadable_directory');
    assert.strictEqual(blockedRes.partial, false, 'ASSERT unreadable_directory');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
