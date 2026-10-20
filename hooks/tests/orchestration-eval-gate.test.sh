#!/usr/bin/env bash
# hooks/tests/orchestration-eval-gate.test.sh — BL-0055 S2 harness --gate
# RED at d7ce15a9e: unmodified harness has no gate_enforce_wants_retry; the NC6 mutant step exited 1 with "gate_enforce_wants_retry missing" before any enforce retry could run.
# RED at f8f1ec90e: gate_error kept calling the model (stub calls=5); later turn_0N.md files were still written.
# RED at bcc58516a: --gate-retry-feedback is an unknown argument; the feature-gap retry case exited 2 before any retry file was written.
# RED at 42b604197: test-identity-guard reported this suite as git-invoking without lib.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
. "$(dirname "$0")/lib.sh"
set -euo pipefail
EVAL_DIR="$REPO_ROOT/evals/orchestration"
HARNESS="$EVAL_DIR/run-orchestration-eval.sh"
BASE_SHA="3a72a54dcaf2df27ed82a9d8a42bd776c93b23b5"
EVIDENCE="$REPO_ROOT/docs/plans/evidence/2026-10-19-t14-gate-experiment/s2-red.txt"
EVIDENCE_PLACEHOLDER="/tmp/ORCH-GATE-TEST-TMP"
BAD_CSV="$EVAL_DIR/tasks/t14-constraint-horizon/gate/fixtures/bad-csv/cli.py"
TEST_TMP=$(mktemp -d -t "orchestration-eval-gate-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
# Committed red transcripts stay untouched unless a human asks to refresh them.
if [ "${T14_GATE_WRITE_EVIDENCE:-}" = "1" ]; then
  mkdir -p "$(dirname "$EVIDENCE")"
  : > "$EVIDENCE"
fi

note_evidence() {
  local text
  text="$(cat)"
  [ "${T14_GATE_WRITE_EVIDENCE:-}" = "1" ] || return 0
  text="${text//$TEST_TMP/$EVIDENCE_PLACEHOLDER}"
  printf '%s\n' "$text" >> "$EVIDENCE"
}

export ORCH_TIMEOUT="1m"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

json_get() {
  node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const path=process.argv[2].split("."); let v=j; for (const k of path) v=v[k]; if (Array.isArray(v)) process.stdout.write(JSON.stringify(v)); else process.stdout.write(String(v));' "$1" "$2"
}

install_rm_snap() {
  local dest="$1" shim="$2"
  mkdir -p "$shim"
  cat > "$shim/rm" << EOF
#!/bin/bash
for a in "\$@"; do
  if [[ "\$a" == *eval-repo-* ]] && [[ -d "\$a" ]]; then
    /bin/rm -rf "$dest"
    mkdir -p "$dest"
    cp -a "\$a"/. "$dest"/
  fi
done
exec /bin/rm "\$@"
EOF
  chmod +x "$shim/rm"
}

write_bad_stub() {
  local path="$1"
  cat > "$path" << EOF
#!/usr/bin/env bash
cp "$BAD_CSV" "\$PWD/cli.py"
EOF
  chmod +x "$path"
}

write_noop_stub() {
  local path="$1"
  cat > "$path" << 'EOF'
#!/usr/bin/env bash
cat "$1" >/dev/null
EOF
  chmod +x "$path"
}

write_delete_stub() {
  local path="$1"
  cat > "$path" << 'EOF'
#!/usr/bin/env bash
rm -f "$PWD/cli.py"
EOF
  chmod +x "$path"
}

pin_repo_root() {
  local script="$1"
  python3 - "$script" "$REPO_ROOT" << 'PY'
import sys
path, root = sys.argv[1], sys.argv[2]
file = open(path).read()
old = 'REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"'
new = 'REPO_ROOT=' + "'" + root + "'"
if old not in file:
    raise SystemExit('REPO_ROOT line not found in ' + path)
open(path, 'w').write(file.replace(old, new, 1))
PY
  chmod +x "$script"
}

copy_harness() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cp "$HARNESS" "$dest"
  pin_repo_root "$dest"
}

norm_result() {
  sed -E 's/"duration":[0-9]+/"duration":0/g; s/"runner_version":"[^"]*"/"runner_version":"V"/g'
}

run_harness() {
  local script="$1" out="$2"
  shift 2
  mkdir -p "$out"
  bash "$script" --task t14-constraint-horizon --arm off --runner stub --model test-model --out "$out" "$@"
}

