#!/usr/bin/env bash
# Endpoint pre-probe: a dispatch to a local endpoint (--endpoint) first does one GET <base>/models
# (2 s total) before any worker is opened, and a consult does the same before its question is sent.
#   - down / refused / hung / model missing -> endpoint_unreachable, 503/429 -> endpoint_busy, both as the
#     engine_unavailable result a dead worker would give, so on_engine_unavailable (ask / cloud-fallback)
#     applies unchanged: cloud-fallback retreats once to the cloud rung, ask stops.
#   - 200 with the model listed -> the local endpoint serves, no retreat.
# No real network: every endpoint is a 127.0.0.1 fake server or a closed loopback port. Every check has a
# sed_mutant negative control that must go red first.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH REVIEW_LOOP_CONFIG_OVERRIDE \
  AUTOPILOT_QUALIFICATION_OVERRIDE 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINT_PREPROBE=on
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
export AUTOPILOT_ENDPOINT_GPU1_TOKEN="FAKE-token-not-real"

# --- fake /models server: mode comes from a file, read on every request ---------------------------
SRV_JS="$TEST_TMP/models-server.js"
cat > "$SRV_JS" <<'NODE'
const http = require('http');
const fs = require('fs');
const [portFile, modeFile, hitsFile] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  fs.appendFileSync(hitsFile, `${req.method} ${req.url}\n`);
  const mode = fs.readFileSync(modeFile, 'utf8').trim();
  if (mode === 'hang') return; // never answers
  if (mode === 'busy') {
    res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end('{"error":"busy"}');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  const id = mode === 'nomodel' ? 'some-other-model' : 'mini';
  res.end(JSON.stringify({ object: 'list', data: [{ id }] }));
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
# a closed loopback port: listen, read the port, close
DEAD_PORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"
set_mode() { printf '%s' "$1" > "$MODE_FILE"; }
use_endpoint() { export AUTOPILOT_ENDPOINT_GPU1_URL="http://127.0.0.1:$1"; }

mk_tree() {
  local t="$TEST_TMP/tree-$1"
  mkdir -p "$t"
  cp -r "$REPO_ROOT/src" "$REPO_ROOT/scripts" "$REPO_ROOT/schemas" "$REPO_ROOT/project-config-template" "$REPO_ROOT/references" "$REPO_ROOT/profiles" "$REPO_ROOT/evals" "$t/"
  printf '%s' "$t"
}
jget() { node -e 'let v=JSON.parse(process.argv[1]); for (const k of process.argv[2].split(".")) v = v == null ? v : v[k]; console.log(v === null || v === undefined ? "null" : String(v));' "$1" "$2"; }

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email "t@t"
git -C "$SBX" config user.name "t"
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
STUB_N=0
# stub_claude: records every call; exits 0 with a success envelope (no commit -> no_op).
stub_claude() {
  STUB_N=$((STUB_N + 1))
  local p="$TEST_TMP/claude-$STUB_N"
  cat > "$p" <<EOF
#!/usr/bin/env bash
echo x >> "$p.calls"
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:false,subtype:"success",result:"OK"})+"\n")'
exit 0
EOF
  chmod +x "$p"
  printf '%s' "$p"
}
# hetero <scripts-dir> <stub> <branch>: prints the last JSON line of a dispatch to endpoint gpu1.
hetero() {
  local sdir="$1" stub="$2" branch="$3"
  local bindir="$TEST_TMP/bin-$branch"
  mkdir -p "$bindir" "$TEST_TMP/cap-$branch"
  ln -sfn "$stub" "$bindir/claude"
  (cd "$SBX" && env PATH="$bindir:$PATH" ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-$branch" \
      "$sdir/dispatch-hetero.sh" --runner cc-shim --model mini --branch "$branch" \
      --prompt-file "$PROMPT" --context-window off --endpoint gpu1 2>"$TEST_TMP/err-${branch//\//_}" < /dev/null) | grep '^{' | tail -n 1
}

# --- engine harness: the first dispatch returns the REAL dispatch-hetero result, the cloud rung is a double ---
cat > "$TEST_TMP/engine-case.js" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, firstFile, policy, capDir] = process.argv.slice(2);
const prompt = path.join(capDir, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt');
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
// The first dispatch is dispatch-hetero's REAL stdout through the REAL runner parse (no double in between).
const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer.js'));
let first = null;
let firstParseError = null;
try { first = parseImplementationOutput(fs.readFileSync(firstFile, 'utf8')); } catch (e) { firstParseError = e; }
console.log(`parse=${firstParseError ? 'error:' + firstParseError.message : 'ok'}`);
console.log(`parsed_status=${first ? first.status : 'null'}`);
const calls = [];
const committed = {
  status: 'committed', runner: 'codex', model: 'gpt-5.6-sol', branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111', commit: '2222222222222222222222222222222222222222',
  files_changed: 1, insertions: 1, deletions: 0, worktree: null, agent_log: '/tmp/l', error: null,
};
const engine = new AutopilotEngine({
  clock: () => 1782864000000,
  implementationDispatcher(args) {
    calls.push(args);
    if (calls.length > 5) throw new Error('runaway retreat');
    if (calls.length === 1 && firstParseError) {
      return { error: null, status: 1, signal: null, stdout: '', stderr: '', parseError: firstParseError, result: null };
    }
    const result = calls.length === 1 ? first : committed;
    return { error: null, status: result.status === 'committed' ? 0 : 1, signal: null, stdout: '', stderr: '', parseError: null, result };
  },
});
const out = engine.implementTask({
  promptFile: prompt, branch: 'impl-branch', base: '1111111111111111111111111111111111111111',
  runId: 'run-pp-1', implementationRound: 1, extraImplementationArgs: ['--endpoint', 'gpu1'],
  roster: {
    implementer_engine: 'mini', implementer_effort: 'high', implementer_runner: 'cc-shim',
    implementer_endpoint: 'gpu1', on_engine_unavailable: policy,
    cloud_fallback_rung: { engine: 'gpt-5.6-sol', effort: 'high', runner: 'codex' },
  },
});
const second = calls[1] || [];
const logFile = path.join(capDir, 'cloud-fallbacks.jsonl');
const rows = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
console.log(`calls=${calls.length}`);
console.log(`status=${out.status}`);
console.log(`reason=${out.reason}`);
console.log(`second_runner=${second[second.indexOf('--runner') + 1]} second_endpoint=${second.includes('--endpoint')}`);
console.log(`log_rows=${rows.length}`);
if (rows[0]) {
  const r = rows[0];
  console.log(`log=${r.error_class}|${r.from_endpoint}|${r.to_rung}|${r.outcome}|probe=${r.probe ? `${r.probe.decision}/${r.probe.status}` : 'null'}|served_by=${r.served_by}`);
}
NODE
engine_run() { # <root> <first.json> <policy> <tag>
  local cap="$TEST_TMP/ecap-$4"
  mkdir -p "$cap"
  ENGINE_CAPABILITY_DIR="$cap" node "$TEST_TMP/engine-case.js" "$1" "$2" "$3" "$cap" 2>&1 < /dev/null
}

# --- consult harness ---------------------------------------------------------------------------------
QF="$TEST_TMP/question.txt"; printf 'which approach?\n' > "$QF"
ART="$TEST_TMP/artifact.diff"; printf 'diff --git a/x b/x\n+line\n' > "$ART"
GOOD_RESPONSE="$TEST_TMP/good-response.json"
cat > "$GOOD_RESPONSE" <<'EOF'
{ "answer": { "label": "option-a", "artifact_ref": null }, "aside": [], "authority": { "refused": false, "reference": null } }
EOF
OVR="$TEST_TMP/override.json"
cat > "$OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"mini","runner":"cc-shim","role":"consult","reason":"endpoint-preprobe.test.sh fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON
CFG_FB="$TEST_TMP/consult-fb.md"
printf -- '- override: consult | until 2099-01-01 | test fixture seat\n- consult_engine: mini\n- consult_runner: cc-shim\n- consult_effort: high\n- consult_endpoint: gpu1\n- consult_dispatch: on\n- on_engine_unavailable: cloud-fallback\n- cloud_fallback_rung: gpt-5.6-sol/high@codex\n' > "$CFG_FB"
CFG_ASK="$TEST_TMP/consult-ask.md"
printf -- '- override: consult | until 2099-01-01 | test fixture seat\n- consult_engine: mini\n- consult_runner: cc-shim\n- consult_effort: high\n- consult_endpoint: gpu1\n- consult_dispatch: on\n- on_engine_unavailable: ask\n- cloud_fallback_rung: gpt-5.6-sol/high@codex\n' > "$CFG_ASK"
AUTH_BIN="$TEST_TMP/author.sh"
cat > "$AUTH_BIN" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "\$AUTHOR_ARGV_FILE"
printf '{ "runner": "x", "model": "m", "status": "authored", "raw_log": "$GOOD_RESPONSE", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
EOF
chmod +x "$AUTH_BIN"
consult_run() { # <scripts-dir> <config> <tag>: sets C_OUT C_RC C_ARGV (argv text, "" when the author was never called) C_CAP
  local sdir="$1" cfg="$2" tag="$3"
  C_CAP="$TEST_TMP/ccap-$tag"; mkdir -p "$C_CAP"
  local argv="$TEST_TMP/cargv-$tag"; rm -f "$argv"
  C_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$cfg" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" ENGINE_CAPABILITY_DIR="$C_CAP" AUTHOR_ARGV_FILE="$argv" \
    "$sdir/dispatch-consult.sh" --question-file "$QF" --artifact "$ART" --repo-root "$SBX" --dispatch-author-bin "$AUTH_BIN" 2>"$TEST_TMP/cerr-$tag" < /dev/null)"
  C_RC=$?
  C_ARGV="$(cat "$argv" 2>/dev/null)"
}
cap_rows() { cat "$1/cloud-fallbacks.jsonl" 2>/dev/null | wc -l | tr -d ' '; }

# =========================================================================================================
# all_cases <scripts-root> <tag>: every observable the controls compare; sets R_* variables
# =========================================================================================================
all_cases() {
  local root="$1" tag="$2" j st

  # (a) closed port: probe fails, no worker, engine retreats to the cloud rung (double), log shows who answered
  use_endpoint "$DEAD_PORT"; set_mode ok
  st="$(stub_claude)"; j="$(hetero "$root/scripts" "$st" "feat/$tag-dead")"
  printf '%s' "$j" > "$TEST_TMP/first-$tag-dead.json"
  R_A_STATUS="$(jget "$j" status)"; R_A_ERR="$(jget "$j" error)"; R_A_PROBE="$(jget "$j" probe.decision)"
  R_A_WORKER=no; [ -e "$st.calls" ] && R_A_WORKER=yes
  R_A_ENG="$(engine_run "$root" "$TEST_TMP/first-$tag-dead.json" cloud-fallback "$tag-a")"
  R_E_ENG="$(engine_run "$root" "$TEST_TMP/first-$tag-dead.json" ask "$tag-e")"

  # (b) /models answers 503 + Retry-After: busy
  use_endpoint "$SRV_PORT"; set_mode busy
  st="$(stub_claude)"; j="$(hetero "$root/scripts" "$st" "feat/$tag-busy")"
  printf '%s' "$j" > "$TEST_TMP/first-$tag-busy.json"
  R_B_ERR="$(jget "$j" error)"; R_B_PROBE="$(jget "$j" probe.decision)"; R_B_REASON="$(jget "$j" probe.reason)"
  R_B_WORKER=no; [ -e "$st.calls" ] && R_B_WORKER=yes
  R_B_ENG="$(engine_run "$root" "$TEST_TMP/first-$tag-busy.json" cloud-fallback "$tag-b")"

  # 200 but the model is not listed
  set_mode nomodel
  st="$(stub_claude)"; j="$(hetero "$root/scripts" "$st" "feat/$tag-nomodel")"
  R_M_ERR="$(jget "$j" error)"; R_M_REASON="$(jget "$j" probe.reason)"
  R_M_WORKER=no; [ -e "$st.calls" ] && R_M_WORKER=yes

  # hung server: the 2 s budget, not the worker's connect timeout
  set_mode hang
  st="$(stub_claude)"; local t0 t1; t0="$(date +%s%N)"; j="$(hetero "$root/scripts" "$st" "feat/$tag-hang")"; t1="$(date +%s%N)"
  R_H_PROBE="$(jget "$j" probe.decision)"; R_H_MS=$(( (t1 - t0) / 1000000 ))

  # (d) healthy: 200 and the model listed -> the local worker runs, no retreat
  set_mode ok
  st="$(stub_claude)"; j="$(hetero "$root/scripts" "$st" "feat/$tag-ok")"
  printf '%s' "$j" > "$TEST_TMP/first-$tag-ok.json"
  R_D_STATUS="$(jget "$j" status)"; R_D_PROBE="$(jget "$j" probe.decision)"
  R_D_WORKER=no; [ -e "$st.calls" ] && R_D_WORKER=yes
  R_D_LOG="$(cat "$TEST_TMP/err-feat_$tag-ok" 2>/dev/null)"

  # (c) consult on the closed port retreats to the consult's cloud rung; nothing was sent to the endpoint
  use_endpoint "$DEAD_PORT"
  consult_run "$root/scripts" "$CFG_FB" "$tag-c"
  R_C_RC="$C_RC"; R_C_STATUS="$(jget "$C_OUT" status)"; R_C_SERVED="$(jget "$C_OUT" served_by)"; R_C_PROBE="$(jget "$C_OUT" probe.decision)"
  R_C_ARGV="$C_ARGV"; R_C_ROWS="$(cap_rows "$C_CAP")"; R_C_ROW="$(cat "$C_CAP/cloud-fallbacks.jsonl" 2>/dev/null | head -n 1)"
  # consult under ask: stops, the author rail is never called
  consult_run "$root/scripts" "$CFG_ASK" "$tag-ca"
  R_CA_RC="$C_RC"; R_CA_STATUS="$(jget "$C_OUT" status)"; R_CA_ARGV="$C_ARGV"; R_CA_ROWS="$(cap_rows "$C_CAP")"
  # consult on a busy endpoint under cloud-fallback
  use_endpoint "$SRV_PORT"; set_mode busy
  consult_run "$root/scripts" "$CFG_FB" "$tag-cb"
  R_CB_STATUS="$(jget "$C_OUT" status)"; R_CB_PROBE="$(jget "$C_OUT" probe.decision)"
  # consult on a healthy endpoint: local, no retreat, no row
  set_mode ok
  consult_run "$root/scripts" "$CFG_FB" "$tag-cd"
  R_CD_STATUS="$(jget "$C_OUT" status)"; R_CD_SERVED="$(jget "$C_OUT" served_by)"; R_CD_ARGV="$C_ARGV"; R_CD_ROWS="$(cap_rows "$C_CAP")"
}

all_cases "$REPO_ROOT" good

# --- (a) -------------------------------------------------------------------------------------------------
assert_eq "engine_unavailable" "$R_A_STATUS" "(a) closed port: dispatch-hetero answers engine_unavailable"
assert_contains "$R_A_ERR" "engine unavailable (endpoint_unreachable)" "(a) closed port: class is endpoint_unreachable"
assert_eq "unreachable" "$R_A_PROBE" "(a) the result carries the probe"
assert_eq "no" "$R_A_WORKER" "(a) no worker was started"
assert_contains "$R_A_ENG" "parse=ok" "(a) the real runner parse accepts the probe-failure result"
assert_contains "$R_A_ENG" "parsed_status=engine_unavailable" "(a) the parsed result is engine_unavailable"
assert_contains "$R_A_ENG" "calls=2" "(a) the engine retreats once"
assert_contains "$R_A_ENG" "status=committed" "(a) the cloud double's result is the run result"
assert_contains "$R_A_ENG" "second_runner=codex second_endpoint=false" "(a) the retreat goes to the cloud rung without --endpoint"
assert_contains "$R_A_ENG" "log=endpoint_unreachable|gpu1|gpt-5.6-sol/high@codex|committed|probe=unreachable/null|served_by=gpt-5.6-sol/high@codex" "(a) the log row names the probe and the cloud rung that answered"
# --- (b) -------------------------------------------------------------------------------------------------
assert_contains "$R_B_ERR" "engine unavailable (endpoint_busy)" "(b) 503 + Retry-After is endpoint_busy"
assert_eq "busy" "$R_B_PROBE" "(b) probe decision busy"
assert_contains "$R_B_REASON" "retry-after 1" "(b) the Retry-After is in the probe reason"
assert_eq "no" "$R_B_WORKER" "(b) no worker was started"
assert_contains "$R_B_ENG" "calls=2" "(b) busy retreats to the cloud rung"
assert_contains "$R_B_ENG" "log=endpoint_busy|gpu1|gpt-5.6-sol/high@codex|committed|probe=busy/503|served_by=gpt-5.6-sol/high@codex" "(b) the log row carries busy/503"
assert_contains "$R_M_ERR" "engine unavailable (endpoint_unreachable)" "model not in /models: unreachable"
assert_contains "$R_M_REASON" "model mini is not in the /models list" "model not in /models: the reason says why"
assert_eq "no" "$R_M_WORKER" "model not in /models: no worker"
assert_eq "unreachable" "$R_H_PROBE" "a hung /models is unreachable"
[ "$R_H_MS" -lt 6000 ] || fail "a hung /models must cost about 2 s, not the connect timeout (took $R_H_MS ms)"
# --- (d) -------------------------------------------------------------------------------------------------
assert_eq "ok" "$R_D_PROBE" "(d) healthy endpoint: probe ok"
assert_eq "yes" "$R_D_WORKER" "(d) healthy endpoint: the local worker ran"
case "$R_D_STATUS" in engine_unavailable) fail "(d) healthy endpoint must not be engine_unavailable" ;; esac
assert_contains "$R_D_LOG" "served by local endpoint gpu1" "(d) the run log says the local endpoint served"
# --- (e) -------------------------------------------------------------------------------------------------
assert_contains "$R_E_ENG" "calls=1" "(e) ask: a failed probe does not retreat"
assert_contains "$R_E_ENG" "log_rows=0" "(e) ask: nothing logged"
# --- (c) consult -----------------------------------------------------------------------------------------
assert_eq "0" "$R_C_RC" "(c) consult: retreat succeeds"
assert_eq "advised" "$R_C_STATUS" "(c) consult: the cloud seat answered"
assert_eq "unreachable" "$R_C_PROBE" "(c) consult output carries the probe"
assert_eq "gpt-5.6-sol/high@codex" "$R_C_SERVED" "(c) consult output says the cloud rung answered"
assert_contains "$R_C_ARGV" "--runner
codex" "(c) the author rail got the cloud runner"
assert_contains "$R_C_ARGV" "--model
gpt-5.6-sol" "(c) the author rail got the cloud model"
assert_not_contains "$R_C_ARGV" "--endpoint" "(c) the retreat is sent without --endpoint"
assert_eq "1" "$R_C_ROWS" "(c) one cloud-fallbacks row"
assert_contains "$R_C_ROW" '"outcome":"advised"' "(c) the row records how the consult ended"
assert_contains "$R_C_ROW" '"served_by":"gpt-5.6-sol/high@codex"' "(c) the row names the answering rung"
assert_eq "5" "$R_CA_RC" "(c-ask) consult under ask stops with exit 5"
assert_eq "engine_unavailable" "$R_CA_STATUS" "(c-ask) status engine_unavailable"
assert_eq "" "$R_CA_ARGV" "(c-ask) the author rail was never called"
assert_eq "0" "$R_CA_ROWS" "(c-ask) no retreat row"
assert_eq "advised" "$R_CB_STATUS" "(c-busy) busy endpoint also retreats"
assert_eq "busy" "$R_CB_PROBE" "(c-busy) probe decision busy"
assert_eq "advised" "$R_CD_STATUS" "(d-consult) healthy endpoint: advised"
assert_eq "gpu1" "$R_CD_SERVED" "(d-consult) served by the local endpoint"
assert_contains "$R_CD_ARGV" "--endpoint
gpu1" "(d-consult) the local endpoint is used"
assert_eq "0" "$R_CD_ROWS" "(d-consult) no retreat row"
# the probe is a plain GET of the models list
assert_contains "$(cat "$HITS_FILE")" "GET /v1/models" "the probe asked GET /v1/models"

