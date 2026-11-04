'use strict';
// G40 D3 (plan 8.1 P2 interim, 8.2; DAG D3): the mirror may change a pick in exactly two ways.
//   G40-N8   observations omitted: output bytes identical to G37, no extra key.
//   G40-N87  the same inputs replayed with no / stale / unknown / foreign mirror rows: identical JSON.stringify
//            to the golden file generated from unmodified develop (account-pick-g37-golden.json).
//   G40-N88  increment table: only a tight (fresh live measured window >= 0.90) or a live refusal row changes the
//            result; every other row kind is asserted equal to the no-mirror result.
//   G40-N83  P2 interim: only a tight or refusal mirror row takes over from the snapshot; an ok row never does.
// Run: node --test scripts/lib/account-pick-mirror-parity.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pick } = require('./account-pick');
const { selectView } = require('./account-interpret');
const gen = require('./fixtures/gen-account-pick-g37-golden');

const golden = JSON.parse(fs.readFileSync(gen.GOLDEN_FILE, 'utf8'));
const NOW = gen.NOW;
const NOW_S = NOW / 1000;
const A = (alias, priority) => ({ alias, priority });
const clone = (x) => JSON.parse(JSON.stringify(x));
const run = (input) => gen.runPick(pick, input);

// ---- mirror row builders (plain objects, the shape readView returns) ----
const win = (kind, utilization, over) => Object.assign({
  kind, utilization, resets_at: NOW_S + 3600, source: 'passive', observed_at: NOW_S - 10,
}, over || {});
function row(alias, windows, over) {
  const rec = Object.assign({
    schema: 'fleet.quota/1', provider: 'claude', alias, visibility: windows.length ? 'L3' : 'L1', windows,
    refusal: null, token_state: 'unknown', token_state_at: null,
  }, over || {});
  return { writer_courier: 'local', host_role: null, observed_at_hub: null, skewed: false, record: rec };
}
const rollingRow = (alias, u, over, rec) => row(alias, [win('rolling_5h', u, over)], rec);

// Row kinds that must NOT change a result. Tight-valued ones are the point: a mishandled stale, expired, future or
// estimated row would turn the alias tight.
const NO_EFFECT = {
  ok_fresh: (al) => rollingRow(al, 0.1),
  ok_low_both_windows: (al) => row(al, [win('rolling_5h', 0.2), win('weekly', 0.3)]),
  stale_tight: (al) => rollingRow(al, 0.97, { observed_at: NOW_S - 7 * 3600 }),
  stale_ok: (al) => rollingRow(al, 0.1, { observed_at: NOW_S - 7 * 3600 }),
  expired_tight: (al) => rollingRow(al, 0.97, { resets_at: NOW_S - 1 }),
  future_10min_tight: (al) => rollingRow(al, 0.97, { observed_at: NOW_S + 600 }),
  estimated_low: (al) => rollingRow(al, 0.2, { source: 'estimated' }),
  placeholder: (al) => row(al, [], { visibility: 'L0', source: 'registry' }),
  unknown_garbage_window: (al) => rollingRow(al, 0.97, { source: 'bogus' }),
  unknown_no_record: () => ({ writer_courier: 'local', observed_at_hub: null }),
  unknown_null_row: () => null,
  token_state_invalid_ok_window: (al) => rollingRow(al, 0.1, {}, { token_state: 'invalid', token_state_at: NOW_S - 10 }),
  peer_row_tight_unselected: (al) => Object.assign(rollingRow(al, 0.97), { observed_at_hub: NOW_S - 10, writer_courier: 'peer-1' }),
  // A peer row that lacks a hub stamp is still a peer row: only writer_courier 'local' is trusted (no hub this wave).
  peer_no_hub_stamp_tight: (al) => Object.assign(rollingRow(al, 0.97), { writer_courier: 'peer-1' }),
  peer_no_hub_stamp_refusal: (al) => Object.assign(row(al, [], { refusal: { observed_at: NOW_S - 10, retry_at: NOW_S + 1200, reason: 'rate_limit' } }), { writer_courier: 'peer-1' }),
  elapsed_refusal: (al) => row(al, [], { refusal: { observed_at: NOW_S - 3600, retry_at: NOW_S - 60, reason: 'rate_limit' } }),
  stale_refusal: (al) => row(al, [], { refusal: { observed_at: NOW_S - 7 * 3600, reason: 'rate_limit' } }),
};

