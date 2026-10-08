'use strict';
// scripts/p7-watcher-data.test.js — stage-graph plan P7 body, package ① (watcher data): the four facts the band's new slots read.
//   D1 spend    envelope host_today_brain_usd / brain_cap_usd (one shared implementation with hooks/cost-fuse.js)
//   D2 ladder   <scope>.decisions.json `ladder` (latest kind:"ladder" row; counts unchanged)
//   D3 residue  <project_key>.residue.json (async repo-residue-sweep scan, 60 s throttle, failure keeps the old file)
//   D4 stage    <live>/stage/<sid>.json (== scripts/stage-graph.js nodes output; rewritten only on input change)
// Contract: docs/plans/evidence/2026-10-06-stage-graph/p7/contract.md §①. Drives the real createWatcher().tick() with a fake
// clock. Isolation: HOME, AUTOPILOT_LIVE_DIR (/dev/shm), AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_DISPATCH_RUNS_DIR,
// AUTOPILOT_COSTS_FILE and every fixture repo live under mkdtemp dirs; nothing touches the real stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createWatcher } = require('../src/status/runs-watch');
const { scopeFromCwd } = require('../src/status/project-key');
const { buildDecisionsSidecar } = require('../src/status/decisions-sidecar');
const { createResiduePublisher } = require('../src/status/residue');
const { sumTodayTierSpend, loadCostFuseConfig } = require('./lib/brain-spend');
const { validateJsonSchema } = require('./validate-json-schema.js');
const schemaOf = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', n), 'utf8'));

const REPO_ROOT = path.join(__dirname, '..');
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const TODAY = iso(NOW).slice(0, 10);

