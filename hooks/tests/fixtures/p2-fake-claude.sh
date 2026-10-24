#!/usr/bin/env bash
# p2-fake-claude.sh - stand-in for the `claude` CLI used by hooks/tests/p2-batch-wrapper.test.sh (no model call).
# Emulates just enough of 2.1.309: --version, a -p auth probe, and -p/--resume turns that edit the repo and run the
# Stop hooks of .claude/settings.json (block => the "model" repairs the repo, hook called again with stop_hook_active true).
# Env: FAKE_STATE (dir), FAKE_FIXTURES (t14 gate fixtures), FAKE_COST (per call), FAKE_TASK_EDIT (file edited once mid-batch).
case "$*" in *--version*) echo "2.1.309 (Claude Code)"; exit 0 ;; esac
resume=""; dbg=""
while [ $# -gt 0 ]; do
  case "$1" in --resume) resume="$2"; shift 2 ;; --debug-file) dbg="$2"; shift 2 ;; *) shift ;; esac
done
prompt=$(cat)
cost=${FAKE_COST:-0.1}
case "$prompt" in
  *AUTH_OK*) if [ -n "${FAKE_PROBE_FAIL_ONCE:-}" ] && [ ! -e "$FAKE_STATE/probefailed" ]; then mkdir -p "$FAKE_STATE"; : > "$FAKE_STATE/probefailed"; echo '{"type":"result","is_error":false,"result":"AUTH_OK"}'; exit 0; fi; [ -n "${FAKE_PROBE_NOCOST:-}" ] && { echo '{"type":"result","is_error":false,"result":"AUTH_OK"}'; exit 0; }; [ -n "${FAKE_PROBE_SLEEP:-}" ] && sleep "$FAKE_PROBE_SLEEP"; echo '{"type":"result","is_error":false,"result":"AUTH_OK","total_cost_usd":0.0166}'; exit 0 ;;
esac
mkdir -p "$FAKE_STATE"
[ -n "$dbg" ] && : >> "$dbg"
if [ -n "$resume" ]; then sid="$resume"; else sid="fake-$$-$RANDOM"; fi
calls=$(cat "$FAKE_STATE/$sid.calls" 2>/dev/null || echo 0); calls=$((calls + 1)); echo "$calls" > "$FAKE_STATE/$sid.calls"
if [ -n "${FAKE_TASK_EDIT:-}" ] && [ ! -e "$FAKE_STATE/edited" ]; then echo "edited mid-batch" >> "$FAKE_TASK_EDIT"; : > "$FAKE_STATE/edited"; fi
if [ "$calls" -eq 1 ]; then cp "$FAKE_FIXTURES/bad-localtime/cli.py" "$PWD/cli.py"; else cp "$FAKE_FIXTURES/good/cli.py" "$PWD/cli.py"; fi
CMD=$(node -e 'try{const s=JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"));console.log(((s.hooks||{}).Stop||[]).map(x=>(x.hooks||[]).map(y=>y.command).join("\n")).join("\n"))}catch(e){}')
if [ -n "$CMD" ]; then
  active=false; i=0
  while [ "$i" -lt 6 ]; do
    i=$((i + 1))
    out=$(printf '{"session_id":"%s","cwd":"%s","stop_hook_active":%s}' "$sid" "$PWD" "$active" | sh -c "$CMD")
    [ -n "$dbg" ] && printf 'Hooks: Stop [%s] finished with status 0 (1ms)\n' "$CMD" >> "$dbg"
    case "$out" in *'"decision":"block"'*) cp "$FAKE_FIXTURES/good/cli.py" "$PWD/cli.py"; active=true ;; *) break ;; esac
  done
fi
# the real CLI also points <dir>/latest (absolute path) at the newest debug file
[ -n "$dbg" ] && ln -sfn "$(cd "$(dirname "$dbg")" && pwd -P)/$(basename "$dbg")" "$(dirname "$dbg")/latest"
total=$(node -e "console.log(($calls*$cost).toFixed(6))")
printf '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"%s","total_cost_usd":%s,"modelUsage":{"claude-haiku-4-5":{}}}\n' "$sid" "$total"
