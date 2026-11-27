#!/usr/bin/env bash
export AUTOPILOT_TEST_CN_GATE_OFF=1  # cn-model gate: sentinel dispatch tests carry no Size/Role/Scope
# dispatch-hetero cc-shim usage: the result JSON's "usage" for runner cc-shim is the
# HARNESS-WRITTEN envelope's (the claude CLI's `--output-format json` stdout, captured by
# dispatch-hetero.sh into $CCSHIM_ENVELOPE) `usage` object — four non-negative-integer
# keys — read from a file the worker never sees, not worker self-report and not the
# plain worker log (which carries no token counts). Seam: a stub `claude` on PATH whose
# stdout IS the envelope; own temp dirs; no real claude is started.
. "$(dirname "$0")/lib.sh"
eq() { assert_eq "$2" "$1" "$3"; }  # eq <expected> <actual> <msg>

export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; mkdir -p "$CLAUDE_CONFIG_DIR"
export AUTOPILOT_LIVE_DIR="$(mktemp -d -p /dev/shm autopilot-test-dhcu-XXXXXX)"
trap 'rm -rf "$AUTOPILOT_LIVE_DIR"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"; mkdir -p "$ENGINE_CAPABILITY_DIR"
export DISPATCH_QUIET=1
export TMPDIR="$TEST_TMP/tmp"; mkdir -p "$TMPDIR"   # the rails' mktemp scratch dirs land here, so leftovers are countable
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"; mkdir -p "$AUTOPILOT_DISPATCH_RUNS_DIR"
export ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  CLAUDE_CODE_SESSION_ID AUTOPILOT_SESSION_ID AUTOPILOT_PARENT_SESSION_ID \
  AUTOPILOT_FLEET_GATEWAY_ENDPOINTS 2>/dev/null || true
# S2 round 2: named endpoints the X-Fleet-Task cases dispatch to (TESTEP/qwen_local are the
# allowlisted gateways; glm is the cloud-looking non-gateway), plus the allowlist setting.
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="t"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL="http://127.0.0.1:9"
export AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN="t"
export AUTOPILOT_ENDPOINT_GLM_URL="https://api.z.ai/api/anthropic"
export AUTOPILOT_ENDPOINT_GLM_TOKEN="t"

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"; $GIT -C "$SBX" init -q; $GIT -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; echo "say ok" > "$PROMPT"

BINDIR="$TEST_TMP/bin"; mkdir -p "$BINDIR"
export CCSHIM_STUB_ARGV_FILE="$TEST_TMP/claude-argv.txt"   # one argv entry per line; the stub overwrites it on its one call
export CCSHIM_STUB_ENV_FILE="$TEST_TMP/claude-env.txt"     # @UNSET@ | the ANTHROPIC_CUSTOM_HEADERS the child actually saw
# stub claude: it records its argv (the assertion below reads what the rail actually put on the
# claude command line), dumps its ANTHROPIC_CUSTOM_HEADERS (X-Fleet-Task cases below), leaves one
# edit in the worktree (the rail's wrapper-commit then commits it, so the run lands
# "committed"/exit 0 like a real cc-shim hand) and its stdout is the harness envelope (claude
# --output-format json) — the case's envelope text, verbatim. The prompt is read from stdin like
# the real CLI; the worker never sees its own stdout back.
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$@" > "${CCSHIM_STUB_ARGV_FILE:-/dev/null}"
if [ -n "${CCSHIM_SCOPE_ENV_FILE:-}" ]; then
  printf '%s\n%s\n%s\n' "$HOME" "$CLAUDE_CONFIG_DIR" "${ANTHROPIC_BASE_URL:+set}" > "$CCSHIM_SCOPE_ENV_FILE"
fi
printf '%s' "${ANTHROPIC_CUSTOM_HEADERS-@UNSET@}" > "${CCSHIM_STUB_ENV_FILE:-/dev/null}"
cat >/dev/null
echo edited > ccshim-usage-edit.txt
printf '%s' "${CCSHIM_STUB_ENVELOPE:-ok}"
EOS
chmod +x "$BINDIR/claude"

