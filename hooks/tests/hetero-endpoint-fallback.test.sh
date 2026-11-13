#!/usr/bin/env bash
# BL-0435: dispatch-hetero --endpoint re-dispatches to the configured cloud rung when the
# pre-probe is unreachable or busy, inside the same bwrap sandbox, and writes fell_back.
# The anthropic-compatible transport still rejects a non-loopback http:// base URL, and the
# error names the cc-shim rail. Review of a committed fallback is not skipped. Manifest
# reconciliation counts fell_back apart from ordinary dispatches.
# No real network: 127.0.0.1 only. No real runner: stub codex, bwrap, and claude on PATH.
. "$(dirname "$0")/lib.sh"
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
export AUTOPILOT_ENDPOINT_GPU1_TOKEN="fake-token-not-real"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session-mode"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SRV_JS="$TEST_TMP/models-server.js"
cat > "$SRV_JS" <<'NODE'
const http = require('http');
const fs = require('fs');
const [portFile, modeFile, hitsFile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  fs.appendFileSync(hitsFile, `${req.method} ${req.url}\n`);
  const mode = fs.readFileSync(modeFile, 'utf8').trim();
  if (mode === 'hang') return;
  if (mode === 'busy') {
    res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end('{"error":"busy"}');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ object: 'list', data: [{ id: 'mini' }] }));
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
NODE
MODE_FILE="$TEST_TMP/srv.mode"; PORT_FILE="$TEST_TMP/srv.port"; HITS_FILE="$TEST_TMP/srv.hits"
printf 'ok' > "$MODE_FILE"; : > "$HITS_FILE"
node "$SRV_JS" "$PORT_FILE" "$MODE_FILE" "$HITS_FILE" &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null; cleanup_test_tmp' EXIT
for _ in $(seq 1 50); do [ -s "$PORT_FILE" ] && break; sleep 0.1; done
SRV_PORT="$(cat "$PORT_FILE")"
[ -n "$SRV_PORT" ] || fail "fake /models server did not start"
DEAD_PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"

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
BWRAP_ARGV_LOG="$TEST_TMP/bwrap-argv.log"
CODEX_ARGV_LOG="$TEST_TMP/codex-argv.log"
AGY_ARGV_LOG="$TEST_TMP/agy-argv.log"
CLAUDE_CALLS="$TEST_TMP/claude.calls"
export BWRAP_ARGV_LOG CODEX_ARGV_LOG AGY_ARGV_LOG CLAUDE_CALLS

