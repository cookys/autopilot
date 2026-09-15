Design question (autopilot managed campaign rail, Node.js, src/engine/campaign-intake.js):

Defect measured end-to-end (cuda 2026-09-16): resuming a campaign parked in the durable-wait phase
`awaiting_disposition` with `--resume --campaign-disposition-authority <file>` dies in
`check-repair-scope.js` with `implementation_sha must be an immutable full 40-hex commit object ID`.

Mechanism (see artifacts): for durable-wait phases (AWAITING_DISPOSITION / BOUNDARY_REJECTED /
AWAITING_CONVERGENCE_ADJUDICATION) `defaultGenerationClaim` assigns
`existing.resume_candidate = existing.candidate_reference` — the RAW ledger reference — and explicitly
skips `verifyResumeCandidate`, which is the only producer of the normalized shape
`{committed, commit, tree_sha, branch, writer_fence, scope_implementation_sha, repair_lineage}`.
The engine consumer then reads `resumeCandidate.scope_implementation_sha` (undefined) and builds the
repair-scope contract from it. The non-durable path sets `scope_implementation_sha = (initial_candidate_reference || candidate_reference).commit`
(first generation's candidate — the churn baseline) and `commit = candidate_reference.commit` (current).

Two candidate fixes:
(a) Route git_candidate durable-wait resumes through `verifyResumeCandidate` (git drift check: tip/tree/ancestry
    of the retained branch+worktree must still match), keeping the skip only when the reference is not a
    git_candidate (e.g. BOUNDARY_REJECTED can carry `candidate_ref: 'unbound-candidate'`).
(b) Shape-only normalizer for durable-wait: copy the reference and add `committed:true` and
    `scope_implementation_sha` from initial_candidate_reference||candidate_reference, with NO git drift check
    (as today).

Questions:
1. Which is safer for AWAITING_DISPOSITION specifically, where the disposition authority file is the owner's
   decision on a reviewed candidate — should a drifted retained worktree/branch block resume (a) or is the
   reference itself sufficient (b)? Name the concrete failure each option lets through.
2. Is there a reason the original author skipped verifyResumeCandidate for these phases that (a) would break
   (e.g. worktree already cleaned up under retention expiry, cleanupState semantics)? Point at the artifact lines.
3. What should the red-first test assert so it discriminates the fix from a shape-only patch that
   still passes a wrong sha (e.g. current commit instead of initial commit for generation>1)?
Answer with a recommendation and the precise assertions; do not emit a ship/no-ship verdict.
