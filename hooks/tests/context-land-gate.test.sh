#!/usr/bin/env bash
# context-land-gate — T2/T3 land checklist (hooks/context-budget.js) plus the Stop gate (hooks/context-land-gate.js).
# (a) T2 fired, no handoff -> Stop blocked   (b) handoff after the fire -> allowed, read-line printed once
# (c) blocked twice -> third stop allowed + audit line   (d) T3 repeats the flow after a T2 handoff
# (d2) explicit t3 via env fires below 70% and below the 1M default
reset; use_context 410000
AUTOPILOT_CONTEXT_BUDGET_T3=400000 fire >/dev/null; err="$(cat "$TMP/fire.err")"
has "$err" 'Context budget T3' && ok "(d2) AUTOPILOT_CONTEXT_BUDGET_T3 sets the T3 threshold" || bad "(d2) no T3: $err"

# (e) subagent never blocked   (f) mode off never blocks   (g) no fire -> no block
# HOME, XDG_RUNTIME_DIR, live dir and state dir are scratch dirs; nothing live is read or written.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
BUDGET="$REPO_ROOT/hooks/context-budget.js"
GATE="$REPO_ROOT/hooks/context-land-gate.js"

TMP="$(mktemp -d "/dev/shm/context-land-gate-XXXXXX")"
export AUTOPILOT_MANAGED_SETTINGS_FILE="$TMP/.no-managed-settings.json"
trap 'rm -rf "$TMP"' EXIT

SID="55555555-6666-7777-8888-999999999999"
LIVE="$TMP/live"; XDG="$TMP/xdg"; PROJ="$TMP/proj"
mkdir -p "$LIVE/context" "$XDG" "$PROJ/.claude" "$TMP/home" "$TMP/claude"
chmod 0700 "$LIVE" "$XDG"
export HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/claude" CLAUDE_PROJECT_DIR="$PROJ" AUTOPILOT_LIVE_DIR="$LIVE"
export XDG_RUNTIME_DIR="$XDG" AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state" CLAUDE_CODE_SESSION_ID="$SID"
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_T3 AUTOPILOT_CONTEXT_BUDGET_STEP AUTOPILOT_CONTEXT_BUDGET_MODE
HANDOFF="$LIVE/handoff/$SID.md"
STATE="$TMP/state/$SID.json"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

TRANSCRIPT="$TMP/transcript.jsonl"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\",\"cwd\":\"$PROJ\"}"
STOP_PAYLOAD="{\"session_id\":\"$SID\",\"cwd\":\"$PROJ\",\"hook_event_name\":\"Stop\"}"