cat > "$BINDIR/bwrap" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BWRAP_ARGV_LOG"
sep=0
for ((i=1; i<=$#; i++)); do
  if [ "${!i}" = "--" ]; then sep=$i; fi
done
if [ "$sep" -eq 0 ]; then exit 0; fi
shift "$sep"
exec "$@"
EOS
cat > "$BINDIR/codex" <<'EOS'
#!/usr/bin/env bash
if [ "${1:-}" = "exec" ] && [ "${2:-}" = "--help" ]; then
  printf '%s\n' "--dangerously-bypass-hook-trust"
  exit 0
fi
if [ "${1:-}" = "--version" ]; then
  printf '%s\n' "codex-stub"
  exit 0
fi
printf '%s\n' "$*" >> "$CODEX_ARGV_LOG"
echo edited >> sandbox-edit.txt
exit 0
EOS
cat > "$BINDIR/claude" <<'EOS'
#!/usr/bin/env bash
cat >/dev/null
echo x >> "$CLAUDE_CALLS"
echo edited >> sandbox-edit.txt
printf '%s' '{"type":"result","is_error":false,"result":"ok"}'
EOS
cat > "$BINDIR/agy" <<'EOS'
#!/usr/bin/env bash
case "${*}" in
  *--input-format*) cat >/dev/null ;;
esac
printf '%s\n' "$*" >> "${AGY_ARGV_LOG:?}"
echo edited >> sandbox-edit.txt
printf '%s\n' '{"event":"result","result":{"status":"SUCCESS","response":"ok"}}'
exit 0
EOS
chmod +x "$BINDIR/bwrap" "$BINDIR/codex" "$BINDIR/claude" "$BINDIR/agy"
make_agy_stub_versioned "$BINDIR/agy"

CFG_FB="$TEST_TMP/cfg-fb.md"
printf -- '- on_engine_unavailable: cloud-fallback\n- cloud_fallback_rung: gpt-5.6-sol/high@codex\n' > "$CFG_FB"
CFG_ASK="$TEST_TMP/cfg-ask.md"
printf -- '- on_engine_unavailable: ask\n- cloud_fallback_rung: gpt-5.6-sol/high@codex\n' > "$CFG_ASK"

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

# dispatch_case <tag> <port> <mode> <config> [extra hetero args...]
# Sets CASE_JSON CASE_RC CASE_ERR CASE_CAP
dispatch_case() {
  local tag="$1" port="$2" mode="$3" cfg="$4"
  shift 4
  CASE_CAP="$TEST_TMP/cap-$tag"
  local runs="$TEST_TMP/runs-$tag"
  mkdir -p "$CASE_CAP" "$runs"
  seed_dogfood_implementer_pin "$CASE_CAP" >/dev/null
  : > "$BWRAP_ARGV_LOG"
  : > "$CODEX_ARGV_LOG"
  : > "$AGY_ARGV_LOG"
  : > "$CLAUDE_CALLS"
  printf '%s' "$mode" > "$MODE_FILE"
  export AUTOPILOT_ENDPOINT_GPU1_URL="http://127.0.0.1:${port}"
  local out="$TEST_TMP/out-$tag" err="$TEST_TMP/err-$tag"
  CASE_RC=0
  local script="${HETERO_SCRIPT:-$REPO_ROOT/scripts/dispatch-hetero.sh}"
  (cd "$SBX" && timeout 180 env PATH="$BINDIR:$PATH" \
      ENGINE_CAPABILITY_DIR="$CASE_CAP" \
      REVIEW_LOOP_CONFIG_OVERRIDE="$cfg" \
      AUTOPILOT_DISPATCH_RUNS_DIR="$runs" \
      "$script" \
      --runner cc-shim --model mini --effort high \
      --branch "feat/fb-$tag" \
      --prompt-file "$PROMPT" --context-window off \
      --endpoint gpu1 --sandbox bwrap --worktree-parent "$WTS" \
      "$@" >"$out" 2>"$err" < /dev/null) || CASE_RC=$?
  CASE_ERR="$(cat "$err" 2>/dev/null || true)"
  CASE_JSON="$(result_line "$out")"
}

# The worker record starts at --die-with-parent. The bash -c script embeds newlines, so a
# line-oriented grep of the separator misses the codex argument on a later physical line.
# Preflight is `--ro-bind ... true` and has no --die-with-parent. runner_bin_fallback keeps
# a bare name that PATH already resolves, so the record says `codex`, not a path.
bwrap_worker_line() {
  awk 'BEGIN{p=0} index($0, "--die-with-parent"){p=1} p{print}' "$BWRAP_ARGV_LOG"
}

# --- (1) 503 re-dispatches to the named cloud seat, same bwrap, fell_back written ---
dispatch_case busy "$SRV_PORT" busy "$CFG_FB"
assert_neq "$(jget "$CASE_JSON" status)" "engine_unavailable" "(1) 503 must not end as engine_unavailable (rc=$CASE_RC stderr=$(printf '%s' "$CASE_ERR" | tail -c 500))"
assert_eq "$(jget "$CASE_JSON" runner)" "codex" "(1) the result runner is the cloud rung"
assert_eq "$(jget "$CASE_JSON" fell_back.to_rung)" "gpt-5.6-sol/high@codex" "(1) fell_back names the cloud rung"
assert_eq "$(jget "$CASE_JSON" fell_back.from_endpoint)" "gpu1" "(1) fell_back names the endpoint that failed"
assert_eq "$(jget "$CASE_JSON" fell_back.error_class)" "endpoint_busy" "(1) fell_back class is endpoint_busy"
assert_eq "$(jget "$CASE_JSON" fell_back.probe.decision)" "busy" "(1) fell_back keeps the probe"
assert_contains "$CASE_ERR" "retreating once to cloud rung gpt-5.6-sol/high@codex" "(1) the retreat is printed, never silent"
[ -s "$CODEX_ARGV_LOG" ] || fail "(1) the cloud seat was not invoked"
BWRAP_WORKER="$(bwrap_worker_line)"
assert_contains "$BWRAP_WORKER" "codex" "(1) the cloud worker ran under bwrap"
case "$BWRAP_WORKER" in
  *dispatch-hetero-sandbox-*/autopilot-managed-codex-home-*) ;;
  *) fail "(1) the managed Codex home is not inside the bwrap scratch" ;;