# =========================================================================================================
# negative controls: each mutant must break exactly the check it names
# =========================================================================================================
# N1: probe off -> a dead endpoint reaches the worker
T="$(mk_tree mutN1)"
sed_mutant "$REPO_ROOT/scripts/lib/endpoint-probe.sh" "$T/scripts/lib/endpoint-probe.sh" \
  's/^  \[ "\${AUTOPILOT_ENDPOINT_PREPROBE:-on}" = "off" \] \&\& return 0$/  return 0/'
all_cases "$T" mutN1
[ "$R_A_WORKER" = "yes" ] || fail "mutant N1 (probe off) must start the worker on a dead endpoint"
assert_eq "null" "$R_B_PROBE" "mutant N1 leaves no probe"
[ "$R_C_STATUS" != "advised" ] || [ "$R_C_PROBE" = "null" ] || fail "mutant N1 (probe off) must drop the consult probe"
# N2: 503/429 no longer busy
T="$(mk_tree mutN2)"
sed_mutant "$REPO_ROOT/scripts/lib/endpoint-probe.js" "$T/scripts/lib/endpoint-probe.js" \
  's/^    if (code === 503 || code === 429) {$/    if (false) {/'
all_cases "$T" mutN2
[ "$R_B_PROBE" != "busy" ] || fail "mutant N2 must lose the busy class"
# N3: the model check is gone
T="$(mk_tree mutN3)"
sed_mutant "$REPO_ROOT/scripts/lib/endpoint-probe.js" "$T/scripts/lib/endpoint-probe.js" \
  's/^    if (!ids.includes(model)) /    if (false) /'
