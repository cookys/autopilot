#!/bin/bash
cd /home/cookys/projects/autopilot
bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/r2.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/spec-r2.md > /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/cn-r2.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/cn-r2.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/cn-r2.err