function git(cwd, ...a) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function mk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p7d-'));
  const live = fs.mkdtempSync(path.join('/dev/shm', 'autopilot-test-p7d-'));
  fs.chmodSync(live, 0o700);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');
  const scope = scopeFromCwd(repo);
  const common = scope.repo_identity.replace(/^git-common-dir:/, '');
  const env = {
    PATH: process.env.PATH, HOME: path.join(base, 'home'), AUTOPILOT_LIVE_DIR: live,
    AUTOPILOT_SESSION_MODE_DIR: path.join(base, 'markers'), AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs'),
    AUTOPILOT_COSTS_FILE: path.join(base, 'costs.jsonl'), TMPDIR: base,
  };
  for (const d of [env.HOME, path.join(env.HOME, '.autopilot'), env.AUTOPILOT_SESSION_MODE_DIR, env.AUTOPILOT_DISPATCH_RUNS_DIR]) fs.mkdirSync(d, { recursive: true });
  const ctx = { base, live, repo, scope, common, env, now: NOW };
  ctx.cleanup = () => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(live, { recursive: true, force: true }); };
  ctx.watcher = (extraEnv = {}) => createWatcher({ key: scope.project_key, env: { ...env, ...extraEnv }, cwd: repo, collect: () => [], now: () => ctx.now, render: null });
  ctx.tick = (w) => { const r = w.tick(); assert.equal(r.error, undefined); return r; };
  ctx.envelope = () => JSON.parse(fs.readFileSync(path.join(live, 'runs', `${scope.project_key}.json`), 'utf8'));
  ctx.sidecar = (kind) => {
    const f = path.join(live, 'runs', `${scope.project_key}.${kind}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  return ctx;
}

function writeCosts(ctx, rows) {
  fs.writeFileSync(ctx.env.AUTOPILOT_COSTS_FILE, rows.map((r) => JSON.stringify({ ts: `${TODAY}T01:00:00.000Z`, session: 's1', ...r })).join('\n') + '\n');
}
function writeConfig(ctx, cf) {
  fs.writeFileSync(path.join(ctx.env.HOME, '.autopilot', 'config.json'), JSON.stringify({ cost_fuse: cf }));
}

// ---- D1 ----------------------------------------------------------------------------------------------------------------
test('D1 envelope carries host-today brain-tier spend (cents) and the cap from config', () => {
  const ctx = mk();
  try {
    writeCosts(ctx, [
      { model: 'claude-fable-5-1', cost_usd: 12.3456 }, { model: 'claude-opus-5-5', cost_usd: 3.2 },
      { model: 'claude-sonnet-5-5', cost_usd: 99 }, { model: 'claude-fable-5-1', cost_usd: 7, ts: '2020-01-01T00:00:00.000Z' },
    ]);
    writeConfig(ctx, { daily_usd_brain: 80 });
    ctx.tick(ctx.watcher());
    const e = ctx.envelope();
    assert.equal(e.host_today_brain_usd, 15.55);
    assert.equal(e.brain_cap_usd, 80);
    assert.ok(e.host_today_usd > 15.55, 'all-tier host spend still published and larger');
    assert.equal(validateJsonSchema(schemaOf('runs-live.schema.json'), e).valid, true, 'envelope still validates against runs-live.schema.json');
  } finally { ctx.cleanup(); }
});

test('D1 env override AUTOPILOT_COST_FUSE_DAILY_USD wins over config; default cap 150; missing costs file -> null', () => {
  const ctx = mk();
  try {
    writeConfig(ctx, { daily_usd_brain: 80 });
    ctx.tick(ctx.watcher({ AUTOPILOT_COST_FUSE_DAILY_USD: '200' }));
    assert.equal(ctx.envelope().brain_cap_usd, 200);
    assert.equal(ctx.envelope().host_today_brain_usd, null, 'no costs file: null, not 0');
    fs.rmSync(path.join(ctx.env.HOME, '.autopilot', 'config.json'));
    ctx.now += 100000;
    ctx.tick(ctx.watcher());
    assert.equal(ctx.envelope().brain_cap_usd, 150);
  } finally { ctx.cleanup(); }
});

test('D1 cost-fuse hook and the watcher report the same number for the same fixture', () => {
  const ctx = mk();
  try {
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 12.3456 }, { model: 'claude-opus-5-5', cost_usd: 3.2 }, { model: 'claude-sonnet-5-5', cost_usd: 99 }]);
    writeConfig(ctx, { daily_usd_brain: 1, mode: 'warn' });
    const transcript = path.join(ctx.base, 't.jsonl');
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-fable-5-1', content: 'x' } })}\n`);
    const r = spawnSync('node', [path.join(REPO_ROOT, 'hooks', 'cost-fuse.js')], {
      input: JSON.stringify({ tool_name: 'Edit', session_id: 's1', transcript_path: transcript, tool_input: {}, hook_event_name: 'PreToolUse' }),
      env: { ...ctx.env, AUTOPILOT_COST_FUSE_DIR: path.join(ctx.base, 'fuse') }, encoding: 'utf8',
    });
    const m = /host today \$([0-9.]+) \(≥ \$([0-9.]+) on this host\)/.exec(r.stderr);
    assert.ok(m, `cost-fuse warned (stderr: ${r.stderr})`);
    ctx.tick(ctx.watcher());
    const e = ctx.envelope();
    assert.equal(Number(m[1]), e.host_today_brain_usd);
    assert.equal(Number(m[2]), e.brain_cap_usd);
    // and both are the shared module's own answer
    const cfg = loadCostFuseConfig({ env: ctx.env, home: ctx.env.HOME });
    assert.equal(Math.round(sumTodayTierSpend(ctx.env.AUTOPILOT_COSTS_FILE, new Set(cfg.tiers)) * 100) / 100, e.host_today_brain_usd);
  } finally { ctx.cleanup(); }
});

