#!/usr/bin/env bash
# P3 live reverse probe: verify plan-to-tasks.js dispatches dependency-queued
# tasks (--queue/--after) for a join plan and rejects a CONDITIONAL receipt.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/plan-to-tasks.js"

TMPDIR_PROBE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_PROBE"' EXIT
export HOME="$TMPDIR_PROBE/home"
mkdir -p "$HOME"

TEST_REPO="$TMPDIR_PROBE/repo"
mkdir -p "$TEST_REPO/docs/plans"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email "test@example.com"
git -C "$TEST_REPO" config user.name "Test User"

cat > "$TEST_REPO/docs/plans/2026-11-25-p3.md" <<'EOF'
# P3 Probe Plan
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok 1      | no         | First phase |
| P2 | S    | P1         | echo ok 2      | yes        | Second phase |
<!-- /phases -->
EOF

git -C "$TEST_REPO" add docs/plans/2026-11-25-p3.md
git -C "$TEST_REPO" commit -q -m "add p3 plan"
COMMIT_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
PLAN_SHA="$(node -e "const fs=require('fs'),crypto=require('crypto'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));" "$TEST_REPO/docs/plans/2026-11-25-p3.md")"

RECEIPT="$TMPDIR_PROBE/p3.freeze-receipt.json"
cat > "$RECEIPT" <<EOF
{"commit":"$COMMIT_SHA","path":"docs/plans/2026-11-25-p3.md","sha256":"$PLAN_SHA","verdict":"adjudicated"}
EOF

FLEET_LOG="$TMPDIR_PROBE/fleet.log"
FLEET_STATE="$TMPDIR_PROBE/fleet-tasks.json"
echo '[]' > "$FLEET_STATE"

STUB_FLEET="$TMPDIR_PROBE/fleet-stub.sh"
cat > "$STUB_FLEET" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$TEST_FLEET_LOG"
case "${1:-}" in
  lock) exit 0 ;;
  tasks) cat "$TEST_FLEET_STATE"; exit 0 ;;
  dispatch)
    shift 2
    body="${*: -1}"
    node -e "
      const fs = require('fs');
      const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const id = 'T-' + (state.length + 1);
      state.push({ task_id: id, title: process.argv[2].split('\n')[0] });
      fs.writeFileSync(process.argv[1], JSON.stringify(state));
      process.stdout.write(id + '\n');
    " "$TEST_FLEET_STATE" "$body"
    exit 0
    ;;
esac
exit 1
STUB
chmod +x "$STUB_FLEET"

export PLAN_TO_TASKS_FLEET_BIN="$STUB_FLEET"
export PLAN_TO_TASKS_ASSIGNEE="test/courier/member"
export TEST_FLEET_LOG="$FLEET_LOG"
export TEST_FLEET_STATE="$FLEET_STATE"

(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null
if ! grep -q -- "--queue --after T-1" "$FLEET_LOG"; then
  echo "FAIL (p3): expected '--queue --after T-1' in fleet dispatch log" >&2
  exit 1
fi

BAD_RECEIPT="$TMPDIR_PROBE/p3-bad.freeze-receipt.json"
sed 's/"verdict":"adjudicated"/"verdict":"CONDITIONAL"/' "$RECEIPT" > "$BAD_RECEIPT"

set +e
err="$(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$BAD_RECEIPT" 2>&1 >/dev/null)"
rc=$?
set -e

if [ "$rc" -ne 1 ]; then
  echo "FAIL (p3): expected rc=1 on CONDITIONAL verdict, got rc=$rc" >&2
  exit 1
fi
if ! printf '%s' "$err" | grep -q "CONDITIONAL"; then
  echo "FAIL (p3): expected 'CONDITIONAL' in stderr, got: $err" >&2
  exit 1
fi

echo "PASS (p3)"
