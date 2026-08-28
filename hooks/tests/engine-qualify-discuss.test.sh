#!/usr/bin/env bash
# hooks/tests/engine-qualify-discuss.test.sh
#
# Suite tests for the discuss qualification exam (D2,
# docs/plans/2026-08-28-consult-discuss-qualification.md). Exercises the
# generator, grader and corpus directly, which is where all of D2's scored
# logic lives. The final section is the D3 companion: `scripts/engine-
# qualify.sh discuss --plan` exits 0 and prints the five frozen identities
# without any provider call.
. "$(dirname "$0")/lib.sh"

GEN="$REPO_ROOT/evals/discuss-eval-generator.js"
RUBRIC="$REPO_ROOT/evals/discuss-eval-rubric.md"
RUBRIC_SEAL="$REPO_ROOT/evals/discuss-eval-rubric.seal.json"
CORPUS="$REPO_ROOT/evals/discuss-capability-evidence-corpus.json"
CORPUS_SEAL="$REPO_ROOT/evals/discuss-capability-evidence-corpus.seal.json"

assert_file_exists "$GEN" "generator ships"
assert_file_exists "$REPO_ROOT/evals/discuss-eval-grader.js" "grader ships"
assert_file_exists "$CORPUS" "corpus manifest ships"
assert_file_exists "$RUBRIC" "rubric ships"
assert_file_exists "$RUBRIC_SEAL" "rubric seal ships"
assert_file_exists "$CORPUS_SEAL" "corpus seal ships"

# ── 1. full self-check (generator + grader + corpus, one pass) ────────────

out=$(node "$GEN" --self-check 2>&1); rc=$?
assert_exit_code "$rc" 0 "generator --self-check exits 0"
assert_contains "$out" "PASS (16 cases)" "self-check reports the full 16-case administration"

# ── 2. admission gates (solvability / trap / overfitter / negative control) ─

admission_json=$(node -e '
const g = require("'"$GEN"'");
const cases = g.buildAdministration();
const r = g.runAdmissionGates(cases);
process.stdout.write(JSON.stringify(r));
')
rc=$?
assert_exit_code "$rc" 0 "admission gates run"
v=$(printf '%s' "$admission_json" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.solvability))')
assert_eq "$v" "true" "admission: solvability — every reference answer reaches pass"
v=$(printf '%s' "$admission_json" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.trapDiscrimination))')
assert_eq "$v" "true" "admission: trap discrimination — each family's canonical deviant lands on its pinned label"
v=$(printf '%s' "$admission_json" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.overfitterDiscrimination))')
assert_eq "$v" "true" "admission: overfitter discrimination — the canonical deviant is distinguishable from the reference"
v=$(printf '%s' "$admission_json" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.negativeControl))')
assert_eq "$v" "true" "admission: negative control — in-process-green / sandboxed-grader-red pair diverges"

# ── 3. one-shot reachability — every case is a stateless 3-round bundle,
#      never asks the seat to revise its own earlier output ───────────────

