'use strict';
// Tests for account-interpret.js (G40 D2: N3-N6, N17, N26, N29, N30, N34, N54, N55, N57, N58, N79-N82, N86).
// Run: node --test scripts/lib/account-interpret.test.js
//
// Every control is a scenario function run against the real module (must pass) and against each
// planted-bug variant of the module source (must throw, i.e. be red). A variant is the real source
// with one text edit, compiled in memory (no fs). To see a whole suite red, run with
// G40_PLANT=<variant id>: the suite then loads that variant instead of the real module.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC_PATH = path.join(__dirname, 'account-interpret.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

function compile(edits, id) {
  let src = SRC;
  for (const [from, to] of edits) {
    const n = src.split(from).length - 1;
    assert.strictEqual(n, 1, `planted edit anchor must match exactly once (${n}): ${from}`);
    src = src.replace(from, () => to);
  }
  const m = new Module(`planted-${id}`);
  m.filename = SRC_PATH;
  m.paths = Module._nodeModulePaths(__dirname);
  m._compile(src, SRC_PATH);
  return m.exports;
}

// Planted bugs: id, the N it must turn red, and the text edits.
const VARIANTS = [
  { id: 'n3-no-6h-bound', n: 'N3', edits: [['if (age > MAX_AGE_S) continue;', '']] },
  { id: 'n3-no-future-bound', n: 'N3', edits: [['if (age < -FUTURE_SKEW_S) continue;', '']] },
  { id: 'n4-ignore-resets', n: 'N4', edits: [['if (resetsAt !== null && resetsAt <= nowC) continue;', '']] },
  { id: 'n5-local-always-wins', n: 'N5', edits: [['if (a.age !== b.age) return a.age - b.age;', 'if (a.age !== b.age) return a.local ? -1 : 1;']] },
  { id: 'n5-tie-goes-to-peer', n: 'N5', edits: [['if (a.local !== b.local) return a.local ? -1 : 1;', 'if (a.local !== b.local) return a.local ? 1 : -1;']] },
  { id: 'n6-no-floor-merge', n: 'N6', edits: [['const byKind = (arr, kind) => arr.filter((c) => c.kind === kind);', 'const byKind = (arr, kind) => arr.filter((c) => c.kind === kind && (!newest || c.row === newest.row));']] },
  { id: 'n6-newest-row-time', n: 'N6', edits: [['observed_at: setter ? setter.observed_at : null,', 'observed_at: setter ? Math.max(...newest.row.record.windows.map((w) => w.observed_at)) : null,']] },
  { id: 'n17-peer-tie-lower', n: 'N17', edits: [['if (ua !== ub) return ub - ua;', 'if (ua !== ub) return ua - ub;']] },
  { id: 'n26-estimated-is-measured', n: 'N26', edits: [["const MEASURED_SOURCES = new Set(['passive', 'endpoint', 'probe']);", "const MEASURED_SOURCES = new Set(['passive', 'endpoint', 'probe', 'estimated']);"]] },
  { id: 'n26-estimated-not-raising', n: 'N26', edits: [['for (const k of kinds) { if (eWin[k]) winners.push(eWin[k]); }', '']] },
  { id: 'n26-ok-from-used', n: 'N26', edits: [['const ok = requiredPresent && measuredUsed !== null && used < TIGHT_THRESHOLD;', 'const ok = requiredPresent && used !== null && used < TIGHT_THRESHOLD;']] },
  { id: 'n29-rpm-counts', n: 'N29', edits: [["const USED_KINDS = new Set(['rolling_5h', 'weekly', 'daily', 'monthly', 'credits']);", "const USED_KINDS = new Set(['rolling_5h', 'weekly', 'daily', 'monthly', 'credits', 'rpm', 'tpm']);"]] },
  { id: 'n30-null-reset-is-zero', n: 'N30', edits: [['const resetsAt = isNum(w.resets_at) ? w.resets_at : null;', 'const resetsAt = isNum(w.resets_at) ? w.resets_at : 0;']] },
  { id: 'n30-null-reset-extends-cooldown', n: 'N30', edits: [[' && c.utilization >= TIGHT_THRESHOLD && c.resets_at !== null)', ' && c.utilization >= TIGHT_THRESHOLD)']] },
  { id: 'n34-null-util-is-zero', n: 'N34', edits: [['const util = w.utilization === null ? null : w.utilization;', 'const util = w.utilization === null ? 0 : w.utilization;']] },
  { id: 'n34-empty-balance-not-tight', n: 'N34', edits: [[' || creditsEmpty !== null;', ';']] },
  { id: 'n54-row-presence-is-fresh', n: 'N54', edits: [['age: (x) => nowDomain - hubT(x) };', 'age: () => 0 };']] },
  { id: 'n55-writer-clock-trusted', n: 'N55', edits: [['const hubT = (x) => row.observed_at_hub - (basis - x);', 'const hubT = (x) => x;']] },
  { id: 'n57-required-not-checked', n: 'N57', edits: [['const requiredPresent = required.every((k) => mWin[k]);', 'const requiredPresent = true;']] },
  { id: 'n58-refusal-never-expires', n: 'N58', edits: [['if (age <= MAX_AGE_S && remaining > 0) {', 'if (true) {']] },
  { id: 'n58-low-window-clears-refusal', n: 'N58', edits: [["if (refusal) klass = 'cooling';", "if (refusal && !(used !== null && used < 1)) klass = 'cooling';"]] },
  { id: 'n58-manifest-default-ignored', n: 'N58', edits: [[': defMin * 60;', ': 30 * 60;']] },
  { id: 'n79-writer-clock-trusted', n: 'N79', edits: [['const hubT = (x) => row.observed_at_hub - (basis - x);', 'const hubT = (x) => x;']] },
  { id: 'n79-raw-retry-at', n: 'N79', edits: [['const endsAt = tRef + durS;', 'const endsAt = isNum(rf.retry_at) ? rf.retry_at : tRef + durS;']] },
  { id: 'n80-raw-t-compare', n: 'N80', edits: [
    ['if (a.age !== b.age) return a.age - b.age;', 'if (a.t !== b.t) return b.t - a.t;'],
    ['source: w.source, age, local: clk.local, row,', 'source: w.source, age, t: clk.t(w.observed_at), local: clk.local, row,'],
    ['remaining_s: remaining, age, local: clk.local, utilization: null,', 'remaining_s: remaining, age, t: tRef, local: clk.local, utilization: null,'],
  ] },
  { id: 'n80-hub-offset-ignored', n: 'N80', edits: [['const off = isNum(o.hubOffset) ? o.hubOffset : 0;', 'const off = 0;']] },
  { id: 'n80-resets-vs-local-now', n: 'N80', edits: [['if (resetsAt !== null && resetsAt <= nowC) continue;', 'if (resetsAt !== null && resetsAt <= nowS) continue;']] },
  { id: 'n81-estimated-is-measured', n: 'N81', edits: [["const MEASURED_SOURCES = new Set(['passive', 'endpoint', 'probe']);", "const MEASURED_SOURCES = new Set(['passive', 'endpoint', 'probe', 'estimated']);"]] },
  { id: 'n82-ignore-binding', n: 'N82', edits: [['const peersOk = ns !== null && ns === bound && ns === configured;', 'const peersOk = ns !== null && ns === configured;']] },
  { id: 'n82-no-namespace-check', n: 'N82', edits: [['const peersOk = ns !== null && ns === bound && ns === configured;', 'const peersOk = true;']] },
  { id: 'n86-trust-frame-alone', n: 'N86', edits: [['const peersOk = ns !== null && ns === bound && ns === configured;', 'const peersOk = ns !== null && ns === bound;']] },
  { id: 'n86-no-namespace-check', n: 'N86', edits: [['const peersOk = ns !== null && ns === bound && ns === configured;', 'const peersOk = true;']] },
];

