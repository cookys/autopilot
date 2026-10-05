'use strict';
// scripts/runs-watch-sidecars.test.js — mods P1W WATCH-B: the watcher publishes <scope>.decisions.json
// (autopilot.decisions-sidecar/1, W2d publisher + W2g (b)(c)) and <scope>.foreman.json (autopilot.foreman-activity/1,
// W2c read side) next to the runs envelopes. Drives the real createWatcher().tick() against fixture repos.
// Isolation: HOME, AUTOPILOT_LIVE_DIR (/dev/shm tmpdir), AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_DISPATCH_RUNS_DIR,
// AUTOPILOT_COSTS_FILE and every fixture repo live under mkdtemp dirs; nothing touches the real stores.
//
// RED at 8666aba4 + the two new modules + schemas, runs-watch.js hookups absent: 2 passed, 14 failed (D5 and D7 are
// module-level and pass without the hookup), e.g.
//   FAIL D1 default ledger rows of the root reach <scope>.decisions.json (null sidecar: Cannot read properties of null)
//   FAIL D4 gap count (undocumented_dispatches of a null sidecar)
//   FAIL F1 fresh tasks row -> agents[] (null .foreman.json)
//   FAIL F7 a sidecar whose sources all vanish is removed (first assertion: sidecar absent)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { createWatcher } = require('../src/status/runs-watch');
const { scopeFromCwd } = require('../src/status/project-key');
const { buildDecisionsSidecar } = require('../src/status/decisions-sidecar');
const { buildForemanActivity } = require('../src/status/foreman-activity');

