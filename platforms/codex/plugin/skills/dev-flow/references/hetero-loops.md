# Heterogeneous Review Loops

> Reference for the dev-flow heterogeneous review loops and gating scripts.
> Origin: `docs/plans/2026-09-04-dev-flow-hetero-loops-default.md` D2 deliverable.

This reference indexes the three deterministic scripts supporting dev-flow's plan-review scaffolding, heterogeneous code-review loop execution, and phase review receipt gating.

### scripts/plan-rubric-scaffold.js

- **What**: Generates a structured rubric markdown skeleton from an input plan document.
- **When**: Called during the `plan_review` scaffolding stage before freezing review rubrics.
- **Contract**: Canonical options and flags in `node scripts/plan-rubric-scaffold.js --help`; indexed in [`docs/scripts-inventory.md`](../../../docs/scripts-inventory.md).

### scripts/hetero-review-loop.js

- **What**: Executes multi-seat review collection, disposition aggregation, verdict synthesis, and opt-out receipt generation.
- **When**: Called by the `hetero_review` generation-adversarial review loop via `collect`, `finalize`, or `opt-out` subcommands.
- **Contract**: Canonical options and subcommands in `node scripts/hetero-review-loop.js --help`; indexed in [`docs/scripts-inventory.md`](../../../docs/scripts-inventory.md).

### scripts/check-phase-review-receipt.js

- **What**: Validates phase review receipts (`receipt-<phase>.json`) against git history and review artifacts, or validates plan artifact blocker dispositions.
- **When**: Called when gating a phase transition on a finalized `SHIP-AS-IS` review receipt, a valid `off` opt-out receipt, or dispositioned candidate blockers.
- **Contract**: Canonical options and usage in `node scripts/check-phase-review-receipt.js --help`; indexed in [`docs/scripts-inventory.md`](../../../docs/scripts-inventory.md).