const PLANT = process.env.G40_PLANT || '';
const REAL = PLANT
  ? (() => { const v = VARIANTS.find((x) => x.id === PLANT); assert.ok(v, `unknown G40_PLANT ${PLANT}`); return compile(v.edits, v.id); })()
  : require('./account-interpret');

function control(n, title, scenario) {
  test(`G40-${n} ${title}`, () => {
    scenario(REAL);
    if (PLANT) return; // whole-suite plant mode: the real-vs-variant check is the suite itself
    const vs = VARIANTS.filter((v) => v.n === n);
    assert.ok(vs.length > 0, `no planted variant registered for ${n}`);
    for (const v of vs) {
      const planted = compile(v.edits, v.id); // anchor mismatch must fail the test, not count as red
      assert.throws(() => scenario(planted), (e) => e instanceof assert.AssertionError, `planted variant ${v.id} must be red for ${n}`);
    }
  });
}

// ---- fixtures -------------------------------------------------------------------------------
const NOW = 1_800_000_000;
const MAN = {
  windows: [{ kind: 'rolling_5h', required: true }, { kind: 'weekly', required: false }],
  capture: [{ mode: 'fallback', cooldown_on_429: { default_minutes: 30 } }],
};
const MAN_SILENT = { windows: [{ kind: 'rolling_5h', required: true }] };
const MAN_10 = { windows: [{ kind: 'rolling_5h', required: true }], capture: [{ mode: 'fallback', cooldown_on_429: { default_minutes: 10 } }] };
const MAN_NOREQ = { windows: [{ kind: 'rolling_5h', required: false }] };
const MAN_CREDITS = { windows: [{ kind: 'credits', required: true }] };

