#!/usr/bin/env bash
cd /tmp/hetero-mission-6e6a15016119-blind-review-cleanroom-launcher-2026-09-17-a1-cdUy24; OUT=/tmp/claude-1000/-home-cookys-projects-autopilot/70b3e2b4-2ed5-403c-8fce-19d634ab4525/scratchpad/c1c/repair-suites.txt; : > $OUT
while IFS= read -r cmd; do [ -n "$cmd" ] || continue; log="$OUT.$(echo "$cmd" | tr ' /=' '___').log"; bash -c "$cmd" > "$log" 2>&1; rc=$?; printf '%s | exit=%s | %s\n' "$cmd" "$rc" "$(grep -E '^(PASS|FAIL|SKIP) ' "$log" | tail -1)" >> "$OUT"; done <<'CMDS'
bash hooks/tests/dispatch-review.test.sh
AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/review-packet.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-claude-md-inventory.js
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
CMDS
echo done >> $OUT
