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
const crypto = require('crypto');
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

/** Fleet stub that prints a sha256 on `upload` and records `send` bodies. */
function makeUploadFleet(dir, { uploadExit = 0 } = {}) {
  const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bin = path.join(dir, `fake-fleet-upload-${uploadExit}`);
  const nul = path.join(dir, `upload-fleet-${uploadExit}.nul`);
  const msgLog = path.join(dir, `upload-fleet-msgs-${uploadExit}.txt`);
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const uploadBody = uploadExit === 0
    ? `printf '%s\\n' ${q(sha)}\nexit 0`
    : `echo upload_refused >&2\nexit ${Number(uploadExit)}`;
  write(bin, `#!/usr/bin/env bash
printf '%s\\0' "$@" >> ${q(nul)}
if [ "$1" = upload ]; then
  ${uploadBody}
fi
if [ "$1" = send ]; then
  printf '%s\\n' "$3" >> ${q(msgLog)}
  exit 0
fi
exit 0
`, 0o755);
  fs.chmodSync(bin, 0o755);
  return { bin, nul, msgLog, sha };
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
  const poolsFixture = path.join(work, 'pools.json');
  write(poolsFixture, JSON.stringify({
    agyclaude: { key: 'agyclaude', runner: 'agy', model: null, max_parallel: 2 },
  }, null, 2));
  const d = drain(q, pace, rails.dir, fleet.bin, [], { AUTOPILOT_NONCQ_POOLS: poolsFixture });
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

// ---------------------------------------------------------------------------
// W1: EXIT trap must exist before endpoints are sourced
// ---------------------------------------------------------------------------
test('(trap-order) load-endpoints-env.sh that exits still records rail.exit and is reaped', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  // Stub that kills the shell before the rail runs.
  write(rails.loadEnv, '#!/usr/bin/env bash\nexit 7\n', 0o755);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);
  const add = cli(['add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief, '--accept', 'ok', '--prefer', 'glm'], {
    AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_NONCQ_RAIL_DIR: rails.dir, AUTOPILOT_FLEET_BIN: fleet.bin,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const pace = writePace(work, [paceRow({ pool: 'glm' })]);
  let d = drain(q, pace, rails.dir, fleet.bin, [], { AUTOPILOT_NOW: new Date(NOW_MS + 10_000).toISOString() });
  assert.equal(d.status, 0, d.stderr);
  assert.equal(JSON.parse(d.stdout).dispatched.length, 1);
  const exitFile = path.join(q, 'items', id, 'rail.exit');
  assert.ok(waitFor(() => fs.existsSync(exitFile), 8000), 'rail.exit must be written even when sourcing exits');
  assert.notEqual(fs.readFileSync(exitFile, 'utf8').trim(), '0');
  d = drain(q, pace, rails.dir, fleet.bin, [], { AUTOPILOT_NOW: new Date(NOW_MS + 11_000).toISOString() });
  assert.equal(d.status, 0, d.stderr);
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.notEqual(item.state, 'dispatched', 'item must be reaped, not stuck dispatched');
});

// ---------------------------------------------------------------------------
// (1) inputs stay on disk; assembled prompt is size-gated; stdin ceiling is terminal
// ---------------------------------------------------------------------------
test('(1) inputs listed by path, oversized prompt refused, agy_stdin_ceiling is terminal', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const envBase = {
    AUTOPILOT_NONCQ_DIR: q,
    AUTOPILOT_NONCQ_RAIL_DIR: rails.dir,
    AUTOPILOT_FLEET_BIN: fleet.bin,
  };
  const brief = briefFile(work, 'Short brief.\n');
  const inputBody = 'SECRET_LEDGER_BODY_DO_NOT_INLINE\n';
  const input = path.join(work, 'ledger.md');
  write(input, inputBody);
  const sha = crypto.createHash('sha256').update(inputBody).digest('hex');

  const add = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'cites the ledger', '--prefer', 'grok', '--input', input,
  ], envBase);
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const pace = writePace(work, [paceRow()]);
  const d = drain(q, pace, rails.dir, fleet.bin);
  assert.equal(d.status, 0, d.stderr);
  assert.equal(JSON.parse(d.stdout).dispatched.length, 1);
  const promptPath = path.join(q, 'items', id, 'assembled-prompt.md');
  assert.ok(fs.existsSync(promptPath), 'assembled prompt must exist after dispatch');
  const prompt = fs.readFileSync(promptPath, 'utf8');
  const abs = path.join(q, 'items', id, 'inputs', 'ledger.md');
  assert.equal(prompt.includes('SECRET_LEDGER_BODY_DO_NOT_INLINE'), false, 'input bytes must not be inlined');
  assert.ok(prompt.includes(abs), `prompt must list absolute path ${abs}`);
  assert.ok(prompt.includes(`bytes: ${Buffer.byteLength(inputBody)}`), 'prompt must list byte size');
  assert.ok(prompt.includes(`sha256: ${sha}`), 'prompt must list sha256');
  assert.match(prompt, /read-only/);
  assert.match(prompt, /file tools/);
  assert.equal(fs.readFileSync(abs, 'utf8'), inputBody);
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000));

  // A large input is accepted: only the listing is measured, not the file body.
  const qBigIn = mkTmp('noncq-q-bigin-');
  const bigInput = path.join(work, 'big-ledger.md');
  write(bigInput, `L${'x'.repeat(199999)}`);
  const addBigIn = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok', '--input', bigInput,
  ], { ...envBase, AUTOPILOT_NONCQ_DIR: qBigIn });
  assert.equal(addBigIn.status, 0, addBigIn.stderr);

  // Brief alone over the 150000-byte gate is refused and leaves no item.
  const bigBrief = path.join(work, 'big-brief.md');
  write(bigBrief, 'B'.repeat(150001));
  const before = fs.readdirSync(path.join(q, 'items')).sort();
  const badBrief = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', bigBrief,
    '--accept', 'ok', '--prefer', 'grok',
  ], envBase);
  assert.equal(badBrief.status, 2, badBrief.stderr);
  assert.match(badBrief.stderr, /150000/);
  assert.deepEqual(fs.readdirSync(path.join(q, 'items')).sort(), before);

  // review-seat1 counts diff and spec bytes toward the same gate.
  const bigDiff = path.join(work, 'big.patch');
  write(bigDiff, 'D'.repeat(160000));
  const spec = path.join(work, 'spec.md');
  write(spec, 'spec\n');
  const badReview = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'review-seat1', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok', '--diff', bigDiff, '--spec', spec,
  ], envBase);
  assert.equal(badReview.status, 2, badReview.stderr);
  assert.match(badReview.stderr, /150000/);
  assert.deepEqual(fs.readdirSync(path.join(q, 'items')).sort(), before);

  // agy_stdin_ceiling on stderr is terminal: one attempt, no requeue.
  const qCeil = mkTmp('noncq-q-ceil-');
  const ceilRails = mkTmp('noncq-ceil-rails-');
  const author = path.join(ceilRails, 'dispatch-author.sh');
  write(author, `#!/usr/bin/env bash
echo 'agy-stream-json.js: agy_stdin_ceiling: encoded prompt over stdin ceiling' >&2
echo '{"runner":"stub","model":"stub","status":"runner_failed","raw_log":null,"error":"agy_stdin_ceiling"}'
exit 3
`, 0o755);
  fs.chmodSync(author, 0o755);
  const addCeil = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'agy',
  ], {
    ...envBase,
    AUTOPILOT_NONCQ_DIR: qCeil,
    AUTOPILOT_NONCQ_RAIL_DIR: ceilRails,
    AUTOPILOT_NOW: new Date(NOW_MS + 120_000).toISOString(),
  });
  assert.equal(addCeil.status, 0, addCeil.stderr);
  const idCeil = addCeil.stdout.trim();
  const paceAgy = writePace(work, [paceRow({ pool: 'agy', waste_pct_if_unused: 9 })], 'pace-ceil.json');
  let cd = drain(qCeil, paceAgy, ceilRails, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 121_000).toISOString(),
  });
  assert.equal(cd.status, 0, cd.stderr);
  assert.equal(JSON.parse(cd.stdout).dispatched.filter((x) => x.id === idCeil).length, 1);
  assert.ok(waitFor(() => fs.existsSync(path.join(qCeil, 'items', idCeil, 'rail.exit')), 8000));
  cd = drain(qCeil, paceAgy, ceilRails, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 122_000).toISOString(),
  });
  assert.equal(cd.status, 0, cd.stderr);
  const reapOut = JSON.parse(cd.stdout);
  assert.equal(reapOut.requeued.includes(idCeil), false, 'stdin ceiling must not requeue');
  const ceilItem = JSON.parse(fs.readFileSync(path.join(qCeil, 'items', idCeil, 'item.json'), 'utf8'));
  assert.equal(ceilItem.state, 'failed');
  assert.equal(ceilItem.attempts, 1);
  cd = drain(qCeil, paceAgy, ceilRails, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 123_000).toISOString(),
  });
  assert.equal(JSON.parse(cd.stdout).dispatched.filter((x) => x.id === idCeil).length, 0);
});