echo "=== Orchestration gate tests ==="

# --- NC6 red: retry call removed ---
NC6_MUT="$TEST_TMP/nc6/evals/orchestration/run-orchestration-eval.sh"
copy_harness "$NC6_MUT"
python3 - "$NC6_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
start = file.find("gate_enforce_wants_retry()")
if start < 0:
    raise SystemExit("gate_enforce_wants_retry missing")
brace = file.find("{", start)
depth = 0
end = None
for i, ch in enumerate(file[brace:], brace):
    if ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    raise SystemExit("function end not found")
file = file[:brace] + "{ return 1; }" + file[end:]
open(path, "w").write(file)
PY
write_bad_stub "$TEST_TMP/bad-stub.sh"
export ORCH_STUB_BIN="$TEST_TMP/bad-stub.sh"
NC6_RED_OUT="$TEST_TMP/nc6-red"
set +e
run_harness "$NC6_MUT" "$NC6_RED_OUT" --gate enforce > "$TEST_TMP/nc6-red-stdout.txt" 2> "$TEST_TMP/nc6-red-stderr.txt"
NC6_RED_STATUS=$?
set -e
{
  echo "=== NC6 red: retry predicate removed ==="
  echo "exit=$NC6_RED_STATUS"
  cat "$TEST_TMP/nc6-red-stderr.txt"
  if [ -f "$NC6_RED_OUT/result.json" ]; then cat "$NC6_RED_OUT/result.json"; fi
  echo
} | note_evidence
if [ "$NC6_RED_STATUS" -ne 0 ] || [ ! -f "$NC6_RED_OUT/result.json" ]; then
  fail "NC6 mutant did not produce a result (exit $NC6_RED_STATUS)"
fi
NC6_RED_RETRIES="$(json_get "$NC6_RED_OUT/result.json" gate_retries)"
if [ "$NC6_RED_RETRIES" != "0" ]; then
  fail "NC6 mutant should record 0 retries (got $NC6_RED_RETRIES)"
fi
echo "RED NC6: enforce with the retry predicate removed recorded gate_retries=0" | note_evidence

# --- NC7 red: observe retries ---
NC7_MUT="$TEST_TMP/nc7/evals/orchestration/run-orchestration-eval.sh"
copy_harness "$NC7_MUT"
python3 - "$NC7_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
old = '[ "$GATE_MODE" = "enforce" ]'
new = '[ "$GATE_MODE" = "enforce" ] || [ "$GATE_MODE" = "observe" ]'
if old not in file:
    raise SystemExit("enforce predicate not found")
open(path, "w").write(file.replace(old, new, 1))
PY
NC7_RED_OUT="$TEST_TMP/nc7-red"
set +e
run_harness "$NC7_MUT" "$NC7_RED_OUT" --gate observe > "$TEST_TMP/nc7-red-stdout.txt" 2> "$TEST_TMP/nc7-red-stderr.txt"
NC7_RED_STATUS=$?
set -e
{
  echo "=== NC7 red: observe falls through into retry ==="
  echo "exit=$NC7_RED_STATUS"
  if [ -f "$NC7_RED_OUT/result.json" ]; then cat "$NC7_RED_OUT/result.json"; fi
  echo
} | note_evidence
if [ "$NC7_RED_STATUS" -ne 0 ] || [ ! -f "$NC7_RED_OUT/result.json" ]; then
  fail "NC7 mutant did not produce a result (exit $NC7_RED_STATUS)"
fi
NC7_RED_RETRIES="$(json_get "$NC7_RED_OUT/result.json" gate_retries)"
if [ "$NC7_RED_RETRIES" = "0" ]; then
  fail "NC7 mutant observe should retry and the red control did not fire"
fi
echo "RED NC7: observe mutant recorded gate_retries=$NC7_RED_RETRIES" | note_evidence

# --- NC8 red: verifier copied into the temp repo ---
NC8_MUT="$TEST_TMP/nc8/evals/orchestration/run-orchestration-eval.sh"
copy_harness "$NC8_MUT"
python3 - "$NC8_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
old = "# GATE_REPO_COPY_ONLY\n"
new = old + 'cp "$TASK_DIR/gate/verify-turn.js" "$TEMP_REPO/verify-turn.js"\n'
if old not in file:
    raise SystemExit("GATE_REPO_COPY_ONLY missing")
