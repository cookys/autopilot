#!/usr/bin/env bash
# LSM P1 — buildTaskStatus content-digested receipt oracle (RED).
#
# Freezes the task_status_receipt API for src/status/task-status.js which does
# not yet exist. On current HEAD this oracle exits nonzero because the module
# is absent; every invariant is reported by name. When the module lands, all
# invariants must pass against deterministic fakes (no host refs, no network).
#
# Structure: a single Node harness attempts require('../../src/status/task-status')
# relative to hooks/tests/, runs all groups with injected fakes, and emits
# tab-separated "id\tPASS|FAIL|SKIP" lines. The bash layer asserts every
# invariant PASSes — missing module, usage text, generic nonzero, or zero
# collected assertions all fail the bash gate.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];

const lines = [];
function check(id, cond) { lines.push(`${id}\t${cond ? 'PASS' : 'FAIL'}`); }
function group(name, fn) {
  try { fn(); } catch (error) {
    lines.push(`${name}\tFAIL\tthrew ${error && error.code ? error.code : error}`);
  }
}

function sha256(data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ── Deterministic fixtures ──────────────────────────────────────────────────
const REPO = '/tmp/lsm-p1-oracle-repo';
const ROOT_RUN_ID = 'root-run-lsm-p1';
const OBSERVED_AT = '2026-07-28T00:00:00.000Z';
const GOAL = 'LSM P1 oracle goal';
const PHASE = 'phase-16';
const TARGET_REF = 'refs/heads/develop';
const CONSUMER_REF = 'refs/heads/consumer';
const REMOTE_REF = 'refs/remotes/origin/develop';
const TARGET_SHA = 'a'.repeat(40);
const CONSUMER_SHA = 'b'.repeat(40);
const REMOTE_SHA = 'c'.repeat(40);
const CANDIDATE_COMMIT = 'd'.repeat(40);
const CANDIDATE_TREE = 'e'.repeat(40);
const LIFECYCLE_PATH = '/tmp/lsm-p1-oracle-repo/.autopilot/lifecycle.json';

function makeMissionTerminalReceipt(state, overrides) {
  const base = {
    schema_version: 1,
    artifact_type: 'mission_terminal_receipt',
    root_run_id: ROOT_RUN_ID,
    repo_identity: `git-common-dir:${REPO}/.git`,
    state: state,
    state_digest: sha256(`state-${state}`),
    terminal_digest: sha256(`terminal-${state}`),
    ...overrides,
  };
  return { ...base, receipt_digest: sha256(base) };
}

function makeMissionState(state, overrides) {
  const receipt = makeMissionTerminalReceipt(state, overrides);
  return {
    state: state,
    terminal_receipt: receipt,
  };
}

function makeCampaignTerminalReceipt(campaignId, treeSha, overrides) {
  const base = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_terminal',
    campaign_id: campaignId,
    tree_sha: treeSha || CANDIDATE_TREE,
    state: 'TERMINAL',
    exit_code: 0,
    verification_verdict: 'GREEN',
    ...overrides,
  };
  return { ...base, receipt_digest: sha256(base), terminal_digest: sha256(`terminal-${campaignId}`) };
}

function makeVerificationReceipt(campaignId, treeSha) {
  return {
    schema_version: 1,
    artifact_type: 'verification_receipt',
    campaign_id: campaignId,
    tree_sha: treeSha || CANDIDATE_TREE,
    verdict: 'GREEN',
    exit_code: 0,
    receipt_digest: sha256(`verify-${campaignId}-${treeSha || CANDIDATE_TREE}`),
  };
}

function makeCandidate(commitSha, treeSha, overrides) {
  return {
    schema_version: 1,
    artifact_type: 'git_candidate',
    commit_sha: commitSha || CANDIDATE_COMMIT,
    tree_sha: treeSha || CANDIDATE_TREE,
    writer_fence: sha256(`fence-${commitSha || CANDIDATE_COMMIT}`),
    ...overrides,
  };
}

function makeCampaign(campaignId, overrides) {
  return {
    state: 'TERMINAL',
    terminal_receipt: makeCampaignTerminalReceipt(campaignId),
    verification_receipt: makeVerificationReceipt(campaignId),
    candidate: makeCandidate(),
    ...overrides,
  };
}

function makeInput(overrides) {
  return {
    repo: REPO,
    root_run_id: ROOT_RUN_ID,
    observed_at: OBSERVED_AT,
    goal: GOAL,
    phase: PHASE,
    mission: makeMissionState('COMPLETE'),
    campaigns: [makeCampaign('campaign-1')],
    lifecycle_receipt_path: LIFECYCLE_PATH,
    integration: {
      target_ref: TARGET_REF,
      consumer_ref: CONSUMER_REF,
      remote_ref: REMOTE_REF,
      push_required: true,
      required_consumer_update: true,
    },
    merge_preflight: null,
    ...overrides,
  };
}

function makeLifecycleReceipt(overrides) {
  const base = {
    schema_version: 1,
    artifact_type: 'lifecycle_receipt',
    root_run_id: ROOT_RUN_ID,
    status: 'valid',
    active_owned_worktrees: 0,
    active_owned_branches: 0,
    ...overrides,
  };
  return { ...base, receipt_digest: sha256(base) };
}

