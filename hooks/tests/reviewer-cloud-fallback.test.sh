#!/usr/bin/env bash
# Reviewer-seat cloud retreat (PM 01M726SXVB). ONLY the roster reviewer tuple, and only when
# reviewer_on_engine_unavailable is cloud-fallback (empty follows the global on_engine_unavailable).
# A 503 on GET /v1/models retreats ONCE to reviewer_cloud_fallback_rung; a later 200 with the
# model listed returns to the local endpoint and writes no second cloud-fallbacks.jsonl row.
# No real network: the endpoint is a 127.0.0.1 stub, the cloud runner is a PATH stub.
. "$(dirname "$0")/lib.sh"
scrub_session_env
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  REVIEW_LOOP_CONFIG_OVERRIDE AUTOPILOT_QUALIFICATION_OVERRIDE 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINT_PREPROBE=on
export AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN="fake-token-not-real"
: > "$AUTOPILOT_ENDPOINTS_ENV"

MODEL_ID="Qwen3.8-27B-QUASAR-NVFP4"
SRV_JS="$TEST_TMP/models-server.js"
cat > "$SRV_JS" <<'NODE'
const http = require('http');
const fs = require('fs');
const [portFile, modeFile, hitsFile, modelId] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  fs.appendFileSync(hitsFile, `${req.method} ${req.url}\n`);
  const mode = fs.readFileSync(modeFile, 'utf8').trim();
  if (mode === 'busy') {
    res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end('{"error":"busy"}');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.method === 'GET') {
    return res.end(JSON.stringify({ object: 'list', data: [{ id: modelId }] }));
  }
  res.end('{"content":[{"type":"text","text":"not-a-review"}]}');
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
NODE
MODE_FILE="$TEST_TMP/srv.mode"; PORT_FILE="$TEST_TMP/srv.port"; HITS_FILE="$TEST_TMP/srv.hits"
printf 'busy' > "$MODE_FILE"; : > "$HITS_FILE"
node "$SRV_JS" "$PORT_FILE" "$MODE_FILE" "$HITS_FILE" "$MODEL_ID" &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; cleanup_test_tmp' EXIT
for _ in $(seq 1 50); do [ -s "$PORT_FILE" ] && break; sleep 0.05; done
SRV_PORT="$(cat "$PORT_FILE")"
[ -n "$SRV_PORT" ] || fail "fake /models server did not start"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL="http://127.0.0.1:$SRV_PORT"

DIFF="$TEST_TMP/diff.txt"
printf 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' > "$DIFF"
RESOLVE="$REPO_ROOT/scripts/resolve-review-loop.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
TEMPLATE="$REPO_ROOT/project-config-template/review-loop-config.md"

write_reviewer_cfg() { # $1 path, $2 extra lines (may be empty)
  {
    printf '%s\n' "- override: reviewer | until 2099-01-01 | reviewer cloud-fallback test"
    printf '%s\n' "- reviewer_engine: $MODEL_ID"
    printf '%s\n' "- reviewer_runner: anthropic-compatible"
    printf '%s\n' "- reviewer_effort: default"
    printf '%s\n' "- reviewer_endpoint: qwen_local"
    [ -n "$2" ] && printf '%s\n' "$2"
    # Incidental reviewer-seat fixture: pin the switches so this roster never
    # rides a changed consult/discuss default (Population B). Appended last.
    cat <<'PIN'
- consult_dispatch: off
- discuss_dispatch: off
PIN
  } > "$1"
}
CFG_FB="$TEST_TMP/reviewer-fb.md"
write_reviewer_cfg "$CFG_FB" "- reviewer_on_engine_unavailable: cloud-fallback
- reviewer_cloud_fallback_rung: gpt-6.1-sol/high@codex"
cat >> "$CFG_FB" <<'EOF'
- override: implementer | until 2099-01-01 | cross-family so the openai cloud rung stays runnable
- implementer_engine: grok-4.7
- implementer_runner: grok
- implementer_effort: low
- implementer_ladder:
EOF
CFG_ASK="$TEST_TMP/reviewer-ask.md"
write_reviewer_cfg "$CFG_ASK" ""