function win(kind, util, o) {
  const x = o || {};
  const w = {
    kind, utilization: util, resets_at: x.resets_at === undefined ? NOW + 3600 : x.resets_at,
    source: x.source || 'passive', observed_at: x.observed_at,
  };
  if (x.remaining !== undefined) Object.assign(w, { used: null, limit: null, remaining: x.remaining, unit: 'credits' });
  return w;
}
const REC = { schema: 'fleet.quota/1', provider: 'claude', alias: 'main', visibility: 'L3' };

// local row; windows given with `age` (seconds before NOW on the local clock)
function local(ws, extra) {
  const windows = ws.map(([kind, util, age, o]) => win(kind, util, Object.assign({ observed_at: NOW - age }, o)));
  return { writer_courier: 'local', host_role: 'dev', observed_at_hub: null, skewed: false, record: Object.assign({ windows, refusal: null }, REC, extra) };
}
// peer row; `hubAge` = age of the row basis in the hub domain for a reader with hub offset `off`.
// The writer's own clock is arbitrary (raw stamps are RAW0 - spread), so only translation can judge it.
const RAW0 = NOW - 7777;
function peer(courier, off, hubAge, ws, extra, flags) {
  const windows = ws.map(([kind, util, o]) => win(kind, util, Object.assign({ observed_at: RAW0 }, o)));
  const f = flags || {};
  return {
    writer_courier: courier, host_role: 'laptop', observed_at_hub: NOW + off - hubAge,
    skewed: f.skewed === true, record: Object.assign({ windows, refusal: null }, REC, extra),
  };
}
const run = (m, rows, man, off) => m.interpretWindows(rows, man === undefined ? MAN : man, NOW, { hubOffset: off || 0 });

// ---- controls -------------------------------------------------------------------------------
control('N3', 'a window older than 6 h or more than 5 min in the future is dropped (unknown)', (m) => {
  assert.strictEqual(run(m, [local([['rolling_5h', 0.2, 21600]])]).class, 'ok', 'exactly 6 h is still inside');
  const old = run(m, [local([['rolling_5h', 0.2, 21601]])]);
  assert.strictEqual(old.class, 'unknown');
  assert.strictEqual(old.used, null);
  assert.strictEqual(old.source, 'none');
  assert.strictEqual(run(m, [local([['rolling_5h', 0.2, -300]])]).class, 'ok', 'exactly 300 s ahead is still inside');
  const fut = run(m, [local([['rolling_5h', 0.2, -600]])]);
  assert.strictEqual(fut.class, 'unknown', '10 min in the future');
  assert.strictEqual(fut.used, null);
});

