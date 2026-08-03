# Rubric — Platform capability trigger activation and strict-L5 bootstrap

Logical plan: `platform-capability-trigger-activation-2026-08-04-r4`

Review the plan as an executable implementation contract. A blocker must identify a concrete defect
that prevents the next implementation slice or immediate integrity, cite the affected rubric ID and
plan evidence, and propose the smallest repair. Suggestions, alternate tastes, future hardening, and
out-of-scope expansions are non-blocking backlog candidates.

## Stable criteria

- R1: **Bounded executable graph.** The plan has exactly one Mission deliverable, with D1–D4 as
  ordered internal gates, explicit acceptance commands, and the unchanged one-node repair/resource
  budgets. Tests, review seats, repairs, doc sync, versioning, and release are internal gates.
- R2: **Closed evidence-bound capability claims.** Every consumed platform fact is represented by a
  closed content-addressed claim requiring both official-contract and fresh version-matched live
  evidence, explicit agreement/freshness/revalidation, and exact identity dimensions. D2–D4 consume
  only revalidated claim IDs. Missing/stale/version-mismatched/contradicted evidence, unknown fields,
  duplicate or substituted IDs, changelog-only claims, version order, and prose fail closed.
- R3: **Agy authority and framing.** The design captures the native structured envelope from the
  exact agy process, validates it without content sniffing, separates response from usage, preserves
  verdict/status framing, rejects malformed/non-zero/spoofed output, and keeps historical transcript
  telemetry honestly unavailable.
- R4: **Codex recovery integrity.** Production registration uses the official Codex `PostCompact`
  event/matcher/payload/order/failure contract and calls the existing host-neutral recovery
  implementation. Manual/auto, exactly-once, broken-adapter, and effect-before-reconcile controls are
  executable and fail closed.
- R5: **Strict-L5 trust root.** `src/readiness/provider-bootstrap.js` is the named canonical code
  source for the exact `(runner, model, role, effort, endpoint, family)` policy and deterministic
  roster projection. D1 evidence covers all six dimensions. Ordinary strict-L5 CLI construction
  derives fresh constructor-owned in-process qualification/readiness closures from that policy before
  spend; unknown/drifted tuples, claim/receipt substitution, serialized/disk evidence, stale/
  mismatched/replayed receipts, probe failure, policy-digest drift, and roster drift cannot authorize
  dispatch.
- R6: **Verification strength.** Each internal gate names focused positive and negative tests; the
  cumulative independent verifier owns the frozen base-to-candidate range, full suite, mutation or
  inverse controls, generated parity, and fail-before-spend evidence.
- R7: **Atomic migration and hygiene.** Canonical non-generated Codex hook sources are exactly
  `platforms/codex/hooks/hooks.json` and `platforms/codex/hooks/post-compact.js`; the sync script maps
  them exactly to the two `platforms/codex/plugin/hooks/*` generated files. Deletion/regeneration and
  manual-edit inverse drift tests prove ownership. All root consumers, closed schemas, fixtures,
  documentation, backlog status/counts, CHANGELOG, inventory, skill table, and other generated mirrors
  are covered; no compatibility parser or manually edited package hook remains.
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