jget() {
  node -e 'let v=JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k]; process.stdout.write(v === null || v === undefined ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)));' "$1" "$2"
}
json_line() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
row_count() {
  if [ -f "$1/cloud-fallbacks.jsonl" ]; then
    grep -c . "$1/cloud-fallbacks.jsonl"
  else
    printf '0\n'
  fi
}

# review_run <config> <tag> <preprobe on|off>
# sets RUN_OUT (last JSON line), RUN_RC, RUN_ARGV, RUN_CAP, RUN_HITS
review_run() {
  local cfg="$1" tag="$2" preprobe="$3"
  RUN_CAP="$TEST_TMP/cap-$tag"
  mkdir -p "$RUN_CAP"
  local bindir="$TEST_TMP/bin-$tag"
  mkdir -p "$bindir"
  RUN_ARGV="$TEST_TMP/codex-argv-$tag"
  rm -f "$RUN_ARGV"
  cat > "$bindir/codex" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$RUN_ARGV"
printf 'not a review\n'
exit 0
EOF
  chmod +x "$bindir/codex"
  : > "$HITS_FILE"
  local out="$TEST_TMP/out-$tag" err="$TEST_TMP/err-$tag"
  set +e
  REVIEW_LOOP_CONFIG_OVERRIDE="$cfg" ENGINE_CAPABILITY_DIR="$RUN_CAP" \
    AUTOPILOT_ENDPOINT_PREPROBE="$preprobe" PATH="$bindir:$PATH" \
    "$REVIEW" --runner anthropic-compatible --model "$MODEL_ID" --effort default \
      --endpoint qwen_local --diff-file "$DIFF" --context-window off --timeout 30s \
      >"$out" 2>"$err" < /dev/null
  RUN_RC=$?
  set -uo pipefail
  RUN_OUT="$(json_line "$(cat "$out")")"
  RUN_HITS="$(cat "$HITS_FILE")"
}

# --- (4) invalid / local-runner rungs exit 3, before any dispatch ---------------------
bad_cfg() { # $1 path, $2 policy line, $3 rung line (optional)
  {
    printf '%s\n' "- override: reviewer | until 2099-01-01 | bad rung"
    printf '%s\n' "- reviewer_engine: $MODEL_ID"
    printf '%s\n' "- reviewer_runner: anthropic-compatible"
    printf '%s\n' "- reviewer_effort: default"
    printf '%s\n' "- reviewer_endpoint: qwen_local"
    printf '%s\n' "$2"
    [ -n "${3:-}" ] && printf '%s\n' "$3"
    # Same incidental pin as write_reviewer_cfg: the bad-rung fixtures are reviewer-only.
    cat <<'PIN'
- consult_dispatch: off
- discuss_dispatch: off
PIN
  } > "$1"
}
resolve_rc() {
  REVIEW_LOOP_CONFIG_OVERRIDE="$1" bash "$RESOLVE" >/dev/null 2>"$TEST_TMP/resolve.err"
  printf '%s' "$?"
}
BAD_LOCAL="$TEST_TMP/bad-local.md"
bad_cfg "$BAD_LOCAL" "- reviewer_on_engine_unavailable: cloud-fallback" "- reviewer_cloud_fallback_rung: gpt-6.1-sol/high@cc-shim"
assert_eq "$(resolve_rc "$BAD_LOCAL")" "3" "local-runner reviewer_cloud_fallback_rung exits 3"
assert_contains "$(cat "$TEST_TMP/resolve.err")" "invalid reviewer_cloud_fallback_rung" "local runner names the reviewer rung"
BAD_SHAPE="$TEST_TMP/bad-shape.md"
bad_cfg "$BAD_SHAPE" "- reviewer_on_engine_unavailable: cloud-fallback" "- reviewer_cloud_fallback_rung: not-a-rung"
assert_eq "$(resolve_rc "$BAD_SHAPE")" "3" "malformed reviewer_cloud_fallback_rung exits 3"
BAD_FAMILY="$TEST_TMP/bad-family.md"
bad_cfg "$BAD_FAMILY" "- reviewer_on_engine_unavailable: cloud-fallback" "- reviewer_cloud_fallback_rung: Qwen2.5-72B/high@codex"
assert_eq "$(resolve_rc "$BAD_FAMILY")" "3" "rung in the reviewer seat family exits 3"
assert_contains "$(cat "$TEST_TMP/resolve.err")" "shares the reviewer seat family" "family refusal names the reviewer family"
BAD_MISSING="$TEST_TMP/bad-missing.md"
bad_cfg "$BAD_MISSING" "- reviewer_on_engine_unavailable: cloud-fallback" ""
assert_eq "$(resolve_rc "$BAD_MISSING")" "3" "cloud-fallback without a rung exits 3"
assert_eq "$(resolve_rc "$CFG_FB")" "0" "openai cloud rung against the qwen reviewer resolves"

