#!/usr/bin/env bash
# Plan-review roster admission: BL-0108 (stop instead of the silent single-family fallback)
# and BL-0145 (auto-fill seat fallbacks from the topology before the manifest is sealed).
#
# RED/GREEN record (lane a2, 2026-10-14):
#   BL-0108 base: `resolve-review-loop.sh` on a topology without plan_review_panel exits 0,
#     plan_review_resolved_from=native-fallback, opus/high@claude-native, and the only trace is a
#     capability_warnings line; `--field plan_reviewer_engine` prints opus with exit 0.
#   BL-0145 base: a required seat with fallbacks [] whose first attempt returns quota ends the
#     panel as required_seat_transport_exhausted (no substitution is possible).
# Negative controls are asserted below: removing the stop or the fill turns these red.
. "$(dirname "$0")/lib.sh"

RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_FILE AUTOPILOT_QUALIFICATION_OVERRIDE ENGINE_CAPABILITY_DIR

# ---------------------------------------------------------------- BL-0108
CFG="$TEST_TMP/review-loop.md"
printf -- '- plan_review: auto\n- implementer_runner: auto\n' > "$CFG"

STALE_TOPO="$TEST_TMP/stale-topology.json"
cat > "$STALE_TOPO" <<'JSON'
{"schema_version":1,
 "reviewer_ladder":[
  {"engine":"gpt-fixture","effort":"max","runner":"codex","family":"openai","endpoint":""},
  {"engine":"minimax-fixture","effort":"high","runner":"cc-shim","family":"minimax","endpoint":""}],
 "consult_ladder":[
  {"engine":"grok-fixture","effort":"xhigh","runner":"grok","family":"xai","endpoint":""},
  {"engine":"gpt-fixture-b","effort":"high","runner":"codex","family":"openai","endpoint":""}]}
JSON

run_resolver() {
  AUTOPILOT_TOPOLOGY_FILE="$1" REVIEW_LOOP_CONFIG_OVERRIDE="${CFG_USE:-$CFG}" bash "$RESOLVER" "${@:2}" \
    >"$TEST_TMP/r.out" 2>"$TEST_TMP/r.err"
  R_EXIT=$?; R_OUT="$(cat "$TEST_TMP/r.out")"; R_ERR="$(cat "$TEST_TMP/r.err")"
}

# data-only surfaces stay exit 0 on the same stale topology (hooks read these every session)
run_resolver "$STALE_TOPO"
assert_eq "$R_EXIT" "0" "whole-JSON output on a stale topology stays exit 0"
assert_contains "$R_OUT" '"plan_review_resolved_from": "native-fallback"' "whole JSON still reports native-fallback"
run_resolver "$STALE_TOPO" --field reviewer_engine
assert_eq "$R_EXIT" "0" "a non-plan field on a stale topology stays exit 0"
run_resolver "$STALE_TOPO" --field plan_review_max_generations
assert_eq "$R_EXIT" "0" "a plan-review numeric knob (not a roster field) stays exit 0"

# NEGATIVE CONTROL: the default stop. Base behavior was exit 0 + opus; setting the stop back to
# pass-through turns these red.
run_resolver "$STALE_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "4" "stale topology + --field plan_reviewer_engine stops with exit 4 by default"
assert_eq "$R_OUT" "opus" "the stop still prints the field (the value the silent fallback would use)"
for f in plan_review plan_review_resolved_from plan_reviewer_runner plan_deep_reviewer_engine plan_review_same_family_as_depth0; do
  run_resolver "$STALE_TOPO" --field "$f"
  assert_eq "$R_EXIT" "4" "--field $f stops with exit 4"
done
assert_contains "$R_ERR" "gpt-fixture/max@codex [openai]" "stop lists the qualified seats"
assert_contains "$R_ERR" "grok-fixture/xhigh@grok [xai]" "stop lists a second-family seat"
assert_contains "$R_ERR" "recommended: gpt-fixture/max@codex + minimax-fixture/high@cc-shim" \
  "recommendation takes two DISTINCT families (the second openai seat is skipped)"
assert_contains "$R_ERR" "plan_reviewer_engine=gpt-fixture" "stop prints the config values to write"
assert_contains "$R_ERR" "no plan_review_panel key" "stop names the stale-topology cause"

