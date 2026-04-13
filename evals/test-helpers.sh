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
    timeout 120 claude -p "$prompt" \
        --plugin-dir "$PLUGIN_DIR" \
        --dangerously-skip-permissions \
        --max-turns "$max_turns" \
        --output-format stream-json \
        --verbose 2>/dev/null > "$outfile" || true
    echo "$outfile"
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
