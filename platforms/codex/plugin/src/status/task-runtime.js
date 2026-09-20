'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildTaskStatus } = require('./task-status');
const { validateDispatchMergeProvenance } = require('../engine/controller-execution');
const {
  IDENTITY_SCHEME_V2,
  claimMissionSubjectDigest,
  isMissionSubjectV2Claim,
  missionCampaignIdFor,
  missionSubjectDigest,
} = require('../engine/mission-campaign-identity');
const {
  inspectLifecycleReceipt,
} = require('../../scripts/lifecycle-residue-receipt');

const MERGE_PRODUCT_PATH_PREFIXES = Object.freeze([
  'src',
  'scripts',
  'hooks',
  'platforms/codex/plugin/src',
  'platforms/codex/plugin/scripts',
]);

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function repoIdentity(repo) {
  const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  let canonical;
  try {
    canonical = fs.realpathSync(common);
  } catch (_error) {
    return null;
  }
  return `git-common-dir:${canonical}`;
}

function matchesMissionSubjectV2Claim(claim, campaignState, candidate, contract) {
  if (!isMissionSubjectV2Claim(claim)
      || !contract
      || typeof contract !== 'object'
      || Array.isArray(contract)) {
    return false;
  }

  let subjectDigest;
  let campaignId;
  try {
    subjectDigest = missionSubjectDigest(contract);
    campaignId = missionCampaignIdFor(
      campaignState.repo_identity,
      campaignState.ticket,
      subjectDigest,
    );
  } catch (_error) {
    return false;
  }

  const claimSubjectDigest = claimMissionSubjectDigest(claim);
  return typeof claim.binding_digest === 'string'
    && contract.mission_grant_ref === claim.binding_digest
    && contract.repo_identity === campaignState.repo_identity
    && contract.ticket === campaignState.ticket
    && contract.base_sha === candidate.base
    && claim.base_sha === candidate.base
    && claimSubjectDigest === subjectDigest
    && (claim.mission_subject_digest === undefined
      || claim.mission_subject_digest === subjectDigest)
    && (claim.campaign_contract_digest === undefined
      || claim.campaign_contract_digest === subjectDigest)
    && claim.campaign_id === campaignId;
}

function resolveCampaignBinding({ missionState, campaignState, candidate, contract }) {
  const matches = Object.values(missionState.claims || {}).filter((claim) => (
    claim
    && claim.released !== true
    && (isMissionSubjectV2Claim(claim)
      ? matchesMissionSubjectV2Claim(claim, campaignState, candidate, contract)
      : claim.campaign_contract_digest === campaignState.contract_digest
        && claim.base_sha === candidate.base)
  ));
  if (matches.length !== 1) return { status: 'unknown' };
  const claim = matches[0];
  const binding = {
    status: 'valid',
    claim_id: claim.claim_id,
    mission_campaign_id: claim.campaign_id,
    icc_campaign_id: campaignState.campaign_id,
    binding_digest: claim.binding_digest,
  };
  if (isMissionSubjectV2Claim(claim)) {
    binding.identity_scheme = IDENTITY_SCHEME_V2;
    binding.mission_subject_digest = claimMissionSubjectDigest(claim);
  }
  return binding;
}

function runtimeAdapters() {
  return {
    resolveRepoIdentity: repoIdentity,
    inspectLifecycleReceipt: ({ repo, rootRunId, receipt }) => (
      inspectLifecycleReceipt({ repo, rootRunId, receipt })
    ),
    resolveCampaignBinding,
    resolveRef: ({ repo, ref }) => git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]),
    isAncestor: ({ repo, ancestor, descendant }) => {
      const result = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', ancestor, descendant], {
        encoding: 'utf8',
        timeout: 30000,
      });
      if (result.status === 0) return true;
      if (result.status === 1) return false;
      return null;
    },
    treeForCommit: ({ repo, commit }) => git(repo, ['rev-parse', '--verify', `${commit}^{tree}`]),
    inspectMergeProvenance: ({ repo, rootRunId, workOrderId, baseSha, headSha }) => (
      validateDispatchMergeProvenance({
        repoRoot: repo,
        rootRunId,
        workOrderId,
        baseSha,
        headSha,
        productPathPrefixes: MERGE_PRODUCT_PATH_PREFIXES,
      })
    ),
  };
}

function taskArtifactPath(rootRunId, env = process.env) {
  if (!/^[A-Za-z0-9._-]+$/u.test(rootRunId)) {
    const error = new Error('root_run_id contains unsafe characters');
    error.code = 'TASK_STATUS_ROOT_RUN_ID';
    throw error;
  }
  const directory = env.AUTOPILOT_TASK_STATUS_DIR
    || path.join(env.TMPDIR || '/tmp', 'autopilot-task-status');
  return path.join(path.resolve(directory), `${rootRunId}.json`);
}

function collectTaskStatus(rootRunId, {
  cwd = process.cwd(),
  env = process.env,
  now = () => new Date(),
} = {}) {
  const artifactPath = taskArtifactPath(rootRunId, env);
  let input;
  try {
    input = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    const wrapped = new Error(`task input unavailable: ${artifactPath}: ${error.message}`);
    wrapped.code = 'TASK_STATUS_INPUT_UNAVAILABLE';
    throw wrapped;
  }
  if (!input || input.root_run_id !== rootRunId) {
    const error = new Error('task input root_run_id does not match caller');
    error.code = 'TASK_STATUS_ROOT_RUN_ID_MISMATCH';
    throw error;
  }
  const observed = now().toISOString();
  return buildTaskStatus({
    ...input,
    repo: path.resolve(cwd, input.repo),
    observed_at: observed,
  }, runtimeAdapters());
}

module.exports = {
  MERGE_PRODUCT_PATH_PREFIXES,
  collectTaskStatus,
  repoIdentity,
  resolveCampaignBinding,
  runtimeAdapters,
  taskArtifactPath,
};
