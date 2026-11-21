#!/usr/bin/env bash
# Plan-loop generation-cap repair recheck, generation-2 demotion, usage/duration fields.
# Stub runners only (the plan-review response-sequence seam); no real CLI, fleet or endpoint is called.
export AUTOPILOT_TEST_CN_GATE_OFF=1  # cn-model gate: fixture seats carry no data class
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
SCHEMA_CHECK="$REPO_ROOT/scripts/validate-json-schema.js"
ARTIFACT_SCHEMA="$REPO_ROOT/schemas/plan-review-artifact.schema.json"
FIX="$REPO_ROOT/hooks/tests/fixtures/repair-recheck"
PR_FIX="$REPO_ROOT/hooks/tests/fixtures/plan-review"
G2="$FIX/g2-artifact.json"
WORK="$TEST_TMP/work"
mkdir -p "$WORK/repo"
git -C "$WORK/repo" init -q
cp "$FIX/repaired-plan.md" "$WORK/repo/plan.md"
G2_SHA_BEFORE="$(sha256sum "$G2" | cut -d' ' -f1)"

json_field() {
  node -e '
let value = JSON.parse(process.argv[1]);
for (const part of process.argv[2].split(".")) {
  if (value === null || typeof value !== "object" || !(part in value)) process.exit(2);
  value = value[part];
}
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
' "$1" "$2"
}

# manifest <out> <family:runner:effort>...  — one seat per spec, all ready and qualified.
make_manifest() {
  local out="$1"; shift
  node - "$out" "$@" <<'NODE'
const fs = require('fs');
const [out, ...specs] = process.argv.slice(2);
const seats = specs.map((spec, i) => {
  const [family, runner, effort] = spec.split(':');
  return {
    id: `seat${i}`, runner, model: `${family}-fixture`, effort, endpoint: 'default', role: 'review',
    family, readiness_status: 'ready', qualification_status: 'qualified', required: true,
    excluded_families: [], fallbacks: [],
  };
});
fs.writeFileSync(out, `${JSON.stringify({
  schema_version: 1, artifact_type: 'plan_review_manifest', logical_plan_id: 'rcap-fixture',
  minimum_distinct_families: 1, max_attempts_per_seat: 2, seats,
}, null, 2)}\n`);
NODE
}

# answers <mode> <out>: stub reviewer answer for the 18 blockers of the real generation-2 artifact.
make_answer() {
  node - "$G2" "$1" "$2" <<'NODE'
const fs = require('fs');
const [artifact, mode, out] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(artifact, 'utf8')).findings
  .filter((f) => f.candidate_blocker && f.disposition == null).map((f) => f.fingerprint);
const results = ids.map((id, i) => ({
  id,
  status: mode === 'two-not-fixed' && i < 2 ? 'not_fixed' : 'fixed',
  reason: mode === 'two-not-fixed' && i < 2 ? 'the repaired section still contradicts the claim' : 'the repaired section resolves the claim',
}));
const body = { results };
if (mode === 'extra-key') body.new_findings = [{ claim: 'something else' }];
if (mode === 'foreign-id') results.push({ id: 'f'.repeat(64), status: 'fixed', reason: 'not a blocker' });
if (mode === 'extra-result-key') results[0].severity = 'blocking';
fs.writeFileSync(out, `${JSON.stringify(body)}\n`);
NODE
}

