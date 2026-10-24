#!/bin/bash
# usage: trial.sh <name> <setting-sources> <plugin 0|1> <resume-session-or-"-"> <prompt>
set -u
R=$(dirname "$0"); name=$1; ss=$2; plug=$3; res=$4; prompt=$5
T=$R/trials/$name; mkdir -p $T/home $T/proj/.claude $T/cfg
[ -f $T/cfg/.credentials.json ] || cp ~/.claude/.credentials.json $T/cfg/.credentials.json
cat > $T/proj/.claude/settings.json <<J
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node $R/bin/hook.js Stop"}]}]}}
J
[ -f $T/counter.json ] || echo '{"remaining":1,"calls":0}' > $T/counter.json
[ -n "${REMAIN:-}" ] && echo "{\"remaining\":$REMAIN,\"calls\":$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$T/counter.json','utf8')).calls)}catch(e){console.log(0)}")}" > $T/counter.json
args=(-p --model claude-haiku-4-5 --output-format stream-json --verbose --include-hook-events --setting-sources "$ss" --debug hooks --debug-file $T/debug-$4.log)
[ "$plug" = 1 ] && args+=(--plugin-dir /home/cookys/projects/autopilot)
[ "$res" != "-" ] && args+=(--resume "$res")
cd $T/proj
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME=$T/home CLAUDE_CONFIG_DIR=$T/cfg P0_LOG=$T/hook.log P0_COUNTER=$T/counter.json \
  timeout 300 claude "${args[@]}" "$prompt" > $T/stream-$4.jsonl 2> $T/stderr-$4.txt </dev/null
echo rc=$? >> $T/rc-$4.txt
node -e "const l=require('fs').readFileSync('$T/stream-$4.jsonl','utf8').split('\n').filter(x=>x.includes('\"type\":\"result\"'));for(const x of l){const o=JSON.parse(x);console.log('RESULT',o.session_id,o.is_error,o.total_cost_usd,JSON.stringify(o.result).slice(0,80))}"
