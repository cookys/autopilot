#!/usr/bin/env bash
cd /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/../clone
export PATH=/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/bin:$PATH
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID
t0=$(date +%s); echo "$(date -Is) START" >> /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/chain.log
bash scripts/qualification-sweep.sh --roster /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/roster-m31ga.json --execute --yes --progress /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/progress.txt > /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/sweep.out 2>&1
echo "$(date -Is) END rc=$? secs=$(($(date +%s)-t0))" >> /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/chain.log
echo rc=ALLDONE >> /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/m31ga/run/chain.log
