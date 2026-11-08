#!/usr/bin/env bash
# on_engine_unavailable: cloud-fallback (PM ruling fleet 01M6WGGHWN + gpu-lead 429/503 addendum).
#   1. dispatch-hetero classifies a local-endpoint death (--endpoint given) as endpoint_unreachable
#      (refused / timeout / other 5xx) or endpoint_busy (429 / 503); cloud runners are unchanged.
#   2. the engine re-dispatches ONCE to cloud_fallback_rung and writes one cloud-fallbacks.jsonl row.
#   3. default ask stops; a failed fallback stops; no endpoint state survives a dispatch.
# Every check has a sed_mutant negative control that must go red first.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH REVIEW_LOOP_CONFIG_OVERRIDE 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export DISPATCH_QUIET=1
export AUTOPILOT_ENDPOINTS_ENV="$TEST_TMP/no-endpoints.env"
export AUTOPILOT_ENDPOINT_GPU1_URL="http://127.0.0.1:9"
export AUTOPILOT_ENDPOINT_GPU1_TOKEN="FAKE-token-not-real"

# mk_tree <name>: a private copy of the code under test, so a mutant never touches the worktree.
mk_tree() {
  local t="$TEST_TMP/tree-$1"
  mkdir -p "$t"
  cp -r "$REPO_ROOT/src" "$REPO_ROOT/scripts" "$REPO_ROOT/schemas" "$REPO_ROOT/project-config-template" "$REPO_ROOT/references" "$REPO_ROOT/profiles" "$t/"
  printf '%s' "$t"
}

SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email "t@t"
git -C "$SBX" config user.name "t"
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"
STUB_N=0

# stub_claude <result-text> <api_error_status|null>: a fake claude whose envelope is an error.
stub_claude() {
  STUB_N=$((STUB_N + 1))
  local p="$TEST_TMP/claude-$STUB_N"
  cat > "$p" <<EOF
#!/usr/bin/env bash
echo x >> "$p.calls"
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,api_error_status:$2,terminal_reason:"api_error",result:process.argv[1]})+"\n")' '$1'
exit 1
EOF
  chmod +x "$p"
  printf '%s' "$p"
}

# hetero <scripts-dir> <stub> <branch> [--endpoint gpu1]: prints the last JSON line.
hetero() {
  local sdir="$1" stub="$2" branch="$3"; shift 3
  local bindir="$TEST_TMP/bin-$branch"
  mkdir -p "$bindir"
  ln -sfn "$stub" "$bindir/claude"
  local cap="$TEST_TMP/cap-$branch"
  mkdir -p "$cap"
  (cd "$SBX" && env PATH="$bindir:$PATH" ENGINE_CAPABILITY_DIR="$cap" \
      ANTHROPIC_BASE_URL="http://127.0.0.1:9" ANTHROPIC_AUTH_TOKEN="FAKE-token-not-real" \
      "$sdir/dispatch-hetero.sh" --runner cc-shim --model mini --branch "$branch" \
      --prompt-file "$PROMPT" --context-window off "$@" 2>&1 < /dev/null) | grep '^{' | tail -n 1
}

# eu_class <json>: the class inside "engine unavailable (<class>)", or the status when not unavailable.
eu_class() {
  node -e '
    const o = JSON.parse(process.argv[1]);
    const m = /^engine unavailable \(([a-z_]+)\)/.exec(o.error || "");
    console.log(o.status === "engine_unavailable" && m ? m[1] : `status:${o.status}`);
  ' "$1"
}

