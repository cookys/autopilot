#!/usr/bin/env bash
# hooks/tests/paid-batch-auth-stop.test.sh -- BL-0294: every per-id paid batch stops at the FIRST authentication
# failure (STOP_AUTH line + exit 6, no later id launched) and keeps going on a generic failure.
# Each script runs in a throwaway copy of the repo layout with FAKE runners (no model call, no real ~/.claude:
# HOME is a mktemp dir). Each scenario also runs against a MUTANT layout whose helper never reports a
# failure; the stop assertion must then be false (negative control, printed as MUTANT-RED).
. "$(dirname "$0")/lib.sh"

SCRIPTS="$REPO_ROOT/scripts"
ENVX=(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CONFIG_DIR)

# mk_layout <dir> [mutant]: the wired scripts + shared helper copied into a throwaway repo layout. In a mutant layout the
# WIRING is removed from the copied scripts (every auth_stop_check / authStop.checkSources call becomes a no-op), the helper
# itself is untouched: the stop assertions must then be false (negative control, printed as MUTANT-RED).
mk_layout() {
  local d="$1" mutant="${2:-}" f
  mkdir -p "$d/scripts/lib" "$d/evals/skill-transport/lib" "$d/evals/skill-transport/packs" "$d/evals/pipeline-bench" "$d/evals/context-budget-t2"
  cp "$SCRIPTS/run-eval-batch.sh" "$SCRIPTS/bench-engine-capability.sh" "$SCRIPTS/qualification-sweep.sh" \
     "$SCRIPTS/run-grok-implementer-ab.sh" "$SCRIPTS/benchmark-hook-latency.js" "$d/scripts/"
  cp "$SCRIPTS/lib/auth-stop.js" "$SCRIPTS/lib/auth-stop.sh" "$SCRIPTS/lib/repo-identity.sh" "$d/scripts/lib/"
  cp "$REPO_ROOT/evals/run-trigger-test.sh" "$d/evals/"
  cp "$REPO_ROOT/evals/skill-transport/run-matrix.sh" "$REPO_ROOT/evals/skill-transport/run-implementer-matrix.sh" "$REPO_ROOT/evals/skill-transport/match-eval.js" "$d/evals/skill-transport/"
  cp -r "$REPO_ROOT/evals/skill-transport/lib/." "$d/evals/skill-transport/lib/"
  cp "$REPO_ROOT/evals/skill-transport/packs/implementer-pack.md" "$d/evals/skill-transport/packs/"
  cp "$REPO_ROOT/evals/pipeline-bench/run-pipeline-bench.sh" "$d/evals/pipeline-bench/"
  cp "$REPO_ROOT/evals/context-budget-t2/run-t2-eval.js" "$d/evals/context-budget-t2/"
  ln -sfn "$REPO_ROOT/hooks" "$d/hooks"
  # test seam: the matrix pins a frozen pack digest that the shipped pack no longer has (separate, pre-existing drift);
  # the layout copy pins the digest of the pack it ships so the cell loop can be reached
  sed -i "s/3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca/$(sha256sum "$d/evals/skill-transport/packs/implementer-pack.md" | awk '{print $1}')/" "$d/evals/skill-transport/run-implementer-matrix.sh"
  if [ -n "$mutant" ]; then
    for f in "$d/scripts/run-eval-batch.sh" "$d/scripts/bench-engine-capability.sh" "$d/scripts/qualification-sweep.sh" \
             "$d/evals/run-trigger-test.sh" "$d/evals/skill-transport/run-matrix.sh" "$d/evals/skill-transport/run-implementer-matrix.sh" \
             "$d/evals/pipeline-bench/run-pipeline-bench.sh"; do
      grep -q 'auth_stop_check' "$f" || fail "mutant: no wiring found in $f"
      sed -i 's/auth_stop_check/:/g' "$f"
    done
    for f in "$d/scripts/run-grok-implementer-ab.sh" "$d/scripts/benchmark-hook-latency.js" "$d/evals/context-budget-t2/run-t2-eval.js"; do
      grep -q 'authStop\.checkSources(' "$f" || fail "mutant: no wiring found in $f"
      sed -i 's/authStop\.checkSources(/((_s) => null)(/g' "$f"
    done
  fi
}
# Fresh git repo with two commits (the grok A/B harness clones it and resolves HEAD^).
git_layout() {
  ( cd "$1" && git init -q -b main && git config user.email t@t.invalid && git config user.name t \
    && git add -A && git commit -q -m one && git commit -q --allow-empty -m two )
}
# quote_case <label> <expect_calls> <expect_rc>: a SUCCESSFUL call whose output quotes an auth phrase must not stop the batch
quote_case() { assert_neq "$RC" "6" "$1: a successful call quoting an auth phrase does not stop"; assert_eq "$CALLS" "$2" "$1: every unit still runs"; }
# stop_case <label> <expect_calls> : the scenario's globals RC/CALLS/OUT must show the stop
stop_case() { assert_eq "$RC" "6" "$1: exits 6"; assert_eq "$CALLS" "$2" "$1: nothing is launched after the failing call"; assert_contains "$OUT" "STOP_AUTH after $3" "$1: stop line"; }
# mutant_red <label> <expect_calls>: with the wiring removed the stop must NOT happen
mutant_red() { if [ "$RC" = 6 ] || [ "$CALLS" = "$2" ]; then fail "$1: mutant (wiring removed) still stopped -- negative control broken (rc=$RC calls=$CALLS)"; fi; echo "MUTANT-RED $1: rc=$RC calls=$CALLS"; }

