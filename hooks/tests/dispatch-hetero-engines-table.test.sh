#!/usr/bin/env bash
# Capacity table admission at dispatch selection; all runners and tables are fixtures.
. "$(dirname "$0")/lib.sh"
TEST_NAME=dispatch-hetero-engines-table
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_TEST_CN_GATE_OFF=1 AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"free":0,"draining":false}'\''' # Prevent inherited host endpoint dispatches in this suite.
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$TEST_TMP/capability"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$ENGINE_CAPABILITY_DIR"

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.md"; printf 'edit fixture\n' > "$PROMPT"
cat > "$TEST_TMP/bin/grok" <<'SH'
#!/usr/bin/env bash
printf 'grok %s\n' "$*" >> "$RUNNER_CALLS"
echo changed > change.txt; git add change.txt; git -c user.email=t@t -c user.name=t commit -q -m change
SH
cat > "$TEST_TMP/bin/agy" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then echo 'agy 1.1.10'; exit 0; fi
if [ "${1:-}" = "models" ]; then printf 'gemini-4-hydrogen-low\tHydrogen\n'; exit 0; fi
printf 'agy %s\n' "$*" >> "$RUNNER_CALLS"
echo changed > change.txt; git add change.txt; git -c user.email=t@t -c user.name=t commit -q -m change
printf '%s\n' '{"event":"result","result":{"status":"SUCCESS","response":"ok"}}'
SH
chmod +x "$TEST_TMP/bin/grok" "$TEST_TMP/bin/agy"
cat > "$TEST_TMP/bin/claude" <<'SH'
#!/usr/bin/env bash
printf 'claude-stub %s\n' "$*" >> "$RUNNER_CALLS"
echo changed > change.txt; git add change.txt; git -c user.email=t@t -c user.name=t commit -q -m change
printf '%s\n' '{"type":"result","is_error":false,"result":"ok"}'
SH
chmod +x "$TEST_TMP/bin/claude"
export RUNNER_CALLS="$TEST_TMP/runner-calls"

fresh_table() {
  node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.engines/1",generated_at:new Date().toISOString(),engines:JSON.parse(process.argv[2])}))' "$1" "$2"
}
burn_table() {
  node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.burn_more/1",engines:[{engine:"kimi"}]}))' "$1"
}
run_case() {
  local name="$1" table="$2" pace="$3"; shift 3
  local runs="$TEST_TMP/runs-$name"; mkdir -p "$runs"
  OUT="$(cd "$SBX" && env AUTOPILOT_PACE_FILE="$pace" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" AUTOPILOT_ENGINES_TABLE="$table" AUTOPILOT_BURN_MORE="$TEST_TMP/burn.json" \
    "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$TEST_TMP/bin/grok" --agy-bin "$TEST_TMP/bin/agy" \
    --branch "feat/table-$name" --prompt-file "$PROMPT" "$@" </dev/null 2>"$TEST_TMP/$name.err")"
  RC=$?
  ERR="$(cat "$TEST_TMP/$name.err")"
  MF="$(node -e 'const fs=require("fs"),p=process.argv[1];function walk(d){for(const n of fs.readdirSync(d,{withFileTypes:true})){const f=d+"/"+n.name;if(n.isDirectory()){const x=walk(f);if(x)return x}else if(n.name.endsWith(".manifest.json"))return f}return ""}process.stdout.write(walk(p))' "$runs")"
}
json_get() { node -e 'const s=String(process.argv[1]||"");const o=JSON.parse(s.split(/\r?\n/).reverse().find(x=>x.trim().startsWith("{")));process.stdout.write(String(o[process.argv[2]]??"null"))' "$1" "$2"; }
manifest_field() { node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(o[process.argv[2]]??""))' "$1" "$2"; }

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TABLE="$TEST_TMP/engines.json"; BURN="$TEST_TMP/burn.json"; burn_table "$BURN"
PACE="$TEST_TMP/pace.json"
node -e 'const fs=require("fs"),d=new Date().toISOString();fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.pace/1",generated_at:d,rows:[{pool:"agy",class:"other",stale:false,used_pct:5,expected_pct:40,hours_to_reset:24},{pool:"grok-cli",class:"other",stale:false,used_pct:30,expected_pct:40,hours_to_reset:24},{pool:"glm",class:"other",stale:false,used_pct:40,expected_pct:40,hours_to_reset:24}]}))' "$PACE"
fresh_table "$TABLE" '[{"harness":"agy","model":"gemini-4-hydrogen-low","availability":"已用完","suggest":"不派"},{"harness":"grok","model":"grok-4.7","availability":"可用","suggest":"派"},{"harness":"cc-shim","model":"glm-5.3","availability":"暫停","suggest":"不派"},{"harness":"kimi","model":"kimi-code/kimi-for-coding","availability":"可用","suggest":"建議多用"}]'

