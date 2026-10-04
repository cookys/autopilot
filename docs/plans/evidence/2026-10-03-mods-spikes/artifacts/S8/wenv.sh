#!/bin/bash
# watcher env: every path isolated (fake HOME, /dev/shm live dir, fixture manifest dir and costs file)
exec env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME=$P/c3/home CLAUDE_CONFIG_DIR=$P/c3/home/.claude XDG_RUNTIME_DIR=$P/c3/claude-xdg AUTOPILOT_LIVE_DIR=/dev/shm/autopilot-kr1-XXXXXX AUTOPILOT_DISPATCH_RUNS_DIR=$P/c3/runs AUTOPILOT_COSTS_FILE=$P/c3/costs.jsonl ENGINE_CAPABILITY_DIR=$P/c3/cap "$@"