# Every scenario function takes <layout> <mode> and sets RC (exit code), CALLS (paid units launched) and OUT (stdout+stderr).
count() { wc -l < "$1" | tr -d ' '; }

# ============================ 1. scripts/run-eval-batch.sh (one run_eval per skill) ============================
# outputs of a paid call: run_eval stdout JSON (eval-output.json) and stderr (eval-log.txt)
eb_run() {
  local L="$1" mode="$2" H="$1/home"
  rm -rf "$H" "$L/skills" "$L/skill-creator-workspace" "$L/calls"; : > "$L/calls"
  mkdir -p "$H/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator" "$L/tmp"
  for s in alpha beta gamma; do
    mkdir -p "$L/skills/$s" "$L/skill-creator-workspace/evals"; : > "$L/skill-creator-workspace/evals/$s-evals.json"
  done
  cat > "$L/fake-run-eval" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo '{"summary": {"passed": 1, "total": 1}}'; echo "Failed to authenticate. API Error: 401" >&2; exit 1 ;;
  authjson) echo '{"summary": {"passed": 0, "total": 1}, "error": "OAuth session expired"}'; exit 1 ;;
  authweak) echo '{"summary": {"passed": 0, "total": 1}}'; echo "error: invalid api key" >&2; exit 1 ;;
  quote) echo '{"summary": {"passed": 1, "total": 1}}'; echo "the skill text mentions: Invalid API key" >&2; exit 0 ;;
  *) echo '{"summary": {"passed": 1, "total": 1}}'; echo "API Error: 429 rate limit reached" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fake-run-eval"
  OUT="$("${ENVX[@]}" HOME="$H" TMPDIR="$L/tmp" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" RUN_EVAL_CMD="$L/fake-run-eval" \
    bash "$L/scripts/run-eval-batch.sh" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/eb"
eb_run "$TEST_TMP/eb" auth;     stop_case "run-eval-batch (stderr)" 1 "alpha:"
eb_run "$TEST_TMP/eb" authjson; stop_case "run-eval-batch (stdout JSON only)" 1 "alpha:"
eb_run "$TEST_TMP/eb" authweak; stop_case "run-eval-batch (failed call, weak phrase in stderr)" 1 "alpha:"
eb_run "$TEST_TMP/eb" quote;    quote_case "run-eval-batch" 3
assert_eq "$RC" "0" "run-eval-batch: quote case exit code unchanged"
eb_run "$TEST_TMP/eb" generic
assert_eq "$CALLS" "3" "run-eval-batch: a generic failure does not stop the batch"
assert_eq "$RC" "0" "run-eval-batch: a generic failure keeps the original exit code 0"
mk_layout "$TEST_TMP/eb-mut" mutant
eb_run "$TEST_TMP/eb-mut" auth; mutant_red "run-eval-batch" 1

# ============================ 2. scripts/bench-engine-capability.sh (one dispatch per case) ============================
# outputs of a paid call: dispatch stdout+stderr (captured together) and the agent_log it names
bc_run() {
  local L="$1" mode="$2" H="$1/home"
  rm -rf "$H" "$L/calls"; : > "$L/calls"; mkdir -p "$H" "$L/evals/engine-capabilities"
  for c in brainstorm-gate quality-review-findings-first dev-flow-branch-check no-skill-claim; do
    : > "$L/evals/engine-capabilities/$c.prompt.txt"; : > "$L/evals/engine-capabilities/$c.expected.txt"
  done
  cat > "$L/scripts/dispatch-hetero.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"
echo '{"type":"result","is_error":false,"result":"fine"}' > "$log"
err=""
case "${FAKE_MODE}" in
  authlog) echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}' > "$log" ;;
  authjson) err=', "error": "OAuth session expired"' ;;
  authweak) echo 'agent output: invalid api key' > "$log"; printf '{"status":"failure","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 1 ;;
  quote) echo 'the answer quotes: Invalid API key' > "$log"; printf '{"status":"committed","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"; exit 0 ;;
  generic) echo '{"type":"result","is_error":true,"result":"rate limit 429, retry later"}' > "$log" ;;
esac
printf '{"status":"failure","worktree":"","agent_log":"%s","files_changed":0%s}\n' "$log" "$err"
EOS
  chmod +x "$L/scripts/dispatch-hetero.sh"
  echo 'process.exit(0);' > "$L/scripts/engine-capability-state.js"
  OUT="$("${ENVX[@]}" HOME="$H" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    bash "$L/scripts/bench-engine-capability.sh" --runner agy --model m1 --skill-mode prompt --live-spend < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/bc"
