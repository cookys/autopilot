#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

REPO="$TEST_TMP/repo"
SCORES="$TEST_TMP/scores"
CAPS="$TEST_TMP/caps"
PROMPT="$TEST_TMP/prompt.txt"
CAMPAIGN="$TEST_TMP/campaign-v2.json"
CAMPAIGN_FALSE="$TEST_TMP/campaign-v2-false.json"
SEAL="$TEST_TMP/campaign-v2.seal.json"
SESSION_DIR="$TEST_TMP/session-empty"
mkdir -p "$REPO/docs/plans" "$REPO/.claude" "$SCORES" "$CAPS" "$SESSION_DIR"

git -C "$REPO" init -q -b main
git -C "$REPO" config user.email "projection@example.invalid"
git -C "$REPO" config user.name "Campaign Projection Test"
printf '## Strict bridge\nFrozen authority.\n' > "$REPO/docs/plans/spec.md"
printf 'required\n' > "$REPO/required.txt"
printf '%s\n' \
  '- implementer_engine: gpt-5.3-codex-spark' \
  '- implementer_runner: codex' > "$REPO/.claude/review-loop-config.md"
git -C "$REPO" add .
git -C "$REPO" commit -qm "base"
BASE="$(git -C "$REPO" rev-parse HEAD)"
COMMON_RAW="$(git -C "$REPO" rev-parse --git-common-dir)"
COMMON="$(realpath "$REPO/$COMMON_RAW")"
# Seal may retain a Mission-v2 provenance id; durable run/leaf identity is ICC v1.
MISSION_CAMPAIGN_ID="campaign-v2-$(printf 'a%.0s' {1..64})"
ROOT_RUN_ID="mission-root-projection"
printf 'Implement the strict bridge fixture.\n' > "$PROMPT"

CAMPAIGN_ID="$(node - "$REPO_ROOT" "$CAMPAIGN" "$CAMPAIGN_FALSE" "$SEAL" "$COMMON" "$BASE" \
  "$MISSION_CAMPAIGN_ID" "$ROOT_RUN_ID" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [
  root,
  target,
  falseTarget,
  sealTarget,
  common,
  base,
  missionCampaignId,
  rootRunId,
] = process.argv.slice(2);
const { campaignIdFor } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const campaign = {
  schema_version: 2,
  ticket: 'strict-bridge',
  profile: 'poc',
  mission_grant_ref: '1'.repeat(64),
  repo_identity: `git-common-dir:${common}`,
  base_sha: base,
  branch: 'feat/strict-bridge',
  vertical_acceptance: ['strict projection is enforced'],
  allowed_path_prefixes: ['docs', 'required.txt', 'src'],
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
    root_run_id: rootRunId,
    mission_lineage_id: 'lineage-v1-strict-bridge',
    mission_policy_digest: '2'.repeat(64),
    mission_graph_digest: '3'.repeat(64),
    graph_node_id: 'strict-bridge-node',
    graph_node_digest: '4'.repeat(64),
  },
  strict_dispatch: {
    schema_version: 1,
    spec: { path: 'docs/plans/spec.md', section: 'Strict bridge' },
    required_paths: ['docs/plans/spec.md', 'required.txt'],
    output_paths: ['src/out.txt'],
    allowed_path_prefixes: ['docs', 'required.txt', 'src'],
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
const bytes = `${JSON.stringify(campaign, null, 2)}\n`;
fs.writeFileSync(target, bytes);
const falseCampaign = JSON.parse(JSON.stringify(campaign));
falseCampaign.strict_dispatch.verification_commands = ['false'];
falseCampaign.verify_cmd = 'false';
fs.writeFileSync(falseTarget, `${JSON.stringify(falseCampaign, null, 2)}\n`);
const contractSha = digest(bytes);
// Seal retains Mission-v2 provenance; ICC v1 is derived from raw contract bytes.
fs.writeFileSync(sealTarget, `${JSON.stringify({
  schema_version: 1,
  contract_sha256: contractSha,
  campaign_id: missionCampaignId,
})}\n`);
process.stdout.write(campaignIdFor(`git-common-dir:${common}`, 'strict-bridge', contractSha));
NODE
)"
assert_neq "$CAMPAIGN_ID" "" "projection fixture derives ICC campaign id"
assert_contains "$CAMPAIGN_ID" "campaign-v1-" "projection leaf identity is ICC v1"

