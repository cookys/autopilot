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
ss compact "$TR"
ROW=$(tail -n 1 "$AUTOPILOT_COMPACTION_POINTS_FILE")
assert_contains "$ROW" '"pre_tokens":null' "negative: no boundary in transcript -> pre_tokens null"
assert_contains "$ROW" "no compact_boundary" "negative: null row says why"

# --- 5. injected length: every section full, a long handoff directory path, SessionStart(compact) ---------
LONGDIR="$TEST_TMP/$(printf 'd%.0s' $(seq 1 160))"; mkdir -p "$LONGDIR"
export AUTOPILOT_MODEL_HANDOFF_DIR="$LONGDIR"
head -c 20000 /dev/zero | tr '\0' 'N' > "$LONGDIR/$SID.md"
for i in $(seq 1 40); do echo x > "$REPO/$(printf 'long-file-name-%.0s' 1 2 3 4)-$i.txt"; done
for i in 1 2 3 4 5 6 7 8; do
  printf '{"schema":1,"run_id":"fill-%s-%s","role":"implementer-with-a-long-role","runner":"codex-runner","model":"model-with-a-rather-long-name-x","started_at":"%s","session_id":"%s"}\n' "$i" "$(printf 'r%.0s' $(seq 1 20))" "$NOWZ" "$SID" > "$AUTOPILOT_DISPATCH_RUNS_DIR/fill-$i.manifest.json"
done
BIGT="$HOOK_HOME/transcript-big.jsonl"
for i in 1 2 3 4 5 6; do printf '{"type":"assistant","timestamp":"T%s","message":{"content":"%s"}}\n' "$i" "$(printf 'W%.0s' $(seq 1 2500))"; done > "$BIGT"
run_hook state-checkpoint.js "{\"transcript_path\":\"$BIGT\",\"session_id\":\"$SID\",\"cwd\":\"$REPO\"}"
assert_file_exists "$FILE" "full-sections checkpoint written"
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