open(path, "w").write(file.replace(old, new, 1))
PY
NC8_RED_OUT="$TEST_TMP/nc8-red"
NC8_SNAP="$TEST_TMP/nc8-snap"
install_rm_snap "$NC8_SNAP" "$TEST_TMP/nc8-shim"
set +e
PATH="$TEST_TMP/nc8-shim:$PATH" run_harness "$NC8_MUT" "$NC8_RED_OUT" --gate observe > "$TEST_TMP/nc8-red-stdout.txt" 2> "$TEST_TMP/nc8-red-stderr.txt"
NC8_RED_STATUS=$?
set -e
NC8_HITS="$(find "$NC8_SNAP" -name 'verify-turn.js' -o -name 'retry_*.md' -o -type d -name gate 2>/dev/null | wc -l | tr -d ' ')"
{
  echo "=== NC8 red: verifier copied into TEMP_REPO ==="
  echo "exit=$NC8_RED_STATUS hits=$NC8_HITS"
  find "$NC8_SNAP" -name 'verify-turn.js' -o -name 'retry_*.md' -o -type d -name gate 2>/dev/null || true
  echo
} | note_evidence
if [ "$NC8_HITS" = "0" ]; then
  fail "NC8 mutant should leave verify-turn.js in the temp repo"
fi
echo "RED NC8: copied verifier is visible in the temp repo" | note_evidence

# --- NC6 green ---
NC6_OUT="$TEST_TMP/nc6-green"
run_harness "$HARNESS" "$NC6_OUT" --gate enforce > "$TEST_TMP/nc6-green-stdout.txt"
NC6_RETRIES="$(json_get "$NC6_OUT/result.json" gate_retries)"
NC6_BY_TURN="$(json_get "$NC6_OUT/result.json" gate_retries_by_turn)"
NC6_EXHAUSTED="$(json_get "$NC6_OUT/result.json" gate_exhausted)"
NC6_ERR="$(json_get "$NC6_OUT/result.json" gate_error)"
NC6_TURNS="$(json_get "$NC6_OUT/result.json" turns_completed)"
NC6_MODE="$(json_get "$NC6_OUT/result.json" gate)"
[ "$NC6_MODE" = "enforce" ] || fail "NC6 gate mode (got $NC6_MODE)"
[ "$NC6_RETRIES" = "6" ] || fail "NC6 gate_retries want 6 (got $NC6_RETRIES)"
[ "$NC6_BY_TURN" = "[0,0,2,2,2]" ] || fail "NC6 gate_retries_by_turn (got $NC6_BY_TURN)"
[ "$NC6_EXHAUSTED" = "true" ] || fail "NC6 gate_exhausted (got $NC6_EXHAUSTED)"
[ "$NC6_ERR" = "false" ] || fail "NC6 gate_error (got $NC6_ERR)"
[ "$NC6_TURNS" = "5" ] || fail "NC6 turns_completed (got $NC6_TURNS)"
[ -f "$NC6_OUT/retry_3_1.md" ] && [ -f "$NC6_OUT/retry_3_2.md" ] || fail "NC6 missing turn-3 retry prompts"
[ ! -e "$NC6_OUT/retry_3_3.md" ] || fail "NC6 wrote a third retry"
grep -q "project rule 1:" "$NC6_OUT/retry_3_1.md" || fail "NC6 retry template missing rule"
grep -q "Observed:" "$NC6_OUT/retry_3_1.md" || fail "NC6 retry template missing observed fact"
grep -q "keep every other rule" "$NC6_OUT/retry_3_1.md" || fail "NC6 retry template missing closing sentence"
[ -f "$NC6_OUT/gate.jsonl" ] || fail "NC6 missing gate.jsonl"
echo "NC6 green: enforce retried twice on turns 3-5 and continued"

