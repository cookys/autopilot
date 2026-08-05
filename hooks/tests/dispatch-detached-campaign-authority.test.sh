#!/usr/bin/env bash
# Regression: campaign strict authority must survive dispatch-hetero's detached
# state serialization.  A campaign may authorize several output paths while a
# narrow effectful attempt changes only one of them.
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
LEDGER_SH="$REPO_ROOT/scripts/run-ledger.sh"

REPO="$TEST_TMP/campaign-repo"
SCORES="$TEST_TMP/scores"
CAPS="$TEST_TMP/caps"
PROMPT="$TEST_TMP/prompt.txt"
CAMPAIGN="$TEST_TMP/campaign.json"
SEAL="$TEST_TMP/campaign.seal.json"
UNIT="$TEST_TMP/dispatch-unit.json"
STUB="$TEST_TMP/codex-stub"
LEDGER="$TEST_TMP/ledger.jsonl"
SESSION_DIR="$TEST_TMP/session-mode"
mkdir -p "$REPO/docs/plans" "$REPO/.claude" "$SCORES" "$CAPS" "$SESSION_DIR"

git -C "$REPO" init -q -b main
git -C "$REPO" config user.email "campaign-authority@example.invalid"
git -C "$REPO" config user.name "Campaign Authority Test"
printf '%s\n' '## Detached strict authority' 'Frozen fixture spec.' > "$REPO/docs/plans/spec.md"
printf '%s\n' \
  '- implementer_engine: gpt-5.3-codex-spark' \
  '- implementer_runner: codex' > "$REPO/.claude/review-loop-config.md"
git -C "$REPO" add -A
git -C "$REPO" commit -qm "base"
BASE="$(git -C "$REPO" rev-parse HEAD)"
COMMON_RAW="$(git -C "$REPO" rev-parse --git-common-dir)"
COMMON="$(realpath "$REPO/$COMMON_RAW")"
printf '%s\n' 'Implement the detached strict fixture.' > "$PROMPT"

