#!/usr/bin/env bash
# §4.1 no-regression commands on a detached scratch checkout of <sha>. Usage: suites.sh <sha> <out.txt>
set -u
SHA="$1"; OUT="$2"
WT=$(mktemp -d /tmp/autopilot-suites-XXXXXX)
git -C /home/cookys/projects/autopilot worktree add --detach "$WT" "$SHA" >/dev/null 2>&1 || { echo "worktree add failed" > "$OUT"; exit 1; }
cd "$WT" || exit 1
: > "$OUT"
echo "sha=$SHA wt=$WT start=$(date -u +%FT%TZ)" >> "$OUT"
pass=0; fail=0
while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  bash -c "$cmd" > "$WT/.suite.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then pass=$((pass+1)); echo "PASS rc=0  $cmd" >> "$OUT"; else fail=$((fail+1)); echo "FAIL rc=$rc $cmd" >> "$OUT"; tail -20 "$WT/.suite.log" | sed 's/^/    /' >> "$OUT"; fi
done <<'CMDS'
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
CMDS
echo "summary pass=$pass fail=$fail end=$(date -u +%FT%TZ)" >> "$OUT"
cd /; git -C /home/cookys/projects/autopilot worktree remove --force "$WT" >/dev/null 2>&1
