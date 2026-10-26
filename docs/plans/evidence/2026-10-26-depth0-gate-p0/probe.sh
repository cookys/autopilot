#!/usr/bin/env bash
# probe.sh a|b|c  -- one repeatable probe per command; raw JSONL goes to $OUT/<probe>/<case>/ .
#   a: native subagent, SubagentStop throwaway hook (config-dir settings.json) plus autopilot plugin Stop hooks (--plugin-dir)
#   b: claude-native shape, --settings <file> --session-id X, Stop throwaway hook by absolute path
#   c: cc-shim shapes (hetero: dispatch-hetero.sh:3881; author: dispatch-author.sh:1388), user-level plus --settings double wiring
# Env: OUT (default ./raw), PROBE_MAX_USD (1.0), PROBE_CLAUDE_BIN (fake claude for dry runs; unset = real claude, needs PROBE_PAID=1),
#      PROBE_CREDS_SRC (default ~/.claude/.credentials.json; only the file is copied, the real dir is never handed over),
#      PROBE_REPO (plugin dir for --plugin-dir, default this checkout).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HERE/raw}"; MAXUSD="${PROBE_MAX_USD:-1.0}"; PER_CALL_USD="${PROBE_PER_CALL_USD:-0.15}"
REPO="${PROBE_REPO:-$(cd "$HERE/../../../.." && pwd)}"
CREDS="${PROBE_CREDS_SRC:-$HOME/.claude/.credentials.json}"
NODE="$(command -v node)"; HOOK="$HERE/throwaway-hook.js"
if [ -n "${PROBE_CLAUDE_BIN:-}" ]; then CLAUDE="$PROBE_CLAUDE_BIN"
else
  [ "${PROBE_PAID:-}" = 1 ] || { echo "refuse: real claude is paid; set PROBE_PAID=1 (depth-0 only) or PROBE_CLAUDE_BIN=<fake>" >&2; exit 3; }
  CLAUDE=claude