function withObservations(input, forms) {
  const out = clone(input);
  out.observations = forms;
  return out;
}

// ------------------------------------------------------------------ N8 + N87 (golden replay)

test('G40-N8: golden file was generated from unmodified develop and holds every case', () => {
  assert.strictEqual(golden.schema, 'autopilot.g37-golden/1');
  assert.match(golden.generated_from_commit, /^[0-9a-f]{40}$/);
  assert.ok(golden.pick.length >= 25);
  assert.ok(golden.cli.length >= 10);
});

test('G40-N8: pick without observations equals the golden bytes, and has no extra key', () => {
  for (const c of golden.pick) {
    assert.strictEqual(run(c.input), c.output, `omitted: ${c.name}`);
    if (c.output.startsWith('THROWS')) continue;
    const r = pick(clone(c.input));
    if (r.ok) assert.deepStrictEqual(Object.keys(r.choice), ['alias', 'class', 'used', 'source'], `choice keys: ${c.name}`);
    assert.deepStrictEqual(Object.keys(r), r.ok ? ['ok', 'choice', 'outcome', 'notes', 'dropped'] : ['ok', 'exit', 'code', 'dropped', 'notes']);
  }
});

test('G40-N87: observations {} and per-alias [] replay the golden bytes', () => {
  for (const c of golden.pick) {
    assert.strictEqual(run(withObservations(c.input, {})), c.output, `{}: ${c.name}`);
    const empty = {};
    for (const a of c.input.accounts || []) empty[a.alias] = [];
    assert.strictEqual(run(withObservations(c.input, empty)), c.output, `[]: ${c.name}`);
  }
});

for (const [kind, build] of Object.entries(NO_EFFECT)) {
  test(`G40-N87: mirror row kind ${kind} replays the golden bytes for every case`, () => {
    for (const c of golden.pick) {
      const forms = {};
      for (const a of c.input.accounts || []) forms[a.alias] = [build(a.alias)];
      assert.strictEqual(run(withObservations(c.input, forms)), c.output, `${kind}: ${c.name}`);
    }
  });
}

test('G40-N87: namespace mismatch: selectView drops every peer row before pick, so the golden bytes stand', () => {
  for (const c of golden.pick) {
    const forms = {};
    for (const a of c.input.accounts || []) {
      const view = { schema: 'fleet.quota-view/1', namespace: 'ns-a', hub_offset: 0, rows: [
        Object.assign(rollingRow(a.alias, 0.97), { observed_at_hub: NOW_S - 10, writer_courier: 'peer-1' }),
        Object.assign(row(a.alias, [], { refusal: { observed_at: NOW_S - 5, retry_at: NOW_S + 900, reason: 'rate_limit' } }), { observed_at_hub: NOW_S - 5, writer_courier: 'peer-2' }),
      ] };
      // no hub this wave: the courier's configured namespace is null, so fail closed whatever the file says
      const sel = selectView(view, { configuredNamespace: null, boundNamespace: 'ns-a' });
      assert.deepStrictEqual(sel.rows, []);
      forms[a.alias] = sel.rows;
    }
    assert.strictEqual(run(withObservations(c.input, forms)), c.output, `ns: ${c.name}`);
  }
});

// ------------------------------------------------------------------ N88 increment table

// Snapshots are 60 s old; the default mirror window is 10 s old (newer), so a tight mirror row takes over.
const BASE = () => ({
  accounts: [A('a', 1), A('b', 2), A('c', 3)], nowMs: NOW,
  snapshots: {
    a: { schema: 'codeforge.quota/1', alias: 'a', root: null, written_at_ms: NOW - 60e3, five_hour: { pct: 0.3, resets_at: NOW_S + 3600 }, seven_day: null },
    b: { schema: 'codeforge.quota/1', alias: 'b', root: null, written_at_ms: NOW - 60e3, five_hour: { pct: 0.5, resets_at: NOW_S + 3600 }, seven_day: null },
  },
});
const baseline = () => run(BASE());

for (const [kind, build] of Object.entries(NO_EFFECT)) {
  test(`G40-N88: row kind ${kind} on a fresh-snapshot alias, an unknown alias and every alias: result equals the no-mirror result`, () => {
    const want = baseline();
    for (const al of [['a'], ['c'], ['a', 'b', 'c']]) {
      const forms = {};
      for (const x of al) forms[x] = [build(x)];
      assert.strictEqual(run(withObservations(BASE(), forms)), want, `${kind} on ${al.join(',')}`);
    }
  });
}

