#!/usr/bin/env bash
# hetero-fallback-sandbox-agy.test.sh — real bwrap sandbox retreat from a busy cc-shim
# local seat (qwen_local -> 503) to agy (gemini-4-hydrogen-high/high@agy).
# Verifies:
#   1. Retreating to agy under --sandbox bwrap actually runs agy inside real bwrap,
#      writes AGY_ENVELOPE/AGY_STDERR inside writable $SANDBOX_TMP, writes $HOME/.gemini,
#      parses the native envelope (status=committed, usage present, no EROFS), and
#      records fallback.reason=endpoint_busy.
#   2. $HOME/.claude stays masked/read-only inside the agy sandbox.
#   3. Symlinked $HOME/.gemini pointing outside $HOME/.gemini fails closed (no unsandboxed fallback).
#   4. Negative controls (sed_mutant): reverting AGY_ENVELOPE/AGY_STDERR out of SANDBOX_TMP
#      reproduces the pre-fix e88bda2c3 Read-only file system / "native envelope and usage NOT parsed"
#      failure, and disabling the agy-only $HOME/.gemini bind fails when agy touches $HOME/.gemini.
# Skipped when bwrap is missing or cannot create a user namespace on this host.
. "$(dirname "$0")/lib.sh"

if ! command -v bwrap >/dev/null 2>&1; then
  echo "SKIP [hetero-fallback-sandbox-agy] bwrap not installed on host"
  finalize_test; exit 0
fi
if ! bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1; then
  echo "SKIP [hetero-fallback-sandbox-agy] bwrap --ro-bind / / true cannot run on this host"
  finalize_test; exit 0
fi

unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH REVIEW_LOOP_CONFIG_OVERRIDE \
  AUTOPILOT_QUALIFICATION_OVERRIDE AUTOPILOT_HETERO_FELL_BACK AUTOPILOT_HETERO_FELL_BACK_JSON \
  ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINT_PREPROBE=on
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
: > "$AUTOPILOT_ENDPOINTS_ENV"
chmod 600 "$AUTOPILOT_ENDPOINTS_ENV"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN="fake-token-not-real"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SRV_JS="$TEST_TMP/models-server.js"
cat > "$SRV_JS" <<'NODE'
const http = require('http');
const fs = require('fs');
const [portFile, hitsFile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  fs.appendFileSync(hitsFile, `${req.method} ${req.url}\n`);
  res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
  res.end('{"error":"busy"}');
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
NODE
PORT_FILE="$TEST_TMP/srv.port"
HITS_FILE="$TEST_TMP/srv.hits"
: > "$HITS_FILE"
node "$SRV_JS" "$PORT_FILE" "$HITS_FILE" &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; cleanup_test_tmp' EXIT
for _ in $(seq 1 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
SRV_PORT="$(cat "$PORT_FILE")"
[ -n "$SRV_PORT" ] || fail "fake /models server did not start"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL="http://127.0.0.1:${SRV_PORT}"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email "t@t"
git -C "$SBX" config user.name "t"
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
WTS="$TEST_TMP/wts"
mkdir -p "$WTS"

BINDIR="$TEST_TMP/bin"
mkdir -p "$BINDIR"
CLAUDE_CALLS="$TEST_TMP/claude.calls"
export CLAUDE_CALLS

# Stub claude only so cc-shim precondition passes before the 503 pre-probe retreats; NEVER stub bwrap.
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
echo x >> "${CLAUDE_CALLS:?}"
echo edited >> sandbox-edit.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOS

cat > "$BINDIR/agy" <<'EOS'
#!/usr/bin/env bash
case "${*}" in
  *--input-format*) cat >/dev/null ;;
esac
mkdir -p "$HOME/.gemini/antigravity-cli" || exit 1
printf '%s\n' "$*" > "$HOME/.gemini/antigravity-cli/agy-reached.txt" || exit 1
printf 'state\n' > "$HOME/.gemini/antigravity-cli/state.tmp" || exit 1
if touch "$HOME/.claude/should-fail" 2>/dev/null; then
  printf 'SECURITY_BUG: $HOME/.claude writable inside agy bwrap\n' >&2
  exit 19
fi
echo edited >> sandbox-edit.txt
printf '%s\n' '{"event":"result","result":{"status":"SUCCESS","response":"ok","usage":{"input_tokens":10,"output_tokens":5}}}'
exit 0
EOS
chmod +x "$BINDIR/claude" "$BINDIR/agy"
make_agy_stub_versioned "$BINDIR/agy"

CFG_FB="$TEST_TMP/cfg-fb.md"
printf -- '- on_engine_unavailable: cloud-fallback\n- cloud_fallback_rung: gemini-4-hydrogen-high/high@agy\n' > "$CFG_FB"

jget() {
  node -e 'let v=JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k]; console.log(v === null || v === undefined ? "null" : String(v));' "$1" "$2"
}
result_line() {
  node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8");
let best = "";
for (const line of s.split("\n")) {
  const t = line.trim();
  if (!t.startsWith("{")) continue;
  try { const o = JSON.parse(t); if (o && typeof o === "object" && !Array.isArray(o) && "status" in o) best = t; } catch {}
}
process.stdout.write(best);
' "$1"
}

run_retreat_case() {
  local tag="$1" fake_home="$2" script="$3"
  CASE_CAP="$TEST_TMP/cap-$tag"
  local runs="$TEST_TMP/runs-$tag"
  mkdir -p "$CASE_CAP" "$runs"
  seed_dogfood_implementer_pin "$CASE_CAP" >/dev/null
  : > "$CLAUDE_CALLS"
  local out="$TEST_TMP/out-$tag" err="$TEST_TMP/err-$tag"
  CASE_RC=0
  (cd "$SBX" && timeout 180 env PATH="$BINDIR:$PATH" HOME="$fake_home" \
      ENGINE_CAPABILITY_DIR="$CASE_CAP" \
      REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_FB" \
      AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      "$script" \
      --runner cc-shim --model Qwen3.8-27B-QUASAR-NVFP4 --effort high \
      --branch "feat/sbx-agy-$tag" \
      --prompt-file "$PROMPT" --context-window off \
      --endpoint qwen_local --sandbox bwrap --worktree-parent "$WTS" \
      >"$out" 2>"$err" < /dev/null) || CASE_RC=$?
  CASE_ERR="$(cat "$err" 2>/dev/null || true)"
  CASE_JSON="$(result_line "$out")"
  CASE_LOG_PATH="$(jget "$CASE_JSON" agent_log)"
  CASE_LOG=""
  [ -n "$CASE_LOG_PATH" ] && [ "$CASE_LOG_PATH" != "null" ] && [ -f "$CASE_LOG_PATH" ] && CASE_LOG="$(cat "$CASE_LOG_PATH" 2>/dev/null || true)"
}

# --- (1) Green path: real bwrap retreat runs agy, parses envelope, writes ~/.gemini, masks ~/.claude ---
H1="$TEST_TMP/home-green"
mkdir -p "$H1/.claude"
printf 'keep-me\n' > "$H1/.claude/secret.txt"
run_retreat_case green "$H1" "$REPO_ROOT/scripts/dispatch-hetero.sh"
assert_eq "$(jget "$CASE_JSON" status)" "committed" "(1) real bwrap retreat to agy commits (rc=$CASE_RC stderr=$(printf '%s' "$CASE_ERR" | tail -c 400) log=$CASE_LOG)"
assert_eq "$(jget "$CASE_JSON" runner)" "agy" "(1) result runner is agy"
assert_eq "$(jget "$CASE_JSON" model)" "gemini-4-hydrogen-high" "(1) result model is gemini-4-hydrogen-high"
assert_eq "$(jget "$CASE_JSON" fallback.reason)" "endpoint_busy" "(1) fallback.reason is endpoint_busy"
assert_eq "$(jget "$CASE_JSON" fallback.to)" "gemini-4-hydrogen-high/high@agy" "(1) fallback.to is gemini-4-hydrogen-high/high@agy"
assert_eq "$(jget "$CASE_JSON" sandbox.mode)" "bwrap" "(1) sandbox.mode is bwrap"
assert_eq "$(jget "$CASE_JSON" usage.input_tokens)" "10" "(1) agy native envelope and usage parsed"
assert_not_contains "$CASE_LOG" "native envelope and usage NOT parsed" "(1) log has no envelope-NOT-parsed failure"
assert_not_contains "$CASE_LOG" "Read-only file system" "(1) log has no Read-only file system error"
assert_file_exists "$H1/.gemini/antigravity-cli/agy-reached.txt" "(1) agy stub ran inside bwrap and wrote under \$HOME/.gemini"
assert_file_exists "$H1/.gemini/antigravity-cli/state.tmp" "(1) agy stub wrote state under \$HOME/.gemini"
assert_file_absent "$H1/.claude/should-fail" "(1) \$HOME/.claude stayed non-writable inside agy bwrap"
assert_eq "$(cat "$H1/.claude/secret.txt")" "keep-me" "(1) \$HOME/.claude existing file untouched"
[ ! -s "$CLAUDE_CALLS" ] || fail "(1) local cc-shim claude must not run after 503 pre-probe"

# --- (2) Fail closed when $HOME/.gemini is a symlink escaping into $HOME/.claude (no unsandboxed fallback) ---
H2="$TEST_TMP/home-escape"
mkdir -p "$H2/.claude"
printf 'keep-me\n' > "$H2/.claude/secret.txt"
ln -s "$H2/.claude" "$H2/.gemini"
run_retreat_case escape "$H2" "$REPO_ROOT/scripts/dispatch-hetero.sh"
assert_neq "$(jget "$CASE_JSON" status)" "committed" "(2) symlinked ~/.gemini -> ~/.claude refuses sandbox setup and does not commit"
assert_contains "$CASE_LOG" "worker not started" "(2) fail-closed sandbox refusal does not run worker unsandboxed"
assert_file_absent "$H2/.claude/antigravity-cli/agy-reached.txt" "(2) agy stub never started on symlink escape"
assert_eq "$(cat "$H2/.claude/secret.txt")" "keep-me" "(2) \$HOME/.claude untouched on refused symlink"

# --- (3) Negative control (e88bda2c3 pre-fix): AGY_ENVELOPE/AGY_STDERR outside SANDBOX_TMP ---
MUT_ENV="$TEST_TMP/mut-env"
make_pre_tree "$MUT_ENV"
rm -f "$MUT_ENV/scripts/dispatch-hetero.sh"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$MUT_ENV/scripts/dispatch-hetero.sh" \
  's/AGY_ENVELOPE="\$(mktemp "\${SANDBOX_TMP}\/dispatch-hetero-agy-envelope-XXXXXX")"/AGY_ENVELOPE="$(mktemp -t dispatch-hetero-agy-envelope-XXXXXX)"/' \
  || fail "mut-env anchor did not match"
chmod +x "$MUT_ENV/scripts/dispatch-hetero.sh"
H3="$TEST_TMP/home-mut-env"
mkdir -p "$H3/.claude"
run_retreat_case mut_env "$H3" "$MUT_ENV/scripts/dispatch-hetero.sh"
assert_neq "$(jget "$CASE_JSON" status)" "committed" "(3) pre-fix mutant fails inside real bwrap"
assert_contains "$CASE_LOG" "Read-only file system" "(3) pre-fix mutant hits Read-only file system on AGY_ENVELOPE"
assert_contains "$CASE_LOG" "native envelope and usage NOT parsed" "(3) pre-fix mutant reproduces native envelope NOT parsed"
assert_file_absent "$H3/.gemini/antigravity-cli/agy-reached.txt" "(3) pre-fix mutant failed before agy ran"

# --- (4) Negative control: disabling agy-only ~/.gemini bind causes agy write to fail under bwrap ---
MUT_GEM="$TEST_TMP/mut-gem"
make_pre_tree "$MUT_GEM"
rm -f "$MUT_GEM/scripts/dispatch-hetero.sh"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$MUT_GEM/scripts/dispatch-hetero.sh" \
  's/if \[ "\$(current_runner_name)" = "agy" \]; then/if false; then/' \
  || fail "mut-gem anchor did not match"
chmod +x "$MUT_GEM/scripts/dispatch-hetero.sh"
H4="$TEST_TMP/home-mut-gem"
mkdir -p "$H4/.claude" "$H4/.gemini"
run_retreat_case mut_gem "$H4" "$MUT_GEM/scripts/dispatch-hetero.sh"
assert_neq "$(jget "$CASE_JSON" status)" "committed" "(4) missing ~/.gemini bind fails when agy writes \$HOME/.gemini"
assert_contains "$CASE_LOG" "native envelope and usage NOT parsed" "(4) missing ~/.gemini bind exits non-zero from agy"
assert_file_absent "$H4/.gemini/antigravity-cli/agy-reached.txt" "(4) agy could not create state file without ~/.gemini bind"

finalize_test