# run_recheck <manifest> <family> <answer-file-or-descriptor-json> [out-name]  (stdout: artifact JSON; sets RC)
run_recheck() {
  local manifest="$1" family="$2" descriptor="$3" outname="${4:-out}"
  local seatid="${5:-recheck_seat0}"
  local seq
  # every recheck seat gets the stub answer, so no seat can ever fall through to a real runner
  seq="$(node -e 'const d = process.argv[1]; const v = d.startsWith("{") ? JSON.parse(d) : d; const o = {}; for (const i of [0, 1, 2]) o[`recheck_seat${i}`] = [v, v]; process.stdout.write(JSON.stringify(o));' "$descriptor")"
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="$seq" \
    env -u AUTOPILOT_TOKEN_SEAT -u AUTOPILOT_SESSION_ID \
    node "$SCRIPT" --repair-recheck "$G2" --plan-file "$WORK/repo/plan.md" --repo-root "$WORK/repo" \
      --manifest-file "$manifest" --implementer-family "$family" --out "$WORK/$outname.json" </dev/null 2>"$WORK/$outname.err"
}

MAN_MIXED="$WORK/manifest-mixed.json"   # anthropic (same family as implementer), openai, xai
make_manifest "$MAN_MIXED" anthropic:claude-native:low openai:codex:high xai:grok:xhigh

# ---- (a) all 18 blockers fixed -> READY / generation_cap_repair_recheck_passed ----
make_answer all-fixed "$WORK/ans-fixed.json"
OUT="$(run_recheck "$MAN_MIXED" anthropic "$WORK/ans-fixed.json" a recheck_seat1)"; RC=$?
assert_exit_code "$RC" "0" "(a) recheck all fixed exits 0"
assert_eq "$(json_field "$OUT" verdict)" "READY" "(a) all fixed -> READY"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_repair_recheck_passed" "(a) policy_reason"
assert_eq "$(json_field "$OUT" terminal)" "true" "(a) frozen (terminal)"
assert_eq "$(json_field "$OUT" recheck.status)" "passed" "(a) recheck status"
assert_eq "$(json_field "$OUT" recheck.blocker_count)" "18" "(a) 18 blockers rechecked"
assert_eq "$(json_field "$OUT" recheck.results | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).length))')" "18" "(a) 18 answers recorded"
assert_eq "$(json_field "$OUT" recheck.seat.family)" "openai" "(a) seat is cheapest eligible, never the implementer family (anthropic low seat skipped)"
assert_file_exists "$WORK/a.json" "(a) <out> artifact written"
assert_eq "$(sha256sum "$G2" | cut -d' ' -f1)" "$G2_SHA_BEFORE" "(a) generation-2 artifact stays immutable"
node "$SCHEMA_CHECK" --schema "$ARTIFACT_SCHEMA" --document "$WORK/a.json" >"$WORK/a.schema" 2>&1
assert_exit_code "$?" "0" "(a) recheck artifact matches the artifact schema: $(cat "$WORK/a.schema")"

# default output path: <plan stem>.g2-recheck.json
AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="{\"recheck_seat0\":[\"$WORK/ans-fixed.json\"],\"recheck_seat1\":[\"$WORK/ans-fixed.json\"],\"recheck_seat2\":[\"$WORK/ans-fixed.json\"]}" \
  node "$SCRIPT" --repair-recheck "$G2" --plan-file "$WORK/repo/plan.md" --repo-root "$WORK/repo" \
    --manifest-file "$MAN_MIXED" --implementer-family anthropic </dev/null >/dev/null 2>&1
assert_file_exists "$WORK/repo/plan.g2-recheck.json" "(a) default path is <plan stem>.g2-recheck.json"

# ---- (b) two not_fixed -> CONDITIONAL, only those two listed ----
make_answer two-not-fixed "$WORK/ans-two.json"
OUT="$(run_recheck "$MAN_MIXED" anthropic "$WORK/ans-two.json" b recheck_seat1)"; RC=$?
assert_exit_code "$RC" "0" "(b) recheck with not_fixed exits 0"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" "(b) not_fixed -> CONDITIONAL"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_requires_depth_0_adjudication" "(b) policy_reason"
assert_eq "$(json_field "$OUT" findings | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).length))')" "2" "(b) only the 2 not_fixed blockers are listed"
assert_eq "$(json_field "$OUT" recheck.not_fixed_ids | node -e 'const a=JSON.parse(require("fs").readFileSync(0,"utf8"));const f=JSON.parse(process.argv[1]).findings.filter(x=>x.candidate_blocker).slice(0,2).map(x=>x.fingerprint);process.stdout.write(String(a.length===2&&f.every(x=>a.includes(x))))' "$(cat "$G2")")" "true" "(b) the listed ids are the two not_fixed ones"
assert_contains "$OUT" "still contradicts" "(b) the one-line reason travels with the blocker"

# ---- (c) extra keys / foreign ids -> recheck_invalid, not frozen ----
for mode in extra-key foreign-id extra-result-key; do
  make_answer "$mode" "$WORK/ans-$mode.json"
  OUT="$(run_recheck "$MAN_MIXED" anthropic "$WORK/ans-$mode.json" "c-$mode" recheck_seat1)"; RC=$?
  assert_exit_code "$RC" "5" "(c) $mode exits 5"
  assert_eq "$(json_field "$OUT" recheck.status)" "invalid" "(c) $mode -> recheck invalid"
  assert_eq "$(json_field "$OUT" policy_reason)" "recheck_invalid" "(c) $mode policy_reason recheck_invalid"
  assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" "(c) $mode is not frozen"
  assert_eq "$(json_field "$OUT" findings | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).length))')" "18" "(c) $mode keeps all 18 blockers for the PM"
done

# ---- (d) never the implementer's family; only same-family seats -> fail closed to the PM ----
MAN_SAME="$WORK/manifest-same.json"
make_manifest "$MAN_SAME" anthropic:claude-native:low anthropic:claude-native:high
OUT="$(run_recheck "$MAN_SAME" anthropic "$WORK/ans-fixed.json" d recheck_seat0)"; RC=$?
assert_exit_code "$RC" "5" "(d) only same-family seats exits 5"
assert_eq "$(json_field "$OUT" recheck.status)" "no_seat" "(d) no eligible seat"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" "(d) fails closed (not READY)"
assert_eq "$(json_field "$OUT" recheck.attempts)" "[]" "(d) the same-family seat was never asked"

# ---- (d2) one seat only: transport failure cannot retreat to another eligible seat ----
OUT="$(run_recheck "$MAN_MIXED" anthropic "{\"file\":\"$WORK/ans-fixed.json\",\"classification\":\"unavailable\"}" d2 recheck_seat1)"; RC=$?
assert_exit_code "$RC" "5" "(d2) failed sole seat exits 5"
assert_eq "$(json_field "$OUT" recheck.status)" "unavailable" "(d2) unavailable seat fails closed"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" "(d2) unavailable seat goes to PM adjudication"
assert_eq "$(json_field "$OUT" recheck.attempts.length)" "1" "(d2) no second seat dispatch"

# ---- (f) usage and duration: reported tokens, null (never 0) when the runner reports none ----
OUT="$(run_recheck "$MAN_MIXED" anthropic "{\"file\":\"$WORK/ans-fixed.json\",\"usage\":{\"input_tokens\":1200,\"output_tokens\":300}}" f1 recheck_seat1)"
assert_eq "$(json_field "$OUT" usage)" '{"input_tokens":1200,"output_tokens":300,"total_tokens":1500}' "(f) reported usage is summed with a total"
assert_eq "$(json_field "$OUT" recheck.attempts.0.usage.total_tokens)" "1500" "(f) per-attempt usage"
case "$(json_field "$OUT" duration_ms)" in ''|*[!0-9]*) fail "(f) duration_ms is not an integer" ;; *) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;; esac
OUT="$(run_recheck "$MAN_MIXED" anthropic "$WORK/ans-fixed.json" f2 recheck_seat1)"
assert_eq "$(json_field "$OUT" usage)" "null" "(f) no usage from the runner -> null, not 0"
assert_eq "$(json_field "$OUT" recheck.attempts.0.usage)" "null" "(f) per-attempt usage null"
assert_exit_code "$(json_field "$OUT" recheck.attempts.0.duration_ms | node -e 'process.exit(Number.isInteger(JSON.parse(require("fs").readFileSync(0,"utf8")))?0:1)'; echo $?)" "0" "(f) per-attempt duration_ms present"

