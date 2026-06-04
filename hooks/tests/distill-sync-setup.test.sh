#!/usr/bin/env bash
# distill-sync-setup.sh — fix-gitignore correctness/idempotency + usage guards.
# The script EDITS users' .gitignore files, so its safety matrix is tested here:
# every supported input must end with skills tracked AND non-skills .claude/
# state still ignored (the trailing-newline corruption regression).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/distill-sync-setup.sh"
assert_file_exists "$SCRIPT" "script present"

# new sandbox git repo with the given .gitignore bytes (printf %b interpreted)
mkrepo() {
  local dir="$TEST_TMP/r$RANDOM$RANDOM"
  mkdir -p "$dir"; git -C "$dir" init -q
  printf '%b' "$2" > "$dir/.gitignore"
  echo "$dir"
}
ignored() { git -C "$1" check-ignore -q "$2" && echo yes || echo no; }

# --- fix-gitignore: each input → skills tracked + settings still ignored ---
for spec in \
  "bare-nl:.claude/\n" \
  "bare-nonl:.claude/" \
  "star-nl:.claude/*\n" \
  "star-nonl:.claude/*" \
  "starstar-nl:.claude/**\n" \
  "starstar-nonl:.claude/**" ; do
  name="${spec%%:*}"; body="${spec#*:}"
  repo="$(mkrepo "$name" "$body")"
  "$SCRIPT" fix-gitignore "$repo" >/dev/null 2>&1
  assert_exit_code "$?" 0 "fix-gitignore [$name] exits 0"
  assert_eq "$(ignored "$repo" .claude/skills/x/SKILL.md)" "no" "[$name] skills tracked after fix"
  assert_eq "$(ignored "$repo" .claude/settings.json)" "yes" "[$name] settings.json STILL ignored after fix"
done

# --- the trailing-newline corruption regression, asserted explicitly ---
repo="$(mkrepo corrupt ".claude/*")"   # no trailing newline
"$SCRIPT" fix-gitignore "$repo" >/dev/null 2>&1
assert_not_contains "$(cat "$repo/.gitignore")" ".claude/*!.claude" "no mangled concatenated rule"

# --- idempotency: second run is a no-op success, file byte-identical ---
repo="$(mkrepo idem ".claude/\n")"
"$SCRIPT" fix-gitignore "$repo" >/dev/null 2>&1
h1=$(sha1sum "$repo/.gitignore" | awk '{print $1}')
"$SCRIPT" fix-gitignore "$repo" >/dev/null 2>&1
assert_exit_code "$?" 0 "fix-gitignore idempotent re-run exits 0"
h2=$(sha1sum "$repo/.gitignore" | awk '{print $1}')
assert_eq "$h2" "$h1" "fix-gitignore idempotent: .gitignore unchanged on re-run"

# --- no .claude rule at all → already correct, no edit ---
repo="$(mkrepo norule "*.log\n")"
out="$("$SCRIPT" fix-gitignore "$repo" 2>&1)"; ec=$?
assert_exit_code "$ec" 0 "fix-gitignore [norule] exits 0"
assert_contains "$out" "already correct" "[norule] reports already-correct"

# --- usage guards ---
"$SCRIPT" bogus-subcommand >/dev/null 2>&1
assert_exit_code "$?" 2 "unknown subcommand → exit 2"
"$SCRIPT" init-remote >/dev/null 2>&1
assert_exit_code "$?" 2 "init-remote without url → exit 2"
"$SCRIPT" enroll >/dev/null 2>&1
assert_exit_code "$?" 2 "enroll without url → exit 2"

# --- status on a non-existent pack → exit 0, JSON says exists:false ---
out="$(AUTOPILOT_DISTILL_PACK_DIR="$TEST_TMP/nopack" "$SCRIPT" status 2>/dev/null)"; ec=$?
assert_exit_code "$ec" 0 "status (no pack) exits 0"
assert_contains "$out" '"exists":false' "status reports exists:false for missing pack"

finalize_test