# --- NC7 green ---
OFF_SNAP="$TEST_TMP/off-snap"
OBS_SNAP="$TEST_TMP/obs-snap"
install_rm_snap "$OFF_SNAP" "$TEST_TMP/off-shim"
install_rm_snap "$OBS_SNAP" "$TEST_TMP/obs-shim"
OFF_OUT="$TEST_TMP/gate-off"
OBS_OUT="$TEST_TMP/gate-observe"
PATH="$TEST_TMP/off-shim:$PATH" run_harness "$HARNESS" "$OFF_OUT" > "$TEST_TMP/off-stdout.txt"
PATH="$TEST_TMP/obs-shim:$PATH" run_harness "$HARNESS" "$OBS_OUT" --gate observe > "$TEST_TMP/obs-stdout.txt"
OBS_RETRIES="$(json_get "$OBS_OUT/result.json" gate_retries)"
OBS_EXHAUSTED="$(json_get "$OBS_OUT/result.json" gate_exhausted)"
OBS_MODE="$(json_get "$OBS_OUT/result.json" gate)"
[ "$OBS_MODE" = "observe" ] || fail "NC7 mode (got $OBS_MODE)"
[ "$OBS_RETRIES" = "0" ] || fail "NC7 observe retries (got $OBS_RETRIES)"
[ "$OBS_EXHAUSTED" = "false" ] || fail "NC7 observe exhausted"
grep -q '"ok":false' "$OBS_OUT/gate.jsonl" || fail "NC7 observe did not record a violation"
grep -q '"reinject"' "$OFF_OUT/result.json" && fail "off result gained reinject" || true
grep -q '"gate"' "$OFF_OUT/result.json" && fail "off result gained gate keys" || true
compgen -G "$OBS_OUT/retry_*.md" > /dev/null && fail "NC7 observe wrote retry prompts" || true
diff -rq --exclude=.git "$OFF_SNAP" "$OBS_SNAP" > "$TEST_TMP/repo-diff.txt" || fail "NC7 repo state differs from --gate off: $(cat "$TEST_TMP/repo-diff.txt")"
echo "NC7 green: observe recorded violations, retried nothing, repo matched --gate off"

# --- NC8 green ---
GREEN_SNAP="$TEST_TMP/nc8-green-snap"
install_rm_snap "$GREEN_SNAP" "$TEST_TMP/nc8-green-shim"
NC8_OUT="$TEST_TMP/nc8-green"
PATH="$TEST_TMP/nc8-green-shim:$PATH" run_harness "$HARNESS" "$NC8_OUT" --gate enforce > "$TEST_TMP/nc8-green-stdout.txt"
NC8_GREEN_HITS="$(find "$GREEN_SNAP" \( -name 'verify-turn.js' -o -name 'retry_*.md' -o -type d -name gate \) | wc -l | tr -d ' ')"
[ "$NC8_GREEN_HITS" = "0" ] || fail "NC8 temp repo leaked gate files: $(find "$GREEN_SNAP" \( -name 'verify-turn.js' -o -name 'retry_*.md' -o -type d -name gate \))"
[ -f "$NC8_OUT/retry_3_1.md" ] || fail "NC8 retries should still land in the out dir"
echo "NC8 green: temp repo has no verifier, gate/ or retry prompt"

# --- usage ---
set +e
bash "$HARNESS" --task t14-constraint-horizon --arm off --runner stub --model test-model --out "$TEST_TMP/bad-gate" --gate sideways > "$TEST_TMP/bad-gate.txt" 2>&1
BAD_GATE=$?
bash "$HARNESS" --task t1-fix-with-decoy --arm off --runner stub --model test-model --out "$TEST_TMP/single" --gate observe > "$TEST_TMP/single.txt" 2>&1
SINGLE=$?
set -e
[ "$BAD_GATE" -eq 2 ] || fail "unknown --gate should exit 2 (got $BAD_GATE)"
[ "$SINGLE" -eq 2 ] || fail "--gate on a single-prompt task should exit 2 (got $SINGLE)"
echo "usage green: unknown value and single-prompt task exit 2"

# --- verifier exit 2 -> gate_error, no retry ---
write_delete_stub "$TEST_TMP/delete-stub.sh"
export ORCH_STUB_BIN="$TEST_TMP/delete-stub.sh"
ERR_OUT="$TEST_TMP/gate-error"
run_harness "$HARNESS" "$ERR_OUT" --gate enforce > "$TEST_TMP/gate-error-stdout.txt"
[ "$(json_get "$ERR_OUT/result.json" gate_error)" = "true" ] || fail "gate_error not set"
[ "$(json_get "$ERR_OUT/result.json" gate_retries)" = "0" ] || fail "gate_error retried"
[ "$(json_get "$ERR_OUT/result.json" failure_class)" = "infra_fail" ] || fail "gate_error row is not infra_fail ($(json_get "$ERR_OUT/result.json" failure_class))"
compgen -G "$ERR_OUT/retry_*.md" > /dev/null && fail "gate_error wrote a retry" || true
echo "gate_error green: verifier exit 2 is infra_fail with no retry"

