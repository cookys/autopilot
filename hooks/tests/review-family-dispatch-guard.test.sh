#!/usr/bin/env bash
# Dispatch-time family guard (PM go 01M74FDC5Z).
# The same diff must not be implemented and reviewed, nor implemented and
# VA-authored, by the same model family. Fake runners only: no model call.
# (a) qwen unreachable + agy cloud rung is skipped for an agy implementer;
#     the next cross-family preference runs; with none left, family-guard refuses.
#     An agy post-failure argon retreat is skipped the same way.
# (b) dispatch-author same-family VA dies with the existing strict-roster message
#     (negative control for the two copies of that die).
# (c) resolver: an implementer_ladder rung whose family equals the VA family
#     exits 3 even with allow_same_runner_dual_seat on; a different family is rc 0.
#     reviewer_cloud_fallback_rung vs explicit ladder rung 0 exits 3 the same way.
. "$(dirname "$0")/lib.sh"
scrub_session_env
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  REVIEW_LOOP_CONFIG_OVERRIDE AUTOPILOT_QUALIFICATION_OVERRIDE AUTOPILOT_AGY_REVIEW_RETREATED \
  AUTOPILOT_AGY_RETREAT_SERVED_BY AUTOPILOT_AGY_RETREAT_LOG_ROW 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1
export AUTOPILOT_SETTLE_MS=0
export AUTOPILOT_GROK_EFFORT_PROBE=0
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN="fake-token-not-real"
: > "$AUTOPILOT_ENDPOINTS_ENV"

REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
RESOLVE="$REPO_ROOT/scripts/resolve-review-loop.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
MODEL_ID="Qwen3.8-27B-QUASAR-NVFP4"
AGY_RUNG="gemini-4-carbon-high/high@agy"
GUARD_LINE="family-guard: no cross-family reviewer for implementer family google"

DIFF="$TEST_TMP/diff.txt"
printf 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' > "$DIFF"

jget() {
  node -e 'let v=JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k]; process.stdout.write(v === null || v === undefined ? "null" : (typeof v === "object" ? JSON.stringify(v) : String(v)));' "$1" "$2"
}
json_line() { printf '%s\n' "$1" | grep '^{' | tail -n 1; }
line_count() {
  if [ -f "$1" ]; then
    grep -c . "$1" || true
  else
    printf '0\n'
  fi
}

# --- fake qwen /models -------------------------------------------------------
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
  res.end(JSON.stringify({ object: 'list', data: [{ id: modelId }] }));
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

write_reviewer_cfg() { # $1 path, $2 extra reviewer lines
  {
    printf '%s\n' "- override: reviewer | until 2099-01-01 | family-guard dispatch fixture"
    printf '%s\n' "- reviewer_engine: $MODEL_ID"
    printf '%s\n' "- reviewer_runner: anthropic-compatible"
    printf '%s\n' "- reviewer_effort: default"
    printf '%s\n' "- reviewer_endpoint: qwen_local"
    printf '%s\n' "- reviewer_on_engine_unavailable: cloud-fallback"
    printf '%s\n' "- reviewer_cloud_fallback_rung: $AGY_RUNG"
    [ -n "${2:-}" ] && printf '%s\n' "$2"
    cat <<'PIN'
- consult_dispatch: off
- discuss_dispatch: off
PIN
  } > "$1"
}

