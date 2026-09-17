#!/bin/bash
cd /home/cookys/projects/autopilot
bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1d/glm-r2.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1d/glm-r2-spec.md > /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1d/cn-r2.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1d/cn-r2.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1d/cn-r2.err
