#!/bin/bash
# NC6 live runner. Usage: run.sh <on|off>   Needs WT (checkout holding hooks/per-turn-gate.js; default: the checkout holding this file).
# Everything lives under a mktemp -d root outside any git work tree; the config dir holds only a copy of .credentials.json.
set -eu
k=$1; HERE=$(cd "$(dirname "$0")" && pwd); WT=${WT:-$(git -C "$HERE" rev-parse --show-toplevel)}
ROOT=${NC6_ROOT:-$(mktemp -d)}; mkdir -p "$ROOT"
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "refusing: $ROOT is inside a git work tree" >&2; exit 3; fi
V="$HERE/stub-verifier.js"; T=$ROOT/$k
mkdir -p "$T/live" "$T/repo/.claude" "$T/cfg" "$T/home"; chmod 700 "$T/live"
cp ~/.claude/.credentials.json "$T/cfg/.credentials.json"; chmod 600 "$T/cfg/.credentials.json"
cat > "$T/repo/.claude/settings.json" <<JSON
{"hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"node $WT/hooks/per-turn-gate.js","timeout":60}]}]}}
JSON
if [ "$k" = on ]; then echo "{\"hooks\":{\"per-turn-gate\":true},\"per_turn_gate\":{\"verifier\":\"node $V\",\"max_blocks\":1}}" > "$T/config.json"
else echo "{\"per_turn_gate\":{\"verifier\":\"node $V\",\"max_blocks\":1}}" > "$T/config.json"; fi
( cd "$T/repo" && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$T/home" CLAUDE_CONFIG_DIR="$T/cfg" \
  AUTOPILOT_LIVE_DIR="$T/live" AUTOPILOT_CONFIG_FILE="$T/config.json" \
  timeout 300 claude -p --model claude-haiku-4-5 --setting-sources project --output-format stream-json --verbose --include-hook-events \
  --debug hooks --debug-file "$T/debug.log" "Reply with the word done." < /dev/null > "$T/stream.jsonl" 2> "$T/stderr.txt" ) || echo "claude rc=$?"
echo "root=$ROOT"; echo "-- $k hook log"; cat "$T"/live/per-turn-gate/*.jsonl 2>/dev/null || echo "(no log file)"
node -e "for(const x of require('fs').readFileSync('$T/stream.jsonl','utf8').split('\n')){if(x.includes('\"type\":\"result\"')){const o=JSON.parse(x);console.log('RESULT',o.is_error,o.total_cost_usd,JSON.stringify(o.result).slice(0,80))}}"
