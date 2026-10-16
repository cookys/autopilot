#!/usr/bin/env bash
# BL-0146 D4: wiring of the incremental return review (src/engine/review-increment-wiring.js) and the
# refusals D4 owes earlier deliverables:
#   item 1  an incremental_return gate key without a canonical binding is refused (no shared sentinel)
#   item 2  currentFileDigests is re-derived from Git at the wiring, never taken from the caller
#   item 3  duplicate paths, a path in both sets, or a null binding are refused (fall back to full)
# plus the decision's own fail-closed branches. Every check has a negative control: a mutated COPY of the
# source (one guard removed) is loaded and the named assertion must go red (neg_<name>=true means it did).
# The real sources are never edited. Item 6 (resolution evidence / quorum / seat map) is pinned, with its own
# negative controls, in review-resolution-closure.test.sh.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const eng = (f) => path.join(root, 'src', 'engine', f);
const { canonicalDigest } = require(eng('campaign-verification'));

const H = (s) => canonicalDigest({ s });
const abs = (src) => src
  .replace("require('./review-increment')", `require(${JSON.stringify(eng('review-increment'))})`)
  .replace("require('./final-panel-seat-store')", `require(${JSON.stringify(eng('final-panel-seat-store'))})`)
  .replace("require('./product-review-normalizer')", `require(${JSON.stringify(eng('product-review-normalizer'))})`);
function load(file, mutate, name) {
  let src = fs.readFileSync(eng(file), 'utf8');
  if (mutate) {
    const out = mutate(src);
    if (out === src) throw new Error(`mutation ${name} did not change the source`);
    src = out;
  }
  const f = path.join(tmp, `${name}-${file}`);
  fs.writeFileSync(f, abs(src));
  return require(f);
}

// ---- item 1: gate key ------------------------------------------------------------------------------------
function gateFnFrom(mutate) {
  let src = fs.readFileSync(eng('campaign-composition.js'), 'utf8');
  const a = src.indexOf('function incrementalGateKeyParts(');
  const b = src.indexOf('function stableCandidateGatePayload(');
  let fn = src.slice(a, b);
  if (mutate) { const m = mutate(fn); if (m === fn) throw new Error('gate mutation no-op'); fn = m; }
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isCanonicalSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  class CampaignCompositionError extends Error { constructor(code, m) { super(m); this.code = code; } }
  return new Function('isObj', 'isCanonicalSha256', 'CampaignCompositionError', `${fn}\nreturn incrementalGateKeyParts;`)(isObj, isCanonicalSha256, CampaignCompositionError);
}
function gateChecks(parts) {
  const r = {};
  const throwsCode = (v) => { try { parts(v); return null; } catch (e) { return e.code || 'threw'; } };
  r.unbound_refused = throwsCode({ review_input_mode: 'incremental_return' }) === 'INCREMENTAL_BINDING_MISSING';
  r.malformed_binding_refused = throwsCode({ review_input_mode: 'incremental_return', incremental_binding: 'unbound-incremental' }) === 'INCREMENTAL_BINDING_MISSING'
    && throwsCode({ review_input_mode: 'incremental_return', incremental_binding: 'abc' }) === 'INCREMENTAL_BINDING_MISSING';
  const ok = parts({ review_input_mode: 'incremental_return', incremental_binding: H('b') });
  r.canonical_binding_kept = ok.review_input_mode === 'incremental_return' && ok.incremental_binding === H('b');
  r.default_key_empty = JSON.stringify(parts({ review_input_mode: 'full_diff_generation' })) === '{}';
  return r;
}