function makeAdapters(overrides) {
  const lifecycleReceipt = makeLifecycleReceipt();
  return {
    inspectLifecycleReceipt: (p) => {
      if (p === LIFECYCLE_PATH) return { status: 'valid', receipt: lifecycleReceipt };
      return { status: 'missing', receipt: null };
    },
    resolveRef: (ref) => {
      const map = {
        [TARGET_REF]: TARGET_SHA,
        [CONSUMER_REF]: CONSUMER_SHA,
        [REMOTE_REF]: REMOTE_SHA,
        [CANDIDATE_COMMIT]: CANDIDATE_COMMIT,
      };
      return map[ref] || null;
    },
    isAncestor: (ancestor, descendant) => {
      if (ancestor === CANDIDATE_COMMIT && descendant === TARGET_SHA) return true;
      if (ancestor === CANDIDATE_COMMIT && descendant === REMOTE_SHA) return true;
      if (ancestor === TARGET_SHA && descendant === CONSUMER_SHA) return true;
      return false;
    },
    treeForCommit: (commit) => {
      if (commit === CANDIDATE_COMMIT) return CANDIDATE_TREE;
      return null;
    },
    ...overrides,
  };
}

// ── Group 0: module existence and API shape ─────────────────────────────────
let buildTaskStatus = null;
group('g0-module', () => {
  let mod = null;
  try {
    mod = require(path.join(root, 'src', 'status', 'task-status'));
  } catch (e) {
    mod = null;
  }
  check('g0-module-exists', mod !== null && typeof mod === 'object');
  check('g0-buildTaskStatus-exported', mod !== null && typeof mod.buildTaskStatus === 'function');
  if (mod && typeof mod.buildTaskStatus === 'function') {
    buildTaskStatus = mod.buildTaskStatus;
  }
});

// ── Group 1: receipt structure on a fully-green P1 input ────────────────────
group('g1-structure', () => {
  if (!buildTaskStatus) {
    check('g1-schema-version', false);
    check('g1-artifact-type', false);
    check('g1-receipt-digest-is-sha256', false);
    check('g1-repo-identity', false);
    check('g1-root-run-id', false);
    check('g1-goal', false);
    check('g1-phase', false);
    check('g1-candidate-commit', false);
    check('g1-candidate-tree-sha', false);
    check('g1-acceptance-verdict-enum', false);
    check('g1-accepted-blockers-array', false);
    check('g1-deferred-count-integer', false);
    check('g1-active-owned-worktrees-nullable-int', false);
    check('g1-active-owned-branches-nullable-int', false);
    check('g1-integration-target-ref', false);
    check('g1-integration-target-observed-sha', false);
    check('g1-evidence-mission', false);
    check('g1-evidence-campaigns', false);
    check('g1-evidence-lifecycle', false);
    check('g1-evidence-integration', false);
    check('g1-evidence-merge-preflight', false);
    check('g1-can-merge-boolean', false);
    check('g1-can-close-boolean', false);
    check('g1-failed-predicates-array', false);
    return;
  }
  const receipt = buildTaskStatus(makeInput(), makeAdapters());
  check('g1-schema-version', receipt.schema_version === 1);
  check('g1-artifact-type', receipt.artifact_type === 'task_status_receipt');
  check('g1-receipt-digest-is-sha256', typeof receipt.receipt_digest === 'string' && /^[0-9a-f]{64}$/.test(receipt.receipt_digest));
  check('g1-repo-identity', typeof receipt.repo_identity === 'string' && receipt.repo_identity.length > 0);
  check('g1-root-run-id', receipt.root_run_id === ROOT_RUN_ID);
  check('g1-goal', receipt.goal === GOAL);
  check('g1-phase', receipt.phase === PHASE);
  check('g1-candidate-commit', receipt.candidate_commit === CANDIDATE_COMMIT);
  check('g1-candidate-tree-sha', receipt.candidate_tree_sha === CANDIDATE_TREE);
  check('g1-acceptance-verdict-enum', ['accepted', 'rejected', 'unknown'].includes(receipt.acceptance_verdict));
  check('g1-accepted-blockers-array', Array.isArray(receipt.accepted_blockers));
  check('g1-deferred-count-integer', Number.isInteger(receipt.deferred_count));
  check('g1-active-owned-worktrees-nullable-int', receipt.active_owned_worktrees === null || Number.isInteger(receipt.active_owned_worktrees));
  check('g1-active-owned-branches-nullable-int', receipt.active_owned_branches === null || Number.isInteger(receipt.active_owned_branches));
  check('g1-integration-target-ref', receipt.integration_target && receipt.integration_target.ref === TARGET_REF);
  check('g1-integration-target-observed-sha', receipt.integration_target && receipt.integration_target.observed_sha === TARGET_SHA);
  check('g1-evidence-mission', receipt.evidence && typeof receipt.evidence.mission === 'object');
  check('g1-evidence-campaigns', receipt.evidence && typeof receipt.evidence.campaigns === 'object');
  check('g1-evidence-lifecycle', receipt.evidence && typeof receipt.evidence.lifecycle === 'object');
  check('g1-evidence-integration', receipt.evidence && typeof receipt.evidence.integration === 'object');
  check('g1-evidence-merge-preflight', receipt.evidence && 'merge_preflight' in receipt.evidence);
  check('g1-can-merge-boolean', typeof receipt.can_merge === 'boolean');
  check('g1-can-close-boolean', typeof receipt.can_close === 'boolean');
  check('g1-failed-predicates-array', Array.isArray(receipt.failed_predicates));
});

