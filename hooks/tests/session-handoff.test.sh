#!/usr/bin/env bash
# session-handoff.test.sh — SessionEnd hook (opt-in / Tier B).
#
# Reworked to validate handoff state under ~/.autopilot/handoff, including:
#   - no repo writes
#   - cross-session loop lock
#   - atomic publish
#   - repo root resolution from a subdirectory payload cwd
#   - decide-if-needed behavior and fail-open posture

. "$(dirname "$0")/lib.sh"

mkgit() {
  mkdir -p "$1"
  ( cd "$1" && git init -q -b main && git config user.email t@t && git config user.name t )
}

repo_hash() {
  local repo_root="$1"
  node -e "const crypto = require('crypto'); const fs = require('fs'); console.log(crypto.createHash('sha1').update(fs.realpathSync(process.argv[1])).digest('hex'));" "$repo_root"
}

HOOK="session-handoff.js"

# --- Fixtures: transcripts under sandbox HOME ---
SUBSTANTIVE="$HOOK_HOME/transcript-substantive.jsonl"
{
  printf '%s\n' '{"type":"user","message":{"content":"do x"}}'
  printf '%s\n' '{"type":"assistant","message":{"content":"ok, doing x"}}'
  printf '%s\n' '{"type":"user","message":{"content":"do y"}}'
  printf '%s\n' '{"type":"assistant","message":{"content":"done y"}}'
  printf '%s\n' '{"type":"user","message":{"content":"do z"}}'
  printf '%s\n' '{"type":"user","message":{"content":"and more"}}'
} > "$SUBSTANTIVE"

TRIVIAL="$HOOK_HOME/transcript-trivial.jsonl"
printf '%s\n' '{"type":"user","message":{"content":"hi"}}' > "$TRIVIAL"

TIMESTAMPED="$HOOK_HOME/transcript-timestamped.jsonl"
printf '%s\n' '{"type":"user","timestamp":"2020-01-01T00:00:00Z","message":{"content":"hi"}}' > "$TIMESTAMPED"

GARBAGE_TX="$HOOK_HOME/transcript-garbage.jsonl"
{
  printf 'not json {{{\n'
  printf '}}} also not json\n'
} > "$GARBAGE_TX"

# 1. Dirty work + substantive transcript writes only to ~/.autopilot/handoff (no repo writes).
REPO_WRITE="$TEST_TMP/repo-write"
mkgit "$REPO_WRITE"
( cd "$REPO_WRITE" && echo "v1" > app.txt && git add app.txt && git commit -qm init && echo "v2 uncommitted" > app.txt )
HANDOFF_STATUS_BEFORE=$(git -C "$REPO_WRITE" status --porcelain)
HASH=$(repo_hash "$REPO_WRITE")
PAYLOAD="{\"reason\":\"clear\",\"cwd\":\"$REPO_WRITE\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"s1\"}"
run_hook "$HOOK" "$PAYLOAD"
assert_exit_code "$__RUN_EXIT" "0" "writer: exit 0"
HANDOFF_STATUS_AFTER=$(git -C "$REPO_WRITE" status --porcelain)
assert_eq "$HANDOFF_STATUS_BEFORE" "$HANDOFF_STATUS_AFTER" "writer: no repo write (status unchanged)"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH.md" "writer: handoff body written in ~/.autopilot"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH.meta.json" "writer: handoff meta written in ~/.autopilot"
assert_file_absent "$REPO_WRITE/docs/HANDOFF.md" "writer: never writes docs/HANDOFF.md"
BODY=$(cat "$HOOK_HOME/.autopilot/handoff/$HASH.md")
assert_contains "$BODY" "Session Handoff" "writer: has handoff title"
assert_contains "$BODY" "AUTO-GENERATED" "writer: has auto-generated marker"

