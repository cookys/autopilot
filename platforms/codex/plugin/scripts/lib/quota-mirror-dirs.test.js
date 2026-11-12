'use strict';
// Reader merge for the shared quota mirror (PM 01M788HW). Synthetic dirs under a temp root only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const observation = require('./account-observation');
const mirrors = require('./quota-mirror-dirs');

const T = 1_800_000_000;

function win(kind, utilization, observedAt, resetsAt) {
  return {
    kind, utilization, resets_at: resetsAt === undefined ? T + 3600 : resetsAt,
    source: 'probe', observed_at: observedAt,
  };
}

function writeView(quotaDir, provider, alias, windows, mutate) {
  const record = {
    schema: observation.SCHEMA, provider, alias, visibility: 'L3', windows,
    refusal: null, token_state: 'unknown', token_state_at: null,
  };
  if (mutate) mutate(record);
  const view = {
    schema: observation.VIEW_SCHEMA, namespace: null, hub_offset: 0,
    rows: [{ writer_courier: 'local', host_role: 'agent', observed_at_hub: null, skewed: false, record }],
  };
  const dir = path.join(quotaDir, provider);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${alias}.json`), `${JSON.stringify(view)}\n`, { mode: 0o640 });
}

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-'));
  const live = path.join(root, 'live');
  const extra = path.join(root, 'extra');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(live, 'quota'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(extra, { recursive: true, mode: 0o750 });
  fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
  return {
    root, live, extra, home,
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

function merged(w, env) {
  return mirrors.readMerged({ liveDir: w.live, env: env || {}, home: w.home }).records;
}

function one(records, provider) {
  const hit = records.find((r) => r.provider === provider);
  assert.ok(hit, provider);
  return hit.record;
}

test('extra dir provides minimax and local has claude: both shown', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'claude', 'a', [win('rolling_5h', 0.2, T)]);
    writeView(w.extra, 'minimax', 'minimax', [win('rolling_5h', 0.4, T)]);
    const providers = merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: w.extra }).map((r) => r.provider).sort();
    assert.deepStrictEqual(providers, ['claude', 'minimax']);
  } finally { w.cleanup(); }
});

test('newer in extra wins', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'minimax', 'minimax', [win('rolling_5h', 0.2, T)]);
    writeView(w.extra, 'minimax', 'minimax', [win('rolling_5h', 0.8, T + 10)]);
    const rec = one(merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: w.extra }), 'minimax');
    assert.strictEqual(rec.windows[0].utilization, 0.8);
    assert.strictEqual(rec.windows[0].observed_at, T + 10);
  } finally { w.cleanup(); }
});

test('tie on observed_at keeps the local row', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'minimax', 'minimax', [win('rolling_5h', 0.2, T)]);
    writeView(w.extra, 'minimax', 'minimax', [win('rolling_5h', 0.9, T)]);
    const rec = one(merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: w.extra }), 'minimax');
    assert.strictEqual(rec.windows[0].utilization, 0.2);
  } finally { w.cleanup(); }
});

test('invalid row in an extra dir is dropped', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'claude', 'a', [win('rolling_5h', 0.3, T)]);
    writeView(w.extra, 'minimax', 'minimax', [win('rolling_5h', 0.4, T)], (rec) => { rec.windows[0].utilization = 62; });
    const records = merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: w.extra });
    assert.deepStrictEqual(records.map((r) => r.provider), ['claude']);
    assert.strictEqual(one(records, 'claude').windows[0].utilization, 0.3);
  } finally { w.cleanup(); }
});

test('env AUTOPILOT_QUOTA_MIRROR_DIRS overrides quota_mirror_dirs', () => {
  const w = world();
  try {
    const other = path.join(w.root, 'other');
    fs.mkdirSync(other, { recursive: true });
    writeView(path.join(w.live, 'quota'), 'claude', 'a', [win('rolling_5h', 0.2, T)]);
    writeView(w.extra, 'minimax', 'minimax', [win('rolling_5h', 0.4, T)]);
    writeView(other, 'glm', 'glm', [win('rolling_5h', 0.5, T)]);
    const cfg = path.join(w.home, '.autopilot', 'config.json');
    fs.writeFileSync(cfg, `${JSON.stringify({ quota_mirror_dirs: [w.extra] })}\n`);
    const fromConfig = merged(w, {}).map((r) => r.provider).sort();
    assert.deepStrictEqual(fromConfig, ['claude', 'minimax']);
    const fromEnv = merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: other }).map((r) => r.provider).sort();
    assert.deepStrictEqual(fromEnv, ['claude', 'glm']);
    const emptyEnv = merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: '' }).map((r) => r.provider);
    assert.deepStrictEqual(emptyEnv, ['claude']);
  } finally { w.cleanup(); }
});

test('a newer extra L3 row supplies metadata, not the older local L1 row', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'claude', 'a', [], (rec) => {
      rec.visibility = 'L1';
      rec.windows = [];
      rec.token_state = 'invalid';
      rec.token_state_at = T - 100;
      rec.refusal = { observed_at: T - 100, retry_at: T + 1200, reason: 'rate_limit' };
    });
    writeView(w.extra, 'claude', 'a', [win('rolling_5h', 0.4, T + 50)]);
    const rec = one(merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: w.extra }), 'claude');
    assert.strictEqual(rec.visibility, 'L3');
    assert.strictEqual(rec.token_state, 'unknown');
    assert.strictEqual(rec.token_state_at, null);
    assert.strictEqual(rec.refusal, null);
    assert.strictEqual(rec.windows.length, 1);
    assert.strictEqual(rec.windows[0].utilization, 0.4);
    assert.strictEqual(rec.windows[0].observed_at, T + 50);
  } finally { w.cleanup(); }
});

test('a local refusal row with no windows is still returned', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'claude', 'a', [], (rec) => {
      rec.visibility = 'L1';
      rec.windows = [];
      rec.refusal = { observed_at: T - 10, retry_at: T + 1200, reason: 'rate_limit' };
    });
    const rec = one(merged(w, {}), 'claude');
    assert.strictEqual(rec.refusal.reason, 'rate_limit');
    assert.deepStrictEqual(rec.windows, []);
  } finally { w.cleanup(); }
});

test('a missing extra dir is skipped', () => {
  const w = world();
  try {
    writeView(path.join(w.live, 'quota'), 'claude', 'a', [win('rolling_5h', 0.2, T)]);
    const records = merged(w, { AUTOPILOT_QUOTA_MIRROR_DIRS: path.join(w.root, 'missing') });
    assert.deepStrictEqual(records.map((r) => r.provider), ['claude']);
  } finally { w.cleanup(); }
});

test('listMirrorDirs puts the live quota dir first', () => {
  const w = world();
  try {
    const dirs = mirrors.listMirrorDirs({ liveDir: w.live, env: { AUTOPILOT_QUOTA_MIRROR_DIRS: w.extra }, home: w.home });
    assert.deepStrictEqual(dirs, [path.join(w.live, 'quota'), w.extra]);
  } finally { w.cleanup(); }
});