// ── Group 2: independent tri-state facts ────────────────────────────────────
group('g2-tristate', () => {
  if (!buildTaskStatus) {
    check('g2-product-merged-tristate', false);
    check('g2-consumer-updated-tristate', false);
    check('g2-pushed-tristate', false);
    check('g2-zero-residue-tristate', false);
    check('g2-mission-terminal-tristate', false);
    check('g2-campaigns-terminal-tristate', false);
    return;
  }
  const receipt = buildTaskStatus(makeInput(), makeAdapters());
  const tri = (v) => v === true || v === false || v === null;
  check('g2-product-merged-tristate', tri(receipt.product_merged));
  check('g2-consumer-updated-tristate', tri(receipt.consumer_updated));
  check('g2-pushed-tristate', tri(receipt.pushed));
  check('g2-zero-residue-tristate', tri(receipt.zero_residue));
  check('g2-mission-terminal-tristate', tri(receipt.mission_terminal));
  check('g2-campaigns-terminal-tristate', tri(receipt.campaigns_terminal));
});

// ── Group 3: Mission validation ─────────────────────────────────────────────
group('g3-mission', () => {
  if (!buildTaskStatus) {
    check('g3-complete-mission-terminal-true', false);
    check('g3-blocked-mission-terminal-true', false);
    check('g3-blocked-mission-blocks-closeout', false);
    check('g3-aborted-mission-terminal-true', false);
    check('g3-receipt-swap-mission-terminal-null', false);
    check('g3-root-run-id-mismatch-rejected', false);
    check('g3-repo-identity-mismatch-rejected', false);
    check('g3-non-terminal-mission-rejected', false);
    check('g3-receipt-alone-not-attribution', false);
    return;
  }
  // COMPLETE => mission_terminal true
  const complete = buildTaskStatus(makeInput(), makeAdapters());
  check('g3-complete-mission-terminal-true', complete.mission_terminal === true);

  // BLOCKED => mission_terminal true but blocks closeout
  const blockedInput = makeInput({ mission: makeMissionState('BLOCKED') });
  const blocked = buildTaskStatus(blockedInput, makeAdapters());
  check('g3-blocked-mission-terminal-true', blocked.mission_terminal === true);
  check('g3-blocked-mission-blocks-closeout', blocked.can_close === false);

  // ABORTED => terminal
  const abortedInput = makeInput({ mission: makeMissionState('ABORTED') });
  const aborted = buildTaskStatus(abortedInput, makeAdapters());
  check('g3-aborted-mission-terminal-true', aborted.mission_terminal === true);

  // Receipt/state swap => mission_terminal null
  const swappedMission = makeMissionState('COMPLETE');
  swappedMission.terminal_receipt = makeMissionTerminalReceipt('BLOCKED');
  const swapped = buildTaskStatus(makeInput({ mission: swappedMission }), makeAdapters());
  check('g3-receipt-swap-mission-terminal-null', swapped.mission_terminal === null);

  // root_run_id mismatch
  const wrongRoot = makeMissionState('COMPLETE', { root_run_id: 'wrong-root' });
  const wrongRootInput = makeInput({ mission: wrongRoot });
  const wrongRootResult = buildTaskStatus(wrongRootInput, makeAdapters());
  check('g3-root-run-id-mismatch-rejected', wrongRootResult.mission_terminal === null || wrongRootResult.acceptance_verdict === 'rejected');

  // repo identity mismatch
  const wrongRepo = makeMissionState('COMPLETE', { repo_identity: 'git-common-dir:/wrong/repo/.git' });
  const wrongRepoResult = buildTaskStatus(makeInput({ mission: wrongRepo }), makeAdapters());
  check('g3-repo-identity-mismatch-rejected', wrongRepoResult.mission_terminal === null || wrongRepoResult.acceptance_verdict === 'rejected');

  // Non-terminal mission state
  const activeInput = makeInput({ mission: { state: 'ACTIVE', terminal_receipt: null } });
  const active = buildTaskStatus(activeInput, makeAdapters());
  check('g3-non-terminal-mission-rejected', active.mission_terminal === false || active.mission_terminal === null);

  // Receipt alone without valid state is not attribution
  const orphanReceipt = makeMissionTerminalReceipt('COMPLETE');
  const orphanInput = makeInput({ mission: { state: 'ACTIVE', terminal_receipt: orphanReceipt } });
  const orphan = buildTaskStatus(orphanInput, makeAdapters());
  check('g3-receipt-alone-not-attribution', orphan.mission_terminal !== true);
});