# $1 config  $2 tag  $3 extra env assignments (may be empty)  $4 extra review args
review_run() {
  local cfg="$1" tag="$2" extra_env="${3:-}" extra_args="${4:-}"
  RUN_CAP="$TEST_TMP/cap-$tag"
  mkdir -p "$RUN_CAP"
  local bindir="$TEST_TMP/bin-$tag"
  mkdir -p "$bindir"
  RUN_GROK="$TEST_TMP/grok-argv-$tag"
  RUN_AGY="$TEST_TMP/agy-argv-$tag"
  rm -f "$RUN_GROK" "$RUN_AGY"
  cat > "$bindir/grok" <<EOF
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$RUN_GROK"
printf 'not a review\\n'
exit 0
EOF
  cat > "$bindir/agy" <<EOF
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$RUN_AGY"
printf 'agy-should-not-run\\n' >&2
exit 1
EOF
  chmod +x "$bindir/grok" "$bindir/agy"
  : > "$HITS_FILE"
  local out="$TEST_TMP/out-$tag" err="$TEST_TMP/err-$tag"
  set +e
  # shellcheck disable=SC2086
  env $extra_env REVIEW_LOOP_CONFIG_OVERRIDE="$cfg" ENGINE_CAPABILITY_DIR="$RUN_CAP" \
    AUTOPILOT_ENDPOINT_PREPROBE=on PATH="$bindir:$PATH" \
    "$REVIEW" --runner anthropic-compatible --model "$MODEL_ID" --effort default \
      --endpoint qwen_local --diff-file "$DIFF" --context-window off --timeout 30s \
      $extra_args \
      >"$out" 2>"$err" < /dev/null
  RUN_RC=$?
  set -uo pipefail
  RUN_OUT="$(json_line "$(cat "$out")")"
  RUN_ERR="$(cat "$err")"
}

# (a1) flag says google: skip the agy rung, run grok-4.7@grok.
CFG_PREF="$TEST_TMP/pref-grok.md"
write_reviewer_cfg "$CFG_PREF" "- reviewer_fallback_preference: grok-4.7@grok"
review_run "$CFG_PREF" "pref" "" "--implementer-family google"
assert_eq "$(jget "$RUN_OUT" runner)" "grok" "a1: cross-family preference runs on grok"
assert_eq "$(jget "$RUN_OUT" model)" "grok-4.7" "a1: preference model is grok-4.7"
assert_contains "$(jget "$RUN_OUT" served_by)" "grok-4.7" "a1: served_by names grok-4.7"
assert_contains "$(jget "$RUN_OUT" served_by)" "@grok" "a1: served_by runner is grok"
assert_contains "$RUN_ERR" "family-guard: skipping rung $AGY_RUNG" "a1: stderr names the skipped agy rung"
assert_not_contains "$RUN_ERR" "$GUARD_LINE" "a1: a runnable preference is not a refusal"
assert_eq "$(line_count "$RUN_AGY")" "0" "a1: agy is not spawned"
assert_contains "$(cat "$RUN_GROK")" "--model grok-4.7" "a1: grok stub saw grok-4.7"
assert_not_contains "$(cat "$RUN_GROK")" "__autopilot_probe__" "a1: grok effort probe did not run"

# (a2) flag absent: resolver implementer_family google (override) skips the same way.
CFG_IMPL="$TEST_TMP/impl-google.md"
write_reviewer_cfg "$CFG_IMPL" "- reviewer_fallback_preference: grok-4.7@grok"
cat >> "$CFG_IMPL" <<'EOF'
- override: implementer | until 2099-01-01 | flag-absent family comes from the resolver
- implementer_engine: gemini-4-argon-high
- implementer_runner: grok
- implementer_effort: low
- implementer_ladder:
EOF
review_run "$CFG_IMPL" "implfb" "" ""
assert_eq "$(jget "$RUN_OUT" runner)" "grok" "a2: absent flag falls back to resolver implementer_family"
assert_eq "$(jget "$RUN_OUT" model)" "grok-4.7" "a2: preference model is grok-4.7"
assert_contains "$RUN_ERR" "family-guard: skipping rung $AGY_RUNG" "a2: stderr names the skipped agy rung"
assert_eq "$(line_count "$RUN_AGY")" "0" "a2: agy is not spawned"