# run_case <envelope-text> -> sets OUT (the one-line result JSON printed to stdout) + RC.
# CCSHIM_EP (optional): pass --endpoint <name> (the named-endpoint X-Fleet-Task cases).
# CCSHIM_ALLOWLIST (optional, default ''): AUTOPILOT_FLEET_GATEWAY_ENDPOINTS for the run —
# set-but-empty wins over any host config.json, so the default is hermetically "no gateway".
run_case() {
  local env_text="$1"
  local branch="feat/ccshim-usage-$RANDOM$RANDOM"
  local -a ep_args=()
  [ -n "${CCSHIM_EP:-}" ] && ep_args=(--endpoint "$CCSHIM_EP")
  RC=0
  OUT="$(cd "$SBX" && timeout 90 env -u REPO_ROOT -u CONSUMING_REPO_ROOT \
      CCSHIM_STUB_ENVELOPE="$env_text" PATH="$BINDIR:$PATH" \
      AUTOPILOT_FLEET_GATEWAY_ENDPOINTS="${CCSHIM_ALLOWLIST-}" \
      "$REPO_ROOT/scripts/dispatch-hetero.sh" --no-verify-tip --runner cc-shim --pin-reason "test fixture" --model MiniMax-M3 \
      --prompt-file "$PROMPT" --context-window off --branch "$branch" \
      ${ep_args[@]+"${ep_args[@]}"} 2>"$TEST_TMP/stderr")" || RC=$?
}

# result_json (stdin: the dispatch stdout) -> the one-line result JSON (the last parsable
# line that is an object with a "status" key); exit 3 when there is none.
result_json() {
  node -e '
const s = require("fs").readFileSync(0, "utf8");
let best = "";
for (const line of s.split("\n")) {
  const t = line.trim();
  if (!t.startsWith("{")) continue;
  try { const o = JSON.parse(t); if (o && typeof o === "object" && !Array.isArray(o) && "status" in o) best = t; } catch {}
}
if (best === "") process.exit(3);
process.stdout.write(best);
'
}
# usage_field (stdin: the result JSON) -> compact JSON of .usage, or <null>
usage_field() {
  node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write(o.usage === null ? "<null>" : JSON.stringify(o.usage));
'
}
# usage_deep_eq (stdin: the result JSON) <expected-JSON>: exit 0 iff .usage has EXACTLY
# the expected keys with exactly those values.
usage_deep_eq() {
  node -e '
const s = require("fs").readFileSync(0, "utf8");
const exp = JSON.parse(process.argv[1]);
const u = JSON.parse(s).usage;
const same = u && typeof u === "object" && !Array.isArray(u)
  && Object.keys(u).length === Object.keys(exp).length
  && Object.keys(exp).every((k) => u[k] === exp[k]);
process.exit(same ? 0 : 1);
' "$1"
}
# result_field (stdin: the result JSON) <field> -> the field's value as a string
result_field() {
  node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
const v = o[process.argv[1]];
process.stdout.write(v === null || v === undefined ? "<absent>" : String(v));
' "$1"
}
# num_turns_field (stdin: the result JSON) -> the value of .num_turns as a string:
# <integer>, the literal null, or <absent> when the key is not in the result.
num_turns_field() {
  node -e '
const o = JSON.parse(require("fs").readFileSync(0, "utf8"));
const v = o.num_turns;
process.stdout.write(v === undefined ? "<absent>" : (v === null ? "null" : String(v)));
'
}
# argv_value <file> <flag>: the single argument that IMMEDIATELY follows <flag> in a
# one-entry-per-line argv dump; prints nothing and returns 1 when the flag is absent.
argv_value() {
  local file="$1" flag="$2" prev="" a
  while IFS= read -r a; do
    if [ "$prev" = "$flag" ]; then printf '%s' "$a"; return 0; fi
    prev="$a"
  done < "$file"
  return 1
}

EXP1='{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":7,"cache_creation_input_tokens":0}'

