# Reviewer output-token budget

> Status: COMPLETE — authoritative depth-0 QC passed and locally integrated
> Owner: depth-0 CEO + one worktree-isolated foreman
> Plan: [`docs/plans/2026-08-02-reviewer-output-token-budget.md`](../../plans/2026-08-02-reviewer-output-token-budget.md)

## Goal

Ship one honest optional reviewer response-token budget: exact mapping where the installed runner
supports it, explicit pre-spend rejection where it does not, and no change when omitted.

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `reviewer-output-token-budget-successor` | complete | strict range and no-spawn fixtures; exact Anthropic/Qoder argv projection; byte-equal Codex mirrors; 260-file suite and depth-0 final QC green; locally integrated at `22175030` |

## Acceptance status

| Rubric | State |
|--------|-------|
| R1–R5 Input, mappings, omission, truncation | satisfied by 250 focused assertions, including five unsupported no-spawn controls and both exact native argv projections |
| R6 Review authority | satisfied: the foreman did not self-verify; the existing independent verifier transcript returned `SHIP-AS-IS` |
| R7 Documentation and scope | satisfied: implementation candidate is exactly ten output paths; code, mirrors, reference, and changelog agree |
| R8 Lifecycle | satisfied: full suite and deterministic gates passed; exact backlog item removed; locally merged without push |
| R9–R12 Successor correction | satisfied: old stage is `stale_ignored`; two mirrors are byte-equal; original contract stayed frozen; successor graph and ledger reached terminal integration |

## Fixed scope

- One bundled implementation across `dispatch-review.sh`, its fixture test, operator reference,
  changelog, exact lifecycle docs, and the two deterministic Codex package mirrors.
- One first-pass review after the whole implementation; one authoritative depth-0 final gate.
- No new provider transport, version bump, release, push, PR, or adjacent review-efficiency work.

## Execution ledger

| Date | Event | Result |
|------|-------|--------|
| 2026-08-02 | Backlog selection | Highest immediately executable non-Board triggered entry after hook-harness closure |
| 2026-08-02 | Runner spike | Anthropic-compatible and Qoder have verified cap surfaces; Codex, agy, Grok, and Claude CLI rails do not |
| 2026-08-02 | Plan/rubric freeze | One deliverable; exact eight-path output boundary; no feature worktree/model effect yet |
| 2026-08-02 | Successor boundary correction | Sync check exposed two omitted deterministic Codex mirrors before either mirror was written. Original stage became `stale_ignored`; same foreman/worktree/branch preserved under a ten-path successor graph. |
| 2026-08-02 | Implementation closure | Canonical wrapper/reference plus both generated mirrors are byte-equal; final candidate is bounded to the successor graph's exact ten output paths. |
| 2026-08-02 | Candidate verification | `dispatch-review` 250 assertions, `dispatch-detach` 74 assertions, complete 260-file hook suite, validation, version/inventory/sync, completeness, secret, and scope gates pass; depth-0 still owns authoritative final QC and integration. |
| 2026-08-02 | First-pass review | Existing independent `repair_blind_verifier` transcript returned `SHIP-AS-IS` with no finding after inspecting all ten implementation paths. |
| 2026-08-02 | Authoritative final QC | Gemini 3.6 Flash (High) and Claude Sonnet 4.6 (Thinking) returned parser-valid `SHIP-AS-IS`. GPT-5.5's one Major conflated the seven-file pre-candidate admission commit with the exact ten-file implementation commit; exact git lineage plus the READY successor graph mechanically refuted it. |
| 2026-08-02 | Depth-0 verification and integration | Root reran 250 reviewer and 74 detach assertions plus syntax, 28/28 validation, version, inventory, sync, graph, mirror, and diff gates; locally merged as `22175030` with no push, release, PR, or publication. |
