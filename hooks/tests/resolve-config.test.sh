#!/usr/bin/env bash
# Tests for scripts/lib/resolve-config.sh — 4-tier ladder + read_field.
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/resolve-config.sh"

assert_file_exists "$LIB" "resolve-config.sh exists"
# shellcheck disable=SC1090
. "$LIB" 2>/dev/null || fail "resolve-config.sh not sourceable"

# --- double-source is a no-op -------------------------------------------------
# shellcheck disable=SC1090
. "$LIB" 2>/dev/null || fail "double-source must be a no-op"
assert_eq "${_AUTOPILOT_RESOLVE_CONFIG_SH:-}" "1" "source guard set after load"

# Sandbox roots (do not touch the real repo layout for ladder resolution)
SANDBOX="$TEST_TMP/cfg-sandbox"
FAKE_REPO="$SANDBOX/repo"
FAKE_CWD="$SANDBOX/cwd"
mkdir -p "$FAKE_REPO/project-config-template" "$FAKE_REPO/.claude" \
         "$FAKE_CWD/.claude"

BASENAME="test-config.md"
NO_LABEL="fail-closed-default"

# Helper: run ladder with controlled PWD/REPO_ROOT
run_ladder() {
  # shellcheck disable=SC2034
  local REPO_ROOT="$FAKE_REPO"
  # Intentionally use subshell so PWD restore is automatic; CONFIG/SOURCE via stdout.
  (
    cd "$FAKE_CWD" || exit 1
    REPO_ROOT="$FAKE_REPO"
    CONFIG=""
    SOURCE=""
    resolve_config_ladder "$BASENAME" "TEST_CFG_OVERRIDE" "$NO_LABEL"
    printf 'CONFIG=%s\nSOURCE=%s\n' "$CONFIG" "$SOURCE"
  )
}

# --- none: no files → empty CONFIG + provided label ---------------------------
unset TEST_CFG_OVERRIDE
out="$(run_ladder)"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^SOURCE=//p')" "$NO_LABEL" "none → no_config label"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^CONFIG=//p')" "" "none → empty CONFIG"

# --- template fallback --------------------------------------------------------
printf 'mode: block\n' > "$FAKE_REPO/project-config-template/$BASENAME"
out="$(run_ladder)"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^SOURCE=//p')" "template" "template tier"
assert_contains "$(printf '%s\n' "$out" | sed -n 's/^CONFIG=//p')" "project-config-template/$BASENAME" "template path"

# --- repo .claude beats template ----------------------------------------------
printf 'mode: warn\n' > "$FAKE_REPO/.claude/$BASENAME"
out="$(run_ladder)"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^SOURCE=//p')" "project-repo" "repo tier wins over template"

# --- cwd .claude beats repo ---------------------------------------------------
printf 'mode: off\n' > "$FAKE_CWD/.claude/$BASENAME"
out="$(run_ladder)"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^SOURCE=//p')" "project-cwd" "cwd tier wins over repo"

# --- override wins (and requires -r) ------------------------------------------
OVERRIDE_FILE="$SANDBOX/override.md"
printf 'mode: block\n' > "$OVERRIDE_FILE"
export TEST_CFG_OVERRIDE="$OVERRIDE_FILE"
out="$(run_ladder)"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^SOURCE=//p')" "override" "override wins"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^CONFIG=//p')" "$OVERRIDE_FILE" "override path"

# non-existent override falls through to next tier (cwd)
export TEST_CFG_OVERRIDE="$SANDBOX/does-not-exist.md"
out="$(run_ladder)"
assert_eq "$(printf '%s\n' "$out" | sed -n 's/^SOURCE=//p')" "project-cwd" "unreadable override falls through"
unset TEST_CFG_OVERRIDE

# --- read_field basics --------------------------------------------------------
CFG="$SANDBOX/fields.md"
cat > "$CFG" <<'EOF'
- mode: block
protected_paths: skills/, agents/
Evidence: trailer
empty_key:
spaces_only:
EOF
# Fix spaces_only line to actually have whitespace after colon
printf 'spaces_only:   \t  \n' >> "$CFG"
# And a trailing-whitespace value
printf 'trim_me:  value  \n' >> "$CFG"

assert_eq "$(read_field "$CFG" mode "DEF")" "block" "reads - key: value"
assert_eq "$(read_field "$CFG" protected_paths "DEF")" "skills/, agents/" "reads key: value"
assert_eq "$(read_field "$CFG" evidence "DEF")" "trailer" "case-insensitive key"
assert_eq "$(read_field "$CFG" missing "DEFAULT_X")" "DEFAULT_X" "missing key → default"
assert_eq "$(read_field "$CFG" trim_me "DEF")" "value" "trailing whitespace stripped"
assert_eq "$(read_field "" mode "DEF")" "DEF" "empty path → default"
assert_eq "$(read_field "$SANDBOX/nope.md" mode "DEF")" "DEF" "unreadable path → default"

# empty key alone → default in BOTH modes
assert_eq "$(read_field "$CFG" empty_key "DEF")" "DEF" "strict: empty value → default"
assert_eq "$(read_field "$CFG" empty_key "DEF" --whitespace-empty)" "DEF" "ws-empty: empty value → default"

# Pure-whitespace values collapse to "" after trailing-ws strip, so both modes
# return default (byte-compatible with the original three call sites).
assert_eq "$(read_field "$CFG" spaces_only "DEF")" "DEF" "strict: whitespace-only → default"
assert_eq "$(read_field "$CFG" spaces_only "DEF" --whitespace-empty)" "DEF" "ws-empty: whitespace-only → default"

# --whitespace-empty keeps real non-empty values (flag path is live)
assert_eq "$(read_field "$CFG" mode "DEF" --whitespace-empty)" "block" "ws-empty keeps real value"

finalize_test