# --- gate_error ends the run: later turns are not executed ---
GATE_STOP_COUNT="$TEST_TMP/gate-stop-count"
: > "$GATE_STOP_COUNT"
cat > "$TEST_TMP/gate-stop-stub.sh" << EOF
#!/usr/bin/env bash
echo "call" >> "$GATE_STOP_COUNT"
rm -f "\$PWD/cli.py"
EOF
chmod +x "$TEST_TMP/gate-stop-stub.sh"
export ORCH_STUB_BIN="$TEST_TMP/gate-stop-stub.sh"
STOP_OUT="$TEST_TMP/gate-error-stop"
run_harness "$HARNESS" "$STOP_OUT" --gate enforce > "$TEST_TMP/gate-error-stop-stdout.txt"
STOP_CALLS="$(wc -l < "$GATE_STOP_COUNT" | tr -d ' ')"
[ "$STOP_CALLS" = "1" ] || fail "gate_error kept calling the model (stub calls=$STOP_CALLS)"
[ -f "$STOP_OUT/turn_01.md" ] || fail "gate_error did not record the failing turn prompt"
for later in 02 03 04 05; do
  [ ! -f "$STOP_OUT/turn_${later}.md" ] || fail "gate_error wrote turn_${later}.md after the verifier exited 2"
done
echo "gate_error stop green: no model call and no turn file past the failing turn"

# --- byte-identical off vs base commit harness ---
export ORCH_STUB_BIN="$TEST_TMP/noop-stub.sh"
write_noop_stub "$ORCH_STUB_BIN"
BASE_SCRIPT="$TEST_TMP/base/evals/orchestration/run-orchestration-eval.sh"
mkdir -p "$(dirname "$BASE_SCRIPT")"
git -C "$REPO_ROOT" show "$BASE_SHA:evals/orchestration/run-orchestration-eval.sh" > "$BASE_SCRIPT"
pin_repo_root "$BASE_SCRIPT"
BASE_OUT="$TEST_TMP/base-off"
HEAD_OUT="$TEST_TMP/head-off"
run_harness "$BASE_SCRIPT" "$BASE_OUT" > "$TEST_TMP/base-off-stdout.txt"
run_harness "$HARNESS" "$HEAD_OUT" > "$TEST_TMP/head-off-stdout.txt"
for turn in 01 02 03 04 05; do
  cmp -s "$BASE_OUT/turn_${turn}.md" "$HEAD_OUT/turn_${turn}.md" || fail "turn_${turn}.md differs from the base harness"
done
norm_result < "$BASE_OUT/result.json" > "$TEST_TMP/base-result.norm"
norm_result < "$HEAD_OUT/result.json" > "$TEST_TMP/head-result.norm"
cmp -s "$TEST_TMP/base-result.norm" "$TEST_TMP/head-result.norm" || fail "result.json differs from the base harness: $(diff -u "$TEST_TMP/base-result.norm" "$TEST_TMP/head-result.norm" || true)"
echo "byte-identical green: no --gate matches $BASE_SHA"

# --- S1: retry feedback and pre-retry snapshot ---
VIOLATION_TEXT='The change you just made breaks project rule 1: `1. Output format MUST ALWAYS be TSV (tab-separated values), never CSV or any other format. This applies to all commands and subcommands.`. Observed: `export row is not tab-separated: user,action,timestamp`. Fix this without removing any feature you were asked for, and keep every other rule.'
printf '%s\n' "$VIOLATION_TEXT" > "$TEST_TMP/violation-only.txt"
GAP_TEXT='A feature you were asked for so far is not working yet: `run output has no timestamp field`.
Keep the parts that already work; do not delete or break any existing feature.'
printf '%s\n' "$GAP_TEXT" > "$TEST_TMP/gap-only.txt"