// ---------------------------------------------------------------------------
// (2) same basename inputs must not overwrite each other
// ---------------------------------------------------------------------------
test('(2) duplicate input basenames are refused at add', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);
  const env = { AUTOPILOT_NONCQ_DIR: q, AUTOPILOT_FLEET_BIN: fleet.bin };
  const a = path.join(work, 'one', 'ledger.md');
  const b = path.join(work, 'two', 'ledger.md');
  write(a, 'alpha-ledger\n');
  write(b, 'beta-ledger\n');
  const r = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok', '--input', a, '--input', b,
  ], env);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /ledger\.md/);
  const itemsRoot = path.join(q, 'items');
  const names = fs.existsSync(itemsRoot) ? fs.readdirSync(itemsRoot) : [];
  assert.deepEqual(names, []);

  const notes = path.join(work, 'notes.txt');
  write(notes, 'notes\n');
  const ok = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok', '--input', a, '--input', notes,
  ], env);
  assert.equal(ok.status, 0, ok.stderr);
  const id = ok.stdout.trim();
  assert.equal(fs.readFileSync(path.join(q, 'items', id, 'inputs', 'ledger.md'), 'utf8'), 'alpha-ledger\n');
  assert.equal(fs.readFileSync(path.join(q, 'items', id, 'inputs', 'notes.txt'), 'utf8'), 'notes\n');
});

