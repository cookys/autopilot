#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/bin/autopilot.js"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

STUB_VERDICT="$TEST_TMP/eng-verdict"
cat > "$STUB_VERDICT" <<'EOF'
#!/usr/bin/env bash
read_prompt_arg() {
  local prompt=""
  local i=1
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1))
      next_arg="${!next_index}"
      if [ -n "$next_arg" ] && [ -f "$next_arg" ]; then
        prompt="$(cat "$next_arg")"
      else
        prompt="$next_arg"
      fi
      break
    fi
    i=$((i + 1))
  done
  if [ -z "$prompt" ]; then
    prompt="$(cat)"
  fi
  printf '%s' "$prompt"
}
extract_markers() {
  local prompt="$1"
  if [ -z "$prompt" ]; then
    return 1
  fi
  local begin end
  begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  if [ -z "$begin" ] || [ -z "$end" ]; then
    return 1
  fi
  printf '%s\n%s\n' "$begin" "$end"
}
PROMPT="$(read_prompt_arg "$@")"
if ! MARKERS="$(extract_markers "$PROMPT" 2>/dev/null)"; then
  exit 1
fi
BEGIN="$(printf '%s\n' "$MARKERS" | sed -n '1p')"
END="$(printf '%s\n' "$MARKERS" | sed -n '2p')"

echo "$BEGIN"
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: delegated through public CLI"
echo "$END"
EOF
chmod +x "$STUB_VERDICT"

OUT="$(node "$CLI" --help 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "autopilot --help exits 0"
assert_contains "$OUT" "dispatch review" "autopilot help lists dispatch review"
assert_contains "$OUT" "engine review-loop" "autopilot help lists engine review-loop"
assert_contains "$OUT" "engine implement-review" "autopilot help lists engine implement-review"
assert_contains "$OUT" "--require-qualified-reviewer" "autopilot help documents reviewer qualification default flag"
assert_contains "$OUT" "--allow-unqualified-reviewer" "autopilot help documents reviewer qualification escape hatch"
assert_contains "$OUT" "--campaign-contract" "autopilot help documents the mandatory campaign contract"
assert_contains "$OUT" "--legacy-unmanaged" "autopilot help documents the temporary compatibility rail"
assert_contains "$OUT" "host-owned exact-roster provider-readiness trust root" \
  "autopilot help documents strict L5 provider readiness"

printf 'implementer loop prompt\n' > "$TEST_TMP/engine-impl-review-prompt.txt"
BASE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing base exits 2"
assert_contains "$OUT" "flags --prompt-file, --branch, --base are required" "implement-review reports missing base"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --base base-sha 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing branch exits 2"
assert_contains "$OUT" "flags --prompt-file, --branch, --base are required" "implement-review reports missing branch"

OUT="$(node "$CLI" engine implement-review --branch loop-branch --base base-sha 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing prompt-file exits 2"
assert_contains "$OUT" "flags --prompt-file, --branch, --base are required" "implement-review reports missing prompt-file"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base base-sha --max-rounds 0 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review invalid max-rounds exits 2"
assert_contains "$OUT" "invalid --max-rounds value: 0" "implement-review validates max-rounds"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base base-sha --cwd 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review missing cwd value exits 2"
assert_contains "$OUT" "--cwd requires a value" "implement-review validates cwd value"

OUT="$(node "$CLI" engine implement-review --legacy-unmanaged --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base develop 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "implement-review moving base ref exits 1"
assert_contains "$OUT" "base must be a full immutable git SHA" "implement-review blocks moving base refs before dispatch"

OUT="$(ENGINE_SCORECARD_DIR="$TEST_TMP/empty-scorecard" node "$CLI" engine implement-review --legacy-unmanaged --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base "$BASE_SHA" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "implement-review defaults to failing closed on unqualified reviewer"
assert_contains "$OUT" '"phase":"reviewer_qualification"' "implement-review default blocks at reviewer qualification"
assert_contains "$OUT" "reviewer is not qualified or qualification is unknown" "implement-review qualification block explains reason"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base "$BASE_SHA" --require-qualified-reviewer --allow-unqualified-reviewer 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review rejects conflicting reviewer qualification flags"
assert_contains "$OUT" "cannot be combined" "implement-review reports conflicting reviewer qualification flags"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base "$BASE_SHA" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review without a campaign contract exits 2"
assert_contains "$OUT" "--campaign-contract is required" "implement-review fails closed on missing campaign contract"

