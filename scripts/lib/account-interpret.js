'use strict';

// scripts/lib/account-interpret.js — pure interpretation of a quota mirror view (G40 plan 5.2, 8.3,
// 8.4, 11, 21.2, 21.8, 22.2 namespace binding, 22.3). No fs, no clock: `nowS` (local epoch seconds)
// and `opts.hubOffset` (hub clock minus local clock, seconds) are parameters. Rows are plain
// objects: { writer_courier, host_role, observed_at_hub, skewed, record } with `record` a
// fleet.quota/1 record. The module does not validate records (that is account-observation.js, D1);
// it skips what it cannot read as a window.
//
// Only AGES are compared (plan 5.2 rule 2, N80): a local stamp has age `nowS - t`, a peer stamp has
// age `(nowS + hubOffset) - t` where t is the stamp's hub time `observed_at_hub - (B - x)` and B is
// the row basis (largest stamp in the record). A raw local t is never compared with a hub t.
//
// Refusal times: `refusal.ends_at` is on the local clock for a local row and on the hub clock for a
// peer row, so consumers (D3) must use `refusal.remaining_s` (already relative to the right now), never
// compare ends_at with their own clock.
//
// invalid class (token state, plan 5.6) is out of scope for P1 and is not implemented here.
// Node >= 20.10, built-ins only.

const MAX_AGE_S = 21600;
const FUTURE_SKEW_S = 300;
const TIGHT_THRESHOLD = 0.90;
const DEFAULT_COOLDOWN_MINUTES = 30;
const HUB_OFFSET_NOTE_S = 300;

const MEASURED_SOURCES = new Set(['passive', 'endpoint', 'probe']);
const USED_KINDS = new Set(['rolling_5h', 'weekly', 'daily', 'monthly', 'credits']);

function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }

function recordStamps(rec) {
  const out = [];
  if (Array.isArray(rec.windows)) {
    for (const w of rec.windows) if (w && isNum(w.observed_at)) out.push(w.observed_at);
  }
  if (rec.refusal && isNum(rec.refusal.observed_at)) out.push(rec.refusal.observed_at);
  if (isNum(rec.token_state_at)) out.push(rec.token_state_at);
  return out;
}

// Per-row clock translator. A row whose observed_at_hub is not a number is a local row (judged by
// the local clock); any other row is a peer row (judged by its hub time).
function makeClock(row, nowS, off) {
  const stamps = recordStamps(row.record);
  const basis = stamps.length ? Math.max(...stamps) : null;
  if (!isNum(row.observed_at_hub) || basis === null) {
    return { local: true, basis, nowDomain: nowS, t: (x) => x, age: (x) => nowS - x };
  }
  const hubT = (x) => row.observed_at_hub - (basis - x);
  const nowDomain = nowS + off;
  return { local: false, basis, nowDomain, t: hubT, age: (x) => nowDomain - hubT(x) };
}

// Newer-first ordering of two candidates {age, local, utilization, writer_courier}: smallest age
// wins; an exact tie goes to the local row; a tie between two peers goes to the higher utilization.
function newerFirst(a, b) {
  if (a.age !== b.age) return a.age - b.age;
  if (a.local !== b.local) return a.local ? -1 : 1;
  const ua = isNum(a.utilization) ? a.utilization : -Infinity;
  const ub = isNum(b.utilization) ? b.utilization : -Infinity;
  if (ua !== ub) return ub - ua;
  const wa = String(a.writer_courier);
  const wb = String(b.writer_courier);
  return wa < wb ? -1 : wa > wb ? 1 : 0; // code-point order, locale-independent
}

function best(list) {
  let cur = null;
  for (const c of list) if (cur === null || newerFirst(c, cur) < 0) cur = c;
  return cur;
}

function defaultCooldownMinutes(manifest) {
  const caps = manifest && Array.isArray(manifest.capture) ? manifest.capture : [];
  for (const c of caps) {
    const m = c && c.cooldown_on_429 && c.cooldown_on_429.default_minutes;
    if (isNum(m) && m > 0) return m;
  }
  return DEFAULT_COOLDOWN_MINUTES;
}

function requiredKinds(manifest) {
  const ws = manifest && Array.isArray(manifest.windows) ? manifest.windows : [];
  return ws.filter((w) => w && w.required === true).map((w) => w.kind);
}

