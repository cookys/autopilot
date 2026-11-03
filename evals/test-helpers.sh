#!/usr/bin/env bash
# Autopilot Eval — shared test helper functions
# Source this file in test scripts: source "$(dirname "$0")/test-helpers.sh"

PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Run a prompt through claude with autopilot plugin loaded
# Returns path to output file
run_skill() {
    local prompt="$1"
    local max_turns="${2:-2}"
    local outfile
    outfile=$(mktemp)
    # G37 (A12 family): with an account registry the claude call goes through claude-account.js (PATH wrapper, token only in the
    # child env), no ambient login is used; a broken registry or a missing helper stops here before any spawn (flag file
    # <outfile>.accountstop, read by stop_if_auth_failed). No registry = unchanged. run_skill runs in a $(...) subshell, so the
    # PATH wrapper and the probe state die with it.
    local _ea_lib="$PLUGIN_DIR/scripts/lib/eval-account.sh" _ea_dir=""
    if [ ! -r "$_ea_lib" ]; then
        echo "eval-account: the account-layer helper $_ea_lib is missing; refusing to start (nothing was spawned)" >&2
        : > "$outfile.accountstop"; echo "$outfile"; return 0
    fi
    # shellcheck source=../scripts/lib/eval-account.sh
    . "$_ea_lib"
    eval_account_probe test-behavior >&2 || { : > "$outfile.accountstop"; echo "$outfile"; return 0; }
    if [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ]; then
        _ea_dir="$(mktemp -d "${TMPDIR:-/tmp}/test-helpers-ea-XXXXXX")"
        eval_account_use_path_wrapper "$_ea_dir"
    fi
    timeout 120 claude -p "$prompt" \
        --plugin-dir "$PLUGIN_DIR" \
        --dangerously-skip-permissions \
        --max-turns "$max_turns" \
        --output-format stream-json \
        --verbose 2>"$outfile.err" > "$outfile" && local claude_rc=0 || claude_rc=$?
    # BL-0294: an authentication failure of this call is flagged for the caller (run_skill runs in a $(...) subshell, so it cannot
    # exit the test itself): <outfile>.authstop exists and the caller runs stop_if_auth_failed.
    # shellcheck source=../scripts/lib/auth-stop.sh
    . "$PLUGIN_DIR/scripts/lib/auth-stop.sh"
    auth_stop_check "run_skill" --failed "$(( claude_rc != 0 ))" --failed-from-stream "$outfile" --log "$outfile" --stderr "$outfile.err" >&2 || : > "$outfile.authstop"
    rm -f "$outfile.err"
    [ -z "$_ea_dir" ] || rm -rf "$_ea_dir"
    echo "$outfile"
}

# Exit 6 (STOP_AUTH) when the run_skill call that produced $1 died on authentication.
stop_if_auth_failed() {
    [ ! -e "$1.accountstop" ] || exit 2
    [ ! -e "$1.authstop" ] || exit 6
}

# Assert output file contains a pattern (regex)
assert_contains() {
    local file="$1"
    local pattern="$2"
    local label="${3:-pattern check}"
    if grep -qE "$pattern" "$file" 2>/dev/null; then
        echo "  PASS: $label"
        return 0
    else
        echo "  FAIL: $label (pattern: $pattern)"
        return 1
    fi
}

# Assert output file does NOT contain a pattern
assert_not_contains() {
    local file="$1"
    local pattern="$2"
    local label="${3:-pattern check}"
    if grep -qE "$pattern" "$file" 2>/dev/null; then
        echo "  FAIL: $label (found: $pattern)"
        return 1
    else
        echo "  PASS: $label"
        return 0
    fi
}

# Assert a skill was triggered in stream-json output
assert_skill_triggered() {
    local file="$1"
    local skill="$2"
    local label="${3:-$skill}"
    if grep -q "\"$skill\"" "$file" 2>/dev/null; then
        echo "  PASS: $label triggered"
        return 0
    else
        echo "  FAIL: $label NOT triggered"
        return 1
    fi
}

# Count matches of a pattern in a file
count_matches() {
    local file="$1"
    local pattern="$2"
    grep -oE "$pattern" "$file" 2>/dev/null | wc -l | tr -d ' '
}

export -f run_skill assert_contains assert_not_contains assert_skill_triggered count_matches
