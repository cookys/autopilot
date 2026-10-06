'use strict';
// scripts/review-input.test.js — stage-graph P7d: the review facts of the runs watcher (src/status/review-input.js).
// Plan-review reader (selection rules: repo match, active beats terminal, newest wins), code-review round reader, and the
// watcher publishing <live>/runs/<project_key>.review.json (autopilot.review/1). The writer side of the round summary
// (hetero-review-loop collect) is pinned in hooks/tests/hetero-review-loop.test.sh case 3b/4b.
// Isolation: every dir is a mkdtemp dir (live dir under /dev/shm); nothing touches the real stores.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readPlanReview, readCodeReview, ROUND_SCHEMA } = require('../src/status/review-input');
const { createWatcher } = require('../src/status/runs-watch');
const { scopeFromCwd } = require('../src/status/project-key');

const IDENT = 'git-common-dir:/fixture/a/.git';
const OTHER = 'git-common-dir:/fixture/b/.git';
const VALIDATE = path.join(__dirname, 'validate-json-schema.js');
const SCHEMA = path.join(__dirname, '..', 'schemas', 'review.schema.json');
function validates(doc, dir) {
  const f = path.join(dir, 'doc.json');
  fs.writeFileSync(f, JSON.stringify(doc));
  const r = spawnSync(process.execPath, [VALIDATE, '--schema', SCHEMA, '--document', f], { encoding: 'utf8' });
  return r.status === 0 ? '' : r.stdout + r.stderr;
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'review-input-')); }

// One plan-review session dir: state.json (+ generation artifacts); mtime pins the recency.
function session(root, { identity = IDENT, ticket, logical = 'plan-x', terminal = false, verdict = null, claimGen = null, maxGen = 2, gens = {}, mtimeS }) {
  const key = sha(`${identity}\0${ticket}`);
  const dir = path.join(root, key);
  fs.mkdirSync(dir, { recursive: true });
  const state = {
    version: 2, session_key: key, repo_identity: identity, logical_plan_id: logical, ticket, max_generations: maxGen,
    next_generation: 1, active_claim: claimGen === null ? null : { generation: claimGen }, terminal, terminal_verdict: terminal ? verdict : null,
    claims: [], artifacts: [],
  };
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify(state));
  for (const [g, art] of Object.entries(gens)) fs.writeFileSync(path.join(dir, `generation-${String(g).padStart(2, '0')}.json`), JSON.stringify(art));
  fs.utimesSync(file, mtimeS, mtimeS);
  return key;
}
const reviewers = (...rows) => ({ verdict: 'CONDITIONAL', reviewer_verdicts: rows.map(([seat_id, family, verdict]) => ({ seat_id, target_id: seat_id, family, verdict })) });

