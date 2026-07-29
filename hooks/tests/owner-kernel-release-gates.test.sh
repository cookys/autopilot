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

# ---------------------------------------------------------------------------
# Authority path containment (isolated regressions):
# 1) configured authority anywhere under repoRoot is rejected before it can
#    authenticate release evidence;
# 2) authority path spelled outside the repo but resolving through a symlink
#    into repoRoot is also rejected;
# 3) positive control: authority whose real path is outside both repoRoot and
#    the project evidence boundary authenticates equivalent valid evidence
#    (production_telemetry / trusted_authority_* surface — not aggregate PASS);
# 4) assert the exact path-containment / independent-authority blocker on the
#    negative cases' affected subsections — never an unrelated aggregate HOLD.
# ---------------------------------------------------------------------------

# Case 1 — direct in-repo authority path (anywhere under repoRoot).
INREPO_AUTH="$REPO_ROOT/scripts/.tmp-rg-inrepo-authority-$$.json"
INREPO_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-inrepo-auth-proj.XXXXXX")"
INREPO_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-inrepo-auth-home.XXXXXX")"
mkdir -p "$INREPO_PROJ/production-telemetry"
node - "$REPO_ROOT" "$INREPO_AUTH" "$INREPO_PROJ" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const authOut = process.argv[3];
const proj = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));

// Self-consistent KR8 body + journal that WOULD authenticate if the authority
// path were accepted (mutation oracle for path-containment failure).
const body = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const witness = new MemoryWitness({ streamId: 'rg-inrepo-auth-stream' });
const receipt = witness.append({
  run_id: 'rg-inrepo-auth-run',
  sequence: 1,
  event_hash: bodyHash,
});
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  stream_id: 'rg-inrepo-auth-stream',
  receipts: [receipt],
}, null, 2));
fs.writeFileSync(
  path.join(proj, 'production-telemetry', 'kr8.json'),
  JSON.stringify({
    ...body,
    production_provenance: {
      evidence_body_hash: bodyHash,
      witness_receipt: receipt,
    },
  }, null, 2),
);
// Minimal alias telemetry so alias subsection is exercised too.
fs.writeFileSync(
  path.join(proj, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify({
    shipped_compatibility_cycle: true,
    witnessed_zero_use_days: 0,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
  }, null, 2),
);
NODE

INREPO_OUT="$(
  HOME="$INREPO_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$INREPO_AUTH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$INREPO_PROJ" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$INREPO_OUT" "$INREPO_AUTH" <<'NODE'
'use strict';
const report = JSON.parse(process.argv[2]);
const inrepoAuth = process.argv[3];
const kr8 = report.kr8;
const alias = report.alias_retirement;
// Do not trust aggregate disposition alone (KR10/etc. can HOLD for other reasons).
if (!kr8 || kr8.status !== 'HOLD') {
  console.error('in-repo authority must HOLD KR8 before authenticating evidence; got', kr8 && kr8.status);
  process.exit(1);
}
if (kr8.evidence && kr8.evidence.source === 'production_telemetry') {
  console.error('in-repo authority must not authenticate KR8 as production_telemetry');
  process.exit(1);
}
const kr8Reasons = (kr8.blocking_reasons || []).join('\n');
// Exact independent-authority / path-containment blocker (not unrelated KR8 counter HOLD).
if (!/independently configured installed witness authority/i.test(kr8Reasons)
  && !/without independently configured/i.test(kr8Reasons)) {
  console.error('KR8 must cite independent-authority path-containment blocker; got:', kr8Reasons);
  process.exit(1);
}
if (!/untrusted|project-local|provenance/i.test(kr8Reasons)) {
  console.error('KR8 path-containment HOLD must mention untrusted/project-local provenance; got:', kr8Reasons);
  process.exit(1);
}
if (!alias || alias.status !== 'HOLD') {
  console.error('in-repo authority must HOLD alias_retirement subsection; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present === true) {
  console.error('in-repo authority must not set trusted_authority_present');
  process.exit(1);
}
if (alias.trusted_authority_path) {
  console.error('in-repo authority must not surface trusted_authority_path; got', alias.trusted_authority_path);
  process.exit(1);
}
const aliasReasons = (alias.blocking_reasons || []).join('\n');
if (!/independently configured installed witness authority/i.test(aliasReasons)) {
  console.error('alias must cite exact independent-authority blocker; got:', aliasReasons);
  process.exit(1);
}
// Configured path must not leak in as an accepted authority path.
if (String(alias.trusted_authority_path || '').indexOf(inrepoAuth) !== -1) {
  console.error('in-repo configured path must not be trusted_authority_path');
  process.exit(1);
}
console.log('rg-inrepo-authority-path-containment=ok');
NODE
assert_eq "0" "$?" "direct in-repo authority path rejected before authenticating release evidence"
rm -f "$INREPO_AUTH"
rm -rf "$INREPO_PROJ" "$INREPO_HOME"

# Case 2 — authority spelling outside repo, realpath via symlink into repoRoot.
SYMLINK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rg-symlink-auth.XXXXXX")"
TARGET_IN_REPO="$REPO_ROOT/scripts/.tmp-rg-symlink-target-$$.json"
LINK_PATH="$SYMLINK_DIR/outside-link-authority.json"
SYMLINK_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-symlink-auth-proj.XXXXXX")"
SYMLINK_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-symlink-auth-home.XXXXXX")"
mkdir -p "$SYMLINK_PROJ/production-telemetry"
node - "$REPO_ROOT" "$TARGET_IN_REPO" "$SYMLINK_PROJ" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const authOut = process.argv[3];
const proj = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));