use_context() {  # $1 = tokens (1M window, fresh live file)
  printf '%s\n' "{\"timestamp\":\"2026-10-12T08:00:00.000Z\",\"message\":{\"usage\":{\"input_tokens\":2,\"cache_read_input_tokens\":$1,\"cache_creation_input_tokens\":0,\"output_tokens\":10}}}" > "$TRANSCRIPT"
  cat > "$LIVE/context/$SID.json" <<JSON
{"cc_version":"2.1.296","schema_version":1,"session_id":"$SID",
 "model":{"display_name":"test","id":"claude-opus-5[1m]"},
 "context_window":{"context_window_size":1000000,"total_input_tokens":$1,
   "current_usage":{"input_tokens":2,"cache_read_input_tokens":$1,"cache_creation_input_tokens":0,"output_tokens":10},
   "used_percentage":0},
 "written_at":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"}
JSON
}
fire() {  # run the PostToolUse hook; stderr in $TMP/fire.err, exit code echoed
  printf '%s' "$PAYLOAD" | node "$BUDGET" >/dev/null 2>"$TMP/fire.err"; echo $?
}
stop() {  # $1 optional extra json merged into the payload; prints the hook's stdout
  if [ -n "${1:-}" ]; then printf '%s' "$STOP_PAYLOAD" | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));Object.assign(p,JSON.parse(process.argv[1]));process.stdout.write(JSON.stringify(p))' "$1" | node "$GATE" 2>/dev/null
  else printf '%s' "$STOP_PAYLOAD" | node "$GATE" 2>/dev/null; fi
}
write_handoff() {  # mtime 60 s in the future so it is newer than any fire recorded in this test
  mkdir -p "$(dirname "$HANDOFF")"; printf '# handoff\n' > "$HANDOFF"
  node -e 'const t=Date.now()/1000+60;require("fs").utimesSync(process.argv[1],t,t)' "$HANDOFF"
}
reset() { rm -rf "$TMP/state" "$LIVE/handoff"; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# --- T2 wording: the land checklist, not "keep working ... backup"
reset; use_context 160000
rc="$(fire)"; err="$(cat "$TMP/fire.err")"
[ "$rc" = 2 ] && ok "T2 fires with exit 2" || bad "T2 exit code $rc: $err"
has "$err" '/handoff' && has "$err" 'references/knowledge-routing.md' && has "$err" "$HANDOFF" && ok "T2 message: land checklist with routing doc and handoff path" || bad "T2 message lacks checklist: $err"
has "$err" 'BACKUP' && bad "T2 message still has the old backup wording" || ok "T2 message has no old backup wording"

# (a) fired, no handoff -> blocked
out="$(stop)"
has "$out" '"decision":"block"' && has "$out" '/handoff' && ok "(a) T2 fired, no handoff: Stop blocked" || bad "(a) expected block, got: $out"

# (b) handoff written after the fire -> relay line once, then silent
write_handoff
out="$(stop)"
has "$out" "read $HANDOFF 接續" && ok "(b) handoff after fire: read-line printed" || bad "(b) read-line missing: $out"
has "$out" '重啟' || has "$out" 'restart' && ok "(b) tells the model to relay plugin update / restart" || bad "(b) no relay instruction: $out"
[ -z "$(stop)" ] && ok "(b) read-line only once" || bad "(b) second stop was not silent"

# (c) blocked twice -> third allowed + audit
reset; use_context 160000; fire >/dev/null
o1="$(stop)"; o2="$(stop)"; o3="$(stop)"; o4="$(stop)"
has "$o1" '"decision":"block"' && has "$o2" '"decision":"block"' && ok "(c) first two stops blocked" || bad "(c) first two: [$o1] [$o2]"
[ -z "$o3" ] && [ -z "$o4" ] && ok "(c) third and later stops allowed" || bad "(c) third/fourth: [$o3] [$o4]"
n="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String((s.landAudit||[]).length))' "$STATE")"
[ "$n" = 1 ] && ok "(c) exactly one audit line in the state" || bad "(c) audit lines: $n"

# (d) T3 repeats the flow after a T2 handoff
reset; use_context 160000; fire >/dev/null
write_handoff; stop >/dev/null
node -e 'const t=Date.now()/1000-300;require("fs").utimesSync(process.argv[1],t,t)' "$HANDOFF"  # the T2 handoff is now older than any later fire
use_context 720000
rc="$(fire)"; err="$(cat "$TMP/fire.err")"
has "$err" 'T3' && ok "(d) T3 fires at 70% of the 1M window" || bad "(d) no T3 (rc=$rc): $err"
out="$(stop)"
has "$out" '"decision":"block"' && has "$out" 'T3' && ok "(d) T3 fired after a T2 handoff: Stop blocked again" || bad "(d) expected T3 block, got: $out"
node -e 'const t=Date.now()/1000+120;require("fs").utimesSync(process.argv[1],t,t)' "$HANDOFF"
out="$(stop)"
has "$out" "read $HANDOFF 接續" && ok "(d) T3 handoff: read-line printed" || bad "(d) T3 read-line missing: $out"

# (e) subagent never blocked; a subagent PostToolUse never records a fire
reset; use_context 160000; fire >/dev/null
[ -z "$(stop '{"agent_id":"agent-1"}')" ] && ok "(e) subagent Stop never blocked" || bad "(e) subagent was blocked"
reset; use_context 160000
printf '%s' "${PAYLOAD%\}},\"agent_id\":\"agent-1\"}" | node "$BUDGET" >/dev/null 2>&1
[ ! -f "$STATE" ] && [ -z "$(stop)" ] && ok "(e) subagent PostToolUse records no fire" || bad "(e) subagent PostToolUse left state"

# (f) mode off disables the gate
reset; use_context 160000; fire >/dev/null
out="$(AUTOPILOT_CONTEXT_BUDGET_MODE=off stop)"
[ -z "$out" ] && ok "(f) mode off: never blocks" || bad "(f) mode off blocked: $out"

# (g) below every tier: no fire, no block
reset; use_context 20000; fire >/dev/null
[ -z "$(stop)" ] && ok "(g) no fire, no block" || bad "(g) blocked without a fire"

# (h) AUTOPILOT_MODEL_HANDOFF_DIR: the checklist and the gate both use compaction-handoff's modelNotePath
reset; use_context 160000
ALT="$TMP/alt-handoff"; MNP="$ALT/$SID.md"
AUTOPILOT_MODEL_HANDOFF_DIR="$ALT" fire >/dev/null; err="$(cat "$TMP/fire.err")"
has "$err" "$MNP" && ok "(h) checklist names the AUTOPILOT_MODEL_HANDOFF_DIR path" || bad "(h) checklist path differs from modelNotePath: $err"
mkdir -p "$ALT"; printf '# handoff\n' > "$MNP"; node -e 'const t=Date.now()/1000+60;require("fs").utimesSync(process.argv[1],t,t)' "$MNP"
out="$(AUTOPILOT_MODEL_HANDOFF_DIR="$ALT" stop)"
has "$out" "read $MNP 接續" && ok "(h) handoff only in the model-handoff dir: allowed, read-line printed" || bad "(h) gate looked elsewhere: $out"

# (i) live dir and XDG differ: the printed path equals modelNotePath
reset; use_context 160000; rm -rf "$ALT"
ALT_LIVE="$TMP/live2"; mkdir -p "$ALT_LIVE/context"; chmod 0700 "$ALT_LIVE"; cp "$LIVE/context/$SID.json" "$ALT_LIVE/context/"
EXPECT="$(AUTOPILOT_LIVE_DIR="$ALT_LIVE" node -e 'process.stdout.write(require(process.argv[1]).modelNotePath(process.argv[2],{}))' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$SID")"
AUTOPILOT_LIVE_DIR="$ALT_LIVE" fire >/dev/null; err="$(cat "$TMP/fire.err")"
has "$err" "$EXPECT" && ok "(i) checklist path equals modelNotePath under a different live dir" || bad "(i) expected $EXPECT in: $err"

