#!/usr/bin/env bash
# compaction-handoff — BL-0147 mechanism: PreCompact writes a deterministic handoff (repo, dispatches,
# marker/ledger, model note, machine state, tail LAST); SessionStart warns when t2 + gap cannot fit under
# window - 33000 and records where a compaction really happened. Every check has a negative control.
# HOME, the live dir, the dispatch-runs dir, the session-mode dir and the calibration file are scratch dirs.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID

export AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/.no-managed-settings.json"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 0700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_MODEL_HANDOFF_DIR="$TEST_TMP/handoff"; mkdir -p "$AUTOPILOT_MODEL_HANDOFF_DIR"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_COMPACTION_POINTS_FILE="$TEST_TMP/calibration/compaction-points.jsonl"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/config.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR \
  AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_GAP

SID="hand0001"
REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
( cd "$REPO" && git init -q -b main && git config user.email t@t && git config user.name t \
  && echo a > a.txt && git add a.txt && git commit -q -m "first commit subject" \
  && echo b > untracked-b.txt && echo changed >> a.txt )

NOW_MS=$(date +%s000)
# one in-flight dispatch (no ended_at) owned by this session, one owned by another session
printf '{"schema":1,"run_id":"run-mine-1","role":"implementer","runner":"codex","model":"gpt-x","started_at":"%s","session_id":"%s"}\n' \
  "$(date -u +%FT%TZ)" "$SID" > "$AUTOPILOT_DISPATCH_RUNS_DIR/run-mine-1.manifest.json"
NOWZ="$(date -u +%FT%TZ)"
# children of this session's foreman: one reachable only by root_run_id, one only by parent_run_id, one grandchild
printf '{"schema":1,"run_id":"kid-root","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"kid-sess-1","root_run_id":"run-mine-1"}\n' "$NOWZ" > "$AUTOPILOT_DISPATCH_RUNS_DIR/kid-root.manifest.json"
printf '{"schema":1,"run_id":"kid-parent","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"kid-sess-2","root_run_id":"unrelated-top","parent_run_id":"run-mine-1"}\n' "$NOWZ" > "$AUTOPILOT_DISPATCH_RUNS_DIR/kid-parent.manifest.json"
printf '{"schema":1,"run_id":"kid-grand","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"kid-sess-3","root_run_id":"unrelated-top","parent_run_id":"kid-parent"}\n' "$NOWZ" > "$AUTOPILOT_DISPATCH_RUNS_DIR/kid-grand.manifest.json"
# another session's child: root and parent both point at the other session's run
printf '{"schema":1,"run_id":"other-kid","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"other-kid-sess","root_run_id":"run-other-9","parent_run_id":"run-other-9"}\n' "$NOWZ" > "$AUTOPILOT_DISPATCH_RUNS_DIR/other-kid.manifest.json"
printf '{"schema":1,"run_id":"run-other-9","role":"reviewer","runner":"codex","model":"gpt-x","started_at":"%s","session_id":"someone-else"}\n' \
  "$(date -u +%FT%TZ)" > "$AUTOPILOT_DISPATCH_RUNS_DIR/run-other-9.manifest.json"