// ---- item 3 / binding: duplicate and overlapping paths ------------------------------------------------------
const files = (pairs) => pairs.map(([p, d]) => ({ path: p, file_digest: H(d) }));
const parts0 = () => ({
  base_sha: 'b'.repeat(40), prior_head: 'a'.repeat(40), prior_tree_sha: 'c'.repeat(40), prior_binding: H('pb'),
  new_head: 'd'.repeat(40), new_tree_sha: 'e'.repeat(40), delta_diff_digest: H('delta'),
  recheck_set: files([['a.js', 'a1'], ['b.js', 'b1']]), carried_set: files([['c.js', 'c1'], ['d.js', 'd1']]),
  carry_packet_digest: H('carry'), spec_digest: H('spec'), review_input_digest: H('rid'),
});
function bindingChecks(S) {
  const r = {};
  const p = parts0();
  r.baseline_binding = /^[0-9a-f]{64}$/.test(S.incrementalBinding(canonicalDigest, p) || '');
  r.duplicate_in_recheck_refused = S.incrementalBinding(canonicalDigest, { ...p, recheck_set: files([['a.js', 'a1'], ['a.js', 'a2']]) }) === null;
  r.duplicate_in_carried_refused = S.incrementalBinding(canonicalDigest, { ...p, carried_set: files([['c.js', 'c1'], ['c.js', 'c1']]) }) === null;
  r.path_in_both_sets_refused = S.incrementalBinding(canonicalDigest, { ...p, carried_set: files([['a.js', 'a1'], ['d.js', 'd1']]) }) === null;
  return r;
}

// ---- items 2 and the decision: a real throwaway repo + real seat artifacts --------------------------------------
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function makeRepo(tag) {
  const repo = path.join(tmp, `repo-${tag}`);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q']);
  git(repo, 'config', 'user.email', 'w@example.invalid'); git(repo, 'config', 'user.name', 'W');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'README'), 'base\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  for (const n of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(repo, 'src', `${n}.txt`), `${n} payload\n`);
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), 'external\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'range');
  const head0 = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), 'external-2\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'fix');
  const head1 = git(repo, 'rev-parse', 'HEAD');
  return { repo, base, head0, head1, tree0: git(repo, 'rev-parse', `${head0}^{tree}`), tree1: git(repo, 'rev-parse', `${head1}^{tree}`) };
}
const sha256 = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex');
const seatsList = [
  { runner: 'r', model: 'm1', effort: 'e', endpoint: null, family: 'f1' },
  { runner: 'r', model: 'm2', effort: 'e', endpoint: null, family: 'f2' },
];