test('G40-N88: a fresh live measured window at 0.90 or above makes the alias tight and moves it back (changes the result)', () => {
  const want = baseline();
  for (const source of ['passive', 'endpoint', 'probe']) {
    const r = pick(withObservations(BASE(), { a: [rollingRow('a', 0.95, { source })] }));
    assert.notStrictEqual(JSON.stringify(r), want, source);
    assert.strictEqual(r.choice.alias, 'b'); // a was the best ok, tight a sorts after ok b
    assert.strictEqual(r.choice.class, 'ok');
  }
  // an unknown alias becomes tight too: sorted after the ok ones
  const all = pick(withObservations(BASE(), { a: [rollingRow('a', 0.95)], b: [rollingRow('b', 0.99)] }));
  assert.strictEqual(all.choice.alias, 'c'); // unknown c is before tight a and b
  const allT = pick(Object.assign(withObservations(BASE(), { a: [rollingRow('a', 0.95)], b: [rollingRow('b', 0.99)], c: [rollingRow('c', 0.92)] }), { refuseAllTight: false }));
  assert.strictEqual(allT.choice.alias, 'c');
  assert.strictEqual(allT.choice.class, 'tight');
  assert.strictEqual(allT.outcome, 'all_tight');
  assert.strictEqual(allT.choice.used, 0.92);
  assert.strictEqual(allT.choice.source, 'passive');
  assert.strictEqual(allT.choice.observed_at, NOW_S - 10);
});

test('G40-N88: 0.90 is the boundary; weekly alone at 0.95 is tight; refuseAllTight semantics unchanged', () => {
  assert.strictEqual(pick(withObservations(BASE(), { a: [rollingRow('a', 0.9)] })).choice.alias, 'b');
  assert.strictEqual(run(withObservations(BASE(), { a: [rollingRow('a', 0.8999)] })), baseline());
  assert.strictEqual(pick(withObservations(BASE(), { a: [row('a', [win('weekly', 0.95)])] })).choice.alias, 'b');
  const forms = { a: [rollingRow('a', 0.95)], b: [rollingRow('b', 0.95)], c: [rollingRow('c', 0.95)] };
  const refused = pick(Object.assign(withObservations(BASE(), forms), { refuseAllTight: true }));
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.code, 'all_tight_refused');
  assert.strictEqual(refused.exit, 3);
  // the knob never blocks a pick that has a non-tight alias
  const okOne = pick(Object.assign(withObservations(BASE(), { a: [rollingRow('a', 0.95)], c: [rollingRow('c', 0.95)] }), { refuseAllTight: true }));
  assert.strictEqual(okOne.ok, true);
  assert.strictEqual(okOne.choice.alias, 'b');
});

test('G40-N88: a live refusal drops the alias with reason refusal; the G37 cooldown string stays cooldown', () => {
  const refusal = (al, over) => row(al, [], { refusal: Object.assign({ observed_at: NOW_S - 10, retry_at: NOW_S + 1200, reason: 'rate_limit' }, over || {}) });
  const r = pick(withObservations(BASE(), { a: [refusal('a')] }));
  assert.deepStrictEqual(r.dropped, [{ alias: 'a', reason: 'refusal' }]);
  assert.strictEqual(r.choice.alias, 'b');
  assert.deepStrictEqual(r.notes, []);
  // refusal without retry_at: default cooling window (30 min from the manifest-less default)
  const d = pick(withObservations(BASE(), { a: [refusal('a', { retry_at: undefined })] }));
  assert.deepStrictEqual(d.dropped, [{ alias: 'a', reason: 'refusal' }]);
  // G37 cooldown wins the label when both hold; exclude wins over both
  const both = Object.assign(withObservations(BASE(), { a: [refusal('a')] }), { cooldowns: { a: NOW + 5000 } });
  assert.deepStrictEqual(pick(both).dropped, [{ alias: 'a', reason: 'cooldown' }]);
  const ex = Object.assign(withObservations(BASE(), { a: [refusal('a')] }), { exclude: ['a'] });
  assert.deepStrictEqual(pick(ex).dropped, [{ alias: 'a', reason: 'excluded' }]);
  // all dropped: exit 3 with the new reason in the list
  const none = pick({ accounts: [A('a', 1)], nowMs: NOW, observations: { a: [refusal('a')] } });
  assert.strictEqual(none.ok, false);
  assert.strictEqual(none.code, 'no_account_available');
  assert.deepStrictEqual(none.dropped, [{ alias: 'a', reason: 'refusal' }]);
  // peers do not count: the same refusal from a peer row changes nothing
  const peer = Object.assign(refusal('a'), { observed_at_hub: NOW_S - 10, writer_courier: 'peer-1' });
  assert.strictEqual(run(withObservations(BASE(), { a: [peer] })), baseline());
});

