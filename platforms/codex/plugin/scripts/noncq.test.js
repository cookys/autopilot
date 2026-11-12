'use strict';

/**
 * Tests for scripts/noncq.js (noncq W1).
 * Run: env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node --test scripts/noncq.test.js < /dev/null
 *
 * Temp AUTOPILOT_NONCQ_DIR only. Stub rails via AUTOPILOT_NONCQ_RAIL_DIR.
 * Fake fleet bin records argv. Never touches ~/.claude or credential files.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'noncq.js');
const {
  qualifyingEngines,
  loadPools,
  buildRailCommand,
} = require('./noncq.js');

const NOW = '2026-11-12T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file, body, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, body, { mode });
}

function baseEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  if (!('AUTOPILOT_NOW' in extra)) env.AUTOPILOT_NOW = NOW;
  return env;
}

function cli(args, envExtra = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: baseEnv(envExtra),
    input: '',
  });
}

function waitFor(predicate, timeoutMs = 5000, stepMs = 25) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    spawnSync('sleep', [String(stepMs / 1000)], { encoding: 'utf8' });
    // Atomics wait avoids shell
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, stepMs);
  }
  return predicate();
}

function makeFleetBin(dir, { exitCode = 0 } = {}) {
  const bin = path.join(dir, 'fake-fleet');
  const log = path.join(dir, 'fleet.log');
  write(bin, `#!/usr/bin/env bash
echo "$@" >> '${log.replace(/'/g, `'\\''`)}'
printf '%s\\0' "$@" >> '${log.replace(/'/g, `'\\''`)}.nul'
exit ${exitCode}
`, 0o755);
  fs.chmodSync(bin, 0o755);
  return { bin, log };
}

function makeRails(dir, {
  authorStatus = 'authored',
  reviewStatus = 'reviewed',
  authorExit = 0,
  reviewExit = 0,
  authorRawContent = 'authored body from stub\n',
} = {}) {
  const rawLog = path.join(dir, 'author-raw.log');
  write(rawLog, authorRawContent);
  const author = path.join(dir, 'dispatch-author.sh');
  const review = path.join(dir, 'dispatch-review.sh');
  // Stub load-endpoints-env.sh in railDir so real endpoints.env is never sourced.
  const loadEnv = path.join(dir, 'load-endpoints-env.sh');
  write(loadEnv, `#!/usr/bin/env bash
# stub — define no-op; never touch real endpoints.env
autopilot_load_endpoints_env() { :; }
`, 0o755);
  write(author, `#!/usr/bin/env bash
# stub author rail
echo '{"runner":"stub","model":"stub","status":"${authorStatus}","raw_log":"${rawLog.replace(/\\/g, '\\\\')}","error":null}'
exit ${authorExit}
`, 0o755);
  write(review, `#!/usr/bin/env bash
# stub review rail
echo '{"runner":"stub","model":"stub","status":"${reviewStatus}","verdict":"SHIP","findings":"[{\\"id\\":\\"F1\\"}]","no_finding_proof":null,"raw_log":"/tmp/x","error":null}'
exit ${reviewExit}
`, 0o755);
  fs.chmodSync(author, 0o755);
  fs.chmodSync(review, 0o755);
  fs.chmodSync(loadEnv, 0o755);
  return { dir, author, review, rawLog, loadEnv };
}

/** Snapshot queue tree as { relPath: Buffer } for byte-for-byte dry-run checks. */
function snapshotTree(root) {
  const out = {};
  function walk(dir, rel) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const key = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, key);
      else out[key] = fs.readFileSync(full);
    }
  }
  walk(root, '');
  return out;
}

function assertTreeUnchanged(before, after, label) {
  const bKeys = Object.keys(before).sort();
  const aKeys = Object.keys(after).sort();
  assert.deepEqual(aKeys, bKeys, `${label}: file set changed`);
  for (const k of bKeys) {
    assert.ok(Buffer.isBuffer(before[k]) && Buffer.isBuffer(after[k]));
    assert.ok(before[k].equals(after[k]), `${label}: content changed at ${k}`);
  }
}