# (a) Spent agy is skipped and the next implicit candidate is called; decision is logged and manifested.
: > "$RUNNER_CALLS"
run_case agy-spent "$TABLE" "$PACE"
assert_eq 0 "$RC" 'a: dispatch exits 0 after spent candidate'
assert_eq grok "$(json_get "$OUT" runner)" 'a: next candidate selected'
assert_contains "$ERR" 'skipped agy:gemini-4-hydrogen-low (capacity:已用完/不派)' 'a: skipped row logged'
assert_contains "$(cat "$MF")" '"engine_preflight"' 'a: manifest carries engine_preflight'
assert_contains "$(cat "$MF")" '"chosen":{"runner":"grok","model":"grok-4.7"}' 'a: manifest records chosen fallback'
LOG_PATH="$(printf '%s\n' "$ERR" | sed -n 's/.* log=\([^ ]*\) .*/\1/p' | tail -1)"
assert_file_exists "$LOG_PATH" 'a: dispatch log path exists'
assert_contains "$(cat "$LOG_PATH")" 'engine-preflight:' 'a: preflight line reaches dispatch log'

# (a2) Dispatch-level preflight falls through a spent pace candidate to the next rung.
cat > "$TEST_TMP/bin/node" <<'SH'
#!/usr/bin/env bash
if [ "${1:-}" = "$REPO_ROOT/scripts/pace-select.js" ]; then
  printf '%s\n' 'agy' 'gemini-4-hydrogen-low' '' '{"runner":"agy","model":"gemini-4-hydrogen-low","effort":"high","ranked_candidates":[{"runner":"agy","model":"gemini-4-hydrogen-low"},{"runner":"grok","model":"grok-4.7"}]}' '{}'
  exit 0
fi
exec "$REAL_NODE" "$@"
SH
chmod +x "$TEST_TMP/bin/node"
export REPO_ROOT REAL_NODE="$(command -v node)"
LOCAL_PACE_RUNS="$TEST_TMP/runs-local-first"; mkdir -p "$LOCAL_PACE_RUNS"
: > "$RUNNER_CALLS"
LOCAL_TABLE="$TEST_TMP/local-first-engines.json"
fresh_table "$LOCAL_TABLE" '[{"harness":"agy","model":"gemini-4-hydrogen-low","availability":"已用完","suggest":"不派"},{"harness":"grok","model":"grok-4.7","availability":"可用","suggest":"派"}]'
OUT="$( (export PATH="$TEST_TMP/bin:$PATH"; cd "$SBX" && env AUTOPILOT_PACE_FILE="$PACE" AUTOPILOT_DISPATCH_RUNS_DIR="$LOCAL_PACE_RUNS" AUTOPILOT_ENGINES_TABLE="$LOCAL_TABLE" AUTOPILOT_BURN_MORE="$BURN" \
  ANTHROPIC_COMPATIBLE_BASE_URL=https://example.invalid ANTHROPIC_COMPATIBLE_AUTH_TOKEN=test-token \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$TEST_TMP/bin/grok" --agy-bin "$TEST_TMP/bin/agy" \
  --branch feat/table-local-first --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/local-first.err") )"
