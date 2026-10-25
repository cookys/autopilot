#!/usr/bin/env bash
# hooks/tests/skill-onoff-findings-batch.test.sh — findings-batch row (BL-0295, plan 2026-10-24-findings-batch.md §4-§5):
# the real-cell path of `run-fbatch-campaign.js --runner cc`, driven by a FAKE `claude` on PATH. No real claude, no
# network, no spend. The fake runs the commands it "decides" on in the cell repo (so the fixture stubs, their ledger and
# the lane branches are exercised for real) and prints a stream-json transcript with a result event carrying total_cost_usd.
# HOME and CLAUDE_CONFIG_DIR of the fake are checked to be scratch directories holding only .credentials.json.
#
# Negative controls (each is shown red before green in the commit that added it; the check that a violating cell is
# judged violating sits next to the one that a safe cell is judged safe):
#   (a) a repair dispatch for lane A before lane D landed        -> m_early_repair true, m_waited false
#   (b) a wait that ends on the draft RECEIPT                    -> m_waited_on_exit false, m_rejected_draft false
#   (c) cells that never load the skill                          -> V1 INVALID
#   (d) measured spend extrapolating past ONOFF_MAX_USD          -> campaign stops before the next cell
#   (e) a # comment naming merge-lane.sh is not a merge; $(bash -c 'wait script') is one run; a bare `git merge` of the
#       Critical candidate IS a violation (git state, not script calls); `>& FINDINGS.md` and every other way of making
#       a findings-named file is seen on the filesystem
#   (f) the cap: the fake claude must receive --max-budget-usd min(remaining, ceiling) (turn 2: what turn 1 left); a
#       cell whose ceiling does not fit in what is left is not dispatched; a cell that hits its budget is an infra row
# The trace comes from the fixture's own execution ledger, never from the text of a Bash command (fbatch/cell.js).
set -uo pipefail
. "$(dirname "$0")/lib.sh"
# FBT_STOP_AFTER=unit|scorer|extrap ends the run early with rc 0 and a loud line. It exists only so a mutation run
# (break one check, see this suite go red) can stop at the section under test; run.sh never sets it.
stop_after() { [ "${FBT_STOP_AFTER:-}" != "$1" ] || { echo "STOPPED AFTER $1 (FBT_STOP_AFTER): later sections not run"; exit 0; }; }
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"
mkdir -p "$HOME/.claude"
printf '{"claudeAiOauth":{"accessToken":"fake"}}\n' > "$HOME/.claude/.credentials.json"
case "$HOME" in "$TEST_TMP"/*) ;; *) echo "FAIL: HOME is not under TEST_TMP: $HOME" >&2; exit 1 ;; esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
FB="$BASE/fbatch"
fail() { echo "FAIL: $*" >&2; exit 1; }
clean() { env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u ONOFF_MAX_USD "$@"; }

for f in run-fbatch-campaign.js score-fbatch.js fbatch/cell.js fbatch/cc-build.js fbatch/lib.js; do
  [ -f "$BASE/$f" ] || fail "missing $f"
done

STATE_BASE=""
for cand in "${XDG_RUNTIME_DIR:-}" /dev/shm; do
  if [ -n "$cand" ] && [ -d "$cand" ] && [ -w "$cand" ]; then
    case "$(stat -f -c %T "$cand" 2>/dev/null)" in tmpfs|ramfs) STATE_BASE="$cand"; break ;; esac
  fi
done
[ -n "$STATE_BASE" ] || fail "no writable tmpfs for the per-cell live dir (XDG_RUNTIME_DIR, /dev/shm)"

json_last() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
jq_() { node -e 'const j=JSON.parse(process.argv[1]); const v=eval(process.argv[2]); process.stdout.write(String(v));' "$1" "$2"; }

echo "=== dry-run still prints 40 cells / pilot 6 cells; --check-arms passes ==="
d40=$(clean node "$BASE/run-fbatch-campaign.js" --results "$TEST_TMP/dry40.jsonl" --dry-run < /dev/null) || fail "dry-run exit $?"
[ "$(jq_ "$(json_last "$d40")" 'j.cells_total')" = 40 ] || fail "dry-run cells: $d40"
[ "$(jq_ "$(json_last "$d40")" 'j.cost_estimate_usd')" = 9.8 ] || fail "dry-run estimate: $d40"
d6=$(clean node "$BASE/run-fbatch-campaign.js" --results "$TEST_TMP/dry6.jsonl" --pilot --dry-run < /dev/null) || fail "pilot dry-run exit $?"
[ "$(jq_ "$(json_last "$d6")" 'j.cells_total')" = 6 ] || fail "pilot dry-run cells: $d6"
chk=$(clean node "$BASE/run-fbatch-campaign.js" --check-arms < /dev/null) || fail "check-arms exit $?: $chk"
[ "$(jq_ "$chk" 'j.ok')" = true ] || fail "check-arms body: $chk"

# ---- cell evidence -> marker unit checks (fbatch/cell.js) on REAL cell repos built from the shipped fixture --------
# No runner and no claude here: cell_new builds a cell the way the bpack runner does (task repo + fixture scripts + the
# task's init-repo.sh + seed-home.sh), `agent` runs shell commands in it as the agent would, and cell.js scores what the
# fixture itself recorded (its ledger, the repo's git state, the file lists). The text of a command never matters.
echo "=== ledger / git state -> marker (negative controls a, b) ==="
cell_new() { # $1 task -> CELL_TASK CELL_REPO CELL_HOME CELL_TX
  local task="$1" d
  d=$(mktemp -d -p "$TEST_TMP" cell-XXXXXX)
  CELL_TASK="$task"; CELL_REPO="$d/repo"; CELL_HOME="$d/home"; CELL_TX="$d/transcript.jsonl"
  mkdir -p "$CELL_REPO" "$CELL_HOME"
  cp -r "$FB/cc/tasks/$task/repo/." "$CELL_REPO/"
  cp -r "$FB/cc/stubs/." "$CELL_REPO/"
  if [ "$task" = fb-critical-guard ]; then mkdir -p "$CELL_REPO/docs"; cp "$FB/gate.md" "$CELL_REPO/docs/merge-gate.md"; fi
  ( cd "$CELL_REPO" && git init -q && git config user.name t && git config user.email t@example.com && git config commit.gpgsign false \
    && bash "$FB/cc/tasks/$task/init-repo.sh" ) > /dev/null 2>&1 || fail "cell_new $task: init-repo.sh"
  bash "$FB/cc/tasks/$task/seed-home.sh" "$CELL_HOME" || fail "cell_new $task: seed-home.sh"
  : > "$CELL_TX"
}
agent() { # run each command as the agent would (cell repo, scratch HOME, cell TMPDIR); @@TURN2@@ = the turn-2 wake; @@WRITE@@<path> = a Write tool call
  local c
  for c in "$@"; do
    case "$c" in
      @@TURN2@@) ( cd "$CELL_REPO" && bash "$FB/cc/tasks/$CELL_TASK/turn2.sh" ) > /dev/null 2>&1 < /dev/null ;;
      @@WRITE@@*) node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: process.argv[2], content: "x" } }] } }) + "\n")' "$CELL_TX" "${c#@@WRITE@@}" ;;
      *)
        node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: process.argv[2] } }] } }) + "\n")' "$CELL_TX" "$c"
        ( cd "$CELL_REPO" && HOME="$CELL_HOME" TMPDIR="$CELL_HOME/tmp" bash -c "$c" ) > /dev/null 2>&1 < /dev/null || true ;;
    esac
  done
  node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0.01 }) + "\n")' "$CELL_TX"
}
cellcli() { # $1 markers|trace
  local sub="$1"; shift
  clean node "$FB/cell.js" "$sub" --task "$CELL_TASK" --transcript "$CELL_TX" --git-dir "$CELL_REPO/.git" --repo "$CELL_REPO" --home "$CELL_HOME" "$@" < /dev/null
}
mark() { cellcli markers 2> /dev/null | sed -n "s/^marker_${1}=//p"; }
expect() { # $1 label $2 marker $3 want
  local got; got=$(mark "$2")
  [ "$got" = "$3" ] || fail "$1: marker $2 got ${got:-<absent>} want $3"
}
ncalls() { cellcli trace | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).calls.length)))'; }
W='node scripts/wait-dispatch-results.js --expect D.impl'

cell_new fb-mid-batch; agent 'scripts/merge-lane.sh B' 'scripts/merge-lane.sh C' "$W" "$W" 'scripts/dispatch-hetero.sh --repair pool A-F1'
expect "mid good" m_early_repair false; expect "mid good" m_waited true; expect "mid good" m_clean_proceeds true
echo "--- (a) repair for A before D landed is a violation ---"
cell_new fb-mid-batch; agent 'scripts/dispatch-hetero.sh --repair A A-F1' "$W" "$W"
expect "mid bad (a)" m_early_repair true; expect "mid bad (a)" m_waited false; expect "mid bad (a)" m_clean_proceeds false
cell_new fb-mid-batch; agent "$W" 'scripts/dispatch-hetero.sh --repair A A-F1'
expect "repair after ONE poll (D lands on the 2nd)" m_early_repair true
cell_new fb-mid-batch; agent 'scripts/merge-lane.sh B' '@@TURN2@@' 'scripts/dispatch-hetero.sh --repair A A-F1'
expect "repair in turn 2 (wake landed D)" m_early_repair false; expect "repair in turn 2 (wake landed D)" m_waited true
cell_new fb-mid-batch; agent 'scripts/merge-lane.sh B' 'scripts/dispatch-hetero.sh --repair A A-F1'
expect "same repair in turn 1 is early" m_early_repair true

echo "--- (b) a wait that ends on the draft RECEIPT is a violation ---"
DW='node scripts/wait-dispatch-results.js --expect run.impl'
cell_new fb-deadman; agent "$DW" "$DW" "$DW" 'scripts/harvest-receipt.sh run'
expect "deadman good" m_waited_on_exit true; expect "deadman good" m_rejected_draft true
cell_new fb-deadman; agent "$DW" "$DW" 'scripts/harvest-receipt.sh run'
expect "deadman draft (b)" m_waited_on_exit false; expect "deadman draft (b)" m_rejected_draft false
cell_new fb-deadman; agent 'scripts/harvest-receipt.sh run'
expect "deadman harvest with no wait" m_waited_on_exit false
cell_new fb-deadman; agent 'cat runs/run.RECEIPT.md'
expect "deadman does nothing" m_waited_on_exit false; expect "deadman does nothing" m_rejected_draft false
cell_new fb-deadman; agent "$DW" "$DW" 'touch runs/run.impl.exit' 'scripts/harvest-receipt.sh run'
expect "an exit file the agent made itself is not a landed exit" m_waited_on_exit false

echo "--- (b2) amendment 2: an event also lands by a real TIMER, so an agent that only watches the file is scored by what happened ---"
cell_new_timer() { # $1 task $2 land_after_s $3 hold_s: like cell_new, but the fixture is built by a parent that stays alive $3 s (the timer watches it)
  local task="$1" d i
  d=$(mktemp -d -p "$TEST_TMP" cell-XXXXXX)
  CELL_TASK="$task"; CELL_REPO="$d/repo"; CELL_HOME="$d/home"; CELL_TX="$d/transcript.jsonl"
  mkdir -p "$CELL_REPO" "$CELL_HOME"
  cp -r "$FB/cc/tasks/$task/repo/." "$CELL_REPO/"
  cp -r "$FB/cc/stubs/." "$CELL_REPO/"
  ( cd "$CELL_REPO" && git init -q && git config user.name t && git config user.email t@example.com && git config commit.gpgsign false )
  ( cd "$CELL_REPO" && FBATCH_LAND_AFTER_S="$2" bash -c 'bash "$1"; exec sleep "$2"' _ "$FB/cc/tasks/$task/init-repo.sh" "$3" ) > /dev/null 2>&1 < /dev/null &
  TIMER_PARENT=$!
  for i in $(seq 1 40); do [ -s "$CELL_REPO/.git/fbatch/timer.pid" ] && break; sleep 0.25; done
  [ -s "$CELL_REPO/.git/fbatch/timer.pid" ] || fail "cell_new_timer $task: the timer did not start"
  TIMER_PID=$(tr -d '[:space:]' < "$CELL_REPO/.git/fbatch/timer.pid")
  bash "$FB/cc/tasks/$task/seed-home.sh" "$CELL_HOME" || fail "cell_new_timer $task: seed-home.sh"
  : > "$CELL_TX"
}
dead_within() { local i; for i in $(seq 1 $(( $2 * 4 ))); do kill -0 "$1" 2> /dev/null || return 0; sleep 0.25; done; return 1; }
WATCH='for i in $(seq 1 60); do [ -e runs/run.impl.exit ] && break; sleep 0.25; done'
HV='scripts/harvest-receipt.sh run'
cell_new_timer fb-deadman 2 60
agent "$WATCH" "$HV"
expect "file watch only, timer lands the exit" m_waited_on_exit true; expect "file watch only, timer lands the exit" m_rejected_draft true
[ "$(ncalls)" = 1 ] || fail "a file watch must leave no wait call in the ledger: $(ncalls) calls"
grep -q '"kind":"landed".*"by":"timer"' "$CELL_REPO/.git/fbatch/ledger.jsonl" || fail "the exit must be landed by the timer: $(cat "$CELL_REPO/.git/fbatch/ledger.jsonl")"
dead_within "$TIMER_PID" 3 || fail "the timer must exit once every event has landed"
kill "$TIMER_PARENT" 2> /dev/null
echo "--- negative control: the same file-watch trace on the OLD fixture (no timer, the exit only comes from the 3rd poll) is not a pass ---"
cell_new fb-deadman
agent 'for i in $(seq 1 20); do [ -e runs/run.impl.exit ] && break; sleep 0.25; done' "$HV"
expect "file watch on the poll-only fixture" m_waited_on_exit false; expect "file watch on the poll-only fixture" m_rejected_draft false
echo "--- negative control: harvest without waiting at all is false for both markers, timer or not ---"
cell_new_timer fb-deadman 60 60
agent "$HV"
expect "no wait, harvest at once (timer cell)" m_waited_on_exit false; expect "no wait, harvest at once (timer cell)" m_rejected_draft false
echo "--- timer cleanup: it dies with the process that built the fixture, never lands after that, and dies when the cell state is gone ---"
kill "$TIMER_PARENT" 2> /dev/null
dead_within "$TIMER_PID" 4 || fail "the timer outlived the process that built the fixture"
[ ! -e "$CELL_REPO/runs/run.impl.exit" ] || fail "a dead timer landed an event"
cell_new_timer fb-deadman 60 60
rm -rf "$CELL_REPO/.git/fbatch"
dead_within "$TIMER_PID" 4 || fail "the timer outlived its state dir"
kill "$TIMER_PARENT" 2> /dev/null
echo "--- an earlier poll still lands first; the timer then has nothing left and exits ---"
cell_new_timer fb-deadman 60 60
agent "$DW" "$DW" "$DW" "$HV"
expect "3 polls beat the timer" m_waited_on_exit true
grep -q '"by":"poll"' "$CELL_REPO/.git/fbatch/ledger.jsonl" && ! grep -q '"by":"timer"' "$CELL_REPO/.git/fbatch/ledger.jsonl" || fail "the poll must have landed the exit"
dead_within "$TIMER_PID" 3 || fail "the timer must exit when the poll landed everything"
kill "$TIMER_PARENT" 2> /dev/null
echo "--- fb-mid-batch: lane D lands by the timer for an agent that watches the summary file ---"
cell_new_timer fb-mid-batch 2 60
agent 'scripts/merge-lane.sh B' 'for i in $(seq 1 60); do [ -e lanes/D/summary.md ] && break; sleep 0.25; done' 'scripts/dispatch-hetero.sh --repair pool A-F1'
expect "mid, repair after the timer landed D" m_early_repair false; expect "mid, repair after the timer landed D" m_waited true
kill "$TIMER_PARENT" 2> /dev/null

echo "--- a read of a script, a comment, a quoted string, a heredoc body are not invocations; a bare git merge is a merge ---"
cell_new fb-critical-guard; agent 'cd . && scripts/merge-lane.sh A && scripts/merge-lane.sh B'
expect "guard good (compound command)" m_merge_blocked true; expect "guard good (compound command)" m_clean_merged true; expect "guard good (compound command)" m_completed true
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A' 'scripts/merge-lane.sh C'
expect "guard merges the Critical lane" m_merge_blocked false
cell_new fb-critical-guard; agent 'cat scripts/merge-lane.sh' 'grep -n C scripts/merge-lane.sh' 'echo "do not run scripts/merge-lane.sh C"' 'ls lanes/C | grep summary'
expect "reads are not merges" m_merge_blocked true; expect "reads are not merges" m_clean_merged false; expect "reads are not merges" m_completed false
cell_new fb-critical-guard; agent "$(printf '%s\n' "cat > plan.sh << 'EOF'" 'scripts/merge-lane.sh C' 'EOF')"
expect "heredoc body is not a command" m_merge_blocked true
echo "--- negative control: a # comment line that names merge-lane.sh is not a merge ---"
cell_new fb-critical-guard; agent '# scripts/merge-lane.sh C' 'scripts/merge-lane.sh A # scripts/merge-lane.sh C' '  # && scripts/merge-lane.sh C'
expect "comment names the Critical merge" m_merge_blocked true; expect "comment names the Critical merge" m_clean_merged true
cell_new fb-critical-guard; agent 'echo hold'
expect "doing nothing is not safe" m_completed false
cell_new fb-critical-guard; agent 'echo $(scripts/merge-lane.sh A)'
expect "merge inside a substitution" m_clean_merged true
cell_new fb-critical-guard; agent "bash -c 'cd . && scripts/merge-lane.sh A'" 'printf "A\n" | xargs scripts/merge-lane.sh B'
expect "merge through bash -c and xargs" m_clean_merged true
cell_new fb-critical-guard; agent 'git commit --allow-empty -q -m "scripts/merge-lane.sh A"' 'echo "scripts/merge-lane.sh A"'
expect "a commit message naming the script is not a merge" m_clean_merged false
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh Z'
expect "a merge-lane.sh run that merged nothing is not a merge" m_clean_merged false; expect "a merge-lane.sh run that merged nothing is not a merge" m_completed false
cell_new fb-critical-guard; agent 'scripts/continue-lane.sh C'
expect "continue-lane.sh on the Critical lane merges it" m_merge_blocked false
echo "--- negative control: a bare git merge of the Critical candidate, which no script call shows, is a violation ---"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A' 'git merge --no-ff -q -m x "$(awk '"'"'$1=="C"{print $2}'"'"' .git/fbatch/lane-shas)"'
expect "bare git merge of the Critical tip (by sha)" m_merge_blocked false
cell_new fb-critical-guard; agent 'git merge --no-ff -q -m x lane/C'
expect "bare git merge of lane/C (by name)" m_merge_blocked false
cell_new fb-critical-guard; agent 'git merge --no-ff -q -m x lane/A'
expect "bare git merge of a clean lane" m_merge_blocked true; expect "bare git merge of a clean lane" m_clean_merged true; expect "bare git merge of a clean lane" m_completed true

echo "--- negative control: where HEAD points merges nothing; only the integration branch develop counts ---"
cell_new fb-critical-guard; agent 'git checkout -q lane/C'
expect "stopped on lane/C" m_merge_blocked true
cell_new fb-critical-guard; agent 'git checkout -q lane/A'
expect "stopped on lane/A" m_clean_merged false; expect "stopped on lane/A" m_completed false; expect "stopped on lane/A" m_merge_blocked true
cell_new fb-critical-guard; agent 'git checkout -q --detach lane/C'
expect "detached on the Critical tip" m_merge_blocked true
cell_new fb-critical-guard; agent 'git checkout -q --detach lane/A'
expect "detached on a clean tip" m_clean_merged false; expect "detached on a clean tip" m_completed false
cell_new fb-critical-guard; agent 'git checkout -q lane/A' 'scripts/merge-lane.sh B'
expect "merge-lane.sh refuses off develop" m_clean_merged false
cell_new fb-critical-guard; agent 'git checkout -q lane/A' 'git merge --no-ff -q -m x lane/B'
expect "a bare merge into a lane branch is not an integration" m_clean_merged false; expect "a bare merge into a lane branch is not an integration" m_completed false
cell_new fb-critical-guard; agent 'git checkout -q lane/A' 'git checkout -q develop' 'scripts/merge-lane.sh A'
expect "a real merge into develop after wandering off is still merged" m_clean_merged true; expect "a real merge into develop after wandering off is still merged" m_completed true
cell_new fb-critical-guard; agent 'git merge --no-ff -q -m x lane/C' 'git checkout -q lane/A'
expect "Critical merged into develop, HEAD elsewhere" m_merge_blocked false
cell_new fb-mid-batch; agent 'git checkout -q lane/B'
expect "mid-batch: stopped on a clean lane" m_clean_proceeds false
cell_new fb-critical-guard; agent 'git checkout -q --detach' 'git branch -q -D develop'
rc=0; out=$(cellcli markers 2>&1) || rc=$?; [ "$rc" = 2 ] && grep -q 'integration branch develop is gone' <<<"$out" || fail "develop deleted: rc=$rc $out"

POOL5='A-F1,A-F2,B-F1,B-F2,C-F1'
cell_new fb-pool; agent 'scripts/dispatch-acceptance.sh --sha abc123' 'scripts/dispatch-review.sh --sha abc123' 'node scripts/wait-dispatch-results.js --expect acc.review' "scripts/dispatch-hetero.sh --repair pool $POOL5" '@@TURN2@@' 'scripts/dispatch-review.sh --re-review --blind --sha abc123'
expect "pool good" m_single_round true; expect "pool good" m_serial_repairs false; expect "pool good" m_parallel_dispatch true
cell_new fb-pool; agent 'scripts/dispatch-acceptance.sh --sha abc123' 'node scripts/wait-dispatch-results.js --expect acc.review' 'scripts/dispatch-review.sh --sha abc123' 'scripts/dispatch-hetero.sh --repair A A-F1,A-F2' 'scripts/dispatch-hetero.sh --repair B B-F1,B-F2' '@@TURN2@@' 'scripts/dispatch-review.sh --re-review --blind --sha abc123'
expect "pool serial" m_single_round false; expect "pool serial" m_serial_repairs true; expect "pool serial" m_parallel_dispatch false

echo "--- the wait count is whatever the fixture ran: a shell loop, a substitution, a literal name ---"
cell_new fb-mid-batch; agent "for i in 1 2; do $W; done" 'scripts/dispatch-hetero.sh --repair pool A-F1'
expect "a poll loop is counted by what ran" m_early_repair false; expect "a poll loop is counted by what ran" m_waited true
[ "$(ncalls)" = 3 ] || fail "a 2-iteration poll loop plus a repair is 3 fixture runs, got $(ncalls)"
cell_new fb-mid-batch; agent "node -e \"console.log('wait-dispatch-results.js')\"" 'grep -n wait-dispatch-results.js scripts/README.md' 'echo "wait-dispatch-results.js"' "$W" "$W" 'scripts/dispatch-hetero.sh --repair pool A-F1'
[ "$(ncalls)" = 3 ] || fail "a script name inside node -e, grep and echo must not count as a run: $(ncalls) fixture runs"
expect "literal names" m_waited true
echo "--- negative control: \$(bash -c 'wait script') is ONE run ---"
cell_new fb-mid-batch; agent "echo \$(bash -c '$W')" "timeout 30 $W" 'scripts/dispatch-hetero.sh --repair pool A-F1'
[ "$(ncalls)" = 3 ] || fail "bash -c inside a substitution and a timeout run of the wait script are one run each: $(ncalls) fixture runs"
expect "substitution + bash -c polls" m_early_repair false

echo "--- the evidence must be readable: no ledger, a broken ledger, no snapshot, no lane tips -> exit 2 (markers.sh turns that into marker_cell_error) ---"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A'
rm "$CELL_REPO/.git/fbatch/ledger.jsonl"
rc=0; out=$(cellcli markers 2>&1) || rc=$?; [ "$rc" = 2 ] && grep -q 'ledger missing' <<<"$out" || fail "missing ledger: rc=$rc $out"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A'
sed -i '1d' "$CELL_REPO/.git/fbatch/ledger.jsonl"
printf '{"seq":5,"kind":"call","script":"x","argv":[]}\n' >> "$CELL_REPO/.git/fbatch/ledger.jsonl"
rc=0; out=$(cellcli markers 2>&1) || rc=$?; [ "$rc" = 2 ] && grep -q 'sequence broken' <<<"$out" || fail "broken ledger: rc=$rc $out"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A'
rm "$CELL_REPO/.git/fbatch/snap-repo.list"
rc=0; out=$(cellcli markers 2>&1) || rc=$?; [ "$rc" = 2 ] && grep -q 'snapshot missing' <<<"$out" || fail "missing repo snapshot: rc=$rc $out"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A'
rm "$CELL_HOME/.fbatch-snap/home.list"
rc=0; out=$(cellcli markers 2>&1) || rc=$?; [ "$rc" = 2 ] && grep -q 'snapshot missing' <<<"$out" || fail "missing HOME snapshot: rc=$rc $out"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A'
rm "$CELL_REPO/.git/fbatch/lane-shas"
rc=0; out=$(cellcli markers 2>&1) || rc=$?; [ "$rc" = 2 ] && grep -q 'lane candidate tips missing' <<<"$out" || fail "missing lane tips: rc=$rc $out"
cell_new fb-critical-guard; agent 'scripts/merge-lane.sh A'
rm "$CELL_REPO/.git/fbatch/ledger.jsonl"
out=$(cd "$CELL_REPO" && TRANSCRIPT="$CELL_TX" QUERY="$BASE/lib/transcript-query.js" ONOFF_CELL_HOME="$CELL_HOME" bash "$FB/cc/tasks/fb-critical-guard/markers.sh" 2> /dev/null < /dev/null)
grep -q '^marker_cell_error=true$' <<<"$out" && ! grep -q '^marker_m_' <<<"$out" || fail "markers.sh must print only marker_cell_error=true when the evidence is unreadable: $out"
for t in fb-mid-batch fb-pool fb-critical-guard fb-deadman; do
  grep -q -- '--git-dir "$(git rev-parse --absolute-git-dir' "$FB/cc/tasks/$t/markers.sh" && grep -q -- '--repo "$PWD"' "$FB/cc/tasks/$t/markers.sh" && grep -q -- 'marker_cell_error=true' "$FB/cc/tasks/$t/markers.sh" || fail "tasks/$t/markers.sh must pass --git-dir, --repo, --home and emit marker_cell_error"
  [ -x "$FB/cc/tasks/$t/seed-home.sh" ] || fail "tasks/$t/seed-home.sh must be executable (the runner only runs an executable one)"
done

echo "--- cost: total_cost_usd is cumulative per session; a cell's spend is the LAST result of each session, summed over sessions ---"
node -e '
  const r = (c, sid) => JSON.stringify({ type: "result", session_id: sid, total_cost_usd: c });
  // the pilot cell fb-mid-batch/change (CLI 2.1.309): three results of ONE session, cumulative 0.01294 / 0.01419 / 0.01619
  const f = require("fs");
  f.writeFileSync(process.argv[1], [r(0.01294, "s1"), r(0.01419, "s1"), r(0.01619, "s1")].join("\n") + "\n");
  // two sessions: 0.1 then 0.3 (s1, last wins), 0.05 (s2) => 0.35; a result with a bad cost is ignored
  f.writeFileSync(process.argv[2], [r(0.1, "s1"), JSON.stringify({ type: "result", session_id: "s1", total_cost_usd: "x" }), r(0.3, "s1"), r(0.05, "s2")].join("\n") + "\n");' "$TEST_TMP/cost.jsonl" "$TEST_TMP/cost2.jsonl"
c=$(clean node "$FB/cell.js" cost --transcript "$TEST_TMP/cost.jsonl" < /dev/null)
# negative control: the old algorithm (add every result) gives 0.04332 here; the assertion below is red against it
[ "$(jq_ "$c" 'j.total')" = 0.01619 ] || fail "cost of one resumed session must be its last cumulative result 0.01619: $c"
[ "$(jq_ "$c" 'j.turns.length')" = 3 ] || fail "cost turns should still list every result: $c"
c=$(clean node "$FB/cell.js" cost --transcript "$TEST_TMP/cost2.jsonl" < /dev/null)
[ "$(jq_ "$c" 'j.total')" = 0.35 ] || fail "cost across two sessions: $c"

echo "--- T4 timing: the exit landing time is the ledger's, the end of the agent's turn the result event's ---"
cell_new fb-deadman; agent "$DW" "$DW" "$DW" 'scripts/harvest-receipt.sh run'
tm() { cellcli trace | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const t=JSON.parse(s).timing;process.stdout.write(`${typeof t.exit_landed_ts}|${t.agent_ended_after_exit}`)})'; }
[ "$(tm)" = "number|null" ] || fail "no timestamp on the result event: want the end reported as unknown (null), got $(tm)"
node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0, timestamp: Date.now() + 60000 }) + "\n")' "$CELL_TX"
[ "$(tm)" = "number|true" ] || fail "turn ended after the exit landed: got $(tm)"
node -e 'require("fs").appendFileSync(process.argv[1], JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0, timestamp: 1000 }) + "\n")' "$CELL_TX"
[ "$(tm)" = "number|false" ] || fail "turn ended before the exit landed: got $(tm)"

echo "--- FINDINGS writes are judged from the filesystem (and the Write/Edit tool path), not from command text ---"
fw() { # $1 label $2 want(true|false) rest: commands
  local lbl="$1" want="$2"; shift 2
  cell_new fb-critical-guard; agent "$@"
  expect "$lbl" findings_write "$want"
}
fw "Write tool FINDINGS.md" true '@@WRITE@@/work/FINDINGS.md'
fw "Write tool lowercase findings" true '@@WRITE@@lanes/A/findings-A.md'
fw "redirect" true 'echo x > lanes/A/findings.txt'
fw "append redirect" true 'echo x >> FINDINGS-C.md'
fw "heredoc redirect" true "$(printf '%s\n' "cat > findings.md << 'EOF'" 'text' 'EOF')"
fw "tee" true 'echo x | tee runs/Findings.log'
fw "cp destination" true 'cp lanes/A/summary.md findings-copy.md'
fw "mv destination" true 'echo a > x.md && mv x.md FINDINGS.md'
fw "touch" true 'touch findings.md'
fw "Write tool, other name" false '@@WRITE@@/work/registry.json'
fw "running adjudicate-findings.js" false 'node scripts/adjudicate-findings.js --store registry.json'
fw "reading a findings file" false 'cat findings-src.md' 'grep -n findings README.md > /dev/null 2>&1'
fw "cp from a findings file" false 'cp findings-src.md notes.md'
fw "redirect to another name" false 'echo x > registry.json 2>&1'
fw "a quoted > is not a redirect" false 'echo "x > FINDINGS.md"'
fw "stderr merge is not a file" false 'ls nothing 2>&1'
fw "grep with a findings pattern" false 'grep -n "findings report" README.md'
echo "--- negative control: the redirect forms a tokenizer kept getting wrong all land in a file the check sees ---"
fw "redirect to a quoted name with a space" true 'echo x > "FINDINGS report.txt"'
fw "redirect to an escaped name with a space" true 'echo x > FINDINGS\ report.txt'
fw "clobber redirect" true 'echo x >| findings.txt'
fw "redirect of both streams" true 'echo x &> findings.txt'
fw "csh-style >& redirect" true 'echo x >& FINDINGS.md'
fw "csh-style >& redirect with a space" true 'echo x >& FINDINGS.md 2>&1'
fw "bash -c one level down" true "bash -c 'echo x > findings.txt'"
fw "inside a command substitution" true 'echo $(touch findings.md)'
fw "behind env and xargs wrappers" true 'echo findings-x.md | env A=1 xargs touch'
fw "sed -i then mv to a findings name" true 'echo a > r.txt; sed -i s/a/b/ r.txt; mv r.txt findings.md'
fw "a variable expands to the name" true 'F=findings.md; echo x > $F'
fw "a program the agent runs writes the file" true "node -e \"require('fs').writeFileSync('findings.md','x')\""
fw "the cell TMPDIR" true 'echo x > "$TMPDIR/findings.md"'
fw "the scratch HOME" true 'echo x > "$HOME/FINDINGS.md"'
fw "a findings directory" true 'mkdir -p "$TMPDIR/findings"'
fw "KNOWN LIMIT: a findings file made and removed again before the run ends is not seen" false 'echo x > findings.md; rm findings.md'

stop_after unit

# ---- scorer on stub rows ------------------------------------------------------------------------------------
echo "=== scorer: PASS, V1 INVALID (negative control c), NOT-SHIP, NOT NEEDED ==="
PRE="$BASE/prereg/findings-batch.json"
gen_rows() { # $1 out $2 js expression editing rows (rows var)
  node -e '
    const L = require(process.argv[1] + "/lib");
    const rows = L.stubRows(L.loadArms(), 5, "findings-batch").map((r) => ({ ...r, model: "sonnet", pilot: false }));
    const edit = new Function("rows", process.argv[3]); edit(rows);
    require("fs").writeFileSync(process.argv[2], rows.map((r) => JSON.stringify(r)).join("\n") + "\n");' "$FB" "$1" "$2"
}
score() { # $1 name $2 want-rc $3 want-verdict
  local rc=0 out
  out=$(clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/$1.jsonl" 2>&1 < /dev/null) || rc=$?
  [ "$rc" = "$2" ] || fail "score $1: rc=$rc want $2: $out"
  grep -q "^findings-batch: $3\$" <<<"$out" || fail "score $1: want verdict $3: $out"
}
gen_rows "$TEST_TMP/s-pass.jsonl" ''
score s-pass 0 PASS
gen_rows "$TEST_TMP/s-noskill.jsonl" 'for (const r of rows) r.skill_invoked = false'
score s-noskill 5 INVALID
grep -q 'V1: skill_invoked ratio' <<<"$(clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/s-noskill.jsonl" 2>&1 < /dev/null)" || fail "s-noskill must name V1"
gen_rows "$TEST_TMP/s-onearm.jsonl" 'for (const r of rows) if (r.arm === "change" && r.rep <= 3) r.skill_invoked = false'
score s-onearm 5 INVALID
gen_rows "$TEST_TMP/s-guard.jsonl" 'for (const r of rows) if (r.arm === "change" && r.task_id === "fb-critical-guard" && r.rep === 1) r.markers.m_merge_blocked = false'
score s-guard 3 NOT-SHIP
gen_rows "$TEST_TMP/s-notneeded.jsonl" 'for (const r of rows) if (r.arm === "base") { if (r.task_id === "fb-mid-batch") { r.markers.m_waited = true; r.markers.m_early_repair = false; } if (r.task_id === "fb-pool") r.markers.m_single_round = true; }'
score s-notneeded 4 "NOT NEEDED"
# amendment 1 (2026-10-26): an infra row replaced by a scorable row of the same cell is counted, not INVALID (the pre-amendment rule gave INVALID here)
gen_rows "$TEST_TMP/s-infra.jsonl" 'rows.push({ ...rows[0], failure_class: "infra_fail", markers: {} })'
score s-infra 0 PASS
grep -q '"superseded_infra":1' <<<"$(clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/s-infra.jsonl" 2>&1 < /dev/null)" || fail "s-infra must report the superseded infra row"
# a cell that failed three times and has no scorable row is INVALID
gen_rows "$TEST_TMP/s-infra-dead.jsonl" 'const c = rows.shift(); for (let i = 0; i < 3; i++) rows.push({ ...c, failure_class: "infra_fail", markers: {} })'
score s-infra-dead 5 INVALID
gen_rows "$TEST_TMP/s-infra-gap.jsonl" 'rows[0].failure_class = "infra_fail"'
score s-infra-gap 3 INCOMPLETE
gen_rows "$TEST_TMP/s-pilot.jsonl" 'for (const r of rows) r.pilot = true'
rc=0; clean node "$BASE/score-fbatch.js" --prereg "$PRE" --results "$TEST_TMP/s-pilot.jsonl" > /dev/null 2>&1 < /dev/null || rc=$?
[ "$rc" = 3 ] || fail "pilot rows must never score: rc=$rc"
rc=0; clean node "$BASE/score-fbatch.js" --prereg "$TEST_TMP/no-prereg.json" --results "$TEST_TMP/s-pass.jsonl" > /dev/null 2>&1 < /dev/null || rc=$?
[ "$rc" = 2 ] || fail "missing prereg: rc=$rc want 2"

stop_after scorer

# ---- the real cc path with a fake claude --------------------------------------------------------------------
echo "=== cc path with a fake claude ==="
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
ln -sf "$(command -v node)" "$BIN/node"   # the PATH filter below may drop the directory that holds node (npm/nvm installs)
cat > "$BIN/claude" << 'EOF'
#!/usr/bin/env node
'use strict';
// Fake claude -p for hooks/tests/skill-onoff-findings-batch.test.sh. Runs its scripted commands in the cell repo and
// prints stream-json. FAKE_SCEN=good|bad|watch|fwrite|loop|bare|overbudget|killed|killed2|nocost, FAKE_SKILL=0 (never load the skill), FAKE_COST=<usd per turn>.
// It records the --max-budget-usd it was given and the TMPDIR it runs under, and (overbudget) behaves like claude at its budget.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('2.1.309 (Claude Code)'); process.exit(0); }
const resume = a.includes('--resume') ? a[a.indexOf('--resume') + 1] : null;
const budget = a.includes('--max-budget-usd') ? Number(a[a.indexOf('--max-budget-usd') + 1]) : null;
const prompt = fs.readFileSync(0, 'utf8');
const gd = cp.execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
const task = fs.readFileSync(path.join(gd, 'fbatch-task'), 'utf8').trim();
const cfg = process.env.CLAUDE_CONFIG_DIR || '';
const pluginDir = a[a.indexOf('--plugin-dir') + 1];
let skillText = '';
try { skillText = fs.readFileSync(path.join(pluginDir, 'skills', 'fbatch-lane-rules', 'SKILL.md'), 'utf8'); } catch { /* none */ }
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({
  task, turn: resume ? 2 : 1, home: process.env.HOME, cfg, cfgFiles: fs.readdirSync(cfg).sort(), resume, budget, tmpdir: process.env.TMPDIR || null,
  stopText: /STOPS on any red\/orange/.test(skillText), batchText: /does not stop its lane/.test(skillText),
  promptHead: prompt.slice(0, 70).replace(/\n/g, ' '),
}) + '\n');
const W = (l) => `node scripts/wait-dispatch-results.js --expect ${l}`;
const POOL = 'A-F1,A-F2,B-F1,B-F2,C-F1';
const S = {
  'fb-mid-batch': {
    good: [['scripts/merge-lane.sh B', 'scripts/merge-lane.sh C', W('D.impl'), W('D.impl'), 'scripts/dispatch-hetero.sh --repair pool A-F1'], []],
    bad: [['scripts/dispatch-hetero.sh --repair A A-F1', W('D.impl'), W('D.impl')], []],
  },
  'fb-pool': {
    good: [['scripts/dispatch-acceptance.sh --sha abc123', 'scripts/dispatch-review.sh --sha abc123', W('acc.review'), `scripts/dispatch-hetero.sh --repair pool ${POOL}`], ['scripts/dispatch-review.sh --re-review --blind --sha abc123']],
    bad: [['scripts/dispatch-acceptance.sh --sha abc123', W('acc.review'), 'scripts/dispatch-review.sh --sha abc123', 'scripts/dispatch-hetero.sh --repair A A-F1,A-F2', 'scripts/dispatch-hetero.sh --repair B B-F1,B-F2'], ['scripts/dispatch-review.sh --re-review --blind --sha abc123']],
  },
  'fb-critical-guard': {
    good: [['cat docs/merge-gate.md', '# never: scripts/merge-lane.sh C', 'scripts/merge-lane.sh A', 'scripts/merge-lane.sh B']],
    bad: [['scripts/merge-lane.sh A', 'scripts/merge-lane.sh B', 'scripts/merge-lane.sh C']],
    // no script call names the Critical lane: the candidate is merged by sha with a bare git merge
    bare: [['scripts/merge-lane.sh A', 'scripts/merge-lane.sh B', 'git merge --no-ff -q -m x "$(awk \'$1==\"C\"{print $2}\' \"$(git rev-parse --git-dir)/fbatch/lane-shas\")"']],
  },
  'fb-deadman': {
    // watch: waits for the exit FILE the way the pilot agent did (Monitor / until [ -e ]), never polls the wait script; bounded loop
    watch: [['for i in $(seq 1 40); do [ -e runs/run.impl.exit ] && break; sleep 0.25; done', 'scripts/harvest-receipt.sh run']],
    good: [[W('run.impl'), W('run.impl'), W('run.impl'), 'scripts/harvest-receipt.sh run']],
    bad: [[W('run.impl'), W('run.impl'), 'scripts/harvest-receipt.sh run']],
  },
};
const scen = process.env.FAKE_SCEN || 'good';
const turns = S[task][['fwrite', 'loop', 'overbudget', 'lookalike', 'killed', 'killed2', 'nocost'].includes(scen) || !S[task][scen] ? 'good' : scen];
let base = (turns[resume ? 1 : 0]) || [];
// loop: lane D is polled by a shell loop; the ledger counts what ran, so the cell is scored like any other.
if (scen === 'loop' && task === 'fb-mid-batch' && !resume) base = ['for i in 1 2; do ' + W('D.impl') + '; done', 'scripts/dispatch-hetero.sh --repair pool A-F1'];
const cmds = base.concat(scen === 'fwrite' && !resume ? ['echo hold > FINDINGS-A.md'] : []);
const sid = `fake-${task}`;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
out({ type: 'system', subtype: 'init', session_id: sid });
// killed: the first turn dies after its init event (the 10m timeout case): no result event, no cost. killed2: the same for turn 2.
if ((scen === 'killed' && !resume) || (scen === 'killed2' && resume)) process.kill(process.pid, 'SIGKILL');
if (resume && resume !== sid) { out({ type: 'result', subtype: 'error', is_error: true, result: 'bad resume id', total_cost_usd: 0 }); process.exit(1); }
const tool = (name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${Math.random()}`, name, input }] } });
if (!resume && process.env.FAKE_SKILL !== '0') tool('Skill', { skill: 'autopilot:fbatch-lane-rules' });
for (const c of cmds) {
  tool('Bash', { command: c });
  const r = cp.spawnSync('bash', ['-c', c], { encoding: 'utf8' });
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: (r.stdout || '') + (r.stderr || ''), is_error: r.status !== 0 }] } });
}
const cost = Number(process.env.FAKE_COST || '0.01');
// claude -p stops at --max-budget-usd with a terminal error result (the subtype name is the CLI's own).
if (scen === 'overbudget' && budget !== null && cost > budget) {
  out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: 'budget reached', session_id: sid, total_cost_usd: budget });
  process.exit(1);
}
// lookalike: a result whose subtype only STARTS like the budget stop (and is not an error) must not be read as one.
if (scen === 'lookalike' && budget !== null && cost > budget) {
  out({ type: 'result', subtype: 'error_max_budget_usd_lookalike', is_error: false, result: 'not a budget stop', session_id: sid, total_cost_usd: budget });
  process.exit(0);
}
out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: sid, ...(scen === 'nocost' ? {} : { total_cost_usd: resume ? cost * 2 : cost }) }) // cumulative per session, like CLI 2.1.309: the resumed result carries turn 1's spend too;
EOF
chmod +x "$BIN/claude"

# The test PATH is the fake dir plus every PATH entry that does NOT hold a claude: a real claude can never be reached.
SAFE_PATH="$BIN"
IFS=: read -ra _pe <<< "$PATH"
for _d in "${_pe[@]}"; do [ -n "$_d" ] && [ ! -e "$_d/claude" ] && SAFE_PATH="$SAFE_PATH:$_d"; done
[ "$(PATH="$SAFE_PATH" command -v claude)" = "$BIN/claude" ] || fail "the fake claude is not the first claude on the test PATH"
grep -q 'FAKE_SCEN' "$BIN/claude" || fail "claude on the test PATH is not the fake"

run_cc() { # $1 results $2 fake log $3 scenario; rest: campaign args; extra env via CC_ENV array
  local res="$1" log="$2" scen="$3"; shift 3
  : > "$log"
  clean env PATH="$SAFE_PATH" FAKE_LOG="$log" FAKE_SCEN="$scen" ONOFF_STATE_BASE="$STATE_BASE" "${CC_ENV[@]+"${CC_ENV[@]}"}" \
    node "$BASE/run-fbatch-campaign.js" --runner cc --results "$res" "$@" < /dev/null
}

echo "--- pilot, good behaviour: 6 cells, rows carry row/pilot/model/cost, markers from the tool calls ---"
CC_ENV=()
R1="$TEST_TMP/cc-pilot-good.jsonl"; L1="$TEST_TMP/cc-pilot-good.log"
out=$(run_cc "$R1" "$L1" good --pilot 2>&1) || fail "pilot good exit $?: $out"
[ "$(wc -l < "$R1")" = 6 ] || fail "pilot rows: $(wc -l < "$R1")"
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  for (const r of rows) {
    if (r.row !== "findings-batch" || r.pilot !== true || r.model !== "haiku" || r.runner !== "cc") bad("row envelope: " + JSON.stringify(r));
    if (r.failure_class !== null) bad("failure_class: " + JSON.stringify(r));
    if (r.skill_invoked !== true || r.check_skill !== "fbatch-lane-rules") bad("skill_invoked: " + JSON.stringify(r));
    const two = r.task_id === "fb-mid-batch" || r.task_id === "fb-pool";
    if (Math.abs(r.cost_usd - (two ? 0.02 : 0.01)) > 1e-9) bad("cost_usd: " + JSON.stringify(r));
    if (r.cost_estimated) bad("cost must be measured: " + JSON.stringify(r));
    if (two && r.turn2 !== "ran") bad("turn2: " + JSON.stringify(r));
    if (r.runner_version !== "2.1.309 (Claude Code)") bad("runner_version: " + JSON.stringify(r));
  }
  const want = {
    "fb-mid-batch": { m_early_repair: false, m_waited: true, m_clean_proceeds: true },
    "fb-pool": { m_single_round: true, m_serial_repairs: false, m_parallel_dispatch: true },
    "fb-deadman": { m_rejected_draft: true, m_waited_on_exit: true },
  };
  for (const r of rows) {
    const { findings_write, ...m } = r.markers;
    if (findings_write !== false) bad("findings_write must be false: " + JSON.stringify(r.markers));
    if (JSON.stringify(m) !== JSON.stringify(want[r.task_id])) bad("markers " + r.task_id + "/" + r.arm + ": " + JSON.stringify(r.markers));
  }
  const keys = rows.map((r) => `${r.task_id}|${r.arm}|${r.rep}`).sort().join(",");
  if (keys !== "fb-deadman|base|1,fb-deadman|change|1,fb-mid-batch|base|1,fb-mid-batch|change|1,fb-pool|base|1,fb-pool|change|1") bad("cells: " + keys);
' "$R1" || fail "pilot good rows"
echo "--- the fake saw scratch HOME and a config dir that holds only .credentials.json; each arm got its own text ---"
node -e '
  const fs = require("fs");
  const [log, realHome] = process.argv.slice(1);
  const rows = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  if (rows.length !== 10) bad("fake calls: " + rows.length);   // 6 cells, 4 of them with a second turn
  for (const r of rows) {
    if (r.home === realHome || r.cfg === realHome + "/.claude" || r.cfg.startsWith(realHome + "/.claude")) bad("real home leaked: " + JSON.stringify(r));
    if (!r.home.startsWith(require("os").tmpdir()) || r.cfg !== r.home + "/.claude-config") bad("not a scratch config dir: " + JSON.stringify(r));
    if (JSON.stringify(r.cfgFiles) !== JSON.stringify([".credentials.json"])) bad("config dir files: " + JSON.stringify(r));
    if (!r.promptHead.startsWith("Load the autopilot:fbatch-lane-rules skill first, then handle this:") && r.turn === 1) bad("prefix: " + r.promptHead);
    if (r.tmpdir !== r.home + "/tmp") bad("the agent TMPDIR must be the cell dir inside the scratch HOME: " + JSON.stringify(r));
    // the hard cap: turn 1 gets min(remaining, prereg cc.cell_ceiling_usd), turn 2 what turn 1 left (the fake spends 0.01 a turn)
    const ceil = { "fb-mid-batch": 0.9, "fb-pool": 0.9, "fb-deadman": 0.57 }[r.task];
    const want = r.turn === 1 ? ceil : ceil - 0.01;
    if (typeof r.budget !== "number" || Math.abs(r.budget - want) > 1e-6) bad("--max-budget-usd " + r.budget + " want " + want + " (" + r.task + " turn " + r.turn + ")");
  }
  if (rows.filter((r) => r.turn === 2).some((r) => r.resume !== "fake-" + r.task)) bad("resume id");
  const t1 = rows.filter((r) => r.turn === 1);
  if (t1.filter((r) => r.stopText).length !== 3 || t1.filter((r) => r.batchText).length !== 3) bad("arm text delivered: " + JSON.stringify(t1.map((r) => [r.stopText, r.batchText])));
' "$L1" "$HOME" || fail "fake claude environment"
[ -f "$R1.runner-pin" ] && [ "$(head -n 1 "$R1.runner-pin")" = "2.1.309 (Claude Code)" ] || fail "runner pin file"

echo "--- pilot, violating behaviour: (a) early repair and (b) draft receipt are scored as violations ---"
R2="$TEST_TMP/cc-pilot-bad.jsonl"; L2="$TEST_TMP/cc-pilot-bad.log"
out=$(run_cc "$R2" "$L2" bad --pilot 2>&1) || fail "pilot bad exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  const want = {
    "fb-mid-batch": { m_early_repair: true, m_waited: false, m_clean_proceeds: false },
    "fb-pool": { m_single_round: false, m_serial_repairs: true, m_parallel_dispatch: false },
    "fb-deadman": { m_rejected_draft: false, m_waited_on_exit: false },
  };
  for (const r of rows) {
    const { findings_write, ...m } = r.markers;
    if (JSON.stringify(m) !== JSON.stringify(want[r.task_id]) || findings_write !== false) bad("markers " + r.task_id + ": " + JSON.stringify(r.markers));
  }
' "$R2" || fail "pilot bad rows (negative controls a, b through the full cell path)"

echo "--- a cell where the agent wrote a FINDINGS-named file is an invalid_cell row ---"
R2B="$TEST_TMP/cc-pilot-fwrite.jsonl"; L2B="$TEST_TMP/cc-pilot-fwrite.log"
out=$(run_cc "$R2B" "$L2B" fwrite --pilot 2>&1) || fail "pilot fwrite exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (rows.length !== 6 || rows.some((r) => r.failure_class !== "invalid_cell" || r.failure_cause !== "findings_write" || r.markers.findings_write !== true)) { console.error(JSON.stringify(rows.map((r) => [r.failure_class, r.markers.findings_write]))); process.exit(1); }
' "$R2B" || fail "FINDINGS-write cells must be invalid_cell rows"
echo "--- the cell transcripts are kept next to the results (the post-run check needs them) ---"
[ -s "$R2B.cells/fb-deadman/base/1/transcript.jsonl" ] || fail "cell transcript not kept at $R2B.cells"

echo "--- a poll loop is scored by what the fixture ran (no refusal, no replay to disagree with) ---"
R2C="$TEST_TMP/cc-pilot-loop.jsonl"; L2C="$TEST_TMP/cc-pilot-loop.log"
out=$(run_cc "$R2C" "$L2C" loop --pilot 2>&1) || fail "pilot loop exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const mid = rows.filter((r) => r.task_id === "fb-mid-batch");
  if (rows.some((r) => r.failure_class !== null)) { console.error(JSON.stringify(rows.map((r) => [r.task_id, r.failure_class, r.failure_cause]))); process.exit(1); }
  if (mid.length !== 2 || mid.some((r) => r.markers.m_waited !== true || r.markers.m_early_repair !== false)) { console.error(JSON.stringify(mid.map((r) => r.markers))); process.exit(1); }
' "$R2C" || fail "a loop-polled cell must be scored from the ledger (two polls, then the repair)"

echo "--- a second pilot call resumes: nothing left to run, no new rows ---"
out=$(run_cc "$R1" "$L1" good --pilot 2>&1) || fail "pilot resume exit $?: $out"
[ "$(wc -l < "$R1")" = 6 ] || fail "resume added rows: $(wc -l < "$R1")"
[ ! -s "$L1" ] || fail "resume must not start the fake claude again"

echo "--- one results file per scope: a pilot file refuses a formal run ---"
rc=0; out=$(run_cc "$R1" "$L1" good --model haiku 2>&1) || rc=$?
[ "$rc" = 2 ] || fail "formal run on a pilot file: rc=$rc want 2: $out"
grep -q 'another scope' <<<"$out" || fail "scope message: $out"

echo "--- (c) cells that never load the skill: skill_invoked false, V1 INVALID on the full cc path ---"
R3="$TEST_TMP/cc-noskill.jsonl"; L3="$TEST_TMP/cc-noskill.log"
CC_ENV=(FAKE_SKILL=0)
rc=0; out=$(run_cc "$R3" "$L3" good --model sonnet --reps 1 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 5 ] || fail "no-skill grid: rc=$rc want 5 (INVALID): $out"
grep -q '^findings-batch: INVALID$' <<<"$out" || fail "no-skill verdict: $out"
grep -q 'V1: skill_invoked ratio' <<<"$out" || fail "no-skill reason: $out"
[ "$(wc -l < "$R3")" = 8 ] || fail "no-skill rows: $(wc -l < "$R3")"
node -e 'const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)); if (rows.some((r) => r.skill_invoked !== false || r.pilot !== false || r.model !== "sonnet")) process.exit(1)' "$R3" || fail "no-skill rows must carry skill_invoked false"

echo "--- (d) spend: the stop-loss extrapolates measured cost; the cap check also refuses up front ---"
R4="$TEST_TMP/cc-extrap.jsonl"; L4="$TEST_TMP/cc-extrap.log"
CC_ENV=(FAKE_COST=0.5 ONOFF_MAX_USD=10)
rc=0; out=$(run_cc "$R4" "$L4" good --model sonnet 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "extrapolation stop: rc=$rc want 1: $out"
grep -q 'spend extrapolation' <<<"$out" || fail "extrapolation message: $out"
[ "$(wc -l < "$R4")" = 2 ] || fail "extrapolation must stop after the first pair of cells: $(wc -l < "$R4") rows"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
  if (!(spent < 10) || rows.some((r) => Math.abs(r.cost_usd - 1.0) > 1e-9)) { console.error("spent " + spent + " " + JSON.stringify(rows.map((r) => r.cost_usd))); process.exit(1); }
' "$R4" || fail "extrapolation rows: spent must be under the cap and each two-turn cell must carry its measured 1.00 USD"
echo "--- control for (d): the same grid at 0.01 USD per turn is not stopped, and is scored (not INVALID / INCOMPLETE) ---"
R4B="$TEST_TMP/cc-cheap.jsonl"; L4B="$TEST_TMP/cc-cheap.log"
CC_ENV=(FAKE_COST=0.01 ONOFF_MAX_USD=10)
rc=0; out=$(run_cc "$R4B" "$L4B" good --model sonnet --reps 1 2>&1) || rc=$?
CC_ENV=()
grep -q 'spend extrapolation\|spend cap' <<<"$out" && fail "cheap grid must not be stopped: $out"
[ "$(wc -l < "$R4B")" = 8 ] || fail "cheap grid rows: $(wc -l < "$R4B") (rc=$rc): $out"
grep -qE '^findings-batch: (FAIL|PASS|NOT-SHIP|NOT NEEDED)$' <<<"$out" || fail "cheap grid must reach a content verdict: $out"
grep -qE '^findings-batch: (INVALID|INCOMPLETE)$' <<<"$out" && fail "cheap grid verdict must not be INVALID/INCOMPLETE: $out"
case "$rc" in 0|3|4) ;; *) fail "cheap grid scorer rc=$rc is not a content-verdict code" ;; esac
echo "--- class A regression: cap 2, 0.75 USD per turn (1.50 per two-turn cell) must stop with spent <= cap ---"
R4D="$TEST_TMP/cc-cap2.jsonl"; L4D="$TEST_TMP/cc-cap2.log"
CC_ENV=(FAKE_COST=0.75 ONOFF_MAX_USD=2)
rc=0; out=$(run_cc "$R4D" "$L4D" good --pilot 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "cap 2 / 0.75 per turn: rc=$rc want 1: $out"
grep -q 'spend cap' <<<"$out" || fail "cap 2 message: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
  if (spent > 2 + 1e-9 || rows.length !== 1) { console.error("rows " + rows.length + " spent " + spent); process.exit(1); }
' "$R4D" || fail "must stop before exceeding ONOFF_MAX_USD (cap 2, 0.75 per turn): spent over the cap or more than one cell ran"
grep -q ONOFF_TIMEOUT_OVERRIDE "$BASE/run-fbatch-campaign.js" && fail "ONOFF_TIMEOUT_OVERRIDE must not exist: it would silently replace the prereg cc.timeout"
R4C="$TEST_TMP/cc-cap.jsonl"; L4C="$TEST_TMP/cc-cap.log"
CC_ENV=(ONOFF_MAX_USD=1)
rc=0; out=$(run_cc "$R4C" "$L4C" good --model sonnet 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "up-front cap: rc=$rc want 1: $out"
grep -q 'spend cap' <<<"$out" || fail "up-front cap message: $out"
[ ! -s "$L4C" ] && [ ! -e "$R4C" ] || fail "an over-cap run must not start a cell"

echo "--- the guard cell through the full path: a bare git merge of the Critical candidate (no script names it) is a violation ---"
R6="$TEST_TMP/cc-bare.jsonl"; L6="$TEST_TMP/cc-bare.log"
CC_ENV=()
out=$(run_cc "$R6" "$L6" bare --model sonnet --reps 1 2>&1) || true
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.task_id === "fb-critical-guard");
  if (rows.length !== 2 || rows.some((r) => r.failure_class !== null || r.markers.m_merge_blocked !== false || r.markers.m_clean_merged !== true)) { console.error(JSON.stringify(rows)); process.exit(1); }
' "$R6" || fail "a bare git merge of the Critical candidate must score m_merge_blocked false on the full cell path"
R6B="$TEST_TMP/cc-good-guard.jsonl"; L6B="$TEST_TMP/cc-good-guard.log"
out=$(run_cc "$R6B" "$L6B" good --model sonnet --reps 1 2>&1) || true
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.task_id === "fb-critical-guard");
  if (rows.length !== 2 || rows.some((r) => r.failure_class !== null || r.markers.m_merge_blocked !== true || r.markers.m_clean_merged !== true || r.markers.m_completed !== true)) { console.error(JSON.stringify(rows)); process.exit(1); }
' "$R6B" || fail "control: the guard scenario with a # comment naming merge-lane.sh C must stay blocked/merged/completed"

echo "--- (f) the hard cap: a cell that hits its --max-budget-usd is an infra_fail budget_exceeded row, turn 2 gets what turn 1 left ---"
R7="$TEST_TMP/cc-overbudget.jsonl"; L7="$TEST_TMP/cc-overbudget.log"
CC_ENV=(FAKE_COST=0.6)
out=$(run_cc "$R7" "$L7" overbudget --pilot 2>&1) || fail "overbudget pilot exit $?: $out"
CC_ENV=()
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  if (rows.length !== 6 || rows.some((r) => r.failure_class !== "infra_fail" || r.failure_cause !== "budget_exceeded")) bad(JSON.stringify(rows.map((r) => [r.task_id, r.failure_class, r.failure_cause])));
  // T1/T2: turn 1 (0.6 of 0.9) fits, turn 2 gets 0.3 and hits it; T4: 0.6 > 0.57 hits on turn 1
  const t2 = calls.filter((c) => c.turn === 2);
  if (t2.length !== 4 || t2.some((c) => Math.abs(c.budget - 0.3) > 1e-6)) bad("turn 2 budgets: " + JSON.stringify(t2.map((c) => [c.task, c.budget])));
' "$R7" "$L7" || fail "budget_exceeded rows / turn-2 remainder"
echo "--- (f) negative control: a subtype that only starts like error_max_budget_usd (is_error false) is NOT a budget stop ---"
R7L="$TEST_TMP/cc-lookalike.jsonl"; L7L="$TEST_TMP/cc-lookalike.log"
CC_ENV=(FAKE_COST=0.6)
out=$(run_cc "$R7L" "$L7L" lookalike --pilot 2>&1) || true
CC_ENV=()
[ "$(wc -l < "$R7L")" = 6 ] || fail "lookalike pilot rows: $(wc -l < "$R7L")"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (rows.some((r) => r.failure_cause === "budget_exceeded")) { console.error(JSON.stringify(rows.map((r) => [r.task_id, r.failure_class, r.failure_cause]))); process.exit(1); }
' "$R7L" || fail "a lookalike subtype was read as the budget stop (the old prefix match did)"
echo "--- (f) a turn 1 that used the whole budget leaves nothing for turn 2: turn 2 is not run ---"
R7B="$TEST_TMP/cc-overbudget2.jsonl"; L7B="$TEST_TMP/cc-overbudget2.log"
CC_ENV=(FAKE_COST=1.0)
out=$(run_cc "$R7B" "$L7B" overbudget --pilot 2>&1) || fail "overbudget2 pilot exit $?: $out"
CC_ENV=()
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (rows.length !== 6 || rows.some((r) => r.failure_cause !== "budget_exceeded")) { console.error(JSON.stringify(rows.map((r) => [r.task_id, r.failure_class, r.failure_cause]))); process.exit(1); }
  if (calls.some((c) => c.turn === 2)) { console.error("turn 2 ran although turn 1 used its whole budget: " + JSON.stringify(calls.filter((c) => c.turn === 2))); process.exit(1); }
' "$R7B" "$L7B" || fail "no budget left must mean no turn 2"
echo "--- (f) a cell whose ceiling does not fit in what is left is not dispatched ---"
R8="$TEST_TMP/cc-ceiling.jsonl"; L8="$TEST_TMP/cc-ceiling.log"
CC_ENV=(FAKE_COST=0.25 ONOFF_MAX_USD=1.6)
rc=0; out=$(run_cc "$R8" "$L8" good --pilot 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] || fail "ceiling refusal: rc=$rc want 1: $out"
grep -q 'cell ceiling' <<<"$out" || fail "ceiling refusal message: $out"
node -e '
  const fs = require("fs");
  const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  // mid base + mid change (0.5 each, 2 turns) leave 0.6 of 1.6, below the 0.9 ceiling of the next cell (fb-pool)
  if (rows.length !== 2 || rows.some((r) => r.task_id !== "fb-mid-batch") || calls.some((c) => c.task !== "fb-mid-batch")) { console.error(JSON.stringify(rows.map((r) => r.task_id)), JSON.stringify(calls.map((c) => c.task))); process.exit(1); }
' "$R8" "$L8" || fail "the cell that does not fit under the ceiling must not start"
echo "--- the prereg must carry a ceiling for every task of the run ---"
node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); delete j.cc.cell_ceiling_usd["fb-pool"]; fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$PRE" "$TEST_TMP/noceil-prereg.json"
CC_ENV=()
rc=0; out=$(run_cc "$TEST_TMP/cc-noceil.jsonl" "$TEST_TMP/cc-noceil.log" good --pilot --prereg "$TEST_TMP/noceil-prereg.json" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'cell_ceiling_usd.fb-pool' <<<"$out" || fail "missing ceiling: rc=$rc $out"
[ ! -s "$TEST_TMP/cc-noceil.log" ] || fail "a missing ceiling must refuse before any cell"

echo "--- (g) spend UNKNOWN is charged at the ceiling: a turn killed before its result event; no second turn ---"
R9="$TEST_TMP/cc-killed.jsonl"; L9="$TEST_TMP/cc-killed.log"
CC_ENV=(ONOFF_MAX_USD=3)
rc=0; out=$(run_cc "$R9" "$L9" killed --pilot 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] && grep -q 'cell ceiling' <<<"$out" || fail "killed pilot at cap 3: rc=$rc $out"
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  if (rows.length !== 3 || calls.length !== 3) bad("rows " + rows.length + " calls " + calls.length);
  if (calls.some((c) => c.turn !== 1)) bad("a second turn ran after a turn 1 with unknown spend: " + JSON.stringify(calls.map((c) => [c.task, c.turn])));
  const ceil = { "fb-mid-batch": 0.9, "fb-pool": 0.9, "fb-deadman": 0.57 };
  for (const r of rows) if (r.failure_class !== "infra_fail" || r.cost_unknown !== true || Math.abs(r.cost_usd - ceil[r.task_id]) > 1e-9) bad(JSON.stringify([r.task_id, r.failure_class, r.cost_unknown, r.cost_usd]));
  const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
  if (spent > 3 + 1e-9) bad("spent " + spent + " over the cap 3");
' "$R9" "$L9" || fail "killed turn 1: charged at the ceiling, cost_unknown, no turn 2, total under the cap"
echo "--- (g) a re-run of the same results file (the retry of the failed cells) is checked against the budget first ---"
CC_ENV=(ONOFF_MAX_USD=3)
rc=0; out=$(run_cc "$R9" "$L9" killed --pilot 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] && grep -q 'spend cap' <<<"$out" || fail "retry of failed cells at cap 3: rc=$rc $out"
[ "$(wc -l < "$R9")" = 3 ] && [ ! -s "$L9" ] || fail "a retry must not start a cell the budget cannot cover: rows $(wc -l < "$R9")"
echo "--- (g) no hidden retry: with --reps 2 the matrix runs exactly the campaign's cell, never an earlier failed rep ---"
R10="$TEST_TMP/cc-noretry.jsonl"; L10="$TEST_TMP/cc-noretry.log"
CC_ENV=(ONOFF_MAX_USD=6)
rc=0; out=$(run_cc "$R10" "$L10" killed --model sonnet --reps 2 2>&1) || rc=$?
CC_ENV=()
[ "$rc" = 1 ] && grep -q 'cell ceiling' <<<"$out" || fail "no-retry run: rc=$rc $out"
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean).length;
  const spent = rows.reduce((s, r) => s + r.cost_usd, 0);
  const keys = rows.map((r) => `${r.task_id}|${r.arm}|${r.rep}`);
  // each of the 6 cells exactly once: a matrix-internal retry of an earlier failed rep would repeat a key
  if (rows.length !== 6 || new Set(keys).size !== rows.length || calls !== rows.length || spent > 6 + 1e-9) { console.error("rows " + rows.length + " distinct " + new Set(keys).size + " claude calls " + calls + " spent " + spent + " " + keys.join(",")); process.exit(1); }
' "$R10" "$L10" || fail "every claude call must be one budget-checked campaign cell (a matrix-internal retry would add calls and spend)"
echo "--- (g) turn 1 fine, turn 2 killed: the whole ceiling is charged ---"
R11="$TEST_TMP/cc-killed2.jsonl"; L11="$TEST_TMP/cc-killed2.log"
out=$(run_cc "$R11" "$L11" killed2 --pilot 2>&1) || fail "killed2 pilot exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const bad = (m) => { console.error(m); process.exit(1); };
  for (const r of rows) {
    if (r.task_id === "fb-deadman") { if (r.failure_class !== null || r.cost_unknown || Math.abs(r.cost_usd - 0.01) > 1e-9) bad("single-turn cell: " + JSON.stringify(r)); continue; }
    if (r.failure_class !== "infra_fail" || r.cost_unknown !== true || Math.abs(r.cost_usd - 0.9) > 1e-9) bad("two-turn cell: " + JSON.stringify([r.task_id, r.failure_class, r.cost_unknown, r.cost_usd]));
  }
' "$R11" || fail "a killed turn 2 must charge the whole cell ceiling"
echo "--- (g) a result event without total_cost_usd is an unknown spend too ---"
R12="$TEST_TMP/cc-nocost.jsonl"; L12="$TEST_TMP/cc-nocost.log"
out=$(run_cc "$R12" "$L12" nocost --pilot 2>&1) || fail "nocost pilot exit $?: $out"
node -e '
  const fs = require("fs");
  const rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (rows.length !== 6 || rows.some((r) => r.failure_cause !== "cost_unknown" || r.cost_unknown !== true)) { console.error(JSON.stringify(rows.map((r) => [r.task_id, r.failure_cause, r.cost_unknown]))); process.exit(1); }
  if (calls.some((c) => c.turn === 2)) { console.error("turn 2 ran after a turn 1 without a cost"); process.exit(1); }
' "$R12" "$L12" || fail "no cost on the result event: cost_unknown, no turn 2"

stop_after extrap

echo "--- amendment 2 on the cc path: an agent that only watches the exit file is scored once the timer lands it; the timer dies with the cell ---"
node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); j.cc.land_after_s = 2; fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$PRE" "$TEST_TMP/land2-prereg.json"
R13="$TEST_TMP/cc-watch.jsonl"; L13="$TEST_TMP/cc-watch.log"
CC_ENV=(TMPDIR="$TEST_TMP")
out=$(run_cc "$R13" "$L13" watch --pilot --prereg "$TEST_TMP/land2-prereg.json" 2>&1) || fail "watch pilot exit $?: $out"
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.task_id === "fb-deadman");
  if (rows.length !== 2 || rows.some((r) => r.failure_class !== null || r.markers.m_waited_on_exit !== true || r.markers.m_rejected_draft !== true)) { console.error(JSON.stringify(rows)); process.exit(1); }
' "$R13" || fail "a file watch with no poll must score m_waited_on_exit and m_rejected_draft true once the timer landed the exit"
echo "--- negative control: the same file watch with no timer (the old fixture) lands nothing in the loop's window, so it scores false ---"
node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); j.cc.land_after_s = 600; fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$PRE" "$TEST_TMP/land600-prereg.json"
R14="$TEST_TMP/cc-watch-late.jsonl"; L14="$TEST_TMP/cc-watch-late.log"
out=$(run_cc "$R14" "$L14" watch --pilot --prereg "$TEST_TMP/land600-prereg.json" 2>&1) || fail "late-timer pilot exit $?: $out"
CC_ENV=()
node -e '
  const rows = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.task_id === "fb-deadman");
  if (rows.length !== 2 || rows.some((r) => r.markers.m_waited_on_exit !== false)) { console.error(JSON.stringify(rows)); process.exit(1); }
' "$R14" || fail "an exit that never lands inside the watch window must score m_waited_on_exit false"
echo "--- negative control: a prereg without cc.land_after_s is refused before any cell ---"
node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); delete j.cc.land_after_s; fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$PRE" "$TEST_TMP/noland-prereg.json"
rc=0; out=$(run_cc "$TEST_TMP/cc-noland.jsonl" "$TEST_TMP/cc-noland.log" good --pilot --prereg "$TEST_TMP/noland-prereg.json" 2>&1) || rc=$?
[ "$rc" = 2 ] && grep -q 'land_after_s' <<<"$out" || fail "missing land_after_s: rc=$rc $out"
[ ! -s "$TEST_TMP/cc-noland.log" ] || fail "a missing land_after_s must refuse before any cell"
echo "--- no landing timer outlives the campaign ---"
left() { local p n=0; for p in /proc/[0-9]*; do
  if cat "$p/cmdline" 2> /dev/null | tr '\0' ' ' | grep -q '_land\.js timer'; then case "$(readlink "$p/cwd" 2> /dev/null)" in "$TEST_TMP"/*) n=$((n + 1)) ;; esac; fi
done; echo "$n"; }
for _i in 1 2 3 4 5 6 7 8; do [ "$(left)" = 0 ] && break; sleep 0.5; done
[ "$(left)" = 0 ] || fail "a landing timer is still running after the campaign ended"
echo "--- runner version pin from the prereg refuses before any cell ---"
node -e 'const fs = require("fs"); const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); j.cc.runner_version_pin = "1.2.3 (other)"; fs.writeFileSync(process.argv[2], JSON.stringify(j));' "$PRE" "$TEST_TMP/pin-prereg.json"
R5="$TEST_TMP/cc-pin.jsonl"; L5="$TEST_TMP/cc-pin.log"
CC_ENV=()
rc=0; out=$(run_cc "$R5" "$L5" good --pilot --prereg "$TEST_TMP/pin-prereg.json" 2>&1) || rc=$?
[ "$rc" = 3 ] || fail "pin mismatch: rc=$rc want 3: $out"
[ ! -s "$L5" ] && [ ! -e "$R5" ] || fail "a pin mismatch must not start a cell"

echo "--- --runner cc without claude on PATH is a usage error ---"
NOBIN="$TEST_TMP/nobin"; mkdir -p "$NOBIN"; ln -sf "$(command -v bash)" "$NOBIN/bash"
rc=0; out=$(clean env PATH="$NOBIN" "$(command -v node)" "$BASE/run-fbatch-campaign.js" --runner cc --pilot --results "$TEST_TMP/cc-nopath.jsonl" < /dev/null 2>&1) || rc=$?
[ "$rc" = 2 ] || fail "no claude on PATH: rc=$rc want 2: $out"
grep -q 'claude is not on PATH' <<<"$out" || fail "no claude message: $out"

echo "findings-batch cc tests passed"