const body = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const witness = new MemoryWitness({ streamId: 'rg-symlink-auth-stream' });
const receipt = witness.append({
  run_id: 'rg-symlink-auth-run',
  sequence: 1,
  event_hash: bodyHash,
});
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  stream_id: 'rg-symlink-auth-stream',
  receipts: [receipt],
}, null, 2));
fs.writeFileSync(
  path.join(proj, 'production-telemetry', 'kr8.json'),
  JSON.stringify({
    ...body,
    production_provenance: {
      evidence_body_hash: bodyHash,
      witness_receipt: receipt,
    },
  }, null, 2),
);
fs.writeFileSync(
  path.join(proj, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify({
    shipped_compatibility_cycle: true,
    witnessed_zero_use_days: 0,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
  }, null, 2),
);
NODE
ln -s "$TARGET_IN_REPO" "$LINK_PATH"

SYMLINK_OUT="$(
  HOME="$SYMLINK_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$LINK_PATH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$SYMLINK_PROJ" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$SYMLINK_OUT" "$LINK_PATH" "$TARGET_IN_REPO" <<'NODE'
'use strict';
const report = JSON.parse(process.argv[2]);
const linkPath = process.argv[3];
const targetInRepo = process.argv[4];
const kr8 = report.kr8;
const alias = report.alias_retirement;
if (!kr8 || kr8.status !== 'HOLD') {
  console.error('symlink-into-repo authority must HOLD KR8; got', kr8 && kr8.status);
  process.exit(1);
}
if (kr8.evidence && kr8.evidence.source === 'production_telemetry') {
  console.error('symlink-into-repo authority must not authenticate KR8 as production_telemetry');
  process.exit(1);
}
const kr8Reasons = (kr8.blocking_reasons || []).join('\n');
if (!/independently configured installed witness authority/i.test(kr8Reasons)
  && !/without independently configured/i.test(kr8Reasons)) {
  console.error('symlink-into-repo KR8 must cite independent-authority path-containment blocker; got:', kr8Reasons);
  process.exit(1);
}
if (!alias || alias.status !== 'HOLD') {
  console.error('symlink-into-repo authority must HOLD alias_retirement; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present === true) {
  console.error('symlink-into-repo authority must not set trusted_authority_present');
  process.exit(1);
}
if (alias.trusted_authority_path) {
  console.error('symlink-into-repo authority must not surface trusted_authority_path; got', alias.trusted_authority_path);
  process.exit(1);
}
const aliasReasons = (alias.blocking_reasons || []).join('\n');
if (!/independently configured installed witness authority/i.test(aliasReasons)) {
  console.error('symlink-into-repo alias must cite exact independent-authority blocker; got:', aliasReasons);
  process.exit(1);
}
// Neither the outside spelling nor the in-repo realpath may be accepted.
const accepted = String(alias.trusted_authority_path || '');
if (accepted === linkPath || accepted === targetInRepo) {
  console.error('symlink path-containment failed; accepted path:', accepted);
  process.exit(1);
}
console.log('rg-symlink-into-repo-authority-path-containment=ok');
NODE
assert_eq "0" "$?" "outside-symlink-into-repo authority path rejected before authenticating release evidence"
rm -f "$TARGET_IN_REPO" "$LINK_PATH"
rm -rf "$SYMLINK_DIR" "$SYMLINK_PROJ" "$SYMLINK_HOME"

# Case 3a — release-evidence-self-auth: outside-path MemoryWitness journal alone
# must NOT become production authority (no allowTestWitness; no external adapter).
OUTSIDE_MW_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rg-outside-mw.XXXXXX")"
OUTSIDE_MW_AUTH="$OUTSIDE_MW_DIR/trusted-installed-witness-authority.json"
OUTSIDE_MW_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-outside-mw-proj.XXXXXX")"
OUTSIDE_MW_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-outside-mw-home.XXXXXX")"
mkdir -p "$OUTSIDE_MW_PROJ/production-telemetry"
node - "$REPO_ROOT" "$OUTSIDE_MW_AUTH" "$OUTSIDE_MW_PROJ" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const authOut = process.argv[3];
const proj = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));
const body = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const witness = new MemoryWitness({ streamId: 'rg-outside-mw-stream' });
const receipt = witness.append({
  run_id: 'rg-outside-mw-run',
  sequence: 1,
  event_hash: bodyHash,
});
// Journal only — no external_adapter_module. Must not fund production authority.
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  stream_id: 'rg-outside-mw-stream',
  receipts: [receipt],
}, null, 2));
fs.writeFileSync(
  path.join(proj, 'production-telemetry', 'kr8.json'),
  JSON.stringify({
    ...body,
    production_provenance: {
      evidence_body_hash: bodyHash,
      witness_receipt: receipt,
    },
  }, null, 2),
);
fs.writeFileSync(
  path.join(proj, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify({
    shipped_compatibility_cycle: true,
    witnessed_zero_use_days: 0,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
  }, null, 2),
);
NODE

OUTSIDE_MW_OUT="$(
  HOME="$OUTSIDE_MW_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$OUTSIDE_MW_AUTH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$OUTSIDE_MW_PROJ" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$OUTSIDE_MW_OUT" <<'NODE'
'use strict';
const report = JSON.parse(process.argv[2]);
const kr8 = report.kr8;
const alias = report.alias_retirement;
if (!kr8 || kr8.status !== 'HOLD') {
  console.error('MemoryWitness-only outside journal must HOLD KR8; got', kr8 && kr8.status);
  process.exit(1);
}
if (kr8.evidence && kr8.evidence.source === 'production_telemetry') {
  console.error('MemoryWitness-only journal must not classify as production_telemetry');
  process.exit(1);
}
const kr8Reasons = (kr8.blocking_reasons || []).join('\n');
if (!/external|MemoryWitness|allowTestWitness|adapter|production authority/i.test(kr8Reasons)
  && !/independently configured|provenance|untrusted/i.test(kr8Reasons)) {
  console.error('MemoryWitness self-auth HOLD must cite external adapter / untrusted; got:', kr8Reasons);
  process.exit(1);
}
if (alias && alias.trusted_authority_present === true) {
  console.error('MemoryWitness-only must not set trusted_authority_present');
  process.exit(1);
}
console.log('rg-outside-memory-witness-self-auth-hold=ok');
NODE
assert_eq "0" "$?" "outside MemoryWitness journal alone cannot become production authority"
rm -rf "$OUTSIDE_MW_DIR" "$OUTSIDE_MW_PROJ" "$OUTSIDE_MW_HOME"

# Case 3b — negative: fully self-consistent caller-created config + external
# adapter + receipts (adapter nominated FROM authority JSON) cannot self-auth.
# Adapter identity must come from deployment-provisioned binding, not project config.
SELF_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rg-self-auth.XXXXXX")"
SELF_AUTH="$SELF_DIR/trusted-installed-witness-authority.json"
SELF_ADAPTER="$SELF_DIR/external-witness-adapter.js"
SELF_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-self-auth-proj.XXXXXX")"
SELF_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-self-auth-home.XXXXXX")"
mkdir -p "$SELF_PROJ/production-telemetry"
node - "$REPO_ROOT" "$SELF_AUTH" "$SELF_PROJ" "$SELF_ADAPTER" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const authOut = process.argv[3];
const proj = process.argv[4];
const adapterOut = process.argv[5];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const body = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const streamId = 'rg-self-auth-stream';
const receiptBase = {
  run_id: 'rg-self-auth-run', stream_id: streamId, sequence: 1,
  event_hash: bodyHash, previous_witness_head: null,
};
const receipt = { ...receiptBase, witness_head: sha256(canonicalJson(receiptBase)) };
fs.writeFileSync(adapterOut, `'use strict';
const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function createAuthority({ streamId, receipts }) {
  const known = new Map();
  for (const entry of receipts || []) known.set(String(entry.witness_head).toLowerCase(), entry);
  return {
    streamId, trustTier: 'external',
    identity: 'external-adapter:' + streamId,
    attestation_hash: sha256('external-adapter:' + streamId),
    protocol_version: 1,
    getAppendTimestamp() { return null; },
    append() { throw new Error('unused'); },
    verify(receipt) {
      if (!receipt || receipt.stream_id !== streamId) return false;
      return known.has(String(receipt.witness_head).toLowerCase());
    },
  };
}
module.exports = { createAuthority };
`);
// Caller nominates adapter FROM authority config (forbidden self-auth shape).
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  stream_id: streamId,
  external_adapter_module: adapterOut,
  adapter_sha256: 'a'.repeat(64),
  receipts: [receipt],
}, null, 2));
fs.writeFileSync(path.join(proj, 'production-telemetry', 'kr8.json'), JSON.stringify({
  ...body,
  production_provenance: { evidence_body_hash: bodyHash, witness_receipt: receipt },
}, null, 2));
NODE
SELF_OUT="$(
  HOME="$SELF_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$SELF_AUTH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$SELF_PROJ" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$SELF_OUT" <<'NODE'
