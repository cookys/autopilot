#!/usr/bin/env bash
# session-mode.test.sh — black-box CLI contract for scripts/session-mode.js
# (orchestrator-mode marker: set/clear/status, TTL expiry, level validation,
#  session-id keying, atomic overwrite).
# Run: bash hooks/tests/session-mode.test.sh
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$REPO_ROOT/scripts/session-mode.js"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export AUTOPILOT_SESSION_MODE_DIR="$TMP/markers"
export CLAUDE_CODE_SESSION_ID="test-session-aaa"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok - $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL - $1"; }
check() { # desc, expected-exit, actual-exit
  [ "$2" = "$3" ] && ok "$1" || fail "$1 (want exit $2, got $3)"
}

# 1. status with no marker → active:false, exit 0
OUT=$(node "$CLI" status 2>/dev/null); RC=$?
check "status no-marker exit 0" 0 "$RC"
echo "$OUT" | grep -q '"active": *false' && ok "status no-marker active:false" || fail "status no-marker active:false ($OUT)"

# 2. set l5 → exit 0, marker file exists, status reports level
node "$CLI" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1; RC=$?
check "set l5 exit 0" 0 "$RC"
[ -f "$TMP/markers/test-session-aaa.json" ] && ok "marker file created" || fail "marker file created"
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"active": *true' && ok "status active:true after set" || fail "status active:true after set ($OUT)"
echo "$OUT" | grep -q '"level": *"l5"' && ok "status level l5" || fail "status level l5 ($OUT)"
echo "$OUT" | grep -q "\"repo_root\": *\"$REPO_ROOT\"" && ok "status repo_root" || fail "status repo_root ($OUT)"

# 3. overwrite: set l3 over l5 → level becomes l3 (same-session mode change; MiniMax stale-marker case)
node "$CLI" set --level l3 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"level": *"l3"' && ok "overwrite l5→l3" || fail "overwrite l5→l3 ($OUT)"

# 4. invalid level → exit 2, no marker change
node "$CLI" set --level l9 --repo-root "$REPO_ROOT" >/dev/null 2>&1; RC=$?
check "invalid level exit 2" 2 "$RC"
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"level": *"l3"' && ok "invalid level leaves marker intact" || fail "invalid level leaves marker intact"

# 5. TTL expiry: marker with past expires_at → status active:false (fail-open)
node "$CLI" set --level l5 --repo-root "$REPO_ROOT" --ttl-hours 0 >/dev/null 2>&1
sleep 1
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q '"active": *false' && ok "expired marker → active:false" || fail "expired marker → active:false ($OUT)"

# 6. clear → marker gone, status active:false, clear again idempotent exit 0
node "$CLI" set --level l4 --repo-root "$REPO_ROOT" >/dev/null 2>&1
node "$CLI" clear >/dev/null 2>&1; RC=$?
check "clear exit 0" 0 "$RC"
[ ! -f "$TMP/markers/test-session-aaa.json" ] && ok "marker removed" || fail "marker removed"
node "$CLI" clear >/dev/null 2>&1; RC=$?
check "clear idempotent exit 0" 0 "$RC"

# 7. session-id isolation: marker for A invisible to session B
node "$CLI" set --level l5 --repo-root "$REPO_ROOT" >/dev/null 2>&1
OUT=$(CLAUDE_CODE_SESSION_ID="test-session-bbb" node "$CLI" status)
echo "$OUT" | grep -q '"active": *false' && ok "session-id isolation" || fail "session-id isolation ($OUT)"

# 8. corrupt marker → status active:false, exit 0 (fail-open)
echo 'not json{{{' > "$TMP/markers/test-session-aaa.json"
OUT=$(node "$CLI" status 2>/dev/null); RC=$?
check "corrupt marker exit 0" 0 "$RC"
echo "$OUT" | grep -q '"active": *false' && ok "corrupt marker → active:false" || fail "corrupt marker → active:false ($OUT)"

# 9. set defaults repo_root to cwd git toplevel when omitted
cd "$REPO_ROOT"
node "$CLI" set --level l6 >/dev/null 2>&1; RC=$?
check "set without --repo-root exit 0" 0 "$RC"
OUT=$(node "$CLI" status)
echo "$OUT" | grep -q "\"repo_root\": *\"$REPO_ROOT\"" && ok "repo_root defaults to git toplevel" || fail "repo_root defaults to git toplevel ($OUT)"

echo "---"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