function makeFailRails(dir, { exit = 1, status = 'runner_failed' } = {}) {
  const author = path.join(dir, 'dispatch-author.sh');
  const review = path.join(dir, 'dispatch-review.sh');
  write(author, `#!/usr/bin/env bash
echo '{"runner":"stub","model":"stub","status":"${status}","raw_log":null,"error":"boom"}'
exit ${exit}
`, 0o755);
  write(review, `#!/usr/bin/env bash
echo '{"runner":"stub","model":"stub","status":"no_verdict","verdict":null,"findings":"","raw_log":null,"error":"boom"}'
exit ${exit}
`, 0o755);
  fs.chmodSync(author, 0o755);
  fs.chmodSync(review, 0o755);
  return { dir };
}

function paceRow(over = {}) {
  return {
    pool: 'grok-cli',
    class: 'standard',
    status: 'ALERT_behind',
    hours_to_reset: 6,
    stale: false,
    waste_pct_if_unused: 42,
    ...over,
  };
}

function writePace(dir, rows, name = 'pace.v1.json') {
  const file = path.join(dir, name);
  write(file, JSON.stringify({ schema: 'capacity.pace/1', rows }, null, 2));
  return file;
}

function briefFile(dir, text = 'Do the thing.\n') {
  const f = path.join(dir, 'brief.md');
  write(f, text);
  return f;
}

function addResearch(queueDir, railsDir, fleetBin, over = {}) {
  const work = mkTmp('noncq-add-');
  const brief = briefFile(work);
  const args = [
    'add',
    '--lane', over.lane || 'ns/courier/lane-a',
    '--kind', over.kind || 'research',
    '--brief', brief,
    '--accept', over.accept || 'has conclusion',
    '--prefer', over.prefer || 'grok',
  ];
  if (over.wall) args.push('--wall', over.wall);
  if (over.expires) args.push('--expires', over.expires);
  if (over.extraArgs) args.push(...over.extraArgs);
  const r = cli(args, {
    AUTOPILOT_NONCQ_DIR: queueDir,
    AUTOPILOT_NONCQ_RAIL_DIR: railsDir,
    AUTOPILOT_FLEET_BIN: fleetBin,
    ...(over.env || {}),
  });
  return r;
}

function drain(queueDir, paceFile, railsDir, fleetBin, extraArgs = [], envExtra = {}) {
  return cli(['drain', '--pace', paceFile, '--json', ...extraArgs], {
    AUTOPILOT_NONCQ_DIR: queueDir,
    AUTOPILOT_NONCQ_RAIL_DIR: railsDir,
    AUTOPILOT_FLEET_BIN: fleetBin,
    AUTOPILOT_NONCQ_REPORT_TO: envExtra.AUTOPILOT_NONCQ_REPORT_TO || 'ns/courier/pm-bot',
    ...envExtra,
  });
}

function waitReap(queueDir, railsDir, fleetBin, paceFile, id) {
  const itemPath = path.join(queueDir, 'items', id, 'rail.exit');
  assert.ok(waitFor(() => fs.existsSync(itemPath), 8000), `rail.exit missing for ${id}`);
  return drain(queueDir, paceFile, railsDir, fleetBin);
}

