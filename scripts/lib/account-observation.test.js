'use strict';
// Tests for account-observation.js: the G40 contract fleet.quota/1 validator, the single clamp boundary and the
// mirror view IO. Titles carry the G40-N prefix (G37 has its own N numbers). Fixtures only: makeFixture builds a
// tempdir world with FAKE- tokens; nothing touches a real ~/.claude, ~/.autopilot or live directory.
// Run: node --test scripts/lib/account-observation.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const o = require('./account-observation');
const { makeFixture } = require('./account-fixtures/shim-install');

const T = 1_800_000_000;

function win(over) {
  return Object.assign({ kind: 'rolling_5h', utilization: 0.5, resets_at: T + 3600, source: 'passive', observed_at: T }, over || {});
}
function rec(over) {
  return Object.assign({
    schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L3', windows: [win()], refusal: null,
    token_state: 'unknown', token_state_at: null, host_role: 'agent',
  }, over || {});
}
function withFix(fn) {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try { return fn(fx); } finally { fx.cleanup(); }
}
function qdir(fx, provider) { return path.join(fx.liveDir, 'quota', provider || 'claude'); }
function mkQuotaDir(fx, mode) {
  fs.mkdirSync(qdir(fx), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(fx.liveDir, 'quota'), 0o700);
  fs.chmodSync(qdir(fx), mode === undefined ? 0o700 : mode);
}
function writeViewFile(fx, view) {
  mkQuotaDir(fx);
  fs.writeFileSync(o.mirrorPath(fx.liveDir, 'claude', 'a'), JSON.stringify(view), { mode: 0o600 });
}
function peerRow(over) {
  return Object.assign({ writer_courier: 'ns/courier/peer', host_role: 'laptop', observed_at_hub: T - 30, skewed: true, record: rec({ host_role: 'laptop' }) }, over || {});
}
const reason = (r) => (r.ok ? null : r.reason);

// --- G40-N1 / N50: the unit boundary -------------------------------------------------------------

test('G40-N1 build boundary: utilization 62 (0..100 scale, skipped conversion) is rejected quota_invalid', () => {
  const r = o.buildRecord(rec({ windows: [win({ utilization: 62 })] }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'quota_invalid');
  assert.strictEqual(r.reason, 'utilization_range');
});

test('G40-N1 validator: a stored utilization of 62 is rejected quota_invalid', () => {
  const r = o.validateRecord(rec({ windows: [win({ utilization: 62 })] }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'quota_invalid');
  assert.strictEqual(r.reason, 'utilization_range');
});

test('G40-N50 clamp: 1.2 is stored 1.0 with clamped:true; 62 and -0.1 are rejected; 1.5 is the last clamped value', () => {
  assert.deepStrictEqual(o.clampUtilization(1.2), { ok: true, value: 1, clamped: true });
  assert.deepStrictEqual(o.clampUtilization(1.5), { ok: true, value: 1, clamped: true });
  assert.deepStrictEqual(o.clampUtilization(1), { ok: true, value: 1, clamped: false });
  assert.deepStrictEqual(o.clampUtilization(0), { ok: true, value: 0, clamped: false });
  assert.strictEqual(o.clampUtilization(62).ok, false);
  assert.strictEqual(o.clampUtilization(1.5000001).ok, false);
  assert.strictEqual(o.clampUtilization(-0.1).ok, false);
  assert.strictEqual(o.clampUtilization(NaN).ok, false);
  assert.strictEqual(o.clampUtilization('0.5').ok, false);
  const b = o.buildRecord(rec({ windows: [win({ utilization: 1.2 })] }));
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.record.windows[0].utilization, 1);
  assert.strictEqual(b.record.windows[0].clamped, true);
  assert.strictEqual(o.validateRecord(b.record).ok, true);
  const plain = o.buildRecord(rec({ windows: [win({ utilization: 0.4, clamped: true })] }));
  assert.strictEqual('clamped' in plain.record.windows[0], false, 'clamped is derived at the boundary, never carried in');
});

test('G40-N50 reader: a stored record with utilization 1.2 is rejected by readView (the row is dropped and named)', () => {
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [
      peerRow({ writer_courier: 'ns/courier/bad', record: rec({ windows: [win({ utilization: 1.2 })] }) }),
      peerRow({ writer_courier: 'ns/courier/good' }),
    ] });
    const r = o.readView(fx.liveDir, 'claude', 'a');
    assert.deepStrictEqual(r.view.rows.map((x) => x.writer_courier), ['ns/courier/good']);
    assert.deepStrictEqual(r.row_notes, [{ writer_courier: 'ns/courier/bad', note: 'utilization_range' }]);
  });
});

// --- G40-N2 / N38 / N39: keys and token shapes ---------------------------------------------------