bc_run "$TEST_TMP/bc" authlog;  stop_case "bench-engine-capability (agent_log only)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" authjson; stop_case "bench-engine-capability (stdout JSON only)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" authweak; stop_case "bench-engine-capability (failed call, weak phrase in plain agent_log)" 1 "brainstorm-gate:"
bc_run "$TEST_TMP/bc" quote;    quote_case "bench-engine-capability" 4
bc_run "$TEST_TMP/bc" generic
assert_eq "$CALLS" "4" "bench-engine-capability: a generic failure runs every case"
assert_eq "$RC" "0" "bench-engine-capability: a generic failure keeps the original exit code 0"
mk_layout "$TEST_TMP/bc-mut" mutant
bc_run "$TEST_TMP/bc-mut" authlog; mutant_red "bench-engine-capability" 1

# ============================ 3. scripts/qualification-sweep.sh (one administration per seat) ============================
# outputs of a paid call: probe = dispatch stdout, stderr, agent_log; administration = stderr log, stdout row JSON, raw dir files
qs_run() {
  local L="$1" mode="$2"
  rm -rf "$L/home" "$L/dcalls" "$L/qcalls" "$L/ev"; : > "$L/dcalls"; : > "$L/qcalls"; mkdir -p "$L/home"
  cat > "$L/roster.json" <<'EOS'
{ "corpus": { "prompt_config_hash": "a", "semantic_fingerprint": "b", "containment_fingerprint": "c", "harness_version": "h", "expires_days": 90 },
  "evidence_root": "ev", "role": "implementer",
  "seats": [
    { "slug": "s1", "runner": "codex", "model": "m1", "family": "f", "version_source": "operator-asserted", "endpoint": "-", "effort": "high" },
    { "slug": "s2", "runner": "codex", "model": "m2", "family": "f", "version_source": "operator-asserted", "endpoint": "-", "effort": "high" },
    { "slug": "s3", "runner": "codex", "model": "m3", "family": "f", "version_source": "operator-asserted", "endpoint": "-", "effort": "high" } ] }
EOS
  cat > "$L/scripts/lib/runner-binary.js" <<'EOS'
module.exports = { receiptSafe: (v) => String(v) };
if (require.main === module) console.log(JSON.stringify({ ok: true, token: '1.0.0', binary_path: '/fake/codex', version_line: '1.0.0' }));
EOS
  printf 'autopilot_load_endpoints_env() { return 0; }\n' > "$L/scripts/load-endpoints-env.sh"
  echo 'process.exit(0);' > "$L/scripts/engine-scorecard.js"
  cat > "$L/scripts/dispatch-hetero.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_DCALLS:?}"
log="${FAKE_DCALLS}.agent.log"
echo '{"type":"result","is_error":false,"result":"fine"}' > "$log"
case "${FAKE_MODE}" in
  probe-auth) printf '{"status":"failure","agent_log":"%s","error":"Failed to authenticate. API Error: 401"}\n' "$log" ;;
  probe-authlog) echo '{"type":"result","is_error":true,"result":"OAuth session expired"}' > "$log"; printf '{"status":"failure","agent_log":"%s"}\n' "$log" ;;
  probe-autherr) echo "Failed to authenticate" >&2; echo '{"status":"failure"}' ;;
  generic) printf '{"status":"failure","agent_log":"%s","error":"API Error: 429 rate limit reached"}\n' "$log" ;;
  *) echo '{"status": "committed"}' ;;
esac
EOS
  cat > "$L/scripts/engine-qualify.js" <<'EOS'
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_QCALLS, 'call\n');
const rawDir = process.argv[process.argv.indexOf('--raw-dir') + 1];
const row = { status: 'PASS', quality: { corpus_pass: '1/1' }, capability_score: 1, latency: { sample_wall_time_s: 1 } };
if (process.env.FAKE_MODE === 'qualify-autherr') { console.error('OAuth session expired, please log in'); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-authweak') { console.error('error: invalid api key'); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-authjson') { console.log(JSON.stringify({ ...row, status: 'infra_abort', error: 'Failed to authenticate' })); process.exit(3); }
if (process.env.FAKE_MODE === 'qualify-authraw') {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(`${rawDir}/case-1.log`, 'agent said: OAuth session expired\n');
  console.log(JSON.stringify(row)); process.exit(3);
}
if (process.env.FAKE_MODE === 'qualify-quote') {
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(`${rawDir}/case-1.log`, 'candidate wrote: Invalid API key\n');
}
console.log(JSON.stringify(row));
EOS
  OUT="$(cd "$L" && "${ENVX[@]}" HOME="$L/home" FAKE_DCALLS="$L/dcalls" FAKE_QCALLS="$L/qcalls" FAKE_MODE="$mode" \
    bash "$L/scripts/qualification-sweep.sh" --roster "$L/roster.json" --execute --yes < /dev/null 2>&1)"
  RC=$?; CALLS=$(( $(count "$L/dcalls") + $(count "$L/qcalls") ))
}
mk_layout "$TEST_TMP/qs"; git_layout "$TEST_TMP/qs"
qs_run "$TEST_TMP/qs" probe-auth;     stop_case "qualification-sweep (probe stdout JSON)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" probe-authlog;  stop_case "qualification-sweep (probe agent_log only)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" probe-autherr;  stop_case "qualification-sweep (probe stderr only)" 1 "probe-codex/m1:"
qs_run "$TEST_TMP/qs" qualify-autherr;  stop_case "qualification-sweep (qualify stderr)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-authjson; stop_case "qualification-sweep (qualify stdout row JSON only)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-authraw;  stop_case "qualification-sweep (qualify raw dir file only)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-authweak; stop_case "qualification-sweep (failed qualify, weak phrase in stderr log)" 2 "s1:"
qs_run "$TEST_TMP/qs" qualify-quote;    quote_case "qualification-sweep" 6
assert_eq "$RC" "0" "qualification-sweep: quote case exit code unchanged"
qs_run "$TEST_TMP/qs" generic
assert_eq "$CALLS" "3" "qualification-sweep: a generic probe failure still probes every seat"
assert_eq "$RC" "1" "qualification-sweep: a generic failure keeps its old exit code 1 (INCOMPLETE)"
mk_layout "$TEST_TMP/qs-mut" mutant; git_layout "$TEST_TMP/qs-mut"
qs_run "$TEST_TMP/qs-mut" probe-authlog; mutant_red "qualification-sweep (probe)" 1
qs_run "$TEST_TMP/qs-mut" qualify-authraw; mutant_red "qualification-sweep (qualify)" 2

