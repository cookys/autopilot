#!/bin/bash
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
bash scripts/dispatch-review.sh --runner anthropic-compatible --model GLM-5.2 --endpoint glm --effort high --timeout 20m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/glm-r2.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/spec.md > /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/glm-r2.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/glm-r2.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/ed4f4545-3dbb-4256-bdb4-80502ec4d221/scratchpad/c1e/glm-r2.err