test('G40-N2 a record with an unknown key is rejected, and the key name is not echoed', () => {
  const r = o.validateRecord(rec({ surprise_field: 1 }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unknown_key');
  assert.strictEqual(o.validateRecord(rec({ windows: [win({ extra: 1 })] })).reason, 'unknown_key');
});

test('G40-N2 a token-shaped string anywhere: the writer refuses to write and nothing lands on disk', () => {
  withFix((fx) => {
    const fake = fx.tokens.a; // FAKE-token-a-0
    assert.match(fake, /^FAKE-/);
    const r = o.writeLocalRow(fx.liveDir, rec({ host_role: fake }));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'quota_invalid');
    assert.strictEqual(r.reason, 'token_shaped');
    assert.strictEqual(fs.existsSync(path.join(fx.liveDir, 'quota')), false, 'no directory and no file were made');
    // a token as a KEY name is caught too, and sk-ant- shapes
    assert.strictEqual(reason(o.validateRecord(rec({ [`k-${fake}`]: 1 }))), 'token_shaped');
    assert.strictEqual(reason(o.validateRecord(rec({ host_role: 'sk-ant-abc' }))), 'token_shaped');
  });
});

test('G40-N2 a caller-supplied live secret is refused even when it fits every pattern', () => {
  const r = rec({ host_role: 'zz-secret-1' });
  assert.strictEqual(o.validateRecord(r).ok, true, 'shape alone passes');
  assert.strictEqual(reason(o.validateRecord(r, { secrets: ['zz-secret-1'] })), 'token_shaped');
  withFix((fx) => {
    assert.strictEqual(o.writeLocalRow(fx.liveDir, r, { secrets: ['zz-secret-1'] }).reason, 'token_shaped');
  });
});

test('G40-N38 pct, resetsAt, five_hour, seven_day and *_ms fields are rejected, never renamed', () => {
  const names = ['pct', 'resetsAt', 'five_hour', 'seven_day', 'observed_at_ms', 'written_at_ms', 'sent_at', 'namespace', 'writer_courier', 'hub_offset'];
  for (const n of names) {
    const input = rec({ [n]: 1 });
    const before = JSON.stringify(input);
    const r = o.validateRecord(input);
    assert.strictEqual(r.ok, false, n);
    assert.match(r.reason, /^forbidden_key:/, n);
    assert.strictEqual(o.buildRecord(input).ok, false, n);
    assert.strictEqual(JSON.stringify(input), before, `${n}: input untouched`);
  }
  for (const n of ['pct', 'resetsAt', 'observed_at_ms']) {
    const input = rec({ windows: [win({ [n]: 1 })] });
    const r = o.validateRecord(input);
    assert.match(r.reason, /^forbidden_key:/, `window ${n}`);
    assert.strictEqual(o.buildRecord(input).ok, false);
  }
});

// --- G40-N24 / N25 / N33: window grammar ----------------------------------------------------------

test('G40-N24 a record whose key says provider a and whose body says provider b is rejected provider_mismatch', () => {
  assert.strictEqual(reason(o.validateRecord(rec({ provider: 'codex' }), { provider: 'claude' })), 'provider_mismatch');
  assert.strictEqual(o.validateRecord(rec(), { provider: 'claude', alias: 'a' }).ok, true);
  assert.strictEqual(reason(o.validateRecord(rec(), { alias: 'b' })), 'alias_mismatch');
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [peerRow({ record: rec({ provider: 'codex' }) })] });
    const r = o.readView(fx.liveDir, 'claude', 'a');
    assert.deepStrictEqual(r.view.rows, []);
    assert.strictEqual(r.row_notes[0].note, 'provider_mismatch');
  });
});

test('G40-N25 unknown kind, duplicate kind, used without limit or unit, unit outside the enum are rejected', () => {
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ kind: 'hourly' })] }))), 'window_kind');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win(), win({ utilization: 0.1 })] }))), 'window_kind_duplicate');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ used: 5 })] }))), 'used_limit_pair');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ used: 5, limit: 10 })] }))), 'unit_required');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ used: 5, limit: 10, unit: 'bananas' })] }))), 'unit_enum');
  assert.strictEqual(o.validateRecord(rec({ windows: [win({ used: 5, limit: 10, unit: 'requests' })] })).ok, true);
});

test('G40-N25 a window source outside passive|endpoint|probe|estimated is rejected, none and statusline included', () => {
  for (const s of ['none', 'statusline', 'registry', 'PASSIVE', '', null, undefined]) {
    assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ source: s })] }))), 'window_source', String(s));
  }
  for (const s of o.WINDOW_SOURCES) assert.strictEqual(o.validateRecord(rec({ windows: [win({ source: s })] })).ok, true, s);
});

test('G40-N33 a remaining-only credits window is accepted; null utilization elsewhere and a remaining mismatch are rejected', () => {
  const credits = { kind: 'credits', utilization: null, used: null, limit: null, unit: 'credits', remaining: 3100, resets_at: null, source: 'endpoint', observed_at: T };
  assert.strictEqual(o.validateRecord(rec({ windows: [credits] })).ok, true);
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [Object.assign({}, credits, { kind: 'weekly' })] }))), 'remaining_kind');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ utilization: null })] }))), 'utilization_null');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [Object.assign({}, credits, { unit: null })] }))), 'unit_required');
  const both = { kind: 'credits', utilization: 0.3, used: 300, limit: 1000, unit: 'credits', remaining: 700, resets_at: null, source: 'endpoint', observed_at: T };
  assert.strictEqual(o.validateRecord(rec({ windows: [both] })).ok, true);
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [Object.assign({}, both, { remaining: 650 })] }))), 'remaining_mismatch');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [Object.assign({}, both, { used: 300, limit: 1000, utilization: null })] }))), 'utilization_null');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [Object.assign({}, credits, { utilization: 0.2 })] }))), 'remaining_only_needs_null_utilization');
});

// --- G40-N49: seconds only --------------------------------------------------------------------------

test('G40-N49 a millisecond epoch (1.7e12) is rejected unit_magnitude in every time field; seconds are accepted', () => {
  const ms = 1.7e12;
  assert.match(reason(o.validateRecord(rec({ windows: [win({ observed_at: ms })] }))), /observed_at:unit_magnitude/);
  assert.match(reason(o.validateRecord(rec({ windows: [win({ resets_at: ms })] }))), /resets_at:unit_magnitude/);
  assert.match(reason(o.validateRecord(rec({ refusal: { observed_at: ms, retry_at: null, reason: 'rate_limit' }, visibility: 'L1' }))), /refusal\.observed_at:unit_magnitude/);
  assert.match(reason(o.validateRecord(rec({ token_state: 'invalid', token_state_at: ms }))), /token_state_at:unit_magnitude/);
  assert.match(reason(o.validateRecord(rec({ token_expires_at: ms }))), /token_expires_at:unit_magnitude/);
  assert.strictEqual(o.validateRecord(rec({ windows: [win({ observed_at: 1.8e9, resets_at: 1.8e9 + 3600 })] })).ok, true);
  assert.strictEqual(o.validateRecord(rec({ windows: [win({ observed_at: 1e11 })] })).ok, true, '1e11 is the last seconds value');
  assert.match(reason(o.validateRecord(rec({ windows: [win({ observed_at: 1e11 + 1 })] }))), /unit_magnitude/);
  assert.match(reason(o.validateRecord(rec({ windows: [win({ observed_at: 1.5 })] }))), /epoch_not_integer/);
});

test('G40-N49 static scan: built records and reader output carry no _ms key; a planted one is found and rejected', () => {
  const b = o.buildRecord(rec({ refusal: { observed_at: T, retry_at: T + 60, reason: 'quota' }, token_state: 'ok', token_state_at: T }));
  assert.strictEqual(b.ok, true);
  assert.strictEqual(o.hasMsKey(b.record), false);
  withFix((fx) => {
    assert.strictEqual(o.writeLocalRow(fx.liveDir, b.record).ok, true);
    assert.strictEqual(o.hasMsKey(o.readView(fx.liveDir, 'claude', 'a').view), false);
  });
  const planted = rec({ windows: [win({ observed_at_ms: T * 1000 })] });
  assert.strictEqual(o.hasMsKey(planted), true);
  assert.strictEqual(o.validateRecord(planted).ok, false);
});

