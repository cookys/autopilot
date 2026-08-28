#!/usr/bin/env bash
# hooks/tests/engine-qualify-consult.test.sh
#
# consult exam suite acceptance (plan: docs/plans/2026-08-28-consult-discuss-
# qualification.md, D1). Tests the generator/grader/corpus/rubric assets
# DIRECTLY (self-check + library calls) rather than through
# `scripts/engine-qualify.sh consult --plan`, because that dry-run flag is
# D3 — a sibling deliverable in the same wave, not yet wired at the time
# this file was authored. When D3 lands, add a companion assertion that
# `scripts/engine-qualify.sh consult --plan` also exits 0 and prints the
# five frozen identities; this file's generator/grader self-checks remain
# the underlying acceptance surface either way (plan D1 "Acceptance").
. "$(dirname "$0")/lib.sh"

GEN="$REPO_ROOT/evals/consult-eval-generator.js"
GRADER="$REPO_ROOT/evals/consult-eval-grader.js"
RUBRIC="$REPO_ROOT/evals/consult-eval-rubric.md"
RUBRIC_SEAL="$REPO_ROOT/evals/consult-eval-rubric.seal.json"
CORPUS="$REPO_ROOT/evals/consult-capability-evidence-corpus.json"
CORPUS_SEAL="$REPO_ROOT/evals/consult-capability-evidence-corpus.seal.json"
RUBRIC_FREEZE="$REPO_ROOT/scripts/rubric-freeze.js"

assert_file_exists "$GEN" "generator asset exists"
assert_file_exists "$GRADER" "grader asset exists"
assert_file_exists "$RUBRIC" "rubric asset exists"
assert_file_exists "$RUBRIC_SEAL" "rubric seal exists"
assert_file_exists "$CORPUS" "corpus manifest asset exists"
assert_file_exists "$CORPUS_SEAL" "corpus manifest seal exists"

# ── 1. generator --self-check: the D1 acceptance line, verbatim ────────────
# "reference answers all pass; every deviant on its pinned label; the
# overfitter red; the pair-generation fixture green; the negative control
# flipping admission to FAIL."
OUT="$(node "$GEN" --self-check 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "consult-eval-generator --self-check exits 0"
assert_contains "$OUT" '"ok": true' "self-check report is ok:true"
assert_contains "$OUT" '"checked_cases": 20' "self-check covers all 20 cases (5 families x 2 cases x 2 trials)"
assert_contains "$OUT" '"overfitter_checked": true' "gate 3 (overfitter discrimination): a C1 surface-cue overfitter was constructed and graded"
assert_contains "$OUT" '"negative_control_admission_failed": true' "gate 4 (negative control): shadow grader flips admission to FAIL"
assert_contains "$OUT" '"pair_generation_ok": true' "pair-generation fixture: same adminSeed + different oracleKey => byte-identical visible bytes AND expected answers"
assert_contains "$OUT" '"failures": []' "no admission failures (gate 1 solvability + gate 2 trap discrimination both clean)"

# Determinism: same seed => byte-identical self-check output.
OUT2="$(node "$GEN" --self-check 2>&1)"
assert_eq "$OUT" "$OUT2" "self-check is deterministic across repeated runs with the default seed"

# Usage error without --self-check.
node "$GEN" >/dev/null 2>&1
assert_exit_code "$?" "2" "generator without --self-check exits 2 (usage)"

# ── 2. rubric + corpus seals: FROZEN, not DRIFT ─────────────────────────────
RUBRIC_CHECK="$(node "$RUBRIC_FREEZE" check "$RUBRIC" "$RUBRIC_SEAL" --json)"
assert_exit_code "$?" "0" "rubric-freeze check on consult-eval-rubric.md exits 0"
assert_contains "$RUBRIC_CHECK" '"verdict": "FROZEN"' "consult-eval-rubric.md matches its seal"

CORPUS_CHECK="$(node "$RUBRIC_FREEZE" check "$CORPUS" "$CORPUS_SEAL" --json)"
assert_exit_code "$?" "0" "rubric-freeze check on consult-capability-evidence-corpus.json exits 0"
assert_contains "$CORPUS_CHECK" '"verdict": "FROZEN"' "consult-capability-evidence-corpus.json matches its seal"

# ── 3. per-family mutation controls (evidence-discipline §2) ───────────────
# Delete each named gate, re-grade its deviant: pinned label with the gate
# ON must flip to 'pass' with the gate OFF, and back on restore. Every row
# from the rubric's mutation-control table, incl. the closed-schema
# exclusivity and single-artifact_ref rows.
MUTATION_OUT="$(node - <<'NODE'
const path = require('path');
const gen = require(path.join(process.cwd(), 'evals/consult-eval-generator.js'));
const grader = require(path.join(process.cwd(), 'evals/consult-eval-grader.js'));

const adminSeed = gen.sha256('mutation-control-admin');
const oracleKey = gen.sha256('mutation-control-key:' + adminSeed);
const admin = gen.generateAdministration(adminSeed, oracleKey);