# (a3) no cross-family preference left: refuse, no agy spawn.
CFG_NONE="$TEST_TMP/pref-none.md"
write_reviewer_cfg "$CFG_NONE" "- reviewer_fallback_preference: gemini-4-carbon-high@agy, gemini-4-argon-high/high@agy"
review_run "$CFG_NONE" "none" "" "--implementer-family google"
assert_eq "$RUN_RC" "1" "a3: no cross-family reviewer exits 1"
assert_eq "$(jget "$RUN_OUT" status)" "no_verdict" "a3: status is no_verdict"
assert_contains "$RUN_ERR" "$GUARD_LINE" "a3: stderr is the family-guard refusal"
assert_contains "$RUN_ERR" "family-guard: skipping rung $AGY_RUNG" "a3: the configured rung is skipped first"
assert_eq "$(line_count "$RUN_AGY")" "0" "a3: agy is not spawned"
assert_eq "$(line_count "$RUN_GROK")" "0" "a3: grok is not spawned"
assert_not_contains "$(cat "$HITS_FILE")" "POST /v1/messages" "a3: nothing is sent to the local endpoint"

# (a4) agy reviewer rate-limit: argon retreat skipped for an agy implementer.
command -v bwrap >/dev/null 2>&1 || fail "bwrap is required"
REAL_BWRAP="$(command -v bwrap)"
CARBON="gemini-4-carbon-high"
ARGON="gemini-4-argon-high"
STUB="$TEST_TMP/agy-retreat-stub"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
model=""
prev=""
for a in "$@"; do
  [ "$prev" = --model ] && model="$a"
  prev="$a"
done
if [ -n "${AGY_MODELS:-}" ]; then
  printf '%s\n' "$model" >> "$AGY_MODELS"
fi
echo "rate limit: reviewer unavailable for this attempt" >&2
exit 1
EOF
chmod +x "$STUB"
make_agy_stub_versioned "$STUB"
WRAP="$TEST_TMP/bwrap-wrap"
mkdir -p "$WRAP"
cat > "$WRAP/bwrap" <<EOF
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "\${BWRAP_LOG:?}"
exec ${REAL_BWRAP} "\$@"
EOF
chmod +x "$WRAP/bwrap"

write_agy_cfg() { # $1 path, $2 extra reviewer lines
  {
    printf '%s\n' "- on_engine_unavailable: ask"
    printf '%s\n' "- override: reviewer | until 2099-01-01 | agy family-guard fixture"
    cat <<'PIN'
- consult_dispatch: off
- discuss_dispatch: off
PIN
    printf '%s\n' "- reviewer_engine: $CARBON"
    printf '%s\n' "- reviewer_runner: agy"
    printf '%s\n' "- reviewer_effort: high"
    printf '%s\n' "- reviewer_on_engine_unavailable: cloud-fallback"
    printf '%s\n' "- reviewer_cloud_fallback_rung: gemini-4-argon-high/high@agy"
    [ -n "${2:-}" ] && printf '%s\n' "$2"
  } > "$1"
}

agy_review_run() { # $1 config  $2 tag
  local cfg="$1" tag="$2"
  RUN_CAP="$TEST_TMP/cap-$tag"
  mkdir -p "$RUN_CAP"
  local bindir="$TEST_TMP/bin-$tag"
  mkdir -p "$bindir"
  RUN_GROK="$TEST_TMP/grok-argv-$tag"
  RUN_AGY="$TEST_TMP/agy-models-$tag"
  RUN_LOG="$TEST_TMP/bwrap-$tag.log"
  rm -f "$RUN_GROK" "$RUN_AGY"
  : > "$RUN_LOG"
  cat > "$bindir/grok" <<EOF
#!/usr/bin/env bash
printf '%s\\n' "\$*" >> "$RUN_GROK"
printf 'not a review\\n'
exit 0
EOF
  chmod +x "$bindir/grok"
  local out="$TEST_TMP/out-$tag" err="$TEST_TMP/err-$tag"
  set +e
  REVIEW_LOOP_CONFIG_OVERRIDE="$cfg" ENGINE_CAPABILITY_DIR="$RUN_CAP" \
    AGY_MODELS="$RUN_AGY" BWRAP_LOG="$RUN_LOG" PATH="$WRAP:$bindir:$PATH" \
    "$REVIEW" --runner agy --model "$CARBON" --effort high \
      --implementer-family google \
      --diff-file "$DIFF" --context-window off --timeout 30s --bin "$STUB" \
      >"$out" 2>"$err" < /dev/null
  RUN_RC=$?
  set -uo pipefail
  RUN_OUT="$(json_line "$(cat "$out")")"
  RUN_ERR="$(cat "$err")"
}