// --- G40-N58 (validation half) and N77: refusal and the empty-windows shapes ----------------------

test('G40-N58 validation: a refusal with no retry_at and no window kind is accepted; an invented window kind or refusal key is rejected', () => {
  const r1 = rec({ visibility: 'L1', windows: [], refusal: { observed_at: T, retry_at: null, reason: 'rate_limit' } });
  assert.strictEqual(o.validateRecord(r1).ok, true);
  const r2 = rec({ visibility: 'L1', windows: [], refusal: { observed_at: T, reason: 'other' } });
  assert.strictEqual(o.validateRecord(r2).ok, true, 'retry_at may be left out');
  assert.strictEqual(reason(o.validateRecord(rec({ visibility: 'L1', windows: [], refusal: { observed_at: T, retry_at: null, reason: 'rate_limit', kind: 'rolling_5h' } }))), 'refusal_key');
  assert.strictEqual(reason(o.validateRecord(rec({ visibility: 'L1', windows: [], refusal: { observed_at: T, retry_at: null, reason: 'because' } }))), 'refusal_reason');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ kind: 'refusal' })] }))), 'window_kind');
});

test('G40-N77 empty-windows shapes: placeholder, L1 + refusal and invalid + token_state_at are accepted', () => {
  const placeholder = { schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L0', windows: [], source: 'registry', host_role: 'agent', token_state: 'unknown', token_issued_at: null, token_expires_at: null };
  assert.strictEqual(o.validateRecord(placeholder).ok, true);
  assert.strictEqual(o.validateRecord(rec({ visibility: 'L1', windows: [], refusal: { observed_at: T, retry_at: null, reason: 'rate_limit' } })).ok, true);
  assert.strictEqual(o.validateRecord(rec({ visibility: 'L0', windows: [], token_state: 'invalid', token_state_at: T })).ok, true);
  assert.strictEqual(o.validateRecord(rec({ visibility: 'L1', windows: [], token_state: 'ok', token_state_at: T, refusal: { observed_at: T, retry_at: null, reason: 'quota' } })).ok, true, 'shapes (b) and (c) combined');
});

test('G40-N77 empty-windows shapes: every malformed shape is rejected quota_invalid', () => {
  const base = { schema: o.SCHEMA, provider: 'claude', alias: 'a', windows: [], host_role: 'agent' };
  const refusal = { observed_at: T, retry_at: null, reason: 'rate_limit' };
  const cases = [
    ['L1, no refusal, unknown state, no source', Object.assign({}, base, { visibility: 'L1', token_state: 'unknown' }), 'empty_windows_shape'],
    ['unknown state and no source', Object.assign({}, base, { visibility: 'L0', token_state: 'unknown' }), 'empty_windows_shape'],
    ['L0 + refusal, no source', Object.assign({}, base, { visibility: 'L0', refusal }), 'refusal_needs_L1'],
    ['L0 + refusal, with source', Object.assign({}, base, { visibility: 'L0', refusal, source: 'registry' }), 'refusal_needs_L1'],
    ['invalid without token_state_at', Object.assign({}, base, { visibility: 'L0', token_state: 'invalid' }), 'token_state_at_required'],
    ['L2 with empty windows', Object.assign({}, base, { visibility: 'L2', token_state: 'invalid', token_state_at: T }), 'empty_windows_visibility'],
    ['L3 with empty windows', Object.assign({}, base, { visibility: 'L3', source: 'registry', token_state: 'unknown' }), 'empty_windows_visibility'],
    ['L1 refusal with a record-level source', Object.assign({}, base, { visibility: 'L1', refusal, source: 'registry' }), 'source_not_allowed'],
    ['state-only with a record-level source', Object.assign({}, base, { visibility: 'L0', token_state: 'ok', token_state_at: T, source: 'registry' }), 'source_not_allowed'],
    ['non-empty windows with a record-level source', rec({ source: 'registry' }), 'source_not_allowed'],
    ['unknown state carrying token_state_at', Object.assign({}, base, { visibility: 'L0', token_state: 'unknown', token_state_at: T, source: 'registry' }), 'token_state_at_with_unknown'],
    ['placeholder claiming L1', Object.assign({}, base, { visibility: 'L1', source: 'registry', token_state: 'unknown' }), 'placeholder_needs_L0'],
  ];
  for (const [name, r, why] of cases) {
    const v = o.validateRecord(r);
    assert.strictEqual(v.ok, false, name);
    assert.strictEqual(v.code, 'quota_invalid', name);
    assert.strictEqual(v.reason, why, name);
  }
});

// --- G40-N89: Q21 closed enum -----------------------------------------------------------------------

test('G40-N89 record-level source is a closed enum: registry on a placeholder is accepted, any other value is rejected', () => {
  const placeholder = (source) => ({ schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L0', windows: [], source, token_state: 'unknown' });
  assert.strictEqual(o.validateRecord(placeholder('registry')).ok, true);
  for (const s of ['placeholder', 'passive', 'REGISTRY', 'registry2', 'a'.repeat(24), '', null, 7]) {
    assert.strictEqual(reason(o.validateRecord(placeholder(s))), 'record_source_unknown', String(s));
  }
  assert.deepStrictEqual(o.RECORD_SOURCES, ['registry'], 'adding a value is a contract change: bump fleet.quota/1 and this pin together');
});

test('G40-N89 registry is allowed only on a placeholder (shape a)', () => {
  assert.strictEqual(reason(o.validateRecord(rec({ source: 'registry' }))), 'source_not_allowed');
  assert.strictEqual(reason(o.validateRecord(rec({ visibility: 'L1', windows: [], refusal: { observed_at: T, retry_at: null, reason: 'quota' }, source: 'registry' }))), 'source_not_allowed');
  assert.strictEqual(reason(o.validateRecord(rec({ visibility: 'L0', windows: [], token_state: 'invalid', token_state_at: T, source: 'registry' }))), 'source_not_allowed');
});

// --- G40-N7 / N52: the mirror view file -----------------------------------------------------------

test('G40-N7 the writer refuses a symlink target and leaves the link target untouched', () => {
  withFix((fx) => {
    mkQuotaDir(fx);
    const decoy = path.join(fx.root, 'decoy.json');
    fs.writeFileSync(decoy, 'DECOY');
    fs.symlinkSync(decoy, o.mirrorPath(fx.liveDir, 'claude', 'a'));
    const r = o.writeLocalRow(fx.liveDir, rec());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'target_invalid');
    assert.strictEqual(r.reason, 'symlink');
    assert.strictEqual(fs.readFileSync(decoy, 'utf8'), 'DECOY');
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').note, 'quota_invalid', 'readers open O_NOFOLLOW and refuse the link too');
  });
});

test('G40-N7 the writer refuses a world-writable provider directory and does not chmod it; a symlinked directory too', () => {
  withFix((fx) => {
    mkQuotaDir(fx, 0o777);
    const r = o.writeLocalRow(fx.liveDir, rec());
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'dir_refused');
    assert.strictEqual(fs.statSync(qdir(fx)).mode & 0o777, 0o777, 'files may already be in it: never chmod a refused directory');
    assert.strictEqual(fs.existsSync(o.mirrorPath(fx.liveDir, 'claude', 'a')), false);
  });
  withFix((fx) => {
    fs.mkdirSync(path.join(fx.liveDir, 'quota'), { mode: 0o700 });
    const elsewhere = path.join(fx.root, 'elsewhere');
    fs.mkdirSync(elsewhere, { mode: 0o700 });
    fs.symlinkSync(elsewhere, qdir(fx));
    const r = o.writeLocalRow(fx.liveDir, rec());
    assert.strictEqual(r.code, 'dir_refused');
    assert.deepStrictEqual(fs.readdirSync(elsewhere), []);
  });
});

test('G40-N52 mirror view: rows keep writer_courier, host_role, observed_at_hub and skewed through write and read', () => {
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: 'nsA', hub_offset: 600, rows: [peerRow()] });
    const w = o.writeLocalRow(fx.liveDir, rec({ host_role: 'agent' }));
    assert.strictEqual(w.ok, true);
    const { view, note } = o.readView(fx.liveDir, 'claude', 'a');
    assert.strictEqual(note, null);
    assert.strictEqual(view.namespace, 'nsA');
    assert.strictEqual(view.hub_offset, 600, 'hub_offset is the pull side\'s: a local write keeps it');
    const byWriter = Object.fromEntries(view.rows.map((r) => [r.writer_courier, r]));
    assert.deepStrictEqual(Object.keys(byWriter).sort(), ['local', 'ns/courier/peer']);
    assert.deepStrictEqual({ h: byWriter['ns/courier/peer'].host_role, t: byWriter['ns/courier/peer'].observed_at_hub, s: byWriter['ns/courier/peer'].skewed },
      { h: 'laptop', t: T - 30, s: true });
    assert.strictEqual(byWriter.local.observed_at_hub, null, 'the local row is judged by the local clock');
    assert.strictEqual(byWriter.local.skewed, false);
    assert.strictEqual(byWriter.local.host_role, 'agent');
  });
});