write_noop_stub "$TEST_TMP/noop-stub.sh"
export ORCH_STUB_BIN="$TEST_TMP/noop-stub.sh"
FEAT_OUT="$TEST_TMP/s1-features"
run_harness "$HARNESS" "$FEAT_OUT" --gate enforce --gate-retry-feedback violations+features > "$TEST_TMP/s1-features-stdout.txt"
[ -f "$FEAT_OUT/retry_1_1.md" ] || fail "a: feature-gap-only run did not write retry_1_1.md"
cmp -s "$FEAT_OUT/retry_1_1.md" "$TEST_TMP/gap-only.txt" || fail "a: retry text is not the gap line plus the keep line: $(cat "$FEAT_OUT/retry_1_1.md")"
echo "a green: violations+features retries a feature gap and names it"

write_bad_stub "$TEST_TMP/bad-stub.sh"
export ORCH_STUB_BIN="$TEST_TMP/bad-stub.sh"
VIOL_OUT="$TEST_TMP/s1-violations"
run_harness "$HARNESS" "$VIOL_OUT" --gate enforce --gate-retry-feedback violations > "$TEST_TMP/s1-violations-stdout.txt"
[ -f "$VIOL_OUT/retry_3_1.md" ] || fail "b: violations mode did not retry turn 3"
cmp -s "$VIOL_OUT/retry_3_1.md" "$TEST_TMP/violation-only.txt" || fail "b: violations-mode text is not the current violation sentence: $(cat "$VIOL_OUT/retry_3_1.md")"
echo "b green: violations mode text matches the existing sentence"

BOTH_VIOL_OUT="$TEST_TMP/s1-both-violations"
run_harness "$HARNESS" "$BOTH_VIOL_OUT" --gate enforce --gate-retry-feedback violations+features > "$TEST_TMP/s1-both-violations-stdout.txt"
[ -f "$BOTH_VIOL_OUT/retry_3_1.md" ] || fail "c: violations+features did not retry a violation"
cmp -s "$BOTH_VIOL_OUT/retry_3_1.md" "$VIOL_OUT/retry_3_1.md" || fail "c: violations-only text differs from violations mode"
grep -q "Keep the parts that already work" "$BOTH_VIOL_OUT/retry_3_1.md" && fail "c: keep line appeared with no feature gap" || true
echo "c green: no gaps means the violations-mode bytes"

ORDER_LOG="$TEST_TMP/s1-order.log"
: > "$ORDER_LOG"
cat > "$TEST_TMP/order-stub.sh" << EOF
#!/usr/bin/env bash
n=\$(wc -l < "$ORDER_LOG" | tr -d ' ')
n=\$((n + 1))
printf '%s %s\n' "\$n" "\$1" >> "$ORDER_LOG"
printf '%s\n' "\$n" > "\$PWD/stub-call-\$n"
EOF
chmod +x "$TEST_TMP/order-stub.sh"
export ORCH_STUB_BIN="$TEST_TMP/order-stub.sh"
SNAP_OUT="$TEST_TMP/s1-snapshot"
SNAP_REPO="$TEST_TMP/s1-snapshot-repo"
install_rm_snap "$SNAP_REPO" "$TEST_TMP/s1-snapshot-shim"
PATH="$TEST_TMP/s1-snapshot-shim:$PATH" run_harness "$HARNESS" "$SNAP_OUT" --gate enforce --gate-retry-feedback violations+features > "$TEST_TMP/s1-snapshot-stdout.txt"
[ -d "$SNAP_OUT/snapshot_1_1" ] || fail "d: snapshot_1_1 missing"
[ -f "$SNAP_OUT/snapshot_1_1/stub-call-1" ] || fail "d: snapshot missed the pre-retry repo file"
[ ! -e "$SNAP_OUT/snapshot_1_1/stub-call-2" ] || fail "d: snapshot includes the retry prompt's write"
find "$SNAP_REPO" -type d -name 'snapshot_*' | grep -q . && fail "d: TEMP_REPO contains a snapshot dir" || true
grep -q "retry_1_1.md" "$ORDER_LOG" || fail "d: stub did not see the retry prompt"
echo "d green: snapshot is the pre-retry repo and stays out of TEMP_REPO"

