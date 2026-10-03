#!/bin/bash
cd /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a
echo "child start $(date -u +%FT%TZ)"
./cenv.sh /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/proj claude -p "Run exactly this one shell command with the Bash tool and then reply with the word done: bash /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/inner-launch.sh" --model claude-haiku-4-5-20251001 --max-budget-usd 0.05 --no-session-persistence --allowedTools Bash --debug-file /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/debug-child.log > s5/child.stdout 2> s5/child.stderr
echo "child exit rc=$? at $(date -u +%FT%TZ)"