all_cases "$T" mutN3
[ "$R_M_WORKER" = "yes" ] || fail "mutant N3 (no model check) must let a model-less endpoint reach the worker"
# N4: no timeout -> a hung endpoint is not cut at 2 s
T="$(mk_tree mutN4)"
sed_mutant "$REPO_ROOT/scripts/lib/endpoint-probe.js" "$T/scripts/lib/endpoint-probe.js" \
  's/^}, budget).unref();$/}, 400000).unref();/'
export AUTOPILOT_ENDPOINT_PREPROBE=on
use_endpoint "$SRV_PORT"; set_mode hang
N4_PROBE="$(AUTOPILOT_ENDPOINT_GPU1_URL="http://127.0.0.1:$SRV_PORT" timeout 6 node "$T/scripts/lib/endpoint-probe.js" --endpoint gpu1 --model mini 2>/dev/null)"
[ -z "$N4_PROBE" ] || fail "mutant N4 (no budget) must not answer within 6 s on a hung endpoint"
set_mode ok
# N5: consult retreats under ask too
T="$(mk_tree mutN5)"
sed_mutant "$REPO_ROOT/scripts/dispatch-consult.sh" "$T/scripts/dispatch-consult.sh" \
  's/^      if \[ "\$_on_unavail" = "cloud-fallback" \] \&\& \[ -n "\$_rung" \]; then$/      if [ -n "$_rung" ]; then/'
