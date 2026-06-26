#!/usr/bin/env bash
# session-handoff.test.sh — SessionEnd hook (opt-in / Tier B).
#
# Exercises the automated "do I need a handoff before /clear?" decision:
#   - work PRESENT (dirty tree + substantive transcript) → docs/HANDOFF.md written
#   - work ABSENT  (clean tree, trivial transcript)       → nothing written
#   - commits-since-session-start path (timestamped transcript) → written
#   - non-act reason (resume)        → skipped (reason gate)
#   - non-git cwd                    → fail-open, nothing written
#   - garbage stdin / missing transcript → fail-open, exit 0
#   - idempotent overwrite (run twice, single header, no append growth)
#
# The hook reads `cwd` + `transcript_path` from the SessionEnd JSON payload (fd 0),
# so we drive it entirely via crafted payloads — no `cd` needed. Transcript
# fixtures live under $HOOK_HOME (the hook's realpath guard requires the
# transcript to resolve inside HOME, which run_hook points at the sandbox).

. "$(dirname "$0")/lib.sh"

mkgit() {
  mkdir -p "$1"; ( cd "$1" && git init -q -b main && git config user.email t@t && git config user.name t )
}

HOOK="session-handoff.js"

# --- Fixtures: transcripts under sandbox HOME (passes the in-HOME realpath guard) ---
SUBSTANTIVE="$HOOK_HOME/transcript-substantive.jsonl"   # 4 user turns, no timestamps
{
  printf '%s\n' '{"type":"user","message":{"content":"do x"}}'
  printf '%s\n' '{"type":"assistant","message":{"content":"ok, doing x"}}'
  printf '%s\n' '{"type":"user","message":{"content":"do y"}}'
  printf '%s\n' '{"type":"assistant","message":{"content":"done y"}}'
  printf '%s\n' '{"type":"user","message":{"content":"do z"}}'
  printf '%s\n' '{"type":"user","message":{"content":"and more"}}'
} > "$SUBSTANTIVE"

TRIVIAL="$HOOK_HOME/transcript-trivial.jsonl"           # 1 user turn, no timestamp
printf '%s\n' '{"type":"user","message":{"content":"hi"}}' > "$TRIVIAL"

TIMESTAMPED="$HOOK_HOME/transcript-timestamped.jsonl"   # 1 user turn, far-past ts
printf '%s\n' '{"type":"user","timestamp":"2020-01-01T00:00:00Z","message":{"content":"hi"}}' > "$TIMESTAMPED"

GARBAGE_TX="$HOOK_HOME/transcript-garbage.jsonl"        # non-JSON lines
{ printf 'not json {{{\n'; printf '}}} also not json\n'; } > "$GARBAGE_TX"

# ====================================================================
# 1. Work PRESENT: dirty tree + substantive transcript → HANDOFF written
# ====================================================================
REPO_DIRTY="$TEST_TMP/repo-dirty"
mkgit "$REPO_DIRTY"
( cd "$REPO_DIRTY" && echo "v1" > app.txt && git add app.txt && git commit -qm init && echo "v2 uncommitted" >> app.txt )

payload="{\"reason\":\"clear\",\"cwd\":\"$REPO_DIRTY\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"s1\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "work-present: exit 0"
assert_file_exists "$REPO_DIRTY/docs/HANDOFF.md" "work-present: HANDOFF written"
HANDOFF_BODY=$(cat "$REPO_DIRTY/docs/HANDOFF.md" 2>/dev/null || echo "")
assert_contains "$HANDOFF_BODY" "Session Handoff" "work-present: has handoff title"
assert_contains "$HANDOFF_BODY" "AUTO-GENERATED" "work-present: carries auto-gen marker"
assert_contains "$HANDOFF_BODY" "dirty" "work-present: names the dirty trigger"
assert_contains "$HANDOFF_BODY" "git status -sb" "work-present: includes repo state block"

# --- Idempotency: run again, still ONE header, no endless append ---
run_hook "$HOOK" "$payload"
HEADER_COUNT=$(grep -c "^# Session Handoff" "$REPO_DIRTY/docs/HANDOFF.md")
assert_eq "$HEADER_COUNT" "1" "idempotent: exactly one handoff header after 2 runs"