legacy_ledger_count() {
  local ledger_dir="$HOOK_HOME/.autopilot/run-ledger"
  if [ ! -d "$ledger_dir" ]; then
    printf '0\n'
    return
  fi
  find "$ledger_dir" -type f | wc -l | tr -d ' '
}
for level in l5 l6; do
  BEFORE_LEGACY_LEDGER="$(legacy_ledger_count)"
  OUT="$(AUTOPILOT_LEVEL="$level" node "$CLI" engine implement-review \
    --legacy-unmanaged \
    --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" \
    --branch loop-branch --base "$BASE_SHA" 2>&1)"
  EXIT=$?
  AFTER_LEGACY_LEDGER="$(legacy_ledger_count)"
  assert_eq "1" "$EXIT" "${level^^} rejects the legacy unmanaged compatibility rail"
  assert_contains "$OUT" '"legacy_unmanaged_rejected"' \
    "${level^^} legacy rejection is machine-readable"
  assert_contains "$OUT" '"removal_release":"v2.35.0"' \
    "${level^^} rejection retains the dated removal release"
  assert_contains "$OUT" '"removal_deadline":"2026-08-31"' \
    "${level^^} rejection retains the dated removal deadline"
  assert_eq "$BEFORE_LEGACY_LEDGER" "$AFTER_LEGACY_LEDGER" \
    "${level^^} legacy rejection occurs before any durable runner spend"
  assert_not_contains "$OUT" '"strict_l5_provider_readiness"' \
    "${level^^} legacy rejection is never labelled strict L5 readiness"
done

# Command-level strict-L5 positive fixture. The preload replaces only the
# process-internal live probe collector with deterministic host observations;
# production exposes no CLI flag, environment receipt, or serialized callback
# that can replace either authority closure.
STRICT_L5_PRELOAD="$TEST_TMP/strict-l5-live-fixture.cjs"
cat > "$STRICT_L5_PRELOAD" <<'NODE'
'use strict';
const path = require('path');
const root = process.env.STRICT_L5_TEST_REPO_ROOT;
const modulePath = path.join(root, 'src', 'readiness', 'provider-bootstrap.js');
const providerBootstrap = require(modulePath);
const originalCreate = providerBootstrap.createStrictL5ProviderBootstrap;
const { buildSelectedRoster } = require(path.join(root, 'src', 'readiness', 'status'));
const { qualifyExactRoleNow } = require(path.join(root, 'src', 'readiness', 'qualification-provider'));
const { createProviderReadinessReceipt } = require(path.join(root, 'src', 'readiness', 'receipt'));
const observation = (tuple, axis, now, ttl) => ({
  schema_version: 1,
  artifact_type: 'provider_axis_observation',
  tuple,
  axis,
  status: 'ready',
  observed_at: now,
  ttl_seconds: ttl,
  evidence_class: axis === 'qualification'
    ? 'host-injected-exact-role'
    : (axis === 'transport' ? 'safe-surface' : 'live-probe'),
  reason: null,
});
providerBootstrap.createStrictL5ProviderBootstrap = (options) => originalCreate(options, {
  now: () => new Date().toISOString(),
  collectReadiness: (input) => {
    const ttl = input.resolvedRoster.provider_readiness_receipt_ttl_seconds;
    const roster = buildSelectedRoster(input.resolvedRoster, input.now, ttl);
    for (const seat of roster) {
      for (const candidate of [seat, ...seat.fallbacks]) {
        const qualification = qualifyExactRoleNow(
          input.qualificationProvider,
          candidate.tuple,
          input.now,
          ttl,
        );
        candidate.observations = {
          transport: observation(candidate.tuple, 'transport', input.now, ttl),
          live: observation(candidate.tuple, 'live', input.now, ttl),
          qualification,
        };
      }
    }
    const policy = {
      receipt_ttl_seconds: ttl,
      fallback_family_constraint:
        input.resolvedRoster.provider_readiness_fallback_family_constraint,
    };
    return {
      receipt: createProviderReadinessReceipt({ roster, policy, now: input.now }),
      roster,
      policy,
    };
  },
});
NODE

OUT="$(STRICT_L5_TEST_REPO_ROOT="$REPO_ROOT" \
  NODE_OPTIONS="--require=$STRICT_L5_PRELOAD" \
  AUTOPILOT_LEVEL=l5 \
  node "$CLI" engine implement-review \
    --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" \
    --branch loop-branch --base "$BASE_SHA" \
    --campaign-contract "$TEST_TMP/no-such-campaign.json" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "strict L5 executable fixture reaches the engine after fresh readiness"
assert_contains "$OUT" '"strict_l5_provider_readiness":{"status":"ready"' \
  "strict L5 executable fixture consumes a fresh host-owned readiness bundle"
assert_contains "$OUT" '"policy_digest":"856551c093f382114166404c4c0288da667da5ff4075da30021a7c8a9fea547c"' \
  "strict L5 executable fixture records the frozen policy digest"
assert_contains "$OUT" '"cap-v1-22e96639504e14d8a36e29a8e3d5747807a4ec7cc99f454d6898fe2680790575"' \
  "strict L5 executable fixture records canonical claim provenance"

STRICT_DRIFT_CFG="$TEST_TMP/strict-l5-drift-review-loop.md"
sed 's/reviewer_engine: MiniMax-M3/reviewer_engine: unknown-reviewer-model/' \
  "$REPO_ROOT/.claude/review-loop-config.md" > "$STRICT_DRIFT_CFG"
OUT="$(AUTOPILOT_LEVEL=l5 REVIEW_LOOP_CONFIG_OVERRIDE="$STRICT_DRIFT_CFG" \
  node "$CLI" engine implement-review \
    --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" \
    --branch loop-branch --base "$BASE_SHA" \
    --campaign-contract "$TEST_TMP/no-such-campaign.json" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "strict L5 CLI rejects roster drift"