// ---------------------------------------------------------------------------
// (a) add validation
// ---------------------------------------------------------------------------
test('(a) add validation: bad kind, review-seat1 without diff, empty accept, bad lane → exit 2', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const brief = briefFile(work);
  const fleet = makeFleetBin(work);

  let r = cli(['add', '--lane', 'ns/courier/a', '--kind', 'nope', '--brief', brief, '--accept', 'x', '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /kind/);

  r = cli(['add', '--lane', 'ns/courier/a', '--kind', 'review-seat1', '--brief', brief, '--accept', 'x', '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /diff|spec/i);

  r = cli(['add', '--lane', 'ns/courier/a', '--kind', 'research', '--brief', brief, '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /accept/i);

  r = cli(['add', '--lane', 'not-an-address', '--kind', 'research', '--brief', brief, '--accept', 'x', '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /lane/i);

  // research refuses --diff
  const diff = path.join(work, 'd.patch');
  write(diff, '--- a\n+++ b\n');
  const spec = path.join(work, 's.md');
  write(spec, 'spec\n');
  r = cli(['add', '--lane', 'ns/courier/a', '--kind', 'research', '--brief', brief, '--accept', 'x', '--prefer', 'grok', '--diff', diff, '--spec', spec], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refuse/i);
});

// ---------------------------------------------------------------------------
// (b) drain pool qualification filters
// ---------------------------------------------------------------------------
test('(b) drain picks only ALERT_behind <24h non-stale non-claude/scarce mapped pools', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  const add = cli(['add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief, '--accept', 'ok', '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();

  const badRows = [
    paceRow({ status: 'behind_early', hours_to_reset: 3 }),
    paceRow({ stale: true, hours_to_reset: 3 }),
    paceRow({ stale: null, hours_to_reset: 3 }),
    paceRow({ class: 'claude', hours_to_reset: 3 }),
    paceRow({ class: 'scarce', hours_to_reset: 3 }),
    paceRow({ hours_to_reset: 24 }),
    paceRow({ hours_to_reset: 30 }),
  ];
  // Fail-closed: missing `stale` must not qualify.
  const missingStale = paceRow({ hours_to_reset: 3 });
  delete missingStale.stale;
  badRows.push(missingStale);

  for (const row of badRows) {
    const pace = writePace(work, [row], `pace-${row.status || 'x'}-${row.hours_to_reset}-${row.class}-${row.stale}.json`);
    const d = drain(q, pace, rails.dir, fleet.bin);
    assert.equal(d.status, 0, d.stderr);
    const out = JSON.parse(d.stdout);
    assert.equal(out.dispatched.length, 0, `should dispatch nothing for ${JSON.stringify(row)}`);
  }

  // unit: missing stale does not qualify
  const pools = loadPools();
  const qMissing = qualifyingEngines(
    { schema: 'capacity.pace/1', rows: [missingStale] },
    pools,
  );
  assert.equal(qMissing.size, 0, 'missing stale must not qualify');

  // good row dispatches
  const good = writePace(work, [paceRow()], 'pace-good.json');
  const d = drain(q, good, rails.dir, fleet.bin);
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  assert.equal(out.dispatched.length, 1);
  assert.equal(out.dispatched[0].id, id);
  assert.equal(out.dispatched[0].engine, 'grok');
  // Wait for spawned child so the suite does not leak a rail process.
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000));
});

// ---------------------------------------------------------------------------
// Negative control for (b): drop hours_to_reset < 24 → red, then restore
// ---------------------------------------------------------------------------
test('(b-neg) negative control: dropping hours_to_reset < 24 lets a 30h row dispatch', () => {
  const pools = loadPools();
  const row = paceRow({ hours_to_reset: 30 });
  const pace = { schema: 'capacity.pace/1', rows: [row] };

  const withCheck = qualifyingEngines(pace, pools, { requireHoursLt24: true });
  assert.equal(withCheck.size, 0, 'intact check must reject hours_to_reset >= 24');

  const broken = qualifyingEngines(pace, pools, { requireHoursLt24: false });
  assert.equal(broken.size, 1, 'negative control: without the <24 check the 30h row qualifies');
  assert.ok(broken.has('grok'));

  // restore path: default opts keep the check
  const restored = qualifyingEngines(pace, pools);
  assert.equal(restored.size, 0);
});

// ---------------------------------------------------------------------------
// (c) prefer rank then FIFO; max_parallel counting dispatched
// ---------------------------------------------------------------------------
test('(c) prefer rank then FIFO; max_parallel respected counting dispatched', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  // glm max_parallel = 2
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    const r = cli([
      'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
      '--accept', 'ok', '--prefer', i < 2 ? 'glm,grok' : 'grok,glm',
      // stagger created_at via AUTOPILOT_NOW
    ], {
      AUTOPILOT_NONCQ_DIR: q,
      AUTOPILOT_NONCQ_RAIL_DIR: rails.dir,
      AUTOPILOT_FLEET_BIN: fleet.bin,
      AUTOPILOT_NOW: new Date(NOW_MS + i * 1000).toISOString(),
    });
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.trim());
  }

  // Manually mark first item as already dispatched for glm so only 1 slot remains
  const firstDir = path.join(q, 'items', ids[0]);
  const item = JSON.parse(fs.readFileSync(path.join(firstDir, 'item.json'), 'utf8'));
  item.state = 'dispatched';
  item.result = { status: 'dispatched', path: null, run_id: 'pre', engine: 'glm', finished_at: null };
  fs.writeFileSync(path.join(firstDir, 'item.json'), `${JSON.stringify(item, null, 2)}\n`);
  fs.writeFileSync(path.join(firstDir, 'receipt.json'), JSON.stringify({ engine: 'glm', run_id: 'pre' }));
  // no rail.exit → stays dispatched and counts toward max_parallel

  // railDir carries stub load-endpoints-env.sh (makeRails) so glm endpoint never
  // sources the real scripts/load-endpoints-env.sh or endpoints.env.
  assert.ok(fs.existsSync(path.join(rails.dir, 'load-endpoints-env.sh')));
  // Seam: load-endpoints path must come from railDir, not scripts/__dirname.
  {
    const seamDir = mkTmp('noncq-seam-');
    const pools = loadPools();
    const profile = pools.glm;
    const cmd = buildRailCommand(
      seamDir,
      { kind: 'review-seat1', accept: ['ok'], wall_min: 20 },
      profile,
      'seam-check',
      baseEnv({ AUTOPILOT_NONCQ_RAIL_DIR: rails.dir }),
    );
    const stubLoad = path.join(rails.dir, 'load-endpoints-env.sh');
    assert.ok(cmd.shell.includes(stubLoad), 'shell must source load-endpoints via railDir');
    assert.equal(cmd.shell.includes(path.join(__dirname, 'load-endpoints-env.sh')), false);
    assert.match(cmd.shell, /trap .*EXIT/, 'shell must record rail.exit via EXIT trap');
    assert.match(cmd.shell, /set \+e/, 'shell must restore set +e after source');
  }
  const pace = writePace(work, [paceRow({ pool: 'glm' })]);
  const d = drain(q, pace, rails.dir, fleet.bin, [], { AUTOPILOT_NOW: new Date(NOW_MS + 10_000).toISOString() });
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  // max_parallel 2, 1 already dispatched → 1 new dispatch
  assert.equal(out.dispatched.length, 1);
  // prefer rank: items with glm first in prefer (ids[0] already dispatched, ids[1] has glm,grok)
  assert.equal(out.dispatched[0].id, ids[1]);
  // Wait for the spawned child's rail.exit before finishing (no leaked child).
  assert.ok(
    waitFor(() => fs.existsSync(path.join(q, 'items', ids[1], 'rail.exit')), 8000),
    `rail.exit missing for newly dispatched ${ids[1]}`,
  );
});

// ---------------------------------------------------------------------------
// (d) reaping
// ---------------------------------------------------------------------------
test('(d) reaping: authored → done + result.md; exit 1 twice → failed', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work, { authorRawContent: 'HELLO_AUTHOR_RESULT\n' });
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  const add = cli(['add', '--lane', 'ns/courier/lane-a', '--kind', 'draft', '--brief', brief, '--accept', 'ok', '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const pace = writePace(work, [paceRow()]);

  let d = drain(q, pace, rails.dir, fleet.bin);
  assert.equal(d.status, 0, d.stderr);
  assert.equal(JSON.parse(d.stdout).dispatched.length, 1);

  d = waitReap(q, rails.dir, fleet.bin, pace, id);
  assert.equal(d.status, 0, d.stderr);
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.equal(item.state, 'done');
  assert.ok(item.result && item.result.path);
  const body = fs.readFileSync(item.result.path, 'utf8');
  assert.match(body, /HELLO_AUTHOR_RESULT/);

  // failure twice
  const failRails = makeFailRails(mkTmp('noncq-fail-'), { exit: 1 });
  const add2 = cli(['add', '--lane', 'ns/courier/lane-b', '--kind', 'research', '--brief', brief, '--accept', 'ok', '--prefer', 'agy'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: failRails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
    AUTOPILOT_NOW: new Date(NOW_MS + 60_000).toISOString(),
  });
  assert.equal(add2.status, 0, add2.stderr);
  const id2 = add2.stdout.trim();
  const paceAgy = writePace(work, [paceRow({ pool: 'agy', waste_pct_if_unused: 10 })], 'pace-agy.json');

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    d = drain(q, paceAgy, failRails.dir, fleet.bin, [], {
      AUTOPILOT_NOW: new Date(NOW_MS + 60_000 + attempt * 1000).toISOString(),
    });
    assert.equal(d.status, 0, d.stderr);
    const dispatched = JSON.parse(d.stdout).dispatched.filter((x) => x.id === id2);
    assert.equal(dispatched.length, 1, `attempt ${attempt} should dispatch`);
    assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id2, 'rail.exit')), 8000));
    d = drain(q, paceAgy, failRails.dir, fleet.bin, [], {
      AUTOPILOT_NOW: new Date(NOW_MS + 60_000 + attempt * 1000 + 500).toISOString(),
    });
    assert.equal(d.status, 0, d.stderr);
  }
  const item2 = JSON.parse(fs.readFileSync(path.join(q, 'items', id2, 'item.json'), 'utf8'));
  assert.equal(item2.state, 'failed');
  assert.equal(item2.attempts, 2);
});

