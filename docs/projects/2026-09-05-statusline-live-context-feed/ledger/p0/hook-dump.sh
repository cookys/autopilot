#!/usr/bin/env bash
# spike: dump a subagent PreToolUse payload (only when agent_id present)
p=$(cat); if printf '%s' "$p" | grep -q '"agent_id"'; then printf '%s\n' "$p" > /run/user/1000/autopilot/spike/hook.json; fi; exit 0