test('G40-N88: refusal reason string is refusal only on mirror refusals; cooldown elsewhere is untouched', () => {
  const g = golden.pick.find((c) => c.name === 'exclude-and-cooldown');
  assert.match(g.output, /"reason":"cooldown"/);
  assert.doesNotMatch(g.output, /refusal/);
});

// ------------------------------------------------------------------ N83 (P2 interim, narrowed)

test('G40-N83: stale snapshot + fresh tight mirror: the mirror takes over; ok mirror does not', () => {
  const stale = (al) => ({ schema: 'codeforge.quota/1', alias: al, root: null, written_at_ms: NOW - 7 * 3600e3, five_hour: { pct: 0.1, resets_at: NOW_S + 3600 }, seven_day: null });
  const base = () => ({ accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: { a: stale('a'), b: stale('b') } });
  assert.strictEqual(pick(base()).choice.alias, 'a'); // both unknown, priority
  const tight = pick(Object.assign(base(), { observations: { a: [rollingRow('a', 0.95)] } }));
  assert.strictEqual(tight.choice.alias, 'b');
  const ok = pick(Object.assign(base(), { observations: { a: [rollingRow('a', 0.1)], b: [rollingRow('b', 0.2)] } }));
  assert.strictEqual(JSON.stringify(ok), JSON.stringify(pick(base())));
  assert.strictEqual(ok.choice.class, 'unknown');
});

test('G40-N83: fresh snapshot newer than a tight mirror row keeps the snapshot; a tie keeps the snapshot; a strictly newer mirror takes over', () => {
  const snapAt = (ms) => ({ accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: {
    a: { schema: 'codeforge.quota/1', alias: 'a', root: null, written_at_ms: ms, five_hour: { pct: 0.2, resets_at: NOW_S + 3600 }, seven_day: null } } });
  const older = pick(Object.assign(snapAt(NOW - 1000), { observations: { a: [rollingRow('a', 0.95, { observed_at: NOW_S - 600 })] } }));
  assert.strictEqual(older.choice.alias, 'a');
  assert.strictEqual(older.choice.source, 'snapshot');
  assert.strictEqual('observed_at' in older.choice, false);
  const tie = pick(Object.assign(snapAt(NOW_S * 1000 - 600e3), { observations: { a: [rollingRow('a', 0.95, { observed_at: NOW_S - 600 })] } }));
  assert.strictEqual(tie.choice.alias, 'a'); // amended 2026-11-04 (PM ruling): equal stamps go to the snapshot
  assert.strictEqual(tie.choice.source, 'snapshot');
  assert.strictEqual('observed_at' in tie.choice, false);
  const newer = pick(Object.assign(snapAt(NOW - 3600e3), { observations: { a: [rollingRow('a', 0.95, { observed_at: NOW_S - 5 })] } }));
  assert.strictEqual(newer.choice.alias, 'b');
});

test('G40-N83: a newer ok mirror row never overrides an older tight snapshot, and never promotes an unknown alias', () => {
  const tightSnap = { accounts: [A('a', 1), A('b', 2)], nowMs: NOW, snapshots: {
    a: { schema: 'codeforge.quota/1', alias: 'a', root: null, written_at_ms: NOW - 3600e3, five_hour: { pct: 0.96, resets_at: NOW_S + 3600 }, seven_day: null } } };
  const want = JSON.stringify(pick(clone(tightSnap)));
  const got = JSON.stringify(pick(Object.assign(clone(tightSnap), { observations: { a: [rollingRow('a', 0.05)], b: [rollingRow('b', 0.05)] } })));
  assert.strictEqual(got, want);
  const r = JSON.parse(got);
  assert.strictEqual(r.choice.alias, 'b'); // unknown b is still unknown, still ahead of tight a
  assert.strictEqual(r.choice.class, 'unknown');
  assert.strictEqual(r.choice.source, 'none');
});