// ---------------------------------------------------------------------------
// (3) needs-shell is stored, listed, and not handed to an agy runner
// ---------------------------------------------------------------------------
test('(3) --needs-shell is stored, listed, and never assigned to an agy runner', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const brief = briefFile(work);
  const env = {
    AUTOPILOT_NONCQ_DIR: q,
    AUTOPILOT_NONCQ_RAIL_DIR: rails.dir,
    AUTOPILOT_FLEET_BIN: fleet.bin,
  };

  const add = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'sha256 matches', '--prefer', 'agy,grok', '--needs-shell',
  ], env);
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const item = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.equal(item.needs_shell, true);

  const plain = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'research', '--brief', brief,
    '--accept', 'ok', '--prefer', 'agy',
  ], { ...env, AUTOPILOT_NOW: new Date(NOW_MS + 1000).toISOString() });
  assert.equal(plain.status, 0, plain.stderr);
  const plainId = plain.stdout.trim();
  const plainItem = JSON.parse(fs.readFileSync(path.join(q, 'items', plainId, 'item.json'), 'utf8'));
  assert.equal(plainItem.needs_shell, false);

  const listed = cli(['list'], env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, new RegExp(`${id}\\tqueued\\tresearch\\tns/courier/lane-a\\tprefer=agy,grok\\tneeds_shell=true`));
  assert.match(listed.stdout, new RegExp(`${plainId}\\tqueued\\tresearch\\tns/courier/lane-a\\tprefer=agy\\tneeds_shell=false`));
  const listedJson = JSON.parse(cli(['list', '--json'], env).stdout);
  assert.equal(listedJson.items.find((it) => it.id === id).needs_shell, true);

  const paceAgy = writePace(work, [paceRow({ pool: 'agy' })], 'pace-agy-only.json');
  let d = drain(q, paceAgy, rails.dir, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 5000).toISOString(),
  });
  assert.equal(d.status, 0, d.stderr);
  const out = JSON.parse(d.stdout);
  assert.deepEqual(out.dispatched.map((x) => x.id), [plainId], 'agy must take the plain item only');
  assert.equal(out.dispatched[0].engine, 'agy');
  const still = JSON.parse(fs.readFileSync(path.join(q, 'items', id, 'item.json'), 'utf8'));
  assert.equal(still.state, 'queued');
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', plainId, 'rail.exit')), 8000));

  const paceGrok = writePace(work, [paceRow()], 'pace-grok-only.json');
  d = drain(q, paceGrok, rails.dir, fleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 6000).toISOString(),
  });
  assert.equal(d.status, 0, d.stderr);
  const hit = JSON.parse(d.stdout).dispatched.find((x) => x.id === id);
  assert.ok(hit, 'a qualifying non-agy engine from prefer must take the item');
  assert.equal(hit.engine, 'grok');
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000));
});

