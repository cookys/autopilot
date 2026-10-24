#!/bin/bash
# P2-0 trial runner, v2. Usage:
#   trial.sh <name> <setting-sources> <plugin 0|1> <resume-session-or-"-"> <prompt> <hookspec...>
# hookspec = <label>:<remaining blocks>, one project Stop hook per spec (same probe-hook.js, own counter and log).
# All state (config dir with a credentials copy, HOME, project dir, logs) lives under $P20_ROOT or a fresh mktemp -d,
# and the script refuses to run when that directory is inside a git work tree.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
name=$1; ss=$2; plug=$3; res=$4; prompt=$5; shift 5
ROOT=${P20_ROOT:-$(mktemp -d)}
mkdir -p "$ROOT"
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "refusing: $ROOT is inside a git work tree" >&2; exit 3; fi
T=$ROOT/trials/$name; mkdir -p "$T/home" "$T/proj/.claude" "$T/cfg"
[ -f "$T/cfg/.credentials.json" ] || { cp ~/.claude/.credentials.json "$T/cfg/.credentials.json"; chmod 600 "$T/cfg/.credentials.json"; }
cmds=""
for spec in "$@"; do
  lab=${spec%%:*}; rem=${spec##*:}
  [ -f "$T/$lab.counter.json" ] || echo "{\"remaining\":$rem,\"calls\":0}" > "$T/$lab.counter.json"
  c="P0_LOG=$T/$lab.hook.log P0_COUNTER=$T/$lab.counter.json node $HERE/probe-hook.js Stop"
  cmds="$cmds${cmds:+,}{\"type\":\"command\",\"command\":\"$c\"}"
done
echo "{\"hooks\":{\"Stop\":[{\"hooks\":[$cmds]}]}}" > "$T/proj/.claude/settings.json"
tag=${res:0:8}; [ "$res" = "-" ] && tag=fresh
args=(-p --model claude-haiku-4-5 --output-format stream-json --verbose --include-hook-events --setting-sources "$ss" --debug hooks --debug-file "$T/debug-$tag.log")
if [ "$plug" = 1 ]; then [ -n "${AUTOPILOT_REPO:-}" ] || { echo "AUTOPILOT_REPO is not set (path of the autopilot checkout to load as plugin)" >&2; exit 2; }; args+=(--plugin-dir "$AUTOPILOT_REPO"); fi
[ "$res" != "-" ] && args+=(--resume "$res")
cd "$T/proj"
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$T/home" CLAUDE_CONFIG_DIR="$T/cfg" \
  timeout 300 claude "${args[@]}" "$prompt" > "$T/stream-$tag.jsonl" 2> "$T/stderr-$tag.txt" </dev/null
echo "rc=$? root=$ROOT" | tee -a "$T/rc.txt"
node -e "for(const x of require('fs').readFileSync('$T/stream-$tag.jsonl','utf8').split('\n')){if(x.includes('\"type\":\"result\"')){const o=JSON.parse(x);console.log('RESULT',o.session_id,o.is_error,o.total_cost_usd,JSON.stringify(o.result).slice(0,80))}}"
