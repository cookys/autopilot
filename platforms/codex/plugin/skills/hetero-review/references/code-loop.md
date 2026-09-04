# Code Review Loop — Adjudication and Freeze Discipline

This document specifies the judgment rules and freeze discipline for heterogeneous code reviews.

## Core Principle: Claims vs Gates (ADR-0001)

A hetero implementer's green or reviewer green verdict is a claim that depth-0 must independently re-derive, never a gate that stands on its own. Depth-0 re-derives the verdict from the reviewer's structured JSON artifact and the exact `base..head` commit range it reviewed.

No trust machinery (no hash chains, event ledgers, witness receipts, attestation, or trust roots) is used. The integrity is established by snapshot shas, reviewer artifacts, and verifiable execution receipts.

## Quality of Disposition Rationales

Depth-0 evaluates all candidate findings emitted by the heterogeneous review panel. Each finding receives a disposition:
- `verified`: finding is confirmed and valid.
- `refuted`: finding is rejected with a concrete rationale.
- `deferred`: non-blocker deferred with explicit justification.

A good disposition rationale for code-review findings:
- Ties the refutation to concrete code evidence, tests, runtime semantics, or existing invariants rather than bare assertion.
- Demonstrates why the reported issue cannot occur, is already mitigated by an invariant upstream, or is an intentional design trade-off documented in ADRs.

## Freeze Predicate

The code review loop freezes when either:
1. A `SHIP-AS-IS` verdict is finalized with a contiguous, head-matching generation chain verified by `node scripts/check-phase-review-receipt.js` in receipt mode; OR
2. A valid opt-out receipt is written via `node scripts/hetero-review-loop.js opt-out --knob hetero_review` when the `hetero_review` knob resolves to `off`.

Receipt verdict tokens are strictly `SHIP-AS-IS` and `FIX-THEN-SHIP`. Severities use only existing vocabulary (`Critical`, `Major`, `Minor`, `Suggestion`).

## The Growth Rail

Code reviews enforce incremental delta verification to prevent unbounded loops and scope creep:
- Each new generation reviews only the delta since the previous generation's head.
- A new generation never re-reviews the entire phase range from scratch.
- Verified findings from prior generations are tracked until closed by subsequent reviewer artifacts over the delta.
- The generation chain must remain strictly contiguous from phase base to head.