// ---------------------------------------------------------------------------
// (4) completion notice uploads a 0640 copy and cites the sha
// ---------------------------------------------------------------------------
test('(4) notify uploads share/result.md and puts ref= next to the path', () => {
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work, { authorRawContent: 'SHARE_ME\n' });
  const brief = briefFile(work);
  const up = makeUploadFleet(work, { uploadExit: 0 });

  const q = mkTmp('noncq-q-');
  const add = cli([
    'add', '--lane', 'ns/courier/lane-a', '--kind', 'draft', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok',
  ], {
    AUTOPILOT_NONCQ_DIR: q,
    AUTOPILOT_NONCQ_RAIL_DIR: rails.dir,
    AUTOPILOT_FLEET_BIN: up.bin,
  });
  assert.equal(add.status, 0, add.stderr);
  const id = add.stdout.trim();
  const pace = writePace(work, [paceRow()]);
  let d = drain(q, pace, rails.dir, up.bin);
  assert.equal(JSON.parse(d.stdout).dispatched.length, 1);
  assert.ok(waitFor(() => fs.existsSync(path.join(q, 'items', id, 'rail.exit')), 8000));
  d = drain(q, pace, rails.dir, up.bin);
  assert.equal(d.status, 0, d.stderr);
  const resultPath = path.join(q, 'items', id, 'result.md');
  const share = path.join(q, 'items', id, 'share', 'result.md');
  assert.equal(fs.readFileSync(resultPath, 'utf8'), 'SHARE_ME\n');
  assert.ok(fs.existsSync(share), 'share copy must exist');
  assert.equal(fs.statSync(share).mode & 0o777, 0o640);
  assert.equal(fs.readFileSync(share, 'utf8'), 'SHARE_ME\n');
  const args = fs.readFileSync(up.nul).toString('utf8').split('\0').filter((s) => s.length > 0);
  const at = args.indexOf('upload');
  assert.ok(at >= 0, 'fleet upload must be invoked');
  assert.equal(args[at + 1], share);
  assert.equal(args[at + 2], '--name');
  assert.equal(args[at + 3], `${id}-result.md`);
  assert.equal(args[at + 4], '--summary');
  assert.equal(args[at + 5], `${id} done`);
  const msg = fs.readFileSync(up.msgLog, 'utf8');
  assert.ok(msg.includes(`${id} done ${resultPath} ref=${up.sha}`), msg);

  const failFleet = makeUploadFleet(work, { uploadExit: 1 });
  const q2 = mkTmp('noncq-q2-');
  const add2 = cli([
    'add', '--lane', 'ns/courier/lane-b', '--kind', 'draft', '--brief', brief,
    '--accept', 'ok', '--prefer', 'grok',
  ], {
    AUTOPILOT_NONCQ_DIR: q2,
    AUTOPILOT_NONCQ_RAIL_DIR: rails.dir,
    AUTOPILOT_FLEET_BIN: failFleet.bin,
    AUTOPILOT_NOW: new Date(NOW_MS + 30_000).toISOString(),
  });
  assert.equal(add2.status, 0, add2.stderr);
  const id2 = add2.stdout.trim();
  const pace2 = writePace(work, [paceRow()], 'pace-up-fail.json');
  drain(q2, pace2, rails.dir, failFleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 30_000).toISOString(),
  });
  assert.ok(waitFor(() => fs.existsSync(path.join(q2, 'items', id2, 'rail.exit')), 8000));
  const d2 = drain(q2, pace2, rails.dir, failFleet.bin, [], {
    AUTOPILOT_NOW: new Date(NOW_MS + 31_000).toISOString(),
  });
  assert.equal(d2.status, 0, d2.stderr);
  const result2 = path.join(q2, 'items', id2, 'result.md');
  const msg2 = fs.readFileSync(failFleet.msgLog, 'utf8');
  assert.ok(msg2.includes(`${id2} done ${result2} upload_failed`), msg2);
  assert.equal(msg2.includes('ref='), false);
  const item2 = JSON.parse(fs.readFileSync(path.join(q2, 'items', id2, 'item.json'), 'utf8'));
  assert.equal(item2.notified, true);
  assert.equal(fs.statSync(path.join(q2, 'items', id2, 'share', 'result.md')).mode & 0o777, 0o640);
});

// ---------------------------------------------------------------------------
// (5) empty report names the suggested source, without scanning other repos
// ---------------------------------------------------------------------------
test('(5) empty report names lane backlog items tagged noncq-ok', () => {
  const q = mkTmp('noncq-q-');
  const work = mkTmp('noncq-w-');
  const rails = makeRails(work);
  const fleet = makeFleetBin(work);
  const pace = writePace(work, [paceRow({ waste_pct_if_unused: 55 })]);
  const d = drain(q, pace, rails.dir, fleet.bin, [], {
    AUTOPILOT_NONCQ_REPORT_TO: 'ns/courier/pm-bot',
  });
  assert.equal(d.status, 0, d.stderr);
  const log = fs.readFileSync(fleet.log, 'utf8');
  assert.match(log, /\[noncq-empty\] grok waste_pct_if_unused=55\nlane backlog items tagged `noncq-ok`/);
  assert.equal(log.includes('project/backlog'), false);
  assert.equal(log.includes('/home/'), false);
});