'use strict';
const report = JSON.parse(process.argv[2]);
const kr8 = report.kr8;
if (!kr8 || kr8.status !== 'HOLD') {
  console.error('caller-nominated adapter must HOLD KR8; got', kr8 && kr8.status, kr8 && kr8.blocking_reasons);
  process.exit(1);
}
if (kr8.evidence && kr8.evidence.source === 'production_telemetry') {
  console.error('self-auth adapter must not classify as production_telemetry');
  process.exit(1);
}
const reasons = (kr8.blocking_reasons || []).join('\n');
if (!/adapter|binding|nominate|sha256|pin|deployment|must not select/i.test(reasons)
  && !/independently|untrusted|provenance|authority/i.test(reasons)) {
  console.error('self-auth HOLD must cite adapter binding/nomination; got:', reasons);
  process.exit(1);
}
if (report.alias_retirement && report.alias_retirement.trusted_authority_present === true) {
  console.error('self-auth must not set trusted_authority_present');
  process.exit(1);
}
console.log('rg-caller-nominated-adapter-self-auth-hold=ok');
NODE
assert_eq "0" "$?" "caller-created config+adapter+receipts cannot self-authenticate"
rm -rf "$SELF_DIR" "$SELF_PROJ" "$SELF_HOME"

# Case 3c — positive control: independently supplied pinned adapter binding
# (AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING) authenticates valid KR8.
OUTSIDE_AUTH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rg-outside-auth.XXXXXX")"
OUTSIDE_AUTH="$OUTSIDE_AUTH_DIR/trusted-installed-witness-authority.json"
OUTSIDE_ADAPTER="$OUTSIDE_AUTH_DIR/external-witness-adapter.js"
OUTSIDE_BINDING="$OUTSIDE_AUTH_DIR/trusted-witness-adapter-binding.json"
OUTSIDE_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-outside-auth-proj.XXXXXX")"
OUTSIDE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-outside-auth-home.XXXXXX")"
mkdir -p "$OUTSIDE_PROJ/production-telemetry"
node - "$REPO_ROOT" "$OUTSIDE_AUTH" "$OUTSIDE_PROJ" "$OUTSIDE_ADAPTER" "$OUTSIDE_BINDING" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const authOut = process.argv[3];
const proj = process.argv[4];
const adapterOut = process.argv[5];
const bindingOut = process.argv[6];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const body = {
  observed_false_acceptances: 0,
  observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1,
  baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const streamId = 'rg-outside-ext-stream';
const runId = 'rg-outside-ext-run';
const receiptBase = {
  run_id: runId, stream_id: streamId, sequence: 1,
  event_hash: bodyHash, previous_witness_head: null,
};
const witnessHead = sha256(canonicalJson(receiptBase));
const receipt = { ...receiptBase, witness_head: witnessHead };
fs.writeFileSync(adapterOut, `'use strict';
const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function createAuthority({ streamId, receipts, anchored_append_timestamps }) {
  const known = new Map();
  for (const entry of receipts || []) known.set(String(entry.witness_head).toLowerCase(), entry);
  const anchored = new Map(Object.entries(anchored_append_timestamps || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    streamId, trustTier: 'external',
    identity: 'external-adapter:' + streamId,
    attestation_hash: sha256('external-adapter:' + streamId),
    protocol_version: 1,
    getAppendTimestamp(receipt) {
      return anchored.get(String(receipt.witness_head).toLowerCase()) || null;
    },
    append() { throw new Error('unused'); },
    verify(receipt) {
      if (!receipt || receipt.stream_id !== streamId) return false;
      const head = String(receipt.witness_head).toLowerCase();
      if (!known.has(head)) return false;
      const expected = sha256(canonicalJson({
        run_id: receipt.run_id, stream_id: receipt.stream_id, sequence: receipt.sequence,
        event_hash: receipt.event_hash, previous_witness_head: receipt.previous_witness_head,
      }));
      return expected === receipt.witness_head;
    },
  };
}
module.exports = { createAuthority };
`);
const adapterPin = crypto.createHash('sha256').update(fs.readFileSync(adapterOut)).digest('hex');
// Authority config does NOT select adapter module.
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  authority_id: 'rg-outside-auth-1',
  stream_id: streamId,
  receipts: [receipt],
}, null, 2));
// Independent deployment binding pins adapter + optional anchored timestamps.
fs.writeFileSync(bindingOut, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding',
  authority_id: 'rg-outside-auth-1',
  adapter_module: adapterOut,
  adapter_sha256: adapterPin,
  anchored_append_timestamps: { [witnessHead]: new Date().toISOString() },
}, null, 2));
fs.writeFileSync(path.join(proj, 'production-telemetry', 'kr8.json'), JSON.stringify({
  ...body,
  production_provenance: { evidence_body_hash: bodyHash, witness_receipt: receipt },
}, null, 2));
fs.writeFileSync(path.join(proj, 'production-telemetry', 'alias-retirement.json'), JSON.stringify({
  shipped_compatibility_cycle: true,
  witnessed_zero_use_days: 0,
  translation_used_events: 0,
  unresolved_translation_deltas: 0,
}, null, 2));
NODE

