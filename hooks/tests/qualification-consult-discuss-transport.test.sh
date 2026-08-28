#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/qualification-consult-discuss-transport.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "consult/discuss transport identity-binding suite passes"
assert_contains "$OUT" "assertions passed" \
  "covers broker role/identity binding (local stub), the real provider.js dedicated prompt modes (remote adapter), and the end-to-end mock-socket path, for both consult and discuss"

finalize_test