// Returns { state, class, used, source, observed_at, windows, tight_resets, refusal, skewed, notes }.
// refusal: null or { observed_at, retry_at, reason, writer_courier, age_s, ends_at, remaining_s };
// ends_at is local-clock for a local row and hub-clock for a peer row, remaining_s is the portable
// value. notes is de-duplicated.
function interpretWindows(rows, manifest, nowS, opts) {
  if (!isNum(nowS)) throw new TypeError('interpretWindows: nowS must be a finite number');
  const o = opts || {};
  const off = isNum(o.hubOffset) ? o.hubOffset : 0;
  const nowC = nowS + off; // server absolute time, one domain for local and peer rows
  const noteSet = new Set();
  const skewed = [];
  const measured = [];
  const estimated = [];
  const refusals = [];
  const liveKindsByRow = new Map();
  const defMin = defaultCooldownMinutes(manifest);
  const list = Array.isArray(rows) ? rows : [];
  if (Math.abs(off) > HUB_OFFSET_NOTE_S) noteSet.add('quota_hub_clock_offset');

  for (const row of list) {
    if (!row || typeof row !== 'object' || !row.record || typeof row.record !== 'object') continue;
    const rec = row.record;
    const clk = makeClock(row, nowS, off);
    if (row.skewed === true && !skewed.includes(row.writer_courier)) skewed.push(row.writer_courier);
    const liveKinds = new Set();
    liveKindsByRow.set(row, liveKinds);

    for (const w of Array.isArray(rec.windows) ? rec.windows : []) {
      if (!w || typeof w !== 'object' || !isNum(w.observed_at)) continue;
      const util = w.utilization === null ? null : w.utilization;
      if (util !== null && !(isNum(util) && util >= 0 && util <= 1)) { noteSet.add('quota_window_unreadable'); continue; }
      const isMeasured = MEASURED_SOURCES.has(w.source);
      if (!isMeasured && w.source !== 'estimated') { noteSet.add('quota_window_unreadable'); continue; }
      const age = clk.age(w.observed_at);
      if (age > MAX_AGE_S) continue;
      if (age < -FUTURE_SKEW_S) continue;
      const resetsAt = isNum(w.resets_at) ? w.resets_at : null;
      if (resetsAt !== null && resetsAt <= nowC) continue;
      const cand = {
        kind: w.kind, utilization: util, remaining: isNum(w.remaining) ? w.remaining : null,
        resets_at: resetsAt, observed_at: w.observed_at, writer_courier: row.writer_courier,
        source: w.source, age, local: clk.local, row,
      };
      (isMeasured ? measured : estimated).push(cand);
      if (isMeasured) liveKinds.add(w.kind);
    }

    const rf = rec.refusal;
    if (rf && typeof rf === 'object' && isNum(rf.observed_at)) {
      const tRef = clk.t(rf.observed_at);
      const durS = isNum(rf.retry_at) ? rf.retry_at - rf.observed_at : defMin * 60;
      const endsAt = tRef + durS;
      const age = clk.age(rf.observed_at);
      // Capped at the refusal's own duration: a stamp written in the future cannot extend cooling.
      const remaining = Math.min(endsAt - clk.nowDomain, durS);
      if (age <= MAX_AGE_S && remaining > 0) {
        refusals.push({
          observed_at: rf.observed_at, retry_at: isNum(rf.retry_at) ? rf.retry_at : null,
          reason: rf.reason, writer_courier: row.writer_courier, age_s: age, ends_at: endsAt,
          remaining_s: remaining, age, local: clk.local, utilization: null,
        });
      }
    }
  }

  // Newest row = smallest basis age (rows with no stamp never qualify).
  let newest = null;
  for (const row of list) {
    if (!row || !row.record || typeof row.record !== 'object') continue;
    const clk = makeClock(row, nowS, off);
    if (clk.basis === null) continue;
    const c = { age: clk.age(clk.basis), local: clk.local, utilization: null, writer_courier: row.writer_courier, row };
    if (newest === null || newerFirst(c, newest) < 0) newest = c;
  }

  const byKind = (arr, kind) => arr.filter((c) => c.kind === kind);
  const kinds = [...new Set([...measured, ...estimated].map((c) => c.kind))];
  const mWin = {};
  const eWin = {};
  for (const k of kinds) {
    mWin[k] = best(byKind(measured, k));
    eWin[k] = best(byKind(estimated, k));
    if (mWin[k] && newest && mWin[k].row !== newest.row) {
      const nk = liveKindsByRow.get(newest.row);
      if (nk && !nk.has(k) && !noteSet.has('merged_floor')) noteSet.add('merged_floor');
    }
  }

  const winners = [];
  for (const k of kinds) { if (mWin[k]) winners.push(mWin[k]); }
  for (const k of kinds) { if (eWin[k]) winners.push(eWin[k]); }

  // used = max utilization over live windows of the used kinds; estimates only raise it (rule 4).
  let usedWin = null;
  let measuredUsed = null;
  for (const c of winners) {
    if (!USED_KINDS.has(c.kind) || !isNum(c.utilization)) continue;
    if (usedWin === null || c.utilization > usedWin.utilization) usedWin = c;
    if (MEASURED_SOURCES.has(c.source) && (measuredUsed === null || c.utilization > measuredUsed)) measuredUsed = c.utilization;
  }
  const used = usedWin ? usedWin.utilization : null;

  const creditsEmpty = winners.find((c) => c.kind === 'credits' && c.utilization === null && c.remaining === 0) || null;
  const tight = (used !== null && used >= TIGHT_THRESHOLD) || creditsEmpty !== null;
  const required = requiredKinds(manifest);
  const requiredPresent = required.every((k) => mWin[k]);
  const ok = requiredPresent && measuredUsed !== null && used < TIGHT_THRESHOLD;

  const refusal = best(refusals);
  let klass = 'unknown';
  if (refusal) klass = 'cooling';
  else if (tight) klass = 'tight';
  else if (ok) klass = 'ok';

  const setter = usedWin || creditsEmpty;
  const tightResets = [...new Set(winners
    .filter((c) => USED_KINDS.has(c.kind) && isNum(c.utilization) && c.utilization >= TIGHT_THRESHOLD && c.resets_at !== null)
    .map((c) => c.resets_at))].sort((a, b) => a - b);

  return {
    state: (used !== null || tight || refusal) ? 'known' : 'unknown',
    class: klass,
    used,
    source: setter ? setter.source : 'none',
    observed_at: setter ? setter.observed_at : null,
    windows: winners.map((c) => ({
      kind: c.kind, utilization: c.utilization, resets_at: c.resets_at,
      observed_at: c.observed_at, writer_courier: c.writer_courier, source: c.source,
    })),
    tight_resets: tightResets,
    refusal: refusal ? {
      observed_at: refusal.observed_at, retry_at: refusal.retry_at, reason: refusal.reason,
      writer_courier: refusal.writer_courier, age_s: refusal.age_s, ends_at: refusal.ends_at,
      remaining_s: refusal.remaining_s,
    } : null,
    skewed,
    notes: [...noteSet],
  };
}