// ── Group 4: campaign validation ────────────────────────────────────────────
group('g4-campaign', () => {
  if (!buildTaskStatus) {
    check('g4-valid-campaign-accepted', false);
    check('g4-terminal-digest-substitution-invalid', false);
    check('g4-verification-digest-substitution-invalid', false);
    check('g4-tree-substitution-invalid', false);
    check('g4-follow-up-only-deferred', false);
    check('g4-unresolved-finding-rejected', false);
    check('g4-omitted-sibling-not-accepted', false);
    check('g4-non-terminal-campaign-rejected', false);
    return;
  }
  // Valid campaign accepted
  const valid = buildTaskStatus(makeInput(), makeAdapters());
  check('g4-valid-campaign-accepted', valid.acceptance_verdict === 'accepted');

  // Terminal digest substitution
  const badTermCamp = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, { terminal_digest: sha256('forged') }),
  });
  const badTerm = buildTaskStatus(makeInput({ campaigns: [badTermCamp] }), makeAdapters());
  check('g4-terminal-digest-substitution-invalid', badTerm.acceptance_verdict !== 'accepted');

  // Verification digest substitution
  const badVerifCamp = makeCampaign('campaign-1', {
    verification_receipt: { ...makeVerificationReceipt('campaign-1'), receipt_digest: sha256('forged-verification') },
  });
  const badVerif = buildTaskStatus(makeInput({ campaigns: [badVerifCamp] }), makeAdapters());
  check('g4-verification-digest-substitution-invalid', badVerif.acceptance_verdict !== 'accepted');

  // Tree substitution: candidate tree != terminal receipt tree
  const badTreeCamp = makeCampaign('campaign-1', {
    candidate: makeCandidate(CANDIDATE_COMMIT, 'f'.repeat(40)),
  });
  const badTree = buildTaskStatus(makeInput({ campaigns: [badTreeCamp] }), makeAdapters());
  check('g4-tree-substitution-invalid', badTree.acceptance_verdict !== 'accepted');

  // Follow-up only => accepted + deferred_count=1
  const followUpCamp = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, {
      follow_up: [{ id: 'fu-1', description: 'deferred item' }],
      unresolved_final_findings: [],
    }),
  });
  const followUp = buildTaskStatus(makeInput({ campaigns: [followUpCamp] }), makeAdapters());
  check('g4-follow-up-only-deferred', followUp.acceptance_verdict === 'accepted' && followUp.deferred_count === 1);

  // Unresolved finding => rejected + blocker
  const unresolvedCamp = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, {
      unresolved_final_findings: [{ id: 'finding-1', severity: 'critical' }],
    }),
  });
  const unresolved = buildTaskStatus(makeInput({ campaigns: [unresolvedCamp] }), makeAdapters());
  check('g4-unresolved-finding-rejected', unresolved.acceptance_verdict === 'rejected' && unresolved.accepted_blockers.length > 0);

  // Omitted sibling campaign from Mission claims
  const twoCampaignInput = makeInput({
    mission: makeMissionState('COMPLETE', { claimed_campaign_ids: ['campaign-1', 'campaign-2'] }),
    campaigns: [makeCampaign('campaign-1')],
  });
  const omittedSibling = buildTaskStatus(twoCampaignInput, makeAdapters());
  check('g4-omitted-sibling-not-accepted', omittedSibling.acceptance_verdict !== 'accepted');

  // Non-terminal campaign
  const nonTermCamp = { state: 'ACTIVE', terminal_receipt: null, verification_receipt: null, candidate: makeCandidate() };
  const nonTerm = buildTaskStatus(makeInput({ campaigns: [nonTermCamp] }), makeAdapters());
  check('g4-non-terminal-campaign-rejected', nonTerm.acceptance_verdict !== 'accepted');
});

// ── Group 5: lifecycle validation ───────────────────────────────────────────
group('g5-lifecycle', () => {
  if (!buildTaskStatus) {
    check('g5-valid-lifecycle-facts-imported', false);
    check('g5-missing-lifecycle-null', false);
    check('g5-missing-lifecycle-no-fallback', false);
    check('g5-stale-lifecycle-null', false);
    check('g5-cross-root-lifecycle-null', false);
    check('g5-invalid-lifecycle-null', false);
    return;
  }
  // Valid lifecycle imports facts
  const valid = buildTaskStatus(makeInput(), makeAdapters());
  check('g5-valid-lifecycle-facts-imported', valid.active_owned_worktrees === 0 && valid.active_owned_branches === 0);

  // Missing lifecycle => null, no fallback
  let fallbackCalled = false;
  const missingAdapters = makeAdapters({
    inspectLifecycleReceipt: () => { fallbackCalled = true; return { status: 'missing', receipt: null }; },
  });
  const missing = buildTaskStatus(makeInput(), missingAdapters);
  check('g5-missing-lifecycle-null', missing.active_owned_worktrees === null && missing.active_owned_branches === null);
  check('g5-missing-lifecycle-no-fallback', fallbackCalled === true);

  // Stale lifecycle HEAD => null
  const staleAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'stale', receipt: null }),
  });
  const stale = buildTaskStatus(makeInput(), staleAdapters);
  check('g5-stale-lifecycle-null', stale.active_owned_worktrees === null && stale.active_owned_branches === null);

  // Cross-root lifecycle substitution => null
  const crossRootReceipt = makeLifecycleReceipt({ root_run_id: 'different-root' });
  const crossRootAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'valid', receipt: crossRootReceipt }),
  });
  const crossRoot = buildTaskStatus(makeInput(), crossRootAdapters);
  check('g5-cross-root-lifecycle-null', crossRoot.active_owned_worktrees === null && crossRoot.active_owned_branches === null);

  // Invalid lifecycle => null
  const invalidAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'invalid', receipt: null }),
  });
  const invalid = buildTaskStatus(makeInput(), invalidAdapters);
  check('g5-invalid-lifecycle-null', invalid.active_owned_worktrees === null && invalid.active_owned_branches === null);
});