# ---- refusals ----
cp "$WORK/repo/plan.md" "$WORK/repo/plan-same.md"
node -e '
const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
a.plan_sha256=require("crypto").createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex");
fs.writeFileSync(process.argv[3],JSON.stringify(a));' "$G2" "$WORK/repo/plan.md" "$WORK/g2-same-plan.json"
node "$SCRIPT" --repair-recheck "$WORK/g2-same-plan.json" --plan-file "$WORK/repo/plan.md" --repo-root "$WORK/repo" \
  --manifest-file "$MAN_MIXED" --implementer-family anthropic </dev/null >/dev/null 2>"$WORK/same.err"; RC=$?
assert_exit_code "$RC" "3" "an unrepaired (byte-identical) plan is refused"
assert_contains "$(cat "$WORK/same.err")" "plan_unchanged" "the refusal names plan_unchanged"

# ---- (e) generation-2 demotion (plan loop, end to end through the response seam) ----
EPLAN="$WORK/eplan"; mkdir -p "$EPLAN"; git -C "$EPLAN" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$EPLAN/plan.md"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' '- R2: immediate integrity' >"$EPLAN/rubric.md"
ESTATE="$WORK/estate"
BLOCKER="$PR_FIX/blocker.json"
BLOCKER_SCENARIO="$WORK/blocker-scenario.json"
node -e '
const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
v.findings[0].failure_scenario="a second ticket opens a fresh review budget for the same plan, so the cap never binds";
fs.writeFileSync(process.argv[2],JSON.stringify(v));' "$BLOCKER" "$BLOCKER_SCENARIO"
make_single() { make_manifest "$1" openai:codex:high; node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));m.logical_plan_id=process.argv[2];m.seats[0].id="architect";fs.writeFileSync(process.argv[1],JSON.stringify(m));' "$1" "$2"; }
plan_run() { # <logical> <generation> <response-file> [extra args...]
  local logical="$1" gen="$2" resp="$3"; shift 3
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="{\"architect\":[\"$resp\"]}" \
    env -u AUTOPILOT_TOKEN_SEAT -u AUTOPILOT_SESSION_ID \
    node "$SCRIPT" --repo-root "$EPLAN" --plan-file "$EPLAN/plan.md" --rubric-file "$EPLAN/rubric.md" \
      --ticket "tk-$logical" --session-id "s-$logical-$gen" --generation "$gen" \
      --manifest-file "$WORK/m-$logical.json" --state-dir "$ESTATE" --no-topology-fallbacks --allow-unregistered "$@" </dev/null
}
# a fingerprint to disposition (the fingerprint does not depend on the logical plan)
make_single "$WORK/m-probe.json" probe
OUT="$(plan_run probe 1 "$BLOCKER" --max-generations 1)"
FP="$(json_field "$OUT" findings.0.fingerprint)"
assert_eq "$(json_field "$OUT" findings.0.candidate_blocker)" "true" "(e) probe finding is a blocker candidate"
for variant in empty scenario; do
  make_single "$WORK/m-demo-$variant.json" "demo-$variant"
  cat >"$WORK/disp-$variant.json" <<JSON
{"schema_version":1,"logical_plan_id":"demo-$variant","generation":1,"findings":[{"fingerprint":"$FP","disposition":"accepted_blocker","rationale":"accepted at generation 1"}]}
JSON
  OUT1="$(plan_run "demo-$variant" 1 "$BLOCKER" --disposition-file "$WORK/disp-$variant.json")"
  assert_eq "$(json_field "$OUT1" findings.0.candidate_blocker)" "true" "(e) generation 1 ($variant) is unchanged: still a blocker"
  assert_eq "$(json_field "$OUT1" findings.0.disposition)" "accepted_blocker" "(e) generation 1 ($variant) keeps the accepted disposition"
  assert_eq "$(json_field "$OUT1" policy_reason)" "accepted_blockers_authorize_generation_2" "(e) generation 1 ($variant) authorizes generation 2"
