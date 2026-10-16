#!/usr/bin/env bash
# BL-0146 D2: incremental binding + seat-store station (src/engine/final-panel-seat-store.js) and the
# gate-journal key part (src/engine/campaign-composition.js incrementalGateKeyParts).
# Every check has a negative control: a mutated COPY of the source (one check removed) is loaded and the
# named assertion must go red (neg_<name>=true means it did). The real sources are never edited.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [root, tmp] = process.argv.slice(2);
const STORE = path.join(root, 'src', 'engine', 'final-panel-seat-store.js');
const COMP = path.join(root, 'src', 'engine', 'campaign-composition.js');
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const { findReusableGate } = require(path.join(root, 'src', 'engine', 'controller-execution'));

const H = (s) => canonicalDigest({ s });
const seat = { runner: 'r', model: 'm', effort: 'e', endpoint: null, family: 'f' };
const files = (pairs) => pairs.map(([p, d]) => ({ path: p, file_digest: H(d) }));
const parts0 = () => ({
  base_sha: 'b'.repeat(40), prior_head: 'a'.repeat(40), prior_tree_sha: 'c'.repeat(40), prior_binding: H('pb'),
  new_head: 'd'.repeat(40), new_tree_sha: 'e'.repeat(40), delta_diff_digest: H('delta'),
  recheck_set: files([['a.js', 'a1'], ['b.js', 'b1']]), carried_set: files([['c.js', 'c1'], ['d.js', 'd1']]),
  carry_packet_digest: H('carry'), spec_digest: H('spec'), review_input_digest: H('rid'),
});
const outcome = () => {
  const verdict = 'approve', findings = '', scope = 'final', tree_sha = 'e'.repeat(40);
  return { reviewed: true, verdict, findings, review_digest: canonicalDigest({ verdict, findings, scope, tree_sha }) };
};

function load(file, mutate, name) {
  let src = fs.readFileSync(file, 'utf8');
  if (mutate) {
    const out = mutate(src);
    if (out === src) throw new Error(`mutation ${name} did not change the source`);
    src = out;
  }
  src = src.replace("require('./product-review-normalizer')", `require(${JSON.stringify(path.join(root, 'src', 'engine', 'product-review-normalizer'))})`);
  const f = path.join(tmp, `${name || 'real'}-seat-store.js`);
  fs.writeFileSync(f, src);
  return require(f);
}

