#!/usr/bin/env bash
printf '%s\tcwd=%s\targv=%s\n' "$(date -Is)" "$PWD" "$*" >> "/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/argv/$(cat /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/argv/current 2>/dev/null || echo unassigned).log"
exec /home/cookys/.local/bin/claude "$@"