# --- 1. classification ---------------------------------------------------------------------
# Strings below are what the stub prints as the claude result text. ECONNREFUSED / ETIMEDOUT /
# "timed out" / 5xx forms are matched from the classifier vocabulary already in the repo;
# "Unable to connect to API" is an UNCONFIRMED guess at claude's own wording (no real sample).
classify_all() {
  local sdir="$1" tag="$2" j
  j="$(hetero "$sdir" "$(stub_claude 'API Error: Unable to connect to API (ECONNREFUSED)' null)" "feat/${tag}-refused" --endpoint gpu1)"
  CL_REFUSED="$(eu_class "$j")"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: Request timed out (ETIMEDOUT)' null)" "feat/${tag}-timeout" --endpoint gpu1)"
  CL_TIMEOUT="$(eu_class "$j")"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: 500 internal server error' null)" "feat/${tag}-5xx" --endpoint gpu1)"
  CL_5XX="$(eu_class "$j")"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: 429 too many requests' 429)" "feat/${tag}-429" --endpoint gpu1)"
  CL_429="$(eu_class "$j")"
  CAP_429="$(find "$TEST_TMP/cap-feat/${tag}-429" -type f -size +0 2>/dev/null | wc -l | tr -d ' ')"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: 503 service unavailable' 503)" "feat/${tag}-503" --endpoint gpu1)"
  CL_503="$(eu_class "$j")"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: 529 overloaded' 529)" "feat/${tag}-cloud529")"
  CL_CLOUD_529="$(eu_class "$j")"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: 429 too many requests' 429)" "feat/${tag}-cloud429")"
  CL_CLOUD_429="$(eu_class "$j")"
  j="$(hetero "$sdir" "$(stub_claude 'API Error: 500 internal server error' null)" "feat/${tag}-cloud500")"
  CL_CLOUD_500="$(eu_class "$j")"
}

classify_all "$REPO_ROOT/scripts" good
assert_eq "endpoint_unreachable" "$CL_REFUSED" "connection refused on an endpoint run is endpoint_unreachable"
assert_eq "endpoint_unreachable" "$CL_TIMEOUT" "timeout on an endpoint run is endpoint_unreachable"
assert_eq "endpoint_unreachable" "$CL_5XX" "plain 500 on an endpoint run is endpoint_unreachable"
assert_eq "endpoint_busy" "$CL_429" "429 on an endpoint run is endpoint_busy"
assert_eq "endpoint_busy" "$CL_503" "503 on an endpoint run is endpoint_busy"
assert_eq "0" "$CAP_429" "a throttled endpoint writes no capability row (nothing is blacklisted)"
assert_eq "overloaded" "$CL_CLOUD_529" "cloud runner 529 stays overloaded"
assert_eq "rate_limited" "$CL_CLOUD_429" "cloud runner 429 stays rate_limited"
case "$CL_CLOUD_500" in status:*) ;; *) fail "cloud runner 500 stays unclassified (got $CL_CLOUD_500)" ;; esac

# negative control A: endpoint classes disabled entirely -> endpoint cases go red
T="$(mk_tree mutA)"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$T/scripts/dispatch-hetero.sh" \
  's/^  \[ -n "\${ENDPOINT:-}" \] || return 0$/  return 0/'
classify_all "$T/scripts" mutA
[ "$CL_REFUSED" != "endpoint_unreachable" ] || fail "mutant A (classes off) must break unreachable"
[ "$CL_429" != "endpoint_busy" ] || fail "mutant A (classes off) must break busy"
# negative control B: endpoint guard dropped -> cloud runner is reclassified
T="$(mk_tree mutB)"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$T/scripts/dispatch-hetero.sh" \
  's/^  \[ -n "\${ENDPOINT:-}" \] || return 0$/  :/'
classify_all "$T/scripts" mutB
[ "$CL_CLOUD_429" != "rate_limited" ] || fail "mutant B (guard dropped) must change cloud 429"
# negative control C: endpoint class override skipped before the quota branch -> 429 leaves a row
T="$(mk_tree mutC)"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$T/scripts/dispatch-hetero.sh" \
  's/^    _ep_class="\$(_endpoint_error_class)"$/    _ep_class=""/'
classify_all "$T/scripts" mutC
[ "$CAP_429" != "0" ] || fail "mutant C (override skipped) must write a capability row for a throttled endpoint"