UNIT_OUT="$(node - "$REPO_ROOT" "$REPO" "$CAMPAIGN" "$SEAL" "$BASE" \
  "$CAMPAIGN_ID" "$ROOT_RUN_ID" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [
  root,
  repo,
  campaignPath,
  sealPath,
  base,
  campaignId,
  rootRunId,
] = process.argv.slice(2);
const projection = require(path.join(root, 'src', 'engine', 'campaign-dispatch-projection'));
const {
  AutopilotEngine,
  bindCampaignScopeReceipt,
} = require(path.join(root, 'src', 'engine', 'autopilot-engine'));
const {
  createWriterFence,
} = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const {
  canonicalDigest,
  normalizeCampaignArtifactReference,
} = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const bytes = fs.readFileSync(campaignPath);
const campaign = JSON.parse(bytes);
const campaignDigest = crypto.createHash('sha256').update(bytes).digest('hex');
const derive = (overrides = {}) => projection.deriveCampaignDispatchUnit({
  campaignContract: campaign,
  campaignContractSha256: campaignDigest,
  campaignId,
  branch: campaign.branch,
  base,
  runner: 'fixture',
  model: 'fixture-model',
  stage: 'campaign-implementation',
  rootRunId,
  ...overrides,
});
const initial = derive();
const repairBranch = `${campaign.branch}-repair-r2-${base.slice(0, 7)}`;
const repair = derive({
  branch: repairBranch,
  stage: 'campaign-implementation#r2',
});
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch (_error) {
    return true;
  }
};
const checks = {
  initial_generation: initial.campaign_projection.generation === 0,
  repair_generation: repair.campaign_projection.generation === 1,
  exact_output: JSON.stringify(initial.output.paths) === JSON.stringify(['src/out.txt']),
  churn_bound: initial.scope.max_diff_lines === 15,
  attempt_bound: initial.budget.max_attempts === 2,
  verification_argv: JSON.stringify(initial.acceptance[0].argv)
    === JSON.stringify(['sh', '-lc', 'test -f src/out.txt']),
  wrong_branch_rejected: throws(() => derive({ branch: 'feat/wrong' })),
  wrong_base_rejected: throws(() => derive({ base: 'b'.repeat(40) })),
  wrong_repair_branch_rejected: throws(() => derive({
    branch: campaign.branch,
    stage: 'campaign-implementation#r2',
  })),
  wrong_root_rejected: throws(() => derive({ rootRunId: 'wrong-root' })),
};
const drifted = JSON.parse(JSON.stringify(initial));
drifted.output.paths = ['src/drift.txt'];
checks.unit_drift_rejected = throws(() => projection.verifyCampaignDispatchUnit({
  campaignContract: campaign,
  campaignContractSha256: campaignDigest,
  campaignId,
  branch: campaign.branch,
  base,
  runner: 'fixture',
  model: 'fixture-model',
  stage: 'campaign-implementation',
  rootRunId,
  unitContract: drifted,
}));
checks.digest_drift_rejected = throws(() => projection.verifyCampaignDispatchUnit({
  campaignContract: campaign,
  campaignContractSha256: 'f'.repeat(64),
  campaignId,
  branch: campaign.branch,
  base,
  runner: 'fixture',
  model: 'fixture-model',
  stage: 'campaign-implementation',
  rootRunId,
  unitContract: initial,
}));
checks.runner_model_drift_rejected = throws(() => projection.verifyCampaignDispatchUnit({
  campaignContract: campaign,
  campaignContractSha256: campaignDigest,
  campaignId,
  branch: campaign.branch,
  base,
  runner: 'other-runner',
  model: 'other-model',
  stage: 'campaign-implementation',
  rootRunId,
  unitContract: initial,
}));