const REPO_ROOT = path.join(__dirname, '..');
const VALIDATE = path.join(REPO_ROOT, 'scripts', 'validate-json-schema.js');
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function mk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-'));
  const live = fs.mkdtempSync(path.join('/dev/shm', 'autopilot-test-rws-'));
  fs.chmodSync(live, 0o700);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  g('init', '-q');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
  const scope = scopeFromCwd(repo);
  const common = scope.repo_identity.replace(/^git-common-dir:/, '');
  const env = {
    PATH: process.env.PATH, HOME: path.join(base, 'home'), AUTOPILOT_LIVE_DIR: live,
    AUTOPILOT_SESSION_MODE_DIR: path.join(base, 'markers'), AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs'),
    AUTOPILOT_COSTS_FILE: path.join(base, 'costs.jsonl'), TMPDIR: base,
  };
  for (const d of [env.HOME, env.AUTOPILOT_SESSION_MODE_DIR, env.AUTOPILOT_DISPATCH_RUNS_DIR]) fs.mkdirSync(d, { recursive: true });
  IDENT = scope.repo_identity;
  const ctx = { base, live, repo, scope, common, env, runs: [], now: NOW };
  ctx.cleanup = () => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(live, { recursive: true, force: true }); };
  ctx.tick = () => {
    const w = createWatcher({ key: scope.project_key, env, cwd: repo, collect: () => ctx.runs, now: () => ctx.now, render: null });
    const r = w.tick();
    assert.equal(r.error, undefined);
    return w;
  };
  ctx.sidecar = (kind, root) => {
    const k = root ? `${scope.project_key}--${root}` : scope.project_key;
    const file = path.join(live, 'runs', `${k}.${kind}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  };
  ctx.sidecarFile = (kind, root) => path.join(live, 'runs', `${root ? `${scope.project_key}--${root}` : scope.project_key}.${kind}.json`);
  return ctx;
}
let IDENT = null;
const row = (id, root) => ({ project: IDENT, run_id: id, root_run_id: root, role: 'implementer', phase: 'running', started_at: iso(NOW - 60000), ended_at: null, final_status: null, alive: true, probe_age_s: 1, source: { manifest: `/x/${id}.manifest.json` } });
function writeLedger(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
const lrow = (c, over) => ({ schema_version: 1, ts: iso(NOW - 5000), kind: 'decision', decision_id: 'd-1', round: 1, class: 'tactical', rationale: 'because', reversibility: 'two-way', repo_identity: c.scope.repo_identity, root_run_id: 'R1', ...over });
const defaultLedger = (c) => path.join(c.common, 'autopilot', 'ledger', 'decisions.jsonl');
const woLedger = (c, root) => path.join(c.common, 'autopilot', 'work-orders', root, 'decision-ledger.jsonl');
function marker(c, sid, over) {
  fs.writeFileSync(path.join(c.env.AUTOPILOT_SESSION_MODE_DIR, `${sid}.json`), JSON.stringify({
    session_id: sid, project_key: c.scope.project_key, root_run_id: 'R1', level: 'l4', expires_at: iso(NOW + 3600000), ...over,
  }));
}
function validate(schemaName, doc, tmp) {
  const f = path.join(tmp, `${schemaName}.doc.json`);
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = spawnSync(process.execPath, [VALIDATE, '--schema', path.join(REPO_ROOT, 'schemas', `${schemaName}.schema.json`), '--document', f], { encoding: 'utf8' });
  return r.status === 0 ? '' : r.stdout + r.stderr;
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('D1 default ledger rows of the root reach <scope>.decisions.json; schema valid; counts; kinds', () => {
  const c = mk();
  try {
    writeLedger(defaultLedger(c), [
      lrow(c, { decision_id: 'd-1', round: 1 }),
      lrow(c, { decision_id: 'd-2', round: 2, reversibility: 'one-way', rationale: 'ship it', ts: iso(NOW - 4000) }),
      lrow(c, { kind: 'pick', decision_id: 'p-1', rationale: undefined, row_title: 'Row X', ts: iso(NOW - 3000) }),
      lrow(c, { kind: 'note', decision_id: undefined, text: 'telemetry only' }),
      lrow(c, { kind: 'veto', target_decision_id: 'd-1' }),
    ]);
    c.runs = [row('a', 'R1')];
    c.tick();
    const s = c.sidecar('decisions', 'R1');
    assert.equal(s.schema, 'autopilot.decisions-sidecar/1');
    assert.deepEqual(s.scope, { project_key: c.scope.project_key, repo_identity: c.scope.repo_identity, root_run_id: 'R1' });
    assert.equal(s.count, 3, 'decision x2 + pick; note and veto are not proxy decisions');
    assert.equal(s.irreversible_count, 1);
    assert.deepEqual(s.rows.map((r) => r.decision), ['because', 'ship it', 'Row X']);
    assert.deepEqual(s.rows.map((r) => r.writer), ['depth0', 'depth0', 'next-pick']);
    assert.ok(s.rows.every((r) => r.source === 'ledger_default' && typeof r.at === 'string'));
    assert.equal(validate('decisions-sidecar', s, c.base), '');
  } finally { c.cleanup(); }
});

test('D2 negative controls: other root, other repo, root-less rows and another root work-order ledger are not this scope', () => {
  const c = mk();
  try {
    writeLedger(defaultLedger(c), [
      lrow(c, { decision_id: 'mine' }),
      lrow(c, { decision_id: 'other-root', root_run_id: 'R2' }),
      lrow(c, { decision_id: 'other-repo', repo_identity: 'git-common-dir:/elsewhere/.git' }),
      lrow(c, { decision_id: 'rootless', root_run_id: null }),
    ]);
    writeLedger(woLedger(c, 'R2'), [lrow(c, { decision_id: 'wo-r2', root_run_id: 'R2' })]);
    writeLedger(woLedger(c, 'R1'), [lrow(c, { decision_id: 'wo-foreign-repo', repo_identity: 'git-common-dir:/elsewhere/.git' })]);
    c.runs = [row('a', 'R1'), row('b', 'R2')];
    c.tick();
    assert.deepEqual(c.sidecar('decisions', 'R1').rows.map((r) => r.decision_id), ['mine']);
    assert.deepEqual(c.sidecar('decisions', 'R2').rows.map((r) => r.decision_id).sort(), ['other-root', 'wo-r2']);
    assert.deepEqual(c.sidecar('decisions', null).rows.map((r) => r.decision_id), ['rootless'], 'project-wide scope = rows with no root');
  } finally { c.cleanup(); }
});

test('D3 work-orders/<root>/decision-ledger.jsonl is read; source says which file', () => {
  const c = mk();
  try {
    writeLedger(defaultLedger(c), [lrow(c, { decision_id: 'in-default', ts: iso(NOW - 2000) })]);
    writeLedger(woLedger(c, 'R1'), [lrow(c, { decision_id: 'in-campaign', ts: iso(NOW - 3000), reversibility: 'one-way' })]);
    c.runs = [row('a', 'R1')];
    c.tick();
    const s = c.sidecar('decisions', 'R1');
    assert.deepEqual(s.rows.map((r) => [r.decision_id, r.source]), [['in-campaign', 'ledger_root'], ['in-default', 'ledger_default']]);
    assert.equal(s.irreversible_count, 1);
  } finally { c.cleanup(); }
});

test('D4 gap count: manifests of the root without a kind:dispatch ledger row (decision rows / other roots do not cover)', () => {
  const c = mk();
  try {
    writeLedger(defaultLedger(c), [
      lrow(c, { kind: 'dispatch', decision_id: 'x-a', run_id: 'a', rationale: 'r' }),
      lrow(c, { kind: 'decision', decision_id: 'x-c', run_id: 'c' }), // a decision row naming c is NOT a dispatch row
      lrow(c, { kind: 'dispatch', decision_id: 'x-d', run_id: 'd', root_run_id: 'R2' }), // another root
    ]);
    writeLedger(woLedger(c, 'R1'), [lrow(c, { kind: 'dispatch', decision_id: 'x-b', run_id: 'b' })]);
    c.runs = [row('a', 'R1'), row('b', 'R1'), row('c', 'R1'), row('d', 'R1'), row('z', 'R2')];
    c.tick();
    assert.equal(c.sidecar('decisions', 'R1').undocumented_dispatches, 2, 'c and d');
    assert.equal(c.sidecar('decisions', 'R2').undocumented_dispatches, 1, 'z');
  } finally { c.cleanup(); }
});

test('D5 the publisher never writes a ledger row (no kind:dispatch ever appears) and no ledger is created', () => {
  const c = mk();
  try {
    c.runs = [row('a', 'R1')];
    c.tick(); c.tick();
    assert.equal(fs.existsSync(defaultLedger(c)), false, 'no ledger created by observing');
    writeLedger(defaultLedger(c), [lrow(c)]);
    const before = sha(defaultLedger(c));
    c.tick(); c.tick();
    assert.equal(sha(defaultLedger(c)), before);
    for (const f of ['decisions-sidecar.js', 'foreman-activity.js']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'status', f), 'utf8');
      assert.equal(/appendRow|appendFile|decision-ledger\.js['"]|kind:\s*['"]dispatch['"]\s*,\s*ts/.test(src.replace(/\/\/.*$/gm, '')), false, `${f} has no ledger write path`);
    }
  } finally { c.cleanup(); }
});

test('D6 a ledger row appended later shows on the next tick; an unchanged tick leaves the file untouched', () => {
  const c = mk();
  try {
    writeLedger(defaultLedger(c), [lrow(c)]);
    c.runs = [row('a', 'R1')];
    const w = createWatcher({ key: c.scope.project_key, env: c.env, cwd: c.repo, collect: () => c.runs, now: () => c.now, render: null });
    w.tick();
    const file = c.sidecarFile('decisions', 'R1');
    const m1 = fs.statSync(file).mtimeMs;
    w.tick(); w.tick();
    assert.equal(fs.statSync(file).mtimeMs, m1, 'identical content is not rewritten');
    fs.appendFileSync(defaultLedger(c), `${JSON.stringify(lrow(c, { decision_id: 'd-9', ts: iso(NOW) }))}\n`);
    w.tick();
    assert.equal(c.sidecar('decisions', 'R1').count, 2);
  } finally { c.cleanup(); }
});

test('D7 writers_wired is derived from the shipped files and listed (engine installed)', () => {
  const s = buildDecisionsSidecar({ scope: { project_key: 'k', repo_identity: 'i', root_run_id: null }, ledgers: [], runs: [] });
  assert.ok(Array.isArray(s.writers_wired) && s.writers_wired.includes('engine'));
  // INT2: PICK is on the integrated tree, and the marker is the CODE read (process.env.AUTOPILOT_ROOT_RUN_ID), not only a comment
  assert.ok(s.writers_wired.includes('next-pick'), 'next-pick writer reads wired on the integrated tree');
  const np = fs.readFileSync(path.join(__dirname, 'next-pick.js'), 'utf8');
  assert.ok(/process\.env\.AUTOPILOT_ROOT_RUN_ID/.test(np), 'the grepped marker is a code read, not just a comment');
  const s2 = buildDecisionsSidecar({ scope: { project_key: 'k', repo_identity: 'i', root_run_id: null }, ledgers: [], runs: [], wired: [] });
  assert.deepEqual(s2.writers_wired, []);
});

test('D8 malformed ledger lines and an unreadable file never stop the tick', () => {
  const c = mk();
  try {
    fs.mkdirSync(path.dirname(defaultLedger(c)), { recursive: true });
    fs.writeFileSync(defaultLedger(c), `not json\n${JSON.stringify(lrow(c))}\n{"kind":\n`);
    fs.mkdirSync(path.dirname(woLedger(c, 'R1')), { recursive: true });
    fs.mkdirSync(woLedger(c, 'R1')); // a directory where the file should be
    c.runs = [row('a', 'R1')];
    c.tick();
    assert.equal(c.sidecar('decisions', 'R1').count, 1);
  } finally { c.cleanup(); }
});

// ---------------------------------------------------------------------------------------------------------------
const tasksFile = (c, sid, writtenMs, tasks) => {
  fs.mkdirSync(path.join(c.live, 'context'), { recursive: true });
  fs.writeFileSync(path.join(c.live, 'context', `${sid}.tasks.json`), JSON.stringify({ schema_version: 1, written_at: iso(writtenMs), tasks }));
};
const stamp = (c, sid, aid, atMs, over) => {
  fs.mkdirSync(path.join(c.live, 'agents', sid), { recursive: true });
  fs.writeFileSync(path.join(c.live, 'agents', sid, `${aid}.json`), JSON.stringify({
    schema: 'autopilot.agent-activity/1', session_id: sid, agent_id: aid, agent_type: 'general-purpose', last_tool_at: iso(atMs), last_tool_name: 'Bash', ...over,
  }));
};
const trow = (id, over) => ({ id, type: 'local_agent', description: `desc ${id}`, label: `label ${id}`, status: 'running', startTime: NOW - 600000, ...over });

test('F1 fresh tasks row -> agents[] (age from written_at, status ignored); old file -> stale; schema valid', () => {
  const c = mk();
  try {
    marker(c, 's1');
    tasksFile(c, 's1', NOW - 30000, [trow('ag1')]);
    c.runs = [row('a', 'R1')];
    c.tick();
    let s = c.sidecar('foreman', 'R1');
    assert.equal(s.schema, 'autopilot.foreman-activity/1');
    assert.equal(s.binding, 'session');
    assert.equal(s.agents.length, 1);
    assert.deepEqual([s.agents[0].agent_id, s.agents[0].description, s.agents[0].label, s.agents[0].source, s.agents[0].stale], ['ag1', 'desc ag1', 'label ag1', 'context_tasks', false]);
    assert.ok(s.agents[0].age_s >= 29 && s.agents[0].age_s <= 40);
    assert.equal(s.agents[0].last_activity_at, iso(NOW - 30000));
    assert.equal(s.stage, null);
    assert.equal(validate('foreman-activity', s, c.base), '');
    tasksFile(c, 's1', NOW - 3600000, [trow('ag1', { status: 'running' })]); // status says running; the age says otherwise
    c.tick();
    s = c.sidecar('foreman', 'R1');
    assert.equal(s.agents[0].stale, true);
    assert.ok(s.agents[0].age_s >= 3599);
  } finally { c.cleanup(); }
});

test('F2 negative controls: session without a marker, marker of another root, expired marker, malformed file are ignored', () => {
  const c = mk();
  try {
    marker(c, 'sOtherRoot', { root_run_id: 'R2' });
    marker(c, 'sExpired', { expires_at: iso(NOW - 1000) });
    tasksFile(c, 'sNoMarker', NOW - 1000, [trow('x1')]);
    tasksFile(c, 'sOtherRoot', NOW - 1000, [trow('x2')]);
    tasksFile(c, 'sExpired', NOW - 1000, [trow('x3')]);
    marker(c, 'sBad');
    fs.mkdirSync(path.join(c.live, 'context'), { recursive: true });
    fs.writeFileSync(path.join(c.live, 'context', 'sBad.tasks.json'), '{"tasks": [');
    c.runs = [row('a', 'R1'), row('b', 'R2')];
    c.tick();
    assert.equal(c.sidecar('foreman', 'R1'), null, 'nothing found for R1 -> no sidecar');
    assert.deepEqual(c.sidecar('foreman', 'R2').agents.map((a) => a.agent_id), ['x2']);
  } finally { c.cleanup(); }
});

// mods P1W W3a (WATCH-B follow-up): the reader itself drops a marker of another project_key, whatever the caller passed.
test('F9 a marker of another project_key never lends its tasks / stamps to this scope (negative control at the reader)', () => {
  const c = mk();
  try {
    marker(c, 'sOther', { project_key: 'ffffffffffffffff' });
    marker(c, 'sMine');
    tasksFile(c, 'sOther', NOW - 1000, [trow('foreign')]);
    stamp(c, 'sOther', 'stampForeign', NOW - 1000);
    tasksFile(c, 'sMine', NOW - 1000, [trow('mine')]);
    const markers = ['sOther', 'sMine'].map((sid) => JSON.parse(fs.readFileSync(path.join(c.env.AUTOPILOT_SESSION_MODE_DIR, `${sid}.json`), 'utf8')));
    const s = buildForemanActivity({ scope: { project_key: c.scope.project_key, repo_identity: c.scope.repo_identity, root_run_id: 'R1' }, markers, live: c.live, dispatchRunsDir: path.join(c.base, 'none'), nowMs: NOW });
    assert.deepEqual(s.agents.map((a) => a.agent_id), ['mine']);
  } finally { c.cleanup(); }
});

test('F3 foreman run-ledger: latest row of run_id==root -> stage + max(heartbeat_ts, ts); other run ids ignored; lease pid never consulted', () => {
  const c = mk();
  try {
    const f = path.join(c.env.AUTOPILOT_DISPATCH_RUNS_DIR, 'R1.ledger.jsonl');
    writeLedger(f, [
      { kind: 'stage', ts: iso(NOW - 900000), run_id: 'R1', stage: 'plan', state: 'active', pid: 1, heartbeat_ts: Math.floor((NOW - 900000) / 1000) },
      { kind: 'stage', ts: iso(NOW - 200000), run_id: 'R1', stage: 'implement', state: 'active', pid: 999999999, heartbeat_ts: Math.floor((NOW - 20000) / 1000) },
      { kind: 'stage', ts: iso(NOW - 1000), run_id: 'OTHER', stage: 'zzz', state: 'active', heartbeat_ts: Math.floor(NOW / 1000) },
    ]);
    c.runs = [row('a', 'R1')];
    c.tick();
    const s = c.sidecar('foreman', 'R1');
    assert.equal(s.stage, 'implement');
    assert.equal(s.stage_source, 'run_ledger:tmp');
    assert.deepEqual(s.agents, []);
    assert.ok(s.stage_age_s >= 19 && s.stage_age_s <= 30, `age from heartbeat, got ${s.stage_age_s}`);
    assert.equal(validate('foreman-activity', s, c.base), '');
  } finally { c.cleanup(); }
});

test('F4 the git-common-dir ledger is read too; the newer of the two wins; a ledger of another root is not read', () => {
  const c = mk();
  try {
    writeLedger(path.join(c.env.AUTOPILOT_DISPATCH_RUNS_DIR, 'R1.ledger.jsonl'), [{ kind: 'stage', ts: iso(NOW - 600000), run_id: 'R1', stage: 'old-tmp' }]);
    writeLedger(path.join(c.common, 'autopilot', 'dispatch-runs', 'R1.ledger.jsonl'), [{ kind: 'stage', ts: iso(NOW - 5000), run_id: 'R1', stage: 'new-common' }]);
    writeLedger(path.join(c.common, 'autopilot', 'dispatch-runs', 'R2.ledger.jsonl'), [{ kind: 'stage', ts: iso(NOW - 1000), run_id: 'R2', stage: 'r2-stage' }]);
    c.runs = [row('a', 'R1'), row('b', 'R3')];
    c.tick();
    const s = c.sidecar('foreman', 'R1');
    assert.deepEqual([s.stage, s.stage_source], ['new-common', 'run_ledger:common']);
    assert.equal(c.sidecar('foreman', 'R3'), null);
  } finally { c.cleanup(); }
});

test('F5 STAMP files <live>/agents/<sid>/*.json become agents[]; wrong schema / no marker ignored; merged with tasks by agent_id', () => {
  const c = mk();
  try {
    marker(c, 's1');
    stamp(c, 's1', 'ag1', NOW - 5000);
    stamp(c, 's1', 'ag2', NOW - 9000);
    stamp(c, 's1', 'bad', NOW - 1000, { schema: 'something/else' });
    stamp(c, 'sNoMarker', 'ag9', NOW - 1000);
    tasksFile(c, 's1', NOW - 60000, [trow('ag1')]); // older tasks row for the same agent
    c.runs = [row('a', 'R1')];
    c.tick();
    const s = c.sidecar('foreman', 'R1');
    assert.deepEqual(s.agents.map((a) => a.agent_id), ['ag1', 'ag2'], 'newest first, the bad / unmarked ones absent');
    assert.equal(s.agents[0].source, 'stamp', 'the newer activity wins');
    assert.equal(s.agents[0].description, 'desc ag1', 'description filled from the tasks row');
    assert.equal(s.agents[0].last_activity_at, iso(NOW - 5000));
    assert.equal(s.agents[1].label, 'last tool: Bash');
    assert.equal(validate('foreman-activity', s, c.base), '');
  } finally { c.cleanup(); }
});

test('F6 binding is by session: two jobs in one session are not told apart (no per-agent root invented)', () => {
  const c = mk();
  try {
    marker(c, 's1'); // one marker, root R1; a second job R2 observed in the same watcher
    tasksFile(c, 's1', NOW - 1000, [trow('agA'), trow('agB')]);
    c.runs = [row('a', 'R1'), row('b', 'R2')];
    c.tick();
    const s = c.sidecar('foreman', 'R1');
    assert.equal(s.binding, 'session');
    assert.ok(s.agents.every((a) => a.binding === 'session' && a.session_id === 's1'));
    assert.equal(s.agents.length, 2);
    assert.equal(c.sidecar('foreman', 'R2'), null, 'the marker names R1 only: R2 gets nothing rather than an invented bind');
  } finally { c.cleanup(); }
});

test('F7 a sidecar whose sources all vanish is removed (absence = foreman not wired)', () => {
  const c = mk();
  try {
    marker(c, 's1');
    tasksFile(c, 's1', NOW - 1000, [trow('ag1')]);
    c.runs = [row('a', 'R1')];
    const w = createWatcher({ key: c.scope.project_key, env: c.env, cwd: c.repo, collect: () => c.runs, now: () => c.now, render: null });
    w.tick();
    assert.ok(c.sidecar('foreman', 'R1'));
    fs.unlinkSync(path.join(c.live, 'context', 's1.tasks.json'));
    w.tick();
    assert.equal(c.sidecar('foreman', 'R1'), null);
  } finally { c.cleanup(); }
});

test('F8 age-only refresh: an unchanged source is rewritten at most once a minute, but age_s does advance then', () => {
  const c = mk();
  try {
    marker(c, 's1');
    tasksFile(c, 's1', NOW - 1000, [trow('ag1')]);
    c.runs = [row('a', 'R1')];
    const w = createWatcher({ key: c.scope.project_key, env: c.env, cwd: c.repo, collect: () => c.runs, now: () => c.now, render: null });
    w.tick();
    const file = c.sidecarFile('foreman', 'R1');
    const m1 = fs.statSync(file).mtimeMs;
    const age1 = c.sidecar('foreman', 'R1').agents[0].age_s;
    c.now += 10000; w.tick();
    assert.equal(fs.statSync(file).mtimeMs, m1, 'ten seconds later nothing but age moved: not rewritten');
    c.now += 60000; w.tick();
    assert.ok(c.sidecar('foreman', 'R1').agents[0].age_s >= age1 + 70, 'a minute later the file is refreshed with the new age');
  } finally { c.cleanup(); }
});

// mods P1W FOREMAN: the stamp rows say `stamped: true` and carry `ended_at` (SubagentStop), so the band can tell a quiet running
// foreman from a finished one. Only stamp rows can say ended; a tasks row merged with an ended stamp keeps the end.
test('F10 FOREMAN: stamp rows carry stamped + ended_at (null while running); a tasks-only row carries neither; schema valid', () => {
  const c = mk();
  try {
    marker(c, 's1');
    stamp(c, 's1', 'run1', NOW - 5000);
    stamp(c, 's1', 'done1', NOW - 9000, { ended_at: iso(NOW - 2000) });
    stamp(c, 's1', 'junk', NOW - 7000, { ended_at: 'not a time' });
    tasksFile(c, 's1', NOW - 3000, [trow('only-tasks')]);
    c.runs = [row('a', 'R1')];
    c.tick();
    const s = c.sidecar('foreman', 'R1');
    const by = Object.fromEntries(s.agents.map((a) => [a.agent_id, a]));
    assert.equal(by.run1.stamped, true);
    assert.equal(by.run1.ended_at, null);
    assert.equal(by.done1.stamped, true);
    assert.equal(by.done1.ended_at, iso(NOW - 2000));
    assert.equal(by.junk.ended_at, null, 'an unparseable ended_at is not an end');
    assert.equal('stamped' in by['only-tasks'], false);
    assert.equal('ended_at' in by['only-tasks'], false);
    assert.equal(validate('foreman-activity', s, c.base), '');
  } finally { c.cleanup(); }
});

test('F11 FOREMAN: a tasks row newer than an ended stamp of the same agent keeps the end (merge propagates ended_at)', () => {
  const c = mk();
  try {
    marker(c, 's1');
    stamp(c, 's1', 'ag1', NOW - 20000, { ended_at: iso(NOW - 15000) });
    tasksFile(c, 's1', NOW - 1000, [trow('ag1')]); // the statusline file still lists the finished agent, fresher than its last tool call
    c.runs = [row('a', 'R1')];
    c.tick();
    const a = c.sidecar('foreman', 'R1').agents.find((x) => x.agent_id === 'ag1');
    assert.equal(a.source, 'context_tasks', 'the newer row wins the activity time');
    assert.equal(a.stamped, true);
    assert.equal(a.ended_at, iso(NOW - 15000));
    assert.equal(a.description, 'desc ag1');
  } finally { c.cleanup(); }
});