test('G40-N88: an estimated window at or above 0.90 is tight (plan 5.2 rule 4, N26); below 0.90 changes nothing', () => {
  const r = pick(withObservations(BASE(), { a: [rollingRow('a', 0.97, { source: 'estimated' })] }));
  assert.notStrictEqual(JSON.stringify(r), baseline());
  assert.strictEqual(r.choice.alias, 'b'); // a became tight and moved behind ok b
  const only = pick({ accounts: [A('a', 1)], nowMs: NOW, observations: { a: [rollingRow('a', 0.97, { source: 'estimated' })] } });
  assert.strictEqual(only.choice.class, 'tight');
  assert.strictEqual(only.choice.source, 'estimated');
  assert.strictEqual(only.choice.used, 0.97);
  assert.strictEqual(only.outcome, 'all_tight');
  assert.strictEqual(run(withObservations(BASE(), { a: [rollingRow('a', 0.89, { source: 'estimated' })] })), baseline());
  // an estimate that raises used over a measured ok window decides too, exactly as interpretWindows classes it
  const mixed = row('a', [win('rolling_5h', 0.2), win('weekly', 0.97, { source: 'estimated' })]);
  assert.strictEqual(pick(withObservations(BASE(), { a: [mixed] })).choice.alias, 'b');
  // the guard is still: a stale or expired estimate never decides
  assert.strictEqual(run(withObservations(BASE(), { a: [rollingRow('a', 0.97, { source: 'estimated', observed_at: NOW_S - 7 * 3600 })] })), baseline());
  assert.strictEqual(run(withObservations(BASE(), { a: [rollingRow('a', 0.97, { source: 'estimated', resets_at: NOW_S - 1 })] })), baseline());
});

test('G40-N88: a measured tight window with a higher estimate reports the interpreter used and source', () => {
  const m = row('a', [win('rolling_5h', 0.95), win('weekly', 0.99, { source: 'estimated' })]);
  const only = pick({ accounts: [A('a', 1)], nowMs: NOW, observations: { a: [m] } });
  assert.strictEqual(only.choice.class, 'tight');
  assert.strictEqual(only.choice.used, 0.99);
});

test('G40-N8: purity with observations: inputs are not mutated, same input same output', () => {
  const input = withObservations(BASE(), { a: [rollingRow('a', 0.95)], b: [row('b', [], { refusal: { observed_at: NOW_S - 5, retry_at: NOW_S + 900, reason: 'rate_limit' } })] });
  const copy = clone(input);
  const r1 = pick(input);
  const r2 = pick(input);
  assert.deepStrictEqual(input, copy);
  assert.deepStrictEqual(r1, r2);
});

// ------------------------------------------------------------------ golden provenance (pin)

const REPO = path.resolve(__dirname, '..', '..');

test('G40-N87: golden records the pinned commit and every G37 file hash equals git show <pin>:<file>', () => {
  assert.strictEqual(golden.generated_from_commit, gen.PIN_COMMIT);
  assert.strictEqual(gen.PIN_COMMIT, '254a851d39ef876ecfaa38edac5f27557b258b0d');
  assert.deepStrictEqual(Object.keys(golden.g37_file_sha256), gen.G37_FILES);
  const pinned = gen.pinnedHashes(REPO);
  for (const f of gen.G37_FILES) assert.strictEqual(golden.g37_file_sha256[f], pinned[f], f);
});

test('G40-N87: the generator refuses to write when a G37 file differs from the pin, and writes nothing', () => {
  assert.notStrictEqual(gen.pinProblem(REPO), null, 'precondition: D3 changed pick and claude-account');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g40-gen-'));
  try {
    const out = path.join(dir, 'golden.json');
    const r = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'gen-account-pick-g37-golden.js'), '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /refusing: .*differs from 254a851d/);
    assert.strictEqual(fs.existsSync(out), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G40-N87: pin verification fails closed when git cannot answer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g40-nogit-'));
  try {
    assert.throws(() => gen.pinnedHashes(dir), /git show .* failed/);
    assert.match(gen.pinProblem(dir), /git show .* failed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('G40-N87: --check compares the pin and the recorded hashes and ignores the status coverage line', () => {
  assert.strictEqual(gen.stripCoverage('a\nobservations newest_age: a=none\nb'), 'a\nb');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'gen-account-pick-g37-golden.js'), '--check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /golden matches/);
});