const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  implementer_engine: 'fixture-model',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
const calls = [];
let badResult = false;
let badModel = false;
const engine = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher(args, options) {
    const contractPath = args[args.indexOf('--contract-file') + 1];
    const unitBytes = fs.readFileSync(contractPath);
    const unit = JSON.parse(unitBytes);
    const unitDigest = crypto.createHash('sha256').update(unitBytes).digest('hex');
    calls.push({ args: [...args], env: { ...options.env }, unit, contractPath });
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'fixture',
        model: badModel ? 'wrong-model' : 'fixture-model',
        branch: args[args.indexOf('--branch') + 1],
        base: args[args.indexOf('--base') + 1],
        commit: base,
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: repo,
        agent_log: null,
        error: null,
        run_id: campaignId,
        unit_id: unit.unit_id,
        go: 'GO',
        boundary: 'ok',
        acceptance: 'ok',
        campaign_contract_sha256: campaignDigest,
        contract_sha256: badResult ? '0'.repeat(64) : unitDigest,
        unit_contract_sha256: unitDigest,
      },
    };
  },
});
const invoke = (round, branch, env = {
  AUTOPILOT_PARENT_RUN_ID: 'foreman',
  AUTOPILOT_ROOT_RUN_ID: rootRunId,
  AUTOPILOT_DISPATCH_DEPTH: '1',
}) => engine.implementTask({
  promptFile: path.join(repo, '..', 'prompt.txt'),
  branch,
  base,
  roster,
  runId: campaignId,
  ledger: path.join(repo, '.autopilot', 'projection-ledger.jsonl'),
  implementationRound: round,
  implementationStage: 'campaign-implementation',
  campaignContractFile: campaignPath,
  campaignContractDigest: campaignDigest,
  campaignSealFile: sealPath,
  implementationOptions: { env },
});
const first = invoke(1, campaign.branch);
const second = invoke(2, repairBranch);
const resumed = invoke(1, campaign.branch);
const beforeRejects = calls.length;
const wrongBranch = invoke(1, 'feat/wrong');
const wrongBase = engine.implementTask({
  promptFile: path.join(repo, '..', 'prompt.txt'),
  branch: campaign.branch,
  base: 'b'.repeat(40),
  roster,
  runId: campaignId,
  ledger: path.join(repo, '.autopilot', 'projection-ledger.jsonl'),
  implementationRound: 1,
  implementationStage: 'campaign-implementation',
  campaignContractFile: campaignPath,
  campaignContractDigest: campaignDigest,
  campaignSealFile: sealPath,
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman',
      AUTOPILOT_ROOT_RUN_ID: rootRunId,
    },
  },
});
const missingRoot = invoke(1, campaign.branch, {});
const wrongRoot = invoke(1, campaign.branch, {
  AUTOPILOT_PARENT_RUN_ID: 'foreman',
  AUTOPILOT_ROOT_RUN_ID: 'wrong-root',
});
const wrongCampaignDigest = engine.implementTask({
  promptFile: path.join(repo, '..', 'prompt.txt'),
  branch: campaign.branch,
  base,
  roster,
  runId: campaignId,
  ledger: path.join(repo, '.autopilot', 'projection-ledger.jsonl'),
  implementationRound: 1,
  implementationStage: 'campaign-implementation',
  campaignContractFile: campaignPath,
  campaignContractDigest: 'e'.repeat(64),
  campaignSealFile: sealPath,
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman',
      AUTOPILOT_ROOT_RUN_ID: rootRunId,
    },
  },
});
const strictArgsOverride = engine.implementTask({
  promptFile: path.join(repo, '..', 'prompt.txt'),
  branch: campaign.branch,
  base,
  roster,
  runId: campaignId,
  ledger: path.join(repo, '.autopilot', 'projection-ledger.jsonl'),
  implementationRound: 1,
  implementationStage: 'campaign-implementation',
  campaignContractFile: campaignPath,
  campaignContractDigest: campaignDigest,
  campaignSealFile: sealPath,
  extraImplementationArgs: ['--contract-file', '/tmp/caller-unit.json'],
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman',
      AUTOPILOT_ROOT_RUN_ID: rootRunId,
    },
  },
});
checks.initial_call_strict = first.status === 'committed'
  && calls[0].args.includes('--strict-contract');
checks.repair_call_strict = second.status === 'committed'
  && calls[1].unit.campaign_projection.generation === 1;
checks.resume_call_strict = resumed.status === 'committed'
  && calls[2].unit.campaign_projection.generation === 0;
checks.root_bound = calls.slice(0, 3).every(
  (call) => call.env.AUTOPILOT_ROOT_RUN_ID === rootRunId,
);
checks.unit_files_reaped = calls.slice(0, 3).every(
  (call) => !fs.existsSync(call.contractPath),
);
checks.wrong_callers_pre_spend = [
  wrongBranch,
  wrongBase,
  missingRoot,
  wrongRoot,
  wrongCampaignDigest,
  strictArgsOverride,
].every((result) => result.status === 'blocked') && calls.length === beforeRejects;

