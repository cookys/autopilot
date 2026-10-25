#!/usr/bin/env bash
# hooks/tests/paid-batch-auth-stop.test.sh -- BL-0294: every per-id paid batch stops at the FIRST authentication
# failure (STOP_AUTH line + exit 6, no later id launched) and keeps going on a generic failure.
# Each script runs in a throwaway copy of the repo layout with FAKE runners (no model call, no real ~/.claude:
# HOME is a mktemp dir). Each scenario also runs against a MUTANT layout whose helper never reports a
# failure; the stop assertion must then be false (negative control, printed as MUTANT-RED).
. "$(dirname "$0")/lib.sh"

SCRIPTS="$REPO_ROOT/scripts"

# mk_layout <dir> [mutant]: scripts + shared helper copied; the mutant's helper never reports a failure.
mk_layout() {
  local d="$1" mutant="${2:-}"
  mkdir -p "$d/scripts/lib" "$d/evals"
  cp "$SCRIPTS/run-eval-batch.sh" "$SCRIPTS/bench-engine-capability.sh" "$SCRIPTS/qualification-sweep.sh" \
     "$SCRIPTS/run-grok-implementer-ab.sh" "$d/scripts/"
  cp "$SCRIPTS/lib/auth-stop.js" "$SCRIPTS/lib/auth-stop.sh" "$SCRIPTS/lib/repo-identity.sh" "$d/scripts/lib/"
  if [ -n "$mutant" ]; then
    echo 'module.exports.checkSources = () => null; process.exitCode = 0; if (require.main === module) process.exit(0);' >> "$d/scripts/lib/auth-stop.js"
  fi
}
# Fresh git repo with two commits (the grok A/B harness clones it and resolves HEAD^).
git_layout() {
  ( cd "$1" && git init -q -b main && git config user.email t@t.invalid && git config user.name t \
    && git add -A && git commit -q -m one && git commit -q --allow-empty -m two )
}

# ============================ 1. scripts/run-eval-batch.sh (one run_eval per skill) ============================
eb_run() { # <layout> <mode: auth|generic>
  local L="$1" mode="$2" H="$1/home"
  rm -rf "$L/home" "$L/skills" "$L/skill-creator-workspace" "$L/calls"; : > "$L/calls"
  mkdir -p "$H/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator" "$L/tmp"
  for s in alpha beta gamma; do
    mkdir -p "$L/skills/$s" "$L/skill-creator-workspace/evals"; : > "$L/skill-creator-workspace/evals/$s-evals.json"
  done
  cat > "$L/fake-run-eval" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
echo '{"summary": {"passed": 1, "total": 1}}'
if [ "${FAKE_MODE}" = auth ]; then echo "Failed to authenticate. API Error: 401" >&2; exit 1; fi
echo "API Error: 429 rate limit reached" >&2; exit 1
EOS
  chmod +x "$L/fake-run-eval"
  EB_OUT="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CONFIG_DIR HOME="$H" TMPDIR="$L/tmp" \
    FAKE_CALLS="$L/calls" FAKE_MODE="$mode" RUN_EVAL_CMD="$L/fake-run-eval" bash "$L/scripts/run-eval-batch.sh" < /dev/null 2>&1)"
  EB_RC=$?; EB_CALLS="$(wc -l < "$L/calls" | tr -d ' ')"
}
mk_layout "$TEST_TMP/eb"; eb_run "$TEST_TMP/eb" auth
assert_eq "6" "$EB_RC" "run-eval-batch: first auth failure exits 6"
assert_eq "1" "$EB_CALLS" "run-eval-batch: no later skill is launched after the auth failure"
assert_contains "$EB_OUT" "STOP_AUTH after alpha:" "run-eval-batch: stop line names the first skill"
eb_run "$TEST_TMP/eb" generic
assert_eq "3" "$EB_CALLS" "run-eval-batch: a generic failure does not stop the batch"
assert_neq "6" "$EB_RC" "run-eval-batch: a generic failure does not exit 6"
mk_layout "$TEST_TMP/eb-mut" mutant; eb_run "$TEST_TMP/eb-mut" auth
if [ "$EB_RC" = 6 ] && [ "$EB_CALLS" = 1 ]; then fail "run-eval-batch: mutant still stopped (negative control broken)"; fi
echo "MUTANT-RED run-eval-batch: rc=$EB_RC calls=$EB_CALLS (the stop assertions above would be false)"