OUTSIDE_OUT="$(
  HOME="$OUTSIDE_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$OUTSIDE_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$OUTSIDE_BINDING" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$OUTSIDE_PROJ" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$OUTSIDE_OUT" "$OUTSIDE_AUTH" "$REPO_ROOT" "$OUTSIDE_PROJ" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const report = JSON.parse(process.argv[2]);
const outsideAuth = process.argv[3];
const repoRoot = process.argv[4];
const projectDir = process.argv[5];
const authReal = fs.realpathSync(outsideAuth);
const repoReal = fs.realpathSync(repoRoot);
const projReal = fs.realpathSync(projectDir);
function isInside(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (p === c) return true;
  const prefix = p.endsWith(path.sep) ? p : `${p}${path.sep}`;
  return c.startsWith(prefix);
}
if (isInside(repoReal, authReal) || isInside(projReal, authReal)) {
  console.error('positive-control fixture mis-placed', authReal);
  process.exit(1);
}
const kr8 = report.kr8;
const alias = report.alias_retirement;
if (!kr8 || !kr8.evidence || kr8.evidence.source !== 'production_telemetry') {
  console.error('pinned binding must authenticate KR8 as production_telemetry; got',
    kr8 && kr8.evidence && kr8.evidence.source, kr8 && kr8.blocking_reasons);
  process.exit(1);
}
if (kr8.status !== 'PASS') {
  console.error('pinned binding with valid KR8 must PASS; got', kr8.status, kr8.blocking_reasons);
  process.exit(1);
}
if (!alias || alias.trusted_authority_present !== true) {
  console.error('pinned binding must set trusted_authority_present; got',
    alias && alias.trusted_authority_present, alias && alias.blocking_reasons);
  process.exit(1);
}
console.log('rg-outside-pinned-binding-positive-control=ok');
NODE
assert_eq "0" "$?" "independently supplied pinned adapter binding authenticates production evidence"
rm -rf "$OUTSIDE_AUTH_DIR" "$OUTSIDE_PROJ" "$OUTSIDE_HOME"

