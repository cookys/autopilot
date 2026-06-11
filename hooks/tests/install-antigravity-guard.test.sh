#!/usr/bin/env bash
# install-antigravity.sh guard test — the data-loss preflight (symlinked dest /
# dirty repo / unpushed commits) must refuse before touching agy. Uses
# --preflight-only (exits before the agy binary check, so no agy needed) and
# AUTOPILOT_REPO_OVERRIDE to point at sandbox repos.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/install-antigravity.sh"
GUARD_HOME="$TEST_TMP/home"
mkdir -p "$GUARD_HOME/.gemini/config/plugins"

# sandbox repo: clean, with a fake remote so "unpushed" is well-defined
SBX="$TEST_TMP/repo"
REMOTE="$TEST_TMP/remote.git"
git init -q --bare "$REMOTE"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
git -C "$SBX" remote add origin "$REMOTE"
git -C "$SBX" push -q origin develop

run_guard() { HOME="$GUARD_HOME" AUTOPILOT_REPO_OVERRIDE="$SBX" bash "$SCRIPT" --preflight-only "$@" 2>&1; }

# 1. clean repo + clean dest → preflight OK, exit 0
OUT="$(run_guard)"; EXIT=$?
assert_eq "$EXIT" "0" "clean state exit code"
assert_contains "$OUT" "preflight OK" "clean state message"

# 2. symlinked dest → refuse, exit 1, never bypassable (even with --skip-git-checks)
ln -s "$SBX" "$GUARD_HOME/.gemini/config/plugins/autopilot"
OUT="$(run_guard)"; EXIT=$?
assert_eq "$EXIT" "1" "symlink dest exit code"
assert_contains "$OUT" "SYMLINK" "symlink dest message"
OUT="$(run_guard --skip-git-checks)"; EXIT=$?
assert_eq "$EXIT" "1" "symlink dest NOT bypassable by --skip-git-checks"
rm "$GUARD_HOME/.gemini/config/plugins/autopilot"

# 3. real-dir dest → fine (only symlinks are the kill condition)
mkdir -p "$GUARD_HOME/.gemini/config/plugins/autopilot"
OUT="$(run_guard)"; EXIT=$?
assert_eq "$EXIT" "0" "real-dir dest exit code"

# 4. dirty repo → refuse; --skip-git-checks bypasses
echo x > "$SBX/dirty.txt"
OUT="$(run_guard)"; EXIT=$?
assert_eq "$EXIT" "1" "dirty repo exit code"
assert_contains "$OUT" "uncommitted" "dirty repo message"
OUT="$(run_guard --skip-git-checks)"; EXIT=$?
assert_eq "$EXIT" "0" "dirty repo bypassed by --skip-git-checks"
rm "$SBX/dirty.txt"

# 5. unpushed commit → refuse; push clears it
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m unpushed
OUT="$(run_guard)"; EXIT=$?
assert_eq "$EXIT" "1" "unpushed commit exit code"
assert_contains "$OUT" "unpushed" "unpushed commit message"
git -C "$SBX" push -q origin develop
OUT="$(run_guard)"; EXIT=$?
assert_eq "$EXIT" "0" "after push exit code"

# 6. non-git source → refuse without --skip-git-checks; bypassable with it
NOGIT="$TEST_TMP/nogit"; mkdir -p "$NOGIT"
OUT="$(HOME="$GUARD_HOME" AUTOPILOT_REPO_OVERRIDE="$NOGIT" bash "$SCRIPT" --preflight-only 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "non-git source exit code"
assert_contains "$OUT" "not a git repository" "non-git source message"
OUT="$(HOME="$GUARD_HOME" AUTOPILOT_REPO_OVERRIDE="$NOGIT" bash "$SCRIPT" --preflight-only --skip-git-checks 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "non-git source bypassed by --skip-git-checks"

# 7. unknown argument → refuse
OUT="$(run_guard --bogus)"; EXIT=$?
assert_eq "$EXIT" "1" "unknown arg exit code"

# 8. --export-only: sacrificial export has the manifest, no .git, and is not the source
echo '{"name":"t"}' > "$SBX/plugin.json"
git -C "$SBX" add plugin.json && git -C "$SBX" -c user.email=t@t -c user.name=t commit -q -m manifest && git -C "$SBX" push -q origin develop
EXPORT_PATH="$(HOME="$GUARD_HOME" AUTOPILOT_REPO_OVERRIDE="$SBX" bash "$SCRIPT" --export-only 2>/dev/null | tail -1)"; EXIT=$?
assert_eq "$EXIT" "0" "export-only exit code"
assert_neq "$EXPORT_PATH" "$SBX" "export is not the source repo"
assert_file_exists "$EXPORT_PATH/plugin.json" "export contains manifest"
assert_file_absent "$EXPORT_PATH/.git" "export has no .git"
rm -rf "$EXPORT_PATH"

# 9. --export-only on a non-git source → explicit error, exit 1 (no silent $REPO passthrough)
echo '{"name":"t"}' > "$NOGIT/plugin.json"   # pass the manifest check so the export-only check is reached
OUT="$(HOME="$GUARD_HOME" AUTOPILOT_REPO_OVERRIDE="$NOGIT" bash "$SCRIPT" --export-only --skip-git-checks 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "export-only non-git exit code"
assert_contains "$OUT" "requires a git source" "export-only non-git error message"

finalize_test
