#!/usr/bin/env bash
unset AUTOPILOT_TOKEN_SEAT
# Implementer dispatch defaults to the local qwen seat.
# Red on a dispatch-hetero.sh that still sends an omitted --runner to grok.
# Stub claude / stub grok only. No live CLI and no HTTP endpoint.
. "$(dirname "$0")/lib.sh"

TEST_NAME="dispatch-hetero-local-default"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
export AUTOPILOT_LOCAL_SLOT_RR_FILE="$TEST_TMP/local-slot-rr.json"
export AUTOPILOT_ENDPOINT_PREPROBE=off
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN=fake-test-token
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '"'"'{"free":1,"draining":false}'"'"''
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
LEASE_STATUS_FILE="$TEST_TMP/lease-status"
LEASE_LOG="$TEST_TMP/lease-requests.jsonl"
GATE_LOG="$TEST_TMP/cn-gate-requests.jsonl"
printf '201\n' > "$LEASE_STATUS_FILE"
LEASE_BUSY_FILE="$TEST_TMP/lease-endpoint-busy"
LEASE_PORT_FILE="$TEST_TMP/lease.port"
node - "$LEASE_STATUS_FILE" "$LEASE_LOG" "$LEASE_PORT_FILE" "$LEASE_BUSY_FILE" <<'NODE' >/dev/null 2>&1 &
const http = require('http'), fs = require('fs');
const [statusFile, logFile, portFile, busyFile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  const chunks=[]; req.on('data', c=>chunks.push(c)); req.on('end', ()=>{
    fs.appendFileSync(logFile, JSON.stringify({method:req.method,url:req.url})+'\n');
    if (req.method === 'GET' && req.url === '/v1/models' && fs.readFileSync(busyFile,'utf8').trim() === 'busy') { res.writeHead(503); res.end(); return; }
    if (req.method === 'POST' && req.url === '/v1/local/lease') {
      const status = Number(fs.readFileSync(statusFile,'utf8').trim());
      if (status !== 201) { res.writeHead(status); res.end('{}'); return; }
      res.writeHead(201, {'content-type':'application/json'}); res.end(JSON.stringify({lease_id:'test-lease-id',ttl_s:180})); return;
    }
    if (req.method === 'POST' && req.url.endsWith('/heartbeat')) { res.writeHead(200); res.end('{}'); return; }
    if (req.method === 'POST' && req.url === '/v1/messages/count_tokens') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({input_tokens:1})); return; }
    if (req.method === 'POST' && req.url === '/v1/messages') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({id:'stub-message',type:'message',role:'assistant',content:[{type:'text',text:'ok'}],model:'qwen',stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}})); return; }
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    res.writeHead(404); res.end();
  });
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(portFile,String(server.address().port)));
NODE
LEASE_SERVER_PID=$!
cleanup_lease_server() {
  kill "$LEASE_SERVER_PID" 2>/dev/null || true
  wait "$LEASE_SERVER_PID" 2>/dev/null || true
  if [ -n "${F1B_STANDIN_PID:-}" ]; then
    kill "$F1B_STANDIN_PID" 2>/dev/null || true
    wait "$F1B_STANDIN_PID" 2>/dev/null || true
  fi
}
trap cleanup_lease_server EXIT
for _i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$LEASE_PORT_FILE" ] && break; sleep 0.1; done
LEASE_PORT="$(cat "$LEASE_PORT_FILE")"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL="http://127.0.0.1:${LEASE_PORT}/v1"
export AUTOPILOT_ENDPOINT_GLM_LOCAL_URL="http://127.0.0.1:${LEASE_PORT}/v1"
export AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN=fake-test-token
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin"
unset AUTOPILOT_QUALIFICATION_OVERRIDE AUTOPILOT_DISPATCH_ROLE AUTOPILOT_TASK_CLASS 2>/dev/null || true

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
$GIT -C "$SBX" init -q
$GIT -C "$SBX" commit -q --allow-empty -m base

STUB_CLAUDE="$TEST_TMP/bin/claude"
cat > "$STUB_CLAUDE" <<'EOF'
#!/usr/bin/env bash
cat > got-prompt.txt
pwd > worktree-pwd.txt
printf '%s\n' "$@" > local-argv.txt
[ -z "${LEASE_WORKER_SLEEP:-}" ] || sleep "$LEASE_WORKER_SLEEP"
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOF
chmod +x "$STUB_CLAUDE"

REAL_NODE="$(command -v node)"
cat > "$TEST_TMP/bin/node" <<EOF
#!/usr/bin/env bash
if [[ " \$* " == *"cn-model-dispatch-gate.js check"* ]]; then
  printf '%s\n' "\$*" >> "$GATE_LOG"
  if { [[ " \$* " == *"--runner cc-shim"*"--model qwen"*"prompt-l2.txt"* ]] \
       || [[ " \$* " == *"--runner local"*"--model qwen"*"prompt-l2.txt"* ]]; } \
     || [[ " \$* " == *"--runner cc-shim"*"--model qwen"*"prompt-l3.txt"* ]]; then
    echo 'cn_model_dispatch_barred alibaba local_name_external_host (01M7E2A1, d-1dfcf757)' >&2
    exit 3
  fi
fi
exec "$REAL_NODE" "\$@"
EOF
chmod +x "$TEST_TMP/bin/node"

STUB_GROK="$TEST_TMP/grok"
cat > "$STUB_GROK" <<'EOF'
#!/usr/bin/env bash
case " $* " in
  *" __autopilot_probe__ "*)
    echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2
    exit 2 ;;
esac
if [ "${1:-}" = "--version" ]; then echo "grok-cli 0.2.111 (test stub)"; exit 0; fi
printf '%s\n' "$@" > "$GROK_ARGV"
pwd > "${GROK_WT_PWD:-/tmp/grok-wt-pwd}"
printf 'grok fixture\n' >> impl-defaults-fixture.txt
EOF
chmod +x "$STUB_GROK"
export GROK_ARGV="$TEST_TMP/grok.argv"
export GROK_WT_PWD="$TEST_TMP/grok-wt-pwd"