# 2. Cross-session feedback loop lock:
#    session-1 real work writes handoff, then commit; session-2 clean + thin transcript writes nothing.
REPO_LOOP="$TEST_TMP/repo-loop"
mkgit "$REPO_LOOP"
( cd "$REPO_LOOP" && echo "v1" > app.txt && git add app.txt && git commit -qm init && echo "dirty" > app.txt )
HASH_LOOP=$(repo_hash "$REPO_LOOP")
PAYLOAD_LOOP1="{\"reason\":\"clear\",\"cwd\":\"$REPO_LOOP\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"loop1\"}"
run_hook "$HOOK" "$PAYLOAD_LOOP1"
assert_exit_code "$__RUN_EXIT" "0" "loop-session1: writer exits"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH_LOOP.md" "loop-session1: state written"
( cd "$REPO_LOOP" && git add app.txt && git commit -qm "real work" )
LOOP_PRE2_STATUS=$(git -C "$REPO_LOOP" status --porcelain)
PAYLOAD_LOOP2="{\"reason\":\"clear\",\"cwd\":\"$REPO_LOOP\",\"transcript_path\":\"$TRIVIAL\",\"session_id\":\"loop2\"}"
run_hook "$HOOK" "$PAYLOAD_LOOP2"
assert_exit_code "$__RUN_EXIT" "0" "loop-session2: writer exits"
LOOP_POST2_STATUS=$(git -C "$REPO_LOOP" status --porcelain)
assert_eq "$LOOP_PRE2_STATUS" "$LOOP_POST2_STATUS" "loop-session2: stays no-handoff-needed state (no loop)"
assert_file_absent "$REPO_LOOP/docs/HANDOFF.md" "loop-session2: no repo write on trivial continuation"

# 3. Atomic publish: complete file exists, no tmp leftovers, meta body size matches.
REPO_ATOMIC="$TEST_TMP/repo-atomic"
mkgit "$REPO_ATOMIC"
( cd "$REPO_ATOMIC" && echo "x" > app.txt && git add app.txt && git commit -qm init && echo "y" > app.txt )
HASH_ATOMIC=$(repo_hash "$REPO_ATOMIC")
PAYLOAD="{\"reason\":\"clear\",\"cwd\":\"$REPO_ATOMIC\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"atomic\"}"
run_hook "$HOOK" "$PAYLOAD"
BODY_FILE="$HOOK_HOME/.autopilot/handoff/$HASH_ATOMIC.md"
META_FILE="$HOOK_HOME/.autopilot/handoff/$HASH_ATOMIC.meta.json"
assert_file_exists "$BODY_FILE" "atomic: body exists"
assert_file_exists "$META_FILE" "atomic: meta exists"
HANDOFF_DIR="$HOOK_HOME/.autopilot/handoff"
shopt -s nullglob
TMP_BODY=("$HANDOFF_DIR/$HASH_ATOMIC.md.tmp."*)
TMP_META=("$HANDOFF_DIR/$HASH_ATOMIC.meta.json.tmp."*)
shopt -u nullglob
assert_eq "${#TMP_BODY[@]}" "0" "atomic: no .md temp file left"
assert_eq "${#TMP_META[@]}" "0" "atomic: no .meta temp file left"
BODY_BYTES=$(wc -c < "$BODY_FILE")
META_BYTES=$(node -e "const fs=require('fs'); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,'utf8')); process.stdout.write(String(m.body_bytes));" "$META_FILE")
assert_eq "$BODY_BYTES" "$META_BYTES" "atomic: body matches meta.body_bytes"

# 4. Resolve repo root from SUBDIR cwd: payload cwd is repo/subdir, hash is toplevel.
REPO_SUB="$TEST_TMP/repo-subdir"
mkgit "$REPO_SUB"
mkdir -p "$REPO_SUB/a/b"
( cd "$REPO_SUB" && echo "x" > f.txt && git add f.txt && git commit -qm init )
SUB_PAYLOAD_CWD="$REPO_SUB/a/b"
SUB_TOP=$(cd "$SUB_PAYLOAD_CWD" && git rev-parse --show-toplevel)
HASH_SUB=$(repo_hash "$SUB_TOP")
PAYLOAD="{\"reason\":\"clear\",\"cwd\":\"$SUB_PAYLOAD_CWD\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"sub\"}"
run_hook "$HOOK" "$PAYLOAD"
assert_exit_code "$__RUN_EXIT" "0" "subdir: writer exits"
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH_SUB.md" "subdir: keyed by repo root hash"