reach=$(node -e '
const g = require("'"$GEN"'");
const cases = g.buildAdministration();
const bad = cases.filter((c) => c.transcript.length !== 3 || c.transcript.some((r) => r.role === "candidate"));
process.stdout.write(bad.length === 0 ? "ok" : "bad:" + bad.map((c) => c.case_id).join(","));
')
assert_eq "$reach" "ok" "one-shot reachability: every case is exactly a 3-round transcript answered at round 4, never revising the seat's own prior output"

# ── 4. symmetry control (D-a / D-b visible bytes differ only in the
#      evidence-bearing span) ───────────────────────────────────────────────

sym=$(node -e '
const g = require("'"$GEN"'");
const cases = g.buildAdministration();
const r = g.runSymmetryControl(cases);
process.stdout.write(JSON.stringify(r));
')
v=$(printf '%s' "$sym" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.pass))')
assert_eq "$v" "true" "symmetry control: D-a/D-b pairs are byte-identical outside the evidence-bearing span"

# ── 5. novelty-oracle-mechanical — D-c grading is corpus-declared axis
#      matching, never derived from the candidate's own answer ───────────

novelty=$(node -e '
const gen = require("'"$GEN"'");
const grader = require("'"$REPO_ROOT"'/evals/discuss-eval-grader.js");
const c = gen.buildNoveltyCase(0, 0);
// Two structurally different, equally schema-valid responses selecting the
// SAME untaken axis must be graded against the SAME (corpus-declared,
// transcript-fixed) taken-axis set — not a set derived from either response.
const untaken = c.oracle.selected_axis;
const ownToken = c.oracle.own_token;
const r1 = { round_id: "x1", axis_id: untaken, claim_vector: [ownToken], position: "alpha", risk_tags: ["minor"], anchors: [] };
const r2 = { round_id: "x2", axis_id: untaken, claim_vector: [ownToken], position: "totally different prose, same structure", risk_tags: ["critical"], anchors: [] };
const o1 = grader.gradeContribution(c, r1);
const o2 = grader.gradeContribution(c, r2);
process.stdout.write(o1.label === "pass" && o2.label === "pass" ? "ok" : "bad:" + o1.label + "/" + o2.label);
')
assert_eq "$novelty" "ok" "novelty-oracle-mechanical: axis novelty is decided by corpus-declared axes + transcript, independent of prose"

# ── 6. structured-vs-prose precedence — position text is never graded ─────

prose=$(node -e '
const gen = require("'"$GEN"'");
const grader = require("'"$REPO_ROOT"'/evals/discuss-eval-grader.js");
const c = gen.buildNoveltyCase(0, 0);
const d = c.deviants["plausible-prose-deviant"];
const o = grader.gradeContribution(c, d.response);
process.stdout.write(o.label);
')
assert_eq "$prose" "pass" "structured-vs-prose precedence: a duplicative/contradictory position with a valid untaken axis_id and matching claim_vector still PASSes"

# ── 7. D4 mutation-control rows relevant to discuss ────────────────────────

mutation=$(node -e '
const g = require("'"$GEN"'");
const cases = g.buildAdministration();
const r = g.runMutationControls(cases);
process.stdout.write(JSON.stringify(r));
')
v=$(printf '%s' "$mutation" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.pass))')
if [ "$v" != "true" ]; then
  printf '%s\n' "$mutation" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));d.failures.forEach((f)=>console.error(" - " + f))' >&2
fi
assert_eq "$v" "true" "mutation controls: every D4 row (evidence-span, axis-novelty, anchor-existence, axis_id cardinality, claim_vector binding, claim-token membership, anchor-resolvability, D-a/D-b own-axis binding, D-a stance exclusivity, D-d claim-token binding, cross-axis token-stuffing membership on D-a/D-b/D-d, no-verdict guard) — gate deleted flips its deviant to pass, gate restored lands it back on its pinned label"

# Named per-row assertions (so a single silently-broken row cannot hide
# inside the aggregate boolean above).
for row in \
  "D-a:always-contradict:evidence_blindness" \
  "D-b:always-follow-transcript:sycophantic_capitulation" \
  "D-c:restater:protocol_violation" \
  "D-c:all-axis-emitter:protocol_violation" \
  "D-c:first-untaken-axis-picker:zero_information" \
  "D-c:wrong-axis-responder:zero_information" \
  "D-d:fabricator:fabricated_anchor" \
  "D-d:cite-everything-responder:protocol_violation" \
  "D-a:wrong-axis-label:zero_information" \
  "D-b:wrong-axis-label:zero_information" \
  "D-a:contradictory-stance:evidence_blindness" \
  "D-d:off-axis-claim:zero_information" \
  "D-a:mixed-vector:zero_information" \
  "D-b:mixed-vector:zero_information" \
  "D-d:mixed-vector:zero_information" \
  "D-c:verdict-in-position:protocol_violation" \
; do
  fam="${row%%:*}"; rest="${row#*:}"; dev="${rest%%:*}"; expected="${rest#*:}"
  got=$(node -e '
const gen = require("'"$GEN"'");
const grader = require("'"$REPO_ROOT"'/evals/discuss-eval-grader.js");
const cases = gen.buildAdministration();
const c = cases.find((x) => x.family === "'"$fam"'" && x.deviants["'"$dev"'"]);
if (!c) { process.stdout.write("no-case"); process.exit(0); }
const o = grader.gradeContribution(c, c.deviants["'"$dev"'"].response);
process.stdout.write(o.label);
')
  assert_eq "$got" "$expected" "deviant $fam/$dev restored gate lands on pinned label $expected"
done

# ── 8. rubric + corpus seals FROZEN ────────────────────────────────────────

node "$REPO_ROOT/scripts/rubric-freeze.js" check "$RUBRIC" "$RUBRIC_SEAL" >/dev/null 2>&1
assert_exit_code "$?" 0 "rubric seal check: FROZEN"

node "$REPO_ROOT/scripts/rubric-freeze.js" check "$CORPUS" "$CORPUS_SEAL" >/dev/null 2>&1
assert_exit_code "$?" 0 "corpus seal check: FROZEN"

# ── D3: `scripts/engine-qualify.sh discuss --plan` dry-run ─────────────────
# The companion assertion this file's header comment asked for once D3
# landed (mirrors engine-qualify-consult.test.sh's D3 section).
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
NEVER_CALL="$TEST_TMP/discuss-never-call.sh"
cat >"$NEVER_CALL" <<'SH'
#!/usr/bin/env bash
exit 99
SH
chmod +x "$NEVER_CALL"

HASH_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
HASH_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
HASH_C="$(printf 'discuss-plan-containment' | sha256sum | cut -d' ' -f1)"
DISCUSS_PLAN_ARGS=(
  discuss
  --plan
  --engine eng-discuss
  --model eng-discuss-exact
  --model-version 2026-08-28
  --runner cc-shim
  --runner-version 1.0.0
  --family openai
  --harness-version discuss-harness-v1
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

PLAN_OUT="$($SCRIPT "${DISCUSS_PLAN_ARGS[@]}" 2>&1)"
PLAN_RC=$?
assert_exit_code "$PLAN_RC" "0" "discuss --plan exits 0"
assert_contains "$PLAN_OUT" '"role": "discuss"' "discuss --plan prints the requested role"
assert_contains "$PLAN_OUT" '"generator":' "discuss --plan prints the generator identity"
assert_contains "$PLAN_OUT" '"grader":' "discuss --plan prints the grader identity"
assert_contains "$PLAN_OUT" '"corpus":' "discuss --plan prints the corpus identity"
assert_contains "$PLAN_OUT" '"rubric":' "discuss --plan prints the rubric identity"
assert_contains "$PLAN_OUT" '"seal":' "discuss --plan prints the seal identity"
assert_contains "$PLAN_OUT" '"case_plan":' "discuss --plan prints the case plan"
assert_not_contains "$PLAN_OUT" '"authority_status"' "discuss --plan output is a plan document, not a qualification verdict"

PLAN_OUT2="$($SCRIPT "${DISCUSS_PLAN_ARGS[@]}" 2>&1)"
assert_eq "$PLAN_OUT" "$PLAN_OUT2" "discuss --plan produces byte-identical stdout on a second run with an identical seed envelope"

IMPL_FLAG_OUT="$($SCRIPT "${DISCUSS_PLAN_ARGS[@]}" --dispatch-bin /bin/true 2>&1)"
IMPL_FLAG_RC=$?
assert_exit_code "$IMPL_FLAG_RC" "2" "discuss --plan combined with an implementer-only flag exits 2"

EXPIRES_30_RC=0
$SCRIPT "${DISCUSS_PLAN_ARGS[@]}" --expires-days 30 >/dev/null 2>&1 || EXPIRES_30_RC=$?
assert_exit_code "$EXPIRES_30_RC" "0" "discuss --expires-days 30 is accepted"
EXPIRES_31_RC=0
$SCRIPT "${DISCUSS_PLAN_ARGS[@]}" --expires-days 31 >/dev/null 2>&1 || EXPIRES_31_RC=$?
assert_exit_code "$EXPIRES_31_RC" "2" "discuss --expires-days 31 is rejected (flat 30-day cap)"

RUNNER_BIN_RC=0
$SCRIPT "${DISCUSS_PLAN_ARGS[@]}" --runner-bin /bin/true >/dev/null 2>&1 || RUNNER_BIN_RC=$?
assert_exit_code "$RUNNER_BIN_RC" "2" "discuss rejects --runner-bin (not live-rail)"
DISPATCH_TIMEOUT_RC=0
$SCRIPT "${DISCUSS_PLAN_ARGS[@]}" --dispatch-timeout 60s >/dev/null 2>&1 || DISPATCH_TIMEOUT_RC=$?
assert_exit_code "$DISPATCH_TIMEOUT_RC" "2" "discuss rejects --dispatch-timeout (not live-rail)"

finalize_test