json_get() {
  node -e '
    const lines = String(process.argv[1] || "").split(/\r?\n/).reverse();
    const raw = lines.find((l) => l.trim().startsWith("{"));
    if (!raw) { process.stdout.write("<no-json>"); process.exit(0); }
    const o = JSON.parse(raw); const k = process.argv[2];
    if (!(k in o)) process.stdout.write("<absent>");
    else process.stdout.write(o[k] === null ? "<null>" : String(o[k]));
  ' "$1" "$2"
}

manifest_in() {
  node -e '
    const fs = require("fs"), path = require("path");
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(file) : (entry.name.endsWith(".manifest.json") ? [file] : []);
    });
    process.stdout.write(walk(process.argv[1])[0] || "");
  ' "$1"
}

run_local() {
  local tag="$1"; shift
  local runs="$TEST_TMP/runs-$tag"
  mkdir -p "$runs"
  OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-}" AUTOPILOT_ENDPOINT_GLM_LOCAL_URL="$AUTOPILOT_ENDPOINT_GLM_LOCAL_URL" AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN="$AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN" \
    "$SCRIPT" --no-verify-tip --context-window off \
    --branch "feat/local-$tag" --prompt-file "$PROMPT" "$@" </dev/null 2>"$TEST_TMP/$tag.err")"
  EXIT=$?
  ERR="$(cat "$TEST_TMP/$tag.err" 2>/dev/null || true)"
  MF="$(manifest_in "$runs")"
}

# (a2) A free GLM slot wins before a fixture that otherwise selects codex; gate and manifest carry GLM.
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"endpoints":[{"id":"qwen-a","state":"up","free":0},{"id":"glm-a","models":["GLM-4"],"state":"up","free":1}]}'\'''
PROMPT="$TEST_TMP/prompt-a2.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nSize: S\nRole: implementer\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local a2
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (a2): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "a2: GLM fallback exits 0"
assert_eq "glm" "$(json_get "$OUT" model)" "a2: result model is glm"
assert_file_exists "$MF" "a2: GLM manifest written"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).endpoint||"")' "$MF")" "glm_local" "a2: manifest endpoint is glm_local"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).model||"")' "$MF")" "glm" "a2: manifest model is glm"
assert_contains "$(cat "$LEASE_LOG")" '"url":"/v1/local/lease"' "a2: GLM slot goes through lease"
assert_contains "$(cat "$GATE_LOG")" '--model glm --endpoint glm_local' "a2: CN gate receives selected GLM model and endpoint"

# (a2rr) Equal local capacity rotates away from the previously selected Qwen backend.
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"endpoints":[{"id":"qwen-a","state":"up","free":2},{"id":"glm-a","models":["GLM-4"],"state":"up","free":2}]}'\'''
printf '{"family":"qwen"}\n' > "$AUTOPILOT_LOCAL_SLOT_RR_FILE"
PROMPT="$TEST_TMP/prompt-a2rr.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nSize: S\nRole: implementer\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
: > "$GATE_LOG"
run_local a2rr
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (a2rr): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "a2rr: tied local slots dispatch successfully"
assert_eq "glm" "$(json_get "$OUT" model)" "a2rr: prior Qwen choice rotates unpinned run to GLM"
assert_contains "$(cat "$GATE_LOG")" '--model glm --endpoint glm_local' "a2rr: CN gate receives tie-selected GLM"
TIE_CHECK_RR="$TEST_TMP/tie-check-rr.json"
printf '{"family":"qwen"}\n' > "$TIE_CHECK_RR"
TIE_DECISION="$(node - "$TIE_CHECK_RR" <<'NODE'
const slots = require('./scripts/lib/local-impl-slot');
const env = { ...process.env,
  AUTOPILOT_LOCAL_SLOT_RR_FILE: process.argv[2],
  AUTOPILOT_LOCAL_SLOTS_CMD: `printf '%s' '${JSON.stringify({ endpoints: [
    { id: 'qwen-a', state: 'up', free: 2 },
    { id: 'glm-a', models: ['GLM-4'], state: 'up', free: 2 },
  ] })}'`,
};
slots.acquireLocalSlot({ env, cfg: {} }).then((decision) => console.log(JSON.stringify(decision)));
NODE
)"
assert_contains "$TIE_DECISION" '"family":"glm"' "a2rr: tie selector chooses GLM after Qwen"
assert_contains "$TIE_DECISION" '"pick_reason":"tie_round_robin"' "a2rr: tie selector reports tie_round_robin"

export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"free":1,"draining":false}'\'''

# (a) implementer, no --runner -> manifest runner local, model qwen.
PROMPT="$TEST_TMP/prompt-a.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nSize: S\nRole: implementer\nScope: ok.txt\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local a
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (a): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "a: implementer with no --runner exits 0"
assert_eq "2" "$(git -C "$SBX" rev-list --parents -n1 feat/local-a | wc -w | tr -d ' ')" "a: non-scratch commit retains its base parent"
assert_not_contains "$(cat "$TEST_TMP/a.err")" 'engine-preflight:' "a: a free local slot bypasses cloud preflight"
assert_eq "local" "$(json_get "$OUT" runner)" "a: result runner is local"
assert_eq "qwen" "$(json_get "$OUT" model)" "a: result model is qwen"
assert_file_exists "$MF" "a: manifest written"
assert_eq "local" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runner)' "$MF")" "a: manifest runner is local"
assert_eq "qwen" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).model)' "$MF")" "a: manifest model is qwen"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).effort||"")' "$MF")" "medium" "a: implicit local manifest sends medium effort"
LOCAL_ARGV_A="$(git -C "$SBX" show "feat/local-a:local-argv.txt")"
assert_contains "$LOCAL_ARGV_A" "--effort" "a: local stub receives an explicit effort argument"
assert_contains "$LOCAL_ARGV_A" "medium" "a: local stub receives medium effort"
assert_eq "<null>" "$(json_get "$OUT" local_fallback)" "a: local choice records local_fallback null"
assert_eq "null" "$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).local_fallback; process.stdout.write(v===null?"null":JSON.stringify(v))' "$MF")" "a: manifest local_fallback is null"
assert_contains "$(cat "$GATE_LOG")" '--model qwen --endpoint qwen_local' "a: CN gate receives selected Qwen model and endpoint"