test('PR1 no state dir, empty dir, or no identity -> null', () => {
  const root = tmp();
  try {
    assert.equal(readPlanReview({ identity: IDENT, stateRoot: path.join(root, 'absent') }), null);
    assert.equal(readPlanReview({ identity: IDENT, stateRoot: root }), null);
    session(root, { ticket: 't1', mtimeS: 1000 });
    assert.equal(readPlanReview({ identity: null, stateRoot: root }), null);
    assert.equal(readPlanReview({ identity: OTHER, stateRoot: root }), null, 'a state of another repo is invisible');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PR2 active session: generation from the active claim, seats from the latest generation artifact, verdict is not terminal', () => {
  const root = tmp();
  try {
    session(root, {
      ticket: 't1', logical: 'plan-active', claimGen: 2, mtimeS: 2000,
      gens: { 1: reviewers(['sol', 'openai', 'STOP'], ['grok', 'xai', 'CONDITIONAL']) },
    });
    const r = readPlanReview({ identity: IDENT, stateRoot: root });
    assert.deepEqual(r, {
      logical_plan_id: 'plan-active', generation: 2, max_generations: 2, terminal: false, verdict: 'CONDITIONAL',
      seats: [{ id: 'sol', family: 'openai', status: 'STOP' }, { id: 'grok', family: 'xai', status: 'CONDITIONAL' }],
      updated_at: new Date(2000 * 1000).toISOString(),
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PR3 terminal session: verdict is terminal_verdict, generation is the highest artifact', () => {
  const root = tmp();
  try {
    session(root, {
      ticket: 't1', terminal: true, verdict: 'GO', mtimeS: 3000,
      gens: { 1: reviewers(['a', 'openai', 'STOP']), 2: { verdict: 'GO', reviewer_verdicts: [{ seat_id: 'a', family: 'openai', verdict: 'GO' }] } },
    });
    const r = readPlanReview({ identity: IDENT, stateRoot: root });
    assert.equal(r.terminal, true);
    assert.equal(r.verdict, 'GO');
    assert.equal(r.generation, 2);
    assert.deepEqual(r.seats, [{ id: 'a', family: 'openai', status: 'GO' }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PR4 several sessions: active beats a newer terminal; among equals the newest wins; other repos never count', () => {
  const root = tmp();
  try {
    session(root, { ticket: 'old-active', logical: 'old-active', mtimeS: 1000 });
    session(root, { ticket: 'new-terminal', logical: 'new-terminal', terminal: true, verdict: 'GO', mtimeS: 9000 });
    session(root, { ticket: 'foreign-active', logical: 'foreign', identity: OTHER, mtimeS: 9500 });
    assert.equal(readPlanReview({ identity: IDENT, stateRoot: root }).logical_plan_id, 'old-active', 'active beats a newer terminal');
    session(root, { ticket: 'newer-active', logical: 'newer-active', mtimeS: 5000 });
    assert.equal(readPlanReview({ identity: IDENT, stateRoot: root }).logical_plan_id, 'newer-active', 'newest active wins');
    assert.equal(readPlanReview({ identity: OTHER, stateRoot: root }).logical_plan_id, 'foreign');
    fs.rmSync(path.join(root, sha(`${IDENT}\0newer-active`)), { recursive: true });
    fs.rmSync(path.join(root, sha(`${IDENT}\0old-active`)), { recursive: true });
    assert.equal(readPlanReview({ identity: IDENT, stateRoot: root }).logical_plan_id, 'new-terminal', 'only terminal left: newest terminal');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('PR5 malformed state, wrong version and a session_key that differs from its directory are skipped', () => {
  const root = tmp();
  try {
    const good = session(root, { ticket: 'good', logical: 'good', mtimeS: 1000 });
    const bad = sha('x');
    fs.mkdirSync(path.join(root, bad));
    fs.writeFileSync(path.join(root, bad, 'state.json'), '{not json');
    const v1 = sha('y');
    fs.mkdirSync(path.join(root, v1));
    fs.writeFileSync(path.join(root, v1, 'state.json'), JSON.stringify({ version: 1, repo_identity: IDENT, session_key: v1 }));
    const liar = sha('z');
    fs.mkdirSync(path.join(root, liar));
    fs.writeFileSync(path.join(root, liar, 'state.json'), JSON.stringify({ version: 2, repo_identity: IDENT, session_key: good, logical_plan_id: 'liar' }));
    assert.equal(readPlanReview({ identity: IDENT, stateRoot: root }).logical_plan_id, 'good');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CR1 round summary reader: absent, wrong schema, wrong project and a good file', () => {
  const live = tmp();
  try {
    const key = 'abcdef0123456789';
    const file = path.join(live, 'review-rounds', `${key}.json`);
    assert.equal(readCodeReview({ liveBase: live, key }), null);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const round = { schema: ROUND_SCHEMA, project_key: key, phase: 'p1', generation: 2, base: 'b', head: 'h', seats: [{ id: 's0', family: 'openai', status: 'reviewed', verdict: 'FIX-THEN-SHIP' }], converged: false, at: '2026-10-06T00:00:00.000Z' };
    fs.writeFileSync(file, JSON.stringify({ ...round, schema: 'nope' }));
    assert.equal(readCodeReview({ liveBase: live, key }), null);
    fs.writeFileSync(file, JSON.stringify({ ...round, project_key: 'ffffffffffffffff' }));
    assert.equal(readCodeReview({ liveBase: live, key }), null);
    fs.writeFileSync(file, JSON.stringify(round));
    assert.deepEqual(readCodeReview({ liveBase: live, key }), {
      phase: 'p1', generation: 2, base: 'b', head: 'h', seats: [{ id: 's0', family: 'openai', status: 'reviewed', verdict: 'FIX-THEN-SHIP' }], converged: false, at: '2026-10-06T00:00:00.000Z',
    });
  } finally { fs.rmSync(live, { recursive: true, force: true }); }
});

function watcherCtx() {
  const base = tmp();
  const live = fs.mkdtempSync(path.join('/dev/shm', 'autopilot-test-review-'));
  fs.chmodSync(live, 0o700);
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  const scope = scopeFromCwd(repo);
  const planRoot = path.join(base, 'plan-review');
  fs.mkdirSync(planRoot);
  const env = {
    PATH: process.env.PATH, HOME: path.join(base, 'home'), AUTOPILOT_LIVE_DIR: live, AUTOPILOT_PLAN_REVIEW_STATE_DIR: planRoot,
    AUTOPILOT_SESSION_MODE_DIR: path.join(base, 'markers'), AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs'),
    AUTOPILOT_COSTS_FILE: path.join(base, 'costs.jsonl'), TMPDIR: base,
  };
  for (const d of [env.HOME, env.AUTOPILOT_SESSION_MODE_DIR, env.AUTOPILOT_DISPATCH_RUNS_DIR]) fs.mkdirSync(d, { recursive: true });
  return {
    base, live, repo, scope, planRoot, env,
    file: path.join(live, 'runs', `${scope.project_key}.review.json`),
    watcher: () => createWatcher({ key: scope.project_key, env, cwd: repo, collect: () => [], now: () => Date.now(), render: null }),
    cleanup: () => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(live, { recursive: true, force: true }); },
  };
}

test('RW1 the watcher publishes the review fact (plan + code), and removes it when both sources vanish', () => {
  const c = watcherCtx();
  try {
    const w = c.watcher();
    assert.equal(w.tick().error, undefined);
    assert.equal(fs.existsSync(c.file), false, 'no review source -> no fact');

    session(c.planRoot, { identity: c.scope.repo_identity, ticket: 't1', logical: 'plan-w', claimGen: 1, mtimeS: 4000 });
    const roundFile = path.join(c.live, 'review-rounds', `${c.scope.project_key}.json`);
    fs.mkdirSync(path.dirname(roundFile), { recursive: true });
    fs.writeFileSync(roundFile, JSON.stringify({ schema: ROUND_SCHEMA, project_key: c.scope.project_key, phase: 'p9', generation: 1, base: 'b', head: 'h', seats: [], converged: true, at: '2026-10-06T00:00:00.000Z' }));
    assert.equal(w.tick().error, undefined);
    const fact = JSON.parse(fs.readFileSync(c.file, 'utf8'));
    assert.equal(fact.schema, 'autopilot.review/1');
    assert.equal(fact.project_key, c.scope.project_key);
    assert.equal(fact.plan.logical_plan_id, 'plan-w');
    assert.equal(fact.plan.generation, 1);
    assert.equal(fact.code.phase, 'p9');
    assert.equal(fact.code.converged, true);
    assert.equal(validates(fact, c.base), '', 'autopilot.review/1 fits schemas/review.schema.json');
    const roundDoc = JSON.parse(fs.readFileSync(roundFile, 'utf8'));
    assert.equal(validates(roundDoc, c.base), '', 'autopilot.review-round/1 fits the schema');
    assert.notEqual(validates({ ...fact, extra: 1 }, c.base), '', 'negative control: an unknown key is refused');
    assert.notEqual(validates({ ...roundDoc, converged: 'yes' }, c.base), '', 'negative control: a wrong type is refused');

    fs.rmSync(roundFile);
    fs.rmSync(path.join(c.planRoot, sha(`${c.scope.repo_identity}\0t1`)), { recursive: true });
    assert.equal(w.tick().error, undefined);
    assert.equal(fs.existsSync(c.file), false, 'both sources gone -> fact removed');
  } finally { c.cleanup(); }
});
