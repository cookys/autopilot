#!/bin/bash
export AUTOPILOT_LIVE_DIR=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/live S5_LOCK=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/project.lock
touch $S5_LOCK
node /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/launch.js
echo "inner-launch done at $(date -u +%FT%TZ)"