# --- 1b. no blacklist: 503 then a healthy dispatch, local is tried first both times ---------------
seq_run() {
  local sdir="$1" tag="$2" calls
  local stub="$TEST_TMP/claude-seq-$tag"
  cat > "$stub" <<EOF
#!/usr/bin/env bash
echo x >> "$stub.calls"
if [ ! -e "$stub.second" ]; then
  : > "$stub.second"
  node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,api_error_status:503,terminal_reason:"api_error",result:"API Error: 503 service unavailable"})+"\n")'
  exit 1
fi
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:false,subtype:"success",result:"OK"})+"\n")'
exit 0
EOF
  chmod +x "$stub"
  SEQ_J1="$(hetero "$sdir" "$stub" "feat/${tag}-one" --endpoint gpu1)"
  SEQ_J2="$(hetero "$sdir" "$stub" "feat/${tag}-two" --endpoint gpu1)"
  SEQ_CALLS="$(wc -l < "$stub.calls" 2>/dev/null | tr -d ' ')"
}
seq_run "$REPO_ROOT/scripts" seqgood
assert_eq "endpoint_busy" "$(eu_class "$SEQ_J1")" "sequence: first dispatch 503 is endpoint_busy"
assert_eq "2" "$SEQ_CALLS" "sequence: the second dispatch still tried the local endpoint first"
case "$(eu_class "$SEQ_J2")" in status:engine_unavailable|endpoint_*) fail "sequence: second dispatch must not inherit the 503" ;; esac
# negative control D: a blacklist (first endpoint death makes later dispatches refuse before launch)
T="$(mk_tree mutD)"
sed_mutant "$REPO_ROOT/scripts/dispatch-hetero.sh" "$T/scripts/dispatch-hetero.sh" \
  's/^_endpoint_error_class() {$/_endpoint_error_class() { touch "$TEST_TMP_BLACKLIST" 2>\/dev\/null;/'
sed_mutant "$T/scripts/dispatch-hetero.sh" "$T/scripts/dispatch-hetero.sh.2" \
  's/^CLASSIFIED_ERROR=""   # set by passive_capture/[ -e "$TEST_TMP_BLACKLIST" ] \&\& exit 1; CLASSIFIED_ERROR=""   # set by passive_capture/'
mv "$T/scripts/dispatch-hetero.sh.2" "$T/scripts/dispatch-hetero.sh"; chmod +x "$T/scripts/dispatch-hetero.sh"
export TEST_TMP_BLACKLIST="$TEST_TMP/blacklist-flag"
seq_run "$T/scripts" seqmut
[ "$SEQ_CALLS" != "2" ] || fail "mutant D (blacklist) must stop the second dispatch from reaching the local endpoint"
unset TEST_TMP_BLACKLIST

# --- 2. resolver: rung validation -------------------------------------------------------------
res() { REVIEW_LOOP_CONFIG_OVERRIDE="$2" bash "$1/scripts/resolve-review-loop.sh" "${@:3}" 2>&1 < /dev/null; }
printf -- '- on_engine_unavailable: cloud-fallback\n- cloud_fallback_rung: gpt-5.6-sol/high@codex\n' > "$TEST_TMP/cfg-ok.md"
printf -- '- on_engine_unavailable: cloud-fallback\n- cloud_fallback_rung: m/high@cc-shim\n' > "$TEST_TMP/cfg-shim.md"
printf -- '- on_engine_unavailable: cloud-fallback\n' > "$TEST_TMP/cfg-norung.md"
resolver_all() {
  local root="$1"
  RES_OK="$(res "$root" "$TEST_TMP/cfg-ok.md" --field cloud_fallback_rung; echo "rc=$?")"
  RES_SHIM="$(res "$root" "$TEST_TMP/cfg-shim.md" --field cloud_fallback_rung >/dev/null; echo "rc=$?")"
  RES_NORUNG="$(res "$root" "$TEST_TMP/cfg-norung.md" --field cloud_fallback_rung >/dev/null; echo "rc=$?")"
}
resolver_all "$REPO_ROOT"
assert_contains "$RES_OK" '"runner": "codex"' "valid cloud rung is emitted"
assert_contains "$RES_SHIM" "rc=3" "cc-shim rung exits 3"
assert_contains "$RES_NORUNG" "rc=3" "cloud-fallback without a rung exits 3"
assert_eq "ask" "$(REVIEW_LOOP_CONFIG_OVERRIDE=/nonexistent bash "$REPO_ROOT/scripts/resolve-review-loop.sh" --field on_engine_unavailable < /dev/null)" "default stays ask"
T="$(mk_tree mutR)"
sed_mutant "$REPO_ROOT/scripts/resolve-review-loop.sh" "$T/scripts/resolve-review-loop.sh" \
  's/^    codex|agy|grok|cursor|kimi|qoderclicn) ;;$/    codex|agy|grok|cursor|kimi|qoderclicn|cc-shim) ;;/'