control('N4', 'a window whose resets_at has passed is ignored', (m) => {
  assert.strictEqual(run(m, [local([['rolling_5h', 0.2, 60, { resets_at: NOW }]])]).class, 'unknown', 'resets_at == now is passed');
  assert.strictEqual(run(m, [local([['rolling_5h', 0.2, 60, { resets_at: NOW - 100 }]])]).class, 'unknown');
  assert.strictEqual(run(m, [local([['rolling_5h', 0.2, 60, { resets_at: NOW + 1 }]])]).class, 'ok');
  const tightGone = run(m, [local([['rolling_5h', 0.2, 60], ['weekly', 0.95, 60, { resets_at: NOW - 1 }]])]);
  assert.strictEqual(tightGone.class, 'ok', 'an elapsed tight window no longer makes the alias tight');
});

control('N5', 'newest window wins whichever writer; an exact tie prefers the local writer', (m) => {
  const a = run(m, [local([['rolling_5h', 0.2, 100]]), peer('peerA', 0, 50, [['rolling_5h', 0.5]])]);
  assert.strictEqual(a.used, 0.5, 'newer peer window beats older local');
  assert.strictEqual(a.windows[0].writer_courier, 'peerA');
  const b = run(m, [local([['rolling_5h', 0.2, 50]]), peer('peerA', 0, 100, [['rolling_5h', 0.95]])]);
  assert.strictEqual(b.used, 0.2, 'older tight peer window does not outvote newer local');
  assert.strictEqual(b.class, 'ok');
  const tie = run(m, [peer('peerA', 0, 60, [['rolling_5h', 0.5]]), local([['rolling_5h', 0.2, 60]])]);
  assert.strictEqual(tie.windows[0].writer_courier, 'local', 'exact tie goes to the local row');
  assert.strictEqual(tie.used, 0.2);
});

control('N6', 'missing rolling_5h in the newest row is never 0; the older live window is a floor with its own time', (m) => {
  const rows = [peer('peerA', 0, 10, [['weekly', 0.2]]), local([['rolling_5h', 0.95, 3000]])];
  const r = run(m, rows);
  assert.strictEqual(r.class, 'tight');
  assert.strictEqual(r.used, 0.95);
  assert.ok(r.notes.includes('merged_floor'));
  assert.strictEqual(r.observed_at, NOW - 3000, 'choice.observed_at is the floor window time, not the newest row time');
  assert.strictEqual(r.source, 'passive');
  const five = r.windows.find((w) => w.kind === 'rolling_5h');
  assert.strictEqual(five.utilization, 0.95);
  assert.strictEqual(five.observed_at, NOW - 3000);
  const ok = run(m, [peer('peerA', 0, 10, [['weekly', 0.2]]), local([['rolling_5h', 0.5, 3000]])]);
  assert.strictEqual(ok.class, 'ok');
  assert.strictEqual(ok.used, 0.5);
  const none = run(m, [peer('peerA', 0, 10, [['weekly', 0.2]])]);
  assert.strictEqual(none.class, 'unknown', 'no rolling_5h anywhere: unknown, never ok');
  assert.ok(!none.notes.includes('merged_floor'));
});

control('N17', 'two peers at the same age: the higher utilization wins in either row order', (m) => {
  const hi = peer('peerB', 0, 60, [['rolling_5h', 0.8]]);
  const lo = peer('peerA', 0, 60, [['rolling_5h', 0.3]]);
  for (const rows of [[hi, lo], [lo, hi]]) {
    const r = run(m, rows);
    assert.strictEqual(r.used, 0.8);
    assert.strictEqual(r.windows[0].writer_courier, 'peerB');
  }
});

