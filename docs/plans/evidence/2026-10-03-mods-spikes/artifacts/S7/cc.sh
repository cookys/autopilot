#!/bin/bash
# child claude under isolated config/home
W=$C1
exec env -u AUTOPILOT_SESSION_ID CLAUDE_CONFIG_DIR=$W/claude-config HOME=$W/home TMPDIR=$W/tmp claude "$@"