# Emulate systemd's argv expansion, including its scope capability probe.
SCOPE_BIN="$TEST_TMP/scope-bin"; mkdir -p "$SCOPE_BIN"
cat > "$SCOPE_BIN/systemd-run" <<'EOS'
#!/usr/bin/env bash
expand=1
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --expand-environment=no) expand=0 ;;
    --) shift; break ;;
  esac
  shift
done
for arg in "$@"; do
  if [ "$expand" -eq 1 ] && [[ "$arg" == *'${'* ]]; then
    printf '%s\n' 'Invalid environment variable name evaluates to an empty string' >&2
    arg="$(printf '%s' "$arg" | sed 's/\${[^}]*}//g')"
  fi
  args+=("$arg")
done
exec "${args[@]}"
EOS
chmod +x "$SCOPE_BIN/systemd-run"
ln -s "$BINDIR/claude" "$SCOPE_BIN/claude"
ORIGINAL_BINDIR="$BINDIR"; BINDIR="$SCOPE_BIN"
export CCSHIM_SCOPE_ENV_FILE="$TEST_TMP/scope-env"
unset WORKER_CONTAINMENT_FORCE_NO_CGROUP
run_case '{"type":"result","is_error":false,"result":"ok"}'
assert_eq "$RC" "0" "scope: dispatch exits successfully"
SCOPE_HOME="$(sed -n '1p' "$CCSHIM_SCOPE_ENV_FILE" 2>/dev/null)"
SCOPE_CONFIG="$(sed -n '2p' "$CCSHIM_SCOPE_ENV_FILE" 2>/dev/null)"
SCOPE_ENDPOINT="$(sed -n '3p' "$CCSHIM_SCOPE_ENV_FILE" 2>/dev/null)"
assert_eq "$SCOPE_HOME" "$HOME" "scope: worker HOME is preserved"
assert_eq "$SCOPE_CONFIG" "$CLAUDE_CONFIG_DIR" "scope: worker config is preserved"
assert_eq "$SCOPE_ENDPOINT" "set" "scope: worker endpoint is present"
BINDIR="$ORIGINAL_BINDIR"; unset CCSHIM_SCOPE_ENV_FILE

# case 1: a result envelope WITH usage -> the result JSON carries exactly that object.
EN1='{"type":"result","is_error":false,"result":"ok","usage":{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":7,"cache_creation_input_tokens":0}}'
run_case "$EN1"
assert_eq "$RC" "0" "case1: cc-shim run exits 0 (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
# The cc-shim hand never gets the Task tools: the rail must pass --disallowedTools followed by
# EXACTLY the four tool names — otherwise the CLI's "task tools haven't been used recently"
# reminder lands mid-prompt and breaks the cached prefix on a prefix-caching endpoint.
# Red on the unfixed rail (the flag is absent from the argv).
AD1="$(argv_value "$CCSHIM_STUB_ARGV_FILE" --disallowedTools)"
eq "TaskCreate,TaskUpdate,TaskGet,TaskList" "$AD1" "case1: the cc-shim claude argv passes --disallowedTools followed by exactly TaskCreate,TaskUpdate,TaskGet,TaskList (got: '$AD1')"
U1="$(printf '%s' "$OUT" | result_json | usage_field 2>/dev/null)" || U1="<no-result-json>"
eq "cc-shim" "$(printf '%s' "$OUT" | result_json | result_field runner 2>/dev/null)" "case1: the run is the cc-shim runner"
eq "$EXP1" "$U1" "case1: result usage is exactly the envelope usage object (got: $U1)"
if printf '%s' "$OUT" | result_json | usage_deep_eq "$EXP1"; then
  eq "0" "0" "case1: usage deep-equals the envelope object (exactly the four keys)"
else
  fail "case1: usage does not deep-equal $EXP1 (got: $U1)"
fi

# case 2: a result envelope WITHOUT a usage object -> usage stays null.
EN2='{"type":"result","is_error":false,"result":"ok"}'
run_case "$EN2"
assert_eq "$RC" "0" "case2: cc-shim run exits 0"
U2="$(printf '%s' "$OUT" | result_json | usage_field 2>/dev/null)" || U2="<no-result-json>"
eq "<null>" "$U2" "case2: result without a usage object keeps usage null (got: $U2)"
NT2="$(printf '%s' "$OUT" | result_json | num_turns_field 2>/dev/null)" || NT2="<no-result-json>"
eq "null" "$NT2" "case2: envelope without a num_turns keeps num_turns null (got: $NT2)"

