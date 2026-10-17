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
const { createResiduePublisher, buildResidueFact } = require('../src/status/residue');
const { sumTodayTierSpend, createTierSpendReader, loadCostFuseConfig } = require('./lib/brain-spend');
const { validateJsonSchema } = require('./validate-json-schema.js');
const schemaOf = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', n), 'utf8'));

// repo-residue-sweep keeps a worktree with activity in the last 24h out of every removal path (33b4a07a3); the residue fixtures here are all
// brand new, so the guard is off for this file (hooks/tests/lib.sh does the same for the shell suites; residue-recent-activity.test.sh tests the guard).
process.env.AUTOPILOT_RESIDUE_RECENT_HOURS = '0';

const REPO_ROOT = path.join(__dirname, '..');
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const utcDay = () => new Date().toISOString().slice(0, 10); // computed at write time: a run across 00:00 UTC must not flake

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
  fs.writeFileSync(ctx.env.AUTOPILOT_COSTS_FILE, rows.map((r) => JSON.stringify({ ts: `${utcDay()}T01:00:00.000Z`, session: 's1', ...r })).join('\n') + '\n');
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

test('D1 subagent rows are excluded from the brain spend (one-shot sum and incremental reader); main rows still count', () => {
  const ctx = mk();
  try {
    writeCosts(ctx, [
      { model: 'claude-opus-5-5', cost_usd: 4 },
      { model: 'claude-opus-5-5', cost_usd: 50, sidechain: true, agent_id: 'aaa111' },
      { model: 'claude-opus-5-5', cost_usd: 60, agent_id: 'bbb222' },
    ]);
    const tiers = new Set(loadCostFuseConfig({ env: ctx.env, home: ctx.env.HOME }).tiers);
    assert.equal(sumTodayTierSpend(ctx.env.AUTOPILOT_COSTS_FILE, tiers), 4);
    const r = createTierSpendReader(ctx.env.AUTOPILOT_COSTS_FILE).read();
    assert.equal(r.ok, true);
    assert.equal(r.todaySpend(tiers), 4);
  } finally { ctx.cleanup(); }
});

test('D1 incremental: an appended row is picked up; a shrunk or rotated file is re-read in full', () => {
  const ctx = mk();
  try {
    writeConfig(ctx, { daily_usd_brain: 80 });
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 10 }]);
    const w = ctx.watcher();
    ctx.tick(w);
    assert.equal(ctx.envelope().host_today_brain_usd, 10);
    // append (the reader must count only the new row; a double-count would give 25)
    fs.appendFileSync(ctx.env.AUTOPILOT_COSTS_FILE, `${JSON.stringify({ ts: `${utcDay()}T02:00:00.000Z`, session: 's1', model: 'claude-opus-5-5', cost_usd: 5 })}\n`);
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(ctx.envelope().host_today_brain_usd, 15);
    // a partial last line is not parsed until it completes
    fs.appendFileSync(ctx.env.AUTOPILOT_COSTS_FILE, `{"ts":"${utcDay()}T03:00:00.000Z","session":"s1","model":"claude-fable-5-1",`);
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(ctx.envelope().host_today_brain_usd, 15);
    fs.appendFileSync(ctx.env.AUTOPILOT_COSTS_FILE, '"cost_usd":1}\n');
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(ctx.envelope().host_today_brain_usd, 16);
    // shrink: the file is replaced by a shorter one -> full re-read
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 2 }]);
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(ctx.envelope().host_today_brain_usd, 2);
    // rotation to a LONGER file (size alone cannot tell): the inode changes -> full re-read
    const rotated = `${ctx.env.AUTOPILOT_COSTS_FILE}.new`;
    fs.writeFileSync(rotated, [3, 4, 5].map((c) => JSON.stringify({ ts: `${utcDay()}T01:00:00.000Z`, session: 's9', model: 'claude-fable-5-1', cost_usd: c })).join('\n') + '\n');
    fs.renameSync(rotated, ctx.env.AUTOPILOT_COSTS_FILE);
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(ctx.envelope().host_today_brain_usd, 12);
  } finally { ctx.cleanup(); }
});

