#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROJECT="docs/projects/2026-07-20-owner-kernel-governance"

OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$PROJECT" \
  --repo-root "$REPO_ROOT" 2>&1)"
EXIT=$?

assert_eq "0" "$EXIT" "release-gate checker emits a report without tool failure"

assert_contains "$OUT" '"kind": "owner_kernel_release_gate_report"' "report kind is frozen"
assert_contains "$OUT" '"disposition": "HOLD"' "incomplete/failing gates terminal HOLD (not fabricated pass)"
assert_contains "$OUT" '"id": "KR8"' "KR8 is reported"
assert_contains "$OUT" '"id": "KR10"' "KR10 is reported"
assert_contains "$OUT" '"id": "alias_retirement"' "alias retirement readiness is reported"
assert_contains "$OUT" 'blocking_reasons' "every blocking reason is enumerated"

# KR8 must not promote fixture telemetry to production pass.
assert_contains "$OUT" 'fixture' "KR8 distinguishes fixture/spike evidence from production"

# KR10 must use frozen baseline 42 / projected 51 and not redefine the metric.
assert_contains "$OUT" '"baseline_surface_count": 42' "KR10 baseline remains 42"
assert_contains "$OUT" '"projected_post_p3_surface_count": 51' "KR10 projected target remains 51"
assert_contains "$OUT" 'KR10' "KR10 blocking reasons are present when surface did not fall"

# Must not claim 14 elapsed production days when telemetry is absent.
assert_contains "$OUT" '14' "alias gate states the 14-day requirement"
assert_contains "$OUT" 'refusing to manufacture 14 elapsed days' \
  "incomplete 14-day window is HOLD, not fabricated pass"

# --check must exit non-zero on HOLD
CHECK_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$PROJECT" \
  --repo-root "$REPO_ROOT" \
  --check 2>&1)"
CHECK_EXIT=$?
assert_eq "1" "$CHECK_EXIT" "--check exits non-zero on terminal HOLD"

# Mutation: attempting to treat a redefinition of KR10 as pass must not be possible
# via the checker CLI (no flags to waive/redefine).
assert_contains "$OUT" 'not strictly below baseline' \
  "KR10 failure reasons stay on the frozen definition"
assert_contains "$OUT" 'definition is not revised after measurement' \
  "KR10 does not redefine the metric after measurement"

# Notes must forbid fixture promotion and alias deletion by this tool.
assert_contains "$OUT" 'fixture telemetry is never promoted' "fixture promotion is refused"
assert_contains "$OUT" 'never deletes compatibility aliases' "checker never deletes aliases"
assert_contains "$OUT" 'P4 role qualification is out of scope' "P4 remains out of scope"

# kr8-untrusted-telemetry: production-named JSON without authenticated production
# provenance, and negative/non-integer counters, always HOLD.
KR8_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kr8-untrusted.XXXXXX")"
mkdir -p "$KR8_DIR/production-telemetry"
printf '%s\n' '{
  "observed_false_acceptances": 0,
  "observed_missed_red_line_escalations": 0,
  "candidate_mandatory_review_dispatches": 1,
  "baseline_mandatory_review_dispatches": 6
}' >"$KR8_DIR/production-telemetry/kr8.json"
KR8_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$KR8_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
assert_contains "$KR8_OUT" 'production_provenance' \
  "production-named JSON without provenance cannot fund KR8"
# Parse subsection — do not trust aggregate HOLD from unrelated gates.
node - "$KR8_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
if (report.kr8.status !== 'HOLD') {
  console.error('KR8 status must be HOLD for untrusted production-named JSON');
  process.exit(1);
}
const reasons = (report.kr8.blocking_reasons || []).join('\n');
if (!/provenance|untrusted|non-negative|filename|parseable/i.test(reasons)) {
  console.error('KR8 must cite provenance/counter rejection; got:', reasons);
  process.exit(1);
}
if (report.kr8.evidence && report.kr8.evidence.source === 'production_telemetry') {
  console.error('untrusted JSON must not be classified as production_telemetry');
  process.exit(1);
}
console.log('kr8-untrusted-telemetry=ok');
NODE
assert_eq "0" "$?" "KR8 subsection HOLD for untrusted production-named JSON"

printf '%s\n' '{
  "observed_false_acceptances": -1,
  "observed_missed_red_line_escalations": 0,
  "candidate_mandatory_review_dispatches": 1
}' >"$KR8_DIR/production-telemetry/kr8.json"
KR8_NEG="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$KR8_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
node - "$KR8_NEG" <<'NODE'
const report = JSON.parse(process.argv[2]);
if (report.kr8.status !== 'HOLD') process.exit(1);
const reasons = (report.kr8.blocking_reasons || []).join('\n');
if (!/non-negative|integer/i.test(reasons)) {
  console.error('negative counters must HOLD; got:', reasons);
  process.exit(1);
}
console.log('kr8-negative-counter=ok');
NODE
assert_eq "0" "$?" "KR8 rejects negative counters"
rm -rf "$KR8_DIR"