CFG_AGY_PREF="$TEST_TMP/agy-pref.md"
write_agy_cfg "$CFG_AGY_PREF" "- reviewer_fallback_preference: grok-4.7@grok"
agy_review_run "$CFG_AGY_PREF" "agy-pref"
assert_eq "$(jget "$RUN_OUT" runner)" "grok" "a4: argon skipped, grok preference runs"
assert_eq "$(jget "$RUN_OUT" model)" "grok-4.7" "a4: model is grok-4.7"
assert_contains "$RUN_ERR" "family-guard: skipping rung gemini-4-argon-high/high@agy" "a4: stderr names the skipped argon rung"
assert_not_contains "$RUN_ERR" "$GUARD_LINE" "a4: a grok preference is not a refusal"
assert_eq "$(grep -c -- "--model $ARGON" "$RUN_LOG" || true)" "0" "a4: argon model is not spawned"
assert_eq "$(grep -c -- "--model $CARBON" "$RUN_LOG" || true)" "1" "a4: the first carbon attempt still ran"
assert_contains "$(cat "$RUN_GROK")" "--model grok-4.7" "a4: grok stub saw grok-4.7"
assert_not_contains "$(cat "$RUN_LOG")" "--bin " "a4: bwrap log is the agy attempt only"

CFG_AGY_NONE="$TEST_TMP/agy-none.md"
write_agy_cfg "$CFG_AGY_NONE" ""
agy_review_run "$CFG_AGY_NONE" "agy-none"
assert_eq "$RUN_RC" "1" "a5: no cross-family retreat exits 1"
assert_eq "$(jget "$RUN_OUT" status)" "no_verdict" "a5: status is no_verdict"
assert_contains "$RUN_ERR" "$GUARD_LINE" "a5: stderr is the family-guard refusal"
assert_contains "$RUN_ERR" "family-guard: skipping rung gemini-4-argon-high/high@agy" "a5: argon rung is skipped"
assert_eq "$(grep -c -- "--model $ARGON" "$RUN_LOG" || true)" "0" "a5: argon is not spawned"
assert_eq "$(grep -c -- "--model $CARBON" "$RUN_LOG" || true)" "1" "a5: only the first carbon attempt ran"
assert_eq "$(line_count "$RUN_GROK")" "0" "a5: grok is not spawned"

# (b) negative control: same-family VA dies with the existing message.
DIE_MSG="strict roster requires distinct verification_author_family and implementer_family"
assert_contains "$(sed -n '694p' "$AUTHOR")" "$DIE_MSG" "b: line 694 keeps the existing die"
assert_contains "$(sed -n '881p' "$AUTHOR")" "$DIE_MSG" "b: line 881 keeps the existing die"
AUTH_REPO="$TEST_TMP/author-same"
mkdir -p "$AUTH_REPO/.claude"
cat > "$AUTH_REPO/.claude/review-loop-config.md" <<'EOF'
- override: verification_author | until 2099-01-01 | same family as the implementer
- verification_author_present: true
- verification_author_engine: gpt-5.5
- verification_author_runner: cc-shim
- verification_author_effort: high
- verification_author_endpoint:
- override: implementer | until 2099-01-01 | openai implementer
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- implementer_effort: high
- consult_dispatch: off
- discuss_dispatch: off
EOF
AUTH_PROMPT="$TEST_TMP/author-prompt.txt"
printf '%s\n' "Write a verification plan." > "$AUTH_PROMPT"
AUTH_SENTINEL="$TEST_TMP/author-sentinel"
rm -f "$AUTH_SENTINEL"
AUTH_BIN="$TEST_TMP/author-bin"
cat > "$AUTH_BIN" <<EOF
#!/usr/bin/env bash
touch "$AUTH_SENTINEL"
exit 0
EOF
chmod +x "$AUTH_BIN"
set +e
AUTH_OUT="$(DISPATCH_QUIET=1 "$AUTHOR" --strict-roster --repo-root "$AUTH_REPO" --prompt-file "$AUTH_PROMPT" --bin "$AUTH_BIN" 2>"$TEST_TMP/author.err")"
AUTH_RC=$?
set -uo pipefail
assert_eq "$AUTH_RC" "2" "b: same-family VA exits 2"
assert_contains "$AUTH_OUT" "$DIE_MSG" "b: stdout carries the existing die"
assert_contains "$AUTH_OUT" '"status": "precondition_failed"' "b: status is precondition_failed"
assert_file_absent "$AUTH_SENTINEL" "b: the author runner was not spawned"