test('D1 an existing but unreadable costs file publishes null, never 0', { skip: typeof process.getuid === 'function' && process.getuid() === 0 }, () => {
  const ctx = mk();
  try {
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 10 }]);
    fs.chmodSync(ctx.env.AUTOPILOT_COSTS_FILE, 0o000);
    ctx.tick(ctx.watcher());
    assert.equal(ctx.envelope().host_today_brain_usd, null);
    assert.equal(ctx.envelope().brain_cap_usd, 150);
    fs.chmodSync(ctx.env.AUTOPILOT_COSTS_FILE, 0o600);
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
    row({ kind: 'ladder', rung: 'U0' }), // no ts: ignored even though it is last in file order
    row({ kind: 'ladder', rung: 'U1', ts: 'not-a-date' }), // invalid ts: ignored
    row({ kind: 'ladder', rung: 'U2', ts: '2026-10-09' }), // date without time: ignored
    row({ kind: 'ladder', rung: 'U5', ts: '2026-02-30T00:00:00Z' }), // lexically valid, calendar-invalid (Date -> Mar 2): must not win
    row({ kind: 'ladder', rung: 'U5', ts: '2026-10-09T24:00:00Z' }), // 24:00 rolls to the next day: ignored
  ] }];
  const s = buildDecisionsSidecar({ scope, ledgers, runs: [], wired: [] });
  assert.deepEqual(s.ladder, { rung: 'U3', at: '2026-10-09T04:00:00.000Z' });
  assert.equal(s.count, 1, 'ladder rows are not counted');
  assert.equal(s.rows.length, 1);
  const rooted = buildDecisionsSidecar({ scope: { ...scope, root_run_id: 'root-x' }, ledgers, runs: [], wired: [] });
  assert.deepEqual(rooted.ladder, { rung: 'U4', at: '2026-10-09T08:00:00.000Z' });
  assert.equal(buildDecisionsSidecar({ scope, ledgers: [{ source: 'ledger_default', rows: [] }], runs: [], wired: [] }).ladder, null);
  const onlyBad = [{ source: 'ledger_default', rows: [row({ kind: 'ladder', rung: 'U2' }), row({ kind: 'ladder', rung: 'U3', ts: 'garbage' })] }];
  assert.equal(buildDecisionsSidecar({ scope, ledgers: onlyBad, runs: [], wired: [] }).ladder, null, 'rows with a missing / invalid ts never produce a ladder');
  const calendar = [{ source: 'ledger_default', rows: [row({ kind: 'ladder', rung: 'U1', ts: '2026-01-15T00:00:00.000Z' }), row({ kind: 'ladder', rung: 'U5', ts: '2026-02-30T00:00:00Z' })] }];
  assert.deepEqual(buildDecisionsSidecar({ scope, ledgers: calendar, runs: [], wired: [] }).ladder, { rung: 'U1', at: '2026-01-15T00:00:00.000Z' }, '2026-02-30 (Date -> Mar 2) later in file order does not win');
  const offset = [{ source: 'ledger_default', rows: [row({ kind: 'ladder', rung: 'U4', ts: '2026-10-09T12:00:00+08:00' })] }];
  assert.deepEqual(buildDecisionsSidecar({ scope, ledgers: offset, runs: [], wired: [] }).ladder, { rung: 'U4', at: '2026-10-09T04:00:00.000Z' }, 'at is normalised to a UTC ISO string');
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
    assert.equal(validateJsonSchema(schemaOf('residue.schema.json'), fact).valid, true, 'residue validates against residue.schema.json');
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