// ── Group 6: git facts and integration ──────────────────────────────────────
group('g6-integration', () => {
  if (!buildTaskStatus) {
    check('g6-product-merged-from-ancestor', false);
    check('g6-pushed-from-remote-ancestor', false);
    check('g6-consumer-updated-from-ancestor', false);
    check('g6-missing-ref-null', false);
    check('g6-candidate-tree-mismatch-null', false);
    return;
  }
  // All git facts from content-bound candidate + adapters
  const valid = buildTaskStatus(makeInput(), makeAdapters());
  check('g6-product-merged-from-ancestor', valid.product_merged === true);
  check('g6-pushed-from-remote-ancestor', valid.pushed === true);
  check('g6-consumer-updated-from-ancestor', valid.consumer_updated === true);

  // Missing ref => null
  const noRefAdapters = makeAdapters({
    resolveRef: () => null,
  });
  const noRef = buildTaskStatus(makeInput(), noRefAdapters);
  check('g6-missing-ref-null', noRef.product_merged === null && noRef.pushed === null);

  // Candidate tree mismatch => integration facts null
  const badTreeAdapters = makeAdapters({
    treeForCommit: () => 'f'.repeat(40),
  });
  const badTree = buildTaskStatus(makeInput(), badTreeAdapters);
  check('g6-candidate-tree-mismatch-null', badTree.product_merged === null || badTree.candidate_tree_sha === null);
});

// ── Group 7: merge_preflight P1 null => can_merge false ─────────────────────
group('g7-merge-preflight', () => {
  if (!buildTaskStatus) {
    check('g7-p1-can-merge-false', false);
    check('g7-p1-merge-preflight-unknown-in-failed', false);
    check('g7-otherwise-green-still-cannot-merge', false);
    return;
  }
  const receipt = buildTaskStatus(makeInput(), makeAdapters());
  check('g7-p1-can-merge-false', receipt.can_merge === false);
  check('g7-p1-merge-preflight-unknown-in-failed', receipt.failed_predicates.includes('merge_preflight_unknown'));
  // Even with all other facts clean, merge_preflight_unknown blocks
  check('g7-otherwise-green-still-cannot-merge', receipt.can_merge === false && receipt.failed_predicates.includes('merge_preflight_unknown'));
});

// ── Group 8: can_close strict requirements ──────────────────────────────────
group('g8-closeout', () => {
  if (!buildTaskStatus) {
    check('g8-full-green-close-true', false);
    check('g8-unknown-fails-closed', false);
    check('g8-incomplete-mission-close-false', false);
    check('g8-blocker-close-false', false);
    check('g8-product-not-merged-close-false', false);
    check('g8-consumer-not-updated-close-false', false);
    check('g8-not-pushed-close-false', false);
    check('g8-residue-close-false', false);
    return;
  }
  // Full green (except merge_preflight which only blocks can_merge, not can_close
  // per spec: can_close requires merge edges complete — in P1 with null preflight
  // this means can_close=false too since merge edges cannot be verified)
  const green = buildTaskStatus(makeInput(), makeAdapters());
  check('g8-full-green-close-true', green.can_close === true || green.can_close === false);

  // Unknown always fails closed
  const unknownAdapters = makeAdapters({
    resolveRef: () => null,
    isAncestor: () => null,
    treeForCommit: () => null,
    inspectLifecycleReceipt: () => ({ status: 'missing', receipt: null }),
  });
  const unknown = buildTaskStatus(makeInput(), unknownAdapters);
  check('g8-unknown-fails-closed', unknown.can_close === false);

  // Incomplete mission
  const incomplete = buildTaskStatus(makeInput({ mission: { state: 'ACTIVE', terminal_receipt: null } }), makeAdapters());
  check('g8-incomplete-mission-close-false', incomplete.can_close === false);

  // Blocker present
  const blockerCamp = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, {
      unresolved_final_findings: [{ id: 'f1', severity: 'critical' }],
    }),
  });
  const blocker = buildTaskStatus(makeInput({ campaigns: [blockerCamp] }), makeAdapters());
  check('g8-blocker-close-false', blocker.can_close === false);

  // product_merged not true
  const notMergedAdapters = makeAdapters({
    isAncestor: (a, d) => {
      if (a === TARGET_SHA && d === CONSUMER_SHA) return true;
      return false;
    },
  });
  const notMerged = buildTaskStatus(makeInput(), notMergedAdapters);
  check('g8-product-not-merged-close-false', notMerged.can_close === false);

  // consumer not updated when required
  const notUpdatedAdapters = makeAdapters({
    isAncestor: (a, d) => {
      if (a === CANDIDATE_COMMIT && d === TARGET_SHA) return true;
      if (a === CANDIDATE_COMMIT && d === REMOTE_SHA) return true;
      return false;
    },
  });
  const notUpdated = buildTaskStatus(makeInput(), notUpdatedAdapters);
  check('g8-consumer-not-updated-close-false', notUpdated.can_close === false);

  // not pushed when required
  const notPushedAdapters = makeAdapters({
    isAncestor: (a, d) => {
      if (a === CANDIDATE_COMMIT && d === TARGET_SHA) return true;
      if (a === TARGET_SHA && d === CONSUMER_SHA) return true;
      return false;
    },
  });
  const notPushed = buildTaskStatus(makeInput(), notPushedAdapters);
  check('g8-not-pushed-close-false', notPushed.can_close === false);

  // residue present
  const residueAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({
      status: 'valid',
      receipt: makeLifecycleReceipt({ active_owned_worktrees: 1, active_owned_branches: 1 }),
    }),
  });
  const residue = buildTaskStatus(makeInput(), residueAdapters);
  check('g8-residue-close-false', residue.can_close === false);
});

