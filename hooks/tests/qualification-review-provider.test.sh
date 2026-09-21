#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node "$REPO_ROOT/scripts/qualification-review-provider.test.js" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "qualification provider adapter unit suite passes"
assert_contains "$OUT" "224 assertions passed" \
  "provider covers http env contract, cli transport (codex/claude stubs), prompt-mode gates (incl. the full mode<->role matrix, finding [9]), brain honesty scan (oracle fields + semantic tokens + escape-aware identity hash pin), single-line brain framing, timeout group-kill with liveness+residue proof, orphan-held-pipe settlement, deadline-in-flush-window race with byte-complete truncation coverage, instruction-above-fence ordering, effort validation, the stdout byte cap, QRP_CLI_HOME per-invocation clone (isolation + template immutability + oversize refusal + negative control), the va authoring mode (role-gate matrix + PLAN_CONTRACT teaching + oracle-vocabulary scan + single-line plans), and the agy --dangerously-skip-permissions containment (argv gate incl. other-kinds negative, forced permissions.deny clone merge incl. pre-existing-entry preservation and non-agy negative, and no-output stderr diagnosis surfacing, and a fail-closed refusal before spawn when QRP_CLI_HOME is unset for agy), and the reasoning-truncation diagnosis (stop_reason=max_tokens with no text block is named as a completion-budget exhaustion carrying both token figures and the block shape, while a non-truncated empty reply keeps the generic wording), and the OpenAI Responses protocol (posts /v1/responses with Bearer + x-opencode-session and an input/max_output_tokens body, parses output[].content[].output_text, names its own status:incomplete truncation without borrowing the Messages signal, and refuses an unknown protocol or the cli transport)"

finalize_test
