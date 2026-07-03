# Design-Panel Decision Matrix & Aggregation Rules

This reference outlines the mechanical aggregation rules for design-panel decisions, as established in the quality-floor engine plan.

Design source: quality-floor-engine.md (`docs/plans/2026-07-04-quality-floor-engine.md`) §4.4

## Overview
When a design panel is fanned out, each panelist evaluates the proposed options against the defined criteria using the same options × criteria matrix. Depth-0 aggregation of these responses is strictly mechanical, applied in the following order.

## The Four Ordered Rules

### Rule 1: Unanimous, Disjoint, and Reversible
If the panel is **unanimous** AND the panel spans **≥2 disjoint families** AND the decision is **reversible**:
- **Action**: Adopt the decision.
- **Rationale**: Mid-tier unanimity within a single model family represents correlated bias rather than an independent signal. Family disjointness is a hard precondition for trust.

### Rule 2: Split on Reversible
If the panel is **split** on a **reversible** decision:
- **Action**: Adopt the cheapest option and record a revisit trigger in the project backlog.

### Rule 3: Irreversible Decisions
If the decision is **irreversible** (regardless of whether the panel is unanimous or split):
- **Action**: Propose and run a diagnostic probe or spike if the disagreement (or the unanimous premise) is empirically probeable. If the disagreement cannot be probed, **escalate to L4**.

### Rule 4: Factual Claims Verification
If any panelist makes a **factual claim** as part of their evaluation:
- **Action**: Route the claim to the adjudication table. Never trust a citation or claim on face value alone.

---

## Preconditions & Conventions

### Family-Disjointness Precondition
Unanimity alone does not satisfy Rule 1 unless the panel spans at least two disjoint model families (e.g., Anthropic Claude and Google Gemini). A panel of N models from the same vendor is subject to shared bias and failure modes.

### Factual Claims to Adjudication
All factual assertions (e.g., API capabilities, system behaviors, config defaults) must enter the finding-adjudication protocol (`scripts/adjudicate-findings.js`). They cannot serve as inputs to the matrix until reproduced or trace-confirmed.