fi
mkdir -p "$OUT"; [ -f "$OUT/spend.json" ] || echo '{"total":0,"runs":{}}' > "$OUT/spend.json"
spent() { "$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).total)' "$OUT/spend.json"; }
over() { "$NODE" -e 'process.exit(parseFloat(process.argv[1])>=parseFloat(process.argv[2])?0:1)' "$(spent)" "$MAXUSD"; }
addspend() { "$NODE" -e 'const fs=require("fs");const f=process.argv[1];const j=JSON.parse(fs.readFileSync(f));j.runs[process.argv[2]]=parseFloat(process.argv[3]);j.total=Object.values(j.runs).reduce((a,b)=>a+b,0);fs.writeFileSync(f,JSON.stringify(j)+"\n")' "$OUT/spend.json" "$1" "$2"; }
uuid() { "$NODE" -e 'console.log(require("crypto").randomUUID())'; }
A_PROMPT='Use the Agent tool exactly once to launch a subagent whose task is: reply with the single word DONE. After it returns, reply with the single word FINISHED.'
B_PROMPT='Reply with exactly the word OK.'

# run_case <probe> <label> <shape native|hetero|author> <armed 0|1> <arm-sid: -|SID|uuid> <events> <prompt> [plugin 0|1]
run_case() {
  local probe="$1" label="$2" shape="$3" armed="$4" armsid="$5" events="$6" prompt="$7" plugin="${8:-0}"
  local dir="$OUT/$probe/$label"; mkdir -p "$dir"
  # strict cap: remaining = cap - spent; <= 0 means no launch; otherwise this call's budget is min(per-call, remaining)
  local budget; budget="$("$NODE" -e 'const r=parseFloat(process.argv[2])-parseFloat(process.argv[1]);const b=Math.floor(Math.min(parseFloat(process.argv[3]),r)*1e4+1e-6)/1e4;console.log(b>0?b.toFixed(4):"0")' "$(spent)" "$MAXUSD" "$PER_CALL_USD")"
  if [ "$budget" = 0 ]; then   # floor to 4 decimals: never above the remaining cap; 0 after flooring = no launch
    echo "{\"skipped\":true,\"reason\":\"cumulative spend $(spent) leaves no budget under PROBE_MAX_USD $MAXUSD\"}" > "$dir/skipped.json"
    echo "SKIP $probe/$label (cap)"; return 0
  fi
  local H CFG="" sid; H="$(mktemp -d)"; sid="$(uuid)"; : > "$dir/hook.jsonl"
  local S="$dir/settings.json"; "$NODE" "$HERE/mk-settings.js" "$S" "$HOOK" cli "$events"
  local -a args=(-p --session-id "$sid" --model haiku --max-budget-usd "$budget" --strict-mcp-config --dangerously-skip-permissions --output-format stream-json --verbose --include-hook-events)
  local -a envs=(-u CLAUDE_CONFIG_DIR -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_BASE_URL -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID "HOME=$H" "P0_LOG=$dir/hook.jsonl" "P0_ARM=$armed")
  if [ "$armsid" != "-" ]; then [ "$armsid" = "SID" ] && armsid="$sid"; envs+=("P0_ARM_SID=$armsid"); fi
  [ "$probe" = a ] && envs+=("P0_ONLY=SubagentStop")
  case "$shape" in
    native)
      CFG="$(mktemp -d)"; cp "$CREDS" "$CFG/.credentials.json"; chmod 600 "$CFG/.credentials.json"
      [ "$(command ls -A "$CFG")" = ".credentials.json" ] || { echo "ABORT: seeded config dir not credentials-only" >&2; exit 4; }
      case "$CFG" in "$HOME/.claude"|"$HOME/.claude/"*) echo "ABORT: real config dir" >&2; exit 4;; esac
      args+=(--settings "$S")
      envs+=("CLAUDE_CONFIG_DIR=$CFG") ;;
    hetero|author)
      mkdir -p "$H/.claude"; cp "$CREDS" "$H/.claude/.credentials.json"; chmod 600 "$H/.claude/.credentials.json"
      "$NODE" "$HERE/mk-settings.js" "$H/.claude/settings.json" "$HOOK" user "$events"   # user-level wiring: loads only if the user settings source is on
      args+=(--settings "$S")
      [ "$shape" = author ] && args+=(--setting-sources project --tools "") ;;
  esac
  case "$H" in "$HOME") echo "ABORT: real HOME" >&2; exit 4;; esac
  [ "$plugin" = 1 ] && args+=(--plugin-dir "$REPO")
  printf '%s' "$prompt" > "$dir/prompt.txt"
  local t0 t1 rc; t0=$(( $(date +%s%N) / 1000000 ))
  local WD; WD="$(mktemp -d)"
  ( cd "$WD" && env "${envs[@]}" timeout 300 "$CLAUDE" "${args[@]}" < "$dir/prompt.txt" > "$dir/stream.jsonl" 2> "$dir/stderr.txt" ); rc=$?
  t1=$(( $(date +%s%N) / 1000000 )); rm -rf "$WD"
  echo "{\"shape\":\"$shape\",\"rc\":$rc,\"claude_wall_ms\":$((t1-t0)),\"session_id\":\"$sid\",\"argv\":$("$NODE" -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "${args[@]}")}" > "$dir/meta.json"
  [ -n "$CFG" ] && rm -rf "$CFG"; rm -rf "$H"
  local j; j="$("$NODE" "$HERE/analyze.js" "$dir" "$sid")"
  # a call without a result event (crash) is charged its full budget, not 0
  addspend "$probe/$label" "$("$NODE" -e 'const o=JSON.parse(process.argv[1]);console.log(o.is_error===null?process.argv[2]:o.total_cost_usd)' "$j" "$budget")"
  echo "DONE $probe/$label rc=$rc spent=$(spent)"
}
case "${1:-}" in
  a) run_case a a_armed native 1 - SubagentStop,Stop "$A_PROMPT" 1
     run_case a a_unarmed native 0 - SubagentStop,Stop "$A_PROMPT" 1 ;;
  b) run_case b b_armed native 1 SID Stop "$B_PROMPT"
     run_case b b_unarmed native 1 00000000-0000-4000-8000-000000000000 Stop "$B_PROMPT" ;;   # wrong session id = not the armed worker
  c) run_case c c_hetero_armed hetero 1 SID Stop "$B_PROMPT"
     run_case c c_hetero_unarmed hetero 0 - Stop "$B_PROMPT"
     run_case c c_author_armed author 1 SID Stop "$B_PROMPT"
     run_case c c_author_unarmed author 0 - Stop "$B_PROMPT" ;;
  *) echo "usage: probe.sh a|b|c" >&2; exit 2 ;;
esac