use_endpoint "$DEAD_PORT"
consult_run "$T/scripts" "$CFG_ASK" "mutN5"
[ "$C_RC" = "0" ] || fail "mutant N5 (consult retreats under ask) must retreat and advise"
# N6: the engine stops recording who answered
T="$(mk_tree mutN6)"
sed_mutant "$REPO_ROOT/src/engine/autopilot-engine.js" "$T/src/engine/autopilot-engine.js" \
  's/^          served_by: toRung,$/          served_by: null,/'
use_endpoint "$DEAD_PORT"
N6_ENG="$(engine_run "$T" "$TEST_TMP/first-good-dead.json" cloud-fallback mutN6)"
case "$N6_ENG" in *"served_by=gpt-5.6-sol/high@codex"*) fail "mutant N6 must lose served_by in the log row" ;; esac
# N7: the log writer drops the probe object
T="$(mk_tree mutN7)"
sed_mutant "$REPO_ROOT/scripts/engine-capability-state.js" "$T/scripts/engine-capability-state.js" \
  's/^        served_by: str(input.served_by) ? input.served_by : null,$/        served_by: null,/'
N7_ENG="$(engine_run "$T" "$TEST_TMP/first-good-dead.json" cloud-fallback mutN7)"
case "$N7_ENG" in *"served_by=gpt-5.6-sol/high@codex"*) fail "mutant N7 (writer drops served_by) must be visible in the log row" ;; esac

# N8: the probe-failure result carries an empty containment -> the real runner parse rejects it
T="$(mk_tree mutN8)"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$T/scripts/dispatch-hetero.sh" \
  's/"\$(_flat_json_escape "\$MODEL")" "\$CONTAINMENT" "\$(\[/"$(_flat_json_escape "$MODEL")" "" "$([/'
use_endpoint "$DEAD_PORT"
st="$(stub_claude)"; N8_J="$(hetero "$T/scripts" "$st" "feat/mutN8-dead")"
printf '%s' "$N8_J" > "$TEST_TMP/first-mutN8-dead.json"
N8_ENG="$(engine_run "$T" "$TEST_TMP/first-mutN8-dead.json" cloud-fallback mutN8)"
case "$N8_ENG" in *"parse=ok"*) fail "mutant N8 (empty containment in the probe result) must be rejected by the real parse" ;; esac
case "$N8_ENG" in *"calls=2"*) fail "mutant N8 must not retreat to the cloud (the parse error blocks)" ;; esac

finalize_test
