#!/usr/bin/env bash
set -euo pipefail

# P4 Fleet-Task gate tests (all-lane single-ticket gate).
# Uses sandbox HOME + stub fleet binary; never touches live config or real fleet.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$ROOT_DIR/hooks/dispatch-model-guard.js"
HETERO="$ROOT_DIR/scripts/dispatch-hetero.sh"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

SANDBOX_HOME="$TMP_DIR/home"
STUB_BIN="$TMP_DIR/bin"
mkdir -p "$SANDBOX_HOME" "$STUB_BIN"

PASS=0
FAIL=0

assert_eq() {
  local name="$1" got="$2" want="$3"
  if [ "$got" = "$want" ]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL [$name]: got='$got' want='$want'" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local name="$1" hay="$2" needle="$3"
  if printf '%s' "$hay" | grep -qF "$needle"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL [$name]: expected to contain '$needle', got: $hay" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Stub fleet binary controlled by STUB_FLEET_MODE: open | not_found | closed | unavailable
cat > "$STUB_BIN/fleet" <<'EOF'
#!/usr/bin/env bash
case "${STUB_FLEET_MODE:-open}" in
  open)
    printf '{"id":"%s","status":"open"}\n' "${3:-01M88GP63J9GTMXM23MNW5HSRK}"
    exit 0
    ;;
  not_found)
    printf '{"error":"not_found"}\n'
    exit 1
    ;;
  closed)
    printf '{"id":"%s","status":"done"}\n' "${3:-01M88GP63J9GTMXM23MNW5HSRK}"
    exit 0
    ;;
  unavailable)
    exit 1
    ;;
esac
EOF
chmod +x "$STUB_BIN/fleet"

run_guard() {
  local prompt="$1"
  local payload
  payload="$(node -e '
    console.log(JSON.stringify({
      tool_name: "Agent",
      cwd: process.argv[1],
      tool_input: { subagent_type: "general-purpose", model: "sonnet", prompt: process.argv[2] }
    }));
  ' "$ROOT_DIR" "$prompt")"
  HOME="$SANDBOX_HOME" PATH="$STUB_BIN:$PATH" \
    AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=remind \
    node "$GUARD" <<< "$payload" 2>"$TMP_DIR/guard.err" || true
}

# 1. Non-PM seat missing Fleet-Task -> denied
OUT="$(STUB_FLEET_MODE=open run_guard $'Engine: sonnet\nLane: autopilot\nDo work')"
assert_contains "guard-non-pm-missing" "$OUT" '"permissionDecision":"deny"'

# 2. Non-PM seat with open Fleet-Task -> allowed
OUT="$(STUB_FLEET_MODE=open run_guard $'Engine: sonnet\nFleet-Task: 01M88GP63J9GTMXM23MNW5HSRK\nLane: autopilot\nDo work')"
if printf '%s' "$OUT" | grep -qF '"permissionDecision":"deny"'; then
  echo "FAIL [guard-open]: unexpectedly denied: $OUT" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# 3. not_found -> denied
OUT="$(STUB_FLEET_MODE=not_found run_guard $'Engine: sonnet\nFleet-Task: 01M88GP63J9GTMXM23MNW5HSRK\nLane: autopilot\nDo work')"
assert_contains "guard-not-found" "$OUT" '"permissionDecision":"deny"'

# 4. closed -> denied
OUT="$(STUB_FLEET_MODE=closed run_guard $'Engine: sonnet\nFleet-Task: 01M88GP63J9GTMXM23MNW5HSRK\nLane: autopilot\nDo work')"
assert_contains "guard-closed" "$OUT" '"permissionDecision":"deny"'

# 5. unavailable -> fail-open (allowed)
OUT="$(STUB_FLEET_MODE=unavailable run_guard $'Engine: sonnet\nFleet-Task: 01M88GP63J9GTMXM23MNW5HSRK\nLane: autopilot\nDo work')"
if printf '%s' "$OUT" | grep -qF '"permissionDecision":"deny"'; then
  echo "FAIL [guard-unavailable]: unexpectedly denied: $OUT" >&2
  FAIL=$((FAIL + 1))
else
  PASS=$((PASS + 1))
fi

# 6. dispatch-hetero.sh negative control: missing Fleet-Task exits 2 BEFORE worktree creation
BRIEF="$TMP_DIR/brief.md"
printf 'Implement feature X\n' > "$BRIEF"
WT_PARENT="$TMP_DIR/wt"
mkdir -p "$WT_PARENT"

rc=0
HETERO_OUT="$(HOME="$SANDBOX_HOME" PATH="$STUB_BIN:$PATH" \
  AUTOPILOT_FLEET_TASK="" AUTOPILOT_UPSTREAM_TASK_ID="" \
  bash "$HETERO" --no-campaign --branch "feat/test-p4-neg" --prompt-file "$BRIEF" --worktree-parent "$WT_PARENT" 2>&1)" || rc=$?
assert_eq "hetero-missing-rc" "$rc" "2"
assert_contains "hetero-missing-err" "$HETERO_OUT" "Fleet-Task"
# Verify no worktree was created
WT_COUNT="$(ls -A "$WT_PARENT" | wc -l | tr -d ' ')"
assert_eq "hetero-no-worktree" "$WT_COUNT" "0"

echo "fleet-task-gate.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
