# Plan Review Loop — Adjudication and Freeze Discipline

This document specifies the judgment rules and freeze discipline for heterogeneous plan reviews.

## Core Principle: Claims vs Gates (ADR-0001)

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
