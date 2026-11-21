#!/usr/bin/env bash
# scripts/bg-quiet.test.sh — Sandboxed tests for scripts/bg-quiet.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BG_QUIET="${REPO_ROOT}/scripts/bg-quiet.sh"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

export HOME="${TMP_ROOT}/home"
export XDG_RUNTIME_DIR="${TMP_ROOT}/xdg"
export CLAUDE_CODE_SESSION_ID="test-sess-$$"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"

QUEUE_DIR="${XDG_RUNTIME_DIR}/autopilot/bg-quiet/${CLAUDE_CODE_SESSION_ID}"
FLEET_LOG="${TMP_ROOT}/fleet-argv.log"
STUB_FLEET="${TMP_ROOT}/fleet-stub"

cat > "$STUB_FLEET" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$STUB_FLEET_LOG"
echo "fleet: courier socket mismatch: test" >&2
if [ "${STUB_FLEET_FAIL:-0}" = "1" ]; then
  echo "simulated watch failure" >&2
  exit 2
fi
echo "01JABCDEFGHJKMNPQRSTVWXYZ0 (task t-1)"
exit 0
EOF
chmod +x "$STUB_FLEET"
export FLEET_BIN="$STUB_FLEET"
export STUB_FLEET_LOG="$FLEET_LOG"

wait_for_file() {
  local pattern="$1"
  local i=0
  while [ "$i" -lt 50 ]; do
    if compgen -G "$pattern" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

# 1. Success job -> .ok written, no .fail; stub saw exactly one watch --until-file registration
: > "$FLEET_LOG"
OUT="$("$BG_QUIET" --label ok-job -- bash -c 'echo hello-ok')"
echo "$OUT" | grep -q '^bg-quiet bg-.* watch=01JABCDEFGHJKMNPQRSTVWXYZ0 log='
wait_for_file "${QUEUE_DIR}/*.ok"
# The stub prints a stderr noise line first (as the real fleet does on this host); the recorded id must be the real one.
grep -q '"watch_id":"01JABCDEFGHJKMNPQRSTVWXYZ0"' "${QUEUE_DIR}"/*.json || { echo "FAIL: meta watch_id is not the 26-char id from stdout" >&2; exit 1; }
if compgen -G "${QUEUE_DIR}/*.fail" >/dev/null 2>&1; then
  echo "FAIL: unexpected .fail file on success" >&2
  exit 1
fi
WATCH_COUNT="$(grep -c '^watch --until-file ' "$FLEET_LOG")"
[ "$WATCH_COUNT" -eq 1 ] || { echo "FAIL: expected 1 watch call, got $WATCH_COUNT" >&2; exit 1; }
grep -qE -- '--timeout [0-9]+( |$)' "$FLEET_LOG" || { echo "FAIL: expected --timeout <digits> without unit suffix" >&2; exit 1; }
if grep -qE -- '--timeout [0-9]+[a-zA-Z]' "$FLEET_LOG"; then
  echo "FAIL: --timeout should not have a unit suffix" >&2
  exit 1
fi
rm -f "${QUEUE_DIR}"/*

# 2. Failing job (exit 3) -> .fail written with rc 3
: > "$FLEET_LOG"
"$BG_QUIET" --label fail-job -- bash -c 'echo oops; exit 3' >/dev/null
wait_for_file "${QUEUE_DIR}/*.fail"
FAIL_JSON="$(cat "${QUEUE_DIR}"/*.fail)"
node -e 'const d = JSON.parse(process.argv[1]); if (d.rc !== 3) process.exit(1);' "$FAIL_JSON"
rm -f "${QUEUE_DIR}"/*

# 3. Timeout job (--timeout 1s on sleep 5) -> .fail with rc 124
: > "$FLEET_LOG"
"$BG_QUIET" --timeout 1s --label timeout-job -- sleep 5 >/dev/null
wait_for_file "${QUEUE_DIR}/*.fail"
TIMEOUT_JSON="$(cat "${QUEUE_DIR}"/*.fail)"
node -e 'const d = JSON.parse(process.argv[1]); if (d.rc !== 124) process.exit(1);' "$TIMEOUT_JSON"
rm -f "${QUEUE_DIR}"/*

# 4. Stub fleet failing registration -> bg-quiet exits non-zero and does not run the command
MARKER="${TMP_ROOT}/should-not-exist"
if STUB_FLEET_FAIL=1 "$BG_QUIET" --label fail-reg -- touch "$MARKER" 2>/dev/null; then
  echo "FAIL: expected non-zero exit when fleet watch fails" >&2
  exit 1
fi
[ ! -e "$MARKER" ] || { echo "FAIL: command ran despite fleet watch failure" >&2; exit 1; }

echo "PASS: bg-quiet.test.sh (4/4)"