esac
assert_not_contains "$BWRAP_WORKER" "--endpoint" "(1) the retreat drops --endpoint"
[ ! -s "$CLAUDE_CALLS" ] || fail "(1) the local cc-shim worker must not run after a busy probe"
ROWS="$(grep -c . "$CASE_CAP/cloud-fallbacks.jsonl" 2>/dev/null || true)"
assert_eq "$ROWS" "1" "(1) one cloud-fallbacks row"
assert_contains "$(cat "$CASE_CAP/cloud-fallbacks.jsonl")" '"from_endpoint":"gpu1"' "(1) the row names the endpoint"
assert_contains "$(cat "$CASE_CAP/cloud-fallbacks.jsonl")" '"error_class":"endpoint_busy"' "(1) the row names the class"
assert_contains "$(cat "$CASE_CAP/cloud-fallbacks.jsonl")" '"to_rung":"gpt-5.6-sol/high@codex"' "(1) the row names the rung"
BUSY_STATUS="$(jget "$CASE_JSON" status)"
assert_contains "$(cat "$CASE_CAP/cloud-fallbacks.jsonl")" "\"outcome\":\"$BUSY_STATUS\"" "(1) the row outcome is the result status"
MANIFESTS="$(find "$TEST_TMP/runs-busy" -name '*.manifest.json' -type f 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "$MANIFESTS" "1" "(1) the fallback child writes one manifest"
MF="$(find "$TEST_TMP/runs-busy" -name '*.manifest.json' -type f | head -n 1)"
assert_eq "$(jget "$(cat "$MF")" fell_back.from_endpoint)" "gpu1" "(1) the manifest records fell_back"

# --- (1b) a refused pre-probe is the same retreat, class endpoint_unreachable ---
dispatch_case dead "$DEAD_PORT" ok "$CFG_FB"
assert_eq "$(jget "$CASE_JSON" fell_back.error_class)" "endpoint_unreachable" "(1b) closed port: fell_back class is endpoint_unreachable (rc=$CASE_RC stderr=$(printf '%s' "$CASE_ERR" | tail -c 400))"
assert_eq "$(jget "$CASE_JSON" fell_back.probe.decision)" "unreachable" "(1b) probe decision unreachable"
[ -s "$CODEX_ARGV_LOG" ] || fail "(1b) closed port: the cloud seat was not invoked"
assert_contains "$(bwrap_worker_line)" "codex" "(1b) closed port: the cloud worker ran under bwrap"

# --- (ask) policy ask stays engine_unavailable, no cloud seat, no row ---
dispatch_case ask "$SRV_PORT" busy "$CFG_ASK"
assert_eq "$(jget "$CASE_JSON" status)" "engine_unavailable" "(ask) policy ask stays engine_unavailable"
assert_eq "$(jget "$CASE_JSON" fell_back)" "null" "(ask) no fell_back record"
assert_eq "$(jget "$CASE_JSON" probe.decision)" "busy" "(ask) the probe is still on the result"
[ ! -s "$CODEX_ARGV_LOG" ] || fail "(ask) the cloud seat must not run"
[ ! -e "$CASE_CAP/cloud-fallbacks.jsonl" ] || fail "(ask) no cloud-fallbacks row"
assert_not_contains "$CASE_ERR" "retreating once" "(ask) ask does not announce a retreat"

# --- (healthy) a passing probe stays on the local seat ---
dispatch_case ok "$SRV_PORT" ok "$CFG_FB"
assert_eq "$(jget "$CASE_JSON" probe.decision)" "ok" "(healthy) probe ok (rc=$CASE_RC stderr=$(printf '%s' "$CASE_ERR" | tail -c 400))"
assert_eq "$(jget "$CASE_JSON" fell_back)" "null" "(healthy) no fell_back"
assert_neq "$(jget "$CASE_JSON" status)" "engine_unavailable" "(healthy) not engine_unavailable"
[ -s "$CLAUDE_CALLS" ] || fail "(healthy) the local worker did not run"
[ ! -s "$CODEX_ARGV_LOG" ] || fail "(healthy) the cloud seat must not run"
[ ! -e "$CASE_CAP/cloud-fallbacks.jsonl" ] || fail "(healthy) no cloud-fallbacks row"