done
OUT2="$(plan_run demo-empty 2 "$BLOCKER")"
assert_eq "$(json_field "$OUT2" findings.0.candidate_blocker)" "false" "(e) gen 2 without failure_scenario is demoted"
assert_eq "$(json_field "$OUT2" findings.0.disposition_reason)" "no_reachable_scenario" "(e) disposition reason no_reachable_scenario"
assert_eq "$(json_field "$OUT2" findings.0.disposition)" "accepted_nonblocking" "(e) demoted to non-blocking"
assert_contains "$OUT2" "generation_2_demotion" "(e) the demotion is recorded in provenance"
assert_eq "$(json_field "$OUT2" accepted_blocker_count)" "0" "(e) no blocker left to adjudicate"
OUT3="$(plan_run demo-scenario 2 "$BLOCKER_SCENARIO")"
assert_eq "$(json_field "$OUT3" findings.0.candidate_blocker)" "true" "(e) gen 2 with a reachable scenario stays a blocker"
assert_eq "$(json_field "$OUT3" policy_reason)" "generation_cap_requires_depth_0_adjudication" "(e) it still goes to the PM"
node "$SCHEMA_CHECK" --schema "$ARTIFACT_SCHEMA" --document <(printf '%s' "$OUT2") >"$WORK/e.schema" 2>&1
assert_exit_code "$?" "0" "(e) demoted artifact matches the schema: $(cat "$WORK/e.schema")"
# (f) the normal path carries usage/duration too
assert_eq "$(json_field "$OUT2" usage)" "null" "(f) review artifact: no reported usage -> null"
assert_exit_code "$(json_field "$OUT2" duration_ms | node -e 'process.exit(Number.isInteger(JSON.parse(require("fs").readFileSync(0,"utf8")))?0:1)'; echo $?)" "0" "(f) review artifact duration_ms present"
assert_exit_code "$(json_field "$OUT2" attempts.0.duration_ms | node -e 'process.exit(Number.isInteger(JSON.parse(require("fs").readFileSync(0,"utf8")))?0:1)'; echo $?)" "0" "(f) review attempt duration_ms present"

