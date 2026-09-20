# Rubric — Autonomous brain integration (frozen for plan review)

- R1: [pathology-fidelity] Every mechanism traces to a named failure shape (F1–F12 in
  `evidence/2026-08-17-autonomous-brain-integration/sol-pathology.md`) or a recorded Board
  ruling in §0; no mechanism exists for a failure nobody observed; the KR→failure-shape
  mapping is complete and honest.
- R2: [anti-cathedral] Every deliverable attaches to a NAMED existing rail with a caller
  landing in the same phase; nothing introduces trust machinery (hash chains,
  tamper-evidence, witnesses, attestation — ADR-0001) or a component whose only consumer
  is a future plan; the decision ledger stays plain telemetry.
- R3: [freeze completeness] The frozen four-tuple covers exactly the four mutation
  surfaces sol exploited (granularity, gate set, rubric, control plane); the conformance
  check is deterministic and blocks BEFORE spend; the re-freeze channel is a stop —
  never an in-flight amendment; no fifth mutation surface is left unfrozen and
  exploitable.
- R4: [statelessness soundness] No load-bearing state lives only in context: every input
  the brain needs at round start is in the bundle or on disk; the bundle has a hard token
  cap with fail-closed truncation; kill/resume equivalence (KR2) is testable as written;
  process re-attachment comes from the ledger, not from memory.
- R5: [non-blocking experience station] The critic runs strictly post-acceptance, cannot
  gate any merge under any code path, emits bounded top-K findings with stable IDs into
  the BACKLOG intake, and the methodology is the five-question instantiation protocol —
  no closed artifact-type table, and human-only qualities are routed to the user, never
  simulated.
- R6: [auto-pick auditability] The pick function is deterministic and replayable from its
  inputs; auto-eligible vs ask-first classification is machine-checkable; picks come only
  from written queues; every pick lands in the decision ledger with rationale; an
  ask-first row can never be auto-picked.
- R7: [bounded scope] Each phase is independently shippable and severable with a
  dev-flow size and concrete acceptance; the plan adds no new lifecycle skill and leaves
  dev-flow's sequence byte-unchanged; per-finding re-verification is scoped (never
  automatic full-suite); the plan does not itself exhibit F2/F4 (mega-batch, mechanical
  phase explosion).
- R8: [user authority] Every proxy decision is vetoable at the round-end report;
  ask-first classes are enumerated and closed; the first-use qualification ask has
  exactly two outcomes (standing exam or per-invocation override) with headless runs
  failing closed; among qualified candidates the user's preference config outranks
  system ranking.
- R9: [gate adequacy] Each KR names a red case that MUST fail before the mechanism and
  pass after; both directions of the stall fuse are negative-controlled (trips on the
  sol pattern, silent on a healthy run); the new-script 4-place wiring and release gates
  are in scope.
