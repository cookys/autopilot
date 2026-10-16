#!/usr/bin/env bash
# bin/autopilot (extensionless PATH entry) must behave exactly like `node bin/autopilot.js`.
. "$(dirname "$0")/lib.sh"

ENTRY="$REPO_ROOT/bin/autopilot"
JS="$REPO_ROOT/bin/autopilot.js"

[ -x "$ENTRY" ] && pass_msg=ok || pass_msg=""
assert_eq "ok" "$pass_msg" "bin/autopilot is executable"
mode="$(git -C "$REPO_ROOT" ls-files -s -- bin/autopilot | cut -d' ' -f1)"
assert_eq "100755" "$mode" "bin/autopilot git mode"

cmp_case() {
  local label="$1"; shift
  local a b ra rb
  a="$("$ENTRY" "$@" 2>&1)"; ra=$?
  b="$(node "$JS" "$@" 2>&1)"; rb=$?
  assert_eq "$b" "$a" "$label: same output"
  assert_eq "$rb" "$ra" "$label: same exit code"
}

cmp_case "help" --help
cmp_case "unknown command" no-such-command
a_rc=0; "$ENTRY" no-such-command >/dev/null 2>&1 || a_rc=$?
assert_eq "2" "$a_rc" "unknown command exits 2 through the wrapper"

finalize_test