# ---- (g) code loop: default ledger dir, usage/duration, recheck ----
CODE="$WORK/code"; STATE="$WORK/state"; mkdir -p "$CODE/scripts" "$STATE"
(
  cd "$CODE" || exit 1
  git init -q -b main; git config user.email t@example.com; git config user.name T
  printf 'l1\nl2\nl3\nl4\nl5\n' >src.txt; git add src.txt; git commit -q -m base
  git checkout -q -b work; printf 'l1\nl2\nBAD\nl4\nl5\n' >src.txt; git commit -q -am work
)
CBASE="$(git -C "$CODE" rev-parse main)"
cat >"$CODE/scripts/dispatch-review.sh" <<'STUB'
#!/usr/bin/env bash
if [ -n "$STUB_ANSWER_FILE" ]; then
  if [ "${STUB_TRANSPORT_FAIL:-0}" = "1" ]; then exit 1; fi
  if [[ " $* " == *"--raw-answer"* ]]; then
    node -e 'const fs=require("fs");console.log(JSON.stringify({status:"reviewed",answer:fs.readFileSync(process.argv[1],"utf8"),usage:process.env.STUB_USAGE?JSON.parse(process.env.STUB_USAGE):null}))' "$STUB_ANSWER_FILE"
    exit 0
  fi
  node -e 'const fs=require("fs");const o={status:"reviewed",verdict:"SHIP-AS-IS",findings:fs.readFileSync(process.argv[1],"utf8"),no_finding_proof:null,usage:process.env.STUB_USAGE?JSON.parse(process.env.STUB_USAGE):null};console.log(JSON.stringify(o))' "$STUB_ANSWER_FILE"
  exit 0
