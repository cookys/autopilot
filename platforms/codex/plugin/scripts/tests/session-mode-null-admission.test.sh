#!/usr/bin/env bash
# Regression: `session-mode.js set` must not TypeError when Mission routing resolves
# to a non-LEGACY status with a NULL admission (Mission enabled but routing not fully
# wired). Pre-fix, scripts/session-mode.js dereferenced `missionRouting.admission
# .admission_digest` unconditionally inside the `status !== 'LEGACY'` branch, so EVERY
# `set` — at any level — crashed on such a repo. Observed 2026-08-20 (codepower).
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$SCRIPT_ROOT/scripts/session-mode.js"
TEST_TMP="$(mktemp -d -t "session-mode-null-admission-XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT

PASS_COUNT=0
FAILS=()
TEST_NAME="session-mode-null-admission"

assert_eq() {
  if [ "$1" = "$2" ]; then PASS_COUNT=$((PASS_COUNT + 1));
  else FAILS+=("$3: expected '$2', got '$1'"); fi
}

# --- fixture repo: Mission convergence enabled, routing yields admission=null ---
REPO="$TEST_TMP/repo"
mkdir -p "$REPO/.claude"
git -C "$REPO" init -q 2>/dev/null || { git init -q "$REPO"; }
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name test
# `mission_convergence` is a TOP-LEVEL key (sibling of `governance`), not nested
# under it — nesting it silently yields LEGACY routing and the test passes vacuously.
cat > "$REPO/.claude/owner-kernel-governance.json" <<'JSON'
{
  "schema_version": 1,
  "governance": { "default_mode": "owner-led" },
  "mission_convergence": {
    "schema_version": 1,
    "enforcement_mode": "shadow",
    "max_campaigns": 10,
    "max_wall_seconds": 36000,
    "max_tool_calls": 1500,
    "max_engine_attempts": 50,
    "max_external_wait_seconds": 14400,
    "max_canonical_changed_files": 500,
    "max_output_bytes": 50000000,
    "max_deliverables": 8,
    "max_parallel": 3,
    "max_batches": 2,
    "max_graph_depth": 2,
    "max_gate_attempts": 12,
    "closure_ratio": 1,
    "max_stagnant_campaigns": 2
  }
}
JSON
git -C "$REPO" add -A >/dev/null 2>&1 || true
git -C "$REPO" commit -qm init >/dev/null 2>&1 || true

export AUTOPILOT_SESSION_ID="null-admission-test-$$"

set +e
OUT="$(node "$SCRIPT" set --level l5 --repo-root "$REPO" 2>&1)"
RC=$?
set -e

assert_eq "$RC" "0" "set exits 0 on a null-admission Mission repo"

case "$OUT" in
  *TypeError*) FAILS+=("set must not TypeError; got: $OUT") ;;
  *) PASS_COUNT=$((PASS_COUNT + 1)) ;;
esac

# The marker must still record routing truthfully, and must NOT carry a mission_noop
# surface it cannot key (mission_noop is optional to verifyMissionRoutingProjection).
MARKER="$(node -e '
  const o = JSON.parse(process.argv[1]);
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(o.marker_path, "utf8"));
  const routing = m.mission_routing || null;
  process.stdout.write(JSON.stringify({
    has_routing: Boolean(routing),
    admission_null: Boolean(routing) && routing.admission === null,
    has_noop: Object.prototype.hasOwnProperty.call(m, "mission_noop"),
  }));
' "$OUT" 2>/dev/null || echo '{}')"

assert_eq "$(node -e 'process.stdout.write(String((JSON.parse(process.argv[1]).admission_null)===true))' "$MARKER" 2>/dev/null)" \
  "true" "marker records admission=null verbatim"
assert_eq "$(node -e 'process.stdout.write(String((JSON.parse(process.argv[1]).has_noop)===false))' "$MARKER" 2>/dev/null)" \
  "true" "marker omits mission_noop when there is no admission to key it"

node "$SCRIPT" clear >/dev/null 2>&1 || true

if [ ${#FAILS[@]} -gt 0 ]; then
  printf '%s: FAIL (%d passed)\n' "$TEST_NAME" "$PASS_COUNT"
  printf '  - %s\n' "${FAILS[@]}"
  exit 1
fi
printf '%s: PASS (%d assertions)\n' "$TEST_NAME" "$PASS_COUNT"