resolver_all "$T"
case "$RES_SHIM" in *rc=3*) fail "mutant R (cc-shim allowed) must make the cc-shim rung pass" ;; esac

# --- 3. engine: redispatch, ask stop, single retreat ---------------------------------------------
cat > "$TEST_TMP/engine-case.js" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const mode = process.argv[3];
const capDir = process.argv[4];
const prompt = path.join(capDir, 'prompt.txt');
fs.writeFileSync(prompt, 'implementer prompt');
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const calls = [];
const unavailable = (cls) => ({
  status: 'engine_unavailable', runner: 'cc-shim', model: 'local-model', commit: null,
  base: '1111111111111111111111111111111111111111', branch: 'impl-branch',
  files_changed: 0, insertions: 0, deletions: 0, worktree: '/tmp/wt', agent_log: '/tmp/l',
  error: `engine unavailable (${cls}): worker exited non-zero (agent exit 1); worktree kept`,
});
const committed = {
  status: 'committed', runner: 'codex', model: 'gpt-5.6-sol', branch: 'impl-branch',
  base: '1111111111111111111111111111111111111111', commit: '2222222222222222222222222222222222222222',
  files_changed: 1, insertions: 1, deletions: 0, worktree: null, agent_log: '/tmp/l', error: null,
};
const cls = mode.endsWith('busy') ? 'endpoint_busy' : 'endpoint_unreachable';
const engine = new AutopilotEngine({
  clock: () => 1782864000000,
  implementationDispatcher(args) {
    calls.push(args);
    if (calls.length > 5) throw new Error('runaway retreat');
    const first = calls.length === 1;
    const failBoth = mode.startsWith('both');
    const result = (first || failBoth) ? unavailable(cls) : committed;
    return { error: null, status: result.status === 'committed' ? 0 : 1, signal: null, stdout: '', stderr: '', parseError: null, result };
  },
});
const policy = mode.startsWith('ask') ? 'ask' : 'cloud-fallback';
const out = engine.implementTask({
  promptFile: prompt, branch: 'impl-branch', base: '1111111111111111111111111111111111111111',
  runId: 'run-cf-1', implementationRound: 1, extraImplementationArgs: ['--endpoint', 'gpu1'],
  roster: {
    implementer_engine: 'local-model', implementer_effort: 'high', implementer_runner: 'cc-shim',
    implementer_endpoint: 'gpu1', on_engine_unavailable: policy,
    cloud_fallback_rung: { engine: 'gpt-5.6-sol', effort: 'high', runner: 'codex' },
  },
});
const eu = out.engine_unavailable || null;
const second = calls[1] || [];
const logFile = path.join(capDir, 'cloud-fallbacks.jsonl');
const rows = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
console.log(`calls=${calls.length}`);
console.log(`status=${out.status}`);
console.log(`eu=${eu ? `${eu.policy}/${eu.action}/${eu.error_class}${eu.cloud_fallback_exhausted ? '/exhausted' : ''}` : 'null'}`);
console.log(`second_runner=${second[second.indexOf('--runner') + 1]} second_model=${second[second.indexOf('--model') + 1]} second_endpoint=${second.includes('--endpoint')}`);
console.log(`log_rows=${rows.length}`);
if (rows[0]) {
  console.log(`log=${rows[0].run_id}|${rows[0].from_runner}|${rows[0].from_endpoint}|${rows[0].error_class}|${rows[0].to_rung}|${rows[0].outcome}|${typeof rows[0].ts}`);
}
NODE
engine_case() {
  local root="$1" mode="$2" cap="$TEST_TMP/ecap-$3"
  mkdir -p "$cap"
  ENGINE_CAPABILITY_DIR="$cap" node "$TEST_TMP/engine-case.js" "$root" "$mode" "$cap" 2>&1 < /dev/null
}
engine_all() {
  local root="$1" tag="$2"
  E_UNREACH="$(engine_case "$root" cloud-unreach "$tag-u")"
  E_BUSY="$(engine_case "$root" cloud-busy "$tag-b")"
  E_ASK="$(engine_case "$root" ask-unreach "$tag-a")"
  E_BOTH="$(engine_case "$root" both-unreach "$tag-x")"
}
engine_all "$REPO_ROOT" good
assert_contains "$E_UNREACH" "calls=2" "cloud-fallback: unreachable endpoint death is dispatched twice"
assert_contains "$E_UNREACH" "status=committed" "cloud-fallback: the fallback result is the run result"
assert_contains "$E_UNREACH" "second_runner=codex second_model=gpt-5.6-sol second_endpoint=false" "cloud-fallback: second dispatch goes to the cloud rung without --endpoint"
assert_contains "$E_UNREACH" "log_rows=1" "cloud-fallback: exactly one log row"
assert_contains "$E_UNREACH" "log=run-cf-1|cc-shim|gpu1|endpoint_unreachable|gpt-5.6-sol/high@codex|committed|string" "cloud-fallback: log row fields"
assert_contains "$E_BUSY" "calls=2" "cloud-fallback: endpoint_busy (429) also retreats"
assert_contains "$E_BUSY" "|endpoint_busy|" "cloud-fallback: busy is logged as endpoint_busy"
assert_contains "$E_ASK" "calls=1" "ask: stops after the endpoint death, no second dispatch"
assert_contains "$E_ASK" "eu=ask/escalate/endpoint_unreachable" "ask: escalate directive"
assert_contains "$E_ASK" "log_rows=0" "ask: nothing logged"
assert_contains "$E_BOTH" "calls=2" "cloud-fallback: a failed fallback is not retried"
assert_contains "$E_BOTH" "/escalate/endpoint_unreachable/exhausted" "cloud-fallback: failed fallback stops as ask"
assert_contains "$E_BOTH" "log_rows=1" "cloud-fallback: the one retreat is logged with the failed outcome"