# ============================ 2. scripts/bench-engine-capability.sh (one dispatch per case) ============================
bc_run() { # <layout> <mode>
  local L="$1" mode="$2" H="$1/home"
  rm -rf "$H" "$L/calls"; : > "$L/calls"; mkdir -p "$H" "$L/evals/engine-capabilities"
  for c in brainstorm-gate quality-review-findings-first dev-flow-branch-check no-skill-claim; do
    : > "$L/evals/engine-capabilities/$c.prompt.txt"; : > "$L/evals/engine-capabilities/$c.expected.txt"
  done
  cat > "$L/scripts/dispatch-hetero.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
log="${FAKE_CALLS}.agent.log"
if [ "${FAKE_MODE}" = auth ]; then
  echo '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}' > "$log"
else
  echo '{"type":"result","is_error":true,"result":"rate limit 429, retry later"}' > "$log"
fi
printf '{"status":"failure","worktree":"","agent_log":"%s","files_changed":0}\n' "$log"
EOS
  chmod +x "$L/scripts/dispatch-hetero.sh"
  echo 'process.exit(0);' > "$L/scripts/engine-capability-state.js"
  BC_OUT="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CONFIG_DIR HOME="$H" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    bash "$L/scripts/bench-engine-capability.sh" --runner agy --model m1 --skill-mode prompt --live-spend < /dev/null 2>&1)"
  BC_RC=$?; BC_CALLS="$(wc -l < "$L/calls" | tr -d ' ')"
}
mk_layout "$TEST_TMP/bc"; bc_run "$TEST_TMP/bc" auth
assert_eq "6" "$BC_RC" "bench-engine-capability: first auth failure exits 6"
assert_eq "1" "$BC_CALLS" "bench-engine-capability: no later case is dispatched"
assert_contains "$BC_OUT" "STOP_AUTH after brainstorm-gate:" "bench-engine-capability: stop line names the first case"
bc_run "$TEST_TMP/bc" generic
assert_eq "4" "$BC_CALLS" "bench-engine-capability: a generic failure runs every case"
assert_neq "6" "$BC_RC" "bench-engine-capability: a generic failure does not exit 6"
mk_layout "$TEST_TMP/bc-mut" mutant; bc_run "$TEST_TMP/bc-mut" auth
if [ "$BC_RC" = 6 ] && [ "$BC_CALLS" = 1 ]; then fail "bench-engine-capability: mutant still stopped (negative control broken)"; fi
echo "MUTANT-RED bench-engine-capability: rc=$BC_RC calls=$BC_CALLS"

# ============================ 3. scripts/qualification-sweep.sh (one administration per seat) ============================
qs_run() { # <layout> <mode: probe-auth|qualify-auth|generic>
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
case "${FAKE_MODE}" in
  probe-auth) echo '{"status":"failure","error":"Failed to authenticate. API Error: 401"}' ;;
  generic) echo '{"status":"failure","error":"API Error: 429 rate limit reached"}' ;;
  *) echo '{"status": "committed"}' ;;
esac
EOS
  cat > "$L/scripts/engine-qualify.js" <<'EOS'
const fs = require('fs');
fs.appendFileSync(process.env.FAKE_QCALLS, 'call\n');
if (process.env.FAKE_MODE === 'qualify-auth') { console.error('OAuth session expired, please log in'); process.exit(3); }
console.log('{"status":"PASS","quality":{"corpus_pass":"1/1"},"capability_score":1,"latency":{"sample_wall_time_s":1}}');
EOS
  QS_OUT="$(cd "$L" && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CONFIG_DIR HOME="$L/home" PATH="$PATH" \
    FAKE_DCALLS="$L/dcalls" FAKE_QCALLS="$L/qcalls" FAKE_MODE="$mode" \
    bash "$L/scripts/qualification-sweep.sh" --roster "$L/roster.json" --execute --yes < /dev/null 2>&1)"
  QS_RC=$?; QS_D="$(wc -l < "$L/dcalls" | tr -d ' ')"; QS_Q="$(wc -l < "$L/qcalls" | tr -d ' ')"
}
mk_layout "$TEST_TMP/qs"; git_layout "$TEST_TMP/qs"; qs_run "$TEST_TMP/qs" probe-auth
assert_eq "6" "$QS_RC" "qualification-sweep: probe auth failure exits 6"
assert_eq "1" "$QS_D" "qualification-sweep: only the first seat is probed"
assert_eq "0" "$QS_Q" "qualification-sweep: no administration starts after a dead probe"
assert_contains "$QS_OUT" "STOP_AUTH after probe-codex/m1:" "qualification-sweep: stop line names the probe"
qs_run "$TEST_TMP/qs" qualify-auth
assert_eq "6" "$QS_RC" "qualification-sweep: auth failure inside the administration exits 6"
assert_eq "1" "$QS_Q" "qualification-sweep: later seats are not administered"
assert_contains "$QS_OUT" "STOP_AUTH after s1:" "qualification-sweep: stop line names the seat"
qs_run "$TEST_TMP/qs" generic
assert_eq "3" "$QS_D" "qualification-sweep: a generic probe failure still probes every seat"
assert_eq "1" "$QS_RC" "qualification-sweep: a generic failure keeps its old exit code 1 (INCOMPLETE)"
mk_layout "$TEST_TMP/qs-mut" mutant; git_layout "$TEST_TMP/qs-mut"; qs_run "$TEST_TMP/qs-mut" probe-auth
if [ "$QS_RC" = 6 ] && [ "$QS_D" = 1 ]; then fail "qualification-sweep: mutant still stopped (negative control broken)"; fi
echo "MUTANT-RED qualification-sweep: rc=$QS_RC probes=$QS_D (the stop assertions above would be false)"