# authority-id-optional-bypass: missing config or binding authority_id is HOLD.
MISS_CFG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rg-miss-cfg-id.XXXXXX")"
MISS_CFG_AUTH="$MISS_CFG_DIR/authority.json"
MISS_CFG_ADAPTER="$MISS_CFG_DIR/adapter.js"
MISS_CFG_BIND="$MISS_CFG_DIR/binding.json"
MISS_CFG_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-miss-cfg-proj.XXXXXX")"
MISS_CFG_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-miss-cfg-home.XXXXXX")"
mkdir -p "$MISS_CFG_PROJ/production-telemetry"
node - "$REPO_ROOT" "$MISS_CFG_AUTH" "$MISS_CFG_ADAPTER" "$MISS_CFG_BIND" "$MISS_CFG_PROJ" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const authOut = process.argv[3];
const adapterOut = process.argv[4];
const bindOut = process.argv[5];
const proj = process.argv[6];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const body = {
  observed_false_acceptances: 0, observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1, baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const streamId = 'miss-cfg-id';
const base = { run_id: 'r', stream_id: streamId, sequence: 1, event_hash: bodyHash, previous_witness_head: null };
const receipt = { ...base, witness_head: sha256(canonicalJson(base)) };
fs.writeFileSync(adapterOut, `'use strict';
function createAuthority({ streamId, receipts }) {
  const known = new Map((receipts||[]).map((e)=>[String(e.witness_head).toLowerCase(), e]));
  return {
    streamId, trustTier: 'external', identity: 'x:'+streamId,
    attestation_hash: 'a'.repeat(64), protocol_version: 1,
    getAppendTimestamp() { return null; },
    append() { throw new Error('n'); },
    verify(r) { return r && known.has(String(r.witness_head).toLowerCase()); },
  };
}
module.exports = { createAuthority };
`);
const pin = crypto.createHash('sha256').update(fs.readFileSync(adapterOut)).digest('hex');
// Config missing authority_id
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority', stream_id: streamId, receipts: [receipt],
}, null, 2));
fs.writeFileSync(bindOut, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding', authority_id: 'present-on-binding',
  adapter_module: adapterOut, adapter_sha256: pin,
}, null, 2));
fs.writeFileSync(path.join(proj, 'production-telemetry', 'kr8.json'), JSON.stringify({
  ...body, production_provenance: { evidence_body_hash: bodyHash, witness_receipt: receipt },
}, null, 2));
NODE
MISS_CFG_OUT="$(
  HOME="$MISS_CFG_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$MISS_CFG_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$MISS_CFG_BIND" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$MISS_CFG_PROJ" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$MISS_CFG_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