control('N26', 'an estimated window never yields ok; at 0.90 or above it yields tight', (m) => {
  const only = run(m, [local([['rolling_5h', 0.5, 60, { source: 'estimated' }]])], MAN_NOREQ);
  assert.strictEqual(only.class, 'unknown', 'estimated-only below 0.90 is unknown even with no required window');
  assert.strictEqual(only.used, 0.5, 'it is still the candidate for used');
  const req = run(m, [local([['rolling_5h', 0.1, 60, { source: 'estimated' }]])]);
  assert.strictEqual(req.class, 'unknown');
  const hot = run(m, [local([['rolling_5h', 0.9, 60, { source: 'estimated' }]])], MAN_NOREQ);
  assert.strictEqual(hot.class, 'tight');
  assert.strictEqual(hot.source, 'estimated');
});

control('N29', 'rpm and tpm windows at 1.0 never make an alias tight; weekly 0.95 does', (m) => {
  const th = run(m, [local([['rolling_5h', 0.2, 60], ['rpm', 1.0, 60], ['tpm', 1.0, 60]])]);
  assert.strictEqual(th.class, 'ok');
  assert.strictEqual(th.used, 0.2);
  assert.ok(th.windows.some((w) => w.kind === 'rpm'), 'throttle windows are still reported');
  assert.deepStrictEqual(th.tight_resets, []);
  const wk = run(m, [local([['rolling_5h', 0.2, 60], ['weekly', 0.95, 60]])]);
  assert.strictEqual(wk.class, 'tight');
  assert.deepStrictEqual(wk.tight_resets, [NOW + 3600]);
});

control('N30', 'resets_at null orders normally, never extends a cooldown, and retires by the 6 h rule', (m) => {
  const t = run(m, [local([['rolling_5h', 0.95, 100, { resets_at: null }]])]);
  assert.strictEqual(t.class, 'tight');
  assert.deepStrictEqual(t.tight_resets, []);
  assert.strictEqual(t.windows[0].resets_at, null);
  assert.strictEqual(run(m, [local([['rolling_5h', 0.3, 20000, { resets_at: null }]])]).class, 'ok', 'no clock expiry');
  assert.strictEqual(run(m, [local([['rolling_5h', 0.3, 21601, { resets_at: null }]])]).class, 'unknown', 'age retires it');
});

control('N34', 'null-utilization windows are never ok; an empty balance is tight', (m) => {
  const plenty = run(m, [local([['credits', null, 60, { remaining: 3100 }]])], MAN_CREDITS);
  assert.strictEqual(plenty.class, 'unknown');
  assert.strictEqual(plenty.used, null);
  const empty = run(m, [local([['credits', null, 60, { remaining: 0 }]])], MAN_CREDITS);
  assert.strictEqual(empty.class, 'tight');
  assert.strictEqual(empty.used, null);
  const five = run(m, [local([['rolling_5h', 0.2, 60], ['credits', null, 60, { remaining: 0 }]])]);
  assert.strictEqual(five.class, 'tight', 'exhausted balance wins over a low window');
});

control('N54', 'a peer row is judged by observed_at_hub, not by being present', (m) => {
  const stale = run(m, [peer('peerA', 0, 7 * 3600, [['rolling_5h', 0.2]])]);
  assert.strictEqual(stale.class, 'unknown', 'a re-pushed old row is stale by its hub time');
  assert.strictEqual(stale.used, null);
  assert.strictEqual(run(m, [peer('peerA', 0, 60, [['rolling_5h', 0.2]])]).class, 'ok');
  const mixed = run(m, [peer('peerA', 0, 7 * 3600, [['rolling_5h', 0.95]]), local([['rolling_5h', 0.2, 100]])]);
  assert.strictEqual(mixed.class, 'ok', 'an old tight peer row neither wins nor blocks');
});