# (j) fleet seat routing: non-PM dispatches to hangar; PM keeps operator relay; failure falls back; second Stop does not re-dispatch
FAKE_FLEET="$TMP/fake-fleet.sh"
FLEET_LOG="$TMP/fleet-calls.log"
cat > "$FAKE_FLEET" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_FLEET_LOG"
if [ "${FAKE_FLEET_EXIT:-0}" -ne 0 ]; then
  echo "simulated hub error" >&2
  exit "${FAKE_FLEET_EXIT}"
fi
echo '{"ok":true,"id":"01M80TESTTASK0000000000001"}'
SH
chmod +x "$FAKE_FLEET"

# (j1) ops seat -> exactly one dispatch to hangar, no operator relay
reset; rm -f "$FLEET_LOG"; use_context 160000; fire >/dev/null; write_handoff
out="$(FLEET_BIN="$FAKE_FLEET" FAKE_FLEET_LOG="$FLEET_LOG" FLEET_ADDRESS="cookys/openclaw/ops--claude" stop)"
calls="$([ -f "$FLEET_LOG" ] && wc -l < "$FLEET_LOG" || echo 0)"
[ "$calls" -eq 1 ] && ok "(j1) ops seat: exactly one fleet dispatch" || bad "(j1) expected 1 dispatch, got $calls"
line="$(cat "$FLEET_LOG" 2>/dev/null || true)"
has "$line" "cookys/openclaw/hangar--claude" && has "$line" "$HANDOFF" && has "$line" "$SID" && ok "(j1) dispatch targets hangar with handoff and sid" || bad "(j1) bad dispatch argv: $line"
has "$out" "轉給操作員" && bad "(j1) block reason still mentions operator relay: $out" || ok "(j1) block reason does not tell model to relay to operator"
has "$out" "01M80TESTTASK0000000000001" && ok "(j1) block reason includes task id" || bad "(j1) block reason missing task id: $out"

# (j4) second Stop after the first -> no second dispatch
out2="$(FLEET_BIN="$FAKE_FLEET" FAKE_FLEET_LOG="$FLEET_LOG" FLEET_ADDRESS="cookys/openclaw/ops--claude" stop)"
calls2="$([ -f "$FLEET_LOG" ] && wc -l < "$FLEET_LOG" || echo 0)"
[ -z "$out2" ] && [ "$calls2" -eq 1 ] && ok "(j4) second Stop is silent and does not re-dispatch" || bad "(j4) out2=$out2 calls2=$calls2"

# (j2) PM seat -> old operator message, zero dispatches
reset; rm -f "$FLEET_LOG"; use_context 160000; fire >/dev/null; write_handoff
out="$(FLEET_BIN="$FAKE_FLEET" FAKE_FLEET_LOG="$FLEET_LOG" FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
calls="$([ -f "$FLEET_LOG" ] && wc -l < "$FLEET_LOG" || echo 0)"
[ "$calls" -eq 0 ] && has "$out" "read $HANDOFF 接續" && has "$out" "轉給操作員" && ok "(j2) PM seat keeps operator relay with zero dispatches" || bad "(j2) calls=$calls out=$out"

# (j3) fake fleet exits 1 -> fallback operator message plus failure line
reset; rm -f "$FLEET_LOG"; use_context 160000; fire >/dev/null; write_handoff
out="$(FLEET_BIN="$FAKE_FLEET" FAKE_FLEET_LOG="$FLEET_LOG" FAKE_FLEET_EXIT=1 FLEET_ADDRESS="cookys/openclaw/ops--claude" stop)"
has "$out" "read $HANDOFF 接續" && has "$out" "轉給操作員" && has "$out" "simulated hub error" && ok "(j3) fleet failure falls back to operator relay with failure reason" || bad "(j3) out=$out"

