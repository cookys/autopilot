#!/usr/bin/env bash
# Tests for scripts/lib/json-emit.sh — RFC 8259 json_escape + json_array_from_lines.
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/json-emit.sh"

assert_file_exists "$LIB" "json-emit.sh exists"
# shellcheck disable=SC1090
. "$LIB" 2>/dev/null || fail "json-emit.sh not sourceable"

# --- double-source is a no-op -------------------------------------------------
# shellcheck disable=SC1090
. "$LIB" 2>/dev/null || fail "double-source must be a no-op"
assert_eq "${_AUTOPILOT_JSON_EMIT_SH:-}" "1" "source guard set after load"

# --- plain ASCII passes through -----------------------------------------------
assert_eq "$(json_escape 'hello world')" 'hello world' "plain ASCII"

# --- quote / backslash --------------------------------------------------------
assert_eq "$(json_escape 'a"b')" 'a\"b' 'quote → \"'
assert_eq "$(json_escape 'a\b')" 'a\\b' 'backslash → \\'

# --- named control escapes ----------------------------------------------------
assert_eq "$(json_escape $'a\nb')" 'a\nb' 'newline → \n'
assert_eq "$(json_escape $'a\tb')" 'a\tb' 'tab → \t'
assert_eq "$(json_escape $'a\rb')" 'a\rb' 'CR → \r'
assert_eq "$(json_escape $'a\bb')" 'a\bb' 'backspace → \b'
assert_eq "$(json_escape $'a\fb')" 'a\fb' 'formfeed → \f'

# --- arbitrary control char → \uXXXX ------------------------------------------
assert_eq "$(json_escape $'a\x01b')" 'a\u0001b' 'U+0001 → \u0001'

# --- combined golden ----------------------------------------------------------
# quotes + backslash + newline + tab
assert_eq "$(json_escape $'say "hi"\\\t\nend')" 'say \"hi\"\\\t\nend' 'combined quotes/backslash/tab/newline'

# --- % is literal (no printf-format bug) --------------------------------------
assert_eq "$(json_escape '100% done')" '100% done' '% passes through literally'
assert_eq "$(json_escape '%s%s')" '%s%s' '%s not treated as format'

# --- json_array_from_lines ----------------------------------------------------
assert_eq "$(json_array_from_lines '')" '[]' 'empty → []'
assert_eq "$(json_array_from_lines $'\n\n')" '[]' 'blank-only → []'
assert_eq "$(json_array_from_lines 'a')" '["a"]' 'single element'
assert_eq "$(json_array_from_lines $'a\nb')" '["a", "b"]' 'two elements with comma-space'
assert_eq "$(json_array_from_lines $'a\n\nb')" '["a", "b"]' 'blank line skipped'
assert_eq "$(json_array_from_lines $'a"b\nc')" '["a\"b", "c"]' 'element with quote is escaped'

finalize_test