// ---------------------------------------------------------------------------
// (e) notify per lane; notify failure leaves un-notified
// ---------------------------------------------------------------------------
test('(e) one notify message per lane; notify failure leaves items un-notified', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  const ids = [];
  for (const lane of ['ns/courier/lane-a', 'ns/courier/lane-a', 'ns/courier/lane-b']) {
    const r = cli(['add', '--lane', lane, '--kind', 'data', '--brief', brief, '--accept', 'ok', '--prefer', 'grok'], {
      AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
      AUTOPILOT_NOW: new Date(NOW_MS + ids.length * 1000).toISOString(),
    });
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.trim());
  }
  const pace = writePace(work, [paceRow()]);
  let d = drain(q, pace, rails.dir, fleet.bin);
  assert.equal(JSON.parse(d.stdout).dispatched.length, 3);
  for (const id of ids) {
    assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000), id);
  }
  d = drain(q, pace, rails.dir, fleet.bin);
  const out = JSON.parse(d.stdout);
  assert.ok(out.reaped.length >= 3);
  assert.equal(out.notified.length, 2, 'one message per lane');
  const lanes = out.notified.map((n) => n.lane).sort();
  assert.deepEqual(lanes, ['ns/courier/lane-a', 'ns/courier/lane-b']);
  const log = fs.readFileSync(fleet.log, 'utf8');
  assert.match(log, /\[noncq-result\]/);
  const aLine = out.notified.find((n) => n.lane === 'ns/courier/lane-a');
  assert.equal(aLine.ids.length, 2);

  // notify failure
  const q2 = mkTmp('noncq-q2-');
  const fleetFail = makeFleetBin(work, { exitCode: 1 });
  // reuse a fresh item
  const r2 = cli(['add', '--lane', 'ns/courier/lane-c', '--kind', 'draft', '--brief', brief, '--accept', 'ok', '--prefer', 'grok'], {
    AUTOPILOT_NONCQ_DIR: q2, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleetFail.bin,
  });
  const idFail = r2.stdout.trim();
  const pace2 = writePace(work, [paceRow()], 'pace2.json');
  drain(q2, pace2, rails.dir, fleetFail.bin);
  assert.ok(waitFor(() => fs.existsSync(path.join(q2, 'items', idFail, 'rail.exit')), 8000));
  const d2 = drain(q2, pace2, rails.dir, fleetFail.bin);
  const out2 = JSON.parse(d2.stdout);
  assert.ok(out2.notify_failed.includes('ns/courier/lane-c'));
  const item = JSON.parse(fs.readFileSync(path.join(q2, 'items', idFail, 'item.json'), 'utf8'));
  assert.equal(item.state, 'done');
  assert.equal(item.notified, false);
});

