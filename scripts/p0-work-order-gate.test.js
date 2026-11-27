'use strict';

require('./lib/test-git-env.js');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { validateJsonSchema } = require('./validate-json-schema.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const SESSION_MODE = path.join(REPO_ROOT, 'scripts', 'session-mode.js');
const STAGE_ADVANCE = path.join(REPO_ROOT, 'scripts', 'stage-advance.js');
const MARKER_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'session-marker.schema.json'), 'utf8'),
);

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || '').trim();
}

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-lane-test-'));
  const home = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  const markerDir = path.join(root, 'markers');
  const prStateDir = path.join(root, 'plan-review-state');
  const repo = path.join(root, 'repo');
  const fleetFixturesDir = path.join(root, 'fleet-fixtures');
  const fleetLog = path.join(root, 'fleet.log');

  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.mkdirSync(prStateDir, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(fleetFixturesDir, { recursive: true });
  fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), '{}\n');

  git(repo, ['init', '-q', '-b', 'develop']);
  git(repo, ['config', 'user.email', 't@t']);
  git(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-q', '-m', 'init']);

  // Fake `fleet` placed first on PATH.
  // Reads JSON fixture from $FLEET_FIXTURES_DIR/<id>.json; if missing or $FLEET_OUTAGE=1, exits 1.
  const fleetBin = path.join(binDir, 'fleet');
  fs.writeFileSync(fleetBin, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FLEET_TEST_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'task' && args[1] === 'show') {
  if (process.env.FLEET_TEST_OUTAGE === '1') {
    process.stderr.write('fleet: connection refused\\n');
    process.exit(1);
  }
  if (process.env.FLEET_TEST_BAD_JSON === '1') {
    process.stdout.write('{not valid json');
    process.exit(0);
  }
  const f = path.join(process.env.FLEET_FIXTURES_DIR, args[2] + '.json');
  if (!fs.existsSync(f)) {
    process.stderr.write('fleet: task not found\\n');
    process.exit(2);
  }
  process.stdout.write(fs.readFileSync(f, 'utf8'));
  process.exit(0);
}
if (args[0] === 'task' && args[1] === 'update') {
  process.exit(0);
}
process.exit(0);
`, { mode: 0o755 });
  fs.chmodSync(fleetBin, 0o755);

  let sessCounter = 0;
  function newSession() {
    sessCounter += 1;
    return `p0-sess-${sessCounter}`;
  }

  function makeEnv(sessionId, extra = {}) {
    const env = {
      ...process.env,
      HOME: home,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      AUTOPILOT_CONFIG_FILE: path.join(home, '.autopilot', 'config.json'),
      AUTOPILOT_SESSION_MODE_DIR: markerDir,
      AUTOPILOT_PLAN_REVIEW_STATE_DIR: prStateDir,
      AUTOPILOT_SESSION_ID: sessionId,
      AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
      AUTOPILOT_REVIEW_SERVER_AUTOSTART: '0',
      AUTOPILOT_CARD_NOTIFY: 'off',
      FLEET_FIXTURES_DIR: fleetFixturesDir,
      FLEET_TEST_LOG: fleetLog,
      ...extra,
    };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    delete env.CODEX_THREAD_ID;
    delete env.AUTOPILOT_PARENT_SESSION_ID;
    delete env.FLEET_BIN;
    return env;
  }

  function setTaskFixture(id, title) {
    fs.writeFileSync(
      path.join(fleetFixturesDir, `${id}.json`),
      JSON.stringify({ id, title }),
    );
  }

  function sm(sessionId, args, extraEnv = {}) {
    return spawnSync(process.execPath, [SESSION_MODE, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: makeEnv(sessionId, extraEnv),
    });
  }

  function sa(sessionId, args, extraEnv = {}) {
    return spawnSync(process.execPath, [STAGE_ADVANCE, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: makeEnv(sessionId, extraEnv),
    });
  }

  function readMarker(sessionId) {
    return JSON.parse(fs.readFileSync(path.join(markerDir, `${sessionId}.json`), 'utf8'));
  }

  function assertSchemaValid(sessionId) {
    const m = readMarker(sessionId);
    const res = validateJsonSchema(MARKER_SCHEMA, m);
    assert.equal(res.valid, true, `marker schema invalid: ${JSON.stringify(res.errors)}`);
    return m;
  }

  return {
    root,
    repo,
    markerDir,
    prStateDir,
    fleetLog,
    newSession,
    setTaskFixture,
    sm,
    sa,
    readMarker,
    assertSchemaValid,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('lane: no task attached leaves session-mode and stage-advance behaviour unchanged with no extra output', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    const r1 = sb.sm(sid, ['set', '--size', 'S', '--repo-root', sb.repo]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r1.stderr.trim(), '');
    const r2 = sb.sa(sid, ['--to', 'implement', '--repo-root', sb.repo]);
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stderr.trim(), '');
    const m = sb.assertSchemaValid(sid);
    assert.equal(m.stage, 'implement');
    assert.equal(m.wo_task, undefined);
    assert.equal(m.plan_receipt, undefined);
  } finally {
    sb.cleanup();
  }
});

test('lane: Size S resolved order prints nothing on stderr and enters implement without receipt', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    sb.setTaskFixture('T_S', 'Size: S\nSmall change');
    const r1 = sb.sm(sid, ['set', '--fleet-task', 'T_S', '--repo-root', sb.repo]);
    assert.equal(r1.status, 0, r1.stderr);
    assert.equal(r1.stderr.trim(), '', 'non-M+ resolved order prints nothing');
    const m = sb.assertSchemaValid(sid);
    assert.equal(m.wo_task, 'T_S');
    assert.equal(m.wo_size, 'S');
    assert.equal(m.wo_state, 'resolved');
    assert.equal(m.size, 'S');
    const r2 = sb.sa(sid, ['--to', 'implement', '--repo-root', sb.repo]);
    assert.equal(r2.status, 0, r2.stderr);
  } finally {
    sb.cleanup();
  }
});

test('lane: wo_size=M plan-first refuses without receipt, refuses dirty --plan, allows clean HEAD --plan, refuses missing blob', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    sb.setTaskFixture('T_M_PF', 'Size: M\nPlan: plan-first');

    const rSet = sb.sm(sid, ['set', '--fleet-task', 'T_M_PF', '--repo-root', sb.repo]);
    assert.equal(rSet.status, 0, rSet.stderr);
    const m0 = sb.assertSchemaValid(sid);
    assert.equal(m0.size, 'M');
    assert.equal(m0.wo_size, 'M');
    assert.equal(m0.wo_plan, 'plan-first');
    assert.equal(m0.wo_state, 'resolved');

    // Walk plan -> plan-review
    for (const node of ['plan', 'plan-review']) {
      const r = sb.sa(sid, ['--to', node, '--repo-root', sb.repo]);
      assert.equal(r.status, 0, `advance to ${node}: ${r.stderr}`);
    }
    const assertGateRefusal = (r, code) => {
      assert.equal(r.status, 5, `${r.stdout} ${r.stderr}`);
      assert.equal(JSON.parse(r.stdout).code, code);
    };

    // No receipt -> --to implement refused
    const rNoReceipt = sb.sa(sid, ['--to', 'implement', '--repo-root', sb.repo]);
    assertGateRefusal(rNoReceipt, 'PLAN_RECEIPT_REQUIRED');

    // Uncommitted plan file -> --plan refused
    const planRel = 'docs/plans/m-plan.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Plan M\n');
    const rUntracked = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assertGateRefusal(rUntracked, 'PLAN_RECEIPT_INVALID');

    // Commit then dirty -> --plan refused
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add m-plan']);
    fs.appendFileSync(path.join(sb.repo, planRel), 'dirty edit\n');
    const rDirty = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assertGateRefusal(rDirty, 'PLAN_RECEIPT_INVALID');

    // Restore clean -> --plan succeeds
    git(sb.repo, ['checkout', '--', planRel]);
    const rClean = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.equal(rClean.status, 0, rClean.stderr);
    const m1 = sb.assertSchemaValid(sid);
    assert.equal(m1.stage, 'implement');
    assert.equal(m1.plan_receipt.path, planRel);
    assert.equal(m1.plan_receipt.plan_sha256, sha256Hex(fs.readFileSync(path.join(sb.repo, planRel))));

    // Blob gone -> --to implement refused
    const broken = { ...m1, plan_receipt: { ...m1.plan_receipt, blob_sha: '0'.repeat(40) } };
    fs.writeFileSync(path.join(sb.markerDir, `${sid}.json`), JSON.stringify(broken, null, 2));
    const rBlobGone = sb.sa(sid, ['--to', 'implement', '--repo-root', sb.repo]);
    assertGateRefusal(rBlobGone, 'PLAN_BLOB_MISSING');
  } finally {
    sb.cleanup();
  }
});

test('lane: Plan: path@sha derives receipt at set --fleet-task and rejects unresolvable sha:path', () => {
  const sb = makeSandbox();
  try {
    const planRel = 'docs/plans/pinned.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Pinned Plan\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'commit pinned plan']);
    const headSha = git(sb.repo, ['rev-parse', 'HEAD']);

    const sid1 = sb.newSession();
    sb.setTaskFixture('T_PIN_OK', `Size: M\nPlan: ${planRel}@${headSha.slice(0, 10)}`);
    const r1 = sb.sm(sid1, ['set', '--fleet-task', 'T_PIN_OK', '--repo-root', sb.repo]);
    assert.equal(r1.status, 0, r1.stderr);
    const m1 = sb.assertSchemaValid(sid1);
    assert.equal(m1.wo_state, 'resolved');
    assert.equal(m1.plan_receipt.commit, headSha);
    assert.equal(m1.plan_receipt.plan_sha256, sha256Hex(fs.readFileSync(path.join(sb.repo, planRel))));

    assert.equal(sb.sa(sid1, ['--to', 'plan', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sid1, ['--to', 'plan-review', '--repo-root', sb.repo]).status, 0);
    const rImpl = sb.sa(sid1, ['--to', 'implement', '--repo-root', sb.repo]);
    assert.equal(rImpl.status, 0, rImpl.stderr);

    // Unresolvable path@sha -> wo_state: unresolved, --to implement refused
    const sid2 = sb.newSession();
    sb.setTaskFixture('T_PIN_BAD', 'Size: M\nPlan: docs/plans/missing.md@deadbeef');
    const r2 = sb.sm(sid2, ['set', '--fleet-task', 'T_PIN_BAD', '--repo-root', sb.repo]);
    assert.equal(r2.status, 0, r2.stderr);
    const m2 = sb.assertSchemaValid(sid2);
    assert.equal(m2.wo_state, 'unresolved');
    assert.equal(sb.sa(sid2, ['--to', 'plan', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sid2, ['--to', 'plan-review', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sid2, ['--to', 'implement', '--repo-root', sb.repo]).status, 5);
  } finally {
    sb.cleanup();
  }
});

test('lane: L size requires passing check-phase-review-receipt and re-records across generation 2', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    const planRel = 'docs/plans/l-plan.md';
    const rubricRel = 'docs/plans/l-plan.rubric.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# L Plan g1\n');
    fs.writeFileSync(path.join(sb.repo, rubricRel), '# Rubric\n- R1: completeness\n');
    git(sb.repo, ['add', planRel, rubricRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add L plan g1']);

    sb.setTaskFixture('T_L', 'Size: L\nPlan: plan-first');
    assert.equal(sb.sm(sid, ['set', '--fleet-task', 'T_L', '--repo-root', sb.repo]).status, 0);
    for (const node of ['intent', 'proposal', 'plan', 'plan-review']) {
      const r = sb.sa(sid, ['--to', node, '--repo-root', sb.repo]);
      assert.equal(r.status, 0, `advance to ${node}: ${r.stderr}`);
    }

    // L receipt without plan-review pass refused
    const rNoReview = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.notEqual(rNoReview.status, 0, 'L without plan-review pass must be refused');

    // Write g1 artifact + dispositions (with cross-family seat)
    const sessionStateDir = path.join(sb.prStateDir, 'a'.repeat(64));
    fs.mkdirSync(sessionStateDir, { recursive: true });
    const rubricSha = sha256Hex(fs.readFileSync(path.join(sb.repo, rubricRel)));
    const g1PlanSha = sha256Hex(fs.readFileSync(path.join(sb.repo, planRel)));

    function writeReviewGen(gen, planSha) {
      fs.writeFileSync(
        path.join(sessionStateDir, `generation-0${gen}.json`),
        JSON.stringify({
          schema_version: 1,
          artifact_type: 'plan_review_artifact',
          logical_plan_id: 'l-plan',
          generation: gen,
          plan_sha256: planSha,
          rubric_sha256: rubricSha,
          plan_path: planRel,
          rubric_path: rubricRel,
          findings: [],
          reviewer_verdicts: [
            { seat_id: 'chair', runner: 'codex', model: 'gpt-5', family: 'openai', verdict: 'READY' },
          ],
        }),
      );
      fs.writeFileSync(
        path.join(sessionStateDir, `g${gen}-disposition.json`),
        JSON.stringify({
          logical_plan_id: 'l-plan',
          generation: gen,
          findings: [],
        }),
      );
    }

    writeReviewGen(1, g1PlanSha);
    const rG1 = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.equal(rG1.status, 0, `L with g1 pass should succeed: ${rG1.stderr}`);

    // Generation 2 edits the plan and runs g2 review
    fs.writeFileSync(path.join(sb.repo, planRel), '# L Plan g2 (repaired)\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'update L plan g2']);
    const g2PlanSha = sha256Hex(fs.readFileSync(path.join(sb.repo, planRel)));

    // Before g2 review artifact exists, re-recording g2 plan is refused (g1 sha != g2 sha)
    const rG2Before = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.notEqual(rG2Before.status, 0, 'g2 plan without g2 review artifact must be refused');

    writeReviewGen(2, g2PlanSha);
    const rG2After = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.equal(rG2After.status, 0, `L after g2 --plan re-record should pass: ${rG2After.stderr}`);
    const mAfter = sb.assertSchemaValid(sid);
    assert.equal(mAfter.plan_receipt.plan_sha256, g2PlanSha);
  } finally {
    sb.cleanup();
  }
});

test('lane: fetch outage preserves prior resolved M, outage with nothing resolved marks unresolved, --refresh recovers', () => {
  const sb = makeSandbox();
  try {
    // Case A: previous resolved M + outage -> still refused
    const sid1 = sb.newSession();
    sb.setTaskFixture('T_OUT_M', 'Size: M\nPlan: plan-first');
    assert.equal(sb.sm(sid1, ['set', '--fleet-task', 'T_OUT_M', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sid1, ['--to', 'plan', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sid1, ['--to', 'plan-review', '--repo-root', sb.repo]).status, 0);

    const rOutageKeep = sb.sm(sid1, ['set', '--fleet-task', 'T_OUT_M', '--refresh', '--repo-root', sb.repo], {
      FLEET_TEST_OUTAGE: '1',
    });
    assert.equal(rOutageKeep.status, 0, rOutageKeep.stderr);
    const m1 = sb.assertSchemaValid(sid1);
    assert.equal(m1.wo_state, 'resolved');
    assert.equal(m1.wo_size, 'M');
    assert.equal(sb.sa(sid1, ['--to', 'implement', '--repo-root', sb.repo]).status, 5);

    // Case B: outage with nothing resolved -> unresolved + stderr line + refused
    const sid2 = sb.newSession();
    const rOutageFresh = sb.sm(sid2, ['set', '--fleet-task', 'T_NEW', '--repo-root', sb.repo], {
      FLEET_TEST_OUTAGE: '1',
    });
    assert.equal(rOutageFresh.status, 0);
    assert.ok(rOutageFresh.stderr.trim().length > 0, 'unresolved prints one stderr line');
    const m2 = sb.assertSchemaValid(sid2);
    assert.equal(m2.wo_state, 'unresolved');

    // Unparseable JSON also -> unresolved
    const sid3 = sb.newSession();
    const rBadJson = sb.sm(sid3, ['set', '--fleet-task', 'T_BADJ', '--repo-root', sb.repo], {
      FLEET_TEST_BAD_JSON: '1',
    });
    assert.equal(rBadJson.status, 0);
    assert.equal(sb.assertSchemaValid(sid3).wo_state, 'unresolved');

    // --refresh recovers once fleet comes back with a valid S order
    sb.setTaskFixture('T_NEW', 'Size: S\nRecovered');
    const rRefresh = sb.sm(sid2, ['set', '--refresh', '--repo-root', sb.repo]);
    assert.equal(rRefresh.status, 0, rRefresh.stderr);
    const m2Rec = sb.assertSchemaValid(sid2);
    assert.equal(m2Rec.wo_state, 'resolved');
    assert.equal(m2Rec.wo_size, 'S');
  } finally {
    sb.cleanup();
  }
});

test('lane: init update refuses Size S after attaching a resolved Size L work order', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    sb.setTaskFixture('T1', 'Size: L\nPlan: plan-first');
    const attached = sb.sm(sid, ['set', '--fleet-task', 'T1', '--repo-root', sb.repo]);
    assert.equal(attached.status, 0, attached.stderr);
    const before = sb.assertSchemaValid(sid);
    assert.equal(before.fleet_task_id, 'T1');
    assert.equal(before.wo_state, 'resolved');
    assert.equal(before.wo_size, 'L');
    assert.equal(before.size, 'L');

    const lowered = sb.sm(sid, ['set', '--size', 'S', '--repo-root', sb.repo]);
    assert.equal(lowered.status, 2, 'same-task init must refuse a size below the resolved work order');
    assert.deepEqual(sb.readMarker(sid), before, 'refusing a size decrease must leave the marker untouched');
    const bypass = sb.sa(sid, ['--to', 'implement', '--repo-root', sb.repo]);
    assert.notEqual(bypass.status, 0, 'the Size L graph must still block a direct jump to implement');
  } finally {
    sb.cleanup();
  }
});

test('lane: same-task init refresh preserves implement stage and plan-first receipt', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    sb.setTaskFixture('T_REFRESH', 'Size: M\nPlan: plan-first');
    const attached = sb.sm(sid, ['set', '--fleet-task', 'T_REFRESH', '--repo-root', sb.repo]);
    assert.equal(attached.status, 0, attached.stderr);
    const planned = sb.sa(sid, ['--to', 'plan', '--repo-root', sb.repo]);
    assert.equal(planned.status, 0, planned.stderr);
    const reviewed = sb.sa(sid, ['--to', 'plan-review', '--repo-root', sb.repo]);
    assert.equal(reviewed.status, 0, reviewed.stderr);

    const planRel = 'docs/plans/refresh.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Refresh Plan\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add refresh plan']);
    const implemented = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.equal(implemented.status, 0, implemented.stderr);
    const before = sb.assertSchemaValid(sid);
    assert.equal(before.stage, 'implement');
    assert.equal(before.plan_receipt.path, planRel);

    const refreshed = sb.sm(sid, ['set', '--refresh', '--repo-root', sb.repo]);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    const after = sb.assertSchemaValid(sid);
    assert.equal(after.fleet_task_id, 'T_REFRESH');
    assert.equal(after.size, 'M');
    assert.equal(after.wo_state, 'resolved');
    assert.equal(after.stage, before.stage);
    assert.equal(after.stage_set_at, before.stage_set_at);
    assert.deepEqual(after.plan_receipt, before.plan_receipt);
  } finally {
    sb.cleanup();
  }
});

test('lane: size floor refuses downward --size, raises size + resets stage to plan, and new task id replaces wo_*', () => {
  const sb = makeSandbox();
  try {
    // 1. set --size S on wo_size=M refused
    const sid1 = sb.newSession();
    sb.setTaskFixture('T_FLOOR', 'Size: M\nPlan: plan-first');
    assert.equal(sb.sm(sid1, ['set', '--fleet-task', 'T_FLOOR', '--repo-root', sb.repo]).status, 0);
    const rDown = sb.sm(sid1, ['set', '--size', 'S', '--repo-root', sb.repo]);
    assert.equal(rDown.status, 2);
    assert.equal(sb.readMarker(sid1).size, 'M');

    // 2. set --size S, enter implement, then --fleet-task (M) -> stage reset to plan
    const sid2 = sb.newSession();
    assert.equal(sb.sm(sid2, ['set', '--size', 'S', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sid2, ['--to', 'implement', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.readMarker(sid2).stage, 'implement');

    sb.setTaskFixture('T_RAISE', 'Size: M\nPlan: plan-first');
    const rRaise = sb.sm(sid2, ['set', '--fleet-task', 'T_RAISE', '--repo-root', sb.repo]);
    assert.equal(rRaise.status, 0, rRaise.stderr);
    assert.match(rRaise.stderr, /stage reset.*plan/i);
    const mRaised = sb.assertSchemaValid(sid2);
    assert.equal(mRaised.size, 'M');
    assert.equal(mRaised.wo_size, 'M');
    assert.equal(mRaised.stage, 'plan');

    // 3. New task id replaces wo_* (and clears old plan_receipt)
    const planRel = 'docs/plans/old.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Old\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add old plan']);
    const sha = git(sb.repo, ['rev-parse', 'HEAD']);

    sb.setTaskFixture('T_OLD_PIN', `Size: M\nPlan: ${planRel}@${sha}`);
    const sid3 = sb.newSession();
    assert.equal(sb.sm(sid3, ['set', '--fleet-task', 'T_OLD_PIN', '--repo-root', sb.repo]).status, 0);
    assert.ok(sb.readMarker(sid3).plan_receipt);

    sb.setTaskFixture('T_NEW_S', 'Size: S\nCorrected smaller order');
    assert.equal(sb.sm(sid3, ['set', '--fleet-task', 'T_NEW_S', '--repo-root', sb.repo]).status, 0);
    const mReplaced = sb.assertSchemaValid(sid3);
    assert.equal(mReplaced.wo_task, 'T_NEW_S');
    assert.equal(mReplaced.wo_size, 'S');
    assert.equal(mReplaced.wo_plan, null);
    assert.equal(mReplaced.plan_receipt, undefined);
  } finally {
    sb.cleanup();
  }
});

test('lane: unresolved order allows all pre-implement stages (incl. L plan-review) and refuses implement and post-implement stages', () => {
  const sb = makeSandbox();
  try {
    // 1. L unresolved order: intent -> proposal -> plan -> plan-review allowed; --to implement refused
    const sidL = sb.newSession();
    sb.setTaskFixture('T_L_UNRES', 'Size: L\nPlan: docs/plans/missing.md@deadbeef');
    const rL = sb.sm(sidL, ['set', '--fleet-task', 'T_L_UNRES', '--repo-root', sb.repo]);
    assert.equal(rL.status, 0, rL.stderr);
    const mL = sb.assertSchemaValid(sidL);
    assert.equal(mL.wo_state, 'unresolved');
    assert.equal(mL.size, 'L');
    for (const node of ['intent', 'proposal', 'plan', 'plan-review']) {
      const r = sb.sa(sidL, ['--to', node, '--repo-root', sb.repo]);
      assert.equal(r.status, 0, `unresolved L should allow --to ${node}: ${r.stderr}`);
    }
    const rLImpl = sb.sa(sidL, ['--to', 'implement', '--repo-root', sb.repo]);
    assert.equal(rLImpl.status, 5, 'unresolved L must refuse --to implement');

    // 2. Session already at implement when unresolved order attaches: --to verify (post-implement) refused
    const sidS = sb.newSession();
    assert.equal(sb.sm(sidS, ['set', '--size', 'S', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.sa(sidS, ['--to', 'implement', '--repo-root', sb.repo]).status, 0);
    sb.setTaskFixture('T_S_UNRES', 'Size: S\nPlan: docs/plans/missing.md@deadbeef');
    assert.equal(sb.sm(sidS, ['set', '--fleet-task', 'T_S_UNRES', '--repo-root', sb.repo]).status, 0);
    const rVerify = sb.sa(sidS, ['--to', 'verify', '--repo-root', sb.repo]);
    assert.equal(rVerify.status, 5, 'unresolved order must refuse --to verify');
  } finally {
    sb.cleanup();
  }
});

test('lane: set --level preserves fleet_task_id, wo_*, plan_receipt and enforces wo_size floor', () => {
  const sb = makeSandbox();
  try {
    const planRel = 'docs/plans/lvl-keep.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Level Keep Plan\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add lvl keep plan']);
    const headSha = git(sb.repo, ['rev-parse', 'HEAD']);

    for (const size of ['M', 'L']) {
      const sid = sb.newSession();
      const taskId = `T_LVL_KEEP_${size}`;
      sb.setTaskFixture(taskId, `Size: ${size}\nPlan: ${planRel}@${headSha}`);
      const rAttach = sb.sm(sid, ['set', '--fleet-task', taskId, '--repo-root', sb.repo]);
      assert.equal(rAttach.status, 0, rAttach.stderr);
      const before = sb.assertSchemaValid(sid);

      // M walks plan -> plan-review -> implement; L starts at intent and requires plan-review before implement.
      const nodes = size === 'M' ? ['plan', 'plan-review', 'implement'] : ['intent', 'proposal', 'plan'];
      const rEntry = sb.sa(sid, ['--to', nodes[0], '--repo-root', sb.repo]);
      assert.equal(rEntry.status, 0, `--to ${nodes[0]} should pass before set --level: ${rEntry.stdout} ${rEntry.stderr}`);

      const rFloor = sb.sm(sid, ['set', '--level', 'l4', '--size', 'S', '--repo-root', sb.repo]);
      assert.equal(rFloor.status, 2, 'set --level with --size below wo_size must be refused');

      const rLevel = sb.sm(sid, ['set', '--level', 'l4', '--repo-root', sb.repo]);
      assert.equal(rLevel.status, 0, rLevel.stderr);
      const m = sb.assertSchemaValid(sid);
      assert.equal(m.level, 'l4');
      assert.equal(m.fleet_task_id, taskId);
      assert.equal(m.wo_task, taskId);
      assert.equal(m.wo_size, size);
      assert.equal(m.wo_state, 'resolved');
      assert.equal(m.size, size);
      assert.ok(m.wo_fetched_at);
      assert.ok(m.plan_receipt && m.plan_receipt.plan_sha256);
      for (const key of Object.keys(before).filter((k) => k === 'fleet_task_id' || k.startsWith('wo_') || k === 'plan_receipt')) {
        assert.deepEqual(m[key], before[key], `${key} must survive set --level unchanged`);
      }

      for (const node of nodes) {
        const rAdv = sb.sa(sid, ['--to', node, '--repo-root', sb.repo]);
        assert.equal(rAdv.status, 0, `--to ${node} should pass after set --level: ${rAdv.stdout} ${rAdv.stderr}`);
      }
      assert.equal(sb.assertSchemaValid(sid).stage, nodes.at(-1));
    }
  } finally {
    sb.cleanup();
  }
});

test('lane: set --new-task without --fleet-task clears wo_* and fleet_task_id and --new-task --refresh does not inherit old id', () => {
  const sb = makeSandbox();
  try {
    const planRel = 'docs/plans/prev-task.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Prev Task Plan\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add prev plan']);
    const headSha = git(sb.repo, ['rev-parse', 'HEAD']);

    const sid = sb.newSession();
    sb.setTaskFixture('T_PREV_L', `Size: L\nPlan: ${planRel}@${headSha}`);
    assert.equal(sb.sm(sid, ['set', '--fleet-task', 'T_PREV_L', '--repo-root', sb.repo]).status, 0);
    assert.equal(sb.readMarker(sid).wo_size, 'L');

    // --new-task --refresh without --fleet-task must not inherit T_PREV_L
    const rNewRefresh = sb.sm(sid, ['set', '--new-task', '--refresh', '--repo-root', sb.repo]);
    assert.equal(rNewRefresh.status, 2, '--new-task --refresh without --fleet-task must fail');

    // --new-task without --fleet-task starts clean and does not enforce previous task wo_size
    const rNewClean = sb.sm(sid, ['set', '--new-task', '--size', 'S', '--repo-root', sb.repo]);
    assert.equal(rNewClean.status, 0, rNewClean.stderr);
    const mClean = sb.assertSchemaValid(sid);
    assert.equal(mClean.size, 'S');
    assert.equal(mClean.fleet_task_id, undefined);
    assert.equal(mClean.wo_task, undefined);
    assert.equal(mClean.wo_size, undefined);
    assert.equal(mClean.wo_plan, undefined);
    assert.equal(mClean.wo_state, undefined);
    assert.equal(mClean.wo_fetched_at, undefined);
    assert.equal(mClean.plan_receipt, undefined);

    // Session without any fleet task attached keeps existing --new-task behaviour
    const sidPlain = sb.newSession();
    assert.equal(sb.sm(sidPlain, ['set', '--size', 'S', '--repo-root', sb.repo]).status, 0);
    const rPlainNew = sb.sm(sidPlain, ['set', '--new-task', '--size', 'M', '--repo-root', sb.repo]);
    assert.equal(rPlainNew.status, 0, rPlainNew.stderr);
    const mPlain = sb.assertSchemaValid(sidPlain);
    assert.equal(mPlain.size, 'M');
    assert.equal(mPlain.task_seq, 2);
  } finally {
    sb.cleanup();
  }
});

test('lane: L plan-review scans docs/plans/evidence/<slug>/ subdirs and ignores mismatched-sha plan_review_artifact as disposition', () => {
  const sb = makeSandbox();
  try {
    const sid = sb.newSession();
    const planRel = 'docs/plans/sub-ev-plan.md';
    const rubricRel = 'docs/plans/sub-ev-rubric.md';
    fs.mkdirSync(path.join(sb.repo, 'docs', 'plans'), { recursive: true });
    fs.writeFileSync(path.join(sb.repo, planRel), '# Subdir Plan g1\n');
    fs.writeFileSync(path.join(sb.repo, rubricRel), '# Rubric\n- R1\n');
    git(sb.repo, ['add', planRel, rubricRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add subdir plan g1']);
    const g1PlanSha = sha256Hex(fs.readFileSync(path.join(sb.repo, planRel)));

    fs.writeFileSync(path.join(sb.repo, planRel), '# Subdir Plan g2\n');
    git(sb.repo, ['add', planRel]);
    git(sb.repo, ['commit', '-q', '-m', 'add subdir plan g2']);
    const g2PlanSha = sha256Hex(fs.readFileSync(path.join(sb.repo, planRel)));
    const rubricSha = sha256Hex(fs.readFileSync(path.join(sb.repo, rubricRel)));

    sb.setTaskFixture('T_L_SUBDIR', 'Size: L\nPlan: plan-first');
    assert.equal(sb.sm(sid, ['set', '--fleet-task', 'T_L_SUBDIR', '--repo-root', sb.repo]).status, 0);
    for (const node of ['intent', 'proposal', 'plan', 'plan-review']) {
      assert.equal(sb.sa(sid, ['--to', node, '--repo-root', sb.repo]).status, 0);
    }

    const evSubdir = path.join(sb.repo, 'docs', 'plans', 'evidence', 'sub-ev-plan');
    fs.mkdirSync(evSubdir, { recursive: true });

    // Matching g2 artifact + stale mismatched-sha g1 artifact (must NOT be treated as a disposition)
    fs.writeFileSync(
      path.join(evSubdir, 'gen2-artifact.json'),
      JSON.stringify({
        schema_version: 1,
        artifact_type: 'plan_review_artifact',
        logical_plan_id: 'sub-ev-plan',
        generation: 2,
        plan_sha256: g2PlanSha,
        rubric_sha256: rubricSha,
        plan_path: planRel,
        rubric_path: rubricRel,
        findings: [],
        reviewer_verdicts: [
          { seat_id: 'chair', runner: 'codex', model: 'gpt-5', family: 'openai', verdict: 'READY' },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(evSubdir, 'gen1-stale-artifact.json'),
      JSON.stringify({
        schema_version: 1,
        artifact_type: 'plan_review_artifact',
        logical_plan_id: 'sub-ev-plan',
        generation: 2,
        plan_sha256: g1PlanSha,
        rubric_sha256: rubricSha,
        plan_path: planRel,
        rubric_path: rubricRel,
        findings: [],
        reviewer_verdicts: [
          { seat_id: 'chair', runner: 'codex', model: 'gpt-5', family: 'openai', verdict: 'READY' },
        ],
      }),
    );

    // Without real disposition file, stale plan_review_artifact must not suffice
    const rWithoutDisp = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.notEqual(rWithoutDisp.status, 0, 'mismatched-sha plan_review_artifact must not satisfy dispositions');

    // Add real disposition inside docs/plans/evidence/<slug>/; auto-discovery must find both and advance
    fs.writeFileSync(
      path.join(evSubdir, 'gen2-disposition.json'),
      JSON.stringify({
        logical_plan_id: 'sub-ev-plan',
        generation: 2,
        findings: [],
      }),
    );
    const rWithDisp = sb.sa(sid, ['--to', 'implement', '--plan', planRel, '--repo-root', sb.repo]);
    assert.equal(rWithDisp.status, 0, `docs/plans/evidence/<slug>/ should resolve L plan review: ${rWithDisp.stderr}`);
    assert.equal(sb.assertSchemaValid(sid).plan_receipt.plan_sha256, g2PlanSha);
  } finally {
    sb.cleanup();
  }
});