// ---- D2 ----------------------------------------------------------------------------------------------------------------
test('D2 ladder = latest ladder row under the repo+root filter; telemetry stays out of rows/count', () => {
  const scope = { project_key: 'k', repo_identity: 'git-common-dir:/r', root_run_id: null };
  const row = (o) => ({ repo_identity: 'git-common-dir:/r', ...o });
  const ledgers = [{ source: 'ledger_default', rows: [
    row({ kind: 'decision', decision_id: 'd1', ts: '2026-10-09T01:00:00.000Z', rationale: 'x' }),
    row({ kind: 'ladder', rung: 'U1', ts: '2026-10-09T02:00:00.000Z' }),
    row({ kind: 'ladder', rung: 'U3', ts: '2026-10-09T04:00:00.000Z' }),
    row({ kind: 'ladder', rung: 'U2', ts: '2026-10-09T03:00:00.000Z' }), // earlier ts, later in the file: not the latest
    row({ kind: 'ladder', rung: 'U5', ts: '2026-10-09T09:00:00.000Z', repo_identity: 'git-common-dir:/other' }), // foreign repo
    row({ kind: 'ladder', rung: 'U4', ts: '2026-10-09T08:00:00.000Z', root_run_id: 'root-x' }), // other root
    row({ kind: 'ladder', rung: 'U9', ts: '2026-10-09T10:00:00.000Z' }), // invalid rung ignored
  ] }];
  const s = buildDecisionsSidecar({ scope, ledgers, runs: [], wired: [] });
  assert.deepEqual(s.ladder, { rung: 'U3', at: '2026-10-09T04:00:00.000Z' });
  assert.equal(s.count, 1, 'ladder rows are not counted');
  assert.equal(s.rows.length, 1);
  const rooted = buildDecisionsSidecar({ scope: { ...scope, root_run_id: 'root-x' }, ledgers, runs: [], wired: [] });
  assert.deepEqual(rooted.ladder, { rung: 'U4', at: '2026-10-09T08:00:00.000Z' });
  assert.equal(buildDecisionsSidecar({ scope, ledgers: [{ source: 'ledger_default', rows: [] }], runs: [], wired: [] }).ladder, null);
});

test('D2 the watcher publishes ladder in <project>.decisions.json', () => {
  const ctx = mk();
  try {
    const ledger = path.join(ctx.common, 'autopilot', 'ledger', 'decisions.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    const r = (o) => JSON.stringify({ repo_identity: ctx.scope.repo_identity, ...o });
    fs.writeFileSync(ledger, [r({ kind: 'ladder', rung: 'U2', ts: iso(NOW - 5000) }), r({ kind: 'ladder', rung: 'U3', ts: iso(NOW - 1000) })].join('\n') + '\n');
    ctx.tick(ctx.watcher());
    const s = ctx.sidecar('decisions');
    assert.deepEqual(s.ladder, { rung: 'U3', at: iso(NOW - 1000) });
    assert.equal(s.count, 0);
    assert.equal(validateJsonSchema(schemaOf('decisions-sidecar.schema.json'), s).valid, true, 'sidecar validates against decisions-sidecar.schema.json');
  } finally { ctx.cleanup(); }
});

// ---- D3 ----------------------------------------------------------------------------------------------------------------
function residueFixture() {
  const ctx = mk();
  const wtClean = path.join(ctx.base, 'wt-clean');
  const wtDirty = path.join(ctx.base, 'wt-dirty');
  git(ctx.repo, 'worktree', 'add', '-q', wtClean, '-b', 'clean-branch');
  git(ctx.repo, 'worktree', 'add', '-q', wtDirty, '-b', 'dirty-branch');
  fs.writeFileSync(path.join(wtDirty, 'untracked.txt'), 'x');
  return ctx;
}
const publisherOf = (ctx, extra = {}) => {
  fs.mkdirSync(path.join(ctx.live, 'runs'), { recursive: true });
  const logs = [];
  const writeAtomic = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(`${f}.tmp`, t); fs.renameSync(`${f}.tmp`, f); };
  return { logs, pub: createResiduePublisher({ runsDir: path.join(ctx.live, 'runs'), key: ctx.scope.project_key, repo: ctx.repo, writeAtomic, log: (m) => logs.push(m), now: () => ctx.now, ...extra }) };
};

