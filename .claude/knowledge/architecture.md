<!-- last-verified: 2026-07-27 -->
# Architecture Lessons

## Absence is not zero: admit resources before proving cleanup

**Date**: 2026-07-27 | **Context**: Worktree lifecycle P4 tried to prove zero
residue after automatic managed-leaf cleanup.

**Problem**: A missing journal was repeatedly mistaken for an empty journal.
Incremental defenses (sentinel, directory inode, byte mirror, record-set digest)
each moved the ambiguity one layer outward: deleting the newly trusted layer
could still manufacture `zero_residue:true`. The review loop was slow because
the threat model was not frozen up front, external review ran against unstable
diffs, and single/dual/root evidence loss plus crash recovery arrived as serial
findings.

**Solution**: Register each resource root durably before its first leaf exists.
The repo registry is the admission fact; an active root can never be
reinitialized after evidence loss. Bind the original journal
nonce/birth-time/device/inode
and record commitments in a Git-blob authority advanced using
`git update-ref` compare-and-swap, then forward-repair anchor and registry from
that ref; the sentinel is a local immutable identity witness, not the authority.
This ordering detects coordinated ordinary-file snapshot replay while
recovering a kill after the authority update. Journal successful managed leaves
before worktree removal. Cleanup may claim zero only
when admission, current observation, immutable evidence, disposition, and
freshness all agree. For future work, freeze an adversarial
matrix before implementation (single loss, duplicated loss, root loss,
replacement/replay, permissions, mid-transaction kill, legacy migration,
normal success cleanup), run reviewers against that same matrix in parallel,
and defer expensive external review until the diff is stable.

**Failed attempts**: nonce-only sentinel; device/inode binding; a second byte
mirror without a durable membership commitment; mutable commitment copied into
both anchor and sentinel; registry-only commitment without anti-rollback;
anchor+registry authority vulnerable to coordinated stale replay; generic
single-copy repair that erased unexplained evidence; treating an ordinary,
replayable intent file as authority after membership commit; publishing a raw
symlinked worktree path before canonicalization.

**Related**: `scripts/reap-dispatch-worktrees.sh`,
`scripts/reap-dispatch-branches.sh`, `scripts/lib/worktree-reap.sh`,
`hooks/tests/lifecycle-residue-receipt.test.sh`.

## Severity is not repair authority; peer is not Heto

**Date**: 2026-07-26 | **Context**: Revival World 3D asset-pipeline POC drifted into
authenticated device-preview receipts after technically valid review findings were treated
as mandatory current-ticket work.

**Problem**: Two independent concepts were collapsed. First, a verified Critical/Major
establishes that a claim is real, not that it belongs in the current task. Second, invoking
the same model in a fresh context is a useful blind peer sample, but it is not heterogeneous
review. When the strongest cross-family chair was unavailable, a same-model peer was
incorrectly presented as the Heto fallback.

**Solution**: The quality pipeline now separates claim verification from repair authority:
every surviving blocker is disposed `must-fix-now`, `follow-up`, or
`reject-out-of-scope`; only the first class may mutate the ticket, and a sealed full-diff
scope checker stops cumulative repair growth. Review taxonomy is explicit: same-family
fresh-context = peer; Heto requires a different model family. If the qualified chair is
unavailable, fall back to all eligible cross-family panelists rather than one weaker
substitute. Eligibility is per review lineage and payload: exclude implementers from that
lineage and seats whose capability/context cannot carry the diff; do not impose a permanent
role ban on a model.

**Related**: `scripts/adjudicate-findings.js`, `scripts/check-repair-scope.js`,
`skills/quality-pipeline/references/code-review.md`,
`docs/plans/2026-07-26-review-scope-stop-loss.md`.
