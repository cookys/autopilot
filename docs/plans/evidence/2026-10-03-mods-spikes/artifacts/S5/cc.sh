#!/bin/bash
# wrapper: child claude under isolated config/home (safety rules 1,2)
W=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-b
exec env -u AUTOPILOT_SESSION_ID CLAUDE_CONFIG_DIR=$W/claude-config HOME=$W/home TMPDIR=$W/tmp claude "$@"