# ============================ 4. scripts/run-grok-implementer-ab.sh (one session per arm, with retries) ============================
# outputs of a paid call: dispatch stdout JSON, stderr, and the agent_log it names
ga_run() {
  local L="$1" mode="$2" bin="$1/fakebin"
  rm -rf "$L/calls" "$L/scratch" "$L/report.json"; : > "$L/calls"; mkdir -p "$bin" "$L/home"
  printf '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo grok-test 0.0.1; exit 0; }\nexit 1\n' > "$bin/grok"; chmod +x "$bin/grok"
  cat > "$L/fake-dispatch.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"; echo '{"type":"result","is_error":false}' > "$log"
case "${FAKE_MODE}" in
  auth) err="Failed to authenticate. API Error: 401" ;;
  authlog) err="simulated failure"; echo '{"type":"result","is_error":true,"result":"OAuth session expired"}' > "$log" ;;
  authweak) err="simulated failure"; echo 'agent output: invalid api key' > "$log" ;;
  quote) echo 'candidate says: Invalid API key' > "$log"; printf '{"status":"committed","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"agent_log":"%s","error":null}\n' "$log"; exit 0 ;;
  autherr) err="simulated failure"; echo "Failed to authenticate" >&2 ;;
  *) err="simulated failure" ;;
esac
printf '{"status":"failure","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"agent_log":"%s","error":"%s"}\n' "$log" "$err"
EOS
  node -e '
    const fs = require("fs"); const [seed, tasks] = process.argv.slice(1);
    fs.writeFileSync(seed, JSON.stringify({ schema_version: 1, seed: 20260806, bootstrap_resamples: 64, initial_pairs: 3, max_pairs: 3,
      max_provider_sessions: 30, max_retries_per_arm: 6, arms: { A: { effort: "medium" }, B: { effort: "high" } },
      actor: { runner: "grok", model: "Grok-4.5", family: "xai" }, primary_endpoint: "usable_session_rate_diff",
      material_effect_pp: 10, quality_non_inferiority_pp: 5, arm_order: "ABBA" }));
    fs.writeFileSync(tasks, JSON.stringify({ schema_version: 1, tasks: [1, 2, 3].map((i) => ({ id: "t0" + i, prompt: "p", acceptance: ["git diff --check"], max_files: 2 })) }));
  ' "$L/seed.json" "$L/tasks.json"
  local base cand; base="$(git -C "$L" rev-parse HEAD^)"; cand="$(git -C "$L" rev-parse HEAD)"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$bin:$PATH" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    AUTOPILOT_GROK_AB_DISPATCH_BIN="$L/fake-dispatch.sh" AUTOPILOT_GROK_AB_SCRATCH="$L/scratch" \
    bash "$L/scripts/run-grok-implementer-ab.sh" --tasks "$L/tasks.json" --seed "$L/seed.json" --report "$L/report.json" \
      --base-sha "$base" --candidate-sha "$cand" --timeout 1s < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/ga"; git_layout "$TEST_TMP/ga"
ga_run "$TEST_TMP/ga" auth;    stop_case "run-grok-implementer-ab (stdout JSON)" 1 "t01/A:"
assert_file_absent "$TEST_TMP/ga/scratch" "run-grok-implementer-ab: the scratch clone is removed on the stop path"
ga_run "$TEST_TMP/ga" authlog; stop_case "run-grok-implementer-ab (agent_log only)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" autherr; stop_case "run-grok-implementer-ab (stderr only)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" authweak; stop_case "run-grok-implementer-ab (failed call, weak phrase in plain agent_log)" 1 "t01/A:"
ga_run "$TEST_TMP/ga" quote
assert_neq "$RC" "6" "run-grok-implementer-ab: a successful call quoting an auth phrase does not stop"
if [ "$CALLS" -le 1 ]; then fail "run-grok-implementer-ab: quote case must keep running (calls=$CALLS)"; fi
ga_run "$TEST_TMP/ga" generic
assert_eq "$RC" "1" "run-grok-implementer-ab: a generic failure keeps its original exit code 1"
if [ "$CALLS" -le 1 ]; then fail "run-grok-implementer-ab: a generic failure must keep retrying (calls=$CALLS)"; fi
mk_layout "$TEST_TMP/ga-mut" mutant; git_layout "$TEST_TMP/ga-mut"
ga_run "$TEST_TMP/ga-mut" authlog; mutant_red "run-grok-implementer-ab" 1