test('G40-N52 two writers\' rows for one (provider, alias) coexist; a second local write replaces only the local row', () => {
  withFix((fx) => {
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.2 })] })).ok, true);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.7 })] }), { courier: 'ns/courier/other' }).ok, true);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.4 })] })).ok, true);
    const rows = o.readView(fx.liveDir, 'claude', 'a').view.rows;
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows.find((r) => r.writer_courier === 'local').record.windows[0].utilization, 0.4);
    assert.strictEqual(rows.find((r) => r.writer_courier === 'ns/courier/other').record.windows[0].utilization, 0.7);
  });
});

// --- G40-D1: file modes, lock, damaged files, names -------------------------------------------------

test('G40-D1 a write makes a 0700 directory and a 0600 file and leaves no lock or temp file behind', () => {
  withFix((fx) => {
    const r = o.writeLocalRow(fx.liveDir, rec());
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.path, o.mirrorPath(fx.liveDir, 'claude', 'a'));
    assert.strictEqual(fs.statSync(qdir(fx)).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(r.path).mode & 0o777, 0o600);
    assert.deepStrictEqual(fs.readdirSync(qdir(fx)), ['a.json']);
  });
});

test('G40-D1 a lock held for the whole wait skips the write with mirror_lock_busy and changes nothing', () => {
  withFix((fx) => {
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.2 })] })).ok, true);
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    const before = fs.readFileSync(file, 'utf8');
    const lock = path.join(qdir(fx), 'a.lock');
    fs.writeFileSync(lock, '', { mode: 0o600 });
    let t = Date.now();
    const clock = { now: () => t, sleep: (ms) => { t += ms; } };
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.9 })] }), clock);
    assert.deepStrictEqual(r, { ok: false, code: 'mirror_lock_busy' });
    assert.ok(t - Date.now() >= 1900, 'waited the 2 s budget on the injected clock, not the real one');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(fs.existsSync(lock), true, 'a lock we did not take is not ours to remove');
  });
});

test('G40-D1 a lock released during the wait is taken; a dead holder\'s lock is reclaimed; a live holder\'s lock is not, however old up to 120 s', () => {
  withFix((fx) => {
    o.writeLocalRow(fx.liveDir, rec());
    const lock = path.join(qdir(fx), 'a.lock');
    fs.writeFileSync(lock, '', { mode: 0o600 });
    let t = Date.now();
    const r = o.writeLocalRow(fx.liveDir, rec(), { now: () => t, sleep: (ms) => { t += ms; try { fs.unlinkSync(lock); } catch (_) { /* gone */ } } });
    assert.strictEqual(r.ok, true);
    deadLock(fx);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).ok, true, 'holder gone: reclaimed');
    assert.strictEqual(fs.existsSync(lock), false);
    lockWith(fx, process.pid, 100);
    assert.deepStrictEqual(o.writeLocalRow(fx.liveDir, rec(), { waitMs: 150 }), { ok: false, code: 'mirror_lock_busy' }, 'live holder, 100 s old: the old 10 s rule is gone');
    assert.strictEqual(fs.existsSync(lock), true);
    lockWith(fx, process.pid, 200);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec(), { waitMs: 150 }).ok, true, 'older than the 120 s hard cap: reclaimed even if the pid answers');
  });
});