# (j5) hangar--claude seat -> exactly one dispatch to ops--claude (not hangar--claude as target), no operator relay
reset; rm -f "$FLEET_LOG"; use_context 160000; fire >/dev/null; write_handoff
out="$(FLEET_BIN="$FAKE_FLEET" FAKE_FLEET_LOG="$FLEET_LOG" FLEET_ADDRESS="cookys/openclaw/hangar--claude" stop)"
calls="$([ -f "$FLEET_LOG" ] && wc -l < "$FLEET_LOG" || echo 0)"
line="$(cat "$FLEET_LOG" 2>/dev/null || true)"
[ "$calls" -eq 1 ] && has "$line" "dispatch cookys/openclaw/ops--claude " && ! has "$line" "dispatch cookys/openclaw/hangar--claude " && ok "(j5) hangar--claude dispatches to ops--claude (not hangar--claude)" || bad "(j5) calls=$calls line=$line"
has "$out" "轉給操作員" && bad "(j5) block reason mentions operator relay: $out" || ok "(j5) block reason does not tell model to relay to operator"

# (j6) ops--claude seat -> one dispatch to hangar--claude explicitly
reset; rm -f "$FLEET_LOG"; use_context 160000; fire >/dev/null; write_handoff
out="$(FLEET_BIN="$FAKE_FLEET" FAKE_FLEET_LOG="$FLEET_LOG" FLEET_ADDRESS="cookys/openclaw/ops--claude" stop)"
calls="$([ -f "$FLEET_LOG" ] && wc -l < "$FLEET_LOG" || echo 0)"
line="$(cat "$FLEET_LOG" 2>/dev/null || true)"
[ "$calls" -eq 1 ] && has "$line" "dispatch cookys/openclaw/hangar--claude " && ! has "$line" "dispatch cookys/openclaw/ops--claude " && ok "(j6) ops--claude dispatches to hangar--claude" || bad "(j6) calls=$calls line=$line"

# (j7) no FLEET_BIN and no fleet on PATH: the dispatch still finds $HOME/.local/bin/fleet (hook PATH often lacks it)
reset; rm -f "$FLEET_LOG"; use_context 160000; fire >/dev/null; write_handoff
mkdir -p "$TMP/home/.local/bin" "$TMP/pathbin"; cp "$FAKE_FLEET" "$TMP/home/.local/bin/fleet"; ln -sf "$(command -v node)" "$TMP/pathbin/node"
out="$(env -u FLEET_BIN PATH="$TMP/pathbin:/usr/bin:/bin" FAKE_FLEET_LOG="$FLEET_LOG" FLEET_ADDRESS="cookys/openclaw/ops--claude" bash -c 'printf "%s" "$0" | node "$1" 2>/dev/null' "$STOP_PAYLOAD" "$GATE")"
calls="$([ -f "$FLEET_LOG" ] && wc -l < "$FLEET_LOG" || echo 0)"
[ "$calls" -eq 1 ] && ! has "$out" "no fleet binary" && ok "(j7) dispatch found fleet under HOME/.local/bin without FLEET_BIN" || bad "(j7) calls=$calls out=$out"
rm -rf "$TMP/home/.local/bin/fleet"

# (k) t2_hard_block default is false (capped at 2 blocks for PM seat); explicit true enables unlimited blocks
reset; rm -f "$TMP/home/.autopilot/config.json"; use_context 160000; fire >/dev/null
o1="$(FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
o2="$(FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
o3="$(FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
has "$o1" '"decision":"block"' && has "$o2" '"decision":"block"' && [ -z "$o3" ] && ok "(k1) PM seat with default t2_hard_block=false caps at 2 blocks" || bad "(k1) expected 2 blocks then allow: [$o1] [$o2] [$o3]"

reset; mkdir -p "$TMP/home/.autopilot"
printf '{"context_budget":{"t2_hard_block":true}}\n' > "$TMP/home/.autopilot/config.json"
use_context 160000; fire >/dev/null
h1="$(FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
h2="$(FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
h3="$(FLEET_ADDRESS="cookys/testhost/pm--claude" stop)"
rm -f "$TMP/home/.autopilot/config.json"
has "$h1" '"decision":"block"' && has "$h2" '"decision":"block"' && has "$h3" '"decision":"block"' && ok "(k2) PM seat with explicit t2_hard_block:true blocks 3+ times" || bad "(k2) expected 3 blocks: [$h1] [$h2] [$h3]"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { echo "PASS [context-land-gate]"; exit 0; }
echo "FAIL [context-land-gate]"; exit 1