# (a3) Local runner explicitly rejects effort values unsupported by the gateway.
RUNS="$TEST_TMP/runs-a3"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --runner local --pin-reason "test fixture" --model qwen --effort high \
  --branch feat/local-a3 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/a3.err")"
EXIT=$?
assert_neq "0" "$EXIT" "a3: explicit local high effort fails precondition"
assert_contains "$OUT" "low|medium|xhigh" "a3: error names supported local effort set"
assert_contains "$OUT" '"status": "precondition_failed"' "a3: high effort fails before runner dispatch"
# (a3b) An unpinned high-effort request releases its acquired lease before refusal.
printf '201\n' > "$LEASE_STATUS_FILE"; : > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-a3b"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --effort high \
  --branch feat/local-a3b --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/a3b.err")"
EXIT=$?
assert_eq "2" "$EXIT" "a3b: unpinned explicit high effort exits precondition"
assert_contains "$OUT" "low|medium|xhigh" "a3b: error names supported local effort set"
assert_contains "$(cat "$LEASE_LOG")" '"method":"DELETE","url":"/v1/local/lease/test-lease-id"' "a3b: acquired lease is released"
RUNS="$TEST_TMP/runs-a3max"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --runner local --pin-reason "test fixture" --model qwen --effort max \
  --branch feat/local-a3max --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/a3max.err")"
EXIT=$?
assert_eq "2" "$EXIT" "a3: explicit local max effort exits precondition"
assert_contains "$OUT" '"status": "precondition_failed"' "a3: max effort fails before runner dispatch"

# (a4) An invalid Fleet-Task skips lease POST, records its reason and falls back to pace-select.
PROMPT="$TEST_TMP/prompt-a4.txt"; printf 'Fleet-Task: 12345678\nedit impl-defaults-fixture.txt\n' > "$PROMPT"
: > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-a4"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-a4 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/a4.err")"
EXIT=$?
assert_eq "0" "$EXIT" "a4: invalid Fleet-Task falls back successfully"
FB_A4="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\r?\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")"
assert_contains "$FB_A4" '"reason":"fleet_task_invalid"' "a4: invalid task fallback reason"
assert_contains "$FB_A4" '"detail":"fleet_task=12345678"' "a4: invalid task fallback detail"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "a4: invalid task skips lease request"
assert_contains "$(cat "$TEST_TMP/a4.err")" "Fleet-Task '12345678'" "a4: invalid task diagnostic names the raw value"
assert_contains "$(cat "$TEST_TMP/a4.err")" "write the full task id in the brief" "a4: invalid task diagnostic"

# (a5) No Fleet-Task line is treated as missing and skips the lease POST.
PROMPT="$TEST_TMP/prompt-a5.txt"; printf 'edit impl-defaults-fixture.txt\n' > "$PROMPT"
: > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-a5"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-a5 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/a5.err")"
EXIT=$?
assert_eq "0" "$EXIT" "a5: missing Fleet-Task falls back successfully"
FB_A5="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\r?\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")"
assert_contains "$FB_A5" '"reason":"fleet_task_missing"' "a5: missing task fallback reason"
assert_contains "$FB_A5" '"detail":"fleet_task_missing"' "a5: missing task fallback detail"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "a5: missing task skips lease request"

# (b) local, no Task-Class line -> dispatched prompt stays unchanged; caller file unchanged.
PROMPT="$TEST_TMP/prompt-b.txt"
printf 'edit only this line\n' > "$PROMPT"
BEFORE="$(sha256sum "$PROMPT" | awk '{print $1}')"
run_local b --runner local --pin-reason "test fixture" --model qwen
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (b): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "b: local with no Task-Class exits 0"
AFTER="$(sha256sum "$PROMPT" | awk '{print $1}')"
assert_eq "$BEFORE" "$AFTER" "b: caller prompt file is unchanged"
SHA_B="$(git -C "$SBX" rev-parse "feat/local-b")"
DISPATCHED="$(git -C "$SBX" show "${SHA_B}:got-prompt.txt")"
assert_contains "$DISPATCHED" "edit only this line" "b: dispatched prompt contains caller text"
assert_not_contains "$DISPATCHED" "Task-Class: simple-script" "b: gate adds no Task-Class metadata"

# (b2) body prose naming Task-Class passes through unchanged. Caller file stays unchanged.
PROMPT="$TEST_TMP/prompt-b2.txt"
{
  printf 'edit only this line\n'
  i=2
  while [ "$i" -le 19 ]; do
    printf 'filler %s\n' "$i"
    i=$((i + 1))
  done
  printf 'please add a Task-Class: header\n'
} > "$PROMPT"
BEFORE="$(sha256sum "$PROMPT" | awk '{print $1}')"
run_local b2 --runner local --pin-reason "test fixture" --model qwen
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (b2): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "b2: body mention of Task-Class exits 0"
AFTER="$(sha256sum "$PROMPT" | awk '{print $1}')"
assert_eq "$BEFORE" "$AFTER" "b2: caller prompt file is unchanged"
SHA_B2="$(git -C "$SBX" rev-parse "feat/local-b2")"
DISPATCHED="$(git -C "$SBX" show "${SHA_B2}:got-prompt.txt")"
assert_contains "$DISPATCHED" "please add a Task-Class: header" "b2: dispatched prompt preserves body prose"
assert_not_contains "$DISPATCHED" "Task-Class: simple-script" "b2: gate adds no Task-Class metadata"

