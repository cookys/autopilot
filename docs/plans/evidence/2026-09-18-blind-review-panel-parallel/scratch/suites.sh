#!/bin/bash
cd "$1" || exit 99
LOG="$2"; : > "$LOG"
run() { echo "=== $*" >> "$LOG"; ( eval "$*" ) >> "$LOG" 2>&1; echo "=== rc=$? :: $*" >> "$LOG"; }
run bash hooks/tests/review-runner.test.sh
run bash hooks/tests/autopilot-engine.test.sh
run bash hooks/tests/implementation-campaign-dogfood.test.sh
run bash hooks/tests/implementation-campaign-routing.test.sh
run bash hooks/tests/implementation-campaign-receipt.test.sh
run bash hooks/tests/implementation-campaign-state.test.sh
run bash hooks/tests/qc-panel-honesty.test.sh
run bash hooks/tests/review-packet.test.sh
run bash hooks/tests/contract-parity.test.sh
run bash hooks/tests/campaign-dispatch-projection.test.sh
run bash hooks/tests/mission-convergence.test.sh
run node scripts/check-js-syntax.js
run node scripts/check-claude-md-inventory.js
run bash scripts/sync-codex-plugin-skills.sh --check
run node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
echo ALL-DONE >> "$LOG"
