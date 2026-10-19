#!/usr/bin/env bash
# hooks/tests/orchestration-eval-gate.test.sh — BL-0055 S2 harness --gate
# RED at d7ce15a9e: unmodified harness has no gate_enforce_wants_retry; the NC6 mutant step exited 1 with "gate_enforce_wants_retry missing" before any enforce retry could run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EVAL_DIR="$REPO_ROOT/evals/orchestration"
HARNESS="$EVAL_DIR/run-orchestration-eval.sh"
BASE_SHA="3a72a54dcaf2df27ed82a9d8a42bd776c93b23b5"
EVIDENCE="$REPO_ROOT/docs/plans/evidence/2026-10-19-t14-gate-experiment/s2-red.txt"
BAD_CSV="$EVAL_DIR/tasks/t14-constraint-horizon/gate/fixtures/bad-csv/cli.py"
TEST_TMP=$(mktemp -d -t "orchestration-eval-gate-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
mkdir -p "$(dirname "$EVIDENCE")"
: > "$EVIDENCE"

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
} >> "$EVIDENCE"
if [ "$NC6_RED_STATUS" -ne 0 ] || [ ! -f "$NC6_RED_OUT/result.json" ]; then
  fail "NC6 mutant did not produce a result (exit $NC6_RED_STATUS)"
fi
NC6_RED_RETRIES="$(json_get "$NC6_RED_OUT/result.json" gate_retries)"
if [ "$NC6_RED_RETRIES" != "0" ]; then
  fail "NC6 mutant should record 0 retries (got $NC6_RED_RETRIES)"
fi
echo "RED NC6: enforce with the retry predicate removed recorded gate_retries=0" >> "$EVIDENCE"

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
} >> "$EVIDENCE"
if [ "$NC7_RED_STATUS" -ne 0 ] || [ ! -f "$NC7_RED_OUT/result.json" ]; then
  fail "NC7 mutant did not produce a result (exit $NC7_RED_STATUS)"
fi
NC7_RED_RETRIES="$(json_get "$NC7_RED_OUT/result.json" gate_retries)"
if [ "$NC7_RED_RETRIES" = "0" ]; then
  fail "NC7 mutant observe should retry and the red control did not fire"
fi
echo "RED NC7: observe mutant recorded gate_retries=$NC7_RED_RETRIES" >> "$EVIDENCE"

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
} >> "$EVIDENCE"
if [ "$NC8_HITS" = "0" ]; then
  fail "NC8 mutant should leave verify-turn.js in the temp repo"
fi
echo "RED NC8: copied verifier is visible in the temp repo" >> "$EVIDENCE"

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

echo "=== Orchestration gate tests passed ==="
exit 0