assert_contains "$OUT" '"rejection_code":"strict_l5_provider_unknown_tuple"' \
  "strict L5 CLI reports the exact roster-drift rejection"
assert_contains "$OUT" '"dispatcher_called":false' \
  "strict L5 CLI roster rejection occurs before dispatcher invocation"
assert_contains "$OUT" '"model_calls":0' \
  "strict L5 CLI roster rejection spends zero model calls"

OUT="$(AUTOPILOT_LEVEL=l4 node "$CLI" engine implement-review \
  --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" \
  --branch loop-branch --base "$BASE_SHA" --allow-unqualified-reviewer \
  --campaign-contract "$TEST_TMP/no-such-campaign.json" 2>&1)"
assert_not_contains "$OUT" '"strict_l5_provider_readiness"' \
  "lower-level managed flow is explicit and never labelled strict L5"

OUT="$(node "$CLI" --help 2>&1)"; EXIT=$?
assert_contains "$OUT" "--resume" "autopilot help documents the --resume flag"

OUT="$(node "$CLI" engine implement-review --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch loop-branch --base "$BASE_SHA" --bogus-resume-flag 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "implement-review rejects unknown flags"
assert_contains "$OUT" "unknown engine implement-review option: --bogus-resume-flag" "implement-review reports unknown flag"

# --resume against a definitely-nonexistent branch fails closed as resume_invalid
# (real gitResumeInspect); --allow-unqualified-reviewer bypasses the qualification
# preflight so the resume precheck is reached. Nothing is mutated.
OUT="$(node "$CLI" engine implement-review --legacy-unmanaged --prompt-file "$TEST_TMP/engine-impl-review-prompt.txt" --branch autopilot-no-such-resume-branch-xyz --base "$BASE_SHA" --allow-unqualified-reviewer --resume 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "implement-review --resume on a missing branch exits 1"
assert_contains "$OUT" '"phase":"resume_invalid"' "implement-review --resume fails closed as resume_invalid on a missing branch"
assert_contains "$OUT" "does not exist or has no commit" "implement-review --resume explains the missing branch"

OUT="$(node "$CLI" dispatch review --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_VERDICT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "dispatch review preserves reviewed exit 0"
assert_contains "$OUT" '"status": "reviewed"' "dispatch review emits delegated JSON"
assert_contains "$OUT" '"verdict": "FIX-THEN-SHIP"' "dispatch review preserves verdict"
assert_contains "$OUT" "delegated through public CLI" "dispatch review preserves findings"

OUT="$(node "$CLI" dispatch review --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin /nonexistent/runner 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "dispatch review preserves precondition exit 2"
assert_contains "$OUT" '"status": "precondition_failed"' "dispatch review preserves precondition JSON"

OUT="$(node "$CLI" bogus command 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown command exits 2"
assert_contains "$OUT" "unknown command" "unknown command explains failure"

OUT="$(node "$CLI" dispatch 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing dispatch subcommand exits 2"
assert_contains "$OUT" "unknown dispatch subcommand" "missing dispatch subcommand explains failure"

# Hermetic: EMPTY_CFG pins the resolver's built-in default reviewer (gpt-5.5) so this asserts
# the delegation plumbing, not the repo's live dogfood roster (Board decision A → MiniMax-M3).
EMPTY_CFG="$TEST_TMP/empty-review-loop.md"; : > "$EMPTY_CFG"
OUT="$(ENGINE_SCORECARD_DIR="$TEST_TMP/empty-scorecard" REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" node "$CLI" engine review-loop --check-scorecard 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "engine review-loop preserves resolver exit 0"
assert_contains "$OUT" '"reviewer_engine": "gpt-5.5"' "engine review-loop emits delegated JSON"
assert_contains "$OUT" '"reviewer_qualified": false' "engine review-loop preserves scorecard fields"

OUT="$(ENGINE_SCORECARD_DIR="$TEST_TMP/empty-scorecard" REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" node "$CLI" engine review-loop --check-scorecard --enforce 2>&1)"; EXIT=$?
assert_eq "3" "$EXIT" "engine review-loop preserves enforce exit 3"
assert_contains "$OUT" '"reviewer_qualified": false' "engine review-loop emits data on enforce block"

OUT="$(node "$CLI" engine 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing engine subcommand exits 2"
assert_contains "$OUT" "unknown engine subcommand" "missing engine subcommand explains failure"

MODULE_OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { dispatchReview } = require(path.join(root, 'src', 'runners', 'review'));
const result = dispatchReview([], {
  scriptPath: path.join(root, 'scripts', 'missing-dispatch-review.sh'),
  stdio: 'pipe',
});
console.log(result.error ? 'error' : 'no-error');
console.log(result.status === null ? 'status-null' : `status-${result.status}`);
NODE
)"
assert_contains "$MODULE_OUT" "error" "review module reports missing script"
assert_contains "$MODULE_OUT" "status-null" "review module missing script has null status"

finalize_test