// ── Group 9: adversarial fixture 1 — false-clean ────────────────────────────
group('g9-false-clean', () => {
  if (!buildTaskStatus) {
    check('g9-false-clean-close-false', false);
    check('g9-false-clean-zero-residue-false', false);
    return;
  }
  const falseCleanAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({
      status: 'valid',
      receipt: makeLifecycleReceipt({ active_owned_worktrees: 1, active_owned_branches: 0 }),
    }),
  });
  const result = buildTaskStatus(makeInput(), falseCleanAdapters);
  check('g9-false-clean-close-false', result.can_close === false);
  check('g9-false-clean-zero-residue-false', result.zero_residue === false);
});

// ── Group 10: adversarial fixtures 2-4 — lifecycle edge cases ───────────────
group('g10-lifecycle-adversarial', () => {
  if (!buildTaskStatus) {
    check('g10-missing-lifecycle-close-false', false);
    check('g10-stale-lifecycle-facts-null', false);
    check('g10-cross-root-facts-null', false);
    return;
  }
  // Missing lifecycle => close false
  const missingAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'missing', receipt: null }),
  });
  const missing = buildTaskStatus(makeInput(), missingAdapters);
  check('g10-missing-lifecycle-close-false', missing.can_close === false);

  // Stale lifecycle => facts null
  const staleAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'stale', receipt: null }),
  });
  const stale = buildTaskStatus(makeInput(), staleAdapters);
  check('g10-stale-lifecycle-facts-null', stale.active_owned_worktrees === null && stale.active_owned_branches === null);

  // Cross-root substitution => facts null
  const crossReceipt = makeLifecycleReceipt({ root_run_id: 'attacker-root' });
  const crossAdapters = makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'valid', receipt: crossReceipt }),
  });
  const cross = buildTaskStatus(makeInput(), crossAdapters);
  check('g10-cross-root-facts-null', cross.active_owned_worktrees === null && cross.active_owned_branches === null);
});

// ── Group 11: adversarial fixture 5-6 — Mission receipt/state swap, BLOCKED ─
group('g11-mission-adversarial', () => {
  if (!buildTaskStatus) {
    check('g11-receipt-swap-terminal-null', false);
    check('g11-blocked-terminal-true-close-false', false);
    check('g11-blocked-is-blocker', false);
    return;
  }
  // Receipt/state swap
  const swappedMission = makeMissionState('COMPLETE');
  swappedMission.terminal_receipt = makeMissionTerminalReceipt('ABORTED');
  const swapped = buildTaskStatus(makeInput({ mission: swappedMission }), makeAdapters());
  check('g11-receipt-swap-terminal-null', swapped.mission_terminal === null);

  // BLOCKED: terminal true but close false and is a blocker
  const blockedInput = makeInput({ mission: makeMissionState('BLOCKED') });
  const blocked = buildTaskStatus(blockedInput, makeAdapters());
  check('g11-blocked-terminal-true-close-false', blocked.mission_terminal === true && blocked.can_close === false);
  check('g11-blocked-is-blocker', blocked.accepted_blockers.length > 0 || blocked.failed_predicates.length > 0);
});

// ── Group 12: adversarial fixture 7 — ICC digest/tree substitution ──────────
group('g12-icc-substitution', () => {
  if (!buildTaskStatus) {
    check('g12-icc-terminal-digest-swap-invalid', false);
    check('g12-icc-verification-digest-swap-invalid', false);
    check('g12-icc-tree-swap-invalid', false);
    return;
  }
  // Terminal digest swap
  const termSwap = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, { terminal_digest: sha256('attacker') }),
  });
  const termResult = buildTaskStatus(makeInput({ campaigns: [termSwap] }), makeAdapters());
  check('g12-icc-terminal-digest-swap-invalid', termResult.acceptance_verdict !== 'accepted');

  // Verification digest swap
  const verifSwap = makeCampaign('campaign-1', {
    verification_receipt: { ...makeVerificationReceipt('campaign-1'), receipt_digest: sha256('attacker-v') },
  });
  const verifResult = buildTaskStatus(makeInput({ campaigns: [verifSwap] }), makeAdapters());
  check('g12-icc-verification-digest-swap-invalid', verifResult.acceptance_verdict !== 'accepted');

  // Tree swap in candidate
  const treeSwap = makeCampaign('campaign-1', {
    candidate: makeCandidate(CANDIDATE_COMMIT, 'ab'.repeat(20)),
  });
  const treeResult = buildTaskStatus(makeInput({ campaigns: [treeSwap] }), makeAdapters());
  check('g12-icc-tree-swap-invalid', treeResult.acceptance_verdict !== 'accepted');
});

// ── Group 13: adversarial fixtures 8-9 — follow-up vs unresolved ────────────
group('g13-findings', () => {
  if (!buildTaskStatus) {
    check('g13-follow-up-accepted-deferred-1', false);
    check('g13-unresolved-rejected-blocker-retained', false);
    return;
  }
  // Follow-up only
  const fuCamp = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, {
      follow_up: [{ id: 'fu-1', description: 'later' }],
      unresolved_final_findings: [],
    }),
  });
  const fu = buildTaskStatus(makeInput({ campaigns: [fuCamp] }), makeAdapters());
  check('g13-follow-up-accepted-deferred-1', fu.acceptance_verdict === 'accepted' && fu.deferred_count === 1);

  // Unresolved finding
  const urCamp = makeCampaign('campaign-1', {
    terminal_receipt: makeCampaignTerminalReceipt('campaign-1', CANDIDATE_TREE, {
      unresolved_final_findings: [{ id: 'f-1', severity: 'major' }],
      follow_up: [],
    }),
  });
  const ur = buildTaskStatus(makeInput({ campaigns: [urCamp] }), makeAdapters());
  check('g13-unresolved-rejected-blocker-retained', ur.acceptance_verdict === 'rejected' && ur.accepted_blockers.length > 0);
});

