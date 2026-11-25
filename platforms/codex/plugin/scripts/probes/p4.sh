#!/usr/bin/env bash
# P4 live reverse probe: verify fleet-task-ref.js pm-check allows an open
# Fleet-Task and enforces (rc=2) when Fleet-Task is missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$REPO_ROOT/scripts/lib/fleet-task-ref.js"

TMPDIR_PROBE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_PROBE"' EXIT
export HOME="$TMPDIR_PROBE/home"
mkdir -p "$HOME"

STUB_FLEET="$TMPDIR_PROBE/fleet-stub.sh"
cat > "$STUB_FLEET" <<'STUB'
#!/usr/bin/env bash
printf '{"id":"%s","status":"open"}\n' "${3:-}"
STUB
chmod +x "$STUB_FLEET"

export FLEET_BIN="$STUB_FLEET"
unset AUTOPILOT_FLEET_TASK AUTOPILOT_UPSTREAM_TASK_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_DISPATCH_ROLE || true

node "$GATE" pm-check --fleet-task 01M7R609WK44HJP629E6C93Q9N >/dev/null

set +e
err="$(node "$GATE" pm-check 2>&1 >/dev/null)"
rc=$?
set -e

if [ "$rc" -ne 2 ]; then
  echo "FAIL (p4): expected rc=2 on missing Fleet-Task, got rc=$rc" >&2
  exit 1
fi
if ! printf '%s' "$err" | grep -q "Fleet-Task precondition failed: missing Fleet-Task"; then
  echo "FAIL (p4): expected 'Fleet-Task precondition failed: missing Fleet-Task' in stderr, got: $err" >&2
  exit 1
fi

echo "PASS (p4)"