# case 3: the envelope is not JSON at all -> usage stays null.
run_case 'this is not json at all'
assert_eq "$RC" "0" "case3: cc-shim run exits 0"
U3="$(printf '%s' "$OUT" | result_json | usage_field 2>/dev/null)" || U3="<no-result-json>"
eq "<null>" "$U3" "case3: non-JSON envelope keeps usage null (got: $U3)"
NT3="$(printf '%s' "$OUT" | result_json | num_turns_field 2>/dev/null)" || NT3="<no-result-json>"
eq "null" "$NT3" "case3: non-JSON envelope keeps num_turns null (got: $NT3)"

# case 4: a result envelope WITH an integer num_turns -> the result JSON carries it
# next to usage, verbatim; the usage object is untouched.
EN4='{"type":"result","is_error":false,"result":"ok","num_turns":18,"usage":{"input_tokens":120,"output_tokens":45,"cache_read_input_tokens":7,"cache_creation_input_tokens":0}}'
run_case "$EN4"
assert_eq "$RC" "0" "case4: cc-shim run exits 0 (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
U4="$(printf '%s' "$OUT" | result_json | usage_field 2>/dev/null)" || U4="<no-result-json>"
eq "$EXP1" "$U4" "case4: result usage is still exactly the envelope usage object (got: $U4)"
NT4="$(printf '%s' "$OUT" | result_json | num_turns_field 2>/dev/null)" || NT4="<no-result-json>"
eq "18" "$NT4" "case4: result num_turns is the envelope integer (got: $NT4)"

# S2 X-Fleet-Task gateway join (2026-11-14) + S2 round 2 allowlist: cc-shim requests carry
# X-Fleet-Task only when the run's NAMED endpoint is allowlisted as a fleet gateway
# (AUTOPILOT_FLEET_GATEWAY_ENDPOINTS) AND AUTOPILOT_UPSTREAM_TASK_ID is a ULID (both checks in
# lib/fleet-task-header.js). Red on the unfixed rail: the rail never set ANTHROPIC_CUSTOM_HEADERS.
ULID_OK="01ARZ3NDEKTSV4RRFFQ69G5FAV"

# case 5: allowlisted endpoint + a valid ULID -> the child's ANTHROPIC_CUSTOM_HEADERS is exactly
# the one X-Fleet-Task line.
CCSHIM_EP=TESTEP CCSHIM_ALLOWLIST=TESTEP AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" run_case "$EN1"
assert_eq "$RC" "0" "case5: cc-shim run exits 0 with a valid upstream task id (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq "X-Fleet-Task: $ULID_OK" "$(cat "$CCSHIM_STUB_ENV_FILE")" \
  "case5: valid ULID on allowlisted TESTEP -> child env is exactly 'X-Fleet-Task: <V>' (got: '$(cat "$CCSHIM_STUB_ENV_FILE")')"
unset CCSHIM_EP CCSHIM_ALLOWLIST

# case 6: id unset + an inherited ANTHROPIC_CUSTOM_HEADERS -> the child must NOT see the inherited
# value (the rail drops it and sets nothing). Red on the unfixed rail: 'Evil: 1' passed straight through.
unset AUTOPILOT_UPSTREAM_TASK_ID
export ANTHROPIC_CUSTOM_HEADERS="Evil: 1"
run_case "$EN1"
assert_eq "$RC" "0" "case6: cc-shim run exits 0 without an upstream task id (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq "@UNSET@" "$(cat "$CCSHIM_STUB_ENV_FILE")" \
  "case6: unset id -> no X-Fleet-Task and the inherited ANTHROPIC_CUSTOM_HEADERS never reaches the child (got: '$(cat "$CCSHIM_STUB_ENV_FILE")')"
unset ANTHROPIC_CUSTOM_HEADERS