RC=$?
MF="$(node -e 'const fs=require("fs"),p=process.argv[1];function walk(d){for(const n of fs.readdirSync(d,{withFileTypes:true})){const f=d+"/"+n.name;if(n.isDirectory()){const x=walk(f);if(x)return x}else if(n.name.endsWith(".manifest.json"))return f}return ""}process.stdout.write(walk(p))' "$LOCAL_PACE_RUNS")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).engine_preflight.chosen.runner)' "$MF")" grok 'a2: pace-ranked fallback rung is chosen after spent agy'
LOCAL_LOG_PATH="$(manifest_field "$MF" log_path)"
assert_contains "$(cat "$LOCAL_LOG_PATH")" 'engine-preflight:' 'a2: local-first preflight result reaches dispatch log'

# (b) The separate implementer retreat ladder skips the paused local GLM row.
PAUSED="$(node -e 'const fs=require("fs"),p=process.argv[1];fs.writeFileSync(p,JSON.stringify({schema:"capacity.engines/1",generated_at:new Date().toISOString(),engines:[{harness:"xl270d",model:"Qwen3.8-27B-QUASAR-NVFP4",availability:"暫停",suggest:"不派"}]}))' "$TEST_TMP/paused.json"; printf '[{"runner":"xl270d","model":"Qwen3.8-27B-QUASAR-NVFP4","endpoint":"glm_local"},{"runner":"grok","model":"grok-4.7"}]')"
OUT_PAUSED="$(AUTOPILOT_ENGINES_TABLE="$TEST_TMP/paused.json" AUTOPILOT_BURN_MORE="$BURN" node "$REPO_ROOT/scripts/lib/engine-preflight.js" --fallback-on-all-skipped --candidates-json "$PAUSED" 2>/dev/null)"
assert_contains "$OUT_PAUSED" 'capacity:暫停/不派' 'b: paused local host is skipped'
assert_contains "$OUT_PAUSED" '"runner":"grok"' 'b: next fallback rung selected'

# (c) Burn-more candidate wins among cloud choices while local-first remains ahead for mechanical work.
PREF='[{"runner":"grok","model":"grok-4.7"},{"runner":"kimi","model":"kimi-code/kimi-for-coding"}]'
OUT_PREF="$(AUTOPILOT_ENGINES_TABLE="$TABLE" AUTOPILOT_BURN_MORE="$TEST_TMP/burn.json" node "$REPO_ROOT/scripts/lib/engine-preflight.js" --prefer-burn-more --candidates-json "$PREF")"
assert_eq kimi "$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).chosen.runner)' "$OUT_PREF")" 'c: burn-more candidate chosen before non-burn cloud candidate'
LOCAL_PREF='[{"runner":"grok","model":"grok-4.7"},{"runner":"kimi","model":"kimi-code/kimi-for-coding"},{"runner":"cc-shim","model":"Qwen3.8-27B-QUASAR-NVFP4","endpoint":"glm_local"}]'
OUT_LOCAL="$(AUTOPILOT_ENGINES_TABLE="$TABLE" AUTOPILOT_BURN_MORE="$TEST_TMP/burn.json" node "$REPO_ROOT/scripts/lib/engine-preflight.js" --prefer-burn-more --local-first --candidates-json "$LOCAL_PREF")"
assert_contains "$OUT_LOCAL" '"runner":"cc-shim"' 'c: local GLM endpoint remains first for mechanical selection'

# (d) Missing table preserves candidate order, emits one warning, and exits 0.
: > "$RUNNER_CALLS"
run_case missing "$TEST_TMP/no-table.json" "$PACE"
assert_eq 0 "$RC" 'd: missing table fails open'
assert_eq 1 "$(printf '%s\n' "$ERR" | rg -c '^engine-preflight: capacity table missing, using default order')" 'd: one missing warning'

# (d2) A malformed table is ignored with a distinct warning, never reported as missing.
printf '%s\n' '{not json' > "$TEST_TMP/unparseable.json"
run_case unparseable "$TEST_TMP/unparseable.json" "$PACE"
assert_eq 0 "$RC" 'd2: unparseable table fails open'
assert_eq 1 "$(printf '%s\n' "$ERR" | rg -c '^engine-preflight: capacity table unparseable, using default order')" 'd2: unparseable warning is explicit'

