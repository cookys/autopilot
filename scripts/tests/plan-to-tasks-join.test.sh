#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/plan-to-tasks.js"

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT
export HOME="$TMPDIR_TEST/home"
mkdir -p "$HOME"

PASS=0
FAIL=0

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
  else
    echo "FAIL ($name): expected '$expected', got '$actual'" >&2
    FAIL=$((FAIL + 1))
  fi
}

# Setup temp git repo with 3-predecessor join plan: P1, P2, P3 -> P4
TEST_REPO="$TMPDIR_TEST/repo"
mkdir -p "$TEST_REPO/docs/plans"
git -C "$TEST_REPO" init -q
git -C "$TEST_REPO" config user.email "test@example.com"
git -C "$TEST_REPO" config user.name "Test User"

cat > "$TEST_REPO/docs/plans/2026-11-25-join.md" <<'EOF'
# Join Plan
## 4. Phases
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok 1      | no         | Predecessor 1 |
| P2 | S    | -          | echo ok 2      | no         | Predecessor 2 |
| P3 | S    | -          | echo ok 3      | no         | Predecessor 3 |
| P4 | M    | P1, P2, P3 | echo ok 4      | yes        | Join phase |
<!-- /phases -->
EOF

git -C "$TEST_REPO" add docs/plans/2026-11-25-join.md
git -C "$TEST_REPO" commit -q -m "add join plan"
COMMIT_SHA="$(git -C "$TEST_REPO" rev-parse HEAD)"
PLAN_SHA="$(node -e "const fs=require('fs'),crypto=require('crypto'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'));" "$TEST_REPO/docs/plans/2026-11-25-join.md")"

RECEIPT="$TMPDIR_TEST/join.freeze-receipt.json"
cat > "$RECEIPT" <<EOF
{
  "commit": "$COMMIT_SHA",
  "path": "docs/plans/2026-11-25-join.md",
  "sha256": "$PLAN_SHA",
  "verdict": "READY"
}
EOF

FLEET_LOG="$TMPDIR_TEST/fleet.log"
FLEET_STATE="$TMPDIR_TEST/fleet-tasks.json"
FLEET_LOCK="$TMPDIR_TEST/fleet-claim.lock"
echo '[]' > "$FLEET_STATE"

STUB_FLEET="$TMPDIR_TEST/fleet-stub.sh"
cat > "$STUB_FLEET" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> "$TEST_FLEET_LOG"
cmd="${1:-}"

if [ "$cmd" = "claim" ]; then
  key="${2:-}"
  lock_dir="$TEST_FLEET_LOCK/$key"
  mkdir -p "$TEST_FLEET_LOCK"
  if mkdir "$lock_dir" 2>/dev/null; then
    exit 0
  else
    echo "already claimed: $key" >&2
    exit 1
  fi
fi

if [ "$cmd" = "tasks" ]; then
  cat "$TEST_FLEET_STATE"
  exit 0
fi

if [ "$cmd" = "dispatch" ]; then
  shift 2
  queued=0
  after_ids=()
  while [ $# -gt 1 ]; do
    case "$1" in
      --queue) queued=1; shift ;;
      --after) after_ids+=("$2"); shift 2 ;;
      --size|--parent) shift 2 ;;
      *) shift ;;
    esac
  done
  body="$1"
  if [ -n "${TEST_KILL_ON_PHASE:-}" ] && echo "$body" | grep -q "Phase: $TEST_KILL_ON_PHASE"; then
    echo "simulated kill on $TEST_KILL_ON_PHASE" >&2
    exit 1
  fi
  after_csv=""
  if [ "${#after_ids[@]}" -gt 0 ]; then
    after_csv="$(IFS=,; echo "${after_ids[*]}")"
  fi
  new_id="$(node -e "
    const fs = require('fs');
    const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const id = 'T-' + (state.length + 1);
    const queued = process.argv[3] === '1';
    const after = process.argv[4] ? process.argv[4].split(',').filter(Boolean) : [];
    state.push({
      task_id: id,
      title: process.argv[2].split('\n')[0],
      status: queued ? 'queued' : 'ready',
      after,
      released_count: 0
    });
    fs.writeFileSync(process.argv[1], JSON.stringify(state));
    process.stdout.write(id);
  " "$TEST_FLEET_STATE" "$body" "$queued" "$after_csv")"
  echo "$new_id"
  exit 0