# ============================ 5. evals/run-trigger-test.sh (two prompt loops, one claude -p each) ============================
# outputs of a paid call: stdout+stderr in one file ($outfile)
tt_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/res" "$L/fb"; : > "$L/calls"; mkdir -p "$L/fb" "$L/evals/trigger-prompts" "$L/home"
  printf 'dev-flow|start a feature\nbrainstorm|think it through\n' > "$L/evals/trigger-prompts/should-trigger.txt"
  printf 'what is the weather\nwrite a poem\n' > "$L/evals/trigger-prompts/should-not-trigger.txt"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo "Invalid API key · Please run /login" ;;
  authjson) echo '{"type":"result","is_error":true,"api_error_status":401,"result":"x"}' ;;
  authweak) echo "error: invalid api key" ;;
  quote) echo '{"type":"assistant","message":"the key was an Invalid API key in the docs"}'; exit 0 ;;
  *) echo '{"type":"result","is_error":true,"api_error_status":429,"result":"rate limit"}' ;;
esac
exit 1
EOS
  chmod +x "$L/fb/claude"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$L/fb:$PATH" AUTOPILOT_EVAL_INTEGRATION=1 AUTOPILOT_EVAL_RESULTS_DIR="$L/res" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    bash "$L/evals/run-trigger-test.sh" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/tt"
tt_run "$TEST_TMP/tt" auth;     stop_case "run-trigger-test (plain stdout)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" authjson; stop_case "run-trigger-test (JSON api_error_status 401)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" authweak; stop_case "run-trigger-test (failed call, weak phrase in merged stream)" 1 "dev-flow:"
tt_run "$TEST_TMP/tt" quote;    quote_case "run-trigger-test" 4
tt_run "$TEST_TMP/tt" generic
assert_eq "$CALLS" "4" "run-trigger-test: a generic failure runs every prompt"
assert_eq "$RC" "1" "run-trigger-test: a generic failure keeps its original exit code 1 (FAIL counted)"
mk_layout "$TEST_TMP/tt-mut" mutant; tt_run "$TEST_TMP/tt-mut" auth; mutant_red "run-trigger-test" 1

# ============================ 6. evals/context-budget-t2/run-t2-eval.js (one claude -p per case run) ============================
# outputs of a paid call: stdout (plain answer or CLI error line) and stderr
t2_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/fb"; : > "$L/calls"; mkdir -p "$L/fb" "$L/home/.claude" "$L/cfg"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo "Invalid API key · Please run /login"; exit 1 ;;
  autherr) echo "OAuth session expired" >&2; exit 1 ;;
  authweak) echo "error: invalid api key" >&2; exit 1 ;;
  quote) echo "ACTION: CONTINUE (the hook text mentions Invalid API key)"; exit 0 ;;
  *) echo "API Error: 429 rate limit" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fb/claude"
  OUT="$(cd "$L" && "${ENVX[@]}" HOME="$L/home" CLAUDE_EVAL_CONFIG_DIR="$L/cfg" PATH="$L/fb:$PATH" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    node "$L/evals/context-budget-t2/run-t2-eval.js" --runs-on 1 --runs-control 1 --out "$L/t2.json" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/t2"
t2_run "$TEST_TMP/t2" auth;    stop_case "run-t2-eval (stdout)" 1 "A-headless"
t2_run "$TEST_TMP/t2" autherr; stop_case "run-t2-eval (stderr)" 1 "A-headless"
t2_run "$TEST_TMP/t2" authweak; stop_case "run-t2-eval (failed call, weak phrase)" 1 "A-headless"
t2_run "$TEST_TMP/t2" quote
assert_neq "$RC" "6" "run-t2-eval: a successful call quoting an auth phrase does not stop"
if [ "$CALLS" -le 1 ]; then fail "run-t2-eval: quote case must run every job (calls=$CALLS)"; fi
t2_run "$TEST_TMP/t2" generic
assert_eq "$RC" "0" "run-t2-eval: a generic failure keeps its original exit code 0"
if [ "$CALLS" -le 1 ]; then fail "run-t2-eval: a generic failure must run every job (calls=$CALLS)"; fi
mk_layout "$TEST_TMP/t2-mut" mutant; t2_run "$TEST_TMP/t2-mut" auth; mutant_red "run-t2-eval" 1