# case 7: allowlisted endpoint, id set but not a ULID (newline + a second header = injection
# attempt) -> no header reaches the child and the rail names the refusal on stderr. Red on the
# unfixed rail: the raw value passed through.
CCSHIM_EP=TESTEP CCSHIM_ALLOWLIST=TESTEP AUTOPILOT_UPSTREAM_TASK_ID=$'01ABC\nX-Evil: 1' run_case "$EN1"
assert_eq "$RC" "0" "case7: cc-shim run still exits 0 with a non-ULID upstream task id (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq "@UNSET@" "$(cat "$CCSHIM_STUB_ENV_FILE")" \
  "case7: non-ULID id -> no header reaches the child (got: '$(cat "$CCSHIM_STUB_ENV_FILE")')"
assert_contains "$(cat "$TEST_TMP/stderr")" \
  "dispatch-hetero: AUTOPILOT_UPSTREAM_TASK_ID is not a ULID; X-Fleet-Task not sent" \
  "case7: the rail says on stderr that X-Fleet-Task was not sent"
unset AUTOPILOT_UPSTREAM_TASK_ID CCSHIM_EP CCSHIM_ALLOWLIST

# case 8 (S2 round 2, the PM red test): a valid ULID on a cloud-looking endpoint NOT in the
# allowlist (glm, https URL) -> NO header reaches the child and the rail stays silent (not
# allowlisted is the normal case). Red at 2180f0238: the header was present.
: > "$CCSHIM_STUB_ENV_FILE"; : > "$TEST_TMP/stderr"
CCSHIM_EP=glm CCSHIM_ALLOWLIST=TESTEP AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" run_case "$EN1"
assert_eq "$RC" "0" "case8: cc-shim run exits 0 on a non-allowlisted endpoint (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq "@UNSET@" "$(cat "$CCSHIM_STUB_ENV_FILE")" \
  "case8: valid ULID on non-allowlisted glm -> no X-Fleet-Task reaches the child (got: '$(cat "$CCSHIM_STUB_ENV_FILE")')"
assert_not_contains "$(cat "$TEST_TMP/stderr")" "X-Fleet-Task not sent" \
  "case8: no warning line on a non-gateway endpoint (not allowlisted is the normal case)"
unset CCSHIM_EP CCSHIM_ALLOWLIST AUTOPILOT_UPSTREAM_TASK_ID

# case 9 (S2 round 2): no endpoint name at all (raw ANTHROPIC_BASE_URL) + a valid ULID -> no
# header. Red at 2180f0238: the header was present.
: > "$CCSHIM_STUB_ENV_FILE"; : > "$TEST_TMP/stderr"
AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" run_case "$EN1"
assert_eq "$RC" "0" "case9: cc-shim run exits 0 without a named endpoint (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq "@UNSET@" "$(cat "$CCSHIM_STUB_ENV_FILE")" \
  "case9: valid ULID with no endpoint name -> no X-Fleet-Task reaches the child (got: '$(cat "$CCSHIM_STUB_ENV_FILE")')"
unset AUTOPILOT_UPSTREAM_TASK_ID

# case 10 (S2 round 2): allowlist matching is case-insensitive (TESTEP allowlist vs testep endpoint) ->
# header present.
CCSHIM_EP=testep CCSHIM_ALLOWLIST=TESTEP AUTOPILOT_UPSTREAM_TASK_ID="$ULID_OK" run_case "$EN1"
assert_eq "$RC" "0" "case10: cc-shim run exits 0 on the case-insensitive allowlist match (stderr: $(tail -c 300 "$TEST_TMP/stderr" 2>/dev/null))"
eq "X-Fleet-Task: $ULID_OK" "$(cat "$CCSHIM_STUB_ENV_FILE")" \
  "case10: valid ULID, allowlist TESTEP matches endpoint testep -> child env is exactly 'X-Fleet-Task: <V>' (got: '$(cat "$CCSHIM_STUB_ENV_FILE")')"
unset CCSHIM_EP CCSHIM_ALLOWLIST AUTOPILOT_UPSTREAM_TASK_ID

finalize_test