test('D3 residue: clean-integrated + missing-dir + dirty -> reapable_worktrees 2 (a deleted worktree directory counts)', async () => {
  const ctx = residueFixture();
  try {
    const wtGone = path.join(ctx.base, 'wt-gone');
    git(ctx.repo, 'worktree', 'add', '-q', wtGone, '-b', 'gone-branch');
    fs.rmSync(wtGone, { recursive: true, force: true }); // no `git worktree prune`: git still lists it
    const { pub } = publisherOf(ctx);
    assert.equal(await pub.publish({ nowMs: ctx.now }), true);
    const fact = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
    assert.deepEqual(fact.by_class, { 'clean-integrated': 1, 'missing-dir': 1, dirty: 1 });
    assert.equal(fact.reapable_worktrees, 2);
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

// ---- residue auto-reap R4: the additive needs_human fields from <git-common-dir>/autopilot-residue-auto.json ----
const autoRecord = (over = {}) => ({
  schema: 'autopilot.residue-auto/1', ran_at: '2026-10-09T01:00:00.000Z', removed: [{ path: '/x/a' }, { path: '/x/b' }], archived: [{ branch: 'hands/z' }],
  needs_human: [
    { kind: 'worktree', path: '/x/dirty', class: 'dirty', age_days: 3.5, bytes: 1048576, reason: 'failure', command: 'git worktree remove --force /x/dirty' },
    { kind: 'branch', branch: 'feature/old', class: 'unintegrated-branch', age_days: 20, bytes: null, reason: null, command: 'git branch -D feature/old' },
  ],
  needs_human_count: 2, needs_human_bytes: 1048576, ...over,
});
const writeAuto = (ctx, rec) => fs.writeFileSync(path.join(ctx.repo, '.git', 'autopilot-residue-auto.json'), typeof rec === 'string' ? rec : JSON.stringify(rec));

const needsOf = (fact, name) => fact.needs_human.find((e) => e.path && e.path.endsWith(`/${name}`));

test('R4 residue: the list comes from the scan, sizes by path from the auto record, auto_* from the record; the fact validates and the schema id is unchanged', async () => {
  const ctx = residueFixture();
  try {
    const dirtyPath = fs.realpathSync(path.join(ctx.base, 'wt-dirty'));
    writeAuto(ctx, autoRecord({ needs_human: [{ kind: 'worktree', path: dirtyPath, class: 'dirty', age_days: 3.5, bytes: 1048576, reason: 'failure', command: 'x' }], needs_human_count: 99, needs_human_bytes: 99 }));
    const { pub, logs } = publisherOf(ctx);
    assert.equal(await pub.publish({ nowMs: ctx.now }), true);
    const fact = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
    assert.equal(fact.schema, 'autopilot.residue/1');
    assert.equal(fact.reapable_worktrees, 1, 'the scan part is unchanged');
    assert.equal(fact.needs_human_count, 2, 'count = the scan list (wt-dirty + the unmarked wt-clean), not the auto record count');
    assert.equal(needsOf(fact, 'wt-dirty').bytes, 1048576, 'bytes matched by path from the auto record');
    assert.equal(needsOf(fact, 'wt-clean').bytes, null, 'no cached size -> null');
    assert.equal(fact.needs_human_bytes, 1048576, 'sum of the known sizes');
    assert.match(needsOf(fact, 'wt-dirty').command, /status --short/);
    assert.equal(fact.auto_ran_at, '2026-10-09T01:00:00.000Z');
    assert.equal(fact.auto_removed_count, 2);
    assert.equal(fact.auto_archived_count, 1);
    const v = validateJsonSchema(schemaOf('residue.schema.json'), fact);
    assert.equal(v.valid, true, JSON.stringify(v));
    assert.deepEqual(logs, []);
  } finally { ctx.cleanup(); }
});

test('R4 residue: no auto record (never ran, or residue.auto_reap=false) still publishes the list; a foreign/garbage record adds no auto_* and no sizes', async () => {
  const ctx = residueFixture();
  try {
    const { pub } = publisherOf(ctx);
    for (const bad of [null, '{not json', JSON.stringify({ schema: 'other/1', needs_human_count: 5 }), JSON.stringify(autoRecord({ needs_human_count: -1 }))]) {
      if (bad === null) fs.rmSync(path.join(ctx.repo, '.git', 'autopilot-residue-auto.json'), { force: true }); else writeAuto(ctx, bad);
      assert.equal(await pub.publish({ nowMs: ctx.now += 61000 }), true);
      const fact = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
      const tag = String(bad).slice(0, 20);
      assert.equal(fact.needs_human_count, 2, `list published for ${tag}`);
      assert.equal(fact.needs_human.every((e) => e.bytes === null), true, tag);
      assert.equal(fact.needs_human_bytes, null, tag);
      assert.equal('auto_ran_at' in fact, false, `no auto_* for ${tag}`);
      assert.equal(validateJsonSchema(schemaOf('residue.schema.json'), fact).valid, true);
    }
  } finally { ctx.cleanup(); }
});

test('R4 residue: an entry the person resolved after the last auto run disappears on the next scan (the stale auto record does not resurrect it)', async () => {
  const ctx = residueFixture();
  try {
    const dirtyPath = fs.realpathSync(path.join(ctx.base, 'wt-dirty'));
    writeAuto(ctx, autoRecord({ needs_human: [{ kind: 'worktree', path: dirtyPath, class: 'dirty', age_days: 1, bytes: 4096, reason: null, command: 'x' }], needs_human_count: 1 }));
    const { pub } = publisherOf(ctx);
    assert.equal(await pub.publish({ nowMs: ctx.now }), true);
    assert.ok(needsOf(JSON.parse(fs.readFileSync(pub.file, 'utf8')), 'wt-dirty'));
    git(ctx.repo, 'worktree', 'remove', '--force', path.join(ctx.base, 'wt-dirty'));
    assert.equal(await pub.publish({ nowMs: ctx.now += 61000 }), true);
    const fact = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
    assert.equal(needsOf(fact, 'wt-dirty'), undefined);
    assert.equal(fact.needs_human_count, 1);
    assert.equal(fact.needs_human_bytes, null, 'the resolved entry no longer contributes its cached size');
  } finally { ctx.cleanup(); }
});

test('R4 residue: an old archive-ref (kind archive-ref, class archive-old) is counted and published, schema-valid', () => {
  const ref = 'refs/archive/2026-06-01/hands/x';
  const fact = buildResidueFact({ key: 'k', report: { worktrees: [], needs_human: [{ kind: 'archive-ref', ref, class: 'archive-old', age_days: 100, bytes: null, reason: 'archive ref older than 90 days', command: `git update-ref -d ${ref} abc` }, { kind: 'archive-ref', class: 'archive-old', age_days: 1, bytes: null, reason: null, command: 'x' }] }, atMs: 0, auto: null });
  assert.equal(fact.needs_human_count, 1, 'the ref-less entry is dropped, the real one counts');
  assert.equal(fact.needs_human[0].ref, ref);
  assert.equal(validateJsonSchema(schemaOf('residue.schema.json'), fact).valid, true);
});

test('R4 residue: needs_human rows are capped at 20 (the count keeps the true total)', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ kind: 'branch', branch: `b${i}`, class: 'unintegrated', age_days: 15, bytes: null, reason: null, command: `git branch -D b${i}` }));
  const fact = buildResidueFact({ key: 'k', report: { worktrees: [], needs_human: many }, atMs: 0, auto: null });
  assert.equal(fact.needs_human.length, 20);
  assert.equal(fact.needs_human_count, 30);
  assert.equal(validateJsonSchema(schemaOf('residue.schema.json'), fact).valid, true);
  assert.equal('needs_human_count' in buildResidueFact({ key: 'k', report: { worktrees: [] }, atMs: 0 }), false, 'a scan without needs_human adds no fields');
});

