#!/usr/bin/env bash
# Tests for scripts/plan-sync-run.sh (fake fleet binary, temp git repo, temp audit file; never touches real fleet).
set -u
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/plan-sync-run.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export PLAN_SYNC_AUDIT="$T/audit.jsonl"
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok - $1"; }
bad() { FAIL=$((FAIL+1)); echo "not ok - $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

R="$T/repo"; mkdir -p "$R/plans"
git -C "$R" init -q; git -C "$R" config user.email t@example.com; git -C "$R" config user.name T
cat > "$R/plans/p.md" <<'EOF'
# Sample
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok 1      | no         | First |
| P2 | S    | P1         | echo ok 2      | no         | Second |
<!-- /phases -->
EOF
git -C "$R" add plans/p.md; git -C "$R" commit -q -m plan

STATE="$T/tasks.json"; echo '[]' > "$STATE"; export TEST_STATE="$STATE" TEST_LOG="$T/fleet.log"
cat > "$T/fleet" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$TEST_LOG"
[ "${1:-}" = tasks ] && cat "$TEST_STATE"
exit 0
STUB
chmod +x "$T/fleet"; export PLAN_TO_TASKS_FLEET_BIN="$T/fleet"

# 1. no tasks: gaps before=2 after=2, exit 1, one audit line
out="$("$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY 2>&1)"; rc=$?
check "uncovered plan: exit 1" '[ "$rc" = 1 ]'
check "uncovered plan: PLAN_GAPS before=2 after=2" 'echo "$out" | grep -q "PLAN_GAPS before=2 after=2"'
check "audit line written" '[ "$(wc -l < "$PLAN_SYNC_AUDIT")" = 1 ] && grep -q "\"before\":\"2\"" "$PLAN_SYNC_AUDIT"'

# 2. tasks cover both phases: gaps 0, exit 0, rerun is idempotent (second audit line, same result)
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify([{task_id:"T1",title:"x",body:"Plan: plans/p.md Phase: P1"},{task_id:"T2",title:"y",body:"Plan: plans/p.md Phase: P2"}]))' "$STATE"
# extractPhaseMarkers reads title||body: put the marker in the title
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify([{task_id:"T1",title:"Plan: plans/p.md Phase: P1"},{task_id:"T2",title:"Plan: plans/p.md Phase: P2"}]))' "$STATE"
out="$("$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY 2>&1)"; rc=$?
check "covered plan: exit 0 and after=0" '[ "$rc" = 0 ] && echo "$out" | grep -q "after=0"'
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY >/dev/null 2>&1
check "rerun appends a second audit line" '[ "$(wc -l < "$PLAN_SYNC_AUDIT")" = 3 ]'

# 3. --sync posts one comment to the parent
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify([{task_id:"T1",parent_task_id:"01M8BRKSWB8GGBFWMGJ4M9PZ6B",title:"Plan: plans/p.md Phase: P1"},{task_id:"T2",parent_task_id:"01M8BRKSWB8GGBFWMGJ4M9PZ6B",title:"Plan: plans/p.md Phase: P2"}]))' "$STATE"
: > "$TEST_LOG"
out="$("$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY --parent 01M8BRKSWB8GGBFWMGJ4M9PZ6B --sync 2>&1)"; rc=$?
check "--sync: exit 0, comment sent to parent" '[ "$rc" = 0 ] && grep -q "^task comment 01M8BRKSWB8GGBFWMGJ4M9PZ6B " "$TEST_LOG" && echo "$out" | grep -q "sync=rc=0"'

# 4. negative controls: refusals, nothing written
n="$(wc -l < "$PLAN_SYNC_AUDIT")"
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict MAYBE >/dev/null 2>&1; check "bad verdict: exit 2" '[ "$?" = 2 ]'
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY --sync >/dev/null 2>&1; check "--sync without --parent: exit 2" '[ "$?" = 2 ]'
echo "dirty" >> "$R/plans/p.md"
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY >/dev/null 2>&1; check "uncommitted plan edit: exit 2" '[ "$?" = 2 ]'
check "refusals wrote no audit line" '[ "$(wc -l < "$PLAN_SYNC_AUDIT")" = "$n" ]'

# 5. --bind / --bind-file: old tasks without a Plan/Phase line bind by task id (negative control: unbound they leave gaps)
git -C "$R" checkout -q -- plans/p.md
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify([{task_id:"01M8BRKSWB8GGBFWMGJ4M9PZ6B",title:"old task, no phase line"},{task_id:"01M8BRKSWB8GGBFWMGJ4M9PZ6C",title:"old two"}]))' "$STATE"
out="$("$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY 2>&1)"
check "unbound old tasks: gaps stay 2" 'echo "$out" | grep -q "before=2 after=2"'
out="$("$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY --bind P1=01M8BRKSWB8GGBFWMGJ4M9PZ6B --bind P2=01M8BRKSWB8GGBFWMGJ4M9PZ6C 2>&1)"; rc=$?
check "--bind: gaps 0, exit 0" '[ "$rc" = 0 ] && echo "$out" | grep -q "before=0 after=0"'
printf 'P1=01M8BRKSWB8GGBFWMGJ4M9PZ6B # first\nP2=01M8BRKSWB8GGBFWMGJ4M9PZ6C\n' > "$T/binds.txt"
out="$("$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY --bind-file "$T/binds.txt" 2>&1)"; rc=$?
check "--bind-file: gaps 0, exit 0" '[ "$rc" = 0 ]'
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY --bind P1=short >/dev/null 2>&1
check "bad bind id: no gaps claimed (exit non-zero)" '[ "$?" != 0 ]'
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY --bind P9=01M8BRKSWB8GGBFWMGJ4M9PZ6B >/dev/null 2>&1
check "bind to unknown phase: exit non-zero" '[ "$?" != 0 ]'

# 6. default audit path is under XDG_STATE_HOME, never /tmp
unset PLAN_SYNC_AUDIT; export XDG_STATE_HOME="$T/state"
"$SCRIPT" --plan plans/p.md --repo "$R" --verdict READY >/dev/null 2>&1
check "default audit under XDG_STATE_HOME" '[ -s "$T/state/autopilot/plan-sync-audit.jsonl" ]'

echo "pass=$PASS fail=$FAIL"
[ "$FAIL" = 0 ]