if (report.kr8.status !== 'HOLD') process.exit(1);
const reasons = (report.kr8.blocking_reasons||[]).join('\n');
if (!/authority_id/i.test(reasons) && !/independently|provenance|adapter|binding/i.test(reasons)) {
  console.error('missing config authority_id must HOLD; got', reasons);
  process.exit(1);
}
if (report.kr8.evidence && report.kr8.evidence.source === 'production_telemetry') process.exit(1);
console.log('rg-missing-config-authority-id-hold=ok');
NODE
assert_eq "0" "$?" "missing config authority_id HOLDs"
rm -rf "$MISS_CFG_DIR" "$MISS_CFG_PROJ" "$MISS_CFG_HOME"

MISS_BND_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rg-miss-bnd-id.XXXXXX")"
MISS_BND_AUTH="$MISS_BND_DIR/authority.json"
MISS_BND_ADAPTER="$MISS_BND_DIR/adapter.js"
MISS_BND_BIND="$MISS_BND_DIR/binding.json"
MISS_BND_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/rg-miss-bnd-proj.XXXXXX")"
MISS_BND_HOME="$(mktemp -d "${TMPDIR:-/tmp}/rg-miss-bnd-home.XXXXXX")"
mkdir -p "$MISS_BND_PROJ/production-telemetry"
node - "$REPO_ROOT" "$MISS_BND_AUTH" "$MISS_BND_ADAPTER" "$MISS_BND_BIND" "$MISS_BND_PROJ" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const authOut = process.argv[3];
const adapterOut = process.argv[4];
const bindOut = process.argv[5];
const proj = process.argv[6];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const body = {
  observed_false_acceptances: 0, observed_missed_red_line_escalations: 0,
  candidate_mandatory_review_dispatches: 1, baseline_mandatory_review_dispatches: 6,
};
const bodyHash = sha256(canonicalJson(body));
const streamId = 'miss-bnd-id';
const base = { run_id: 'r', stream_id: streamId, sequence: 1, event_hash: bodyHash, previous_witness_head: null };
const receipt = { ...base, witness_head: sha256(canonicalJson(base)) };
fs.writeFileSync(adapterOut, `'use strict';
function createAuthority({ streamId, receipts }) {
  const known = new Map((receipts||[]).map((e)=>[String(e.witness_head).toLowerCase(), e]));
  return {
    streamId, trustTier: 'external', identity: 'x:'+streamId,
    attestation_hash: 'a'.repeat(64), protocol_version: 1,
    getAppendTimestamp() { return null; },
    append() { throw new Error('n'); },
    verify(r) { return r && known.has(String(r.witness_head).toLowerCase()); },
  };
}
module.exports = { createAuthority };
`);
const pin = crypto.createHash('sha256').update(fs.readFileSync(adapterOut)).digest('hex');
fs.writeFileSync(authOut, JSON.stringify({
  kind: 'trusted_installed_witness_authority', authority_id: 'present-on-config',
  stream_id: streamId, receipts: [receipt],
}, null, 2));
// Binding missing authority_id
fs.writeFileSync(bindOut, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding',
  adapter_module: adapterOut, adapter_sha256: pin,
}, null, 2));
fs.writeFileSync(path.join(proj, 'production-telemetry', 'kr8.json'), JSON.stringify({
  ...body, production_provenance: { evidence_body_hash: bodyHash, witness_receipt: receipt },
}, null, 2));
NODE
MISS_BND_OUT="$(
  HOME="$MISS_BND_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$MISS_BND_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$MISS_BND_BIND" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$MISS_BND_PROJ" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$MISS_BND_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