const candidateTree = require('child_process').execFileSync(
  'git',
  ['-C', repo, 'rev-parse', `${base}^{tree}`],
  { encoding: 'utf8' },
).trim();
const writerFence = createWriterFence({
  campaignId,
  stageIdentity: 'campaign-implementation',
  candidateCommit: base,
  candidateTreeSha: candidateTree,
  implementationResult: first,
});
const candidate = normalizeCampaignArtifactReference({
  kind: 'git_candidate',
  commit: base,
  tree_sha: candidateTree,
  branch: campaign.branch,
  base,
  writer_fence: writerFence,
  campaign_contract_sha256: campaignDigest,
  unit_contract_sha256: first.implementation.unit_contract_sha256,
});
const scopeReceipt = bindCampaignScopeReceipt({
  receipt: {
    passed: true,
    changed_files: ['src/out.txt'],
    total_churn: 1,
    receipt_digest: 'd'.repeat(64),
  },
  candidate,
  campaignContractSha256: campaignDigest,
});
const { receipt_digest: scopeReceiptDigest, ...scopeReceiptBody } = scopeReceipt;
checks.digest_chain_bound = writerFence.campaign_contract_sha256 === campaignDigest
  && writerFence.unit_contract_sha256 === first.implementation.unit_contract_sha256
  && candidate.campaign_contract_sha256 === writerFence.campaign_contract_sha256
  && candidate.unit_contract_sha256 === writerFence.unit_contract_sha256
  && scopeReceipt.campaign_contract_sha256 === candidate.campaign_contract_sha256
  && scopeReceipt.unit_contract_sha256 === candidate.unit_contract_sha256
  && scopeReceiptDigest === canonicalDigest(scopeReceiptBody);
checks.candidate_digest_drift_rejected = throws(() => normalizeCampaignArtifactReference({
  ...candidate,
  unit_contract_sha256: '0'.repeat(64),
}));
checks.scope_digest_drift_rejected = throws(() => bindCampaignScopeReceipt({
  receipt: scopeReceipt,
  candidate: {
    ...candidate,
    campaign_contract_sha256: '0'.repeat(64),
  },
  campaignContractSha256: campaignDigest,
}));
checks.writer_fence_partial_chain_rejected = throws(() => createWriterFence({
  campaignId,
  stageIdentity: 'campaign-implementation',
  candidateCommit: base,
  candidateTreeSha: candidateTree,
  implementationResult: {
    ...first,
    implementation: {
      ...first.implementation,
      unit_contract_sha256: undefined,
    },
  },
}));
badResult = true;
const digestMismatch = invoke(1, campaign.branch);
checks.committed_digest_mismatch_blocked = digestMismatch.status === 'blocked';
badResult = false;
badModel = true;
const modelMismatch = invoke(1, campaign.branch);
checks.committed_model_mismatch_blocked = modelMismatch.status === 'blocked';
for (const [name, passed] of Object.entries(checks)) {
  process.stdout.write(`${name}=${passed}\n`);
}
NODE
)"
UNIT_EXIT=$?
assert_exit_code "$UNIT_EXIT" "0" "projection unit and engine oracle exits zero"
for key in \
  initial_generation repair_generation exact_output churn_bound attempt_bound verification_argv \
  wrong_branch_rejected wrong_base_rejected wrong_repair_branch_rejected \
  wrong_root_rejected unit_drift_rejected digest_drift_rejected \
  runner_model_drift_rejected \
  initial_call_strict repair_call_strict resume_call_strict root_bound \
  unit_files_reaped wrong_callers_pre_spend digest_chain_bound \
  candidate_digest_drift_rejected scope_digest_drift_rejected \
  writer_fence_partial_chain_rejected committed_digest_mismatch_blocked \
  committed_model_mismatch_blocked; do
  assert_contains "$UNIT_OUT" "$key=true" "projection proves $key"
done

ENGINE_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ENGINE_EVENT="{\"schema_version\":1,\"observed_at\":\"$NOW\",\"runner\":\"codex\",\"model\":\"gpt-5.3-codex-spark\",\"role\":\"implementer\",\"runner_version\":\"v1\",\"capability\":{\"quota\":{\"status\":\"available\",\"confidence\":\"high\",\"ttl_seconds\":3600,\"reset_at\":null,\"evidence\":\"test\"}}}"
printf '%s\n' "$ENGINE_ROW" > "$TEST_TMP/engine-row.json"
printf '%s\n' "$ENGINE_EVENT" > "$TEST_TMP/engine-event.json"
ENGINE_SCORECARD_DIR="$SCORES" node "$REPO_ROOT/scripts/engine-scorecard.js" record \
  --file "$TEST_TMP/engine-row.json" >/dev/null
assert_exit_code "$?" "0" "projection scorecard seed succeeds"
ENGINE_CAPABILITY_DIR="$CAPS" node "$REPO_ROOT/scripts/engine-capability-state.js" record \
  --file "$TEST_TMP/engine-event.json" >/dev/null