# ============================ 4. scripts/run-grok-implementer-ab.sh (one session per arm, with retries) ============================
ga_run() { # <layout> <mode: auth|generic>
  local L="$1" mode="$2" bin="$1/fakebin"
  rm -rf "$L/calls" "$L/scratch" "$L/report.json"; : > "$L/calls"; mkdir -p "$bin"
  printf '#!/usr/bin/env bash\n[ "${1:-}" = "--version" ] && { echo grok-test 0.0.1; exit 0; }\nexit 1\n' > "$bin/grok"; chmod +x "$bin/grok"
  cat > "$L/fake-dispatch.sh" <<'EOS'
#!/usr/bin/env bash
echo call >> "${FAKE_CALLS:?}"
if [ "${FAKE_MODE}" = auth ]; then
  echo '{"status":"failure","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"error":"Failed to authenticate. API Error: 401"}'
else
  echo '{"status":"failure","runner":"grok","model":"grok-4.5","commit":null,"files_changed":0,"model_calls":1,"error":"simulated failure"}'
fi
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
  GA_OUT="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CONFIG_DIR HOME="$L/home" PATH="$bin:$PATH" FAKE_CALLS="$L/calls" FAKE_MODE="$mode" \
    AUTOPILOT_GROK_AB_DISPATCH_BIN="$L/fake-dispatch.sh" AUTOPILOT_GROK_AB_SCRATCH="$L/scratch" \
    bash "$L/scripts/run-grok-implementer-ab.sh" --tasks "$L/tasks.json" --seed "$L/seed.json" --report "$L/report.json" \
      --base-sha "$base" --candidate-sha "$cand" --timeout 1s < /dev/null 2>&1)"
  GA_RC=$?; GA_CALLS="$(wc -l < "$L/calls" | tr -d ' ')"
}
mkdir -p "$TEST_TMP/ga/home"; mk_layout "$TEST_TMP/ga"; git_layout "$TEST_TMP/ga"; ga_run "$TEST_TMP/ga" auth
assert_eq "6" "$GA_RC" "run-grok-implementer-ab: first auth failure exits 6"
assert_eq "1" "$GA_CALLS" "run-grok-implementer-ab: no retry and no later session after the auth failure"
assert_contains "$GA_OUT" "STOP_AUTH after t01/A:" "run-grok-implementer-ab: stop line names task and arm"
assert_file_absent "$TEST_TMP/ga/scratch" "run-grok-implementer-ab: the scratch clone is removed on the stop path"
ga_run "$TEST_TMP/ga" generic
assert_neq "6" "$GA_RC" "run-grok-implementer-ab: a generic failure does not exit 6 (old exit code kept)"
if [ "$GA_CALLS" -le 1 ]; then fail "run-grok-implementer-ab: a generic failure must keep retrying (calls=$GA_CALLS)"; fi
mkdir -p "$TEST_TMP/ga-mut/home"; mk_layout "$TEST_TMP/ga-mut" mutant; git_layout "$TEST_TMP/ga-mut"; ga_run "$TEST_TMP/ga-mut" auth
if [ "$GA_RC" = 6 ] && [ "$GA_CALLS" = 1 ]; then fail "run-grok-implementer-ab: mutant still stopped (negative control broken)"; fi
echo "MUTANT-RED run-grok-implementer-ab: rc=$GA_RC calls=$GA_CALLS"

finalize_test