# ====================================================================
# 2. Work ABSENT: clean tree + trivial transcript → nothing written
# ====================================================================
REPO_CLEAN="$TEST_TMP/repo-clean"
mkgit "$REPO_CLEAN"
( cd "$REPO_CLEAN" && echo "x" > f.txt && git add f.txt && git commit -qm init )

payload="{\"reason\":\"clear\",\"cwd\":\"$REPO_CLEAN\",\"transcript_path\":\"$TRIVIAL\",\"session_id\":\"s2\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "work-absent: exit 0"
assert_file_absent "$REPO_CLEAN/docs/HANDOFF.md" "work-absent: NO handoff written"

# ====================================================================
# 3. Commits-since-session-start path: clean tree, far-past session start,
#    repo has a commit → 'commits' trigger fires → HANDOFF written
# ====================================================================
REPO_COMMITS="$TEST_TMP/repo-commits"
mkgit "$REPO_COMMITS"
( cd "$REPO_COMMITS" && echo "x" > f.txt && git add f.txt && git commit -qm "feat: did work" )

payload="{\"reason\":\"clear\",\"cwd\":\"$REPO_COMMITS\",\"transcript_path\":\"$TIMESTAMPED\",\"session_id\":\"s3\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "commits-path: exit 0"
assert_file_exists "$REPO_COMMITS/docs/HANDOFF.md" "commits-path: HANDOFF written"
assert_contains "$(cat "$REPO_COMMITS/docs/HANDOFF.md")" "commits" "commits-path: names the commits trigger"

# ====================================================================
# 4. Non-act reason (resume) on a dirty repo → skipped by the reason gate
# ====================================================================
REPO_RESUME="$TEST_TMP/repo-resume"
mkgit "$REPO_RESUME"
( cd "$REPO_RESUME" && echo "x" > f.txt && git add f.txt && git commit -qm init && echo "dirty" >> f.txt )

payload="{\"reason\":\"resume\",\"cwd\":\"$REPO_RESUME\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"s4\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "resume: exit 0"
assert_file_absent "$REPO_RESUME/docs/HANDOFF.md" "resume: reason gate skips non-clear/logout"

# ====================================================================
# 5. Non-git cwd → fail-open, nothing written
# ====================================================================
NONGIT="$TEST_TMP/not-a-repo"
mkdir -p "$NONGIT"
payload="{\"reason\":\"clear\",\"cwd\":\"$NONGIT\",\"transcript_path\":\"$SUBSTANTIVE\",\"session_id\":\"s5\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "non-git: exit 0 (fail-open)"
assert_file_absent "$NONGIT/docs/HANDOFF.md" "non-git: nothing written"

# ====================================================================
# 6a. Garbage stdin (not JSON) → fail-open, exit 0
# ====================================================================
run_hook "$HOOK" "this is not json {{{"
assert_exit_code "$__RUN_EXIT" "0" "garbage-stdin: fail-open exit 0"

# 6b. Missing transcript file but dirty repo (reason=clear) → still decides via git, exit 0
REPO_NOTX="$TEST_TMP/repo-notx"
mkgit "$REPO_NOTX"
( cd "$REPO_NOTX" && echo "x" > f.txt && git add f.txt && git commit -qm init && echo "dirty" >> f.txt )
payload="{\"reason\":\"clear\",\"cwd\":\"$REPO_NOTX\",\"transcript_path\":\"$HOOK_HOME/does-not-exist.jsonl\",\"session_id\":\"s6\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "missing-transcript: fail-open exit 0"
assert_file_exists "$REPO_NOTX/docs/HANDOFF.md" "missing-transcript: dirty git still triggers write"

# 6c. Garbage transcript content (unparseable JSONL) + clean repo → no crash, no write
REPO_GARB="$TEST_TMP/repo-garb"
mkgit "$REPO_GARB"
( cd "$REPO_GARB" && echo "x" > f.txt && git add f.txt && git commit -qm init )
payload="{\"reason\":\"clear\",\"cwd\":\"$REPO_GARB\",\"transcript_path\":\"$GARBAGE_TX\",\"session_id\":\"s7\"}"
run_hook "$HOOK" "$payload"
assert_exit_code "$__RUN_EXIT" "0" "garbage-transcript: fail-open exit 0"
assert_file_absent "$REPO_GARB/docs/HANDOFF.md" "garbage-transcript+clean: nothing written"

finalize_test