# The campaign checker is the authority that emits strict_authority=true.  Keep
# this fixture mission-mode off so no Mission claim/state is needed.
node - "$CAMPAIGN" "$COMMON" "$BASE" <<'NODE'
'use strict';
const fs = require('fs');
const [target, common, base] = process.argv.slice(2);
const campaign = {
  schema_version: 1,
  ticket: 'detached-strict-authority',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${common}`,
  base_sha: base,
  branch: 'feat/detached-strict-authority',
  vertical_acceptance: ['detached strict authority preserves the sealed output surface'],
  allowed_path_prefixes: ['docs', 'src'],
  max_changed_files: 2,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'test -f src/out.txt',
  rubric_ids: ['R1'],
  mission_runtime: {
    schema_version: 1,
    root_run_id: 'detached-strict-root',
    mission_lineage_id: `lineage-v1-${'a'.repeat(64)}`,
    mission_policy_digest: 'b'.repeat(64),
    mission_graph_digest: 'c'.repeat(64),
    graph_node_id: 'detached-strict-node',
    graph_node_digest: 'd'.repeat(64),
  },
  strict_dispatch: {
    schema_version: 1,
    spec: { path: 'docs/plans/spec.md', section: 'Detached strict authority' },
    required_paths: ['docs/plans/spec.md'],
    output_paths: ['src/out.txt', 'src/optional.txt'],
    allowed_path_prefixes: ['docs', 'src'],
    budget: {
      max_changed_files: 2,
      max_wall_seconds: 120,
      max_output_bytes: 4096,
      max_tool_calls: 10,
      max_engine_attempts: 2,
    },
    verification_commands: ['test -f src/out.txt'],
  },
};
fs.writeFileSync(target, `${JSON.stringify(campaign, null, 2)}\n`);
NODE

CAMPAIGN_SHA="$(sha256sum "$CAMPAIGN" | awk '{print $1}')"
SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$CAMPAIGN" --repo "$REPO" --mission-mode off --out "$SEAL" 2>&1)"
SEAL_RC=$?
assert_eq "0" "$SEAL_RC" "campaign fixture seal succeeds"
assert_contains "$SEAL_OUT" '"verdict": "SEALED"' "campaign fixture seal is authoritative"

CHECK_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" check \
  --contract "$CAMPAIGN" --repo "$REPO" --mission-mode off --seal "$SEAL" 2>&1)"
CHECK_RC=$?
assert_eq "0" "$CHECK_RC" "campaign fixture check succeeds"
CAMPAIGN_ID="$(printf '%s' "$CHECK_OUT" | jq -r '.campaign_id' 2>/dev/null)"
assert_contains "$CAMPAIGN_ID" 'campaign-v1-' "campaign fixture uses ICC v1 identity"
assert_eq "true" "$(printf '%s' "$CHECK_OUT" | jq -r '.strict_authority' 2>/dev/null)" \
  "campaign fixture enables strict authority"

# Project the exact dispatch-unit contract that dispatch-hetero verifies before
# spending.  Its output.paths deliberately contains one untouched authorized
# path so legacy required-all behavior is observable.
node - "$REPO_ROOT" "$CAMPAIGN" "$UNIT" "$CAMPAIGN_SHA" "$CAMPAIGN_ID" "$BASE" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [root, campaignPath, unitPath, campaignSha, campaignId, base] = process.argv.slice(2);
const { deriveCampaignDispatchUnit } = require(path.join(root, 'src', 'engine', 'campaign-dispatch-projection'));
const campaign = JSON.parse(fs.readFileSync(campaignPath, 'utf8'));
const unit = deriveCampaignDispatchUnit({
  campaignContract: campaign,
  campaignContractSha256: campaignSha,
  campaignId,
  branch: campaign.branch,
  base,
  runner: 'codex',
  model: 'gpt-5.3-codex-spark',
  stage: 'campaign-implementation',
  rootRunId: campaign.mission_runtime.root_run_id,
});
fs.writeFileSync(unitPath, `${JSON.stringify(unit, null, 2)}\n`);
NODE

ENGINE_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
RUNTIME_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ENGINE_EVENT="{\"schema_version\":1,\"observed_at\":\"$RUNTIME_UTC\",\"runner\":\"codex\",\"model\":\"gpt-5.3-codex-spark\",\"role\":\"implementer\",\"effort\":\"high\",\"endpoint\":null,\"runner_version\":\"v1.0.0\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"reset_at\":null,\"evidence\":\"test\"}}}"
printf '%s\n' "$ENGINE_ROW" > "$TEST_TMP/engine-row.json"
printf '%s\n' "$ENGINE_EVENT" > "$TEST_TMP/engine-event.json"
ENGINE_SCORECARD_DIR="$SCORES" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$TEST_TMP/engine-row.json" >/dev/null
ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/engine-event.json" >/dev/null

cat > "$STUB" <<'EOF_STUB'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*) echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
mkdir -p src
printf '%s\n' detached > src/out.txt
git add src/out.txt
git -c user.email=t@t -c user.name=t commit -qm "detached campaign fixture"
exit 0
EOF_STUB
chmod +x "$STUB"

bash "$LEDGER_SH" init --ledger "$LEDGER" >/dev/null
# The managed-dev-flow admission consumes a session marker whose READY routing
# admission is bound to the campaign's sealed policy/graph digests.  Emit the
# minimal exact fixture shape directly; no real Mission state or external
# controller is involved in this runner-only regression.
node - "$REPO_ROOT" "$SESSION_DIR" "$REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [root, markerDir, repo] = process.argv.slice(2);
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const now = Date.now();
const common = require('child_process').execFileSync(
  'git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  { encoding: 'utf8' },
).trim();
const admission = {
  schema_version: 1,
  artifact_type: 'mission_routing_admission',
  authority_status: 'enforce',
  repo_identity: `git-common-dir:${common}`,
  mission_policy_digest: 'b'.repeat(64),
  mission_graph_digest: 'c'.repeat(64),
  sources_digest: 'e'.repeat(64),
  deliverable_count: 1,
  source_authoring_unit_count: 1,
  critical_path: ['detached-strict-node'],
  batch_count: 1,
  reservation_totals: {
    campaigns: 1,
    wall_seconds: 120,
    tool_calls: 10,
    engine_attempts: 2,
    external_wait_seconds: 0,
    canonical_changed_files: 2,
    output_bytes: 4096,
  },
};
const marker = {
  session_id: 'detached-strict-authority',
  level: 'l5',
  repo_root: repo,
  started_at: new Date(now - 1000).toISOString(),
  expires_at: new Date(now + 3600000).toISOString(),
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: { ...admission, admission_digest: canonicalDigest(admission) },
  },
};
fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(path.join(markerDir, `${marker.session_id}.json`), `${JSON.stringify(marker, null, 2)}\n`);
NODE
OUT="$(cd "$REPO" && AUTOPILOT_SESSION_MODE_DIR="$SESSION_DIR" \
  AUTOPILOT_SESSION_ID=detached-strict-authority AUTOPILOT_LEVEL=l5 \
  AUTOPILOT_PARENT_RUN_ID=detached-strict-parent AUTOPILOT_ROOT_RUN_ID=detached-strict-root \
  ENGINE_SCORECARD_DIR="$SCORES" ENGINE_CAPABILITY_DIR="$CAPS" \
  DISPATCH_HEARTBEAT_SECS=1 DISPATCH_QUIET=1 bash "$SCRIPT" \
  --branch feat/detached-strict-authority --prompt-file "$PROMPT" \
  --runner codex --model gpt-5.3-codex-spark --codex-bin "$STUB" \
  --ledger "$LEDGER" --run-id "$CAMPAIGN_ID" --stage campaign-implementation \
  --strict-contract --contract-file "$UNIT" \
  --campaign-contract "$CAMPAIGN" --campaign-contract-sha256 "$CAMPAIGN_SHA" \
  --campaign-seal "$SEAL" 2>&1)"
EXIT_CODE=$?

# On the unpatched base, detached_main loses CAMPAIGN_STRICT_AUTHORITY and
# rejects src/optional.txt as if this were a legacy unit contract.  After the
# canonical serialization fix, the same run commits the narrow subset.
assert_eq "0" "$EXIT_CODE" "detached campaign strict dispatch commits authorized subset"
assert_eq "committed" "$(printf '%s' "$OUT" | jq -r '.status' 2>/dev/null)" \
  "detached campaign strict dispatch returns committed"
COMMIT_SHA="$(printf '%s' "$OUT" | jq -r '.commit' 2>/dev/null)"
CHANGED_PATHS="$(git -C "$REPO" diff-tree --no-commit-id --name-only -r "$COMMIT_SHA" 2>/dev/null | tr -d '\r')"
assert_eq "$CHANGED_PATHS" "src/out.txt" \
  "detached campaign strict dispatch changes only the narrow subset"
RESULT="${LEDGER}.results/${CAMPAIGN_ID}.campaign-implementation.result.json"
assert_file_exists "$RESULT" "detached campaign strict dispatch lands durable result"
assert_eq "committed" "$(jq -r '.status' "$RESULT" 2>/dev/null)" \
  "detached campaign strict dispatch durable result is committed"

finalize_test