# Round trips on a COPY OF THE FULL SHIPPED TEMPLATE (it carries the keys already, which is where
# an appended duplicate is silently ignored: read_field takes the first match). Each printed
# command must take the same query from exit 4 to exit 0 with no exit 3 on the way.
TEMPLATE="$REPO_ROOT/project-config-template/review-loop-config.md"
run_printed() {  # run_printed <stderr-marker> <config> ; applies the printed command to <config>
  local line cmd
  line="$(printf '%s\n' "$R_ERR" | grep -F "$1" | head -1)"
  cmd="${line#*: }"
  bash -c "$cmd"
}

# accept the single-family fallback
ACC="$TEST_TMP/accept.md"; cp "$TEMPLATE" "$ACC"
CFG_USE="$ACC" run_resolver "$STALE_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "4" "template copy on a stale topology stops"
run_printed "accept the single-family" "$ACC"
CFG_USE="$ACC" run_resolver "$STALE_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "0" "the printed accept command reaches exit 0 even though the template already has the key"
assert_eq "$R_OUT" "opus" "accepted fallback resolves to opus"
assert_eq "$(grep -cE '^- plan_review_allow_native_fallback' "$ACC")" "1" "exactly one key line after appending"
# the key already present as off (first match wins in read_field): the command must REPLACE, not append
ACC2="$TEST_TMP/accept2.md"
{ printf -- '- plan_review_allow_native_fallback: off\n'; cat "$TEMPLATE"; } > "$ACC2"
CFG_USE="$ACC2" run_resolver "$STALE_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "4" "an explicit off keeps the stop"
run_printed "accept the single-family" "$ACC2"
CFG_USE="$ACC2" run_resolver "$STALE_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "0" "the printed command replaces an existing off line (appending would never be read)"
assert_eq "$(grep -cE '^- plan_review_allow_native_fallback' "$ACC2")" "1" "replaced in place, no duplicate"

# write the recommended seats
WR="$TEST_TMP/written.md"; cp "$TEMPLATE" "$WR"
CFG_USE="$WR" run_resolver "$STALE_TOPO" --field plan_review_resolved_from
assert_contains "$R_ERR" "plan_deep_reviewer_runner=cc-shim" "stop prints the deep seat values"
run_printed "write the recommendation" "$WR"
CFG_USE="$WR" run_resolver "$STALE_TOPO" --field plan_review_resolved_from
assert_eq "$R_EXIT" "0" "the printed seat command reaches exit 0 on the full template"
assert_eq "$R_OUT" "config-explicit" "the written seats resolve as config-explicit"
CFG_USE="$WR" run_resolver "$STALE_TOPO"
assert_eq "$R_EXIT" "0" "whole resolve after writing the seats has no exit 3"

# implementer runner filter: implementer on grok, topology offers only grok => nothing recommended
IMPL="$TEST_TMP/impl.md"
printf -- '- plan_review: auto\n- implementer_runner: grok\n- implementer_engine: grok-fixture\n- implementer_effort: high\n' > "$IMPL"
GROK_TOPO="$TEST_TMP/grok-topology.json"
printf '%s' '{"schema_version":1,"consult_ladder":[{"engine":"grok-fixture","effort":"high","runner":"grok","family":"xai","endpoint":""}]}' > "$GROK_TOPO"
CFG_USE="$IMPL" run_resolver "$GROK_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "4" "implementer-runner-only topology still stops"
assert_not_contains "$R_ERR" "grok-fixture/high@grok" "the menu never offers a seat on the implementer runner"
assert_contains "$R_ERR" "none found" "and says no usable seat exists"
# a mixed topology recommends the non-implementer seat only, and the round trip has no exit 3
MIX_TOPO="$TEST_TMP/mix-topology.json"
printf '%s' '{"schema_version":1,"consult_ladder":[{"engine":"grok-fixture","effort":"high","runner":"grok","family":"xai","endpoint":""},{"engine":"gpt-fixture","effort":"max","runner":"codex","family":"openai","endpoint":""}]}' > "$MIX_TOPO"
CFG_USE="$IMPL" run_resolver "$MIX_TOPO" --field plan_reviewer_engine
assert_not_contains "$R_ERR" "grok-fixture/high@grok" "mixed topology: grok seat filtered out"
run_printed "write the recommendation" "$IMPL"
CFG_USE="$IMPL" run_resolver "$MIX_TOPO" --field plan_reviewer_engine
assert_eq "$R_EXIT" "0" "mixed topology round trip: no exit 3 after writing the recommendation"