function decisionChecks(W, S, tag) {
  const r = {};
  const R = makeRepo(tag);
  const rangeDiff0 = execFileSync('git', ['-C', R.repo, 'diff', '--no-ext-diff', '--no-textconv', `${R.base}..${R.head0}`]);
  const specDigest = H('spec');
  const reviewInputDigest0 = H('rid0');
  const binding0 = canonicalDigest({
    candidate_tree_sha: R.tree0, base_sha: R.base, diff_digest: sha256(rangeDiff0), spec_digest: specDigest, review_input_digest: reviewInputDigest0,
  });
  const finding = JSON.stringify([{ finding_id: 'rc-001', claim: 'src/value.txt:1 planted defect', severity: '🔴', source: 'product-review' }]);
  const seedRoot = (name, { skipSeat2 = false, mode = 'full', recordDiff = sha256(rangeDiff0), extraFind = null } = {}) => {
    const root2 = fs.mkdtempSync(path.join(tmp, `store-${tag}-${name}-`));
    const seatCtx = (seat, i) => ({
      root: root2, campaignId: 'camp', station: 'panel', treeSha: R.tree0, packetHash: null, inputBinding: binding0, seat, seatIndex: i,
    });
    seatsList.forEach((seat, i) => {
      if (skipSeat2 && i === 1) return;
      const verdict = 'FIX-THEN-SHIP';
      const out = { reviewed: true, verdict, findings: extraFind || finding,
        review_digest: canonicalDigest({ verdict, findings: extraFind || finding, scope: 'final', tree_sha: R.tree0 }) };
      S.recordAttempt(seatCtx(seat, i), 0);
      S.recordVerdict(seatCtx(seat, i), 1, out);
    });
    W.writeRoundRecord({ root: root2, campaignId: 'camp', record: {
      head: R.head0, mode, tree_sha: R.tree0, base_sha: R.base, diff_digest: recordDiff, spec_digest: specDigest,
      review_input_digest: reviewInputDigest0, binding: recordDiff === sha256(rangeDiff0) ? binding0 : canonicalDigest({
        candidate_tree_sha: R.tree0, base_sha: R.base, diff_digest: recordDiff, spec_digest: specDigest, review_input_digest: reviewInputDigest0,
      }), roster_digest: H('roster'), verify_argv_hash: H('argv'),
    } });
    return root2;
  };
  const args = (root2, extra = {}) => ({
    repo: R.repo, baseSha: R.base, priorHead: R.head0, newHead: R.head1, newTreeSha: R.tree1,
    returnReview: 'incremental', stationIsPanel: true, rosterDigest: H('roster'), specDigest, reviewInputDigest: H('rid1'),
    verificationGreen: true, verifyCmd: 'true', currentArgvHash: H('argv'),
    seats: seatsList, storeRoot: root2, campaignId: 'camp', canonicalDigest,
    priorDerived: { tree_sha: R.tree0, diff_digest: sha256(rangeDiff0) },
    ...extra,
  });
  const ok = W.decideReturnIncrement(args(seedRoot('ok')));
  r.decides_incremental = ok.mode === 'incremental' && /^[0-9a-f]{64}$/.test(ok.binding || '')
    && ok.increment.carried.length === 4 && ok.increment.recheck.map((e) => e.path).join() === 'src/value.txt';
  r.opt_in_off_is_full = W.decideReturnIncrement(args(seedRoot('off'), { returnReview: 'full' })).reason === 'opt_in_off';
  r.non_panel_station_full = W.decideReturnIncrement(args(seedRoot('np'), { stationIsPanel: false })).reason === 'station_not_panel';
  r.unknown_prior_round_full = W.decideReturnIncrement(args(fs.mkdtempSync(path.join(tmp, `empty-${tag}-`)))).reason === 'prior_round_unknown';
  r.prior_incremental_full = W.decideReturnIncrement(args(seedRoot('pi', { mode: 'incremental' }))).reason === 'prior_round_incremental';
  r.record_diff_mismatch_full = W.decideReturnIncrement(args(seedRoot('rd', { recordDiff: H('forged') }))).reason === 'prior_round_unverified';
  r.mixed_round_full = W.decideReturnIncrement(args(seedRoot('mix', { skipSeat2: true }))).reason === 'seat_not_carriable';
  r.unmappable_finding_full = W.decideReturnIncrement(args(seedRoot('um', { extraFind: JSON.stringify([{ finding_id: 'x1', claim: 'no location here', severity: '🔴', source: 'product-review' }]) }))).reason === 'finding_unmapped';
  // item 3: the decision refuses (falls back to full) when D1 returns sets the binding rejects.
  const dupEvaluate = (input) => {
    const real = require(eng('review-increment')).evaluateReturnIncrement(input);
    return real.mode === 'incremental' ? { ...real, recheck: [...real.recheck, real.recheck[0]] } : real;
  };
  const dup = W.decideReturnIncrement(args(seedRoot('dup'), { evaluate: dupEvaluate }));
  r.duplicate_path_set_full = dup.mode === 'full' && dup.reason === 'binding_unavailable';
  // item 2: the seat context's digests come from Git at the wiring, whatever the caller supplies.
  const ctxArgs = {
    repo: R.repo, baseSha: R.base, root: seedRoot('ctx'), campaignId: 'camp', treeSha: R.tree1, packetHash: null, seat: seatsList[0], seatIndex: 0,
    currentFileDigests: new Map(ok.binding_parts.carried_set.map((e) => [e.path, e.file_digest])), // a stale/forged map
  };
  fs.writeFileSync(path.join(R.repo, 'src', 'a.txt'), 'a changed after the review\n');
  git(R.repo, 'add', '.'); git(R.repo, 'commit', '-qm', 'author touched a carried file');
  const moved = git(R.repo, 'rev-parse', 'HEAD');
  const decisionMoved = { ...ok, binding_parts: { ...ok.binding_parts, new_head: moved } };
  const seatCtx = W.incrementalSeatContext(decisionMoved, ctxArgs);
  const carriedA = ok.binding_parts.carried_set.find((e) => e.path === 'src/a.txt');
  r.seat_context_digests_from_git = seatCtx.currentFileDigests instanceof Map
    && seatCtx.currentFileDigests.get('src/a.txt') !== carriedA.file_digest;
  // and the seat store then refuses to reuse a carried verdict for that path (A7 end to end)
  const root3 = seedRoot('reuse');
  const reuseCtx = W.incrementalSeatContext(ok, { ...ctxArgs, root: root3 });
  const out = { reviewed: true, verdict: 'SHIP-AS-IS', findings: '[]',
    review_digest: canonicalDigest({ verdict: 'SHIP-AS-IS', findings: '[]', scope: 'final', tree_sha: R.tree1 }) };
  S.recordAttempt(reuseCtx, 0); S.recordVerdict(reuseCtx, 1, out);
  r.fresh_ctx_reuses_when_unchanged_before = S.lookupSeat(reuseCtx, canonicalDigest).action === 'reuse';
  return r;
}

