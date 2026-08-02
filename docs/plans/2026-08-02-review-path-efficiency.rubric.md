# Review-path efficiency rubric

## R1 Blind discovery authority is preserved

Every discovery generation and the final gate receive the full frozen spec/current diff without prior
findings or round metadata. Uncertainty always routes to another full blind review.

## R2 Remediation delta has no whole-candidate authority

Only depth-0-verified finding contracts and exact-commit-bound relevant delta bytes reach the distinct
remediation checker. It can return only `resolved|unresolved|needs_full_review`, never `SHIP-AS-IS` or a
whole-candidate pass; stale/misbinding input falls back to full blind review.

## R3 Reviewer artifact containment is fail-closed

Discovery and remediation inputs stay inside admitted artifacts. Repository crawling, malformed delta,
or unavailable no-tools enforcement cannot silently clear the gate; raw transport evidence is retained.

## R4 Leakage handling does not false-reject valid verdicts

Valid wrapped verdict/finding content may discuss prompt/diff/marker vocabulary without rejection,
while actual echo, truncation, malformed framing, or missing verdict remains fail-closed.

## R5 Verification polarity is machine-proven

Pre-authorized buggy-behavior assertions cannot ship until a receipt bound to base/candidate SHAs, test
command digest, assertion artifact path+digest, red exit class, and green result proves the transition.
Stale and cross-boundary receipts are rejected.

## R6 Existing contracts remain unchanged

Omitted/default behavior and the shipped runner-aware `--max-tokens` mappings are regression-identical;
leaf output compaction remains backlog-triggered, and no generic rtk dependency, echo redesign,
transport-exit recovery, or routing change enters the diff.

## R7 Verification and review are complete

Focused positive/negative fixtures, complete suite, deterministic sync/mirror gates, and one whole-diff
independent panel pass with no unresolved Critical or Major finding.

## R8 Execution, compatibility, and rollback are bounded

Source plans/rubrics, both dependencies, exact acceptance argv, reservations, and the four-attempt gate
budget match the Mission graph. Repairs reuse one lineage; remediation use is reversible to the blind
full-diff path, no new dependency/open question remains, and only this terminal node performs shared
portfolio closeout.

## R9 Portfolio lifecycle closes with canonical receipts

The sealed `campaign_id` is the lifecycle `root_run_id`; caller-owned mode-0700 artifacts preserve a
fresh pre-merge `can_merge=true` task receipt, post-merge task receipt, exact worktree and branch reaper
inventories, a checked `LifecycleResidueReceipt` with `zero_residue=true`, and a final digest-valid
`can_close=true` receipt before marker clear. Project archival moves every active project/evidence file
only after local integration and records the receipt paths/digests; no replacement lineage is opened.
