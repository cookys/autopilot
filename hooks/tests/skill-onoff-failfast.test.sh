#!/usr/bin/env bash
# hooks/tests/skill-onoff-failfast.test.sh — eval campaign fail-fast + runner pin (BL-0112, BL-0113), spend-free (stub runner)
#
#   F1 auth failure (claude -p style: is_error line on stdout, exit 1) -> cause=authentication, matrix exit 4 after ONE cell
#   F2 quota failure -> cause=quota, exit 4 after one cell
#   F3 negative control: an unrecognised infra_fail cause (runner_error) does NOT abort — only authentication/quota do
#   F4 runner version drift mid-campaign -> exit 3 before the next cell; stable version -> all cells run (negative control)
#   F5 resume against a different runner version -> exit 3, no rows added; same version resumes
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
MATRIX="${MATRIX_UNDER_TEST:-$BASE/run-skill-onoff-matrix.sh}"
TEST_TMP=$(mktemp -d -t "skill-onoff-failfast-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

STUB="$TEST_TMP/stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
case "${STUB_MODE:-ok}" in
  auth)  echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}'; exit 1 ;;
  quota) echo '{"type":"result","is_error":true,"result":"You have hit your weekly limit"}'; exit 1 ;;
  toolnoise) # tool_result is_error line mentioning quota, terminal result is unrelated
    echo '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"quota exceeded forbidden unauthorized"}]}}'
    echo '{"type":"result","is_error":true,"result":"crashed for no listed reason"}'; exit 1 ;;
  manyerr) # 6 tool errors, then a terminal auth failure
    for i in 1 2 3 4 5 6; do echo '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"ENOENT"}]}}'; done
    echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}'; exit 1 ;;
  boom)  echo '{"type":"result","is_error":true,"result":"something odd"}'; exit 1 ;;
  bump)  echo '{"probe":"ok"}'; echo "${STUB_VERSION_NEXT:-v2}" > "$STUB_VERSION_FILE"; exit 0 ;;
  *)     echo '{"probe":"ok"}'; exit 0 ;;
esac
STUBEOF
chmod +x "$STUB"
export ONOFF_STUB_BIN="$STUB"

run_matrix() { # $1 results, rest = extra args; echoes exit code; stderr kept in $TEST_TMP/err
  set +e
  bash "$MATRIX" --model m --reps "${REPS:-1}" --results "$1" --tasks d4-hotfix --runner stub "${@:2}" >"$TEST_TMP/out" 2>"$TEST_TMP/err"
  local rc=$?
  set -e
  echo "$rc"
}
rows() { grep -c . "$1" 2>/dev/null || echo 0; }

echo "=== F1: auth failure stops after one cell ==="
R="$TEST_TMP/f1.jsonl"; rc=$(STUB_MODE=auth run_matrix "$R")
[ "$rc" = 4 ] || fail "F1 exit $rc (want 4): $(cat "$TEST_TMP/err")"
[ "$(rows "$R")" = 1 ] || fail "F1 ran $(rows "$R") cells (want 1)"
grep -q '"failure_cause":"authentication"' "$R" || fail "F1 cause not authentication: $(cat "$R")"
grep -q 'ABORT' "$TEST_TMP/err" || fail "F1 no reason on stderr"

echo "=== F2: quota failure stops after one cell ==="
R="$TEST_TMP/f2.jsonl"; rc=$(STUB_MODE=quota run_matrix "$R")
[ "$rc" = 4 ] || fail "F2 exit $rc (want 4)"
[ "$(rows "$R")" = 1 ] || fail "F2 ran $(rows "$R") cells (want 1)"
grep -q '"failure_cause":"quota"' "$R" || fail "F2 cause not quota: $(cat "$R")"

echo "=== F3: negative control, unrecognised failure keeps the old 3-attempt rule ==="
R="$TEST_TMP/f3.jsonl"; rc=$(STUB_MODE=boom run_matrix "$R" --arms full,card,off)
[ "$rc" = 0 ] || fail "F3 runner_error must not abort the matrix (exit $rc)"
[ "$(rows "$R")" = 3 ] || fail "F3 ran $(rows "$R") cells (want 3)"
grep -q '"failure_cause":"runner_error"' "$R" || fail "F3 cause not runner_error"

echo "=== F3b: tool_result noise must not classify (negative control) ==="
R="$TEST_TMP/f3b.jsonl"; rc=$(STUB_MODE=toolnoise run_matrix "$R")
[ "$rc" = 0 ] || fail "F3b tool_result quota text aborted the matrix (exit $rc)"
grep -q '"failure_cause":"runner_error"' "$R" || fail "F3b want runner_error: $(cat "$R")"
echo "=== F3c: terminal auth line after 6+ tool errors is found ==="
R="$TEST_TMP/f3c.jsonl"; rc=$(STUB_MODE=manyerr run_matrix "$R")
[ "$rc" = 4 ] || fail "F3c exit $rc (want 4)"
grep -q '"failure_cause":"authentication"' "$R" || fail "F3c want authentication: $(cat "$R")"
echo "=== F3d: aborting cell is retained under ONOFF_KEEP_CELLS_DIR ==="
K="$TEST_TMP/keep"; R="$TEST_TMP/f3d.jsonl"; rc=$(ONOFF_KEEP_CELLS_DIR="$K" STUB_MODE=auth run_matrix "$R")
if [ "$rc" != 4 ] || [ ! -f "$K/d4-hotfix/full/1/transcript.jsonl" ]; then fail "F3d aborted cell not retained (exit $rc)"; fi

echo "=== F4: version drift mid-campaign ==="
VF="$TEST_TMP/ver"; echo v1 > "$VF"; export STUB_VERSION_FILE="$VF"
R="$TEST_TMP/f4.jsonl"; rc=$(ONOFF_VERSION_CMD="cat $VF" STUB_MODE=bump run_matrix "$R" --arms full,card,off)
[ "$rc" = 3 ] || fail "F4 exit $rc (want 3): $(cat "$TEST_TMP/err")"
[ "$(rows "$R")" = 1 ] || fail "F4 ran $(rows "$R") cells (want 1)"
grep -q "drifted" "$TEST_TMP/err" || fail "F4 no drift message"
[ "$(cat "$R.runner-pin")" = v1 ] || fail "F4 pin file not v1"
echo v1 > "$VF"; R="$TEST_TMP/f4n.jsonl"; rc=$(ONOFF_VERSION_CMD="cat $VF" STUB_MODE=ok run_matrix "$R" --arms full,card,off)
if [ "$rc" != 0 ] || [ "$(rows "$R")" != 3 ]; then fail "F4 negative control: stable version must run all cells (exit $rc)"; fi

echo "=== F5: resume against a different version refuses ==="
R="$TEST_TMP/f4n.jsonl"; echo v9 > "$VF"
before=$(rows "$R"); rc=$(ONOFF_VERSION_CMD="cat $VF" STUB_MODE=ok REPS=2 run_matrix "$R" --arms full,card,off)
[ "$rc" = 3 ] || fail "F5 exit $rc (want 3)"
[ "$(rows "$R")" = "$before" ] || fail "F5 rows added despite version change"
echo v1 > "$VF"; rc=$(ONOFF_VERSION_CMD="cat $VF" STUB_MODE=ok REPS=2 run_matrix "$R" --arms full,card,off)
if [ "$rc" != 0 ] || [ "$(rows "$R")" != 6 ]; then fail "F5 same-version resume (exit $rc rows $(rows "$R"))"; fi

echo "PASS: skill-onoff-failfast"
