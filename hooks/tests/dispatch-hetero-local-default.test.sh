#!/usr/bin/env bash
# Implementer dispatch defaults to the local qwen seat.
# Red on a dispatch-hetero.sh that still sends an omitted --runner to grok.
# Stub claude / stub grok only. No live CLI and no HTTP endpoint.
. "$(dirname "$0")/lib.sh"

TEST_NAME="dispatch-hetero-local-default"
SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
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
if [ "\${1:-}" = "$REPO_ROOT/scripts/lib/cn-model-dispatch-gate.js" ] && [ "\${2:-}" = "check" ]; then
  printf '%s\n' "\$*" >> "$GATE_LOG"
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
  MF="$(find "$runs" -name '*.manifest.json' | head -1)"
}

# (a2) A free GLM slot wins before a fixture that otherwise selects codex; gate and manifest carry GLM.
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"endpoints":[{"id":"qwen-a","state":"up","free":0},{"id":"glm-a","models":["GLM-4"],"state":"up","free":1}]}'\'''
PROMPT="$TEST_TMP/prompt-a2.txt"
printf 'Size: S\nRole: implementer\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local a2
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (a2): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "a2: GLM fallback exits 0"
assert_eq "glm" "$(json_get "$OUT" model)" "a2: result model is glm"
assert_file_exists "$MF" "a2: GLM manifest written"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).endpoint||"")' "$MF")" "glm_local" "a2: manifest endpoint is glm_local"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).model||"")' "$MF")" "glm" "a2: manifest model is glm"
assert_contains "$(cat "$LEASE_LOG")" '"url":"/v1/local/lease"' "a2: GLM slot goes through lease"
assert_contains "$(cat "$GATE_LOG")" '--model glm --endpoint glm_local' "a2: CN gate receives selected GLM model and endpoint"
export AUTOPILOT_LOCAL_SLOTS_CMD='printf %s '\''{"free":1,"draining":false}'\'''

# (a) implementer, no --runner -> manifest runner local, model qwen.
PROMPT="$TEST_TMP/prompt-a.txt"
printf 'Size: S\nRole: implementer\nScope: ok.txt\nTask-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local a
[ "$EXIT" -eq 0 ] || printf 'local-default diagnostic (a): %s\n%s\n' "$OUT" "$ERR" >&2
assert_eq "0" "$EXIT" "a: implementer with no --runner exits 0"
assert_not_contains "$(cat "$TEST_TMP/a.err")" 'engine-preflight:' "a: a free local slot bypasses cloud preflight"
assert_eq "local" "$(json_get "$OUT" runner)" "a: result runner is local"
assert_eq "qwen" "$(json_get "$OUT" model)" "a: result model is qwen"
assert_file_exists "$MF" "a: manifest written"
assert_eq "local" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).runner)' "$MF")" "a: manifest runner is local"
assert_eq "qwen" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).model)' "$MF")" "a: manifest model is qwen"
assert_eq "<null>" "$(json_get "$OUT" local_fallback)" "a: local choice records local_fallback null"
assert_eq "null" "$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).local_fallback; process.stdout.write(v===null?"null":JSON.stringify(v))' "$MF")" "a: manifest local_fallback is null"
assert_contains "$(cat "$GATE_LOG")" '--model qwen --endpoint qwen_local' "a: CN gate receives selected Qwen model and endpoint"

# (b) local, no Task-Class line -> dispatched prompt stays unchanged; caller file unchanged.
PROMPT="$TEST_TMP/prompt-b.txt"
printf 'edit only this line\n' > "$PROMPT"
BEFORE="$(sha256sum "$PROMPT" | awk '{print $1}')"
run_local b --runner local --model qwen
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
run_local b2 --runner local --model qwen
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
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
run_local c --runner local --model qwen
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
  "$SCRIPT" --no-verify-tip --context-window off --runner grok --grok-bin "$STUB_GROK" \
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
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-f"; mkdir -p "$RUNS"; : > "$LEASE_LOG"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" AUTOPILOT_LOCAL_LEASE_TTL_S=3 LEASE_WORKER_SLEEP=7 \
  "$SCRIPT" --no-verify-tip --context-window off --branch feat/local-f --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/f.err")"
EXIT=$?
[ "$EXIT" -eq 0 ] || printf "lease-f diagnostic: %s\n%s\n" "$OUT" "$(cat "$TEST_TMP/f.err")" >&2
assert_eq "$EXIT" "0" "f: lease-backed implicit local run exits 0"
MF="$(find "$RUNS" -name '*.manifest.json' | head -1)"
assert_eq "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.id||"")' "$MF")" "test-lease-id" "f: manifest records lease id"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.released))' "$MF")" "true" "f: manifest records release"
assert_eq "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1])).local_lease.heartbeats>=2))' "$MF")" "true" "f: heartbeat renews during worker run"
assert_contains "$(cat "$LEASE_LOG")" '"method":"DELETE"' "f: gateway received DELETE"

# (f2) a hard-timeout worker is killed, but its granted lease is still released once.
PROMPT="$TEST_TMP/prompt-f2.txt"
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
RUNS="$TEST_TMP/runs-f2"; mkdir -p "$RUNS"; : > "$LEASE_LOG"
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
  AUTOPILOT_LOCAL_LEASE_TTL_S=3 AUTOPILOT_HETERO_HARD_TIMEOUT=3 AUTOPILOT_HETERO_SAMPLE_S=1 \
  LEASE_WORKER_SLEEP=15 "$SCRIPT" --no-verify-tip --context-window off \
  --branch feat/local-f2 --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/f2.err")"
EXIT=$?
MF="$(find "$RUNS" -name '*.manifest.json' | head -1)"
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
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
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
printf 'Task-Class: simple-script\nedit ok.txt\n' > "$PROMPT"
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
PROMPT="$TEST_TMP/prompt-i.txt"; printf 'edit impl-defaults-fixture.txt\n' > "$PROMPT"
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
OUT="$(cd "$SBX" && env PATH="$TEST_TMP/bin:$PATH" AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs-k" "$SCRIPT" --no-verify-tip --context-window off --runner codex --codex-bin "$TEST_TMP/bin/codex" --branch feat/local-k --prompt-file "$PROMPT" </dev/null 2>"$TEST_TMP/k.err")"; EXIT=$?
assert_neq "$EXIT" "97" "k: explicit codex path is stubbed"
assert_not_contains "$(cat "$LEASE_LOG")" '"method":"POST","url":"/v1/local/lease"' "k: explicit runner sends no grant"

finalize_test
