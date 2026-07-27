#!/usr/bin/env bash
# LSM P2 — ordered, sealed merge intent and read-only dirty-aware preflight.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
git init -q -b peo "$SBX"
git -C "$SBX" config user.name "LSM P2 Fixture"
git -C "$SBX" config user.email "lsm-p2@example.invalid"
mkdir -p "$SBX/consumer"
printf 'base\n' >"$SBX/shared.txt"
printf 'clean\n' >"$SBX/consumer/script.sh"
printf 'clean local\n' >"$SBX/consumer/local.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm base

git -C "$SBX" branch develop
git -C "$SBX" branch safety
SAFETY_WT="$TEST_TMP/safety"
DEVELOP_WT="$TEST_TMP/develop"
git -C "$SBX" worktree add -q "$SAFETY_WT" safety
git -C "$SBX" worktree add -q "$DEVELOP_WT" develop

printf 'safety\n' >"$SAFETY_WT/safety.txt"
git -C "$SAFETY_WT" add safety.txt
git -C "$SAFETY_WT" commit -qm safety
printf 'develop\n' >"$DEVELOP_WT/develop.txt"
git -C "$DEVELOP_WT" add develop.txt
git -C "$DEVELOP_WT" commit -qm develop
printf 'staged consumer\n' >"$SBX/consumer/script.sh"
git -C "$SBX" add consumer/script.sh
printf 'unstaged consumer\n' >"$SBX/consumer/local.txt"
printf 'untracked consumer\n' >"$SBX/consumer/new.txt"

BEFORE="$TEST_TMP/before"
AFTER="$TEST_TMP/after"
snapshot() {
  local output="$1"
  {
    git -C "$SBX" show-ref
    git -C "$SBX" status --porcelain=v1 --untracked-files=all
    git -C "$SBX" stash list
    git -C "$DEVELOP_WT" status --porcelain=v1 --untracked-files=all
    git -C "$SAFETY_WT" status --porcelain=v1 --untracked-files=all
  } >"$output"
}
snapshot "$BEFORE"

OUT="$(node - "$REPO_ROOT" "$SBX" "$SAFETY_WT" "$DEVELOP_WT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const safetyWorktree = process.argv[4];
const developWorktree = process.argv[5];
const {
  MergeIntentError,
  buildMergeIntent,
  preflightMergeIntent,
  verifyMergeIntentSeal,
} = require(path.join(root, 'src/status/merge-intent'));

