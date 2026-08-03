# Rubric — Platform capability trigger activation and strict-L5 bootstrap

Logical plan: `platform-capability-trigger-activation-2026-08-04`

Review the plan as an executable implementation contract. A blocker must identify a concrete defect
that prevents the next implementation slice or immediate integrity, cite the affected rubric ID and
plan evidence, and propose the smallest repair. Suggestions, alternate tastes, future hardening, and
out-of-scope expansions are non-blocking backlog candidates.

## Stable criteria

- R1: **Bounded executable graph.** The plan has at most four real deliverables, explicit dependency
  order, acceptance commands and repair budgets. Tests, review seats, repairs, doc sync, versioning,
  and release are gates inside deliverables rather than hidden phases.
- R2: **Evidence-bound capability claims.** Every consumed platform fact is version-bound and backed
  by an official contract plus live event/behavior evidence. Changelog-only, version-order, model
  prose, and stale receipts cannot promote support; contradicted facts fail closed.
- R3: **Agy authority and framing.** The design captures the native structured envelope from the
  exact agy process, validates it without content sniffing, separates response from usage, preserves
  verdict/status framing, rejects malformed/non-zero/spoofed output, and keeps historical transcript
  telemetry honestly unavailable.
- R4: **Codex recovery integrity.** Production registration uses the official Codex `PostCompact`
  event/matcher/payload/order/failure contract and calls the existing host-neutral recovery
  implementation. Manual/auto, exactly-once, broken-adapter, and effect-before-reconcile controls are
  executable and fail closed.
- R5: **Strict-L5 trust root.** Ordinary strict-L5 CLI construction injects constructor-owned,
  non-serializable, fresh, exact-tuple qualification/readiness authority before spend. Runtime input,
  serialized/disk evidence, stale/mismatched/replayed receipts, probe failure, and roster drift cannot
  authorize dispatch.
- R6: **Verification strength.** Each deliverable names focused positive and negative tests; the
  cumulative independent verifier owns the frozen base-to-candidate range, full suite, mutation or
  inverse controls, generated parity, and fail-before-spend evidence.
- R7: **Atomic migration and hygiene.** All root consumers, closed schemas, fixtures, documentation,
  backlog status/counts, CHANGELOG, script inventory, relevant skill table, and mechanically generated
  Codex mirrors are covered. No compatibility parser or manually edited mirror remains.
- R8: **Scope, resources, and rollback.** The plan uses no new dependency, distinguishes required
  from optional live probes, preserves blocked residuals, keeps generic CI disabled, confines release
  to bump-version finish flow, and provides a coherent cumulative rollback boundary.

## Verdict rules

- `READY`: every R1–R8 criterion is implementable without an unresolved correctness or integrity
  decision; any findings are clearly non-blocking.
- `CONDITIONAL`: at least one precise blocker candidate is repairable within the plan's current scope
  and the two-generation cap.
- `STOP`: the plan depends on an unproven platform capability, lacks an authority boundary, requires
  scope expansion beyond D1–D4, or cannot be made executable within the frozen resource ceiling.