# ============================ 7. evals/skill-transport/run-matrix.sh (one reviewer dispatch per cell) ============================
# outputs of a paid call: dispatch-review result JSON (names a raw_log) and stderr
rm_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/mx"; : > "$L/calls"; mkdir -p "$L/mx/kb" "$L/mx/clean" "$L/home"
  for c in a b; do echo "diff $c" > "$L/mx/kb/$c.diff"; echo "diff $c" > "$L/mx/clean/$c.diff"; done
  echo pack > "$L/mx/pack.md"; echo placebo > "$L/mx/placebo.md"
  cat > "$L/fake-review" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
raw="${FAKE_CALLS}.raw"; echo "nothing" > "$raw"
case "${FAKE_MODE}" in
  auth) echo '{"status":"precondition_failed","verdict":"","findings":"","error":"Failed to authenticate"}' ;;
  authraw) echo "OAuth session expired" > "$raw"; printf '{"status":"no_verdict","verdict":"","findings":"","raw_log":"%s"}\n' "$raw" ;;
  autherr) echo "Failed to authenticate" >&2; echo '{"status":"no_verdict","verdict":"","findings":""}' ;;
  authweak) echo "invalid api key" > "$raw"; printf '{"status":"no_verdict","verdict":"","findings":"","raw_log":"%s"}\n' "$raw" ;;
  quote) echo "the diff mentions Invalid API key" > "$raw"; printf '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"","raw_log":"%s"}\n' "$raw" ;;
  *) echo "429 rate limit" >&2; echo '{"status":"no_verdict","verdict":"","findings":""}' ;;
esac
EOS
  chmod +x "$L/fake-review"
  OUT="$("${ENVX[@]}" HOME="$L/home" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" DISPATCH_REVIEW_CMD="$L/fake-review" \
    bash "$L/evals/skill-transport/run-matrix.sh" --engine e1 --runner r --model m --arms nopack --known-bad-dir "$L/mx/kb" --clean-dir "$L/mx/clean" \
      --pack "$L/mx/pack.md" --placebo "$L/mx/placebo.md" --out "$L/mx/out.jsonl" --seed 7 < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/rm"
rm_run "$TEST_TMP/rm" auth;    stop_case "run-matrix (result JSON)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" authraw; stop_case "run-matrix (raw_log only)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" autherr; stop_case "run-matrix (stderr only)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" authweak; stop_case "run-matrix (failed result, weak phrase in raw_log)" 1 "e1|nopack|"
rm_run "$TEST_TMP/rm" quote;    quote_case "run-matrix" 4
rm_run "$TEST_TMP/rm" generic
assert_eq "$CALLS" "4" "run-matrix: a generic failure runs every cell"
assert_neq "$RC" "6" "run-matrix: a generic failure does not exit 6"
mk_layout "$TEST_TMP/rm-mut" mutant; rm_run "$TEST_TMP/rm-mut" authraw; mutant_red "run-matrix" 1

# ============================ 8. evals/skill-transport/run-implementer-matrix.sh (one codex dispatch per cell) ============================
# outputs of a paid call: dispatch.json (names an agent_log) and dispatch.stderr
im_run() {
  local L="$1" mode="$2" t pk
  rm -rf "$L/calls" "$L/im"; : > "$L/calls"; mkdir -p "$L/im/tasks" "$L/home"; : > "$L/scripts/dispatch-hetero.sh"; echo "process.exit(0);" > "$L/scripts/engine-capability-state.js"
  pk="$(sha256sum "$L/evals/skill-transport/packs/implementer-pack.md" | awk '{print $1}')"
  local entries=""
  for t in ta tb; do
    mkdir -p "$L/im/tasks/$t/repo"; echo "base" > "$L/im/tasks/$t/repo/f.txt"; echo "task $t" > "$L/im/tasks/$t/task.md"
    printf '#!/usr/bin/env bash\necho "STATUS: FAIL"\nexit 1\n' > "$L/im/tasks/$t/oracle.sh"
    entries="$entries{\"id\":\"$t\",\"path\":\"$t\",\"task_sha256\":\"$(sha256sum "$L/im/tasks/$t/task.md" | awk '{print $1}')\",\"oracle_sha256\":\"$(sha256sum "$L/im/tasks/$t/oracle.sh" | awk '{print $1}')\",\"verify_cmd\":[\"bash\",\"oracle.sh\"]},"
  done
  printf '{"schema_version":1,"pack_sha256":"%s","tasks":[%s]}\n' "$pk" "${entries%,}" > "$L/im/manifest.json"
  cat > "$L/fake-impl-dispatch" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"; echo "fine" > "$log"
case "${FAKE_MODE}" in
  auth) echo '{"status":"failure","model_calls":1,"error":"Failed to authenticate"}' ;;
  authlog) echo "OAuth session expired" > "$log"; printf '{"status":"failure","model_calls":1,"agent_log":"%s"}\n' "$log" ;;
  autherr) echo "Failed to authenticate" >&2; echo '{"status":"failure","model_calls":1}' ;;
  review-*) echo "work $RANDOM" > "w-$RANDOM.txt"; git add -A >/dev/null 2>&1; git commit -qm work >/dev/null 2>&1
    printf '{"status":"committed","commit":"%s","model_calls":1,"skill_mode_effective":"off","worktree":""}\n' "$(git rev-parse HEAD)" ;;
  *) echo "429 rate limit" >&2; echo '{"status":"failure","model_calls":1}' ;;