const results = [];
function check(id, condition, detail = '') {
  results.push({ id, pass: condition === true, detail });
}
function reject(id, fn, expectedCode) {
  try {
    fn();
    check(id, false, 'accepted');
  } catch (error) {
    check(id, error instanceof MergeIntentError && error.code === expectedCode,
      `${error.code || error.name}: ${error.message}`);
  }
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const input = {
  repo,
  root_run_id: 'lsm-p2-twgame',
  edges: [
    {
      source_ref: 'refs/heads/safety',
      source_worktree: safetyWorktree,
      target_ref: 'refs/heads/develop',
      target_worktree: developWorktree,
      mode: 'no-ff',
      required_result: 'source-contained',
    },
    {
      source_ref: 'refs/heads/develop',
      source_worktree: developWorktree,
      target_ref: 'refs/heads/peo',
      target_worktree: repo,
      mode: 'ff-only',
      required_result: 'source-contained',
    },
  ],
  forbidden_reverse_edges: [
    { source_ref: 'refs/heads/develop', target_ref: 'refs/heads/safety' },
    { source_ref: 'refs/heads/peo', target_ref: 'refs/heads/develop' },
  ],
  preservation_policy: {
    allowed_path_prefixes: ['consumer/'],
  },
};

const first = buildMergeIntent(input);
const second = buildMergeIntent(clone(input));
const reorderedPolicy = buildMergeIntent({
  ...clone(input),
  forbidden_reverse_edges: [...input.forbidden_reverse_edges].reverse(),
});
check('ordered_edges', first.manifest.edges.length === 2
  && first.manifest.edges[0].source_ref === 'refs/heads/safety'
  && first.manifest.edges[1].target_ref === 'refs/heads/peo');
check('pinned_shas', first.manifest.edges.every((edge) =>
  /^[0-9a-f]{40}$/.test(edge.source_sha) && /^[0-9a-f]{40}$/.test(edge.target_sha)));
check('deterministic_seal', first.seal === second.seal
  && first.seal === reorderedPolicy.seal
  && verifyMergeIntentSeal(first));
check('forbidden_reverse_explicit', first.manifest.forbidden_reverse_edges.some((edge) =>
  edge.source_ref === 'refs/heads/peo' && edge.target_ref === 'refs/heads/develop'));

const safe = preflightMergeIntent(first);
const peoEdge = safe.edges[1];
check('predecessor_result_binding',
  first.manifest.edges[0].source_from_edge === null
  && first.manifest.edges[0].target_from_edge === null
  && first.manifest.edges[1].source_from_edge === 1
  && first.manifest.edges[1].target_from_edge === null
  && peoEdge.source_from_edge === 1);
check('safe_status', safe.status === 'safe' && safe.can_merge === true, JSON.stringify(safe));
check('dirty_inventory', peoEdge.dirty.staged.includes('consumer/script.sh')
  && peoEdge.dirty.unstaged.includes('consumer/local.txt')
  && peoEdge.dirty.untracked.includes('consumer/new.txt'), JSON.stringify(peoEdge.dirty));
check('incoming_paths', peoEdge.incoming_paths.includes('develop.txt'));
check('safe_has_no_proposal', peoEdge.preservation_proposal.length === 0);

const overlapAdapters = {
  incomingPaths: ({ edge }) => edge.target_ref === 'refs/heads/peo'
    ? { paths: ['consumer/script.sh'], ambiguous: false }
    : { paths: ['safety.txt'], ambiguous: false },
};
const overlapping = preflightMergeIntent(first, overlapAdapters);
const overlapEdge = overlapping.edges[1];
check('overlapping_status', overlapping.status === 'overlapping' && overlapping.can_merge === false);
check('path_scoped_proposal', overlapEdge.preservation_proposal.length === 1
  && overlapEdge.preservation_proposal[0] === 'consumer/script.sh');

const ambiguous = preflightMergeIntent(first, {
  incomingPaths: () => ({ paths: [], ambiguous: true }),
});
check('ambiguous_status', ambiguous.status === 'ambiguous' && ambiguous.can_merge === false);
const impossibleFastForward = preflightMergeIntent(first, {
  isAncestor: ({ ancestor, descendant }) => !(ancestor === first.manifest.edges[1].target_sha
    && descendant === first.manifest.edges[1].source_sha),
});
check('ff_only_impossible_blocked', impossibleFastForward.status === 'blocked'
  && impossibleFastForward.blockers.some((item) => item.reason === 'ff_only_not_possible'));

const drifted = clone(first);
drifted.manifest.edges[0].source_sha = '0'.repeat(40);
check('tamper_breaks_seal', verifyMergeIntentSeal(drifted) === false);
const resealedDrift = buildMergeIntent(input);
const driftPreflight = preflightMergeIntent(resealedDrift, {
  resolveRef: ({ ref, worktree }) => {
    if (ref === 'refs/heads/safety') return 'f'.repeat(40);
    return first.manifest.edges
      .flatMap((edge) => [
        [edge.source_ref, edge.source_worktree, edge.source_sha],
        [edge.target_ref, edge.target_worktree, edge.target_sha],
      ])
      .find(([knownRef, knownWorktree]) => knownRef === ref && knownWorktree === worktree)[2];
  },
});
check('sha_drift_blocked', driftPreflight.status === 'blocked'
  && driftPreflight.blockers.some((item) => item.reason === 'source_sha_drift'));
const worktreeDrift = preflightMergeIntent(first, {
  resolveWorktreeHead: ({ worktree }) => worktree === safetyWorktree
    ? 'e'.repeat(40)
    : first.manifest.edges
      .flatMap((edge) => [
        [edge.source_worktree, edge.source_sha],
        [edge.target_worktree, edge.target_sha],
      ])
      .find(([knownWorktree]) => knownWorktree === worktree)[1],
});
check('worktree_drift_blocked', worktreeDrift.status === 'blocked'
  && worktreeDrift.blockers.some((item) => item.reason === 'source_worktree_drift'));

reject('source_equals_target', () => buildMergeIntent({
  ...input,
  edges: [{ ...input.edges[0], target_ref: input.edges[0].source_ref }],
  forbidden_reverse_edges: [],
}), 'MERGE_INTENT_SAME_ENDPOINT');
reject('missing_ref', () => buildMergeIntent({
  ...input,
  edges: [{ ...input.edges[0], source_ref: 'refs/heads/missing' }],
  forbidden_reverse_edges: [
    { source_ref: 'refs/heads/develop', target_ref: 'refs/heads/missing' },
  ],
}), 'MERGE_INTENT_REF_MISSING');
reject('mode_restricted', () => buildMergeIntent({
  ...input,
  edges: [{ ...input.edges[0], mode: 'squash' }],
}), 'MERGE_INTENT_MODE');
reject('reverse_edge_rejected', () => buildMergeIntent({
  ...input,
  edges: [{ ...input.edges[1], source_ref: 'refs/heads/peo', source_worktree: repo,
    target_ref: 'refs/heads/develop', target_worktree: developWorktree }],
}), 'MERGE_INTENT_FORBIDDEN_EDGE');
const oneExplicitReverse = buildMergeIntent({
  ...input,
  forbidden_reverse_edges: [input.forbidden_reverse_edges[1]],
});
check('declared_reverse_is_exact', oneExplicitReverse.manifest.forbidden_reverse_edges.length === 1
  && oneExplicitReverse.manifest.forbidden_reverse_edges[0].source_ref === 'refs/heads/peo');

const outsidePolicy = preflightMergeIntent(first, {
  inventoryDirty: ({ edge }) => edge.target_ref === 'refs/heads/peo'
    ? { staged: ['outside.txt'], unstaged: [], untracked: [], ambiguous: [] }
    : { staged: [], unstaged: [], untracked: [], ambiguous: [] },
});
check('outside_policy_blocked', outsidePolicy.status === 'blocked'
  && outsidePolicy.blockers.some((item) => item.reason === 'dirty_path_outside_policy'));

for (const item of results) {
  console.log(`${item.id}\t${item.pass ? 'PASS' : 'FAIL'}\t${item.detail || ''}`);
}
process.exit(results.every((item) => item.pass) ? 0 : 1);
NODE
)"
EXIT=$?
printf '%s\n' "$OUT"

snapshot "$AFTER"
assert_eq "$EXIT" "0" "merge-intent behavior oracle exits successfully"
for id in ordered_edges predecessor_result_binding pinned_shas deterministic_seal forbidden_reverse_explicit \
  safe_status dirty_inventory incoming_paths safe_has_no_proposal overlapping_status \
  path_scoped_proposal ambiguous_status ff_only_impossible_blocked tamper_breaks_seal sha_drift_blocked \
  worktree_drift_blocked source_equals_target missing_ref mode_restricted reverse_edge_rejected \
  declared_reverse_is_exact outside_policy_blocked; do
  assert_contains "$OUT" "$id	PASS" "$id"
done
assert_eq "$(cat "$AFTER")" "$(cat "$BEFORE")" \
  "build and preflight leave refs, dirty state, indexes, worktrees, and stashes untouched"

finalize_test
