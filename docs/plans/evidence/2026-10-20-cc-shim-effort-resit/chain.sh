#!/usr/bin/env bash
cd /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/clone
export PATH=/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/bin:$PATH
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID
for s in claude-haiku-5-5 claude-sonnet-5-5 claude-opus-5-5 m31; do
  if [ $s = m31 ]; then ro=/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/roster-m31.json; else ro=/tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/roster-$s.json; fi
  echo $s > /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/argv/current; t0=$(date +%s)
  echo "$(date -Is) START $s" >> /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/chain.log
  bash scripts/qualification-sweep.sh --roster $ro --execute --yes --progress /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/progress-$s.txt > /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/sweep-$s.out 2>&1
  echo "$(date -Is) END $s rc=$? secs=$(($(date +%s)-t0))" >> /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/chain.log
done
echo "rc=ALLDONE" >> /tmp/claude-1000/-home-cookys-projects-autopilot/e40cc506-6c9a-4bf7-bc9f-8a4187de5604/scratchpad/ceo/resit/run/chain.log