test('G40-D1 a damaged mirror file is replaced (reset:true), a symlinked read is refused, absent is not an error', () => {
  withFix((fx) => {
    assert.deepStrictEqual(o.readView(fx.liveDir, 'claude', 'a'), { view: null, note: null, row_notes: [] });
    mkQuotaDir(fx);
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    fs.writeFileSync(file, '{not json', { mode: 0o600 });
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').note, 'quota_invalid');
    const w = o.writeLocalRow(fx.liveDir, rec());
    assert.strictEqual(w.ok, true);
    assert.strictEqual(w.reset, true);
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').view.rows.length, 1);
    fs.writeFileSync(file, JSON.stringify({ schema: 'fleet.quota-view/9', rows: [] }));
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').note, 'quota_schema_unsupported');
    fs.writeFileSync(file, JSON.stringify({ schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: 'x' }));
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').note, 'quota_invalid');
  });
});

test('G40-D1 view rows: duplicate writer, unknown row key and bad observed_at_hub are dropped with a note', () => {
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [
      peerRow(), peerRow(), peerRow({ writer_courier: 'ns/courier/x2', extra: 1 }),
      peerRow({ writer_courier: 'ns/courier/x3', observed_at_hub: 1.7e12 }),
    ] });
    const r = o.readView(fx.liveDir, 'claude', 'a');
    assert.strictEqual(r.view.rows.length, 1);
    assert.deepStrictEqual(r.row_notes.map((n) => n.note), ['duplicate_writer', 'row_key', 'observed_at_hub:unit_magnitude']);
  });
});

test('G40-D1 names: mirrorPath refuses a provider or alias outside its grammar (no traversal); the live dir must be absolute', () => {
  assert.strictEqual(o.mirrorPath('/x/live', 'claude', 'a'), '/x/live/quota/claude/a.json');
  assert.throws(() => o.mirrorPath('/x/live', 'claude', '../a'), TypeError);
  assert.throws(() => o.mirrorPath('/x/live', 'Claude', 'a'), TypeError);
  assert.throws(() => o.mirrorPath('live', 'claude', 'a'), TypeError);
  assert.strictEqual(o.writeLocalRow(null, rec()).code, 'live_dir_refused');
  assert.strictEqual(o.writeLocalRow('relative', rec()).code, 'live_dir_refused');
});

test('G40-D1 namespace binding file: absent is null, valid is read, a wrong schema or extra key is refused', () => {
  withFix((fx) => {
    assert.deepStrictEqual(o.readNamespaceBinding(fx.liveDir), { namespace: null, note: null });
    fs.mkdirSync(path.join(fx.liveDir, 'quota'), { mode: 0o700 });
    const f = o.namespacePath(fx.liveDir);
    fs.writeFileSync(f, JSON.stringify({ schema: o.NAMESPACE_SCHEMA, namespace: 'nsA' }));
    assert.deepStrictEqual(o.readNamespaceBinding(fx.liveDir), { namespace: 'nsA', note: null });
    fs.writeFileSync(f, JSON.stringify({ schema: 'fleet.quota-ns/2', namespace: 'nsA' }));
    assert.strictEqual(o.readNamespaceBinding(fx.liveDir).note, 'quota_schema_unsupported');
    fs.writeFileSync(f, JSON.stringify({ schema: o.NAMESPACE_SCHEMA, namespace: 'nsA', extra: 1 }));
    assert.strictEqual(o.readNamespaceBinding(fx.liveDir).namespace, null);
    fs.writeFileSync(f, '{');
    assert.strictEqual(o.readNamespaceBinding(fx.liveDir).note, 'quota_invalid');
  });
});

test('G40-D1 token_state grammar: unknown needs a null token_state_at, ok and invalid need one; the enum is closed', () => {
  assert.strictEqual(reason(o.validateRecord(rec({ token_state: 'revoked' }))), 'token_state');
  assert.strictEqual(reason(o.validateRecord(rec({ token_state: 'invalid', token_state_at: null }))), 'token_state_at_required');
  assert.strictEqual(reason(o.validateRecord(rec({ token_state: 'unknown', token_state_at: T }))), 'token_state_at_with_unknown');
  assert.strictEqual(o.validateRecord(rec({ token_state: 'ok', token_state_at: T })).ok, true);
  const noState = rec();
  delete noState.token_state; delete noState.token_state_at;
  assert.strictEqual(o.validateRecord(noState).ok, true, 'absent is read as unknown');
});

// --- review round: token hygiene (A), clamp boundary (B), write safety (C) -----------------------------

const { spawn } = require('child_process');
const rawView = (fx) => JSON.parse(fs.readFileSync(o.mirrorPath(fx.liveDir, 'claude', 'a'), 'utf8'));
const noWrite = (fx) => assert.strictEqual(fs.existsSync(path.join(fx.liveDir, 'quota')), false, 'nothing was made on disk');

test('G40-N2 a courier id carrying a token shape is refused and nothing is written; a long ordinary courier id is fine', () => {
  withFix((fx) => {
    for (const courier of [fx.tokens.a, 'ns/courier/sk-ant-abcdef', ['ns/courier/sk', 'abcdefghijklmnopqrstuvwxyz'].join('-')]) {
      const r = o.writeLocalRow(fx.liveDir, rec(), { courier });
      assert.deepStrictEqual([r.ok, r.code, r.reason], [false, 'quota_invalid', 'token_shaped'], courier);
    }
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec(), { courier: 'zz-secret-1', secrets: ['zz-secret-1'] }).reason, 'token_shaped');
    noWrite(fx);
    const long = `ns/courier/${'m'.repeat(60)}`;
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec(), { courier: long }).ok, true, 'the generic 40-char rule is not applied to a courier id');
  });
});

test('G40-N2 a peer row (row-level host_role or writer_courier) carrying a token refuses the whole write; the file is unchanged', () => {
  for (const bad of [{ host_role: 'FAKE-token-a-0' }, { writer_courier: 'ns/courier/sk-ant-zzzzzz' }, { host_role: 'zz-secret-1' }]) {
    withFix((fx) => {
      writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [peerRow(bad)] });
      const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
      const before = fs.readFileSync(file, 'utf8');
      const r = o.writeLocalRow(fx.liveDir, rec(), { secrets: ['zz-secret-1'] });
      assert.deepStrictEqual([r.ok, r.code, r.reason], [false, 'quota_invalid', 'token_shaped'], JSON.stringify(bad));
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    });
  }
});