# --- shipped template: reviewer retreat on, global ask unchanged -----------------------
SHIP_POLICY="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$RESOLVE" --field reviewer_on_engine_unavailable 2>/dev/null)"
SHIP_RC=$?
assert_eq "$SHIP_RC" "0" "shipped template resolves reviewer_on_engine_unavailable"
assert_eq "$SHIP_POLICY" "cloud-fallback" "shipped qwen reviewer retreats to cloud"
SHIP_RUNG="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$RESOLVE" --field reviewer_cloud_fallback_rung 2>/dev/null)"
assert_contains "$SHIP_RUNG" "gpt-6.1-sol" "shipped rung engine is gpt-6.1-sol"
assert_contains "$SHIP_RUNG" "codex" "shipped rung runner is codex"
SHIP_GLOBAL="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$RESOLVE" --field on_engine_unavailable 2>/dev/null)"
assert_eq "$SHIP_GLOBAL" "ask" "global on_engine_unavailable stays ask"
SHIP_GLOBAL_RUNG="$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE" bash "$RESOLVE" --field cloud_fallback_rung 2>/dev/null)"
assert_eq "$SHIP_GLOBAL_RUNG" "" "global cloud_fallback_rung stays empty"
ASK_POLICY="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_ASK" bash "$RESOLVE" --field reviewer_on_engine_unavailable 2>/dev/null)"
assert_eq "$ASK_POLICY" "" "an override that omits the field follows the global (empty)"

# --- (1) 503 -> one retreat onto the cloud rung ---------------------------------------
printf 'busy' > "$MODE_FILE"
review_run "$CFG_FB" "busy" "on"
assert_eq "$(jget "$RUN_OUT" runner)" "codex" "503 retreat lands on the codex runner"
assert_eq "$(jget "$RUN_OUT" model)" "gpt-6.1-sol" "503 retreat lands on gpt-6.1-sol"
assert_eq "$(jget "$RUN_OUT" served_by)" "gpt-6.1-sol/high@codex" "503 served_by is the cloud rung"
assert_eq "$(jget "$RUN_OUT" probe.decision)" "busy" "503 probe decision is busy"
assert_contains "$(cat "$RUN_ARGV")" "exec --model gpt-6.1-sol" "codex stub saw the cloud model"
assert_contains "$(cat "$RUN_ARGV")" 'model_reasoning_effort="high"' "codex stub saw effort high"
assert_not_contains "$RUN_HITS" "POST /v1/messages" "503 retreat sends nothing to the local endpoint"
BUSY_ROWS="$(row_count "$RUN_CAP")"
assert_eq "$BUSY_ROWS" "1" "503 writes one cloud-fallbacks.jsonl row"
BUSY_ROW="$(head -n 1 "$RUN_CAP/cloud-fallbacks.jsonl")"
assert_eq "$(jget "$BUSY_ROW" error_class)" "endpoint_busy" "row error_class is endpoint_busy"
assert_eq "$(jget "$BUSY_ROW" from_endpoint)" "qwen_local" "row from_endpoint is qwen_local"
assert_eq "$(jget "$BUSY_ROW" to_rung)" "gpt-6.1-sol/high@codex" "row to_rung is the cloud rung"
assert_eq "$(jget "$BUSY_ROW" outcome)" "$(jget "$RUN_OUT" status)" "row outcome is the dispatch status"
assert_eq "$(jget "$BUSY_ROW" probe.decision)" "busy" "row probe.decision is busy"