# (c) resolver ladder rung vs VA, and reviewer fallback vs explicit rung 0.
resolve_of() {
  RESOLVE_ERR="$TEST_TMP/resolve-$1.err"
  set +e
  REVIEW_LOOP_CONFIG_OVERRIDE="$2" bash "$RESOLVE" >"$TEST_TMP/resolve-$1.out" 2>"$RESOLVE_ERR"
  RESOLVE_RC=$?
  set -uo pipefail
}

CFG_VA_HIT="$TEST_TMP/va-hit.md"
cat > "$CFG_VA_HIT" <<'EOF'
- allow_same_runner_dual_seat: on
- consult_dispatch: off
- discuss_dispatch: off
- override: implementer | until 2099-01-01 | ladder rung 2 is grok
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- implementer_effort: high
- implementer_ladder: GLM-5.3/high@codex, claude-sonnet-5/high@claude-native, grok-4.7/low@grok
- override: verification_author | until 2099-01-01 | same family as rung 2
- verification_author_present: true
- verification_author_engine: grok-4.7
- verification_author_runner: grok
- verification_author_effort: low
- verification_author_endpoint:
EOF
resolve_of va-hit "$CFG_VA_HIT"
assert_eq "$RESOLVE_RC" "3" "c1: ladder rung sharing the VA family exits 3"
assert_contains "$(cat "$RESOLVE_ERR")" "implementer_ladder rung 2 grok-4.7/low@grok shares verification_author_family (xai)" "c1: the message names rung 2"

CFG_VA_OK="$TEST_TMP/va-ok.md"
cat > "$CFG_VA_OK" <<'EOF'
- allow_same_runner_dual_seat: on
- consult_dispatch: off
- discuss_dispatch: off
- override: implementer | until 2099-01-01 | ladder families differ from the VA
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- implementer_effort: high
- implementer_ladder: GLM-5.3/high@codex, claude-sonnet-5/high@claude-native, grok-4.7/low@grok
EOF
resolve_of va-ok "$CFG_VA_OK"
assert_eq "$RESOLVE_RC" "0" "c2: ladder families that differ from the VA resolve"
assert_not_contains "$(cat "$RESOLVE_ERR")" "shares verification_author_family" "c2: no VA family refusal"

CFG_CF_VA="$TEST_TMP/cf-va.md"
cat > "$CFG_CF_VA" <<'EOF'
- allow_same_runner_dual_seat: on
- on_engine_unavailable: cloud-fallback
- cloud_fallback_rung: grok-4.7/low@grok
- consult_dispatch: off
- discuss_dispatch: off
- override: implementer | until 2099-01-01 | empty ladder, cloud rung matches the VA
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- implementer_effort: high
- implementer_ladder:
- override: verification_author | until 2099-01-01 | same family as the cloud rung
- verification_author_present: true
- verification_author_engine: grok-4.7
- verification_author_runner: grok
- verification_author_effort: low
- verification_author_endpoint:
EOF
resolve_of cf-va "$CFG_CF_VA"
assert_eq "$RESOLVE_RC" "3" "c3: implementer cloud_fallback_rung sharing the VA family exits 3"
assert_contains "$(cat "$RESOLVE_ERR")" "cloud_fallback_rung grok-4.7/low@grok shares verification_author_family (xai)" "c3: the message names the cloud rung"