control('N55', 'a peer whose writer clock is 1 h behind is judged by hub time and flagged skewed; a local window ahead of the clock is dropped', (m) => {
  const behind = peer('peerA', 0, 30, [['rolling_5h', 0.95, { observed_at: NOW - 30 - 3600 }]], null, { skewed: true });
  const r = run(m, [local([['rolling_5h', 0.2, 120]]), behind]);
  assert.strictEqual(r.class, 'tight');
  assert.strictEqual(r.windows[0].writer_courier, 'peerA');
  assert.strictEqual(r.windows[0].observed_at, NOW - 30 - 3600, 'the writer observed_at travels unchanged');
  assert.deepStrictEqual(r.skewed, ['peerA'], 'flagged, not dropped');
  assert.strictEqual(run(m, [local([['rolling_5h', 0.2, -600]])]).class, 'unknown');
  assert.ok(run(m, [behind], MAN, 400).notes.includes('quota_hub_clock_offset'));
});

control('N57', 'required window must be present, live and fresh for ok', (m) => {
  assert.strictEqual(run(m, [local([['weekly', 0.2, 60]])]).class, 'unknown', 'weekly alone');
  assert.strictEqual(run(m, [local([['weekly', 0.2, 60], ['rolling_5h', 0.1, 60, { resets_at: NOW - 1 }]])]).class, 'unknown', 'rolling_5h elapsed');
  assert.strictEqual(run(m, [local([['weekly', 0.2, 60], ['rolling_5h', 0.1, 21601]])]).class, 'unknown', 'rolling_5h older than 6 h');
  assert.strictEqual(run(m, [local([['weekly', 0.95, 60]])]).class, 'tight', 'weekly 0.95 with rolling_5h missing');
  assert.strictEqual(run(m, [local([['weekly', 0.2, 60], ['rolling_5h', 0.3, 60]])]).class, 'ok');
});

control('N58', 'a kind-less, hint-less refusal cools for the default period, expires, then the windows decide', (m) => {
  const ref = (age, extra) => local([], Object.assign({ visibility: 'L1', refusal: { observed_at: NOW - age, retry_at: null, reason: 'rate_limit' } }, extra));
  const mid = run(m, [ref(60)], MAN_SILENT);
  assert.strictEqual(mid.class, 'cooling');
  assert.strictEqual(mid.refusal.remaining_s, 1800 - 60);
  assert.strictEqual(mid.refusal.reason, 'rate_limit');
  assert.strictEqual(mid.windows.length, 0, 'no window invented');
  assert.strictEqual(run(m, [ref(1799)], MAN_SILENT).class, 'cooling');
  assert.strictEqual(run(m, [ref(1800)], MAN_SILENT).class, 'unknown', 'expired on schedule');
  const after = run(m, [local([['rolling_5h', 0.3, 60]], { refusal: { observed_at: NOW - 1800, retry_at: null, reason: 'quota' } })], MAN_SILENT);
  assert.strictEqual(after.class, 'ok', 'after expiry the class comes from the windows');
  assert.strictEqual(after.refusal, null);
  const lowWin = run(m, [local([['rolling_5h', 0.2, 30]], { refusal: { observed_at: NOW - 60, retry_at: null, reason: 'other' } })]);
  assert.strictEqual(lowWin.class, 'cooling', 'a lower window does not clear a refusal');
  assert.strictEqual(run(m, [ref(11 * 60)], MAN_10).class, 'unknown', 'manifest default_minutes 10 is honoured');
  assert.strictEqual(run(m, [ref(9 * 60)], MAN_10).class, 'cooling');
  const hint = (retryIn) => local([], { visibility: 'L1', refusal: { observed_at: NOW - 100, retry_at: NOW + retryIn, reason: 'rate_limit' } });
  assert.strictEqual(run(m, [hint(50)], MAN_SILENT).refusal.remaining_s, 50);
  assert.strictEqual(run(m, [hint(0)], MAN_SILENT).class, 'unknown', 'retry_at reached');
  const longHint = local([], { visibility: 'L1', refusal: { observed_at: NOW - 21601, retry_at: NOW + 100000, reason: 'quota' } });
  assert.strictEqual(run(m, [longHint], MAN_SILENT).class, 'unknown', 'MAX_AGE_S after observed_at ends it');
});