function storeChecks(S0, tag) {
  // a mutated copy that throws instead of missing is still a red (the check did not hold)
  const S = { ...S0, lookupSeat: (c, d) => { try { return S0.lookupSeat(c, d); } catch (_e) { return { action: 'threw' }; } } };
  const r = {};
  const dir = fs.mkdtempSync(path.join(tmp, `seats-${tag}-`));
  const p0 = parts0();
  const bind = (mut) => S.incrementalBinding(canonicalDigest, { ...p0, ...mut });
  const B = bind({});
  const ctxFor = (parts, extra = {}) => ({
    root: dir, campaignId: 'camp', station: S.INCREMENTAL_STATION, treeSha: p0.new_tree_sha,
    seat, seatIndex: 0, packetHash: null, inputBinding: S.incrementalBinding(canonicalDigest, parts),
    incremental: { prior_head: parts.prior_head, new_head: parts.new_head, delta_diff_digest: parts.delta_diff_digest,
      carried_set: parts.carried_set, recheck_set: parts.recheck_set },
    currentFileDigests: new Map(parts.carried_set.map((e) => [e.path, e.file_digest])),
    ...extra,
  });
  const ctx = ctxFor(p0);
  r.binding_is_sha = /^[0-9a-f]{64}$/.test(B || '');
  r.binding_stable_under_set_order = bind({ recheck_set: [...p0.recheck_set].reverse(), carried_set: [...p0.carried_set].reverse() }) === B;
  r.binding_rejects_partial = S.incrementalBinding(canonicalDigest, { ...p0, spec_digest: undefined }) === null;
  // A6: every component of the binding changes the key.
  const muts = {
    base_sha: 'f'.repeat(40), prior_head: '1'.repeat(40), prior_tree_sha: '2'.repeat(40), prior_binding: H('x'),
    new_head: '3'.repeat(40), new_tree_sha: '4'.repeat(40), delta_diff_digest: H('x'), carry_packet_digest: H('x'),
    spec_digest: H('x'), review_input_digest: H('x'),
    recheck_set: files([['a.js', 'a1'], ['b.js', 'b2']]), carried_set: files([['c.js', 'c1'], ['d.js', 'd2']]),
  };
  r.every_component_changes_binding = Object.entries(muts).every(([k, v]) => bind({ [k]: v }) !== B);
  // seat store round trip
  const looked0 = S.lookupSeat(ctx, canonicalDigest);
  r.fresh_lookup_dispatches = looked0.action === 'dispatch';
  S.recordAttempt(ctx, 0);
  r.record_ok = S.recordVerdict(ctx, 1, outcome()) === true;
  const hit = S.lookupSeat(ctx, canonicalDigest);
  r.identical_binding_hits = hit.action === 'reuse' && hit.outcome.review_input_mode === 'incremental_return'
    && hit.outcome.prior_findings_included === false && hit.outcome.full_diff_required === false;
  // each component change misses (different binding => different file)
  r.component_change_misses = Object.entries(muts).every(([k, v]) => {
    const parts = { ...p0, [k]: v };
    return S.lookupSeat(ctxFor(parts), canonicalDigest).action === 'dispatch';
  });
  // same file/binding but the artifact's increment block differs from what the caller derives now
  // (A6: changed delta digest / carried set / prior head under an unchanged directory) => miss
  r.changed_delta_block_misses = S.lookupSeat({ ...ctx, incremental: { ...ctx.incremental, delta_diff_digest: H('other') } }, canonicalDigest).action === 'dispatch';
  r.changed_prior_head_block_misses = S.lookupSeat({ ...ctx, incremental: { ...ctx.incremental, prior_head: '9'.repeat(40) } }, canonicalDigest).action === 'dispatch';
  r.changed_carried_block_misses = S.lookupSeat({ ...ctx, incremental: { ...ctx.incremental, carried_set: files([['c.js', 'c1']]) } }, canonicalDigest).action === 'dispatch';
  // seat tuple
  r.tuple_change_misses = S.lookupSeat({ ...ctx, seat: { ...seat, model: 'other' } }, canonicalDigest).action === 'dispatch';
  // A7: carried path digest at the new head differs => miss; missing map => miss
  const cur = new Map(ctx.currentFileDigests); cur.set('c.js', H('touched-after-review'));
  r.carried_digest_drift_misses = S.lookupSeat({ ...ctx, currentFileDigests: cur }, canonicalDigest).action === 'dispatch';
  r.carried_missing_path_misses = S.lookupSeat({ ...ctx, currentFileDigests: new Map() }, canonicalDigest).action === 'dispatch';
  r.no_digest_map_misses = S.lookupSeat({ ...ctx, currentFileDigests: undefined }, canonicalDigest).action === 'dispatch';
  // station separation: a stored full-round artifact never satisfies an incremental lookup and the reverse.
  const fullCtx = { root: dir, campaignId: 'camp', station: 'final-panel', treeSha: p0.new_tree_sha, seat, seatIndex: 0, packetHash: null, inputBinding: B };
  r.full_station_not_seeded_by_incremental = S.lookupSeat(fullCtx, canonicalDigest).action === 'dispatch';
  const incFile = S.seatFile(ctx);
  const fullFile = S.seatFile(fullCtx);
  fs.mkdirSync(path.dirname(fullFile), { recursive: true });
  fs.copyFileSync(incFile, fullFile); // incremental artifact planted in the full station dir, same binding
  r.incremental_artifact_planted_in_full_misses = S.lookupSeat(fullCtx, canonicalDigest).action === 'dispatch';
  // full artifact planted in the incremental dir
  const dir2 = fs.mkdtempSync(path.join(tmp, `seats2-${tag}-`));
  const fc2 = { ...fullCtx, root: dir2 };
  S.recordAttempt(fc2, 0); S.recordVerdict(fc2, 1, outcome());
  const ic2 = { ...ctx, root: dir2 };
  fs.mkdirSync(path.dirname(S.seatFile(ic2)), { recursive: true });
  fs.copyFileSync(S.seatFile(fc2), S.seatFile(ic2));
  r.full_artifact_planted_in_incremental_misses = S.lookupSeat(ic2, canonicalDigest).action === 'dispatch';
  // incremental write without an increment block refuses to store
  r.record_without_block_refused = S.recordVerdict({ ...ctx, incremental: undefined, root: dir2 }, 1, outcome()) === false;
  // default full path unchanged: no incremental fields, flags as before
  const dir3 = fs.mkdtempSync(path.join(tmp, `seats3-${tag}-`));
  const fc3 = { ...fullCtx, root: dir3 };
  S.recordAttempt(fc3, 0); S.recordVerdict(fc3, 1, outcome());
  const stored = JSON.parse(fs.readFileSync(S.seatFile(fc3), 'utf8'));
  r.full_artifact_has_no_incremental_fields = stored.review_scope === undefined && stored.incremental === undefined;
  const fh = S.lookupSeat(fc3, canonicalDigest);
  r.full_path_flags_unchanged = fh.action === 'reuse' && fh.outcome.review_input_mode === 'full_diff_generation'
    && fh.outcome.prior_findings_included === false && fh.outcome.full_diff_required === true;
  return r;
}