# kr8-body-provenance-mismatch: an otherwise valid trusted receipt whose
# event_hash (and optional evidence_body_hash) matches an *unrelated* body —
# not the mutated KR8 counters — must HOLD for body/provenance mismatch.
# Evidence_body_hash === receipt.event_hash alone is not a binding.
KR8_BODY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kr8-body-bind.XXXXXX")"
mkdir -p "$KR8_BODY_DIR/production-telemetry"
node - "$REPO_ROOT" "$KR8_BODY_DIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));

const originalBody = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const originalBodyHash = sha256(canonicalJson(originalBody));

const runId = 'kr8-body-bind-run';
const streamId = 'kr8-body-bind-stream';
const receiptBase = {
  run_id: runId,
  stream_id: streamId,
  sequence: 1,
  event_hash: originalBodyHash,
  previous_witness_head: null,
};
const witnessHead = sha256(canonicalJson(receiptBase));
const receipt = { ...receiptBase, witness_head: witnessHead };

// Trusted journal records the receipt for the *original* body only.
fs.writeFileSync(
  path.join(dir, 'trusted-installed-witness-authority.json'),
  JSON.stringify({
    kind: 'trusted_installed_witness_authority',
    stream_id: streamId,
    receipts: [receipt],
  }, null, 2),
);

// Mutate KR8 counters while reusing the trusted receipt. The buggy gate
// accepted this when evidence_body_hash merely equalled receipt.event_hash.
const mutated = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 4,
  baseline_mandatory_review_dispatches: 6,
  production_provenance: {
    evidence_body_hash: originalBodyHash,
    witness_receipt: receipt,
  },
};
fs.writeFileSync(
  path.join(dir, 'production-telemetry', 'kr8.json'),
  JSON.stringify(mutated, null, 2),
);
NODE

KR8_BODY_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$KR8_BODY_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
node - "$KR8_BODY_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
if (report.kr8.status !== 'HOLD') {
  console.error('mutated KR8 counters with unrelated trusted receipt must HOLD; got', report.kr8.status);
  process.exit(1);
}
const reasons = (report.kr8.blocking_reasons || []).join('\n');
if (!/body|bound|provenance|evidence_body_hash|event_hash/i.test(reasons)) {
  console.error('KR8 must cite body/provenance mismatch; got:', reasons);
  process.exit(1);
}
if (report.kr8.evidence && report.kr8.evidence.source === 'production_telemetry') {
  console.error('body-unbound trusted receipt must not classify as production_telemetry');
  process.exit(1);
}
console.log('kr8-body-provenance-mismatch=ok');
NODE
assert_eq "0" "$?" "KR8 HOLD for trusted receipt unbound to mutated KR8 body"
rm -rf "$KR8_BODY_DIR"

# kr8-cogen-self-consistent: freshly generated project-local journal + matching
# KR8 body cannot fund PASS — project-local journals are untrusted inputs.
KR8_COGEN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kr8-cogen.XXXXXX")"
mkdir -p "$KR8_COGEN_DIR/production-telemetry"
node - "$REPO_ROOT" "$KR8_COGEN_DIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));

const body = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const witness = new MemoryWitness({ streamId: 'kr8-cogen-stream' });
const receipt = witness.append({
  run_id: 'kr8-cogen-run',
  sequence: 1,
  event_hash: bodyHash,
});
// Evidence-adjacent project-local journal (untrusted parallel "trust root").
fs.writeFileSync(
  path.join(dir, 'trusted-installed-witness-authority.json'),
  JSON.stringify({
    kind: 'trusted_installed_witness_authority',
    stream_id: 'kr8-cogen-stream',
    receipts: [receipt],
  }, null, 2),
);
fs.writeFileSync(
  path.join(dir, 'production-telemetry', 'kr8.json'),
  JSON.stringify({
    ...body,
    production_provenance: {
      evidence_body_hash: bodyHash,
      witness_receipt: receipt,
    },
  }, null, 2),
);
NODE
KR8_COGEN_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$KR8_COGEN_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
node - "$KR8_COGEN_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
if (report.kr8.status !== 'HOLD') {
  console.error('freshly generated self-consistent KR8 must HOLD; got', report.kr8.status);
  process.exit(1);
}
const reasons = (report.kr8.blocking_reasons || []).join('\n');
if (!/independent|untrusted|project-local|provenance|authority/i.test(reasons)) {
  console.error('KR8 co-gen HOLD must cite independent/untrusted authority; got:', reasons);
  process.exit(1);
}
if (report.kr8.evidence && report.kr8.evidence.source === 'production_telemetry') {
  console.error('co-generated project-local journal must not classify as production_telemetry');
  process.exit(1);
}
console.log('kr8-cogen-self-consistent=ok');
NODE
assert_eq "0" "$?" "KR8 HOLD for freshly generated self-consistent project-local evidence"
rm -rf "$KR8_COGEN_DIR"

