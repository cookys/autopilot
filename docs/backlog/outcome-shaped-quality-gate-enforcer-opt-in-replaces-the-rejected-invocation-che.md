# Outcome-shaped quality-gate enforcer (opt-in) — replaces the rejected invocation check

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: When an enforcer for the quality gate is wanted again, OR when `quality-pipeline` grows a SHA-bound "this ran" receipt that a gate could re-derive from. Not before: the current design has nothing to verify against.
- **Context**: P7 ruled out the obvious enforcer. A hook asking "was `Skill(quality-pipeline)` invoked before `git commit`" governs **process**, which [ADR-0001](adr/0001-verification-over-attestation.md) forbids — and the outcome it proxies (tests were actually run) already sits at 5/6 in the eval's **OFF** arm, i.e. near the model's base rate. It would also kill F6 as a FULL-vs-CARD discriminator, which the re-attempt campaign needs (≥4/5 families load-bearing). If built: opt-in like `branch-protection.js` (never default-on), predicate must be outcome-shaped (evidence that tests ran green against the diff, re-derived — not an assertion that a skill was called), escape hatch + planted red case mandatory per the anti-cathedral constraint.
- **Effort**: M
- **Source**: think-tank 5-role panel 2026-08-18（collision insights ②③）;[p7-f6-f4-adjudication.md](plans/evidence/2026-08-18-dev-flow-contract-card/p7-f6-f4-adjudication.md).