// ---- gate journal key ----
function gateFnFrom(mutate) {
  let src = fs.readFileSync(COMP, 'utf8');
  const a = src.indexOf('function incrementalGateKeyParts(');
  const b = src.indexOf('function stableCandidateGatePayload(');
  let fn = src.slice(a, b);
  if (mutate) { const m = mutate(fn); if (m === fn) throw new Error('gate mutation no-op'); fn = m; }
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isCanonicalSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  return new Function('isObj', 'isCanonicalSha256', `${fn}\nreturn incrementalGateKeyParts;`)(isObj, isCanonicalSha256);
}
function gateChecks(keyParts) {
  const r = {};
  const base = { owner: 'depth-0', generation: 1, candidate_ref: 'x', diff_digest: H('d') };
  // use the real gateInputDigest through recordGateEntry
  const { recordGateEntry, emptyGateJournal } = require(path.join(root, 'src', 'engine', 'controller-execution'));
  const rec = (input) => recordGateEntry(emptyGateJournal(), {
    kind: 'full_diff_review', owner: 'depth-0', input, result: { success: true }, startedAt: 't', finishedAt: 't',
  }).journal;
  const incPrep = (b) => ({ review_input_mode: 'incremental_return', incremental_binding: b });
  const fullInput = { ...base, ...keyParts({ review_input_mode: 'full_diff_generation' }) };
  const incInput = (b) => ({ ...base, ...keyParts(incPrep(b)) });
  const B1 = H('b1'), B2 = H('b2');
  r.default_key_unchanged = JSON.stringify(fullInput) === JSON.stringify(base);
  r.full_entry_not_reused_by_incremental = findReusableGate(rec(fullInput), 'full_diff_review', incInput(B1)) === null;
  r.incremental_entry_not_reused_by_full = findReusableGate(rec(incInput(B1)), 'full_diff_review', fullInput) === null;
  r.other_binding_not_reused = findReusableGate(rec(incInput(B1)), 'full_diff_review', incInput(B2)) === null;
  r.same_binding_reused = findReusableGate(rec(incInput(B1)), 'full_diff_review', incInput(B1)) !== null;
  return r;
}

const real = storeChecks(load(STORE, null, 'real'), 'real');
const realGate = gateChecks(gateFnFrom(null));
const out = { ...Object.fromEntries(Object.entries(real).map(([k, v]) => [`ok_${k}`, v])),
  ...Object.fromEntries(Object.entries(realGate).map(([k, v]) => [`ok_gate_${k}`, v])) };

// negative controls: (mutation, check that must go false)
const NEG = {
  tuple: [(s) => s.replace("|| !tupleEqual(artifact.seat, seatTuple(expect.seat))) {", ') {'), 'tuple_change_misses'],
  incremental_block: [(s) => s.replace('|| canonicalDigest(want) !== canonicalDigest(have)) return null;', ') return null;'), 'changed_delta_block_misses'],
  carried_digest_recheck: [(s) => s.replace('if (current.get(entry.path) !== entry.file_digest) return null;', ''), 'carried_digest_drift_misses'],
  no_digest_map: [(s) => s.replace('if (!(current instanceof Map)) return null;', ''), 'no_digest_map_misses'],
  station_scope: [(s) => s.replace("artifact.review_scope !== 'incremental' || !want || !have\n        || canonicalDigest(want) !== canonicalDigest(have)", 'false').replace('const have = artifact.incremental;', 'const have = artifact.incremental || { carried_set: [] };').replace('|| artifact.station !== expect.station', ''), 'full_artifact_planted_in_incremental_misses'],
  full_rejects_incremental: [(s) => s.replace("} else if (artifact.review_scope !== undefined || artifact.incremental !== undefined) {\n    return null;\n  }", '}').replace('|| artifact.station !== expect.station', ''), 'incremental_artifact_planted_in_full_misses'],
  binding_tree_only: [(s) => s.replace(/return canonicalDigest\(\{\n    mode: 'incremental',[\s\S]*?\n  \}\);/, 'return canonicalDigest({ new_tree_sha: parts.new_tree_sha });'), 'every_component_changes_binding'],
  refuse_no_block: [(s) => s.replace('if (isIncrementalStation(ctx.station) && !incrementalBlock(ctx)) return false;', ''), 'record_without_block_refused'],
};
for (const [name, [mut, check]] of Object.entries(NEG)) {
  const res = storeChecks(load(STORE, mut, `neg-${name}`), `neg-${name}`);
  out[`neg_${name}`] = res[check] === false;
}
const gateNeg = gateChecks(gateFnFrom((fn) => fn.replace(/return \{\n    review_input_mode: 'incremental_return',[\s\S]*?\n  \};/, 'return {};')));
out.neg_gate_key = gateNeg.full_entry_not_reused_by_incremental === false;
console.log(JSON.stringify(out));
NODE
)"

while IFS= read -r line; do
  assert_eq "${line#*=}" "true" "${line%%=*}"
done < <(printf '%s' "$OUT" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const k in o)console.log(k+"="+o[k])')
[ -n "$OUT" ] || fail "node produced no output"
finalize_test