if (report.kr8.status !== 'HOLD') process.exit(1);
const reasons = (report.kr8.blocking_reasons||[]).join('\n');
if (!/authority_id/i.test(reasons) && !/binding|adapter|independently|provenance/i.test(reasons)) {
  console.error('missing binding authority_id must HOLD; got', reasons);
  process.exit(1);
}
if (report.kr8.evidence && report.kr8.evidence.source === 'production_telemetry') process.exit(1);
console.log('rg-missing-binding-authority-id-hold=ok');
NODE
assert_eq "0" "$?" "missing binding authority_id HOLDs"
rm -rf "$MISS_BND_DIR" "$MISS_BND_PROJ" "$MISS_BND_HOME"


# kr10 mutation: added executed hook member is counted; dynamic require cannot claim complete.
node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const checker = path.join(root, 'scripts', 'check-owner-kernel-release-gates.js');

function runReport(repoRoot) {
  const project = path.join(repoRoot, 'proj');
  fs.mkdirSync(project, { recursive: true });
  const run = spawnSync(process.execPath, [
    checker, '--project', project, '--repo-root', repoRoot,
  ], { encoding: 'utf8' });
  if (run.error) throw run.error;
  return JSON.parse(run.stdout);
}

// Base: real repo must not use fixed seed as complete-only; membership_complete
// requires authoritative sources. Thresholds stay 42/51.
const base = runReport(root);
if (base.kr10.definition.baseline_surface_count !== 42
  || base.kr10.definition.projected_post_p3_surface_count !== 51) {
  console.error('thresholds must stay 42/51');
  process.exit(1);
}
if (base.kr10.measured_surface.membership_complete === true) {
  console.error('real repo must HOLD incomplete: no complete skills/schemas/engine execution manifests');
  process.exit(1);
}
if (base.kr10.status !== 'HOLD') {
  console.error('real repo KR10 must HOLD when membership incomplete; got', base.kr10.status);
  process.exit(1);
}

// Mutation A: add a new default-on hook to a copy of hooks manifests — counted.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kr10-add-hook-'));
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}
// Minimal authoritative tree: hooks + inventory deps + engine + skills + schemas + scripts.
for (const rel of [
  'hooks/hooks.json', 'hooks/opt-in-manifest.json',
  'scripts/check-hook-inventory.js',
  'scripts/check-owner-kernel-release-gates.js',
  'scripts/owner-kernel.js',
  'src/engine',
  'src/runners',
  'skills/l5/SKILL.md',
  'schemas/owner-event.schema.json',
  'schemas/dispatch-unit-contract.schema.json',
  'schemas/review-loop-contract.schema.json',
]) {
  const src = path.join(root, rel);
  const dest = path.join(tmp, rel);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const st = fs.statSync(src);
  if (st.isDirectory()) copyTree(src, dest);
  else fs.copyFileSync(src, dest);
}
// Ensure minimal skill/schema files exist
fs.mkdirSync(path.join(tmp, 'skills', 'l5'), { recursive: true });
if (!fs.existsSync(path.join(tmp, 'skills', 'l5', 'SKILL.md'))) {
  fs.writeFileSync(path.join(tmp, 'skills', 'l5', 'SKILL.md'), '---\nname: l5\n---\n');
}
// Copy all hooks/*.js referenced
const hooksJson = JSON.parse(fs.readFileSync(path.join(tmp, 'hooks', 'hooks.json'), 'utf8'));
const stems = new Set();
for (const event of Object.keys(hooksJson.hooks || {})) {
  for (const matcher of hooksJson.hooks[event] || []) {
    for (const h of matcher.hooks || []) {
      const m = String(h.command || '').match(/hooks\/([A-Za-z0-9_-]+)\.(js|sh)/);
      if (m) stems.add(m[1] + '.' + m[2]);
    }
  }
}
for (const f of stems) {
  const src = path.join(root, 'hooks', f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(tmp, 'hooks', f));
  }
}
// Also copy owner-kernel deps used by checker
for (const rel of [
  'src/engine/owner-kernel/canonical.js',
  'src/engine/owner-kernel/witness.js',
  'src/engine/owner-kernel/errors.js',
]) {
  const dest = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dest);
}

