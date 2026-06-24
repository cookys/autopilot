#!/usr/bin/env bash
# Regression guard for the v2.20.0 footgun: a bump that OMITS --disabled-count
# (and/or --opt-in-count) must PRESERVE the canonical current tier counts, NOT
# silently clobber disabled→0 / opt-in→7. Runs entirely in a sandbox mini-repo
# (sync-version.js resolves REPO_ROOT as path.resolve(__dirname,'..'), so the
# sandbox copy reads the sandbox canonical). Live repo is never touched.
. "$(dirname "$0")/lib.sh"

SANDBOX="$TEST_TMP/sandbox"
SCRIPT=$(setup_sync_version_sandbox "$SANDBOX")
CANON="$SANDBOX/.claude-plugin/plugin.json"

# Parse the fixture's CURRENT tier counts (count-agnostic — survives live count drift).
HFRAG=$(grep -oE '[0-9]+ hooks \([0-9]+ default-on, [0-9]+ opt-in(, [0-9]+ disabled)?\)' "$CANON" | head -1)
HOOKS=$(printf '%s' "$HFRAG" | grep -oE '^[0-9]+')
SKILLS=$(grep -oE '[0-9]+ lifecycle skills' "$CANON" | head -1 | grep -oE '^[0-9]+')
DISABLED=$(printf '%s' "$HFRAG" | grep -oE '[0-9]+ disabled' | grep -oE '^[0-9]+'); DISABLED=${DISABLED:-0}
OPTIN=$(printf '%s' "$HFRAG" | grep -oE '[0-9]+ opt-in' | grep -oE '^[0-9]+')
assert_neq "$HOOKS" "" "hook-count parseable from sandbox canonical"
assert_neq "$DISABLED" "0" "fixture has a non-zero disabled tier (precondition for the footgun)"

# Bump ONLY --version (+ required hook/skill counts), deliberately OMITTING
# --disabled-count and --opt-in-count — the exact shape that triggered the footgun.
node "$SCRIPT" --version 9.9.9 --hook-count "$HOOKS" --skill-count "$SKILLS" >/dev/null 2>&1
assert_exit_code "$?" 0 "bump without --disabled-count/--opt-in-count succeeds"

# The disabled tier must SURVIVE intact (not dropped, not zeroed).
AFTER_FRAG=$(grep -oE '[0-9]+ hooks \([0-9]+ default-on, [0-9]+ opt-in(, [0-9]+ disabled)?\)' "$CANON" | head -1)
AFTER_DISABLED=$(printf '%s' "$AFTER_FRAG" | grep -oE '[0-9]+ disabled' | grep -oE '^[0-9]+'); AFTER_DISABLED=${AFTER_DISABLED:-0}
AFTER_OPTIN=$(printf '%s' "$AFTER_FRAG" | grep -oE '[0-9]+ opt-in' | grep -oE '^[0-9]+')
assert_eq "$AFTER_DISABLED" "$DISABLED" "disabled count PRESERVED (not clobbered to 0)"
assert_eq "$AFTER_OPTIN" "$OPTIN" "opt-in count PRESERVED"
assert_contains "$AFTER_FRAG" "disabled" "3-tier fragment retains the disabled tier"

# Mirrors stay consistent after the omitted-flag bump.
node "$SCRIPT" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "mirrors in sync after omitted-flag bump"

# An EXPLICIT --disabled-count still overrides (the flag is not ignored).
node "$SCRIPT" --version 9.9.8 --hook-count "$HOOKS" --skill-count "$SKILLS" --disabled-count 0 --opt-in-count "$OPTIN" >/dev/null 2>&1
EXPLICIT_FRAG=$(grep -oE '[0-9]+ hooks \([0-9]+ default-on, [0-9]+ opt-in(, [0-9]+ disabled)?\)' "$CANON" | head -1)
assert_not_contains "$EXPLICIT_FRAG" "disabled" "explicit --disabled-count 0 drops to 2-tier (flag honored)"

# Live repo untouched.
node "$REPO_ROOT/scripts/sync-version.js" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "live repo --check still clean (no live mutation)"

finalize_test