T="$(mk_tree mutE)"
sed_mutant "$REPO_ROOT/src/engine/autopilot-engine.js" "$T/src/engine/autopilot-engine.js" \
  "s/policy, action: 'cloud-fallback', error_class: errorClass, dispatch_status: dispatchStatus,/policy, action: 'escalate', error_class: errorClass, dispatch_status: dispatchStatus,/"
engine_all "$T" mutE
case "$E_UNREACH" in *calls=2*) fail "mutant E (never retreat) must break the redispatch" ;; esac
case "$E_BUSY" in *calls=2*) fail "mutant E (never retreat) must break the busy redispatch" ;; esac
T="$(mk_tree mutF)"
sed_mutant "$REPO_ROOT/src/engine/autopilot-engine.js" "$T/src/engine/autopilot-engine.js" \
  "s/if (policy === 'cloud-fallback') {/if (policy === 'cloud-fallback' || policy === 'ask') {/"
M_ASK="$(engine_case "$T" ask-unreach mutF-a)"
case "$M_ASK" in *calls=1*) fail "mutant F (ask retreats) must dispatch twice under ask" ;; esac
T="$(mk_tree mutG)"
sed_mutant "$REPO_ROOT/src/engine/autopilot-engine.js" "$T/src/engine/autopilot-engine.js" \
  's/const attempted = Boolean(roster && roster.cloud_fallback_attempted);/const attempted = false;/'
M_BOTH="$(engine_case "$T" both-unreach mutG-x)"
case "$M_BOTH" in *calls=2*) fail "mutant G (unbounded retreat) must dispatch more than twice" ;; esac

finalize_test