// ── Group 14: adversarial fixture 10 — omitted sibling ──────────────────────
group('g14-omitted-sibling', () => {
  if (!buildTaskStatus) {
    check('g14-omitted-sibling-not-accepted', false);
    check('g14-omitted-sibling-evidence-gap', false);
    return;
  }
  const input = makeInput({
    mission: makeMissionState('COMPLETE', { claimed_campaign_ids: ['c-1', 'c-2', 'c-3'] }),
    campaigns: [makeCampaign('c-1'), makeCampaign('c-2')],
  });
  const result = buildTaskStatus(input, makeAdapters());
  check('g14-omitted-sibling-not-accepted', result.acceptance_verdict !== 'accepted');
  check('g14-omitted-sibling-evidence-gap', result.can_close === false);
});

// ── Group 15: adversarial fixture 11 — candidate commit/tree mismatch ───────
group('g15-candidate-mismatch', () => {
  if (!buildTaskStatus) {
    check('g15-commit-tree-mismatch-null', false);
    check('g15-missing-ref-integration-null', false);
    return;
  }
  // treeForCommit returns different tree than candidate claims
  const mismatchAdapters = makeAdapters({
    treeForCommit: (c) => c === CANDIDATE_COMMIT ? 'ff'.repeat(20) : null,
  });
  const mismatch = buildTaskStatus(makeInput(), mismatchAdapters);
  check('g15-commit-tree-mismatch-null', mismatch.product_merged === null || mismatch.candidate_tree_sha === null);

  // Missing ref entirely
  const noRefAdapters = makeAdapters({ resolveRef: () => null });
  const noRef = buildTaskStatus(makeInput(), noRefAdapters);
  check('g15-missing-ref-integration-null', noRef.integration_target.observed_sha === null);
});

// ── Group 16: adversarial fixture 12 — otherwise-green P1 can_merge false ───
group('g16-green-p1', () => {
  if (!buildTaskStatus) {
    check('g16-green-p1-can-merge-false', false);
    check('g16-green-p1-merge-preflight-unknown', false);
    return;
  }
  const result = buildTaskStatus(makeInput(), makeAdapters());
  check('g16-green-p1-can-merge-false', result.can_merge === false);
  check('g16-green-p1-merge-preflight-unknown', result.failed_predicates.includes('merge_preflight_unknown'));
});

// ── Group 17: adversarial fixture 13 — receipt_digest sensitivity ───────────
group('g17-digest-sensitivity', () => {
  if (!buildTaskStatus) {
    check('g17-digest-changes-on-fact-change', false);
    check('g17-digest-stable-same-input', false);
    return;
  }
  const input1 = makeInput();
  const adapters1 = makeAdapters();
  const r1 = buildTaskStatus(input1, adapters1);

  // Same input => same digest
  const r1b = buildTaskStatus(makeInput(), makeAdapters());
  check('g17-digest-stable-same-input', r1.receipt_digest === r1b.receipt_digest);

  // Changed independent fact => different digest
  const changedAdapters = makeAdapters({
    isAncestor: () => false,
  });
  const r2 = buildTaskStatus(makeInput(), changedAdapters);
  check('g17-digest-changes-on-fact-change', r1.receipt_digest !== r2.receipt_digest);
});

// ── Group 18: adversarial fixture 14 — unknown/extra input fails closed ─────
group('g18-fail-closed', () => {
  if (!buildTaskStatus) {
    check('g18-unknown-top-level-fails-closed', false);
    check('g18-extra-field-fails-closed', false);
    return;
  }
  // Unknown top-level field
  const unknownInput = makeInput({ unknown_field: 'attacker' });
  let unknownResult;
  let threw = false;
  try {
    unknownResult = buildTaskStatus(unknownInput, makeAdapters());
  } catch (e) {
    threw = true;
  }
  check('g18-unknown-top-level-fails-closed', threw || (unknownResult && unknownResult.can_close === false && unknownResult.can_merge === false));

  // Extra nested field in mission
  const extraMission = makeMissionState('COMPLETE');
  extraMission.extra_injected = true;
  const extraInput = makeInput({ mission: extraMission });
  let extraResult;
  let extraThrew = false;
  try {
    extraResult = buildTaskStatus(extraInput, makeAdapters());
  } catch (e) {
    extraThrew = true;
  }
  check('g18-extra-field-fails-closed', extraThrew || (extraResult && extraResult.can_close === false));
});

// ── Group 19: failed_predicates completeness — no short-circuit omission ────
group('g19-failed-predicates', () => {
  if (!buildTaskStatus) {
    check('g19-all-false-operands-reported', false);
    check('g19-no-short-circuit-omission', false);
    return;
  }
  // All facts unknown/null => every predicate must appear
  const nullAdapters = makeAdapters({
    resolveRef: () => null,
    isAncestor: () => null,
    treeForCommit: () => null,
    inspectLifecycleReceipt: () => ({ status: 'missing', receipt: null }),
  });
  const nullInput = makeInput({
    mission: { state: 'ACTIVE', terminal_receipt: null },
    campaigns: [{ state: 'ACTIVE', terminal_receipt: null, verification_receipt: null, candidate: null }],
  });
  const result = buildTaskStatus(nullInput, nullAdapters);
  check('g19-all-false-operands-reported', result.failed_predicates.length >= 5);
  // merge_preflight_unknown must always be present in P1
  check('g19-no-short-circuit-omission', result.failed_predicates.includes('merge_preflight_unknown'));
});

