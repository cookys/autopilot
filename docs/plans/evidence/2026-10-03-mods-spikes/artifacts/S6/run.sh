#!/bin/bash
cd /home/cookys/projects/autopilot
env TMPDIR=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/tmp node scripts/benchmark-hook-multiplexer.js --base HEAD~1 --candidate HEAD --fixtures /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/s6/fixtures.json --warmups 0 --repetitions 1 --report /tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b/s6/report.json
echo rc=$?
