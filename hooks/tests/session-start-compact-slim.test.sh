#!/usr/bin/env bash
# session-start-compact-slim.test.sh — S10: SessionStart(compact) injected ~9k chars per compaction (PM seat trace: 120k+117k over 13
# compactions). The restored checkpoint now drops the Transcript Tail (the compaction summary already carries the conversation) and the
# empty "LLM Context" template comment, keeps the git/unanswered-fleet/machine-state sections, and points at a full copy on disk.
# Cap: the injected context for a realistic checkpoint stays <= 4000 chars (was ~9k). Negative control: revert the session-start.js
# change and the length assertion goes red.
. "$(dirname "$0")/lib.sh"

export CLAUDE_CONFIG_DIR="$HOOK_HOME/.claude" AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/no-managed.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR FLEET_ADDRESS AUTOPILOT_FLEET_ADDRESS
mkdir -p "$CLAUDE_CONFIG_DIR" "$HOOK_HOME/.autopilot"
ROOT="$TEST_TMP/root"; mkdir -p "$ROOT/.claude-plugin"
printf '{"name":"autopilot","version":"3.0.1"}' > "$ROOT/.claude-plugin/plugin.json"
printf '## v3.0.1 - Something\n' > "$ROOT/CHANGELOG.md"
printf '%s' "3.0.1" > "$HOOK_HOME/.autopilot/last-seen-version"
REPO="$TEST_TMP/repo"; mkdir -p "$REPO" && git -C "$REPO" init -q

SID="slim-sess-1"
STATE="$HOOK_HOME/.autopilot/compaction-state-$SID.md"
node -e '
const rep=(s,n)=>Array.from({length:n},(_,i)=>s.replace("#",i)).join("\n");
const out=["# Autopilot Compaction Checkpoint",
"## Git\nbranch feat/x head abc1234\n"+rep("M file-#.txt",12),
"## Unanswered Fleet Messages (reserved, never cut)\nids: 01M8AAAAAAAAAAAAAAAAAAAAAA 01M8BBBBBBBBBBBBBBBBBBBBBB",
"## Model note\n"+rep("note line # with some detail about where the work stands",20),
"## Machine State (guaranteed accurate)\nphase: dev\nfailures: 0",
"## Transcript Tail (hook-extracted, auxiliary reference)\n"+rep("[user] turn # "+"t".repeat(300),8),
"## LLM Context (Claude-appended, optional supplement)\n<!-- Claude: this section is OPTIONAL. "+"c".repeat(1100)+" -->\n"].join("\n\n");
require("fs").writeFileSync(process.argv[1],out);' "$STATE"
FULLBYTES=$(wc -c < "$STATE")

ctx_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.hookSpecificOutput?.additionalContext||j?.additional_context||"")}catch{}})'; }
OUT="$(printf '{"source":"compact","cwd":"%s","session_id":"%s"}' "$REPO" "$SID" | env HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$ROOT" node "$HOOKS_DIR/session-start.js" 2>/dev/null | ctx_of)"
LEN=${#OUT}
echo "# fixture checkpoint ${FULLBYTES} bytes; injected context ${LEN} chars"
if [ "$LEN" -le 4000 ]; then assert_eq 1 1 "compact injection <= 4000 chars"; else assert_eq "$LEN" "<=4000" "compact injection cap (chars)"; fi
assert_contains "$OUT" "01M8AAAAAAAAAAAAAAAAAAAAAA" "unanswered fleet message ids kept"
assert_contains "$OUT" "branch feat/x head abc1234" "git state kept"
assert_contains "$OUT" "phase: dev" "machine state kept"
assert_not_contains "$OUT" "Transcript Tail" "transcript tail dropped from the injection"
assert_not_contains "$OUT" "Claude: this section is OPTIONAL" "empty LLM-context template dropped"
assert_contains "$OUT" "compaction-state-$SID-full.md" "pointer to the full copy"
FULL="$HOOK_HOME/.autopilot/compaction-state-$SID-full.md"
assert_file_exists "$FULL" "full copy kept for on-demand reading"
assert_eq "$(wc -c < "$FULL")" "$FULLBYTES" "full copy is the whole checkpoint"
assert_eq "$([ -e "$STATE" ] && echo yes || echo no)" "no" "original consumed once"