// ---------------------------------------------------------------------------
// (f) empty queue → one [noncq-empty], none within 6 h
// ---------------------------------------------------------------------------
test('(f) empty queue with ALERT pool → one [noncq-empty] then none within 6 h', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const pace = writePace(work, [paceRow({ waste_pct_if_unused: 55 })]);

  let d = drain(q, pace, rails.dir, fleet.bin, [], {
    AUTOPILOT_NONCQ_REPORT_TO: 'ns/courier/pm-bot',
  });
  assert.equal(d.status, 0, d.stderr);
  let out = JSON.parse(d.stdout);
  assert.equal(out.empty_reported.length, 1);
  assert.equal(out.empty_reported[0].engine, 'grok');
  assert.equal(out.empty_reported[0].waste_pct_if_unused, 55);
  const log1 = fs.readFileSync(fleet.log, 'utf8');
  assert.match(log1, /\[noncq-empty\] grok waste_pct_if_unused=55/);

  // within 6 h
  d = drain(q, pace, rails.dir, fleet.bin, [], {
    AUTOPILOT_NONCQ_REPORT_TO: 'ns/courier/pm-bot',
    AUTOPILOT_NOW: new Date(NOW_MS + 60 * 60 * 1000).toISOString(),
  });
  out = JSON.parse(d.stdout);
  assert.equal(out.empty_reported.length, 0);
  assert.ok(out.empty_suppressed.includes('grok'));
});