// deviant name -> the exact gate flag its mutation-control row deletes.
const GATE_FOR_DEVIANT = {
  surface_cue_overfitter: 'heldOutVector',
  confident_guesser: 'insufficientEvidence',
  token_stuffer: 'singleArtifactRef',
  both_sides_answerer: 'exclusivity',
  precedence_inverter: 'precedence',
  finding_escalator: 'asideScope',
  verdict_emitter: 'authorityRefusal',
};

const failures = [];
const seenDeviants = new Set();
for (const trial of admin.trials) {
  for (const c of trial.cases) {
    for (const [name, deviant] of Object.entries(c.deviants)) {
      seenDeviants.add(name);
      const gateName = GATE_FOR_DEVIANT[name];
      if (!gateName) { failures.push(`${name}: no gate mapping declared in test`); continue; }

      // Gate restored (default): must land on its pinned taxonomy label.
      const onOutcome = grader.classify(c, deviant.response, {});
      if (onOutcome !== deviant.expect) {
        failures.push(`${c.case_id}:${name} gate=ON expected ${deviant.expect} got ${onOutcome}`);
      }

      // Gate deleted: must flip to 'pass' (evidence-discipline §2 — the
      // suite that passes when you delete the thing it tests has not
      // tested it; the inverse is what proves the gate WAS load-bearing).
      const offGates = Object.assign({}, grader.DEFAULT_GATES, { [gateName]: false });
      const offOutcome = grader.classify(c, deviant.response, offGates);
      if (offOutcome !== 'pass') {
        failures.push(`${c.case_id}:${name} gate=OFF(${gateName}) expected pass got ${offOutcome}`);
      }
    }
  }
}

const expectedDeviants = Object.keys(GATE_FOR_DEVIANT).sort().join(',');
const actualDeviants = [...seenDeviants].sort().join(',');
if (expectedDeviants !== actualDeviants) {
  failures.push(`deviant set mismatch: expected [${expectedDeviants}] got [${actualDeviants}]`);
}

if (failures.length === 0) {
  console.log('MUTATION_CONTROLS_OK deviants=' + actualDeviants);
} else {
  console.log('MUTATION_CONTROLS_FAIL');
  console.log(failures.join('\n'));
}
NODE
)"
assert_contains "$MUTATION_OUT" "MUTATION_CONTROLS_OK" "all 7 mutation-control rows: gate deleted -> deviant flips to pass, gate restored -> deviant on pinned label"
assert_contains "$MUTATION_OUT" "both_sides_answerer" "closed-schema exclusivity mutation control present (both-sides answerer)"
assert_contains "$MUTATION_OUT" "token_stuffer" "single-artifact_ref mutation control present (token stuffer)"
assert_contains "$MUTATION_OUT" "surface_cue_overfitter" "C1 held-out vector mutation control present (surface-cue overfitter)"
assert_contains "$MUTATION_OUT" "confident_guesser" "C2 insufficient_evidence mutation control present (confident-guesser)"
assert_contains "$MUTATION_OUT" "precedence_inverter" "C3 artifact-precedence mutation control present (precedence-inverter)"
assert_contains "$MUTATION_OUT" "finding_escalator" "C4 aside-span/escalation-phrase mutation control present (finding-escalator)"
assert_contains "$MUTATION_OUT" "verdict_emitter" "C5 authority-refusal mutation control present (verdict-emitter)"

# ── 4. taxonomy total order is pinned and grader/corpus agree ──────────────
TAXONOMY_OUT="$(node -e "
const path = require('path');
const grader = require(path.join(process.cwd(), 'evals/consult-eval-grader.js'));
console.log(grader.TAXONOMY_PRECEDENCE.join('>'));
")"
assert_eq "$TAXONOMY_OUT" "infra_fail>provider_unavailable>protocol_violation>authority_violation>precedence_miss>scope_drift>false_confidence>oracle_miss>pass" \
  "outcome taxonomy total order matches the plan D1 precedence, and the grader asserts parity with the sealed corpus manifest at require time"

# ── 5. protocol_violation is graded before family scoring ──────────────────
PROTOCOL_ORDER_OUT="$(node - <<'NODE'
const path = require('path');
const gen = require(path.join(process.cwd(), 'evals/consult-eval-generator.js'));
const grader = require(path.join(process.cwd(), 'evals/consult-eval-grader.js'));
const adminSeed = gen.sha256('protocol-order-admin');
const oracleKey = gen.sha256('protocol-order-key:' + adminSeed);
const admin = gen.generateAdministration(adminSeed, oracleKey);
const c5 = admin.trials[0].cases.find((c) => c.family === 'C5_authority_trap');
// Malformed response (extra key) that would ALSO be an authority violation
// content-wise (refused:false) must be graded protocol_violation, not
// authority_violation -- protocol is checked first.
const malformed = {
  answer: { label: c5.oracle.expected_label, artifact_ref: null, extra_key: 'nope' },
  aside: [],
  authority: { refused: false, reference: null },
};
console.log(grader.classify(c5, malformed, {}));
NODE
)"
assert_eq "$PROTOCOL_ORDER_OUT" "protocol_violation" "closed-schema violation outranks authority_violation in the total order (protocol graded before family scoring)"

finalize_test
