#!/usr/bin/env bash
# Stage-1 reviewer qualifier tests, behavioral-oracle bad-mode loop (section 9).
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"


# 9) Findings must match metadata and carry a behavioral consequence witness.
for BAD_MODE in wrong-rule wrong-file wrong-line low-severity missing-witness malformed-witness nonconsequential-witness invalid-domain-witness summary-only; do
  BAD_ORACLE_RC=0
  "$SCRIPT" "${QUALIFY_ARGS[@]}" \
    --panel-cmd "/panel/node /panel/reviewer.js $BAD_MODE" >/dev/null 2>&1 || BAD_ORACLE_RC=$?
  assert_exit_code "$BAD_ORACLE_RC" "1" \
    "behavioral oracle rejects $BAD_MODE reviewer output"
done

finalize_test