// ---------------------------------------------------------------------------
// (g) --dry-run changes no file
// ---------------------------------------------------------------------------
test('(g) --dry-run changes no file and spawns nothing', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);
  // prefer two engines so a buggy dry-run could report the same id twice
  const add = cli(['add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief, '--accept', 'ok', '--prefer', 'grok,glm'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  const id = add.stdout.trim();
  const beforeTree = snapshotTree(q);
  const pace = writePace(work, [paceRow(), paceRow({ pool: 'glm' })], 'pace-multi.json');

  const d = drain(q, pace, rails.dir, fleet.bin, ['--dry-run']);
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  assert.equal(out.dispatched.length, 1, 'one item must not be reported for two engines in one dry-run');
  assert.equal(out.dispatched[0].id, id);
  assert.equal(fs.existsSync(path.join(q, 'items', id, 'assembled-prompt.md')), false);
  assert.equal(fs.existsSync(path.join(q, 'items', id, 'rail.exit')), false);
  assert.equal(fs.existsSync(fleet.log), false);
  assertTreeUnchanged(beforeTree, snapshotTree(q), 'dry-run queue tree');
});

// Dry-run on a missing queue root must not create directories.
test('(g2) --dry-run on missing queue root creates nothing', () => {
  const q = path.join(mkTmp('noncq-missing-'), 'no-such-queue');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  assert.equal(fs.existsSync(q), false);
  const pace = writePace(work, [paceRow()]);
  const d = drain(q, pace, rails.dir, fleet.bin, ['--dry-run']);
  assert.equal(d.status, 0, d.stderr);
  assert.equal(fs.existsSync(q), false, 'dry-run must not call ensureQueue');
});

// ---------------------------------------------------------------------------
// (h) null-model engine skipped
// ---------------------------------------------------------------------------
test('(h) null-model engine (agyclaude) skipped with stderr note', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);
  const add = cli(['add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief, '--accept', 'ok', '--prefer', 'agyclaude'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(add.status, 0, add.stderr);
  const pace = writePace(work, [paceRow({ pool: 'agyclaude' })]);
  const d = drain(q, pace, rails.dir, fleet.bin);
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  assert.equal(out.dispatched.length, 0);
  assert.ok(out.skipped_null_model.includes('agyclaude'));
  assert.match(d.stderr, /null|not verified/i);
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', add.stdout.trim(), 'item.json'), 'utf8'));
  assert.equal(item.state, 'queued');
});

// ---------------------------------------------------------------------------
// (i) expired items never dispatched
// ---------------------------------------------------------------------------
test('(i) expired items never dispatched', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  const add = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok', '--expires', '1h',
  ], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
    AUTOPILOT_NOW: NOW,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const pace = writePace(work, [paceRow()]);

  // 2 h later → expired
  const d = drain(q, pace, rails.dir, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 2 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  assert.ok(out.expired.includes(id));
  assert.equal(out.dispatched.length, 0);
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.equal(item.state, 'expired');
});