test('R4 residue: the watcher never starts du (sizes come only from the auto record)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'status', 'residue.js'), 'utf8');
  assert.equal(/['"]du['"]/.test(src), false);
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

test('D3 residue: if the main worktree cannot be resolved the publish is skipped (old file kept, one log line)', async () => {
  const ctx = residueFixture();
  try {
    const { pub } = publisherOf(ctx);
    assert.equal(await pub.publish({ nowMs: ctx.now }), true);
    const before = fs.readFileSync(pub.file, 'utf8');
    const bad = publisherOf(ctx, { repo: path.join(ctx.base, 'not-a-repo') });
    assert.equal(await bad.pub.publish({ nowMs: ctx.now + 120000 }), false);
    assert.equal(fs.readFileSync(pub.file, 'utf8'), before);
    assert.equal(bad.logs.length, 1);
    assert.match(bad.logs[0], /cannot resolve the main worktree/);
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
    assert.equal(validateJsonSchema(schemaOf('stage-walk.schema.json'), a).valid, true, 'stage walk validates against stage-walk.schema.json');
    for (const k of ['nodes', 'walk', 'entry', 'terminal', 'unit_kind']) assert.deepEqual(a[k], want[k], k);
    assert.deepEqual({ sid: a.sid, size: a.size, urgent: a.urgent, bug: a.bug, high_risk: a.high_risk, units: a.units, current: a.current }, { sid: 'sid-a', size: 'M', urgent: true, bug: true, high_risk: false, units: 3, current: 'implement' });
    assert.equal(a.stage_set_at, iso(ctx.now - 30000));
    assert.equal(a.at, iso(ctx.now));
    const b = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-b'), 'utf8'));
    assert.equal(b.units, null);
    assert.equal(validateJsonSchema(schemaOf('stage-walk.schema.json'), b).valid, true, 'unit-less walk validates too (units null)');
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

test('D4 a new task_seq resets the published walk: no carry-over of the previous task, task_seq published and schema-valid', () => {
  const ctx = mk();
  try {
    const unit = { kind: 'phase', index: 3, total: 3, label: 'ship' };
    writeMarker(ctx, 'sid-t', { size: 'L', stage: 'qc-gate', stage_set_at: iso(ctx.now - 5000), unit, task_seq: 1 });
    const w = ctx.watcher();
    ctx.tick(w);
    const first = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-t'), 'utf8'));
    assert.equal(first.task_seq, 1);
    assert.equal(first.current, 'qc-gate');
    assert.equal(first.units, 3);
    assert.equal(validateJsonSchema(schemaOf('stage-walk.schema.json'), first).valid, true);
    // same size and flags, stage/unit cleared, task_seq bumped (what `session-mode.js set --new-task --size L` writes)
    writeMarker(ctx, 'sid-t', { size: 'L', task_seq: 2, task_started_at: iso(ctx.now) });
    ctx.now += 15000;
    ctx.tick(w);
    const second = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-t'), 'utf8'));
    assert.equal(second.task_seq, 2);
    assert.equal(second.current, null, 'previous stage does not carry over');
    assert.equal(second.stage_set_at, null);
    assert.equal(second.units, null, 'previous unit total does not carry over');
    assert.equal(second.at, iso(ctx.now), 'the file was rewritten');
    assert.equal(validateJsonSchema(schemaOf('stage-walk.schema.json'), second).valid, true);
    // task_seq alone moves the signature: identical walk inputs, new seq -> rewrite
    writeMarker(ctx, 'sid-t', { size: 'L', task_seq: 3 });
    ctx.now += 15000;
    ctx.tick(w);
    const third = JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-t'), 'utf8'));
    assert.equal(third.task_seq, 3);
    assert.equal(third.at, iso(ctx.now));
    // a marker without task_seq publishes null
    writeMarker(ctx, 'sid-u', { size: 'S' });
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(JSON.parse(fs.readFileSync(stageFile(ctx, 'sid-u'), 'utf8')).task_seq, null);
  } finally { ctx.cleanup(); }
});

test('D4 a new-task marker without size removes the previous task stage file', () => {
  const ctx = mk();
  try {
    writeMarker(ctx, 'sid-ns', { size: 'L', stage: 'plan', stage_set_at: iso(ctx.now), task_seq: 1 });
    const w = ctx.watcher();
    ctx.tick(w);
    assert.ok(fs.existsSync(stageFile(ctx, 'sid-ns')));
    writeMarker(ctx, 'sid-ns', { task_seq: 2, task_started_at: iso(ctx.now) });
    ctx.now += 15000;
    ctx.tick(w);
    assert.equal(fs.existsSync(stageFile(ctx, 'sid-ns')), false, 'no stale walk of the previous task');
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

// ---- follow-up C: host-wide spend history (sparkline source) -----------------------------------------------------------------
const { createSpendHistoryPublisher, SAMPLE_EVERY_S, KEEP_MS, MAX_SAMPLES } = require('../src/status/spend-history');
const spendHistoryOf = (ctx) => { const f = path.join(ctx.live, 'runs', 'spend-history.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

test('C spend history: the first tick samples host_today_brain_usd into <live>/runs/spend-history.json (host-wide file, schema-valid)', () => {
  const ctx = mk();
  try {
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 12.3456 }]);
    ctx.tick(ctx.watcher());
    const h = spendHistoryOf(ctx);
    assert.equal(h.schema, 'autopilot.spend-history/1');
    assert.deepEqual(h.samples, [{ at: iso(ctx.now), usd: 12.35 }]);
    assert.equal(validateJsonSchema(schemaOf('spend-history.schema.json'), h).valid, true);
    assert.equal(fs.existsSync(path.join(ctx.live, 'runs', `${ctx.scope.project_key}.spend-history.json`)), false, 'one host file, not one per project');
  } finally { ctx.cleanup(); }
});

test('C spend history: at most one sample per 15 minutes, however many ticks (and a second watcher reads the throttle from the file)', () => {
  const ctx = mk();
  try {
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 5 }]);
    const w = ctx.watcher();
    ctx.tick(w);
    for (let i = 0; i < 20; i++) { ctx.now += 40 * 1000; ctx.tick(w); } // ~13 minutes of 40 s ticks
    assert.equal(spendHistoryOf(ctx).samples.length, 1);
    ctx.now += 2 * 60 * 1000; // 15 min 20 s after the first
    ctx.tick(ctx.watcher()); // a different watcher instance: the throttle is the file's last sample
    assert.equal(spendHistoryOf(ctx).samples.length, 2);
    ctx.now += (SAMPLE_EVERY_S - 1) * 1000;
    ctx.tick(w);
    assert.equal(spendHistoryOf(ctx).samples.length, 2, 'one second short of 15 minutes: no sample');
    ctx.now += 2000;
    ctx.tick(w);
    assert.equal(spendHistoryOf(ctx).samples.length, 3);
  } finally { ctx.cleanup(); }
});

test('C spend history: no costs file (null spend) adds no sample and creates no file; an unreadable history is started afresh', () => {
  const ctx = mk();
  try {
    ctx.tick(ctx.watcher());
    assert.equal(spendHistoryOf(ctx), null, 'null is not 0: nothing is recorded');
    writeCosts(ctx, [{ model: 'claude-fable-5-1', cost_usd: 1 }]);
    fs.mkdirSync(path.join(ctx.live, 'runs'), { recursive: true });
    fs.writeFileSync(path.join(ctx.live, 'runs', 'spend-history.json'), '{not json');
    ctx.now += 1000;
    ctx.tick(ctx.watcher());
    assert.equal(spendHistoryOf(ctx).samples.length, 1);
  } finally { ctx.cleanup(); }
});

test('C spend history: samples older than 48 hours are dropped, the rest kept in order; the count is capped; the write leaves no tmp file', () => {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'autopilot-test-sh-'));
  try {
    const writeAtomic = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', t); fs.renameSync(f + '.tmp', f); };
    const pub = createSpendHistoryPublisher({ live, writeAtomic });
    const t0 = Date.parse('2026-10-10T00:00:00.000Z');
    assert.equal(pub.publish({ nowMs: t0, usd: 1 }), true);
    assert.equal(pub.publish({ nowMs: t0 + 20 * 60 * 1000, usd: 2 }), true);
    assert.equal(pub.publish({ nowMs: t0 + KEEP_MS + 30 * 60 * 1000, usd: 3 }), true);
    let h = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
    assert.deepEqual(h.samples.map((s) => s.usd), [3], 'both earlier samples are > 48 h old');
    assert.equal(pub.publish({ nowMs: t0 + KEEP_MS + 25 * 60 * 1000, usd: 9 }), false, 'a clock that went backwards adds nothing');
    assert.ok(h.samples.length >= 1);
    assert.deepEqual(fs.readdirSync(path.join(live, 'runs')), ['spend-history.json']);
    const t = t0 + KEEP_MS + 2 * 3600 * 1000;
    assert.equal(pub.publish({ nowMs: t, usd: -1 }), false);
    assert.equal(pub.publish({ nowMs: t, usd: NaN }), false);
  } finally { fs.rmSync(live, { recursive: true, force: true }); }
});

test('C spend history: a history above MAX_SAMPLES is cut to the newest MAX_SAMPLES on the next write', () => {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'autopilot-test-shcap-'));
  try {
    const writeAtomic = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
    const pub = createSpendHistoryPublisher({ live, writeAtomic });
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    const n = MAX_SAMPLES + 100; // 500 samples 5 minutes apart: all inside 48 h, so only the cap can cut
    const samples = Array.from({ length: n }, (_, i) => ({ at: iso(now - (n - i + 3) * 5 * 60 * 1000), usd: i }));
    assert.ok(now - Date.parse(samples[0].at) < KEEP_MS);
    fs.mkdirSync(path.join(live, 'runs'), { recursive: true });
    fs.writeFileSync(pub.file, JSON.stringify({ schema: 'autopilot.spend-history/1', updated_at: iso(now), samples }));
    assert.equal(pub.publish({ nowMs: now, usd: 999 }), true);
    const h = JSON.parse(fs.readFileSync(pub.file, 'utf8'));
    assert.equal(h.samples.length, MAX_SAMPLES);
    assert.deepEqual(h.samples[h.samples.length - 1], { at: iso(now), usd: 999 });
    assert.equal(h.samples[0].usd, n - (MAX_SAMPLES - 1), 'the oldest ones were cut, the newest kept');
  } finally { fs.rmSync(live, { recursive: true, force: true }); }
});

test('C spend history: a last sample dated more than 15 minutes in the future is stale: dropped, and sampling resumes', () => {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'autopilot-test-shfut-'));
  try {
    const writeAtomic = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
    const pub = createSpendHistoryPublisher({ live, writeAtomic });
    const now = Date.parse('2026-10-10T12:00:00.000Z');
    fs.mkdirSync(path.join(live, 'runs'), { recursive: true });
    const put = (samples) => fs.writeFileSync(pub.file, JSON.stringify({ schema: 'autopilot.spend-history/1', updated_at: iso(now), samples }));
    put([{ at: iso(now - 3600e3), usd: 1 }, { at: iso(now + 3 * 3600e3), usd: 7 }]);
    assert.equal(pub.publish({ nowMs: now, usd: 2 }), true, 'the future sample did not block sampling');
    assert.deepEqual(JSON.parse(fs.readFileSync(pub.file, 'utf8')).samples.map((s) => s.usd), [1, 2]);
    put([{ at: iso(now - 3600e3), usd: 1 }, { at: iso(now + 10 * 60e3), usd: 7 }]);
    assert.equal(pub.publish({ nowMs: now, usd: 2 }), false, 'within 15 minutes ahead it still throttles');
  } finally { fs.rmSync(live, { recursive: true, force: true }); }
});

test('C spend history: a write failure is logged once and the tick survives', () => {
  const logs = [];
  const pub = createSpendHistoryPublisher({ live: '/nonexistent-live', writeAtomic: () => { throw new Error('EROFS'); }, log: (m) => logs.push(m) });
  assert.equal(pub.publish({ nowMs: Date.now(), usd: 4 }), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /EROFS/);
});
