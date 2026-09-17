#!/bin/bash
cd "$1" || exit 99
LOG="$2"; : > "$LOG"
run() { echo "=== $*" >> "$LOG"; ( eval "$*" ) >> "$LOG" 2>&1; echo "=== rc=$? :: $*" >> "$LOG"; }
run bash hooks/tests/resolve-review-loop.test.sh
run bash hooks/tests/review-runner.test.sh
run bash hooks/tests/review-packet.test.sh
run bash hooks/tests/autopilot-engine.test.sh
run bash hooks/tests/contract-parity.test.sh
run node scripts/check-contract-schema.js
run node scripts/check-js-syntax.js
run bash scripts/sync-codex-plugin-skills.sh --check
run node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
echo ALL-DONE >> "$LOG"