# no topology at all: still a stop, with the opt-out named
run_resolver "$TEST_TMP/none.json" --field plan_reviewer_runner
assert_eq "$R_EXIT" "4" "absent topology + a plan roster field stops with exit 4"
assert_contains "$R_ERR" "plan_review: off" "no seats: the stop names the explicit opt-out"

# negative control: a topology that DOES carry a panel passes the same flag
GOOD_TOPO="$TEST_TMP/good-topology.json"
cat > "$GOOD_TOPO" <<'JSON'
{"schema_version":1,
 "plan_review_panel":[
  {"engine":"gpt-fixture","effort":"max","runner":"codex","family":"openai","endpoint":""},
  {"engine":"grok-fixture","effort":"xhigh","runner":"grok","family":"xai","endpoint":""}],
 "reviewer_ladder":[],"consult_ladder":[]}
JSON
run_resolver "$GOOD_TOPO" --field plan_review_resolved_from
assert_eq "$R_EXIT" "0" "a topology with plan_review_panel is not stopped"
assert_eq "$R_OUT" "topology" "resolved from topology"

# ---------------------------------------------------------------- BL-0145
PR="$REPO_ROOT/scripts/dispatch-plan-review.js"
PR_REPO="$TEST_TMP/pr-repo"
mkdir -p "$PR_REPO"
git -C "$PR_REPO" init -q
printf '%s\n' '# Plan' 'Slice.' > "$PR_REPO/plan.md"
printf '%s\n' '# Rubric' '- R1: readiness' > "$PR_REPO/rubric.md"
READY="$TEST_TMP/ready.json"; printf '{"verdict":"READY","findings":[]}' > "$READY"
EMPTY="$TEST_TMP/empty.raw"; : > "$EMPTY"
STATE="$TEST_TMP/pr-state"

jf() {
  node -e '
const doc = JSON.parse(process.argv[1]);
const v = process.argv[2].split(".").reduce((a, k) => (a == null ? a : a[k]), doc);
process.stdout.write(v == null ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)));
' "$1" "$2" 2>/dev/null
}

# One required seat with fallbacks [] (the hand-written shape the backlog item describes).
mk_manifest() {
  node - "$1" "$2" <<'NODE'
const fs = require('fs');
const [out, logical] = process.argv.slice(2);
fs.writeFileSync(out, JSON.stringify({
  schema_version: 1, artifact_type: 'plan_review_manifest', logical_plan_id: logical,
  minimum_distinct_families: 1, max_attempts_per_seat: 2,
  seats: [{ id: 'architect', runner: 'codex', model: 'gpt-fixture', effort: 'high',
    endpoint: 'default', role: 'architecture', family: 'openai', readiness_status: 'ready',
    qualification_status: 'qualified', required: true, excluded_families: [], fallbacks: [] }],
}, null, 2) + '\n');
NODE
}

# topology with one same-family candidate (openai) and one different-family candidate (xai)
TOPO_OK="$TEST_TMP/pr-topo-ok.json"
cat > "$TOPO_OK" <<'JSON'
{"plan_review_panel":[{"engine":"gpt-other","effort":"high","runner":"codex","family":"openai","endpoint":""}],
 "reviewer_ladder":[],
 "consult_ladder":[{"engine":"grok-fixture","effort":"high","runner":"grok","family":"xai","endpoint":""}]}
JSON
# topology whose ONLY candidate shares the primary's family
TOPO_SAME="$TEST_TMP/pr-topo-same.json"
cat > "$TOPO_SAME" <<'JSON'
{"plan_review_panel":[{"engine":"gpt-other","effort":"high","runner":"codex","family":"openai","endpoint":""}],
 "reviewer_ladder":[],"consult_ladder":[]}
JSON

SEQ="$(node -e '
const [e, r] = process.argv.slice(1);
process.stdout.write(JSON.stringify({
  architect: [{ file: e, classification: "quota" }],
  "auto-fb-architect-1": [{ file: r, classification: "success" }],
}));' "$EMPTY" "$READY")"