fi
echo "$STUB_SEAT_RESPONSE"
STUB
chmod +x "$CODE/scripts/dispatch-review.sh"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$CODE/scripts/dispatch-review.sh"
export DISPATCH_QUIET=1 AUTOPILOT_DISPATCH_MANIFEST=0 AUTOPILOT_CONTEXT_WINDOW_GATE=off
export AUTOPILOT_TEST_CN_GATE_OFF=1
CODE_LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
export AUTOPILOT_STATE_DIR="$STATE"
export STUB_SEAT_RESPONSE='{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"Major: src.txt:3 BAD line breaks the parser\nthe value is wrong","no_finding_proof":null,"usage":{"input_tokens":50,"output_tokens":7}}'
env -u AUTOPILOT_TOKEN_SEAT -u AUTOPILOT_SESSION_ID node "$CODE_LOOP" collect --implementer-engine claude-sonnet-5 \
  --repo-root "$CODE" --phase p1 --generation 1 --branch work --phase-base "$CBASE" \
  --seats "gpt-m1/low@codex,gpt-m2/high@codex" </dev/null >"$WORK/collect.out" 2>"$WORK/collect.err"
assert_exit_code "$?" "0" "(g) collect without --ledger exits 0: $(tail -2 "$WORK/collect.err")"
LD="$STATE/review-ledgers/code/work"
assert_file_exists "$LD/review-p1/chain.json" "(g) ledger lands under the fixed default dir"
assert_file_absent "$CODE/review-p1" "(g) nothing written beside the repo"
CH="$(cat "$LD/review-p1/chain.json")"
assert_eq "$(node -e 'const c=JSON.parse(process.argv[1])[0];process.stdout.write(JSON.stringify(c.usage))' "$CH")" '{"input_tokens":100,"output_tokens":14,"total_tokens":114}' "(g)(f) generation usage is the sum of the seats"
assert_eq "$(node -e 'const c=JSON.parse(process.argv[1])[0];process.stdout.write(String(Number.isInteger(c.duration_ms)&&c.seats.every(s=>Number.isInteger(s.duration_ms)&&s.attempts.length===1&&Number.isInteger(s.attempts[0].duration_ms))))' "$CH")" "true" "(g)(f) duration_ms per generation, seat and attempt"
assert_eq "$(node -e 'const c=JSON.parse(process.argv[1])[0];process.stdout.write(JSON.stringify(c.seats[0].usage))' "$CH")" '{"input_tokens":50,"output_tokens":7,"total_tokens":57}' "(g)(f) per-seat usage"
# a runner that reports no usage: null, never 0
export STUB_SEAT_RESPONSE='{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"Major: src.txt:3 BAD line breaks the parser\nthe value is wrong","no_finding_proof":null}'
env -u AUTOPILOT_TOKEN_SEAT -u AUTOPILOT_SESSION_ID node "$CODE_LOOP" collect --implementer-engine claude-sonnet-5 \
  --repo-root "$CODE" --phase p2 --generation 1 --branch work --phase-base "$CBASE" \
  --seats "gpt-m1/low@codex" </dev/null >/dev/null 2>&1
assert_eq "$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]))[0];process.stdout.write(JSON.stringify([c.usage,c.seats[0].usage,c.seats[0].attempts[0].usage]))' "$LD/review-p2/chain.json")" "[null,null,null]" "(g)(f) no usage reported -> null, not 0"