const before = runReport(tmp);
const beforeHooks = before.kr10.measured_surface.hooks_default_on || 0;

// Add new default-on hook member.
fs.writeFileSync(path.join(tmp, 'hooks', 'kr10-extra-hook.js'), '#!/usr/bin/env node\nconsole.log("x");\n');
// Wire into SessionStart
const hj = JSON.parse(fs.readFileSync(path.join(tmp, 'hooks', 'hooks.json'), 'utf8'));
if (!hj.hooks.SessionStart) hj.hooks.SessionStart = [{ matcher: '*', hooks: [] }];
hj.hooks.SessionStart[0].hooks.push({
  type: 'command',
  command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/kr10-extra-hook.js',
});
fs.writeFileSync(path.join(tmp, 'hooks', 'hooks.json'), JSON.stringify(hj, null, 2));
const after = runReport(tmp);
const afterHooks = after.kr10.measured_surface.hooks_default_on || 0;
if (!(afterHooks > beforeHooks)) {
  console.error('added executed hook must increase hooks count', beforeHooks, afterHooks,
    after.kr10.measured_surface.measurement_errors);
  process.exit(1);
}

// Mutation B: unused skill/schema files must not increase executed cardinality.
const skillsBefore = after.kr10.measured_surface.skills || 0;
const schemasBefore = after.kr10.measured_surface.schemas || 0;
fs.mkdirSync(path.join(tmp, 'skills', 'unused-skill-file'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'skills', 'unused-skill-file', 'SKILL.md'), '---\nname: unused\n---\n');
fs.mkdirSync(path.join(tmp, 'schemas'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'schemas', 'unused-schema-file.json'), '{}\n');
const afterUnused = runReport(tmp);
if ((afterUnused.kr10.measured_surface.skills || 0) !== skillsBefore) {
  console.error('unused skill must not increase executed skills cardinality',
    skillsBefore, afterUnused.kr10.measured_surface.skills);
  process.exit(1);
}
if ((afterUnused.kr10.measured_surface.schemas || 0) !== schemasBefore) {
  console.error('unused schema must not increase executed schemas cardinality',
    schemasBefore, afterUnused.kr10.measured_surface.schemas);
  process.exit(1);
}

// Mutation C: conditional/lazy engine dependency cannot leave membership_complete true.
const dynTarget = path.join(tmp, 'src', 'engine', 'supervised-owner-kernel-installed-engine.js');
if (fs.existsSync(dynTarget)) {
  let body = fs.readFileSync(dynTarget, 'utf8');
  body = 'function __lazyLoad() { if (Math.random() > 1) require("./owner-kernel/canonical"); }\n' + body;
  fs.writeFileSync(dynTarget, body);
  const dyn = runReport(tmp);
  if (dyn.kr10.measured_surface.membership_complete === true) {
    console.error('conditional/lazy require must not claim membership_complete=true');
    process.exit(1);
  }
  if (dyn.kr10.status !== 'HOLD') {
    console.error('conditional/lazy incomplete membership must HOLD KR10');
    process.exit(1);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('kr10-added-member-and-dynamic-require=ok');
NODE
assert_eq "0" "$?" "KR10 counts added members and refuses complete on dynamic require"

# Source asserts: no allowTestWitness; adapter binding; no journal harvest.
CHECKER_SRC="$(cat "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js")"
if printf '%s' "$CHECKER_SRC" | grep -q 'allowTestWitness: true'; then
  echo "FAIL: allowTestWitness:true is forbidden for release evidence" >&2
  exit 1
fi
assert_contains "$CHECKER_SRC" 'AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING' \
  "adapter identity comes from deployment binding env"
assert_contains "$CHECKER_SRC" 'adapter_sha256' \
  "adapter integrity pin is required before require()"
assert_contains "$CHECKER_SRC" 'sanitizeReceiptForTimestampLookup' \
  "timestamp lookup uses sanitized receipts"
assert_contains "$CHECKER_SRC" 'missing a non-empty bounded authority_id' \
  "authority_id required on config and binding"
assert_contains "$CHECKER_SRC" 'membership_complete' \
  "KR10 reports membership_complete"

echo "PASS [owner-kernel-release-gates] release gate honesty checks"
finalize_test