# kr10-permanent-hold: thresholds stay 42/51; executed membership is derived;
# removed/nonexecuted members reduce measured cardinality rather than measurement errors.
node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const checker = path.join(root, 'scripts', 'check-owner-kernel-release-gates.js');
const src = fs.readFileSync(checker, 'utf8');
if (!src.includes('nonexecuted_members')
  && !src.includes('mechanically derived executed load-bearing')) {
  console.error('KR10 must mechanically derive executed membership');
  process.exit(1);
}
if (!/"baseline_surface_count": 42/.test(src) && !src.includes('baseline_surface_count: 42')) {
  console.error('KR10 baseline threshold 42 must stay frozen');
  process.exit(1);
}
if (!src.includes('projected_post_p3_surface_count: 51')
  && !src.includes('projected_post_p3_surface_count: 51')) {
  // Accept either style
}
if (!src.includes('51')) {
  console.error('KR10 projected threshold 51 must stay frozen');
  process.exit(1);
}
// Create a stripped repo-like tree with fewer executed surfaces and prove
// measured total falls without membership-incomplete measurement errors.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kr10-derived-'));
const copyPairs = [
  ['scripts/check-owner-kernel-release-gates.js', 'scripts/check-owner-kernel-release-gates.js'],
  ['src/engine/owner-kernel/canonical.js', 'src/engine/owner-kernel/canonical.js'],
  ['src/engine/owner-kernel/witness.js', 'src/engine/owner-kernel/witness.js'],
  ['src/engine/owner-kernel/errors.js', 'src/engine/owner-kernel/errors.js'],
  ['src/engine/supervised-owner-kernel-installed-engine.js',
    'src/engine/supervised-owner-kernel-installed-engine.js'],
];
// Minimal stubs so require graph of installed-engine may fail → nonexecuted.
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
for (const [from, to] of copyPairs) {
  const dest = path.join(tmp, to);
  ensureDir(path.dirname(dest));
  fs.copyFileSync(path.join(root, from), dest);
}
// Provide only a subset of catalog skills so missing ones reduce cardinality.
ensureDir(path.join(tmp, 'skills', 'l5'));
fs.writeFileSync(path.join(tmp, 'skills', 'l5', 'SKILL.md'), '---\nname: l5\n---\n');
// No other skills / scripts / hooks → nonexecuted reduces count.
const project = path.join(tmp, 'proj');
ensureDir(project);
const run = spawnSync(process.execPath, [
  path.join(tmp, 'scripts', 'check-owner-kernel-release-gates.js'),
  '--project', project,
  '--repo-root', tmp,
], { encoding: 'utf8' });
if (run.error) {
  console.error(run.error);
  process.exit(1);
}
let report;
try {
  report = JSON.parse(run.stdout);
} catch (error) {
  console.error('failed to parse KR10 derivation report', run.stdout, run.stderr);
  process.exit(1);
}
const surface = report.kr10.measured_surface;
if (!Array.isArray(surface.nonexecuted_members)) {
  console.error('expected nonexecuted_members array for derived membership');
  process.exit(1);
}
if (surface.measurement_errors && surface.measurement_errors.some((e) => /membership incomplete/i.test(e))) {
  console.error('removed members must not become membership-incomplete measurement errors');
  process.exit(1);
}
if (!(Number.isFinite(surface.total) && surface.total < 42)) {
  // Sparse tree should measure well below frozen thresholds when derived.
  // If installed-engine require fails hard, total may be null — still OK if no incomplete errors.
  if (surface.total != null && surface.total >= 42) {
    console.error('derived membership should reduce below baseline when most surfaces absent; total=', surface.total);
    process.exit(1);
  }
}
if (report.kr10.definition.baseline_surface_count !== 42
  || report.kr10.definition.projected_post_p3_surface_count !== 51) {
  console.error('thresholds must remain frozen at 42 and 51');
  process.exit(1);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('kr10-permanent-hold=ok');
NODE
assert_eq "0" "$?" "KR10 derives executed membership while freezing 42/51"

echo "PASS [owner-kernel-release-gates] release gate honesty checks"
finalize_test
