# Plan Review Loop — Adjudication and Freeze Discipline

This document specifies the judgment rules and freeze discipline for heterogeneous plan reviews.

## Core Principle: Claims vs Gates (ADR-0001)

The plan review loop's dispatch mechanism is `scripts/dispatch-plan-review.js` (which research-to-ship's Phase 3 invokes via the `autopilot:hetero-review` skill).

A hetero engine's green verdict is a claim that depth-0 must independently re-derive, never a gate that stands on its own. The review verdict is not self-authenticating: depth-0 (the calling session) re-derives the verdict from the reviewer's structured JSON artifact and the exact base..head range or frozen plan artifact it reviewed.

No trust machinery (no hash chains, event ledgers, witness receipts, attestation, or trust roots) is introduced. The authoritative state is derived strictly from the artifact and rubric evidence.

## Quality of Disposition Rationales

Depth-0 writes an explicit disposition per finding: either `accept-and-fold` or `refute-with-rationale`. Blocker findings must never be deferred.

A good disposition rationale:
- Must tie directly to concrete evidence in the diff, plan text, architecture requirements, or project constraints.
- Avoids bare assertions (e.g. "disagree", "not needed", or "will fix later").
- Clearly demonstrates why the finding is invalid or how the plan text already addresses the risk, citing specific sections, line numbers, or invariant contracts.

## Freeze Predicate

The plan review loop freezes when either:
1. The rubric is frozen and `node scripts/check-phase-review-receipt.js --plan-artifact <file> --dispositions <file>` exits 0 with zero unrepaired and zero deferred blockers; OR
2. A valid opt-out receipt is written via `node scripts/hetero-review-loop.js opt-out --knob plan_review` when the `plan_review` knob resolves to `off`.

Receipt verdict tokens are strictly `SHIP-AS-IS` and `FIX-THEN-SHIP`. Severities use only existing vocabulary (`Critical`, `Major`, `Minor`, `Suggestion`).

## The Growth Rail

Plan review enforces strict scope control across generations:
- Generation 1 reviews the initial plan and rubric.
- A second generation (at most one additional generation allowed) only re-reviews what the first generation's dispositions changed.
- A subsequent generation never re-reviews the entire plan from scratch.
- If findings persist beyond generation 2, depth-0 must adjudicate directly rather than looping indefinitely.

## Refusals that dispatch zero seats (why was my g1/g2 refused)

`scripts/dispatch-plan-review.js` refuses several things before any seat runs. In one 2026-10-21 session they cost three resubmits because the facts lived only in the script header. In the order they were hit:

1. `plan_unregistered`: the plan needs a row in the INDEX (`bash scripts/resolve-project-paths.sh --field index`) with Version `active` (or pass `--allow-unregistered` for a scratch/consumer repo; a repo with no INDEX is auto-allowed).
2. Context file denied: a `--context-file` under the resolved plans dir's `**/evidence` (`resolve-project-paths.sh --field plans_dir`), the resolved backlog file or its `backlog/` directory (`--field backlog`), or any review artifact (`*-out.json`, dispositions, findings, `*.as-reviewed-*`) is refused as blind context (`scripts/lib/plan-review-context.js` `DENIED_DIRS` / `DENIED_NAMES`). Put the excerpt in a neutral path such as `<plans_dir>/context/`.
3. `plan_growth_hard_stop` (plan grew past 1.5x versus g1; warning at 1.25x): shrink the plan, never raise the ratio. It dispatches zero seats but still writes a terminal lock; the unlock recipe (state.json `terminal:false`, rename the `terminal-plan_growth_hard_stop.json` artifact aside) is in the script header comment and is legitimate only because no seat consumed content.
4. Timeout: the default `--timeout 5m` starves a `max`/`xhigh` seat; pass `--timeout 20m` for any non-default effort. A timed-out seat with empty stdout is misclassified as a binding mismatch, so check the scratch stderr first.
5. Freeze check after g2 must run against the as-reviewed snapshot, not the edited working copy: the receipt binds to the plan bytes that were submitted (observed with `plan.as-reviewed-g2.md` versus the edited r3).