# the repair: change the flagged line
(cd "$CODE" && printf 'l1\nl2\nGOOD\nl4\nl5\n' >src.txt && git commit -q -am repair)
code_answer() { # <mode> <out>: answers for every finding of g1; not_fixed marks only the first
  node -e '
const fs=require("fs");const ids=JSON.parse(fs.readFileSync(process.argv[1])).findings.map(f=>f.id);
const mode=process.argv[2];
const results=ids.map((id,i)=>({id,status:mode==="notfixed"&&i===0?"not_fixed":"fixed",reason:mode==="notfixed"&&i===0?"the parser still rejects line 3":"line 3 no longer carries the bad value"}));
const body={results};if(mode==="extra")body.new_findings=[];
fs.writeFileSync(process.argv[3],JSON.stringify(body));' "$LD/review-p1/g1/findings.json" "$1" "$2"
}
code_answer fixed "$WORK/code-fixed.json"; code_answer notfixed "$WORK/code-notfixed.json"; code_answer extra "$WORK/code-extra.json"
FID="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).findings[0].id)' "$LD/review-p1/g1/findings.json")"
CHAIN_SHA="$(sha256sum "$LD/review-p1/chain.json" | cut -d' ' -f1)"
code_recheck() { # <answer-file> <seats>
  STUB_ANSWER_FILE="$1" STUB_USAGE='{"input_tokens":10,"output_tokens":2}' STUB_TRANSPORT_FAIL="${3:-0}" env -u AUTOPILOT_TOKEN_SEAT -u AUTOPILOT_SESSION_ID \
    node "$CODE_LOOP" recheck --repo-root "$CODE" --phase p1 --generation 1 --branch work --seats "$2" </dev/null 2>"$WORK/recheck.err"
}
OUT="$(code_recheck "$WORK/code-fixed.json" "claude-haiku-5/low@claude,gpt-m1/high@codex")"; RC=$?
assert_exit_code "$RC" "0" "(g)(a) code recheck all fixed exits 0: $(tail -2 "$WORK/recheck.err")"
assert_eq "$(json_field "$OUT" verdict)" "SHIP-AS-IS" "(g)(a) all fixed -> frozen"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_repair_recheck_passed" "(g)(a) policy_reason"
assert_eq "$(json_field "$OUT" recheck.seat.family)" "openai" "(g)(d) the implementer's family seat is skipped"
assert_eq "$(json_field "$OUT" usage)" '{"input_tokens":10,"output_tokens":2,"total_tokens":12}' "(g)(f) recheck usage"
assert_file_exists "$LD/review-p1/recheck-g1.json" "(g) recheck artifact under the default ledger"
assert_contains "$(cat "$LD/review-p1/recheck-g1/question-s1.md")" "+GOOD" "(g) the finding's repair hunk is what the seat is asked about"
assert_eq "$(sha256sum "$LD/review-p1/chain.json" | cut -d' ' -f1)" "$CHAIN_SHA" "(g) the chain is not modified by recheck"
OUT="$(code_recheck "$WORK/code-notfixed.json" "gpt-m1/high@codex")"; RC=$?
assert_exit_code "$RC" "0" "(g)(b) not_fixed exits 0"
assert_eq "$(json_field "$OUT" verdict)" "FIX-THEN-SHIP" "(g)(b) not_fixed -> not frozen"
assert_eq "$(json_field "$OUT" policy_reason)" "generation_cap_requires_depth_0_adjudication" "(g)(b) policy_reason"
assert_eq "$(json_field "$OUT" findings.length)" "1" "(g)(b) only the not_fixed finding is listed"
assert_eq "$(json_field "$OUT" findings.0.id)" "$FID" "(g)(b) it is the right one"
OUT="$(code_recheck "$WORK/code-extra.json" "gpt-m1/high@codex")"; RC=$?
assert_exit_code "$RC" "5" "(g)(c) extra key exits 5"
assert_eq "$(json_field "$OUT" recheck.status)" "invalid" "(g)(c) extra key -> invalid, not frozen"
OUT="$(code_recheck "$WORK/code-fixed.json" "claude-haiku-5/low@claude,claude-opus-5/high@claude")"; RC=$?
assert_exit_code "$RC" "5" "(g)(d) only the implementer's family: exits 5"
assert_eq "$(json_field "$OUT" recheck.status)" "no_seat" "(g)(d) fails closed to PM adjudication"

# ---- (g)(h) transport failure uses one seat, then fails closed to PM ----
OUT="$(code_recheck "$WORK/code-fixed.json" "gpt-m1/high@codex,gpt-m2/high@codex" 1)"; RC=$?
assert_exit_code "$RC" "5" "(g)(h) unavailable sole seat exits 5"
assert_eq "$(json_field "$OUT" recheck.status)" "unavailable" "(g)(h) transport failure adjudicates"
assert_eq "$(json_field "$OUT" recheck.attempts.length)" "1" "(g)(h) does not dispatch a second seat"