esac
EOS
  chmod +x "$L/fake-impl-dispatch"
  : > "$L/rcalls"
  cat > "$L/fake-reviewer" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_RCALLS:?}"
case "${FAKE_MODE}" in
  review-auth) echo '{"status":"precondition_failed","error":"Failed to authenticate"}'; exit 1 ;;
  review-authweak) echo "error: invalid api key" >&2; echo '{"status":"no_verdict"}'; exit 1 ;;
  review-quote) echo "the diff mentions Invalid API key" >&2; echo '{"status":"reviewed","verdict":"SHIP-AS-IS","findings":""}'; exit 0 ;;
esac
EOS
  chmod +x "$L/fake-reviewer"
  OUT="$("${ENVX[@]}" HOME="$L/home" FAKE_CALLS="$L/calls" FAKE_RCALLS="$L/rcalls" FAKE_MODE="$mode" \
    bash "$L/evals/skill-transport/run-implementer-matrix.sh" --test-mode --manifest "$L/im/manifest.json" --tasks-root "$L/im/tasks" \
      --pack "$L/evals/skill-transport/packs/implementer-pack.md" --out "$L/im/out.jsonl" --seed-file "$L/im/seed" --seed 5 \
      --private-root "$L/im/private" --dispatch-cmd "$L/fake-impl-dispatch" --reviewer-cmd "$L/fake-reviewer" --codex-bin /bin/true < /dev/null 2>&1)"
  RC=$?; CALLS=$(( $(count "$L/calls") + $(count "$L/rcalls") ))
}
mk_layout "$TEST_TMP/im"
im_run "$TEST_TMP/im" auth;    stop_case "run-implementer-matrix (dispatch.json)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" authlog; stop_case "run-implementer-matrix (agent_log only)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" autherr; stop_case "run-implementer-matrix (stderr only)" 1 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" review-auth;     stop_case "run-implementer-matrix (reviewer call, result JSON)" 2 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" review-authweak; stop_case "run-implementer-matrix (failed reviewer, weak phrase in stderr)" 2 "gpt-5.3-codex-spark|"
im_run "$TEST_TMP/im" review-quote
assert_neq "$RC" "6" "run-implementer-matrix: a successful reviewer quoting an auth phrase does not stop"
if [ "$CALLS" -le 2 ]; then fail "run-implementer-matrix: reviewer quote case must run every cell (calls=$CALLS) -- $OUT"; fi
im_run "$TEST_TMP/im" generic
assert_neq "$RC" "6" "run-implementer-matrix: a generic failure does not exit 6"
if [ "$CALLS" -le 1 ]; then fail "run-implementer-matrix: a generic failure must run every cell (calls=$CALLS) -- $OUT"; fi
mk_layout "$TEST_TMP/im-mut" mutant; im_run "$TEST_TMP/im-mut" authlog; mutant_red "run-implementer-matrix (dispatch)" 1
im_run "$TEST_TMP/im-mut" review-auth; mutant_red "run-implementer-matrix (reviewer)" 2

# ============================ 9. evals/pipeline-bench/run-pipeline-bench.sh (author rounds + reviewer calls) ============================
# outputs of a paid call: RAW_LOG (claude stdout+stderr), the reviewer's result JSON (names a raw_log) and its stderr (into RAW_LOG)
pb_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/rcalls" "$L/fb" "$L/pb-out" "$L/evals/orchestration"; : > "$L/calls"; : > "$L/rcalls"; mkdir -p "$L/fb" "$L/evals/orchestration/tasks/t1/repo" "$L/home"
  echo base > "$L/evals/orchestration/tasks/t1/repo/f.txt"; echo "do it" > "$L/evals/orchestration/tasks/t1/task.md"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$L/scripts/error-path-scan.sh"; echo "process.exit(0);" > "$L/scripts/secret-scan-diff.js"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
echo "change $RANDOM" >> f.txt
case "${FAKE_MODE}" in
  claude-auth) echo "Failed to authenticate" >&2; exit 1 ;;
  claude-authweak) echo "error: invalid api key" >&2; exit 1 ;;
  quote) echo '{"type":"result","is_error":false,"result":"the docs say Invalid API key","total_cost_usd":0}'; exit 0 ;;
esac
echo '{"type":"result","is_error":false,"result":"done","total_cost_usd":0}'
EOS
  chmod +x "$L/fb/claude"
  cat > "$L/fake-review" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_RCALLS:?}"
raw="${FAKE_RCALLS}.raw"; echo ok > "$raw"
case "${FAKE_MODE}" in
  review-auth) echo '{"status":"no_verdict","verdict":"null","findings":"","error":"Failed to authenticate"}' ;;
  review-authraw) echo "OAuth session expired" > "$raw"; printf '{"status":"no_verdict","verdict":"null","findings":"","raw_log":"%s"}\n' "$raw" ;;
  *) echo '{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"fix it"}' ;;
