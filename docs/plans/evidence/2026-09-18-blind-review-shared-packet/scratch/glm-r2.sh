#!/bin/bash
cd /home/cookys/projects/autopilot
. scripts/load-endpoints-env.sh; autopilot_load_endpoints_env >/dev/null 2>&1
bash scripts/dispatch-review.sh --runner anthropic-compatible --model GLM-5.2 --endpoint glm --effort high --timeout 20m --diff-file /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/r2.diff --spec-file /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/spec-r2.md > /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/glm-r2.json 2> /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/glm-r2.err
echo "rc=$?" >> /tmp/claude-1000/-home-cookys-projects-autopilot/f25e2b00-010b-4238-b840-75793ad2a4c9/scratchpad/c2p/glm-r2.err