test('D3 residue: one clean-integrated + one dirty worktree -> reapable_worktrees 1; throttled; second call within 60 s does not spawn', async () => {
  const ctx = residueFixture();
  try {
    const { pub, logs } = publisherOf(ctx);
    const p = pub.publish({ nowMs: ctx.now });
    assert.ok(p, 'first call spawns a scan');
    assert.equal(pub.publish({ nowMs: ctx.now + 1000 }), null, 'never two at once');
    assert.equal(await p, true);
    const fact = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
    assert.equal(fact.schema, 'autopilot.residue/1');
    assert.equal(fact.project_key, ctx.scope.project_key);
    assert.equal(fact.reapable_worktrees, 1);
    assert.deepEqual(fact.by_class, { 'clean-integrated': 1, dirty: 1 });
    assert.equal(fact.source, 'repo-residue-sweep scan');
    // throttle: still inside 60 s of the first start -> no spawn, file untouched
    const mtime = fs.statSync(pub.file).mtimeMs;
    assert.equal(pub.publish({ nowMs: ctx.now + 59000 }), null);
    assert.equal(fs.statSync(pub.file).mtimeMs, mtime);
    // after the window a new scan runs
    assert.ok(pub.publish({ nowMs: ctx.now + 61000 }));
    assert.deepEqual(logs, []);
  } finally { ctx.cleanup(); }
});

test('D3 residue: a watcher whose cwd is a linked worktree still scans the main worktree (the main checkout is never counted)', async () => {
  const ctx = residueFixture();
  try {
    const { pub } = publisherOf(ctx, { repo: path.join(ctx.base, 'wt-clean') });
    assert.equal(await pub.publish({ nowMs: ctx.now }), true);
    assert.equal(JSON.parse(fs.readFileSync(pub.file, 'utf8')).reapable_worktrees, 1, 'the sweep is pointed at the main worktree (excluded); wt-clean counts, wt-dirty does not');
  } finally { ctx.cleanup(); }
});

test('D3 residue: a failing scan keeps the previous file and logs one line', async () => {
  const ctx = residueFixture();
  try {
    const { pub, logs } = publisherOf(ctx);
    assert.equal(await pub.publish({ nowMs: ctx.now }), true);
    const before = fs.readFileSync(pub.file, 'utf8');
    const bad = publisherOf(ctx, { sweep: path.join(ctx.base, 'no-such-sweep.js') });
    assert.equal(await bad.pub.publish({ nowMs: ctx.now + 120000 }), false);
    assert.equal(fs.readFileSync(pub.file, 'utf8'), before, 'previous file untouched');
    assert.equal(bad.logs.length, 1);
    assert.match(bad.logs[0], /residue scan failed/);
    assert.deepEqual(logs, []);
  } finally { ctx.cleanup(); }
});

test('D3 residue: the watcher tick spawns the scan off the tick and publishes the file', async () => {
  const ctx = residueFixture();
  try {
    const w = ctx.watcher();
    ctx.tick(w);
    assert.equal(ctx.sidecar('residue'), null, 'the tick itself did not wait for the scan');
    const file = path.join(ctx.live, 'runs', `${ctx.scope.project_key}.residue.json`);
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).reapable_worktrees, 1);
  } finally { ctx.cleanup(); }
});

