#!/bin/bash
cd /home/cookys/projects/autopilot
bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/r3.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/spec-r3.md > /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/cn-r3.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/cn-r3.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/cn-r3.err
