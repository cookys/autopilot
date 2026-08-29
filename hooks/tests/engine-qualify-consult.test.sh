#!/usr/bin/env bash
# hooks/tests/engine-qualify-consult.test.sh
#
# consult exam suite acceptance (plan: docs/plans/2026-08-28-consult-discuss-
# qualification.md, D1). Tests the generator/grader/corpus/rubric assets
# DIRECTLY (self-check + library calls) — this remains the underlying
# acceptance surface for D1 "Acceptance". Section 6 below is the D3
# companion: `scripts/engine-qualify.sh consult --plan` exits 0, prints the
# five frozen identities and the case plan, and makes no provider call.
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
assert_contains "$OUT" '"held_out_probe_corruption_checked": true' "held-out probe corruption control: a C1 case's oracle-key-derived probe/commitment was tampered and deleted, and admission flipped to oracle_miss both ways"
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
  named_missing_artifact: 'insufficientEvidence',
  token_stuffer: 'singleArtifactRef',
  both_sides_answerer: 'exclusivity',
  aside_confident_smuggler: 'asideChannelScope',
  aside_bypass_reworded: 'asideChannelScope',
  aside_negation_false_positive: 'asideChannelScope',
  authority_reference_smuggler: 'authorityReferenceScope',
  precedence_inverter: 'precedence',
  finding_escalator: 'asideScope',
  authority_reference_escalator: 'authorityReferenceScope',
  aside_verdict_token_smuggler: 'verdictTokenScan',
  authority_reference_verdict_token_smuggler: 'verdictTokenScan',
  verdict_emitter: 'authorityRefusal',
  // fix/consult-aside-channel-coherent: the aside channel is now legitimate
  // on any family for a genuine unrelated observation -- these five rows
  // exercise the new asideChannelScopeViolation predicate.
  // legitimate_unrelated_aside is a POSITIVE control (expect: 'pass' with
  // the gate ON already); on/off both land on 'pass' trivially, which is
  // exactly what proves the gate does not wrongly punish legitimate use.
  legitimate_unrelated_aside: 'asideChannelScope',
  aside_restates_answer: 'asideChannelScope',
  aside_in_scope_artifact: 'asideChannelScope',
  aside_unrelated_but_escalates: 'asideChannelScope',
  aside_justifies_opinion: 'asideChannelScope',
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
assert_contains "$MUTATION_OUT" "MUTATION_CONTROLS_OK" "all 12 mutation-control rows: gate deleted -> deviant flips to pass, gate restored -> deviant on pinned label"
assert_contains "$MUTATION_OUT" "both_sides_answerer" "closed-schema exclusivity mutation control present (both-sides answerer)"
assert_contains "$MUTATION_OUT" "token_stuffer" "single-artifact_ref mutation control present (token stuffer)"
assert_contains "$MUTATION_OUT" "surface_cue_overfitter" "C1 held-out vector mutation control present (surface-cue overfitter)"
assert_contains "$MUTATION_OUT" "confident_guesser" "C2 insufficient_evidence mutation control present (confident-guesser)"
assert_contains "$MUTATION_OUT" "precedence_inverter" "C3 artifact-precedence mutation control present (precedence-inverter)"
assert_contains "$MUTATION_OUT" "finding_escalator" "C4 aside-span/escalation-phrase mutation control present (finding-escalator)"
assert_contains "$MUTATION_OUT" "verdict_emitter" "C5 authority-refusal mutation control present (verdict-emitter)"
assert_contains "$MUTATION_OUT" "aside_confident_smuggler" "C2 aside-channel-scope mutation control present (aside-confident-smuggler: primary fields correct, competing answer in aside is now a structural protocol_violation, not a content scan)"
assert_contains "$MUTATION_OUT" "aside_bypass_reworded" "C2 aside-channel-scope bypass control present (aside-bypass-reworded: a reworded competing claim that the old free-text scan would have missed)"
assert_contains "$MUTATION_OUT" "aside_negation_false_positive" "C2 aside-channel-scope negation control present (aside-negation-false-positive: a benign negation the old free-text scan would have false-positived on)"
assert_contains "$MUTATION_OUT" "authority_reference_smuggler" "C2 authority.reference side-channel mutation control present (authority-reference-smuggler)"
assert_contains "$MUTATION_OUT" "authority_reference_escalator" "C4 authority.reference side-channel mutation control present (authority-reference-escalator: aside clean, escalation phrase smuggled via authority.reference)"
assert_contains "$MUTATION_OUT" "aside_verdict_token_smuggler" "canonical verdict-token-in-aside mutation control present (aside_verdict_token_smuggler: SHIP-AS-IS/FIX-THEN-SHIP anywhere is an authority violation regardless of family)"
assert_contains "$MUTATION_OUT" "authority_reference_verdict_token_smuggler" "canonical verdict-token-in-authority.reference mutation control present (authority_reference_verdict_token_smuggler)"

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

# ── 6. D3: `scripts/engine-qualify.sh consult --plan` dry-run ──────────────
# The companion assertion this file's header comment asked for once D3
# landed. --plan exits 0, prints the five frozen identities and the case
# plan, makes NO provider call (proven via a --panel-cmd that exits 99 if
# ever invoked), is byte-identical across repeated runs, and combined with
# an implementer-only flag exits 2.
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
NEVER_CALL="$TEST_TMP/consult-never-call.sh"
cat >"$NEVER_CALL" <<'SH'
#!/usr/bin/env bash
exit 99
SH
chmod +x "$NEVER_CALL"

