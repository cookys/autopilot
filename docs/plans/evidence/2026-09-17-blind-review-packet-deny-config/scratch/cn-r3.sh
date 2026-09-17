#!/bin/bash
cd /home/cookys/projects/autopilot
bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/cn-r3.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/spec.md > /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/cn-r3.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/cn-r3.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/cn-r3.err