# (e) Stale table does the same.
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.engines/1",generated_at:"2000-01-01T00:00:00Z",engines:[]}))' "$TEST_TMP/stale.json"
run_case stale "$TEST_TMP/stale.json" "$PACE"
assert_eq 0 "$RC" 'e: stale table fails open'
assert_eq 1 "$(printf '%s\n' "$ERR" | rg -c '^engine-preflight: capacity table stale, using default order')" 'e: one stale warning'

# (f) Explicit --runner agy bypasses capacity admission.
: > "$RUNNER_CALLS"
run_case explicit "$TABLE" "$PACE" --runner agy
assert_eq 0 "$RC" 'f: explicit spent runner still dispatches'
assert_eq agy "$(json_get "$OUT" runner)" 'f: explicit agy remains chosen'
assert_not_contains "$ERR" 'engine-preflight:' 'f: explicit runner bypasses preflight'

# (g) A failed local endpoint probe retreats through the pace-ranked ladder and logs engine preflight.
cat > "$TEST_TMP/bin/node" <<'SH'
#!/usr/bin/env bash
exec "$REAL_NODE" "$@"
SH
chmod +x "$TEST_TMP/bin/node"
FALLBACK_PORT="$TEST_TMP/fallback.port"
node - "$FALLBACK_PORT" <<'NODE' >/dev/null 2>&1 &
const http=require('http'),fs=require('fs'),portFile=process.argv[2];
const server=http.createServer((req,res)=>{res.writeHead(404);res.end('{}');});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(portFile,String(server.address().port)));
NODE
FALLBACK_SERVER_PID=$!
for _i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$FALLBACK_PORT" ] && break; sleep 0.1; done
FALLBACK_URL="http://127.0.0.1:$(cat "$FALLBACK_PORT")"
FALLBACK_RUNS="$TEST_TMP/runs-endpoint-fallback"; mkdir -p "$FALLBACK_RUNS"
FALLBACK_TABLE="$TEST_TMP/endpoint-fallback-engines.json"
fresh_table "$FALLBACK_TABLE" '[{"harness":"agy","model":"gemini-4-hydrogen-low","availability":"已用完","suggest":"不派"},{"harness":"cc-shim","model":"glm-5.3","availability":"暫停","suggest":"不派"},{"harness":"grok","model":"grok-4.7","availability":"可用","suggest":"派"}]'
: > "$RUNNER_CALLS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" \
  AUTOPILOT_ENDPOINT_PREPROBE=on ANTHROPIC_COMPATIBLE_BASE_URL="$FALLBACK_URL" ANTHROPIC_COMPATIBLE_AUTH_TOKEN=test-token \
  AUTOPILOT_PACE_FILE="$PACE" AUTOPILOT_DISPATCH_RUNS_DIR="$FALLBACK_RUNS" \
  AUTOPILOT_ENGINES_TABLE="$FALLBACK_TABLE" AUTOPILOT_BURN_MORE="$BURN" \
  "$SCRIPT" --no-verify-tip --context-window off --runner cc-shim --endpoint test --model fixture-model --effort high \
  --grok-bin "$TEST_TMP/bin/grok" --branch feat/table-endpoint-fallback --prompt-file "$PROMPT" \
  </dev/null 2>"$TEST_TMP/endpoint-fallback.err")"
RC=$?
kill "$FALLBACK_SERVER_PID" 2>/dev/null || true
wait "$FALLBACK_SERVER_PID" 2>/dev/null || true
LOG="$TEST_TMP/endpoint-fallback.err"
FALLBACK_ERR="$(cat "$LOG")"
assert_eq 0 "$RC" 'g: unreachable local endpoint falls back successfully'
assert_eq grok "$(json_get "$OUT" runner)" 'g: first capacity-allowed pace-ranked rung is grok'
assert_contains "$(cat "$LOG")" 'engine-preflight:' 'g: fallback ladder preflight reaches captured dispatch log'

finalize_test