control('N79', 'a state-only peer row gets its time from observed_at_hub; the refusal ends at the translated time plus its own duration', (m) => {
  const off = 0;
  const hubAge = 30;
  const rawObs = NOW - hubAge - 3600; // writer clock 1 h behind
  const rf = peer('peerA', off, hubAge, [], { visibility: 'L1', refusal: { observed_at: rawObs, retry_at: rawObs + 1200, reason: 'rate_limit' } }, { skewed: true });
  const r = run(m, [rf], MAN_SILENT, off);
  assert.strictEqual(r.class, 'cooling');
  assert.strictEqual(r.refusal.writer_courier, 'peerA');
  assert.strictEqual(r.refusal.ends_at, NOW - hubAge + 1200);
  assert.strictEqual(r.refusal.remaining_s, 1170);
  assert.deepStrictEqual(r.skewed, ['peerA']);
  // refusal-only row has no window stamp: its basis is the refusal's own stamp, so the time exists.
  const inv = peer('peerB', off, 40, [], { visibility: 'L0', token_state: 'invalid', token_state_at: rawObs });
  const both = run(m, [rf, inv], MAN_SILENT, off);
  assert.strictEqual(both.refusal.writer_courier, 'peerA', 'invalid class is P3: a state-only row is ignored here');
});

control('N80', 'ages in one clock domain: windows, resets_at and refusals under hub offsets +600 and -600', (m) => {
  for (const off of [600, -600]) {
    const w = run(m, [local([['rolling_5h', 0.2, 120]]), peer('peerA', off, 30, [['rolling_5h', 0.95]])], MAN, off);
    assert.strictEqual(w.windows[0].writer_courier, 'peerA', `offset ${off}: newer peer window selected`);
    assert.strictEqual(w.class, 'tight', `offset ${off}`);
    assert.strictEqual(w.used, 0.95);
    const nowC = NOW + off;
    const liveL = run(m, [local([['rolling_5h', 0.2, 10, { resets_at: nowC + 1 }]])], MAN, off);
    const goneL = run(m, [local([['rolling_5h', 0.2, 10, { resets_at: nowC - 1 }]])], MAN, off);
    const liveP = run(m, [peer('peerA', off, 10, [['rolling_5h', 0.2, { resets_at: nowC + 1 }]])], MAN, off);
    const goneP = run(m, [peer('peerA', off, 10, [['rolling_5h', 0.2, { resets_at: nowC - 1 }]])], MAN, off);
    assert.deepStrictEqual([liveL.class, goneL.class, liveP.class, goneP.class], ['ok', 'unknown', 'ok', 'unknown'], `offset ${off}: resets_at judged against now+offset for both rows`);
    const localRef = local([], { visibility: 'L1', refusal: { observed_at: NOW - 600, retry_at: NOW - 600 + 660, reason: 'rate_limit' } });
    const peerRef = peer('peerA', off, 30, [], { visibility: 'L1', refusal: { observed_at: RAW0, retry_at: RAW0 + 1230, reason: 'rate_limit' } });
    const rr = run(m, [localRef, peerRef], MAN_SILENT, off);
    assert.strictEqual(rr.class, 'cooling');
    assert.strictEqual(rr.refusal.writer_courier, 'peerA', `offset ${off}: the refusal with the smallest age is taken`);
    assert.strictEqual(rr.refusal.ends_at, (NOW + off - 30) + 1230, 'end = t(refusal.observed_at) + (retry_at - observed_at)');
    assert.strictEqual(rr.refusal.remaining_s, 1200);
    const rrRev = run(m, [peerRef, localRef], MAN_SILENT, off);
    assert.strictEqual(rrRev.refusal.writer_courier, 'peerA', 'row order does not matter');
  }
});