# The runs above are live: stamp the test shell's own pid (alive for the whole test) so the liveness probe
# (dispatch-status.js --run: manifest pid, kill-0) sees them as running.
for f in "$AUTOPILOT_DISPATCH_RUNS_DIR"/*.manifest.json; do
  node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f,"utf8"));m.pid=Number(process.argv[2]);fs.writeFileSync(f,JSON.stringify(m)+"\n")' "$f" "$$"
done

printf 'NOTE-FROM-MODEL: owner said "keep the old API"; next step is X.\n' > "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"

TR="$HOOK_HOME/transcript.jsonl"
{
  printf '%s\n' '{"type":"user","timestamp":"T1","message":{"content":"TAILMARK-user-turn"}}'
  printf '%s\n' '{"type":"assistant","timestamp":"T2","message":{"content":"TAILMARK-assistant-turn"}}'
} > "$TR"

pos() { local s="${1%%"$2"*}"; [ "$s" = "$1" ] && echo -1 || echo "${#s}"; }
FILE="$HOOK_HOME/.autopilot/compaction-state-$SID.md"

# --- 1. file layout: order and content ---------------------------------------------------------
run_hook state-checkpoint.js "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
assert_exit_code "$__RUN_EXIT" 0 "hook exits 0"
C=$(cat "$FILE" 2>/dev/null || echo "")
assert_contains "$C" "branch: main" "git: branch"
assert_contains "$C" "first commit subject" "git: HEAD subject and recent commits"
assert_contains "$C" "untracked-b.txt" "git: untracked file listed"
assert_contains "$C" " M a.txt" "git: modified file listed"
assert_contains "$C" "upstream: unavailable" "git: no upstream says unavailable, not an error"
assert_contains "$C" "worktrees: 1" "git: worktree list"
assert_contains "$C" "run-mine-1" "dispatch: own running run listed"
assert_contains "$C" "RUNNING" "dispatch: marked running"
assert_contains "$C" "dispatch-status.js --run run-mine-1" "dispatch: re-attach command"
assert_not_contains "$C" "run-other-9" "dispatch: another session's run is not listed"
assert_contains "$C" "kid-root RUNNING" "dispatch: child reachable only by root_run_id is listed (no marker)"
assert_contains "$C" "kid-parent RUNNING" "dispatch: child reachable only by parent_run_id is listed"
assert_contains "$C" "kid-grand RUNNING" "dispatch: grandchild (multi-level) is listed"
assert_not_contains "$C" "other-kid" "dispatch: another session's child never mixes in"
assert_contains "$C" "NOTE-FROM-MODEL" "model note merged"
assert_contains "$C" "written 0 minutes ago" "model note carries its age"
assert_contains "$C" "TAILMARK-assistant-turn" "tail still present"
p_git=$(pos "$C" "## Project and Git State"); p_dis=$(pos "$C" "## Dispatches")
p_mk=$(pos "$C" "## Session Marker and Decision Ledger"); p_mn=$(pos "$C" "## Model Handoff Note")
p_ms=$(pos "$C" "## Machine State"); p_tl=$(pos "$C" "## Transcript Tail")
ordered=no
[ "$p_git" -ge 0 ] && [ "$p_git" -lt "$p_dis" ] && [ "$p_dis" -lt "$p_mk" ] && [ "$p_mk" -lt "$p_mn" ] \
  && [ "$p_mn" -lt "$p_ms" ] && [ "$p_ms" -lt "$p_tl" ] && ordered=yes
assert_eq "$ordered" "yes" "sections in order: git, dispatches, marker/ledger, model note, machine state, tail"
[ -n "${HANDOFF_TEST_DUMP:-}" ] && printf "%s\n" "$C" > "$HANDOFF_TEST_DUMP"
body_bytes=$(printf '%s' "$C" | wc -c)
if [ "$body_bytes" -le 8500 ]; then assert_eq 1 1 "file stays under 8500 bytes"; else assert_eq "$body_bytes" "<=8500" "file size cap"; fi

# --- 2. negative controls: every section degrades to 'unavailable' without failing the hook ----
NOREPO="$TEST_TMP/not-a-repo"; mkdir -p "$NOREPO"
rm -f "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"
run_hook state-checkpoint.js "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$NOREPO\"}"
assert_exit_code "$__RUN_EXIT" 0 "not-a-repo cwd: hook still exits 0"
C=$(cat "$FILE")
assert_contains "$C" "branch: unavailable" "negative: not a repo -> git section says unavailable"
assert_contains "$C" "the model left no handoff file" "negative: no model note says so"
assert_contains "$C" "TAILMARK-assistant-turn" "negative: tail survives unavailable sections"

printf 'NOTE-FROM-MODEL via symlink\n' > "$TEST_TMP/real-note.md"
ln -s "$TEST_TMP/real-note.md" "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"
run_hook state-checkpoint.js "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
C=$(cat "$FILE")
assert_contains "$C" "is not a regular file" "negative: symlinked note refused"
assert_not_contains "$C" "NOTE-FROM-MODEL" "negative: symlink target content not merged"
rm -f "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"

# FIFO as the note: open() must not block (O_NONBLOCK); refused as not a regular file, hook ends within the timeout
mkfifo "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"
out=$(timeout 8 node -e '
const h=require(process.argv[1]);
console.log(h.modelNoteSection({sessionId:process.argv[2],now:Date.now(),dirs:{handoff:process.argv[3]}}));
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$SID" "$AUTOPILOT_MODEL_HANDOFF_DIR"); rc=$?
assert_eq "$rc" "0" "negative: FIFO note does not hang the reader (rc 124 = timeout)"
assert_contains "$out" "is not a regular file" "negative: FIFO note refused"
HOME="$HOOK_HOME" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" timeout 8 node "$HOOKS_DIR/state-checkpoint.js" <<< "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}" >/dev/null 2>&1
assert_eq "$?" "0" "negative: PreCompact hook ends normally with a FIFO note"
assert_contains "$(cat "$FILE")" "is not a regular file" "negative: FIFO refusal is in the checkpoint file"
rm -f "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"

# oversized model note: cut at its cap, tail omitted or cut, file bounded
head -c 20000 /dev/zero | tr '\0' 'N' > "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"
run_hook state-checkpoint.js "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
C=$(cat "$FILE"); bytes=$(printf '%s' "$C" | wc -c)
assert_contains "$C" "handoff file cut; full file" "negative: 20 KB model note is cut"
if [ "$bytes" -le 8500 ]; then assert_eq 1 1 "oversize note: file still under 8500 bytes"; else assert_eq "$bytes" "<=8500" "oversize note: size cap"; fi
rm -f "$AUTOPILOT_MODEL_HANDOFF_DIR/$SID.md"

# dispatch reader broken: unavailable, hook ok (drive the lib with a missing status script)
out=$(node -e '
const h=require(process.argv[1]);
console.log(h.dispatchSection({sessionId:"s",roots:new Set(),now:Date.now(),dirs:{dispatchRuns:process.argv[2]},statusScript:"/nonexistent/dispatch-status.js"}));
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$AUTOPILOT_DISPATCH_RUNS_DIR")
assert_contains "$out" "unavailable: dispatch-status exit" "negative: broken dispatch reader -> unavailable"

# liveness: a run with no ended_at is judged by re-derivable facts (manifest pid, kill-0), not by its age. Own dir,
# so the caps of the main fixture above do not apply.
LIVEDIR="$TEST_TMP/runs-liveness"; mkdir -p "$LIVEDIR"
bash -c 'exit 0' & DEADPID=$!; wait "$DEADPID"
OLDZ="$(date -u -d '3 days ago' +%FT%TZ)"
printf '{"schema":1,"run_id":"run-live-1","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"%s","pid":%s}\n' "$OLDZ" "$SID" "$$" > "$LIVEDIR/run-live-1.manifest.json"
printf '{"schema":1,"run_id":"run-gone-1","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"%s","pid":%s}\n' "$NOWZ" "$SID" "$DEADPID" > "$LIVEDIR/run-gone-1.manifest.json"
printf '{"schema":1,"run_id":"run-nopid-1","role":"implementer","runner":"codex","model":"m","started_at":"%s","session_id":"%s"}\n' "$NOWZ" "$SID" > "$LIVEDIR/run-nopid-1.manifest.json"
out=$(node -e '
const h=require(process.argv[1]);
console.log(h.dispatchSection({sessionId:process.argv[2],roots:new Set(),now:Date.now(),dirs:{dispatchRuns:process.argv[3]}}));
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$SID" "$LIVEDIR")
assert_contains "$out" "run-live-1 RUNNING" "liveness: a live pid is RUNNING whatever the run's age"
assert_contains "$out" "run-gone-1 GONE" "liveness: a run whose pid is gone is not shown as running"
assert_not_contains "$out" "run-gone-1 RUNNING" "liveness: a crashed run is never RUNNING"
assert_contains "$out" "run-nopid-1 UNKNOWN" "liveness: no pid or lock -> state unknown, not running"
assert_not_contains "$out" "run-nopid-1 RUNNING" "liveness: no pid or lock is never RUNNING"

# deadline: the whole handoff has one wall-clock bound; sections that do not fit say so in the existing failure format
out=$(node -e '
const h=require(process.argv[1]);
const slow=(cwd,args)=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);return {ok:true,out:"x"};};
const t0=Date.now();
const md=h.buildHandoff({sessionId:"s",cwd:"/tmp",gitRunner:slow,deadlineMs:400,dirs:{dispatchRuns:process.argv[2],handoff:process.argv[3]},snapshot:{error:"none"}});
console.log("elapsed="+(Date.now()-t0));
console.log(md);
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$AUTOPILOT_DISPATCH_RUNS_DIR" "$AUTOPILOT_MODEL_HANDOFF_DIR")
assert_contains "$out" "unavailable: handoff deadline reached" "deadline: a section past the deadline says unavailable"
el=$(printf '%s' "$out" | sed -n 's/^elapsed=//p')
if [ "${el:-99999}" -lt 1500 ]; then assert_eq 1 1 "deadline: handoff ended near the deadline (${el} ms)"; else assert_eq "$el" "<1500" "deadline: handoff overran"; fi
out=$(node -e '
const h=require(process.argv[1]);
console.log(h.dispatchSection({sessionId:"s",roots:new Set(),now:Date.now(),dirs:{dispatchRuns:process.argv[2]},deadlineAt:Date.now()-1}));
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$AUTOPILOT_DISPATCH_RUNS_DIR")
assert_contains "$out" "unavailable: handoff deadline reached" "deadline: dispatch section past the deadline is unavailable"
# a dispatch-status call that hangs is cut at the deadline, not at its own limit (boundedTimeout = min(own, time left))
printf 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,3000);\n' > "$TEST_TMP/slow-status.js"
out=$(node -e '
const h=require(process.argv[1]);
const t0=Date.now();
const md=h.dispatchSection({sessionId:process.argv[2],roots:new Set(),now:Date.now(),dirs:{dispatchRuns:process.argv[3]},statusScript:process.argv[4],deadlineAt:Date.now()+300});
console.log("elapsed="+(Date.now()-t0));
console.log(md);
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$SID" "$LIVEDIR" "$TEST_TMP/slow-status.js")
el=$(printf '%s' "$out" | sed -n 's/^elapsed=//p')
if [ "${el:-99999}" -lt 1000 ]; then assert_eq 1 1 "deadline: a hung liveness probe is cut at the deadline (${el} ms)"; else assert_eq "$el" "<1000" "deadline: hung probe ran past the deadline"; fi
assert_contains "$out" "ETIMEDOUT" "deadline: the hung dispatch-status call is reported as timed out"
assert_not_contains "$out" "RUNNING" "deadline: nothing is shown RUNNING when dispatch-status was cut"

# the PreCompact worst case is fixed: no per-section timeout sum above the deadline constant
cap=$(node -e 'console.log(require(process.argv[1]).HANDOFF_DEADLINE_MS)' "$REPO_ROOT/scripts/lib/compaction-handoff.js")
if [ "${cap:-99999}" -le 8000 ]; then assert_eq 1 1 "deadline: HANDOFF_DEADLINE_MS <= 8000"; else assert_eq "$cap" "<=8000" "deadline constant"; fi

# --- 3. SessionStart budget warning -------------------------------------------------------------
ss() { # $1 = source ; extra env set by caller
  run_hook session-start.js "{\"session_id\":\"$SID\",\"source\":\"$1\",\"cwd\":\"$REPO\",\"transcript_path\":\"${2:-}\"}"
}
printf '{"context_budget":{"t2":450000}}\n' > "$AUTOPILOT_CONFIG_FILE"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=450000
ss startup
assert_contains "$__RUN_STDOUT" "T2 is never reached" "warn: window 450k, t2 450k + gap 50k"
assert_contains "$__RUN_STDOUT" "Window that fits: 533000" "warn: suggests t2 + gap + 33000"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=533000
ss startup
assert_not_contains "$__RUN_STDOUT" "T2 is never reached" "no warn at exactly t2 + gap + 33000"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=532000
ss clear
assert_contains "$__RUN_STDOUT" "T2 is never reached" "warn: one 1k under the boundary (any source)"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=533000
export AUTOPILOT_CONTEXT_BUDGET_GAP=60000
ss startup
assert_contains "$__RUN_STDOUT" "Window that fits: 543000" "gap env raises the bar"
unset AUTOPILOT_CONTEXT_BUDGET_GAP
printf '{"context_budget":{"t2":450000,"gap":80000}}\n' > "$AUTOPILOT_CONFIG_FILE"
ss startup
assert_contains "$__RUN_STDOUT" "Window that fits: 563000" "gap config key raises the bar"
# the budget hint can be switched off: context_budget.mode=off in the config, or the mode env, silences the warning too
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=450000
printf '{"context_budget":{"t2":450000,"mode":"off"}}\n' > "$AUTOPILOT_CONFIG_FILE"
ss startup
assert_not_contains "$__RUN_STDOUT" "T2 is never reached" "off: config context_budget.mode=off -> no budget warning"
printf '{"context_budget":{"t2":450000}}\n' > "$AUTOPILOT_CONFIG_FILE"
AUTOPILOT_CONTEXT_BUDGET_MODE=off ss startup
assert_not_contains "$__RUN_STDOUT" "T2 is never reached" "off: AUTOPILOT_CONTEXT_BUDGET_MODE=off -> no budget warning"
ss startup
assert_contains "$__RUN_STDOUT" "T2 is never reached" "off: control - mode left on still warns"
# readBudget reads the literal config values (t2 and gap), not its own defaults
printf '{"context_budget":{"t2":321000,"gap":12000}}\n' > "$AUTOPILOT_CONFIG_FILE"
lit=$(node -e 'const b=require(process.argv[1]).readBudget({env:{AUTOPILOT_CONFIG_FILE:process.argv[2]}});console.log(b.t2+" "+b.gap)' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$AUTOPILOT_CONFIG_FILE")
assert_eq "$lit" "321000 12000" "readBudget takes t2 and gap from the config file"
# a non-positive t2 in the config is read the way the hook reads it (any finite number), not skipped
printf '{"context_budget":{"t2":-5}}\n' > "$AUTOPILOT_CONFIG_FILE"
t2v=$(node -e 'console.log(require(process.argv[1]).readBudget({env:{AUTOPILOT_CONFIG_FILE:process.argv[2]}}).t2)' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$AUTOPILOT_CONFIG_FILE")
assert_eq "$t2v" "-5" "readBudget takes t2 from the same rule as the hook (config: any finite number)"
printf '{"context_budget":{"t2":450000}}\n' > "$AUTOPILOT_CONFIG_FILE"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW
ss startup
assert_not_contains "$__RUN_STDOUT" "T2 is never reached" "negative: window cannot be resolved -> no warning"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=450000 DISABLE_AUTO_COMPACT=1
ss startup
assert_not_contains "$__RUN_STDOUT" "T2 is never reached" "negative: compaction disabled -> no warning"
unset DISABLE_AUTO_COMPACT CLAUDE_CODE_AUTO_COMPACT_WINDOW

# --- 4. compaction point record ------------------------------------------------------------------
TB="$HOOK_HOME/boundary.jsonl"
FRESHZ="$(date -u +%FT%TZ)"
{
  printf '%s\n' '{"type":"system","subtype":"compact_boundary","timestamp":"2026-10-01T00:00:00Z","version":"2.1.100","compactMetadata":{"trigger":"auto","preTokens":111111}}'
  printf '%s\n' '{"type":"user","message":{"content":"x"}}'
  printf '%s\n' "{\"type\":\"system\",\"subtype\":\"compact_boundary\",\"timestamp\":\"$FRESHZ\",\"version\":\"2.1.302\",\"compactMetadata\":{\"trigger\":\"auto\",\"preTokens\":417000}}"
} > "$TB"
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=450000
ss compact "$TB"
ROW=$(tail -n 1 "$AUTOPILOT_COMPACTION_POINTS_FILE" 2>/dev/null || echo "")
assert_contains "$ROW" '"pre_tokens":417000' "record: newest compact_boundary preTokens"
assert_contains "$ROW" '"window":450000' "record: resolved window"
assert_contains "$ROW" '"cc_version":"2.1.302"' "record: CC version from the boundary row"
assert_contains "$ROW" "\"session_id\":\"$SID\"" "record: session id"
before=$(wc -l < "$AUTOPILOT_COMPACTION_POINTS_FILE")
ss startup "$TB"
after=$(wc -l < "$AUTOPILOT_COMPACTION_POINTS_FILE")
assert_eq "$after" "$before" "negative: a non-compact SessionStart records nothing"
# dedupe: the same (session, boundary_timestamp) run again adds nothing
before=$(wc -l < "$AUTOPILOT_COMPACTION_POINTS_FILE")
ss compact "$TB"
after=$(wc -l < "$AUTOPILOT_COMPACTION_POINTS_FILE")
assert_eq "$after" "$before" "negative: the same boundary seen twice is recorded once"
# freshness: a transcript holding only an old boundary yields a null number with the reason
TOLD="$HOOK_HOME/boundary-old.jsonl"
printf '%s\n' '{"type":"system","subtype":"compact_boundary","timestamp":"2026-10-01T00:00:00Z","version":"2.1.100","compactMetadata":{"trigger":"auto","preTokens":111111}}' > "$TOLD"
ss compact "$TOLD"
ROW=$(tail -n 1 "$AUTOPILOT_COMPACTION_POINTS_FILE")
assert_contains "$ROW" '"pre_tokens":null' "negative: only a stale boundary -> pre_tokens null"
assert_contains "$ROW" "stale compact_boundary" "negative: stale row says why"
assert_not_contains "$ROW" "111111" "negative: the stale number is not recorded"
# the PreCompact checkpoint's own mtime is the floor: a state file exists, the boundary is older than it
# but still inside the 10 minute window (5 minutes ago) -> null, not a number from an earlier compaction
run_hook state-checkpoint.js "{\"transcript_path\":\"$TR\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
assert_file_exists "$FILE" "checkpoint exists before the compact SessionStart"
OLD5Z="$(date -u -d '5 minutes ago' +%FT%TZ)"
T5="$HOOK_HOME/boundary-5min.jsonl"
printf '{"type":"system","subtype":"compact_boundary","timestamp":"%s","version":"2.1.300","compactMetadata":{"trigger":"auto","preTokens":222222}}\n' "$OLD5Z" > "$T5"
ss compact "$T5"
ROW=$(tail -n 1 "$AUTOPILOT_COMPACTION_POINTS_FILE")
assert_contains "$ROW" '"pre_tokens":null' "boundary older than the checkpoint (inside the 10 min window) -> null"
assert_contains "$ROW" "PreCompact checkpoint" "note names the checkpoint as the floor"
assert_not_contains "$ROW" "222222" "the older boundary's number is not recorded"
ss compact "$TR"
ROW=$(tail -n 1 "$AUTOPILOT_COMPACTION_POINTS_FILE")
assert_contains "$ROW" '"pre_tokens":null' "negative: no boundary in transcript -> pre_tokens null"
assert_contains "$ROW" "no compact_boundary" "negative: null row says why"

# --- 5. injected length: every section full, a long handoff directory path, SessionStart(compact) ---------
LONGDIR="$TEST_TMP/$(printf 'd%.0s' $(seq 1 160))"; mkdir -p "$LONGDIR"
export AUTOPILOT_MODEL_HANDOFF_DIR="$LONGDIR"
head -c 20000 /dev/zero | tr '\0' 'N' > "$LONGDIR/$SID.md"
for i in $(seq 1 40); do echo x > "$REPO/$(printf 'long-file-name-%.0s' 1 2 3 4)-$i.txt"; done
# pack the git section too: long commit subjects (HEAD + 5 recent), more worktrees than the list shows, many dirty paths
( cd "$REPO" && git add -A >/dev/null 2>&1 && git reset -q \
  && for i in 1 2 3 4 5 6; do git commit -q --allow-empty -m "commit $i $(printf 'subject-words %.0s' $(seq 1 12))"; done \
  && for i in 1 2 3 4 5 6 7 8; do git worktree add -q "$TEST_TMP/wt-$(printf 'w%.0s' $(seq 1 30))-$i" -b "wt-branch-$i" >/dev/null 2>&1; done )
for i in 1 2 3 4 5 6 7 8; do
  printf '{"schema":1,"run_id":"fill-%s-%s","role":"implementer-with-a-long-role","runner":"codex-runner","model":"model-with-a-rather-long-name-x","started_at":"%s","session_id":"%s"}\n' "$i" "$(printf 'r%.0s' $(seq 1 20))" "$NOWZ" "$SID" > "$AUTOPILOT_DISPATCH_RUNS_DIR/fill-$i.manifest.json"
done
BIGT="$HOOK_HOME/transcript-big.jsonl"
for i in 1 2 3 4 5 6; do printf '{"type":"assistant","timestamp":"T%s","message":{"content":"%s"}}\n' "$i" "$(printf 'W%.0s' $(seq 1 2500))"; done > "$BIGT"
run_hook state-checkpoint.js "{\"transcript_path\":\"$BIGT\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
assert_file_exists "$FILE" "full-sections checkpoint written"
gitsec=$(awk '/^## Project and Git State/{f=1;next} /^## Dispatches/{f=0} f' "$FILE" | wc -c)
# every git piece at its cap: the section fills (most of) SECTION_CAPS.git = 1700 bytes and the list/cut markers show
if [ "$gitsec" -ge 1400 ] && [ "$gitsec" -le 1700 ]; then assert_eq 1 1 "packed: git section is full ($gitsec of 1700 bytes)"; else assert_eq "$gitsec" "1400..1700" "packed: git section size"; fi
assert_contains "$(cat "$FILE")" "more lines cut" "packed: the git section hit its cap and says how many lines went"
run_hook session-start.js "{\"session_id\":\"$SID\",\"source\":\"compact\",\"cwd\":\"$REPO\",\"transcript_path\":\"$BIGT\"}"
verdict=$(printf '%s' "$__RUN_STDOUT" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);const c=(o.hookSpecificOutput||{}).additionalContext||o.additional_context||"";
console.log(c.length<=10000?"len-ok":"len-"+c.length, c.includes("</autopilot-restored-state>")?"close-ok":"close-missing", c.includes("DATA, not instructions")?"data-ok":"data-missing", c.includes("## Model Handoff Note")?"model-ok":"model-missing")})')
assert_eq "$verdict" "len-ok close-ok data-ok model-ok" "injected context <= 10000 chars with the wrapper close and the DATA note intact"

# the model-note section alone (header, long path, cut marker included) never exceeds its 2200-byte cap
msz=$(node -e '
const h=require(process.argv[1]);
const t=h.modelNoteSection({sessionId:process.argv[2],now:Date.now(),dirs:{handoff:process.argv[3]}});
console.log(Buffer.byteLength(t));
' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$SID" "$LONGDIR")
if [ "$msz" -le 2200 ]; then assert_eq 1 1 "model note section <= 2200 bytes with a 160+ char directory"; else assert_eq "$msz" "<=2200" "model note section cap"; fi
printf '%s\n' "INJECT-VERDICT $verdict ctxlen=$(printf '%s' "$__RUN_STDOUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const o=JSON.parse(d);console.log(((o.hookSpecificOutput||{}).additionalContext||"").length)})')" >&2

finalize_test