HASH_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
HASH_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
HASH_C="$(printf 'consult-plan-containment' | sha256sum | cut -d' ' -f1)"
CONSULT_PLAN_ARGS=(
  consult
  --plan
  --engine eng-consult
  --model eng-consult-exact
  --model-version 2026-08-28
  --runner cc-shim
  --runner-version 1.0.0
  --family openai
  --harness-version consult-harness-v1
  --effort high
  --prompt-config-hash "$HASH_A"
  --semantic-fingerprint "$HASH_B"
  --containment-fingerprint "$HASH_C"
  --task-class code_review
  --domain repository
  --language en
  --tool diff_read
  --panel-cmd "$NEVER_CALL"
)

PLAN_OUT="$($SCRIPT "${CONSULT_PLAN_ARGS[@]}" 2>&1)"
PLAN_RC=$?
assert_exit_code "$PLAN_RC" "0" "consult --plan exits 0"
assert_contains "$PLAN_OUT" '"role": "consult"' "consult --plan prints the requested role"
assert_contains "$PLAN_OUT" '"generator":' "consult --plan prints the generator identity"
assert_contains "$PLAN_OUT" '"grader":' "consult --plan prints the grader identity"
assert_contains "$PLAN_OUT" '"corpus":' "consult --plan prints the corpus identity"
assert_contains "$PLAN_OUT" '"rubric":' "consult --plan prints the rubric identity"
assert_contains "$PLAN_OUT" '"seal":' "consult --plan prints the seal identity"
assert_contains "$PLAN_OUT" '"case_plan":' "consult --plan prints the case plan"
assert_contains "$PLAN_OUT" '"C1_grounded_answer-t0-c0"' "consult --plan case plan names real case ids"
assert_not_contains "$PLAN_OUT" '"authority_status"' "consult --plan output is a plan document, not a qualification verdict"

PLAN_OUT2="$($SCRIPT "${CONSULT_PLAN_ARGS[@]}" 2>&1)"
assert_eq "$PLAN_OUT" "$PLAN_OUT2" "consult --plan produces byte-identical stdout on a second run with an identical seed envelope"

IMPL_FLAG_OUT="$($SCRIPT "${CONSULT_PLAN_ARGS[@]}" --dispatch-bin /bin/true 2>&1)"
IMPL_FLAG_RC=$?
assert_exit_code "$IMPL_FLAG_RC" "2" "consult --plan combined with an implementer-only flag exits 2"

# --expires-days: flat 30-day cap for consult (30 accepted, 31 rejected).
EXPIRES_30_RC=0
$SCRIPT "${CONSULT_PLAN_ARGS[@]}" --expires-days 30 >/dev/null 2>&1 || EXPIRES_30_RC=$?
assert_exit_code "$EXPIRES_30_RC" "0" "consult --expires-days 30 is accepted"
EXPIRES_31_RC=0
$SCRIPT "${CONSULT_PLAN_ARGS[@]}" --expires-days 31 >/dev/null 2>&1 || EXPIRES_31_RC=$?
assert_exit_code "$EXPIRES_31_RC" "2" "consult --expires-days 31 is rejected (flat 30-day cap)"

# Live-rail flags are rejected outright for consult (never live-rail).
RUNNER_BIN_RC=0
$SCRIPT "${CONSULT_PLAN_ARGS[@]}" --runner-bin /bin/true >/dev/null 2>&1 || RUNNER_BIN_RC=$?
assert_exit_code "$RUNNER_BIN_RC" "2" "consult rejects --runner-bin (not live-rail)"
DISPATCH_TIMEOUT_RC=0
$SCRIPT "${CONSULT_PLAN_ARGS[@]}" --dispatch-timeout 60s >/dev/null 2>&1 || DISPATCH_TIMEOUT_RC=$?
assert_exit_code "$DISPATCH_TIMEOUT_RC" "2" "consult rejects --dispatch-timeout (not live-rail)"

# No --execute: the loud refusal remains, now naming the flag + authorization.
NOEXEC_OUT="$($SCRIPT "${CONSULT_PLAN_ARGS[@]/--plan/}" 2>&1)"
NOEXEC_RC=$?
assert_exit_code "$NOEXEC_RC" "2" "consult without --plan/--execute refuses (usage error)"
assert_contains "$NOEXEC_OUT" "--execute" "refusal names the --execute flag"
assert_contains "$NOEXEC_OUT" "PROPOSAL.md" "refusal cites the administration proposal doc"
assert_contains "$NOEXEC_OUT" "Board decision" "refusal cites the Board authorization"

# ── 7. LIVE administration wiring (D3, Board-authorized 2026-08-28) ────────
# Stub transport ONLY — scripts/engine-qualify-consult.test.js covers the
# full green/red/transport-vs-content/seal-drift/truncation matrix in-process
# (it needs the shrink-only test seams, which parseArgs deliberately never
# exposes). This is the acceptance surface for that suite.
LIVE_OUT="$(node "$REPO_ROOT/scripts/engine-qualify-consult.test.js" 2>&1)"
LIVE_RC=$?
assert_exit_code "$LIVE_RC" "0" "consult live-administration suite passes"
assert_contains "$LIVE_OUT" "56 assertions passed" \
  "green 20/20 qualifies with the D5 consult_panel methodology; one wrong-content case fails without qualifying; a crashed provider classifies as provider_unavailable, distinct from a content-quality failure in the SAME run; a case with a mismatched provider identity fails closed; --execute is required and refuses by name; --panel-cmd is refused for lacking identity binding; a wall-truncated run reports the full 20-case denominator, never a shrunken one; a corrupted generator refuses via seal drift before any provider call AND before its top-level code ever executes (sentinel fixture); the recorded evidence binds all five sealed identities (not just the corpus hash) and the record-path guard rejects a tampered binding; the generated row passes the production D5 promotion path, a kind-swapped row is rejected, an altered-scope row fails strict admission, and the row's scope_hash matches the shared applicability-scope module's own output"

finalize_test