assert_exit_code "$?" "0" "projection capability seed succeeds"

STUB="$TEST_TMP/codex"
cat > "$STUB" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*) echo "codex-cli projection-test"; exit 0 ;;
esac
mkdir -p src
case "${PROJECTION_ACTION:-ok}" in
  outside)
    printf 'ok\n' > src/out.txt
    printf 'outside\n' > outside.txt
    ;;
  churn)
    for i in $(seq 1 30); do printf 'line %s\n' "$i"; done > src/out.txt
    ;;
  *) printf 'ok\n' > src/out.txt ;;
esac
git add -A
git -c user.email=projection@example.invalid -c user.name=Projection \
  commit -qm projection
STUB
chmod +x "$STUB"

write_unit() {
  local campaign="$1"
  local target="$2"
  local branch="$3"
  node - "$REPO_ROOT" "$campaign" "$target" "$BASE" "$CAMPAIGN_ID" \
    "$ROOT_RUN_ID" "$branch" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [root, campaignPath, target, base, campaignId, rootRunId, branch] = process.argv.slice(2);
const bytes = fs.readFileSync(campaignPath);
const campaign = JSON.parse(bytes);
campaign.branch = branch;
const contract = require(path.join(root, 'src', 'engine', 'campaign-dispatch-projection'))
  .deriveCampaignDispatchUnit({
    campaignContract: campaign,
    campaignContractSha256: crypto.createHash('sha256').update(
      `${JSON.stringify(campaign, null, 2)}\n`,
    ).digest('hex'),
    campaignId,
    branch,
    base,
    runner: 'codex',
    model: 'gpt-5.3-codex-spark',
    stage: 'campaign-implementation',
    rootRunId,
  });
fs.writeFileSync(target, `${JSON.stringify(contract, null, 2)}\n`);
NODE
}

run_strict_case() {
  local name="$1"
  local action="$2"
  local campaign="$3"
  local unit="$TEST_TMP/$name.unit.json"
  local branch="feat/$name"
  write_unit "$campaign" "$unit" "$branch"
  (
    cd "$REPO" || exit 9
    ENGINE_SCORECARD_DIR="$SCORES" ENGINE_CAPABILITY_DIR="$CAPS" \
    AUTOPILOT_SESSION_MODE_DIR="$SESSION_DIR" AUTOPILOT_DISPATCH_MANIFEST=0 \
    DISPATCH_QUIET=1 PROJECTION_ACTION="$action" TMPDIR="$TEST_TMP/$name" \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" \
      --branch "$branch" --base "$BASE" --prompt-file "$PROMPT" \
      --runner codex --model gpt-5.3-codex-spark --codex-bin "$STUB" \
      --strict-contract --contract-file "$unit" 2>&1
  )
}

mkdir -p "$TEST_TMP/strict-ok" "$TEST_TMP/strict-outside" \
  "$TEST_TMP/strict-churn" "$TEST_TMP/strict-false"
STRICT_OK="$(run_strict_case strict-ok ok "$CAMPAIGN")"; STRICT_OK_RC=$?
assert_eq "0" "$STRICT_OK_RC" "projected strict unit succeeds"
assert_contains "$STRICT_OK" '"boundary": "ok"' "projected strict unit runs boundary postcheck"
assert_contains "$STRICT_OK" '"acceptance": "ok"' "projected strict unit runs acceptance"

STRICT_OUTSIDE="$(run_strict_case strict-outside outside "$CAMPAIGN")"; STRICT_OUTSIDE_RC=$?
assert_eq "1" "$STRICT_OUTSIDE_RC" "projected strict unit rejects outside path"
assert_contains "$STRICT_OUTSIDE" '"status": "boundary_rejected"' \
  "outside path is rejected by strict boundary"

STRICT_CHURN="$(run_strict_case strict-churn churn "$CAMPAIGN")"; STRICT_CHURN_RC=$?
assert_eq "1" "$STRICT_CHURN_RC" "projected strict unit rejects churn"
assert_contains "$STRICT_CHURN" "budget exceeded" "churn failure names strict budget"

STRICT_FALSE="$(run_strict_case strict-false ok "$CAMPAIGN_FALSE")"; STRICT_FALSE_RC=$?
assert_eq "1" "$STRICT_FALSE_RC" "projected strict unit rejects false verification"
assert_contains "$STRICT_FALSE" '"status": "acceptance_failed"' \
  "false verification fails strict acceptance"

finalize_test