// ---- D4 ----------------------------------------------------------------------------------------------------------------
function writeMarker(ctx, sid, o) {
  const m = {
    session_id: sid, level: 'l4', repo_root: ctx.repo, started_at: iso(ctx.now - 60000), expires_at: iso(ctx.now + 3600000),
    repo_identity: ctx.scope.repo_identity, project_key: ctx.scope.project_key, root_run_id: null, ...o,
  };
  fs.writeFileSync(path.join(ctx.env.AUTOPILOT_SESSION_MODE_DIR, `${sid}.json`), JSON.stringify(m));
  return m;
}
const stageFile = (ctx, sid) => path.join(ctx.live, 'stage', `${sid}.json`);
function cliNodes(args) {
  const r = spawnSync('node', [path.join(REPO_ROOT, 'scripts', 'stage-graph.js'), 'nodes', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('D4 stage walk file equals `stage-graph.js nodes` for the marker; unchanged marker -> no rewrite', () => {
  const ctx = mk();
  try {
    writeMarker(ctx, 'sid-a', { size: 'M', bug: true, urgent: true, high_risk: false, stage: 'implement', stage_set_at: iso(ctx.now - 30000), unit: { kind: 'deliverable', index: 2, total: 3, label: 'two' } });
    writeMarker(ctx, 'sid-b', { size: 'S', stage: 'plan', stage_set_at: iso(ctx.now - 1000) });
    writeMarker(ctx, 'sid-nosize', {});
    const w = ctx.watcher();
    ctx.tick(w);
    const a = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-a'), 'utf8'));
    const want = cliNodes(['--size', 'M', '--bug', '--urgent', '--units', '3']);
    assert.equal(a.schema, 'autopilot.stage-walk/1');
    for (const k of ['nodes', 'walk', 'entry', 'terminal', 'unit_kind']) assert.deepEqual(a[k], want[k], k);
    assert.deepEqual({ sid: a.sid, size: a.size, urgent: a.urgent, bug: a.bug, high_risk: a.high_risk, units: a.units, current: a.current }, { sid: 'sid-a', size: 'M', urgent: true, bug: true, high_risk: false, units: 3, current: 'implement' });
    assert.equal(a.stage_set_at, iso(ctx.now - 30000));
    assert.equal(a.at, iso(ctx.now));
    const b = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-b'), 'utf8'));
    assert.equal(b.units, null);
    assert.deepEqual(b.walk, cliNodes(['--size', 'S']).walk);
    assert.equal(fs.existsSync(stageFile(ctx, 'sid-nosize')), false, 'a marker without size has no walk');
    // unchanged marker -> no rewrite (at stays)
    const mtime = fs.statSync(stageFile(ctx, 'sid-a')).mtimeMs;
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(fs.statSync(stageFile(ctx, 'sid-a')).mtimeMs, mtime);
    assert.equal(JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-a'), 'utf8')).at, iso(NOW));
    // a stage change rewrites; a vanished file is restored
    writeMarker(ctx, 'sid-a', { size: 'M', bug: true, urgent: true, high_risk: false, stage: 'verify', stage_set_at: iso(ctx.now), unit: { kind: 'deliverable', index: 2, total: 3, label: 'two' } });
    ctx.now += 15000;
    ctx.tick(w);
    const a2 = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-a'), 'utf8'));
    assert.equal(a2.current, 'verify');
    assert.equal(a2.at, iso(ctx.now));
    fs.rmSync(stageFile(ctx, 'sid-b'));
    ctx.now += 15000;
    ctx.tick(w);
    assert.ok(fs.existsSync(stageFile(ctx, 'sid-b')));
  } finally { ctx.cleanup(); }
});

test('D4 a marker that disappears takes its own stage file with it', () => {
  const ctx = mk();
  try {
    writeMarker(ctx, 'sid-gone', { size: 'L', stage: 'plan', stage_set_at: iso(ctx.now) });
    const w = ctx.watcher();
    ctx.tick(w);
    assert.ok(fs.existsSync(stageFile(ctx, 'sid-gone')));
    fs.rmSync(path.join(ctx.env.AUTOPILOT_SESSION_MODE_DIR, 'sid-gone.json'));
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(fs.existsSync(stageFile(ctx, 'sid-gone')), false);
  } finally { ctx.cleanup(); }
});