test('G40-N2 readView passes opts.secrets down: a peer row holding a live secret is dropped and named token_shaped', () => {
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [
      peerRow({ writer_courier: 'ns/courier/p1', record: rec({ host_role: 'zz-secret-1' }) }),
      peerRow({ writer_courier: 'ns/courier/p2', host_role: 'FAKE-token-a-0' }),
      peerRow({ writer_courier: 'ns/courier/p3' }),
    ] });
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').view.rows.length, 2, 'without secrets only the shape rule applies');
    const r = o.readView(fx.liveDir, 'claude', 'a', { secrets: ['zz-secret-1'] });
    assert.deepStrictEqual(r.view.rows.map((x) => x.writer_courier), ['ns/courier/p3']);
    assert.deepStrictEqual(r.row_notes.map((n) => n.note), ['token_shaped', 'token_shaped']);
  });
});

test('G40-N50 a clamped flag is accepted only on a window stored at exactly 1: 0.4 and null utilization with clamped:true are rejected', () => {
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ utilization: 0.4, clamped: true })] }))), 'clamped_invalid');
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [win({ utilization: 1, clamped: false })] }))), 'clamped_invalid');
  const credits = { kind: 'credits', utilization: null, used: null, limit: null, unit: 'credits', remaining: 5, resets_at: null, source: 'endpoint', observed_at: T, clamped: true };
  assert.strictEqual(reason(o.validateRecord(rec({ windows: [credits] }))), 'clamped_invalid');
  assert.strictEqual(o.validateRecord(rec({ windows: [win({ utilization: 1, clamped: true })] })).ok, true);
  const b = o.buildRecord(rec({ windows: [Object.assign({}, credits)] }));
  assert.strictEqual(b.ok, true);
  assert.strictEqual('clamped' in b.record.windows[0], false, 'buildRecord strips a carried-in clamped before branching');
});

test('G40-N50 writeLocalRow refuses a forged clamped flag and writes nothing', () => {
  withFix((fx) => {
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.4, clamped: true })] }));
    assert.deepStrictEqual([r.ok, r.code, r.reason], [false, 'quota_invalid', 'clamped_invalid']);
    noWrite(fx);
  });
});

test('G40-D1 peer rows are written back byte for byte, an invalid one included; envelope fields are kept', () => {
  withFix((fx) => {
    const peers = [
      peerRow({ writer_courier: 'ns/courier/p1' }),
      peerRow({ writer_courier: 'ns/courier/p2', record: rec({ windows: [win({ utilization: 1.2 })] }) }), // invalid: reader drops it
      { writer_courier: 'ns/courier/p3', extra_key: { nested: [1, 2, 3] }, record: 'not even a record' },
      peerRow({ writer_courier: 'ns/courier/p4', observed_at_hub: 1.7e12 }),
    ];
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: 'nsA', hub_offset: 42, rows: peers });
    const before = rawView(fx).rows.map((x) => JSON.stringify(x));
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).ok, true);
    const after = rawView(fx);
    assert.deepStrictEqual(after.rows.slice(0, 4).map((x) => JSON.stringify(x)), before);
    assert.strictEqual(after.rows.length, 5);
    assert.strictEqual(after.rows[4].writer_courier, 'local');
    assert.deepStrictEqual([after.namespace, after.hub_offset], ['nsA', 42]);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.9 })] })).ok, true);
    assert.deepStrictEqual(rawView(fx).rows.slice(0, 4).map((x) => JSON.stringify(x)), before, 'a second write keeps them too');
  });
});

test('G40-D1 a newer view schema or an unknown top-level key refuses the write and leaves the file alone', () => {
  for (const view of [{ schema: 'fleet.quota-view/2', rows: [] }, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [], future: 1 }]) {
    withFix((fx) => {
      writeViewFile(fx, view);
      const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
      const before = fs.readFileSync(file, 'utf8');
      const r = o.writeLocalRow(fx.liveDir, rec());
      assert.deepStrictEqual([r.ok, r.code], [false, 'view_unsupported']);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
      assert.deepStrictEqual(fs.readdirSync(qdir(fx)), ['a.json'], 'no reset, no corrupt copy');
    });
  }
});

test('G40-D1 only damaged JSON is replaced, and the damaged bytes are kept first as <alias>.json.corrupt.<ts> (0600)', () => {
  withFix((fx) => {
    mkQuotaDir(fx);
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    fs.writeFileSync(file, '{"schema": broken', { mode: 0o600 });
    const w = o.writeLocalRow(fx.liveDir, rec());
    assert.deepStrictEqual([w.ok, w.reset], [true, true]);
    const kept = fs.readdirSync(qdir(fx)).filter((n) => /^a\.json\.corrupt\.\d+$/.test(n));
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(qdir(fx), kept[0]), 'utf8'), '{"schema": broken');
    assert.strictEqual(fs.statSync(path.join(qdir(fx), kept[0])).mode & 0o777, 0o600);
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').view.rows.length, 1);
  });
});

// a pid that certainly does not exist any more: a child that has already exited
const { spawnSync } = require('child_process');
const DEAD_PID = spawnSync(process.execPath, ['-e', '']).pid;
function lockWith(fx, pid, ageS) {
  const lock = path.join(qdir(fx), 'a.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid, nonce: `held-by-${pid}`, t: 0 }), { mode: 0o600 });
  const t = (Date.now() / 1000) - ageS;
  fs.utimesSync(lock, t, t);
  return lock;
}
const deadLock = (fx) => lockWith(fx, DEAD_PID, 1);

test('G40-D1 lock race: a competitor that reclaims the same stale lock first leaves exactly one holder and loses no write', () => {
  withFix((fx) => {
    o.writeLocalRow(fx.liveDir, rec());
    const lock = deadLock(fx);
    let fired = false;
    const hooks = { beforeReclaim: () => {
      if (fired) return;
      fired = true; // competitor B takes the whole path while A is between "saw stale" and "rename"
      assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.7 })] }), { courier: 'ns/courier/b' }).ok, true);
    } };
    const a = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.3 })] }), { courier: 'ns/courier/a', hooks });
    assert.strictEqual(a.ok, true);
    const rows = Object.fromEntries(o.readView(fx.liveDir, 'claude', 'a').view.rows.map((r) => [r.writer_courier, r.record.windows[0].utilization]));
    assert.deepStrictEqual(rows, { local: 0.5, 'ns/courier/b': 0.7, 'ns/courier/a': 0.3 });
    assert.strictEqual(fs.existsSync(lock), false);
    assert.deepStrictEqual(fs.readdirSync(qdir(fx)), ['a.json']);
  });
});

