# Reviewer output-token budget

> Status: IN PROGRESS — frozen one-node L4 mission
> Owner: depth-0 CEO + one worktree-isolated foreman
> Plan: [`docs/plans/2026-08-02-reviewer-output-token-budget.md`](../../plans/2026-08-02-reviewer-output-token-budget.md)

## Goal

Ship one honest optional reviewer response-token budget: exact mapping where the installed runner
supports it, explicit pre-spend rejection where it does not, and no change when omitted.

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `reviewer-output-token-budget` | admitted / implementation pending | live runner-help matrix frozen in the plan; R1–R8 acceptance rubric frozen |

## Fixed scope

- One bundled implementation across `dispatch-review.sh`, its fixture test, operator reference,
  changelog, and exact lifecycle docs.
- One first-pass review after the whole implementation; one authoritative depth-0 final gate.
- No new provider transport, version bump, release, push, PR, or adjacent review-efficiency work.

## Execution ledger

| Date | Event | Result |
|------|-------|--------|
| 2026-08-02 | Backlog selection | Highest immediately executable non-Board triggered entry after hook-harness closure |
| 2026-08-02 | Runner spike | Anthropic-compatible and Qoder have verified cap surfaces; Codex, agy, Grok, and Claude CLI rails do not |
| 2026-08-02 | Plan/rubric freeze | One deliverable; exact eight-path output boundary; no feature worktree/model effect yet |