run_pr() {  # run_pr <ticket> <manifest> <topology> [extra args]
  local ticket="$1" manifest="$2" topo="$3"
  shift 3
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_TOPOLOGY_FILE="$topo" \
  REVIEW_LOOP_CONFIG_OVERRIDE="${PR_CFG:-$CFG}" \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$SEQ" \
    node "$PR" --repo-root "$PR_REPO" --plan-file "$PR_REPO/plan.md" --rubric-file "$PR_REPO/rubric.md" \
      --ticket "$ticket" --session-id "s-$ticket" --generation 1 --manifest-file "$manifest" \
      --state-dir "$STATE" --allow-unregistered "$@" >"$TEST_TMP/pr.out" 2>"$TEST_TMP/pr.err"
  PR_EXIT=$?; PR_OUT="$(cat "$TEST_TMP/pr.out")"; PR_ERR="$(cat "$TEST_TMP/pr.err")"
}

# negative control 1: no fill (opt-out) => the quota seat cannot be replaced (the base behavior)
M1="$TEST_TMP/pr-m1.json"; mk_manifest "$M1" prr-nofill
run_pr nofill "$M1" "$TOPO_OK" --no-topology-fallbacks
assert_neq "$PR_EXIT" "0" "opt-out: a required seat out of quota with no fallback fails the panel"
assert_contains "$PR_OUT" "required_seat_transport_exhausted" "opt-out: the panel reason is required_seat_transport_exhausted"
assert_contains "$PR_ERR" "required seat has no fallback" "opt-out: the empty required seat is warned about"

# the fix: topology fills the fallback, the quota seat is substituted
M2="$TEST_TMP/pr-m2.json"; mk_manifest "$M2" prr-fill
run_pr fill "$M2" "$TOPO_OK"
assert_eq "$PR_EXIT" "0" "topology fill: the panel completes after the quota attempt"
assert_eq "$(jf "$PR_OUT" verdict)" "READY" "topology fill: the substitute's verdict is used"
assert_contains "$PR_OUT" "retry_substitution" "topology fill: substitution.reason is retry_substitution"
assert_contains "$PR_OUT" "auto-fb-architect-1" "topology fill: the substitute is the auto-filled seat"
assert_contains "$PR_ERR" "family xai" "topology fill: the xai candidate was chosen, not the openai one"
assert_not_contains "$PR_ERR" "required seat has no fallback" "topology fill: no warning when a fallback exists"
SEALED="$(grep -rl "auto-fb-architect-1" "$STATE" --include=manifest.json | head -1)"
assert_contains "$(cat "$SEALED")" "auto-fb-architect-1" "the filled manifest is the sealed copy (fill happens before the seal)"

# negative control 2: the only candidate shares the primary's family => must NOT be added
M3="$TEST_TMP/pr-m3.json"; mk_manifest "$M3" prr-same
run_pr same "$M3" "$TOPO_SAME"
assert_neq "$PR_EXIT" "0" "same-family-only topology: nothing is substituted"
assert_not_contains "$PR_ERR" "added auto-fb" "same-family-only topology: no fallback is added"
assert_contains "$PR_ERR" "required seat has no fallback" "same-family-only topology: the required seat still warns"

# negative control 3: a candidate on the implementer's own runner is never added (same rule the
# resolver applies to config-declared seats)
IMPL_CFG="$TEST_TMP/impl-grok.md"
printf -- '- implementer_runner: grok\n- implementer_engine: grok-fixture\n- implementer_effort: high\n' > "$IMPL_CFG"
M4="$TEST_TMP/pr-m4.json"; mk_manifest "$M4" prr-implrunner
PR_CFG="$IMPL_CFG" run_pr implrunner "$M4" "$TOPO_OK"
assert_not_contains "$PR_ERR" "added auto-fb" "implementer-runner candidate (grok) is not added as a fallback"

# the sealed copy survives a topology change: the second call must not report manifest drift
run_pr fill "$M2" "$TOPO_SAME"
assert_not_contains "$PR_ERR" "drifted" "a topology change after the seal is not manifest drift"

# an edited manifest FILE is still drift (identity check unchanged by the fill)
node -e 'const f=process.argv[1];const m=JSON.parse(require("fs").readFileSync(f));m.seats[0].model="gpt-edited";require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")' "$M2"
run_pr fill "$M2" "$TOPO_OK"
assert_contains "$PR_ERR" "drifted" "editing the manifest file after the seal is still refused"

finalize_test