const real = {
  W: load('review-increment-wiring.js', null, 'real'),
  S: load('final-panel-seat-store.js', null, 'real'),
};
const out = {};
for (const [k, v] of Object.entries(gateChecks(gateFnFrom(null)))) out[`gate_${k}`] = v;
for (const [k, v] of Object.entries(bindingChecks(real.S))) out[`binding_${k}`] = v;
for (const [k, v] of Object.entries(decisionChecks(real.W, real.S, 'real'))) out[`decision_${k}`] = v;

// negative controls
const NEG_GATE = {
  sentinel_back: [(fn) => fn.replace(/if \(!isCanonicalSha256\(preparedReview\.incremental_binding\)\) \{ \/\/ guard:unbound_incremental[\s\S]*?\n  \}\n/, ''), 'unbound_refused'],
};
for (const [name, [mut, check]] of Object.entries(NEG_GATE)) {
  out[`neg_gate_${name}`] = gateChecks(gateFnFrom(mut))[check] === false;
}
const NEG_STORE = {
  duplicate_path: [(s) => s.replace('if (seen.has(entry.path)) return null; // guard:duplicate_path', ''), 'duplicate_in_recheck_refused'],
  set_overlap: [(s) => s.replace('if (setsOverlap(recheck, carried)) return null; // guard:set_overlap', ''), 'path_in_both_sets_refused'],
};
for (const [name, [mut, check]] of Object.entries(NEG_STORE)) {
  out[`neg_binding_${name}`] = bindingChecks(load('final-panel-seat-store.js', mut, `neg-${name}`))[check] === false;
}
const NEG_W = {
  null_binding: [(s) => s.replace("if (binding === null) return full('binding_unavailable');", ''), 'duplicate_path_set_full'],
  mixed_round: [(s) => s.replace("if (priorSeats.some((seat) => !seat.carriable)) return full('seat_not_carriable');", ''), 'mixed_round_full'],
  prior_incremental: [(s) => s.replace(/if \(record\.mode !== 'full'\n\s*\|\| incrementalArtifactReviewed\(\{ root: storeRoot, campaignId, head: priorHead \}\)\) \{ \/\/ guard:prior_incremental\n\s*return full\('prior_round_incremental'\);\n\s*\}/, ''), 'prior_incremental_full'],
  record_unverified: [(s) => s.replace('|| record.diff_digest !== priorDerived.diff_digest', ''), 'record_diff_mismatch_full'],
  git_digests: [(s) => s.replace('currentFileDigests: computeFileDigests(repo, baseSha, parts.new_head),', 'currentFileDigests: ctx.currentFileDigests,'), 'seat_context_digests_from_git'],
};
for (const [name, [mut, check]] of Object.entries(NEG_W)) {
  const W2 = load('review-increment-wiring.js', mut, `neg-w-${name}`);
  out[`neg_decision_${name}`] = decisionChecks(W2, real.S, `neg-${name}`)[check] === false;
}
console.log(JSON.stringify(out));
NODE
)"
[ -n "$OUT" ] || fail "node produced no output"
while IFS= read -r line; do
  assert_eq "${line#*=}" "true" "${line%%=*}"
done < <(printf '%s' "$OUT" | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const k in o)console.log(k+"="+o[k])')
finalize_test