fi

if [ "$cmd" = "done" ]; then
  target_id="${2:-}"
  node -e "
    const fs = require('fs');
    const state = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const target = state.find((t) => t.task_id === process.argv[2]);
    if (target) target.status = 'done';
    const doneIds = new Set(state.filter((t) => t.status === 'done').map((t) => t.task_id));
    for (const t of state) {
      if (t.status === 'queued' && Array.isArray(t.after) && t.after.every((id) => doneIds.has(id))) {
        t.status = 'ready';
        t.released_count = (t.released_count || 0) + 1;
      }
    }
    fs.writeFileSync(process.argv[1], JSON.stringify(state));
  " "$TEST_FLEET_STATE" "$target_id"
  exit 0
fi

exit 1
STUB
chmod +x "$STUB_FLEET"

export PLAN_TO_TASKS_FLEET_BIN="$STUB_FLEET"
export PLAN_TO_TASKS_ASSIGNEE="test/courier/member"
export TEST_FLEET_LOG="$FLEET_LOG"
export TEST_FLEET_STATE="$FLEET_STATE"
export TEST_FLEET_LOCK="$FLEET_LOCK"

get_task_field() {
  local tid="$1" field="$2"
  node -e "
    const fs = require('fs');
    const s = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const t = s.find((x) => x.task_id === process.argv[2]);
    process.stdout.write(t ? String(t[process.argv[3]]) : '');
  " "$FLEET_STATE" "$tid" "$field"
}

# 1. Three-predecessor join: not released until all 3 done, released exactly once after
: > "$FLEET_LOG"
echo '[]' > "$FLEET_STATE"
rm -rf "$FLEET_LOCK"
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null
assert_eq "join: 4 tasks created" "4" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$FLEET_STATE")"
assert_eq "join: T-4 initially queued" "queued" "$(get_task_field T-4 status)"

"$STUB_FLEET" done T-1
assert_eq "join: T-4 still queued after T-1 done" "queued" "$(get_task_field T-4 status)"
assert_eq "join: T-4 released_count 0 after T-1" "0" "$(get_task_field T-4 released_count)"

"$STUB_FLEET" done T-2
assert_eq "join: T-4 still queued after T-2 done" "queued" "$(get_task_field T-4 status)"
assert_eq "join: T-4 released_count 0 after T-2" "0" "$(get_task_field T-4 released_count)"

"$STUB_FLEET" done T-3
assert_eq "join: T-4 ready after all 3 done" "ready" "$(get_task_field T-4 status)"
assert_eq "join: T-4 released exactly once" "1" "$(get_task_field T-4 released_count)"

"$STUB_FLEET" done T-3
assert_eq "join: T-4 released_count remains 1" "1" "$(get_task_field T-4 released_count)"

# 2. Concurrent runs: claim mutual exclusion ensures only 1 set of 4 tasks
: > "$FLEET_LOG"
echo '[]' > "$FLEET_STATE"
rm -rf "$FLEET_LOCK"
set +e
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null 2>&1 &
pid1=$!
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null 2>&1 &
pid2=$!
wait "$pid1"; rc1=$?
wait "$pid2"; rc2=$?
set -e
assert_eq "concurrent: sum of exit codes is 1 (one 0, one 1)" "1" "$((rc1 + rc2))"
assert_eq "concurrent: only 4 tasks created" "4" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$FLEET_STATE")"

# 3. Interrupted mid-creation then rerun: completes 1-to-1
: > "$FLEET_LOG"
echo '[]' > "$FLEET_STATE"
rm -rf "$FLEET_LOCK"
set +e
(cd "$TEST_REPO" && TEST_KILL_ON_PHASE=P3 node "$SCRIPT" --receipt "$RECEIPT") >/dev/null 2>&1
rc_kill=$?
set -e
assert_eq "interrupt: exits 1 on simulated kill" "1" "$rc_kill"
assert_eq "interrupt: 2 tasks created before kill" "2" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$FLEET_STATE")"

rm -rf "$FLEET_LOCK"
(cd "$TEST_REPO" && node "$SCRIPT" --receipt "$RECEIPT") >/dev/null
assert_eq "rerun after interrupt: 4 tasks total" "4" "$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "$FLEET_STATE")"

echo "plan-to-tasks-join.test.sh: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