test('G40-D1 lock race: a reclaimer that renames a competitor\'s FRESH lock puts it back and waits; the holder keeps its lock', () => {
  withFix((fx) => {
    o.writeLocalRow(fx.liveDir, rec());
    const lock = deadLock(fx);
    let t = Date.now();
    let seen = null;
    let fired = false;
    const hooks = { beforeReclaim: () => {
      if (fired) return;
      fired = true; // B reclaims and now holds a FRESH lock before A's rename lands
      fs.unlinkSync(lock);
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: 'B', t: Date.now() }), { mode: 0o600 });
    } };
    const sleep = (ms) => {
      t += ms;
      if (seen === null) { seen = lockOwnerOf(lock); fs.unlinkSync(lock); } // B finishes after A has waited once
    };
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.3 })] }), { courier: 'ns/courier/a', hooks, now: () => t, sleep });
    assert.strictEqual(seen, 'B', 'B\'s lock was restored intact, not destroyed');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(fs.existsSync(lock), false);
    assert.strictEqual(o.readView(fx.liveDir, 'claude', 'a').view.rows.length, 2);
  });
});
function lockOwnerOf(lock) { try { return JSON.parse(fs.readFileSync(lock, 'utf8')).nonce; } catch (_) { return null; } }

test('G40-D1 lock release and publish check the nonce: a lock replaced by another holder is neither published over nor removed', () => {
  withFix((fx) => {
    o.writeLocalRow(fx.liveDir, rec());
    const lock = path.join(qdir(fx), 'a.lock');
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    const before = fs.readFileSync(file, 'utf8');
    const hooks = { beforePublish: () => { fs.writeFileSync(lock, JSON.stringify({ pid: 9, nonce: 'OTHER', t: Date.now() })); } };
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.9 })] }), { hooks });
    assert.deepStrictEqual([r.ok, r.code], [false, 'mirror_lock_busy']);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(lockOwnerOf(lock), 'OTHER', 'the other holder\'s lock is still there');
    assert.deepStrictEqual(fs.readdirSync(qdir(fx)).sort(), ['a.json', 'a.lock']);
  });
});

test('G40-D1 lock race with real processes: two writers reclaiming one stale lock, repeated, never lose a row', async () => {
  const modPath = path.join(__dirname, 'account-observation.js');
  const code = `const o=require(${JSON.stringify(modPath)});const [live,courier,u]=process.argv.slice(1);
    const rec={schema:o.SCHEMA,provider:'claude',alias:'a',visibility:'L3',windows:[{kind:'rolling_5h',utilization:Number(u),resets_at:1800003600,source:'passive',observed_at:1800000000}],refusal:null,token_state:'unknown',token_state_at:null,host_role:'agent'};
    const r=o.writeLocalRow(live,rec,{courier,waitMs:8000});process.exit(r.ok?0:3);`;
  const run = (live, courier, u) => new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', code, live, courier, u], { stdio: 'ignore' });
    p.on('exit', (c) => resolve(c));
  });
  for (let i = 0; i < 12; i += 1) {
    const fx = makeFixture({ aliases: [{ alias: 'a' }] });
    try {
      assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).ok, true);
      deadLock(fx);
      const codes = await Promise.all([run(fx.liveDir, 'ns/courier/a', '0.3'), run(fx.liveDir, 'ns/courier/b', '0.7')]);
      assert.deepStrictEqual(codes, [0, 0], `round ${i}`);
      const names = o.readView(fx.liveDir, 'claude', 'a').view.rows.map((r) => r.writer_courier).sort();
      assert.deepStrictEqual(names, ['local', 'ns/courier/a', 'ns/courier/b'], `round ${i}`);
      assert.deepStrictEqual(fs.readdirSync(qdir(fx)), ['a.json']);
    } finally { fx.cleanup(); }
  }
});

// --- second review round: fail-closed scan (A'), live-owner locks (C'), corrupt copies (D') -----------

test('G40-N2 a sk-ant token nested deep in a peer row refuses the write, the file untouched; content past the depth cap is refused too', () => {
  const nest = (leaf, depth) => { let x = leaf; for (let i = 0; i < depth; i += 1) x = { n: x }; return x; };
  for (const extra of [nest(['sk', 'ant', 'abcdef'].join('-'), 5), nest('harmless', 12)]) {
    withFix((fx) => {
      writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [Object.assign(peerRow(), { extra })] });
      const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
      const before = fs.readFileSync(file, 'utf8');
      const r = o.writeLocalRow(fx.liveDir, rec());
      assert.deepStrictEqual([r.ok, r.code, r.reason], [false, 'quota_invalid', 'token_shaped']);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    });
  }
});

test('G40-N2 a 40-character opaque string with no prefix in a peer record field refuses the write; a long courier id does not', () => {
  withFix((fx) => {
    const opaque = 'q'.repeat(45);
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [peerRow({ host_role: opaque })] });
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).reason, 'token_shaped');
  });
  withFix((fx) => {
    const longId = `ns/courier/${'m'.repeat(70)}`;
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [peerRow({ writer_courier: longId })] });
    const before = JSON.stringify(rawView(fx).rows[0]);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).ok, true, 'regression guard: a long legitimate courier id still writes');
    assert.strictEqual(JSON.stringify(rawView(fx).rows[0]), before);
  });
});

test('G40-N2 a live secret hidden deep in a peer row refuses the write', () => {
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [Object.assign(peerRow(), { extra: { a: { b: ['x', 'zz-secret-1'] } } })] });
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).ok, true, 'without the secret the row is just a peer row');
  });
  withFix((fx) => {
    writeViewFile(fx, { schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [Object.assign(peerRow(), { extra: { a: { b: ['x', 'zz-secret-1'] } } })] });
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec(), { secrets: ['zz-secret-1'] }).reason, 'token_shaped');
  });
});

const fakeClock = () => { let t = Date.now(); return { now: () => t, sleep: (ms) => { t += ms; } }; };

test('G40-D1 lock interleave (i): a live writer paused before publish is not reclaimed; the competitor gets mirror_lock_busy, A publishes', () => {
  withFix((fx) => {
    let bResult = null;
    const hooks = { beforePublish: () => {
      bResult = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.8 })] }), Object.assign({ courier: 'ns/courier/b', hardMaxMs: 120000 }, fakeClock()));
    } };
    const a = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.3 })] }), { courier: 'ns/courier/a', hooks });
    assert.deepStrictEqual(bResult, { ok: false, code: 'mirror_lock_busy' });
    assert.strictEqual(a.ok, true);
    assert.deepStrictEqual(o.readView(fx.liveDir, 'claude', 'a').view.rows.map((r) => r.writer_courier), ['ns/courier/a']);
    assert.deepStrictEqual(fs.readdirSync(qdir(fx)), ['a.json']);
  });
});