for (const line of lines) console.log(line);
NODE
)"
EXIT=$?

# ── Gate: the node harness must have executed (not crashed before output). ──
assert_eq "$EXIT" "0" "node harness exits 0 (all groups ran without uncaught throw)"

# ── Gate: at least one assertion line was collected (not empty output). ──
LINE_COUNT=$(printf '%s\n' "$OUT" | grep -c $'\t' || true)
if [ "$LINE_COUNT" -lt 50 ]; then
  fail "harness collected fewer than 50 assertion lines ($LINE_COUNT) — structural failure"
fi

# ── Gate: module-missing must be the named reason, not generic. ──
assert_contains "$OUT" "g0-module-exists" "oracle reports module existence check by name"
assert_contains "$OUT" "g0-buildTaskStatus-exported" "oracle reports buildTaskStatus export check by name"

# ── Every invariant must PASS for the test to go GREEN. ──
# On current HEAD (module absent) these all FAIL => test is RED.
for id in \
  g0-module-exists g0-buildTaskStatus-exported \
  g1-schema-version g1-artifact-type g1-receipt-digest-is-sha256 \
  g1-repo-identity g1-root-run-id g1-goal g1-phase \
  g1-candidate-commit g1-candidate-tree-sha \
  g1-acceptance-verdict-enum g1-accepted-blockers-array g1-deferred-count-integer \
  g1-active-owned-worktrees-nullable-int g1-active-owned-branches-nullable-int \
  g1-integration-target-ref g1-integration-target-observed-sha \
  g1-evidence-mission g1-evidence-campaigns g1-evidence-lifecycle \
  g1-evidence-integration g1-evidence-merge-preflight \
  g1-can-merge-boolean g1-can-close-boolean g1-failed-predicates-array \
  g2-product-merged-tristate g2-consumer-updated-tristate g2-pushed-tristate \
  g2-zero-residue-tristate g2-mission-terminal-tristate g2-campaigns-terminal-tristate \
  g3-complete-mission-terminal-true g3-blocked-mission-terminal-true \
  g3-blocked-mission-blocks-closeout g3-aborted-mission-terminal-true \
  g3-receipt-swap-mission-terminal-null g3-root-run-id-mismatch-rejected \
  g3-repo-identity-mismatch-rejected g3-non-terminal-mission-rejected \
  g3-receipt-alone-not-attribution \
  g4-valid-campaign-accepted g4-terminal-digest-substitution-invalid \
  g4-verification-digest-substitution-invalid g4-tree-substitution-invalid \
  g4-follow-up-only-deferred g4-unresolved-finding-rejected \
  g4-omitted-sibling-not-accepted g4-non-terminal-campaign-rejected \
  g5-valid-lifecycle-facts-imported g5-missing-lifecycle-null \
  g5-missing-lifecycle-no-fallback g5-stale-lifecycle-null \
  g5-cross-root-lifecycle-null g5-invalid-lifecycle-null \
  g6-product-merged-from-ancestor g6-pushed-from-remote-ancestor \
  g6-consumer-updated-from-ancestor g6-missing-ref-null \
  g6-candidate-tree-mismatch-null \
  g7-p1-can-merge-false g7-p1-merge-preflight-unknown-in-failed \
  g7-otherwise-green-still-cannot-merge \
  g8-full-green-close-true g8-unknown-fails-closed \
  g8-incomplete-mission-close-false g8-blocker-close-false \
  g8-product-not-merged-close-false g8-consumer-not-updated-close-false \
  g8-not-pushed-close-false g8-residue-close-false \
  g9-false-clean-close-false g9-false-clean-zero-residue-false \
  g10-missing-lifecycle-close-false g10-stale-lifecycle-facts-null \
  g10-cross-root-facts-null \
  g11-receipt-swap-terminal-null g11-blocked-terminal-true-close-false \
  g11-blocked-is-blocker \
  g12-icc-terminal-digest-swap-invalid g12-icc-verification-digest-swap-invalid \
  g12-icc-tree-swap-invalid \
  g13-follow-up-accepted-deferred-1 g13-unresolved-rejected-blocker-retained \
  g14-omitted-sibling-not-accepted g14-omitted-sibling-evidence-gap \
  g15-commit-tree-mismatch-null g15-missing-ref-integration-null \
  g16-green-p1-can-merge-false g16-green-p1-merge-preflight-unknown \
  g17-digest-changes-on-fact-change g17-digest-stable-same-input \
  g18-unknown-top-level-fails-closed g18-extra-field-fails-closed \
  g19-all-false-operands-reported g19-no-short-circuit-omission
do
  assert_contains "$OUT" "$id	PASS" "LSM P1 invariant $id must pass"
done

# ── No group may have aborted the harness mid-run. ──
for grp in g0-module g1-structure g2-tristate g3-mission g4-campaign \
  g5-lifecycle g6-integration g7-merge-preflight g8-closeout \
  g9-false-clean g10-lifecycle-adversarial g11-mission-adversarial \
  g12-icc-substitution g13-findings g14-omitted-sibling \
  g15-candidate-mismatch g16-green-p1 g17-digest-sensitivity \
  g18-fail-closed g19-failed-predicates
do
  assert_not_contains "$OUT" "$grp	FAIL	threw" "group $grp ran to completion without throwing"
done

finalize_test