CFG_R0="$TEST_TMP/r0-hit.md"
cat > "$CFG_R0" <<'EOF'
- allow_same_runner_dual_seat: on
- consult_dispatch: off
- discuss_dispatch: off
- override: implementer | until 2099-01-01 | rung 0 matches the reviewer cloud rung
- implementer_engine: gpt-6.1-sol
- implementer_runner: codex
- implementer_effort: high
- implementer_ladder: gpt-6.1-sol/high@codex, grok-4.7/low@grok
EOF
resolve_of r0 "$CFG_R0"
assert_eq "$RESOLVE_RC" "3" "c4: reviewer cloud rung sharing implementer rung 0 exits 3"
assert_contains "$(cat "$RESOLVE_ERR")" "reviewer_cloud_fallback_rung gpt-6.1-sol/high@codex shares implementer rung 0 family (openai)" "c4: the message names rung 0"

CFG_R0_OK="$TEST_TMP/r0-ok.md"
cat > "$CFG_R0_OK" <<'EOF'
- allow_same_runner_dual_seat: on
- consult_dispatch: off
- discuss_dispatch: off
- override: implementer | until 2099-01-01 | rung 0 family differs from the reviewer cloud rung
- implementer_engine: grok-4.7
- implementer_runner: grok
- implementer_effort: low
- implementer_ladder: grok-4.7/low@grok, GLM-5.3/high@codex
EOF
resolve_of r0ok "$CFG_R0_OK"
assert_eq "$RESOLVE_RC" "0" "c5: reviewer cloud rung of another family resolves"

# (c6) implementer_ladder: auto synthesized from a topology that advertises the VA family and
# the reviewer cloud rung family: the ladder is shaped, never exit 3. Explicit ladders keep c1/c4.
TOPO_AUTO="$TEST_TMP/topo-auto.json"
cat > "$TOPO_AUTO" <<'EOF2'
{"implementer_ladder":[{"engine":"gpt-6.1-sol","effort":"high","runner":"codex"},{"engine":"Qwen3.8-Max","effort":"high","runner":"qoderclicn"},{"engine":"grok-4.7","effort":"low","runner":"grok"}]}
EOF2
CFG_AUTO="$TEST_TMP/auto-ladder.md"
cat > "$CFG_AUTO" <<'EOF2'
- consult_dispatch: off
- discuss_dispatch: off
- override: implementer | until 2099-01-01 | auto ladder
- implementer_engine: gpt-6.1-sol
- implementer_runner: auto
- implementer_effort: high
- implementer_ladder: auto
- override: reviewer | until 2099-01-01 | reviewer cloud rung is the implementer's family
- reviewer_engine: Qwen3.8-27B-QUASAR-NVFP4
- reviewer_runner: anthropic-compatible
- reviewer_effort: default
- reviewer_endpoint: qwen_local
- reviewer_on_engine_unavailable: cloud-fallback
- reviewer_cloud_fallback_rung: gpt-6.1-sol/high@codex
- override: verification_author | until 2099-01-01 | alibaba VA advertised in the topology
- verification_author_present: true
- verification_author_engine: Qwen3.8-Max
- verification_author_runner: qoderclicn
- verification_author_effort: high
- verification_author_endpoint:
EOF2
AUTOPILOT_TOPOLOGY_FILE="$TOPO_AUTO" resolve_of auto "$CFG_AUTO"
assert_eq "$RESOLVE_RC" "0" "c6: auto ladder with VA-family and reviewer-cloud-family rungs resolves"
AUTO_LADDER="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").split("\n")[0]); process.stdout.write(j.implementer_ladder.map((r)=>r.engine).join(","));' "$TEST_TMP/resolve-auto.out")"
assert_eq "$AUTO_LADDER" "grok-4.7,gpt-6.1-sol" "c6: VA family dropped, reviewer cloud family moved off rung 0"

finalize_test