test('G40-D1 lock interleave (ii): the holder process is killed while holding the lock; the competitor reclaims and writes', async () => {
  const modPath = path.join(__dirname, 'account-observation.js');
  const code = `const o=require(${JSON.stringify(modPath)});const [live]=process.argv.slice(1);
    const rec={schema:o.SCHEMA,provider:'claude',alias:'a',visibility:'L3',windows:[{kind:'rolling_5h',utilization:0.1,resets_at:1800003600,source:'passive',observed_at:1800000000}],refusal:null,token_state:'unknown',token_state_at:null,host_role:'agent'};
    o.writeLocalRow(live,rec,{courier:'ns/courier/dead',hooks:{beforePublish(){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}}});`;
  await withFixAsync(async (fx) => {
    const child = spawn(process.execPath, ['-e', code, fx.liveDir], { stdio: 'ignore' });
    const exited = new Promise((res) => child.on('exit', res));
    const lock = path.join(qdir(fx), 'a.lock');
    for (let i = 0; i < 400 && !fs.existsSync(lock); i += 1) await new Promise((res) => setTimeout(res, 25));
    assert.strictEqual(fs.existsSync(lock), true, 'the child holds the lock');
    assert.strictEqual(JSON.parse(fs.readFileSync(lock, 'utf8')).pid, child.pid);
    child.kill('SIGKILL');
    await exited;
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.6 })] }), { courier: 'ns/courier/b', waitMs: 300 });
    assert.strictEqual(r.ok, true, 'reclaimed from a dead holder');
    assert.deepStrictEqual(o.readView(fx.liveDir, 'claude', 'a').view.rows.map((x) => x.writer_courier), ['ns/courier/b']);
    assert.strictEqual(fs.existsSync(lock), false);
  });
});
async function withFixAsync(fn) {
  const fx = makeFixture({ aliases: [{ alias: 'a' }] });
  try { return await fn(fx); } finally { fx.cleanup(); }
}

test('G40-D1 lock interleave (iii): a writer carrying an older basis that publishes after a newer observation is superseded, the newer stays', () => {
  withFix((fx) => {
    const newer = rec({ windows: [win({ utilization: 0.9, observed_at: T + 500 })] });
    const hooks = { beforePublish: () => {
      const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
      fs.writeFileSync(file, JSON.stringify({ schema: o.VIEW_SCHEMA, namespace: null, hub_offset: 0, rows: [{ writer_courier: 'local', host_role: 'agent', observed_at_hub: null, skewed: false, record: newer }] }), { mode: 0o600 });
    } };
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.2, observed_at: T })] }), { hooks });
    assert.deepStrictEqual([r.ok, r.superseded], [true, true]);
    const rows = o.readView(fx.liveDir, 'claude', 'a').view.rows;
    assert.strictEqual(rows[0].record.windows[0].utilization, 0.9);
    assert.deepStrictEqual(fs.readdirSync(qdir(fx)), ['a.json'], 'no temp file, no lock left');
    // an equal or newer basis still replaces, and a placeholder never replaces a real observation
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.4, observed_at: T + 600 })] })).superseded, undefined);
    const placeholder = { schema: o.SCHEMA, provider: 'claude', alias: 'a', visibility: 'L0', windows: [], source: 'registry', token_state: 'unknown' };
    assert.strictEqual(o.writeLocalRow(fx.liveDir, placeholder).superseded, true);
  });
});

test('G40-D1 lock interleave (iv): a lock replaced under the holder (same text, new inode) is not published over and not unlinked', () => {
  withFix((fx) => {
    o.writeLocalRow(fx.liveDir, rec());
    const lock = path.join(qdir(fx), 'a.lock');
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    const before = fs.readFileSync(file, 'utf8');
    let inoBefore = null;
    const hooks = { beforePublish: () => {
      const text = fs.readFileSync(lock, 'utf8');
      inoBefore = fs.statSync(lock).ino;
      fs.writeFileSync(`${lock}.x`, text, { mode: 0o600 });
      fs.renameSync(`${lock}.x`, lock); // same nonce text, a different file
    } };
    const r = o.writeLocalRow(fx.liveDir, rec({ windows: [win({ utilization: 0.9, observed_at: T + 50 })] }), { hooks });
    assert.notStrictEqual(fs.statSync(lock).ino, inoBefore);
    assert.deepStrictEqual([r.ok, r.code], [false, 'mirror_lock_busy']);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert.strictEqual(fs.existsSync(lock), true, 'the replacement lock is not ours to remove');
  });
});

test('G40-D1 corrupt copies: the newest 3 are kept, a same-second clash gets a nonce tail, an oversize copy is truncated with a marker', () => {
  withFix((fx) => {
    mkQuotaDir(fx);
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    for (const ts of [100, 200, 300]) fs.writeFileSync(`${file}.corrupt.${ts}`, `old${ts}`, { mode: 0o600 });
    fs.writeFileSync(file, '{broken');
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).reset, true);
    const names = () => fs.readdirSync(qdir(fx)).filter((n) => n.includes('.corrupt.')).sort();
    assert.strictEqual(names().length, 3);
    assert.ok(!names().includes('a.json.corrupt.100'), 'the oldest was pruned');
    for (let i = 0; i < 5; i += 1) { fs.writeFileSync(file, `{broken ${i}`); assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).ok, true, 'same-second clashes do not fail'); }
    assert.strictEqual(names().length, 3);
    for (const n of names()) assert.strictEqual(fs.statSync(path.join(qdir(fx), n)).mode & 0o777, 0o600);
  });
  withFix((fx) => {
    mkQuotaDir(fx);
    const file = o.mirrorPath(fx.liveDir, 'claude', 'a');
    fs.writeFileSync(file, `{${'x'.repeat(80000)}`);
    assert.strictEqual(o.writeLocalRow(fx.liveDir, rec()).reset, true);
    const kept = fs.readdirSync(qdir(fx)).find((n) => n.includes('.corrupt.'));
    const body = fs.readFileSync(path.join(qdir(fx), kept), 'utf8');
    assert.ok(body.length < 65536 + 200, 'capped at VIEW_MAX_BYTES plus a marker');
    assert.match(body, /\[truncated by the mirror writer: 80001 bytes in the original\]/);
  });
});