// Namespace binding (plan 22.2, N82, N86). `view` is a fleet.quota-view/1 object. Peer rows count
// only when the view's namespace, the bound namespace (namespace.json) and the courier's configured
// namespace are all non-null and equal; otherwise every peer row is ignored (note
// quota_peer_namespace_mismatch) and the local row (observed_at_hub null) is kept.
function selectView(view, binding) {
  const v = view && typeof view === 'object' ? view : {};
  const b = binding || {};
  const rows = Array.isArray(v.rows) ? v.rows : [];
  const hubOffset = isNum(v.hub_offset) ? v.hub_offset : 0;
  const ns = typeof v.namespace === 'string' && v.namespace ? v.namespace : null;
  const bound = typeof b.boundNamespace === 'string' && b.boundNamespace ? b.boundNamespace : null;
  const configured = typeof b.configuredNamespace === 'string' && b.configuredNamespace ? b.configuredNamespace : null;
  const peersOk = ns !== null && ns === bound && ns === configured;
  const isLocal = (r) => !r || !isNum(r.observed_at_hub);
  if (peersOk) return { rows: rows.slice(), notes: [], hub_offset: hubOffset };
  const kept = rows.filter(isLocal);
  const notes = kept.length < rows.length ? ['quota_peer_namespace_mismatch'] : [];
  return { rows: kept, notes, hub_offset: hubOffset };
}

module.exports = {
  interpretWindows, selectView,
  MAX_AGE_S, FUTURE_SKEW_S, TIGHT_THRESHOLD, DEFAULT_COOLDOWN_MINUTES,
};