esac
EOS
  chmod +x "$L/fake-review"
  OUT="$("${ENVX[@]}" HOME="$L/home" PATH="$L/fb:$PATH" FAKE_CALLS="$L/calls" FAKE_RCALLS="$L/rcalls" FAKE_MODE="$mode" PIPELINE_BENCH_REVIEW_CMD="$L/fake-review" \
    bash "$L/evals/pipeline-bench/run-pipeline-bench.sh" --task t1 --arm pipeline --model m --out "$L/pb-out" --max-rounds 3 < /dev/null 2>&1)"
  RC=$?; CALLS=$(( $(count "$L/calls") + $(count "$L/rcalls") ))
}
mk_layout "$TEST_TMP/pb"
pb_run "$TEST_TMP/pb" claude-auth;    stop_case "run-pipeline-bench (author call, RAW_LOG)" 1 "t1/round-1:"
pb_run "$TEST_TMP/pb" claude-authweak; stop_case "run-pipeline-bench (failed author call, weak phrase in merged log)" 1 "t1/round-1:"
pb_run "$TEST_TMP/pb" quote
assert_neq "$RC" "6" "run-pipeline-bench: a successful call quoting an auth phrase does not stop"
pb_run "$TEST_TMP/pb" review-auth;    stop_case "run-pipeline-bench (reviewer result JSON)" 2 "t1/review-1:"
pb_run "$TEST_TMP/pb" review-authraw; stop_case "run-pipeline-bench (reviewer raw_log only)" 2 "t1/review-1:"
pb_run "$TEST_TMP/pb" generic
assert_neq "$RC" "6" "run-pipeline-bench: a generic failure does not exit 6"
if [ "$CALLS" -le 2 ]; then fail "run-pipeline-bench: a generic failure must keep running rounds (calls=$CALLS) -- $OUT"; fi
mk_layout "$TEST_TMP/pb-mut" mutant; pb_run "$TEST_TMP/pb-mut" review-authraw; mutant_red "run-pipeline-bench" 2

# ============================ 10. scripts/benchmark-hook-latency.js (one claude -p per arm and sample) ============================
# outputs of a paid call: stdout (JSON envelope) and stderr
bh_run() {
  local L="$1" mode="$2"
  rm -rf "$L/calls" "$L/fb" "$L/bh"; : > "$L/calls"; mkdir -p "$L/fb" "$L/bh" "$L/home" "$L/hooks-repo/hooks"
  echo '{"hooks":{}}' > "$L/hooks-repo/hooks/hooks.json"
  ( cd "$L/hooks-repo" && git init -q -b main && git config user.email t@t.invalid && git config user.name t && git add -A && git commit -q -m x )
  echo '{}' > "$L/bh/cred.json"
  cat > "$L/fb/claude" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
case "${FAKE_MODE}" in
  auth) echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login","total_cost_usd":0}'; exit 1 ;;
  autherr) echo "OAuth session expired" >&2; exit 1 ;;
  authweak) echo "error: invalid api key" >&2; exit 1 ;;
  quote) echo '{"type":"result","is_error":false,"result":"Invalid API key is a phrase","total_cost_usd":0.01}'; exit 0 ;;
  *) echo "API Error: 429 rate limit" >&2; exit 1 ;;
esac
EOS
  chmod +x "$L/fb/claude"
  OUT="$(cd "$L/hooks-repo" && "${ENVX[@]}" HOME="$L/home" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" BENCH_CLAUDE_BIN="$L/fb/claude" BENCH_CREDENTIALS="$L/bh/cred.json" \
    node "$L/scripts/benchmark-hook-latency.js" --max-usd 5 --samples 2 --out "$L/bh/report.json" < /dev/null 2>&1)"
  RC=$?; CALLS="$(count "$L/calls")"
}
mk_layout "$TEST_TMP/bh"
bh_run "$TEST_TMP/bh" auth;    stop_case "benchmark-hook-latency (stdout envelope)" 1 "enabled sample 1:"
bh_run "$TEST_TMP/bh" autherr; stop_case "benchmark-hook-latency (stderr)" 1 "enabled sample 1:"
assert_file_absent "$TEST_TMP/bh/bh/report.json" "benchmark-hook-latency: no report is written on the auth stop"
bh_run "$TEST_TMP/bh" authweak; stop_case "benchmark-hook-latency (failed call, weak phrase)" 1 "enabled sample 1:"
bh_run "$TEST_TMP/bh" quote
assert_neq "$RC" "6" "benchmark-hook-latency: a successful call quoting an auth phrase does not stop"
bh_run "$TEST_TMP/bh" generic
assert_neq "$RC" "6" "benchmark-hook-latency: a generic failure does not exit 6"
if [ "$CALLS" -le 1 ]; then fail "benchmark-hook-latency: a generic failure must keep sampling (calls=$CALLS) -- $OUT"; fi
assert_eq "$RC" "4" "benchmark-hook-latency: a generic failure keeps its original exit code 4 (refused conclusion)"
mk_layout "$TEST_TMP/bh-mut" mutant; bh_run "$TEST_TMP/bh-mut" auth; mutant_red "benchmark-hook-latency" 1

finalize_test