# --- (3) manifest reconciliation counts fell_back separately ---
REC="$TEST_TMP/reconcile"
mkdir -p "$REC"
printf '%s\n' '{"schema":1,"run_id":"ordinary-1","final_status":"committed"}' > "$REC/a.manifest.json"
printf '%s\n' '{"schema":1,"run_id":"fb-1","final_status":"committed","fell_back":{"from_endpoint":"gpu1","to_rung":"gpt-5.6-sol/high@codex"}}' > "$REC/b.manifest.json"
printf '%s\n' '{not-json' > "$REC/c.manifest.json"
printf '%s\n' '{"artifact_type":"plan_review_panel_manifest","fell_back":{"from_endpoint":"gpu1"}}' > "$REC/panel-x.manifest.json"
REC_OUT="$(node "$REPO_ROOT/scripts/dispatch-status.js" --reconcile --dir "$REC" 2>"$TEST_TMP/reconcile.err")" || fail "(3) --reconcile failed: $(cat "$TEST_TMP/reconcile.err")"
assert_eq "$(jget "$REC_OUT" ordinary)" "1" "(3) one ordinary manifest"
assert_eq "$(jget "$REC_OUT" fell_back)" "1" "(3) one fell_back manifest, not also ordinary"
assert_eq "$(jget "$REC_OUT" unreadable)" "1" "(3) one unreadable manifest"

# --- (engine) a result that already fell back is not retreated a second time ---
cat > "$TEST_TMP/once.js" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, mode] = process.argv.slice(2);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const calls = [];
const base = '1111111111111111111111111111111111111111';
const fell = mode === 'fell';
const engine = new AutopilotEngine({
  clock: () => 1782864000000,
  implementationDispatcher(args) {
    calls.push(args);
    if (calls.length > 3) throw new Error('runaway retreat');
    const result = {
      status: 'engine_unavailable', runner: 'cc-shim', model: 'mini', commit: null, base,
      branch: 'impl-branch', files_changed: 0, insertions: 0, deletions: 0, worktree: null, agent_log: null,
      error: 'engine unavailable (endpoint_unreachable): endpoint pre-probe gpu1: refused; no worker started',
    };
    if (fell) result.fell_back = { from_runner: 'cc-shim', from_endpoint: 'gpu1', error_class: 'endpoint_unreachable', to_rung: 'gpt-5.6-sol/high@codex' };
    return { error: null, status: 1, signal: null, stdout: '', stderr: '', parseError: null, result };
  },
});
const out = engine.implementTask({
  promptFile: path.join(root, 'hooks', 'tests', 'hetero-endpoint-fallback.test.sh'),
  branch: 'impl-branch', base, runId: 'run-fb-1', implementationRound: 1,
  extraImplementationArgs: ['--endpoint', 'gpu1'],
  roster: {
    implementer_engine: 'mini', implementer_effort: 'high', implementer_runner: 'cc-shim',
    implementer_endpoint: 'gpu1', on_engine_unavailable: 'cloud-fallback',
    cloud_fallback_rung: { engine: 'gpt-5.6-sol', effort: 'high', runner: 'codex' },
  },
});
const directive = out.engine_unavailable || {};
process.stdout.write(`calls=${calls.length} action=${directive.action || ''} exhausted=${directive.cloud_fallback_exhausted === true}\n`);
NODE
ONCE_FELL="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-once-fell" node "$TEST_TMP/once.js" "$REPO_ROOT" fell 2>"$TEST_TMP/once-fell.err")" || fail "(engine) fell_back case threw: $(cat "$TEST_TMP/once-fell.err")"
assert_eq "$ONCE_FELL" "calls=1 action=escalate exhausted=true" "(engine) one prior fell_back does not re-dispatch"
ONCE_PLAIN="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-once-plain" node "$TEST_TMP/once.js" "$REPO_ROOT" plain 2>"$TEST_TMP/once-plain.err")" || fail "(engine) plain case threw: $(cat "$TEST_TMP/once-plain.err")"
assert_contains "$ONCE_PLAIN" "calls=2" "(engine) a probe failure without fell_back still retreats once"

