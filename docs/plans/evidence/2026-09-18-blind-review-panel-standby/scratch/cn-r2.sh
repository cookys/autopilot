#!/bin/bash
cd /home/cookys/projects/autopilot
bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/r2.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/spec.md > /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/cn-r2.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/cn-r2.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2b/cn-r2.err