# (c) local, no --worktree-parent -> worktree is outside the repo root.
XDG_RUNTIME_DIR="$(mktemp -d /tmp/local-default-xdg.XXXXXX)"
chmod 700 "$XDG_RUNTIME_DIR"
PROMPT="$TEST_TMP/prompt-c.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local c --runner local --pin-reason "test fixture" --model qwen
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (c): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "c: local with no --worktree-parent exits 0"
SHA_C="$(git -C "$SBX" rev-parse "feat/local-c")"
WT_C="$(git -C "$SBX" show "${SHA_C}:worktree-pwd.txt" | tr -d '\n')"
REPO_TOP="$(git -C "$SBX" rev-parse --show-toplevel)"
case "$WT_C" in
  "$REPO_TOP"|"$REPO_TOP"/*) fail "c: worktree $WT_C is inside the repo $REPO_TOP" ;;
esac
case "$WT_C" in
  "$XDG_RUNTIME_DIR"/*) ;;
  *) fail "c: worktree $WT_C is not under XDG_RUNTIME_DIR $XDG_RUNTIME_DIR" ;;
esac
PARENT_C="$(dirname "$WT_C")"
assert_eq "$(stat -c '%a' "$PARENT_C")" "700" "c: worktree parent is mode 0700"

# (d) explicit --runner grok still goes to grok.
PROMPT="$TEST_TMP/prompt-d.txt"
printf 'edit impl-defaults-fixture.txt\n' > "$PROMPT"
: > "$GROK_ARGV"
RUNS="$TEST_TMP/runs-d"
mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --runner grok --pin-reason "test fixture" --grok-bin "$STUB_GROK" \
  --branch feat/local-d --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/d.err")"
EXIT=$?
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (d): %s\n%s\n' "$OUT" "$(cat "$TEST_TMP/d.err")" >&2
assert_eq "0" "$EXIT" "d: explicit --runner grok exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "d: result runner is grok"
assert_contains "$(cat "$GROK_ARGV")" "grok-4.7" "d: grok stub received the grok default model"

# (e) no local endpoint configured -> previous unpinned default (grok-4.7), exit 0.
PROMPT="$TEST_TMP/prompt-e.txt"
printf 'edit impl-defaults-fixture.txt\n' > "$PROMPT"
: > "$GROK_ARGV"
RUNS="$TEST_TMP/runs-e"
mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env -u AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL -u AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN \
  -u AUTOPILOT_ENDPOINT_GLM_LOCAL_URL -u AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN \
  AUTOPILOT_ENDPOINTS_ENV=/nonexistent AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-e --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/e.err")"
EXIT=$?
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (e): %s\n%s\n' "$OUT" "$(cat "$TEST_TMP/e.err")" >&2
assert_eq "0" "$EXIT" "e: no local endpoint configured exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "e: no local endpoint uses the grok default"
assert_eq "grok-4.7" "$(json_get "$OUT" model)" "e: no local endpoint model is grok-4.7"
assert_contains "$(cat "$GROK_ARGV")" "grok-4.7" "e: grok stub received grok-4.7"
FB_E="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{"))); process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")"
assert_eq '{"reason":"no_free_slot","detail":"endpoint_not_ready"}' "$FB_E" "e: missing endpoint records endpoint_not_ready"

# (f) successful implicit local run holds a lease and releases it after the worker.
PROMPT="$TEST_TMP/prompt-f.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-f"; mkdir -p "$RUNS"; : > "$LEASE_LOG"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" AUTOPILOT_LOCAL_LEASE_TTL_S=3 LEASE_WORKER_SLEEP=7 \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-f --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/f.err")"
EXIT=$?
[ "$EXIT" -eq 0 ] || printf "lease-f diagnostic: %s\n%s\n" "$OUT" "$(cat "$TEST_TMP/f.err")" >&2
assert_eq "$EXIT" "0" "f: lease-backed implicit local run exits 0"
MF="$(manifest_in "$RUNS")"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.id||"")' "$MF")" "test-lease-id" "f: manifest records lease id"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.released))' "$MF")" "true" "f: manifest records release"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.heartbeats>=2))' "$MF")" "true" "f: heartbeat renews during worker run"
assert_contains "$(cat "$LEASE_LOG")" '"method":"DELETE"' "f: gateway received DELETE"

# (f1) command substitution returns promptly after the worker, without waiting for heartbeat sleep.
PROMPT="$TEST_TMP/prompt-f1.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-f1"; mkdir -p "$RUNS"; : > "$LEASE_LOG"
export TMPDIR="$TEST_TMP"
SLEEP_PID_CAPTURE="$TEST_TMP/f1-heartbeat-sleep-pid"
(
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    for _lease_sleep_file in "$TMPDIR"/autopilot-local-lease-heartbeat-sleep-*; do
      [ -f "$_lease_sleep_file" ] || continue
      [ -s "$_lease_sleep_file" ] && { cat "$_lease_sleep_file" > "$SLEEP_PID_CAPTURE"; exit 0; }
    done
    sleep 0.05
  done
) &
SLEEP_PID_WATCHER=$!
START_NS="$(date +%s%N)"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  AUTOPILOT_LOCAL_LEASE_TTL_S=18 LEASE_WORKER_SLEEP=1 \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-f1 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/f1.err")"
EXIT=$?
ELAPSED_MS=$((($(date +%s%N) - START_NS) / 1000000))
assert_eq "0" "$EXIT" "f1: granted lease command substitution succeeds"
[ "$ELAPSED_MS" -lt 4000 ] && _f1_fast=true || _f1_fast=false
assert_eq "true" "$_f1_fast" "f1: command substitution returns promptly after worker (${ELAPSED_MS}ms)"
wait "$SLEEP_PID_WATCHER" 2>/dev/null || true
F1_SLEEP_PID="$(cat "$SLEEP_PID_CAPTURE" 2>/dev/null || true)"
[ -n "$F1_SLEEP_PID" ] && _f1_sleep_captured=true || _f1_sleep_captured=false
assert_eq "true" "$_f1_sleep_captured" "f1: captured heartbeat sleep pid before release"
if [ -n "$F1_SLEEP_PID" ] && kill -0 "$F1_SLEEP_PID" 2>/dev/null; then _f1_sleep_alive=true; else _f1_sleep_alive=false; fi
assert_eq "false" "$_f1_sleep_alive" "f1: heartbeat sleep pid is no longer alive after dispatch"

# (f1b) a stale sleep-file pid with a non-sleep comm is left alone by release.
PROMPT="$TEST_TMP/prompt-f1b.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-f1b"; mkdir -p "$RUNS"; : > "$LEASE_LOG"
tail -f /dev/null >/dev/null 2>&1 &
F1B_STANDIN_PID=$!
F1B_SLEEP_PID_CAPTURE="$TEST_TMP/f1b-heartbeat-sleep-pid"
(
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    for _lease_sleep_file in "$TMPDIR"/autopilot-local-lease-heartbeat-sleep-*; do
      [ -f "$_lease_sleep_file" ] || continue
      if [ -s "$_lease_sleep_file" ]; then
        cat "$_lease_sleep_file" > "$F1B_SLEEP_PID_CAPTURE"
        printf '%s\n' "$F1B_STANDIN_PID" > "$_lease_sleep_file"
        exit 0
      fi
    done
    sleep 0.05
  done
) &
F1B_SLEEP_PID_WATCHER=$!
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  AUTOPILOT_LOCAL_LEASE_TTL_S=18 LEASE_WORKER_SLEEP=1 \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-f1b --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/f1b.err")"
EXIT=$?
wait "$F1B_SLEEP_PID_WATCHER" 2>/dev/null || true
assert_eq "0" "$EXIT" "f1b: non-sleep pid lease dispatch succeeds"
F1B_ORIGINAL_SLEEP_PID="$(cat "$F1B_SLEEP_PID_CAPTURE" 2>/dev/null || true)"
[ -n "$F1B_ORIGINAL_SLEEP_PID" ] && _f1b_sleep_captured=true || _f1b_sleep_captured=false
assert_eq "true" "$_f1b_sleep_captured" "f1b: captured the active sleep pid before replacing file"
if kill -0 "$F1B_STANDIN_PID" 2>/dev/null; then _f1b_standin_alive=true; else _f1b_standin_alive=false; fi
assert_eq "true" "$_f1b_standin_alive" "f1b: release leaves a non-sleep pid alive"
[ -z "$F1B_ORIGINAL_SLEEP_PID" ] || kill "$F1B_ORIGINAL_SLEEP_PID" 2>/dev/null || true
kill "$F1B_STANDIN_PID" 2>/dev/null || true
wait "$F1B_STANDIN_PID" 2>/dev/null || true

# (f2) a hard-timeout worker is killed, but its granted lease is still released once.
PROMPT="$TEST_TMP/prompt-f2.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-f2"; mkdir -p "$RUNS"; : > "$LEASE_LOG"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  AUTOPILOT_LOCAL_LEASE_TTL_S=3 AUTOPILOT_HETERO_HARD_TIMEOUT=3 AUTOPILOT_HETERO_SAMPLE_S=1 \
  LEASE_WORKER_SLEEP=15 "$SCRIPT" --no-verify-tip --context-window off \
  --branch feat/local-f2 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/f2.err")"
EXIT=$?
MF="$(manifest_in "$RUNS")"
assert_file_exists "$MF" "f2: timeout writes a manifest"
assert_eq "true" "$(json_get "$OUT" timed_out)" "f2: hard timeout kills the sleeping worker"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.released))' "$MF")" "true" "f2: manifest records release after timeout"
DELETE_COUNT="$(node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse);process.stdout.write(String(rows.filter(r=>r.method==="DELETE"&&r.url==="/v1/local/lease/test-lease-id").length))' "$LEASE_LOG")"
assert_eq "1" "$DELETE_COUNT" "f2: timeout sends exactly one DELETE for the granted lease"

# (g) oversized local context falls back before requesting a lease.
PROMPT="$TEST_TMP/prompt-g.txt"
printf 'Scope: big.bin\nedit\n' > "$PROMPT"
dd if=/dev/zero of="$SBX/big.bin" bs=1000 count=500 status=none
CFG="$TEST_TMP/ctx-config.json"
printf '%s\n' '{"local_context_bytes":100}' > "$CFG"
: > "$GROK_ARGV"; : > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-g"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env AUTOPILOT_CONFIG_FILE="$CFG" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-g --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/g.err")"
EXIT=$?
assert_eq "0" "$EXIT" "g: oversized context exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "g: oversized context uses cloud"
FB_G="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(o.local_fallback.reason)' "$OUT")"
assert_eq "context_too_large" "$FB_G" "g: context_too_large fallback"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "g: oversized context does not grant a lease"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"DELETE"' "g: oversized context has no lease to release"

# (h) a pre-probe 503 triggers the cloud retry and releases the lease before re-exec.
PROMPT="$TEST_TMP/prompt-h.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
printf 'busy\n' > "$LEASE_BUSY_FILE"; : > "$GROK_ARGV"; : > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-h"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env AUTOPILOT_ENDPOINT_PREPROBE=on AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-h --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/h.err")"
EXIT=$?
: > "$LEASE_BUSY_FILE"
assert_eq "$EXIT" "0" "h: pre-probe busy cloud retry exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "h: pre-probe busy retry uses grok"
assert_not_contains "$(cat "$TEST_TMP/h.err")" 'engine-preflight:' "h: busy-at-run re-dispatch is explicitly pinned and skips preflight"
FB_H="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")"
assert_eq '{"reason":"no_free_slot","detail":"busy_at_run"}' "$FB_H" "h: pre-probe busy fallback detail"
DELETE_COUNT="$(node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse);process.stdout.write(String(rows.filter(r=>r.method==="DELETE"&&r.url==="/v1/local/lease/test-lease-id").length))' "$LEASE_LOG")"
assert_eq "1" "$DELETE_COUNT" "h: pre-probe retry releases its granted lease exactly once"

# (h2) a lease denial is no_free_slot and keeps the selection unpinned for pace preflight.
PROMPT="$TEST_TMP/prompt-h2.txt"
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
printf '201\n' > "$LEASE_STATUS_FILE"; : > "$GROK_ARGV"; : > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-h2"; mkdir -p "$RUNS"
H2_PACE="$TEST_TMP/h2-pace.json"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.pace/1",generated_at:new Date().toISOString(),rows:[{pool:"grok-cli",class:"other",stale:false,used_pct:30,expected_pct:40,hours_to_reset:24}]}))' "$H2_PACE"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_PACE_FILE="$H2_PACE" AUTOPILOT_LOCAL_SLOTS_CMD="printf %s '{\"free\":0,\"draining\":false}'" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-h2 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/h2.err")"
EXIT=$?
printf '201\n' > "$LEASE_STATUS_FILE"
assert_eq "0" "$EXIT" "h2: no-free-slot cloud fallback exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "h2: no-free-slot pace selection uses grok"
FB_H2="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")"
assert_contains "$FB_H2" '"reason":"no_free_slot"' "h2: lease denial reports no_free_slot"
assert_contains "$(cat "$TEST_TMP/h2.err")" 'engine-preflight:' "h2: unpinned no-free-slot fallback runs engine preflight"

# (j) local worker reports endpoint busy; dispatch retries on cloud and releases its grant.
cat > "$STUB_CLAUDE" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"type":"result","is_error":true,"terminal_reason":"api_error","result":"API Error: 503 Service Unavailable"}'
exit 1
EOF
chmod +x "$STUB_CLAUDE"
PROMPT="$TEST_TMP/prompt-h.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
: > "$GROK_ARGV"; : > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-j"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" \
  --branch feat/local-j --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/j.err")"
EXIT=$?
assert_eq "0" "$EXIT" "j: busy-at-run cloud retry exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "j: busy-at-run retry uses grok"
FB_J="$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")"
assert_eq '{"reason":"no_free_slot","detail":"busy_at_run"}' "$FB_J" "j: busy-at-run fallback detail"
DELETE_COUNT="$(node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse);process.stdout.write(String(rows.filter(r=>r.method==="DELETE"&&r.url==="/v1/local/lease/test-lease-id").length))' "$LEASE_LOG")"
assert_eq "1" "$DELETE_COUNT" "j: busy-at-run releases its granted lease exactly once"
WT_SAME="$(node -e '
const lines=String(process.argv[1]).split(/\n/).map(l=>l.trim()).filter(l=>l.startsWith("{")).map(JSON.parse);
const local=lines.find(o=>o.status==="engine_unavailable"), cloud=lines[lines.length-1];
process.stdout.write(local&&local.worktree&&cloud&&cloud.worktree_reused===true?"yes":"no");
' "$OUT")"
assert_eq "yes" "$WT_SAME" "j: cloud retry reuses the prepared worktree"
cat > "$STUB_CLAUDE" <<'EOF'
#!/usr/bin/env bash
cat > got-prompt.txt
pwd > worktree-pwd.txt
printf '%s\n' "$@" > local-argv.txt
[ -z "${LEASE_WORKER_SLEEP:-}" ] || sleep "$LEASE_WORKER_SLEEP"
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOF
chmod +x "$STUB_CLAUDE"

# (i) capacity denial falls back to cloud with the lease status detail.
PROMPT="$TEST_TMP/prompt-i.txt"; printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nedit impl-defaults-fixture.txt\n' > "$PROMPT"
printf '429\n' > "$LEASE_STATUS_FILE"; : > "$GROK_ARGV"; : > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-i"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" --branch feat/local-i --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/i.err")"; EXIT=$?
assert_eq "$EXIT" "0" "i: lease 429 cloud fallback exits 0"
assert_eq "$(json_get "$OUT" runner)" "grok" "i: lease 429 selects grok"
assert_contains "$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")" 'lease_429' "i: fallback detail is lease_429"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"DELETE"' "i: denied lease is not released"

# (i2) conflict denial has the documented fallback detail.
printf '409\n' > "$LEASE_STATUS_FILE"; RUNS="$TEST_TMP/runs-i2"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" --branch feat/local-i2 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/i2.err")"; EXIT=$?
assert_eq "$EXIT" "0" "i2: lease 409 cloud fallback exits 0"
assert_contains "$(node -e 'const o=JSON.parse(String(process.argv[1]).split(/\n/).reverse().find(l=>l.trim().startsWith("{")));process.stdout.write(JSON.stringify(o.local_fallback))' "$OUT")" 'lease_409' "i2: fallback detail is lease_409"

# (j) explicit runner never asks the lease service.
cat > "$STUB_CLAUDE" <<'EOF'
#!/usr/bin/env bash
cat > got-prompt.txt
pwd > worktree-pwd.txt
printf '%s\n' "$@" > local-argv.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOF
chmod +x "$STUB_CLAUDE"
PROMPT="$TEST_TMP/prompt-j.txt"; printf 'edit impl-defaults-fixture.txt\n' > "$PROMPT"
printf '201\n' > "$LEASE_STATUS_FILE"; : > "$LEASE_LOG"
cat > "$TEST_TMP/bin/codex" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"type":"result","is_error":false,"result":"ok"}'
EOF
chmod +x "$TEST_TMP/bin/codex"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-k" "$SCRIPT" --no-verify-tip --context-window off --runner codex --pin-reason "test fixture" --codex-bin "$TEST_TMP/bin/codex" --branch feat/local-k --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/k.err")"; EXIT=$?
assert_neq "$EXIT" "97" "k: explicit codex path is stubbed"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "k: explicit runner sends no grant"

# (l) an implicit prompt naming an oversized repository file skips the local lease.
mkdir -p "$SBX/big"
dd if=/dev/zero of="$SBX/big/generated.ts" bs=1000 count=900 status=none
PROMPT="$TEST_TMP/prompt-l.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nReview `big/generated.ts` and update the implementation.\n' > "$PROMPT"
cat > "$TEST_TMP/bin/codex" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = exec ] && [ "${2:-}" = --help ]; then echo '--dangerously-bypass-hook-trust'; exit 0; fi
if [ "${1:-}" = --version ]; then echo 'codex-cli 0.146.0 (test stub)'; exit 0; fi
printf 'codex fixture\n' >> impl-defaults-fixture.txt
git add impl-defaults-fixture.txt
git -c user.email=t@t -c user.name=t commit -m 'test: context fallback codex stub' >/dev/null
printf '%s\n' '{"type":"result","is_error":false,"result":"ok"}'
EOF
chmod +x "$TEST_TMP/bin/codex"
: > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-l"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-l --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/l.err")"; EXIT=$?
assert_eq "$EXIT" "0" "l: oversized referenced file dispatch exits 0"
assert_eq "codex" "$(json_get "$OUT" runner)" "l: oversized referenced file uses codex"
assert_contains "$(cat "$TEST_TMP/l.err")" 'local-slot: local_ctx_over est_tokens=' "l: context fallback is reported"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "l: context fallback never requests a lease"

# (l2) An implicit local slot refused by the CN gate releases its lease and falls back to codex.
PROMPT="$TEST_TMP/prompt-l2.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nedit impl-defaults-fixture.txt\n' > "$PROMPT"
: > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-l2"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-l2 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/l2.err")"; EXIT=$?
MF="$(manifest_in "$RUNS")"
assert_eq "$EXIT" "0" "l2: CN-gate refusal falls back successfully"
assert_eq "$(json_get "$OUT" runner)" "codex" "l2: CN-gate refusal uses codex"
assert_eq "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.local_fallback.reason||"")' "$MF")" "cn_gate_barred" "l2: manifest records cn_gate_barred"
assert_eq "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.local_fallback.detail||"")' "$MF")" "cn_model_dispatch_barred" "l2: manifest records the gate detail token"
assert_eq "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.local_fallback.family||"")' "$MF")" "qwen" "l2: manifest records the local family"
assert_eq "$(node -e 'const lines=String(process.argv[1]).split(/\r?\n/).reverse(),line=lines.find(x=>x.trim().startsWith("{"));process.stdout.write(JSON.parse(line).local_fallback.reason||"")' "$OUT")" "cn_gate_barred" "l2: result records cn_gate_barred"
assert_not_contains "$(cat "$LEASE_LOG")" '"url":"/v1/local/lease/test-lease-id/heartbeat"' "l2: refused gate starts no heartbeat"
assert_contains "$(cat "$LEASE_LOG")" '"method":"DELETE","url":"/v1/local/lease/test-lease-id"' "l2: acquired lease is released"
assert_contains "$(cat "$TEST_TMP/l2.err")" 'local-slot: cn_gate_barred family=qwen -> codex' "l2: fallback is reported"

# (l3) Explicitly pinned local runs remain blocked by the same CN gate refusal.
RUNS="$TEST_TMP/runs-l3"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --runner local --pin-reason "test fixture" --model qwen --endpoint qwen_local \
  --branch feat/local-l3 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/l3.err")"; EXIT=$?
assert_eq "$EXIT" "2" "l3: pinned local CN-gate refusal remains a precondition error"
assert_contains "$OUT" '"status": "precondition_failed"' "l3: pinned refusal reports precondition_failed"
assert_contains "$OUT" 'cn_model_dispatch_barred' "l3: pinned refusal preserves gate error"

# (m) a shed local target and local_ctx_over coexist without duplicating the fallback.
PROMPT="$TEST_TMP/prompt-m.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nWork-Class: simple-script\nTask-Shape: from-scratch\nedit impl-defaults-fixture.txt\n' > "$PROMPT"
CFG="$TEST_TMP/ctx-config-m.json"
printf '%s\n' '{"local_context_tokens":1,"local_output_reserve_tokens":0}' > "$CFG"
BURN_MORE="$TEST_TMP/burn-more-m.json"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.burn_more/1",run_id:"test-m",generated_at:new Date().toISOString(),shed:{pools:[{pool:"test-pool",seats:["test-lane--claude"]}],rules:{mechanical_classes:["simple-script"],targets_in_order:["local-27b"]}}}))' "$BURN_MORE"
: > "$LEASE_LOG"; RUNS="$TEST_TMP/runs-m"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_CONFIG_FILE="$CFG" \
  AUTOPILOT_BURN_MORE="$BURN_MORE" AUTOPILOT_LANE=test-lane AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-m --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/m.err")"; EXIT=$?
assert_eq "0" "$EXIT" "m: shed local with oversized context exits 0"
assert_eq "codex" "$(json_get "$OUT" runner)" "m: shed local with local_ctx_over uses codex"
FALLBACK_LINES="$(awk '/^local-slot: local_ctx_over / { count++ } END { print count+0 }' "$TEST_TMP/m.err")"
assert_eq "1" "$FALLBACK_LINES" "m: exactly one local context fallback line"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "m: shed/local context fallback never requests a lease"

# (n) the three local fallback reasons route through pace-select (fleet task 01M806DD):
# with a present pace file the cloud fallback picks the pace seat (grok) and records
# pace_choice in the manifest; with the pace file missing it falls back to codex
# (cases l, l2, m above). Explicit --runner cases (j, k) are unchanged.
PACE_N="$TEST_TMP/pace-n.json"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.pace/1",generated_at:new Date().toISOString(),rows:[{pool:"grok-cli",class:"other",stale:false,used_pct:30,expected_pct:40,hours_to_reset:24}]}))' "$PACE_N"

# (n1) local_ctx_over with a live pace file: the fallback seat is the pace pick.
PROMPT="$TEST_TMP/prompt-n1.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nReview `big/generated.ts` and update the implementation.\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-n1"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_PACE_FILE="$PACE_N" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" --branch feat/local-n1 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/n1.err")"; EXIT=$?
MF="$(find "$RUNS" -name "*.manifest.json" | head -1)"
assert_eq "$EXIT" "0" "n1: local_ctx_over pace fallback exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "n1: local_ctx_over fallback uses the pace seat (grok)"
assert_eq "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.local_fallback.reason||"")' "$MF")" "local_ctx_over" "n1: manifest keeps the local_ctx_over reason"
assert_contains "$(cat "$TEST_TMP/n1.err")" 'local-slot: local_ctx_over est_tokens=' "n1: context fallback is reported"
assert_contains "$(cat "$TEST_TMP/n1.err")" '-> grok' "n1: fallback line names the pace seat"

# (n2) shed-local with a live pace file: the shed fallback also routes through pace.
PROMPT="$TEST_TMP/prompt-n2.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nTask-Class: simple-script\nWork-Class: simple-script\nTask-Shape: from-scratch\nedit impl-defaults-fixture.txt\n' > "$PROMPT"
CFG="$TEST_TMP/ctx-config-n2.json"
printf '%s\n' '{"local_context_tokens":1,"local_output_reserve_tokens":0}' > "$CFG"
BURN_MORE="$TEST_TMP/burn-more-n2.json"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.burn_more/1",run_id:"test-n2",generated_at:new Date().toISOString(),shed:{pools:[{pool:"test-pool",seats:["test-lane--claude"]}],rules:{mechanical_classes:["simple-script"],targets_in_order:["local-27b"]}}}))' "$BURN_MORE"
RUNS="$TEST_TMP/runs-n2"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_PACE_FILE="$PACE_N" AUTOPILOT_CONFIG_FILE="$CFG" \
  AUTOPILOT_BURN_MORE="$BURN_MORE" AUTOPILOT_LANE=test-lane AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --grok-bin "$STUB_GROK" --branch feat/local-n2 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/n2.err")"; EXIT=$?
MF="$(find "$RUNS" -name "*.manifest.json" | head -1)"
assert_eq "$EXIT" "0" "n2: shed-local pace fallback exits 0"
assert_eq "grok" "$(json_get "$OUT" runner)" "n2: shed-local fallback uses the pace seat (grok)"

# (n4) an expensive pace pick (model carries an opus/fable/... token) falls back to codex
# and clears BOTH pace_choice and engine_choice in the manifest.
ROLES_N4="$TEST_TMP/pace-roles-n4.json"
PACE_N4="$TEST_TMP/pace-n4.json"
node -e '
const fs = require("fs");
const roles = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
roles.pools["test-expensive"] = { key: "test-key", runner: "codex", model: "opus-expensive-test", effort: "low" };
roles.priority.implementer = ["test-expensive"];
fs.writeFileSync(process.argv[2], JSON.stringify(roles));
' "$REPO_ROOT/scripts/lib/pace-roles.json" "$ROLES_N4"
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],JSON.stringify({schema:"capacity.pace/1",generated_at:new Date().toISOString(),rows:[{pool:"test-expensive",class:"other",stale:false,used_pct:30,expected_pct:40,hours_to_reset:24}]}))' "$PACE_N4"
PROMPT="$TEST_TMP/prompt-n4.txt"
printf 'Fleet-Task: 01ARZ3NDEKTSV4RRFFQ69G5FAV\nReview `big/generated.ts` and update the implementation.\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-n4"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_PACE_FILE="$PACE_N4" AUTOPILOT_PACE_ROLES="$ROLES_N4" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-n4 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/n4.err")"; EXIT=$?
MF="$(find "$RUNS" -name "*.manifest.json" | head -1)"
assert_eq "$EXIT" "0" "n4: expensive pace pick falls back to codex and exits 0"
assert_eq "codex" "$(json_get "$OUT" runner)" "n4: expensive pick dispatches codex"
assert_eq "$(node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(o.pace_choice===null||o.pace_choice===undefined?"null":"present")' "$MF")" "null" "n4: pace_choice cleared on the expensive fallback"
assert_not_contains "$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))' "$MF")" '"engine_choice"' "n4: engine_choice cleared on the expensive fallback"

# negative control: a copy with the pace fallback hardcoded back to codex turns n1 red.
MUT_DH="$TEST_TMP/dispatch-hetero.nopace.sh"
node -e '
const fs = require("fs");
const src = fs.readFileSync(process.argv[1], "utf8");
const needle = "pace_cloud_fallback || true";
if (!src.includes(needle)) process.exit(3);
fs.writeFileSync(process.argv[2], src.split(needle).join("RUNNER=\"codex\"; MODEL=\"\"; ENDPOINT=\"\"; LOCAL_CTX_CODEX_FALLBACK=1;"));
' "$SCRIPT" "$MUT_DH" || fail "negative control: pace_cloud_fallback anchor not found"
chmod +x "$MUT_DH"
RUNS="$TEST_TMP/runs-n-mut"; mkdir -p "$RUNS"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_PACE_FILE="$PACE_N" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  "$MUT_DH" --no-verify-tip --context-window off --branch feat/local-n-mut --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/nmut.err")"; EXIT=$?
assert_neq "grok" "$(json_get "$OUT" runner)" "negative control: hardcoding codex turns the n1 case red (pace seat gone)"

finalize_test