# 5. Commits-since-session-start path.
REPO_COMMITS="$TEST_TMP/repo-commits"
mkgit "$REPO_COMMITS"
( cd "$REPO_COMMITS" && echo "x" > f.txt && git add f.txt && git commit -qm "feat: did work" )
PAYLOAD="{\"reason\":\"clear\",\"cwd\":\"$REPO_COMMITS\",\"transcript_path\":\"$TIMESTAMPED\",\"session_id\":\"s3\"}"
run_hook "$HOOK" "$PAYLOAD"
assert_exit_code "$__RUN_EXIT" "0" "commits-path: exit 0"
HASH_COMMITS=$(repo_hash "$REPO_COMMITS")
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH_COMMITS.md" "commits-path: handoff written by commit trigger"

# 6. Non-act reason (resume) is skipped.
REPO_RESUME="$TEST_TMP/repo-resume"
mkgit "$REPO_RESUME"
( cd "$REPO_RESUME" && echo "x" > f.txt && git add f.txt && git commit -qm init && echo "dirty" > f.txt )
PAYLOAD="{\"reason\":\"resume\",\"cwd\":\"$REPO_RESUME\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"s4\"}"
run_hook "$HOOK" "$PAYLOAD"
assert_exit_code "$__RUN_EXIT" "0" "resume: exit 0"
HASH_RESUME=$(repo_hash "$REPO_RESUME")
assert_file_absent "$HOOK_HOME/.autopilot/handoff/$HASH_RESUME.md" "resume: reason gate skips"

# 7. Non-git cwd → fail-open.
NONGIT="$TEST_TMP/not-a-repo"
mkdir -p "$NONGIT"
run_hook "$HOOK" "{\"reason\":\"clear\",\"cwd\":\"$NONGIT\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"s5\"}"
assert_exit_code "$__RUN_EXIT" "0" "non-git: exit 0"

# 8a. Garbage stdin (not JSON) → fail-open.
run_hook "$HOOK" "this is not json"
assert_exit_code "$__RUN_EXIT" "0" "garbage-stdin: exit 0"

# 8b. Missing transcript on dirty repo still triggers by git state.
REPO_MISS="$TEST_TMP/repo-missing-transcript"
mkgit "$REPO_MISS"
( cd "$REPO_MISS" && echo "x" > f.txt && git add f.txt && git commit -qm init && echo "dirty" >> f.txt )
PAYLOAD="{\"reason\":\"clear\",\"cwd\":\"$REPO_MISS\",\"transcript_path\":\"$HOOK_HOME/does-not-exist.jsonl\",\"session_id\":\"s6\"}"
run_hook "$HOOK" "$PAYLOAD"
assert_exit_code "$__RUN_EXIT" "0" "missing-transcript: exit 0"
HASH_MISS=$(repo_hash "$REPO_MISS")
assert_file_exists "$HOOK_HOME/.autopilot/handoff/$HASH_MISS.md" "missing-transcript: dirty path still writes"

# 8c. Garbage transcript content + clean repo (no other triggers) should not write.
REPO_GARB="$TEST_TMP/repo-garb"
mkgit "$REPO_GARB"
( cd "$REPO_GARB" && echo "x" > f.txt && git add f.txt && git commit -qm init )
PAYLOAD="{\"reason\":\"clear\",\"cwd\":\"$REPO_GARB\",\"transcript_path\":\"$GARBAGE_TX\",\"session_id\":\"s7\"}"
run_hook "$HOOK" "$PAYLOAD"
assert_exit_code "$__RUN_EXIT" "0" "garbage-transcript: exit 0"
HASH_GARB=$(repo_hash "$REPO_GARB")
assert_file_absent "$HOOK_HOME/.autopilot/handoff/$HASH_GARB.md" "garbage-transcript: no write on clean repo + bad transcript"

finalize_test