# --- (2) stub recovers -> next dispatch stays on qwen_local, no new row ---------------
printf 'ok' > "$MODE_FILE"
review_run "$CFG_FB" "ok" "on"
# keep the busy store: copy is not needed; count the ok store (fresh) AND confirm the
# busy store was not appended (review_run uses a per-tag store). Re-dispatch into the
# busy store below so "no new row" is the same file.
assert_eq "$(jget "$RUN_OUT" runner)" "anthropic-compatible" "recovered dispatch stays on the local runner"
assert_eq "$(jget "$RUN_OUT" model)" "$MODEL_ID" "recovered dispatch stays on the qwen model"
assert_eq "$(jget "$RUN_OUT" served_by)" "qwen_local" "recovered served_by is the local endpoint"
assert_eq "$(jget "$RUN_OUT" probe.decision)" "ok" "recovered probe decision is ok"
assert_contains "$RUN_HITS" "GET /v1/models" "recovered probe hits /v1/models"
assert_contains "$RUN_HITS" "POST /v1/messages" "recovered review is sent to the local endpoint"
if [ -f "$RUN_ARGV" ]; then
  fail "recovered dispatch must not invoke the codex stub"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_eq "$(row_count "$RUN_CAP")" "0" "a healthy probe writes no cloud-fallbacks row"
# same store as the 503 retreat: one more healthy dispatch must not append
OK_SAME="$TEST_TMP/cap-busy"
review_run "$CFG_FB" "busy" "on"
assert_eq "$(row_count "$OK_SAME")" "1" "recovery against the same store adds no row"

# --- (3) empty reviewer policy keeps ask: no probe fields, no retreat, no row ---------
printf 'busy' > "$MODE_FILE"
review_run "$CFG_ASK" "ask-on" "on"
ASK_ON_JSON="$RUN_OUT"
assert_eq "$(jget "$ASK_ON_JSON" runner)" "anthropic-compatible" "empty policy does not retreat the runner"
assert_eq "$(jget "$ASK_ON_JSON" model)" "$MODEL_ID" "empty policy does not retreat the model"
assert_eq "$(jget "$ASK_ON_JSON" probe)" "null" "empty policy emits no probe"
assert_eq "$(jget "$ASK_ON_JSON" served_by)" "null" "empty policy emits no served_by"
assert_eq "$(row_count "$RUN_CAP")" "0" "empty policy writes no cloud-fallbacks row"
if [ -f "$RUN_ARGV" ]; then
  fail "empty policy must not invoke the codex stub"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_contains "$RUN_HITS" "POST /v1/messages" "empty policy still dispatches to the named endpoint"
review_run "$CFG_ASK" "ask-off" "off"
ASK_OFF_JSON="$RUN_OUT"
STRIP='node -e "let j=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")); delete j.raw_log; process.stdout.write(JSON.stringify(j));"'
ON_STRIP="$(printf '%s' "$ASK_ON_JSON" | eval "$STRIP")"
OFF_STRIP="$(printf '%s' "$ASK_OFF_JSON" | eval "$STRIP")"
assert_eq "$ON_STRIP" "$OFF_STRIP" "empty policy with the probe knob on is byte-identical to probe off"

# a different model on the same endpoint is not the reviewer seat
DIFF_MODEL_OUT="$TEST_TMP/out-other"
set +e
REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_FB" ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-other" \
  AUTOPILOT_ENDPOINT_PREPROBE=on PATH="$TEST_TMP/bin-busy:$PATH" \
  "$REVIEW" --runner anthropic-compatible --model GLM-5.3 --effort high \
    --endpoint qwen_local --diff-file "$DIFF" --context-window off --timeout 30s \
    >"$DIFF_MODEL_OUT" 2>"$TEST_TMP/err-other" < /dev/null
set -uo pipefail
OTHER_JSON="$(json_line "$(cat "$DIFF_MODEL_OUT")")"
assert_eq "$(jget "$OTHER_JSON" model)" "GLM-5.3" "a non-reviewer model is not retreated"
assert_eq "$(jget "$OTHER_JSON" probe)" "null" "a non-reviewer dispatch carries no probe"
assert_eq "$(row_count "$TEST_TMP/cap-other")" "0" "a non-reviewer dispatch writes no row"

finalize_test