# --- (2) a committed fallback is reviewed; fell_back does not skip review ---
cat > "$TEST_TMP/review.js" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, tmp, withFell] = process.argv.slice(2);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
fs.mkdirSync(tmp, { recursive: true });
const prompt = path.join(tmp, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt\n');
const diff = path.join(tmp, 'review.diff');
fs.writeFileSync(diff, 'diff --git a/x b/x\n+line\n');
let reviews = 0;
const base = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const seats = [{ role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high', endpoint: null, family: 'anthropic' }];
const engine = new AutopilotEngine({
  cwd: tmp,
  clock: () => '2026-07-26T00:00:04.000Z',
  diffProvider() { return diff; },
  implementationDispatcher() {
    const result = {
      status: 'committed', runner: 'codex', model: 'gpt-5.6-sol', branch: 'feat/review', base, commit,
      files_changed: 1, insertions: 1, deletions: 0, worktree: null, agent_log: '/tmp/l', error: null,
      contained: true, containment: 'plain', dispatcher_called: true, model_calls: 1,
    };
    if (withFell === 'fell') {
      result.fell_back = { from_runner: 'cc-shim', from_endpoint: 'gpu1', error_class: 'endpoint_busy', to_rung: 'gpt-5.6-sol/high@codex' };
    }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null, result };
  },
  reviewDispatcher() {
    reviews += 1;
    return { error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: { runner: 'cc-shim', model: 'claude-opus-4-6', status: 'reviewed', verdict: 'SHIP-AS-IS',
        findings: '', raw_log: '/tmp/review-log', error: null } };
  },
});
const out = engine.runImplementationReviewLoop({
  promptFile: prompt, branch: 'feat/review', base,
  legacyUnmanaged: true, noVerifyFirst: true,
  roster: {
    reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim', reviewer_qualified: true,
    implementer_engine: 'mini', implementer_effort: 'high', implementer_runner: 'cc-shim',
    implementer_endpoint: 'gpu1', implementer_family: 'zhipu',
    on_engine_unavailable: 'cloud-fallback',
    cloud_fallback_rung: { engine: 'gpt-5.6-sol', effort: 'high', runner: 'codex' },
    loop_max_rounds: 1, loop_convergence_verdict: 'SHIP-AS-IS', min_panel_size: 1, in_rail_review: 'single',
    qc_panel_seats_complete: true, qc_panel_seats: seats, override_admitted_seats: ['qc_panel[0]'],
  },
});
process.stdout.write(`status=${out.status} reviews=${reviews} review_null=${out.review == null}\n`);
NODE
REV_FELL="$(node "$TEST_TMP/review.js" "$REPO_ROOT" "$TEST_TMP/rev-fell" fell 2>"$TEST_TMP/rev-fell.err")" || fail "(2) fallback review threw: $(tail -c 500 "$TEST_TMP/rev-fell.err")"
assert_contains "$REV_FELL" "reviews=1" "(2) a committed fell_back result is reviewed ($REV_FELL)"
assert_contains "$REV_FELL" "review_null=false" "(2) review is not null for a fallback"
REV_PLAIN="$(node "$TEST_TMP/review.js" "$REPO_ROOT" "$TEST_TMP/rev-plain" plain 2>"$TEST_TMP/rev-plain.err")" || fail "(2) plain review threw: $(tail -c 500 "$TEST_TMP/rev-plain.err")"
assert_contains "$REV_PLAIN" "reviews=1" "(2) a committed result without fell_back is reviewed ($REV_PLAIN)"

# --- (B) non-loopback http stays rejected, and the error names the cc-shim rail ---
DIFF="$TEST_TMP/tiny.diff"
printf 'diff --git a/x b/x\n+line\n' > "$DIFF"
anthro() {
  node "$1" --model mini --diff-file "$DIFF" --base-url "$2" 2>"$TEST_TMP/anthro.err" || true
}
ANTHRO="$REPO_ROOT/scripts/dispatch-anthropic-review.js"
HTTP_ERR="$(anthro "$ANTHRO" "http://example.invalid/v1")"
assert_contains "$HTTP_ERR" "base URL must use https:// unless it is an http:// loopback test endpoint" "(B) non-loopback http is still rejected"
assert_contains "$HTTP_ERR" "cc-shim" "(B) the error names the cc-shim rail"
LOOP_ERR="$(anthro "$ANTHRO" "http://127.0.0.1:9/v1")"
assert_not_contains "$LOOP_ERR" "must use https://" "(B) loopback http is still allowed"
HTTPS_ERR="$(anthro "$ANTHRO" "https://example.invalid/v1")"
assert_not_contains "$HTTPS_ERR" "must use https://" "(B) https is still allowed"

# Negative controls. Each mutant is the positive check with one line broken. The suite stays
# green only when that check goes red on the mutant. Ask-policy (above) is the policy control.

# The mutant script's own directory is its repo's scripts/, so resolve-review-loop.sh still
# finds the roster template at ../project-config-template. A loose copy in $TEST_TMP does not.
mut_hetero() {
  local name="$1" expr="$2" t="$TEST_TMP/root-$1" f base
  rm -rf "$t"
  mkdir -p "$t/scripts"
  for f in "$REPO_ROOT"/*; do
    base="$(basename "$f")"
    [ "$base" = "scripts" ] && continue
    ln -s "$f" "$t/$base"
  done
  for f in "$REPO_ROOT/scripts/"*; do
    ln -s "$f" "$t/scripts/$(basename "$f")"
  done
  rm -f "$t/scripts/dispatch-hetero.sh"
  sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$t/scripts/dispatch-hetero.sh" "$expr" || return 1
  chmod +x "$t/scripts/dispatch-hetero.sh"
  printf '%s' "$t/scripts/dispatch-hetero.sh"
}
mut_engine() {
  local name="$1" expr="$2" t="$TEST_TMP/tree-$1" d f base
  rm -rf "$t"
  mkdir -p "$t"
  for d in src scripts schemas project-config-template references profiles; do
    cp -a "$REPO_ROOT/$d" "$t/$d"
  done
  # The engine requires hooks/_shared and other repo-root modules by relative path.
  for f in "$REPO_ROOT"/* "$REPO_ROOT"/.[!.]* "$REPO_ROOT"/..?*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    [ -e "$t/$base" ] && continue
    ln -s "$f" "$t/$base"
  done
  sed_mutant "$REPO_ROOT/src/engine/autopilot-engine.js" "$t/src/engine/autopilot-engine.js" "$expr" || return 1
  printf '%s' "$t"
}

# N-silent: the result suffix returns before it writes fell_back.
SILENT="$(mut_hetero silent 's/fell_back_json_suffix() {/fell_back_json_suffix() { return 0;/')" || fail "N-silent mutant did not apply"
HETERO_SCRIPT="$SILENT" dispatch_case nsilent "$SRV_PORT" busy "$CFG_FB"
NS_RUNG="$(jget "$CASE_JSON" fell_back.to_rung)"
[ -s "$CODEX_ARGV_LOG" ] || fail "N-silent mutant did not reach the cloud seat"
[ "$NS_RUNG" = "gpt-5.6-sol/high@codex" ] && fail "N-silent mutant still wrote fell_back.to_rung"
echo "mutant-red N-silent fell_back.to_rung=$NS_RUNG"
unset HETERO_SCRIPT

# N-bwrap: the keep arm no longer matches, so the re-exec drops --sandbox and --worktree-parent.
BWRAP_MUT="$(mut_hetero bwrap 's@--sandbox|--worktree-parent) # BL-0435 keep the caller bwrap on this one re-exec@--not-sandbox|--not-worktree-parent) # BL-0435 keep the caller bwrap on this one re-exec@')" || fail "N-bwrap mutant did not apply"
HETERO_SCRIPT="$BWRAP_MUT" dispatch_case nbwrap "$SRV_PORT" busy "$CFG_FB"
[ -s "$CODEX_ARGV_LOG" ] || fail "N-bwrap mutant did not reach the cloud seat"
case "$(bwrap_worker_line)" in
  *codex*) fail "N-bwrap mutant still ran codex under bwrap" ;;
esac
echo "mutant-red N-bwrap worker_has_codex=no"
unset HETERO_SCRIPT

# N-count: every fell_back manifest is counted as ordinary.
COUNT_DIR="$TEST_TMP/status-mut"
mkdir -p "$COUNT_DIR"
ln -s "$REPO_ROOT/scripts/lib" "$COUNT_DIR/lib"
COUNT_JS="$COUNT_DIR/dispatch-status.js"
sed_mutant "$REPO_ROOT/scripts/dispatch-status.js" "$COUNT_JS" 's/out.fell_back += 1/out.ordinary += 1/' || fail "N-count mutant did not apply"
COUNT_OUT="$(node "$COUNT_JS" --reconcile --dir "$REC" 2>"$TEST_TMP/reconcile-mut.err")" || fail "N-count --reconcile failed: $(cat "$TEST_TMP/reconcile-mut.err")"
COUNT_FB="$(jget "$COUNT_OUT" fell_back)"
[ "$COUNT_FB" = "1" ] && fail "N-count mutant still counted fell_back separately"
echo "mutant-red N-count fell_back=$COUNT_FB ordinary=$(jget "$COUNT_OUT" ordinary)"

# N-https: accepting every http:// removes the rejection. Keeping the old sentence hides cc-shim.
# The script requires ./lib and ../hooks, so the copy sits in a scripts/ directory.
ANTHRO_ROOT="$TEST_TMP/anthro-root"
mkdir -p "$ANTHRO_ROOT/scripts"
ln -s "$REPO_ROOT/hooks" "$ANTHRO_ROOT/hooks"
ln -s "$REPO_ROOT/scripts/lib" "$ANTHRO_ROOT/scripts/lib"
HTTP_LOOSE="$ANTHRO_ROOT/scripts/loose.js"
sed_mutant "$ANTHRO" "$HTTP_LOOSE" "s|return 'base URL must use https:// unless it is an http:// loopback test endpoint; a non-loopback http:// endpoint is the cc-shim rail (--runner cc-shim), not this anthropic-compatible transport';|return '';|" || fail "N-https loose mutant did not apply"
LOOSE_ERR="$(anthro "$HTTP_LOOSE" "http://example.invalid/v1")"
case "$LOOSE_ERR" in
  *"must use https://"*) fail "N-https loose mutant still rejected non-loopback http" ;;
esac
echo "mutant-red N-https-loose rejected=no"
HTTP_OLD="$ANTHRO_ROOT/scripts/old.js"
sed_mutant "$ANTHRO" "$HTTP_OLD" 's#; a non-loopback http:// endpoint is the cc-shim rail (--runner cc-shim), not this anthropic-compatible transport##' || fail "N-https old-message mutant did not apply"
OLD_ERR="$(anthro "$HTTP_OLD" "http://example.invalid/v1")"
case "$OLD_ERR" in
  *cc-shim*) fail "N-https old message still names cc-shim" ;;
esac
assert_contains "$OLD_ERR" "must use https://" "N-https old message still rejects non-loopback http"
echo "mutant-red N-https-old names_cc_shim=no"

# N-engine: without the fell_back guard the engine retreats again.
ENG_TREE="$(mut_engine once "s/if (parsed && parsed.fell_back && typeof parsed.fell_back === 'object' && !Array.isArray(parsed.fell_back)/if (false) {/")" || fail "N-engine mutant did not apply"
sed_mutate "$ENG_TREE/src/engine/autopilot-engine.js" "s/&& engineUnavailable && engineUnavailable.action === 'cloud-fallback') {/\\/\\/ guard removed/" || fail "N-engine mutant continuation did not apply"
ONCE_MUT="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-once-mut" node "$TEST_TMP/once.js" "$ENG_TREE" fell 2>"$TEST_TMP/once-mut.err")" || fail "N-engine mutant threw: $(cat "$TEST_TMP/once-mut.err")"
case "$ONCE_MUT" in
  *"calls=1 action=escalate exhausted=true"*) fail "N-engine mutant still stopped after one call ($ONCE_MUT)" ;;
esac
echo "mutant-red N-engine $ONCE_MUT"

# N-review: skipping review when fell_back is set. A commit without fell_back is still reviewed.
REV_TREE="$(mut_engine review "s/if (implementation.status !== 'committed') { \\/\\/ BL-0435 a fell_back commit is still reviewed/if (implementation.status !== 'committed' || (implementation.implementation \\&\\& implementation.implementation.fell_back)) { \\/\\/ BL-0435 a fell_back commit is still reviewed/")" || fail "N-review mutant did not apply"
REV_MUT_FELL="$(node "$TEST_TMP/review.js" "$REV_TREE" "$TEST_TMP/rev-mut-fell" fell 2>"$TEST_TMP/rev-mut-fell.err")" || fail "N-review mutant threw: $(tail -c 400 "$TEST_TMP/rev-mut-fell.err")"
case "$REV_MUT_FELL" in
  *reviews=1*) fail "N-review mutant still reviewed a fallback ($REV_MUT_FELL)" ;;
esac
REV_MUT_PLAIN="$(node "$TEST_TMP/review.js" "$REV_TREE" "$TEST_TMP/rev-mut-plain" plain 2>"$TEST_TMP/rev-mut-plain.err")" || fail "N-review plain threw: $(tail -c 400 "$TEST_TMP/rev-mut-plain.err")"
assert_contains "$REV_MUT_PLAIN" "reviews=1" "N-review mutant still reviews a commit without fell_back ($REV_MUT_PLAIN)"
echo "mutant-red N-review fell=$REV_MUT_FELL plain=$REV_MUT_PLAIN"

# --- (fb-d / fb-e) Default policy retreats automatically along pace-roles priority.implementer, never codex ---
CFG_DFLT="$TEST_TMP/cfg-default.md"
printf '# default policy (unset on_engine_unavailable & cloud_fallback_rung)\n- consult_dispatch: off\n- discuss_dispatch: off\n' > "$CFG_DFLT"

dispatch_case dflt_busy "$SRV_PORT" busy "$CFG_DFLT"
assert_eq "$(jget "$CASE_JSON" status)" "committed" "(fb-d) busy endpoint with default policy retreats and commits (rc=$CASE_RC stderr=$(printf '%s' "$CASE_ERR" | tail -c 400))"
assert_eq "$(jget "$CASE_JSON" runner)" "agy" "(fb-d) default retreat chooses first picker runner agy"
assert_eq "$(jget "$CASE_JSON" model)" "gemini-4-hydrogen-high" "(fb-d) default retreat chooses gemini-4-hydrogen-high"
assert_eq "$(jget "$CASE_JSON" fallback.from)" "mini@cc-shim#gpu1" "(fb-d) fallback.from records original seat"
assert_eq "$(jget "$CASE_JSON" fallback.to)" "gemini-4-hydrogen-high/high@agy" "(fb-d) fallback.to records picker rung"
assert_eq "$(jget "$CASE_JSON" fallback.reason)" "endpoint_busy" "(fb-d) fallback.reason records error class"
assert_contains "$(cat "$CASE_CAP/cloud-fallbacks.jsonl")" '"fallback":{' "(fb-d) cloud-fallbacks row carries fallback object"
assert_contains "$(cat "$CASE_CAP/cloud-fallbacks.jsonl")" '"reason":"endpoint_busy"' "(fb-d) cloud-fallbacks row records reason"
[ -s "$AGY_ARGV_LOG" ] || fail "(fb-d) agy stub was not invoked"
[ ! -s "$CODEX_ARGV_LOG" ] || fail "(fb-e) codex must never be invoked by default retreat"

dispatch_case dflt_dead "$DEAD_PORT" ok "$CFG_DFLT"
assert_eq "$(jget "$CASE_JSON" runner)" "agy" "(fb-d2) unreachable endpoint with default policy chooses agy"
assert_eq "$(jget "$CASE_JSON" model)" "gemini-4-hydrogen-high" "(fb-d2) unreachable endpoint chooses hydrogen"
assert_eq "$(jget "$CASE_JSON" fallback.reason)" "endpoint_unreachable" "(fb-d2) fallback.reason records endpoint_unreachable"
[ ! -s "$CODEX_ARGV_LOG" ] || fail "(fb-e2) codex must never be invoked on unreachable retreat"

cat > "$TEST_TMP/once-default.js" <<'NODE'
const path = require('path');
const [root] = process.argv.slice(2);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const calls = [];
const base = '1111111111111111111111111111111111111111';
const engine = new AutopilotEngine({
  clock: () => 1782864000000,
  implementationDispatcher(args) {
    calls.push(args);
    return {
      error: null,
      status: 1,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'engine_unavailable',
        runner: calls.length === 1 ? 'cc-shim' : 'agy',
        model: calls.length === 1 ? 'Qwen3.8-27B-QUASAR-NVFP4' : 'gemini-4-hydrogen-high',
        commit: null,
        base,
        branch: 'feat/default-retreat',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: null,
        agent_log: null,
        error: 'engine unavailable (endpoint_unreachable): refused',
      },
    };
  },
});
const out = engine.implementTask({
  promptFile: path.join(root, 'hooks', 'tests', 'hetero-endpoint-fallback.test.sh'),
  branch: 'feat/default-retreat',
  base,
  runId: 'run-fb-default',
  implementationRound: 1,
  extraImplementationArgs: ['--endpoint', 'qwen_local'],
  roster: {
    implementer_engine: 'Qwen3.8-27B-QUASAR-NVFP4',
    implementer_effort: 'high',
    implementer_runner: 'cc-shim',
    implementer_endpoint: 'qwen_local',
  },
});
const flagOf = (argv, flag) => {
  if (!Array.isArray(argv)) return '';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
    if (typeof argv[i] === 'string' && argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
  }
  return '';
};
const d = out.engine_unavailable || {};
process.stdout.write(`calls=${calls.length} policy=${d.policy || ''} runner2=${flagOf(calls[1], '--runner')} model2=${flagOf(calls[1], '--model')} exhausted=${d.cloud_fallback_exhausted === true}\n`);
NODE
ONCE_DFLT="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-once-default" node "$TEST_TMP/once-default.js" "$REPO_ROOT" 2>"$TEST_TMP/once-dflt.err")" || fail "(fb-d) once-default threw: $(cat "$TEST_TMP/once-dflt.err")"
assert_eq "$ONCE_DFLT" "calls=2 policy=cloud-fallback runner2=agy model2=gemini-4-hydrogen-high exhausted=true" "(fb-d) AutopilotEngine default policy retreats to picker implementer without codex"

finalize_test
