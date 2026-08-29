#!/usr/bin/env bash
# hooks/tests/honest-consult-discuss-solver.test.sh
#
# Wires hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js into the L2
# suite (hooks/tests/run.sh globs *.test.sh, not hooks/tests/lib/*.test.js —
# a .test.js dropped directly into lib/ would never run). This IS the
# permanent guard the branch harden/consult-discuss-instrument-e2e exists to
# add: an honest, envelope-only candidate drives the FULL consult (C1-C5) and
# discuss (D-a..D-d) administrations end to end (generator ->
# buildConsultCaseEnvelope/buildDiscussCaseEnvelope -> solver -> grader) and
# every case must grade 'pass'. Unlike scripts/engine-qualify-consult.test.js
# / -discuss.test.js (which regenerate the sealed administration and answer
# from caseSpec.reference_response -- information no real engine has), this
# solver sees ONLY the parsed envelope object; any information-gap or
# grader-over-strictness regression makes it go red. See the .js file's own
# header for the full design rationale and the planted-negative teeth proof.
. "$(dirname "$0")/lib.sh"

E2E="$REPO_ROOT/hooks/tests/lib/honest-consult-discuss-solver-e2e.test.js"
SOLVER="$REPO_ROOT/hooks/tests/lib/honest-consult-discuss-solver.js"

assert_file_exists "$SOLVER" "honest envelope-only solver module exists"
assert_file_exists "$E2E" "honest-solver end-to-end driver exists"

OUT="$(node "$E2E" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "honest-solver end-to-end driver exits 0 (every consult + discuss case passes from envelope-only information)"
assert_contains "$OUT" "consult (honest, envelope-only):" "driver ran the consult administration"
assert_contains "$OUT" "discuss (honest, envelope-only):" "driver ran the discuss administration"
assert_contains "$OUT" "C1_grounded_answer: 4/4" "C1 4/4 (2 trials x 2 cases) from envelope-only information"
assert_contains "$OUT" "C2_insufficient_evidence: 4/4" "C2 4/4 from envelope-only information"
assert_contains "$OUT" "C3_contradictory_primary_artifacts: 4/4" "C3 4/4 from envelope-only information"
assert_contains "$OUT" "C4_scope_discipline: 4/4" "C4 4/4 from envelope-only information"
assert_contains "$OUT" "C5_authority_trap: 4/4" "C5 4/4 from envelope-only information"
assert_contains "$OUT" "D-a: 4/4" "D-a 4/4 from envelope-only information"
assert_contains "$OUT" "D-b: 4/4" "D-b 4/4 from envelope-only information"
assert_contains "$OUT" "D-c: 4/4" "D-c 4/4 from envelope-only information"
assert_contains "$OUT" "D-d: 4/4" "D-d 4/4 from envelope-only information"
assert_contains "$OUT" "PASS (" "driver reports its own pass summary"

# Determinism: consult's generator is seeded but the driver pins its own
# fixed adminSeed/oracleKey (not the crypto-random kernel nonce) so repeated
# runs must be byte-identical.
OUT2="$(node "$E2E" 2>&1)"
assert_eq "$OUT" "$OUT2" "honest-solver driver output is deterministic across repeated runs"

finalize_test
