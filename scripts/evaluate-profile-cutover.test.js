#!/usr/bin/env node
'use strict';

/**
 * Unit tests for scripts/evaluate-profile-cutover.js exports and CLI.
 * Run: node --test scripts/evaluate-profile-cutover.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256, canonicalJson } = require('../src/engine/owner-kernel/canonical');
const { ProfileCutoverError } = require('../src/engine/profile-cutover');
const PROFILE_CATALOG = require('../profiles/profile-catalog.json');
const {
  parseArgs,
  readSnapshot,
  run,
} = require('./evaluate-profile-cutover');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(__dirname, 'evaluate-profile-cutover.js');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluate-profile-cutover-script-test-'));

test.after(() => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

function profileSource(name) {
  return {
    profile_hash: PROFILE_CATALOG.profiles[name].sha256,
    control_bytes: PROFILE_CATALOG.core.bytes + PROFILE_CATALOG.profiles[name].bytes,
  };
}

function baseSnapshot() {
  return {
    schema_version: 1,
    observed_at: '2026-07-26T09:30:00.000Z',
    project_default: 'guided',
    candidate_default: 'adaptive',
    rollback: {
      setting: 'governance.guidance_profile',
      value: 'guided',
    },
    supported_hosts: ['codex'],
    profile_sources: {
      guided: profileSource('guided'),
      autonomous: profileSource('autonomous'),
    },
    context_measurements: [],
    effectful_guided_compatibility: {
      status: 'missing',
      receipt_hash: null,
    },
    fallback_tests: {
      identity_drift: 'pass',
      capability_expiry: 'pass',
      capability_demotion: 'pass',
      replacement_reresolution: 'pass',
      profile_change_fresh_session: 'pass',
    },
    critical_false_passes_attributed_to_reduction: 0,
    assurance_invariance: {
      high_risk_assurance_unchanged: 'unverified',
      cross_family_review: 'unverified',
    },
    dogfood_window: {
      status: 'missing',
      window_id: null,
      started_at: null,
      ended_at: null,
      dispatched_task_ids: [],
      receipt_set_hash: null,
    },
    dogfood_receipts: [],
  };
}

function writeSnapshot(name, snapshot) {
  const file = path.join(TMP_ROOT, name);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function argv(...parts) {
  return ['node', 'evaluate-profile-cutover.js', ...parts];
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '' },
  });
}

// --- parseArgs ---

test('parseArgs: help variants', () => {
  assert.deepEqual(parseArgs(argv('help')), { help: true });
  assert.deepEqual(parseArgs(argv('--help')), { help: true });
  assert.deepEqual(parseArgs(argv('-h')), { help: true });
});

test('parseArgs: unknown command throws INVALID_ARGUMENT', () => {
  assert.throws(
    () => parseArgs(argv('sync')),
    (err) => err instanceof ProfileCutoverError && err.code === 'INVALID_ARGUMENT',
  );
});

test('parseArgs: missing --input throws', () => {
  assert.throws(
    () => parseArgs(argv('evaluate')),
    (err) => err instanceof ProfileCutoverError
      && err.code === 'INVALID_ARGUMENT'
      && /required/.test(err.message),
  );
});

test('parseArgs: duplicate --input throws', () => {
  assert.throws(
    () => parseArgs(argv('evaluate', '--input', 'a.json', '--input', 'b.json')),
    (err) => err instanceof ProfileCutoverError && err.code === 'INVALID_ARGUMENT',
  );
});

test('parseArgs: --require-eligible sets flag', () => {
  const opts = parseArgs(argv('evaluate', '--input', 'snap.json', '--require-eligible'));
  assert.equal(opts.requireEligible, true);
  assert.equal(opts.input, 'snap.json');
});

test('parseArgs: incomplete flag throws', () => {
  assert.throws(
    () => parseArgs(argv('evaluate', '--input')),
    (err) => err instanceof ProfileCutoverError && err.code === 'INVALID_ARGUMENT',
  );
});

// --- readSnapshot ---

test('readSnapshot: reads valid JSON file', () => {
  const snap = baseSnapshot();
  const file = writeSnapshot('valid.json', snap);
  const read = readSnapshot(file);
  assert.deepEqual(read, snap);
});

test('readSnapshot: missing file -> INPUT_UNAVAILABLE', () => {
  assert.throws(
    () => readSnapshot(path.join(TMP_ROOT, 'missing.json')),
    (err) => err instanceof ProfileCutoverError && err.code === 'INPUT_UNAVAILABLE',
  );
});

test('readSnapshot: invalid JSON -> INVALID_PROFILE_CUTOVER_SNAPSHOT', () => {
  const file = path.join(TMP_ROOT, 'bad.json');
  fs.writeFileSync(file, '{ not json ');
  assert.throws(
    () => readSnapshot(file),
    (err) => err instanceof ProfileCutoverError && err.code === 'INVALID_PROFILE_CUTOVER_SNAPSHOT',
  );
});

test('readSnapshot: file smaller than 2 bytes -> INPUT_UNTRUSTED', () => {
  const file = path.join(TMP_ROOT, 'tiny.json');
  fs.writeFileSync(file, ' ');
  assert.throws(
    () => readSnapshot(file),
    (err) => err instanceof ProfileCutoverError && err.code === 'INPUT_UNTRUSTED',
  );
});

test('readSnapshot: symlink -> INPUT_UNTRUSTED', () => {
  const target = writeSnapshot('target.json', baseSnapshot());
  const link = path.join(TMP_ROOT, 'link.json');
  try {
    fs.symlinkSync(target, link);
    assert.throws(
      () => readSnapshot(link),
      (err) => err instanceof ProfileCutoverError && err.code === 'INPUT_UNTRUSTED',
    );
  } catch (err) {
    if (err.code === 'EPERM' || err.code === 'ENOTSUP') return;
    throw err;
  }
});

// --- run() ---

test('run: help writes usage and returns 0', () => {
  const code = run(argv('--help'));
  assert.equal(code, 0);
});

test('run: baseline snapshot -> hold_guided advisory receipt', () => {
  const file = writeSnapshot('baseline.json', baseSnapshot());
  const code = run(argv('evaluate', '--input', file));
  assert.equal(code, 0);
});

test('run: require-eligible on hold returns 1', () => {
  const file = writeSnapshot('hold.json', baseSnapshot());
  const code = run(argv('evaluate', '--input', file, '--require-eligible'));
  assert.equal(code, 1);
});

test('run: invalid CLI args return 2 with INVALID_ARGUMENT reason on stdout', () => {
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = run(argv('evaluate', '--bogus'));
    assert.equal(code, 2);
    const payload = JSON.parse(chunks.join(''));
    assert.equal(payload.decision, 'hold_guided');
    assert.equal(payload.reason, 'INVALID_ARGUMENT');
  } finally {
    process.stdout.write = origWrite;
  }
});

// --- CLI subprocess ---

test('CLI: evaluate baseline exits 0 with hold_guided', () => {
  const file = writeSnapshot('cli-baseline.json', baseSnapshot());
  const res = runCli(['evaluate', '--input', file]);
  assert.equal(res.status, 0, res.stderr);
  const decision = JSON.parse(res.stdout);
  assert.equal(decision.decision, 'hold_guided');
  assert.equal(decision.authority_status, 'advisory_only');
});

test('CLI: --require-eligible on hold exits 1', () => {
  const file = writeSnapshot('cli-hold.json', baseSnapshot());
  const res = runCli(['evaluate', '--input', file, '--require-eligible']);
  assert.equal(res.status, 1, res.stderr);
  assert.equal(JSON.parse(res.stdout).decision, 'hold_guided');
});

test('CLI: invalid args exit 2', () => {
  const res = runCli(['evaluate', '--unknown']);
  assert.equal(res.status, 2);
  assert.equal(JSON.parse(res.stdout).reason, 'INVALID_ARGUMENT');
});

test('CLI: --help exits 0', () => {
  const res = runCli(['--help']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /advisory decision receipt/);
});

// Receipt shape sanity on dogfood-heavy snapshot (still hold without live verifiers)
test('CLI: rich snapshot still hold_guided without live verifiers', () => {
  const snap = baseSnapshot();
  snap.context_measurements = [{
    host: 'codex',
    deployment_identity_hash: sha256('deployment:codex'),
    measured_at: '2026-07-26T09:00:00.000Z',
    token_source: 'exact_tokenizer:test-model',
    guided_control_tokens: 120,
    autonomous_control_tokens: 80,
    isolation_receipt_hash: sha256('isolation:codex'),
    fresh_session_switch: true,
  }];
  snap.dogfood_receipts = [1, 2, 3, 4, 5].map((index) => ({
    receipt_id: sha256(`dogfood:${index}`),
    task_id: `task-${index}`,
    profile_session_id: `session-${index}`,
    risk: 'low',
    profile: 'autonomous',
    status: 'completed',
    started_at: `2026-07-26T08:0${index}:00.000Z`,
    completed_at: `2026-07-26T08:1${index}:00.000Z`,
    owner_identity_hash: sha256('owner:exact'),
    owner_family: 'openai',
    reviewer_family: 'xai',
    owner_qualification_receipt_id: sha256('owner:qualification'),
    owner_qualified_at: '2026-07-26T07:00:00.000Z',
    independent_acceptance_receipt_hash: sha256(`acceptance:${index}`),
    acceptance_passed: true,
    critical_false_pass_attributed_to_reduction: false,
    reviewer_catches: index % 2,
    rework_cycles: index % 2,
    wall_time_ms: 1000 + index,
    input_tokens: 200 + index,
    output_tokens: 40 + index,
  }));
  snap.dogfood_window = {
    status: 'observed',
    window_id: 'dogfood-window-1',
    started_at: '2026-07-26T08:00:00.000Z',
    ended_at: '2026-07-26T08:20:00.000Z',
    dispatched_task_ids: snap.dogfood_receipts.map((e) => e.task_id),
    receipt_set_hash: sha256(canonicalJson(
      snap.dogfood_receipts.map((e) => e.receipt_id).sort(),
    )),
  };
  const file = writeSnapshot('cli-rich.json', snap);
  const res = runCli(['evaluate', '--input', file]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).decision, 'hold_guided');
});