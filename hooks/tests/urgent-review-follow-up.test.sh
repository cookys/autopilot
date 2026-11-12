#!/usr/bin/env bash
# hooks/tests/urgent-review-follow-up.test.sh — scripts/lib/urgent-review-follow-up.js
# Urgent + high_risk false prints one project-record command (effort M, fix sha) and a backlog row.
# high_risk true, urgent not true, and absent high_risk print nothing. No fleet call, no file write.
# Negative control: a helper that ignores urgent/high_risk prints on the silent cases; this file goes red.

set -uo pipefail
AUTOPILOT_TEST_LIB_HELPERS_ONLY=1 . "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UF="$REPO_ROOT/scripts/lib/urgent-review-follow-up.js"
TEST_TMP=$(mktemp -d -t "urgent-follow-up-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }
eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1: expected [$2] got [$3]"; fi; }
has() { case "$3" in *"$2"*) ok "$1" ;; *) bad "$1: [$3] lacks [$2]" ;; esac; }
empty() { if [ -z "$2" ]; then ok "$1"; else bad "$1: expected empty, got [$2]"; fi; }

unset AUTOPILOT_PARENT_SESSION_ID AUTOPILOT_SESSION_ID
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
SHA=0123456789abcdef0123456789abcdef01234567

mark() { # file json
  printf '%s\n' "$2" > "$1"
}
run() {
  OUT=$(node "$UF" --marker "$1" --sha "$SHA" 2>"$TEST_TMP/err"); RC=$?; ERR=$(cat "$TEST_TMP/err")
}

M="$TEST_TMP/m.json"
mark "$M" '{"urgent":true,"high_risk":false}'
run "$M"
eq "urgent non-high-risk rc" "0" "$RC"
has "prints project-record backlog new" "node scripts/project-record.js backlog new" "$OUT"
has "effort M" "--effort M" "$OUT"
has "fix sha in the command" "$SHA" "$OUT"
has "backlog heading" "### Review urgent fix 0123456" "$OUT"
has "row effort M" "- **Effort**: M" "$OUT"
has "row status open" "- **Status**: open" "$OUT"
has "row pointer none" "- **Pointer**: none" "$OUT"
has "row context carries the sha" "- **Context**: fix $SHA" "$OUT"
# one command line, then a blank line, then the row. No fleet verb.
FIRST=$(printf '%s\n' "$OUT" | head -n 1)
case "$FIRST" in
  *"fleet "*) bad "command must not call fleet" ;;
  "node scripts/project-record.js backlog new "*) ok "first line is the project-record command" ;;
  *) bad "first line is not the command: $FIRST" ;;
esac
eq "no stderr on a print" "" "$ERR"

mark "$M" '{"urgent":true,"high_risk":true}'
run "$M"
eq "high-risk rc" "0" "$RC"
empty "high-risk prints nothing" "$OUT"

mark "$M" '{"urgent":false,"high_risk":false}'
run "$M"
eq "non-urgent rc" "0" "$RC"
empty "non-urgent prints nothing" "$OUT"

mark "$M" '{"urgent":true}'
run "$M"
eq "absent high_risk rc" "0" "$RC"
empty "absent high_risk prints nothing" "$OUT"

OUT=$(node "$UF" --sha "$SHA" --session-id "no-such-session-$RANDOM" 2>"$TEST_TMP/err"); RC=$?
eq "missing marker rc" "0" "$RC"
empty "missing marker prints nothing" "$OUT"

OUT=$(node "$UF" --nope 2>"$TEST_TMP/err"); RC=$?
eq "unknown flag rc" "1" "$RC"

echo "urgent-review-follow-up.test: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