# ---- (g)(i) a blocker without a nearby repair hunk is never asked or frozen ----
cp "$LD/review-p1/g1/findings.json" "$WORK/findings-no-hunk.json"
node -e 'const fs=require("fs");const p=process.argv[1];const x=JSON.parse(fs.readFileSync(p));x.findings=[{...x.findings[0],id:"missing-hunk",text:"Major: absent.txt:40 unrelated issue"}];fs.writeFileSync(p,JSON.stringify(x));' "$WORK/findings-no-hunk.json"
cp "$WORK/findings-no-hunk.json" "$LD/review-p1/g1/findings.json"
rm -f "$LD/review-p1/g1/dispositions.json"
node -e 'const fs=require("fs");const p=process.argv[1];const x=JSON.parse(fs.readFileSync(p));fs.writeFileSync(process.argv[2],JSON.stringify({results:x.findings.map(f=>({id:f.id,status:"fixed",reason:"line 3 no longer carries the bad value"}))}));' "$LD/review-p1/g1/findings.json" "$WORK/code-fixed-two.json"
OUT="$(code_recheck "$WORK/code-fixed-two.json" "gpt-m1/high@codex" 0)"; RC=$?
assert_exit_code "$RC" "0" "(g)(i) missing-hunk blocker is sent for adjudication"
assert_eq "$(json_field "$OUT" verdict)" "FIX-THEN-SHIP" "(g)(i) no evidence cannot freeze"
assert_eq "$(json_field "$OUT" recheck.results.0.reason)" "no_repair_hunk" "(g)(i) reason names missing repair evidence"
assert_eq "$(json_field "$OUT" findings.0.id)" "missing-hunk" "(g)(i) correct blocker remains for PM"
assert_eq "$(json_field "$OUT" recheck.attempts)" "[]" "(g)(i) no recheck seat is asked"
unset AUTOPILOT_DISPATCH_REVIEW_SCRIPT AUTOPILOT_STATE_DIR STUB_SEAT_RESPONSE

# The real dispatcher returns pure JSON in raw-answer mode instead of applying its
# ordinary verdict/findings-format parser. The strict recheck validator owns schema checks.
RAW_FIXTURE_TMP="$TEST_TMP/raw-review"; mkdir -p "$RAW_FIXTURE_TMP"
RAW_DIFF="$RAW_FIXTURE_TMP/diff"; printf '+fixture\n' >"$RAW_DIFF"
RAW_STUB="$RAW_FIXTURE_TMP/codex"
cat >"$RAW_STUB" <<'STUB'
#!/usr/bin/env bash
prompt="$(cat)"
marker="$(printf '%s' "$prompt" | sed -n 's/^<<<AUTOPILOT-REVIEW-\(.*\)>>>$/\1/p')"
printf '%s\n' '{"results":[{"id":"fixture-blocker","status":"fixed","reason":"repair is present"}]}'
STUB
chmod +x "$RAW_STUB"
RAW_BINDIR="$RAW_FIXTURE_TMP/bin"; mkdir -p "$RAW_BINDIR"
cp "$RAW_STUB" "$RAW_BINDIR/codex"; printf 'host\n' >"$RAW_BINDIR/codex-code-mode-host"
RAW_OUT="$(AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1 "$REPO_ROOT/scripts/dispatch-review.sh" \
  --runner codex --model gpt-5.5 --diff-file "$RAW_DIFF" --bin "$RAW_BINDIR/codex" --raw-answer 2>&1)"; RC=$?
assert_exit_code "$RC" "0" "raw recheck JSON traverses the real dispatch-review path"
assert_eq "$(json_field "$RAW_OUT" answer)" '{"results":[{"id":"fixture-blocker","status":"fixed","reason":"repair is present"}]}' \
  "pure JSON is returned intact for recheck validation"

finalize_test