// ---------------------------------------------------------------------------
// (j) reap before expiry: finished dispatched past expires_at → reaped, not expired
// ---------------------------------------------------------------------------
test('(j) finished dispatched past expires_at is reaped and lane notified, not expired', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  const add = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok', '--expires', '1h',
  ], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
    AUTOPILOT_NOW: NOW,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const pace = writePace(work, [paceRow()]);

  let d = drain(q, pace, rails.dir, fleet.bin, [], { AUTOPILOT_NOW: NOW });
  assert.equal(d.status, 0, d.stderr);
  assert.equal(JSON.parse(d.stdout).dispatched.length, 1);
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000));

  // 2 h later: past expires_at, but rail.exit is present → must reap, not expire
  d = drain(q, pace, rails.dir, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 2 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  assert.equal(out.expired.includes(id), false, 'finished dispatched must not be marked expired');
  assert.ok(out.reaped.some((r) => r.id === id), 'must be reaped');
  assert.ok(out.notified.some((n) => n.ids.includes(id)), 'lane must be notified');
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.equal(item.state, 'done');
});

// ---------------------------------------------------------------------------
// (k) still-running dispatched past expires_at still counts toward max_parallel
// ---------------------------------------------------------------------------
test('(k) still-running dispatched past expires_at still counts toward max_parallel', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);

  // glm max_parallel = 2
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    const r = cli([
      'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
      '--accept', 'ok', '--prefer', 'glm', '--expires', '1h',
    ], {
      AUTOPILOT_NONCQ_DIR: q,
      AUTOPILOT_NONCQ_RAIL_DIR: rails.dir,
      AUTOPILOT_FLEET_BIN: fleet.bin,
      AUTOPILOT_NOW: new Date(NOW_MS + i * 1000).toISOString(),
    });
    assert.equal(r.status, 0, r.stderr);
    ids.push(r.stdout.trim());
  }

  // Mark first two as still-running dispatched (no rail.exit), past expires_at once NOW advances.
  for (const id of ids.slice(0, 2)) {
    const dir = path.join(q, 'items', id);
    const item = JSON.parse(fs.readFileSync(path.join(dir, 'item.json'), 'utf8'));
    item.state = 'dispatched';
    item.result = { status: 'dispatched', path: null, run_id: `pre-${id}`, engine: 'glm', finished_at: null };
    fs.writeFileSync(path.join(dir, 'item.json'), `${JSON.stringify(item, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({ engine: 'glm', run_id: `pre-${id}` }));
  }

  const pace = writePace(work, [paceRow({ pool: 'glm' })]);
  const later = new Date(NOW_MS + 2 * 60 * 60 * 1000).toISOString();
  const d = drain(q, pace, rails.dir, fleet.bin, [], { AUTOPILOT_NOW: later });
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  // Two still-running dispatched fill max_parallel=2 → no new dispatch
  assert.equal(out.dispatched.length, 0, 'in-flight past expires_at must still fill max_parallel');
  // The two dispatched must not be expired; the third queued one is past expires_at → expired
  assert.equal(out.expired.includes(ids[0]), false);
  assert.equal(out.expired.includes(ids[1]), false);
  assert.ok(out.expired.includes(ids[2]), 'queued past expires_at must expire');
  for (const id of ids.slice(0, 2)) {
    const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
    assert.equal(item.state, 'dispatched');
  }
  const queued = JSON.parse(fs.readFileSync(path.join(q, 'items', ids[2], 'item.json'), 'utf8'));
  assert.equal(queued.state, 'expired');
});

// review-seat1 happy path smoke (diff+spec required)
test('review-seat1 add+drain reaps findings into result.md', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);
  const diff = path.join(work, 'd.patch');
  const spec = path.join(work, 's.md');
  write(diff, '--- a\n+++ b\n');
  write(spec, 'acceptance\n');
  const add = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'review-seat1', '--brief', brief,
    '--accept', 'verdict present', '--prefer', 'grok', '--diff', diff, '--spec', spec,
  ], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  assert.ok(fs.existsSync(path.join(q, 'items', id, 'diff.patch')));
  assert.ok(fs.existsSync(path.join(q, 'items', id, 'spec.md')));
  const pace = writePace(work, [paceRow()]);
  drain(q, pace, rails.dir, fleet.bin);
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000));
  const d = drain(q, pace, rails.dir, fleet.bin);
  assert.equal(d.status, 0, d.stderr);
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.equal(item.state, 'done');
  const body = fs.readFileSync(item.result.path, 'utf8');
  assert.match(body, /F1/);
});
