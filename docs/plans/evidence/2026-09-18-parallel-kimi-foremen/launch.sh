#!/usr/bin/env bash
# launch.sh <unit-letter> <clone-dir> — one kimi foreman per clone, detached
u="$1"; clone="$2"
cd "$clone" || exit 1
env -u AUTOPILOT_SESSION_ID bash scripts/dispatch-foreman.sh --brief-file /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/par/$u/brief.md --plan-file /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/par/$u/plan.md --model kimi-code/k3 --run-id "par2-$u" --run-dir /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/par/$u/run --timeout 7200 > /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/par/$u/result.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/par/$u/err.log < /dev/null
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/par/$u/err.log