control('N81', 'estimated never replaces or lowers a measured window and never makes a required window present', (m) => {
  const a = run(m, [local([['rolling_5h', 0.95, 100]]), local([['rolling_5h', 0.1, 10, { source: 'estimated' }]])]);
  assert.strictEqual(a.used, 0.95);
  assert.strictEqual(a.class, 'tight');
  assert.ok(a.windows.some((w) => w.source === 'passive' && w.utilization === 0.95), 'measured window is kept');
  const b = run(m, [local([['rolling_5h', 0.1, 10, { source: 'estimated' }], ['weekly', 0.2, 10]])]);
  assert.strictEqual(b.class, 'unknown', 'estimated rolling_5h does not satisfy the required window');
  const c = run(m, [local([['rolling_5h', 0.2, 100]]), local([['rolling_5h', 0.95, 10, { source: 'estimated' }]])]);
  assert.strictEqual(c.class, 'tight');
  assert.strictEqual(c.used, 0.95);
});

const VIEW = (ns, rows, off) => ({ schema: 'fleet.quota-view/1', namespace: ns, hub_offset: off || 0, rows });

control('N82', 'a view stamped for another namespace contributes no peer row but keeps the local row', (m) => {
  const loc = local([['rolling_5h', 0.2, 30]]);
  const pr = peer('peerA', 0, 10, [['rolling_5h', 0.95]]);
  const view = VIEW('A', [loc, pr], 120);
  const sw = m.selectView(view, { boundNamespace: 'B', configuredNamespace: 'A' });
  assert.deepStrictEqual(sw.rows, [loc]);
  assert.deepStrictEqual(sw.notes, ['quota_peer_namespace_mismatch']);
  assert.strictEqual(run(m, sw.rows).class, 'ok', 'the tight peer row is not in the pick input');
  const afterB = m.selectView(VIEW('B', [loc, pr]), { boundNamespace: 'B', configuredNamespace: 'B' });
  assert.deepStrictEqual(afterB.rows, [loc, pr]);
  assert.deepStrictEqual(afterB.notes, []);
  assert.strictEqual(run(m, afterB.rows).class, 'tight');
  assert.strictEqual(sw.hub_offset, 120);
  assert.deepStrictEqual(m.selectView(view, { boundNamespace: null, configuredNamespace: 'A' }).rows, [loc], 'unbound is a mismatch');
  assert.deepStrictEqual(m.selectView(VIEW(null, [loc, pr]), { boundNamespace: null, configuredNamespace: null }).rows, [loc], 'null never equals null');
  assert.deepStrictEqual(m.selectView(view, { boundNamespace: 'B', configuredNamespace: 'A' }).notes, ['quota_peer_namespace_mismatch']);
  assert.deepStrictEqual(m.selectView(VIEW('A', [loc]), { boundNamespace: 'B', configuredNamespace: 'A' }).notes, [], 'no peer row dropped: no note');
});

control('N86', 'configured namespace differs from the frame namespace: no peer row, local row kept', (m) => {
  const loc = local([['rolling_5h', 0.2, 30]]);
  const pr = peer('peerA', 0, 10, [['rolling_5h', 0.95]]);
  const bad = m.selectView(VIEW('B', [loc, pr]), { boundNamespace: 'B', configuredNamespace: 'A' });
  assert.deepStrictEqual(bad.rows, [loc]);
  assert.deepStrictEqual(bad.notes, ['quota_peer_namespace_mismatch']);
  assert.strictEqual(run(m, bad.rows).class, 'ok');
  const good = m.selectView(VIEW('A', [loc, pr]), { boundNamespace: 'A', configuredNamespace: 'A' });
  assert.deepStrictEqual(good.rows, [loc, pr]);
  assert.strictEqual(run(m, good.rows).class, 'tight');
  assert.deepStrictEqual(m.selectView(VIEW('B', [loc, pr]), { boundNamespace: 'B' }).rows, [loc], 'configured unknown fails closed');
});