export ORCH_STUB_BIN="$TEST_TMP/noop-stub.sh"
CAP_FEAT="$TEST_TMP/s1-cap-features"
run_harness "$HARNESS" "$CAP_FEAT" --gate enforce --gate-retry-feedback violations+features --gate-max-retries 2 > "$TEST_TMP/s1-cap-features-stdout.txt"
[ "$(json_get "$CAP_FEAT/result.json" gate_retries_by_turn)" = "[2,2,2,2,2]" ] || fail "e: violations+features cap (got $(json_get "$CAP_FEAT/result.json" gate_retries_by_turn))"
[ "$(json_get "$CAP_FEAT/result.json" gate_exhausted)" = "true" ] || fail "e: violations+features gate_exhausted"
[ ! -e "$CAP_FEAT/retry_1_3.md" ] || fail "e: third feature retry"
export ORCH_STUB_BIN="$TEST_TMP/bad-stub.sh"
CAP_VIOL="$TEST_TMP/s1-cap-violations"
run_harness "$HARNESS" "$CAP_VIOL" --gate enforce --gate-retry-feedback violations --gate-max-retries 2 > "$TEST_TMP/s1-cap-violations-stdout.txt"
[ "$(json_get "$CAP_VIOL/result.json" gate_retries_by_turn)" = "[0,0,2,2,2]" ] || fail "e: violations cap (got $(json_get "$CAP_VIOL/result.json" gate_retries_by_turn))"
[ "$(json_get "$CAP_VIOL/result.json" gate_exhausted)" = "true" ] || fail "e: violations gate_exhausted"
[ ! -e "$CAP_VIOL/retry_3_3.md" ] || fail "e: third violation retry"
echo "e green: cap is 2 retries per triggered turn and gate_exhausted is set"

export ORCH_STUB_BIN="$TEST_TMP/noop-stub.sh"
NEG_MUT="$TEST_TMP/s1-neg/evals/orchestration/run-orchestration-eval.sh"
copy_harness "$NEG_MUT"
python3 - "$NEG_MUT" << 'PY'
import sys
path = sys.argv[1]
file = open(path).read()
old = '[ "$GATE_RETRY_FEEDBACK" = "violations+features" ] && [ "$vexit" -eq 0 ]'
new = '{ [ "$GATE_RETRY_FEEDBACK" = "violations+features" ] || [ "$GATE_RETRY_FEEDBACK" = "violations" ]; } && [ "$vexit" -eq 0 ]'
if old not in file:
    raise SystemExit("violations+features gap predicate missing")
open(path, "w").write(file.replace(old, new, 1))
PY
NEG_RED="$TEST_TMP/s1-neg-red"
run_harness "$NEG_MUT" "$NEG_RED" --gate enforce --gate-retry-feedback violations > "$TEST_TMP/s1-neg-red-stdout.txt"
NEG_RED_RETRIES="$(json_get "$NEG_RED/result.json" gate_retries)"
[ "$NEG_RED_RETRIES" != "0" ] || fail "f: mutant violations mode should retry feature gaps"
NEG_OUT="$TEST_TMP/s1-neg"
run_harness "$HARNESS" "$NEG_OUT" --gate enforce --gate-retry-feedback violations > "$TEST_TMP/s1-neg-stdout.txt"
[ "$(json_get "$NEG_OUT/result.json" gate_retries)" = "0" ] || fail "f: violations mode retried a feature gap ($(json_get "$NEG_OUT/result.json" gate_retries))"
compgen -G "$NEG_OUT/retry_*.md" > /dev/null && fail "f: violations mode wrote a retry prompt" || true
echo "f green: violations mode does not retry feature gaps"

set +e
bash "$HARNESS" --task t14-constraint-horizon --arm off --runner stub --model test-model --out "$TEST_TMP/s1-bad-feedback" --gate enforce --gate-retry-feedback sideways > "$TEST_TMP/s1-bad-feedback.txt" 2>&1
BAD_FEEDBACK=$?
bash "$HARNESS" --task t14-constraint-horizon --arm off --runner stub --model test-model --out "$TEST_TMP/s1-feedback-needs-gate" --gate-retry-feedback violations > "$TEST_TMP/s1-feedback-needs-gate.txt" 2>&1
NEEDS_GATE=$?
set -e
[ "$BAD_FEEDBACK" -eq 2 ] || fail "g: invalid --gate-retry-feedback should exit 2 (got $BAD_FEEDBACK)"
[ "$NEEDS_GATE" -eq 2 ] || fail "g: --gate-retry-feedback without --gate should exit 2 (got $NEEDS_GATE)"
grep -q "Usage:" "$TEST_TMP/s1-bad-feedback.txt" || fail "g: invalid value did not print a usage error"
echo "g green: invalid feedback exits 2 and gate-off stays on the base probe"

echo "=== Orchestration gate tests passed ==="
exit 0
