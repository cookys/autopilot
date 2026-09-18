#!/bin/bash
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
bash scripts/dispatch-review.sh --runner anthropic-compatible --model GLM-5.2 --endpoint glm --effort high --timeout 20m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2c/r2.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2c/spec.md > /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2c/glm-r2.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2c/glm-r2.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/71623dad-e5ab-461f-bfec-7f0243acc899/scratchpad/c2c/glm-r2.err
