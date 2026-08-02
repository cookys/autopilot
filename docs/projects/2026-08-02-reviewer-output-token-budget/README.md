# Reviewer output-token budget

> Status: CANDIDATE READY — depth-0 final QC and integration pending
> Owner: depth-0 CEO + one worktree-isolated foreman
> Plan: [`docs/plans/2026-08-02-reviewer-output-token-budget.md`](../../plans/2026-08-02-reviewer-output-token-budget.md)

## Goal

Ship one honest optional reviewer response-token budget: exact mapping where the installed runner
supports it, explicit pre-spend rejection where it does not, and no change when omitted.

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `reviewer-output-token-budget-successor` | candidate complete | strict range and no-spawn fixtures; exact Anthropic/Qoder argv projection; byte-equal Codex mirrors; complete successor verification bundle |

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
