#!/bin/bash
cd /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a
rm -f s1-mod-line.jsonl s2-findings.json s2-write-*.txt; rm -rf home/.claude/metrics
./cenv.sh /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/proj/sub claude -p "say ok" --plugin-dir /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/repo --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --session-id 11111111-2222-4333-8444-555555555557 --debug-file /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/debug-neg.log > neg.stdout 2> neg.stderr
echo rc=$? > neg.rc
