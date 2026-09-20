# Rubric — Four-layer redesign: contract hardening + capability tiering

- R1: [survey-fidelity] Every mechanism traces to a survey-validated finding and respects the
  survey's corrections — capability tiering (not flat minimalism), cascade (not always-on
  panels), single-round verdicts (never debate rounds), no orchestration framework, no parallel
  implementer — and no mechanism contradicts a survey verdict without recorded justification.
- R2: [anti-cathedral] Every deliverable attaches to a NAMED existing rail, has a caller landing
  in the same phase, and ships with a red-case test; nothing introduces trust machinery (hash
  chains, ledgers, witnesses, attestation), speculative layers, or a component whose only
  consumer is a future plan.
- R3: [blind-evidence soundness] The narrative lint targets the implementer→reviewer corruption
  direction precisely (completion claims, self-assessed outcomes without receipt paths), does
  not overlap or conflict with `check-dispatch-suppression.sh`'s controller→reviewer direction,
  has a plausible false-positive story (tested against a real historical spec), and its escape
  hatch is logged, not silent.
- R4: [boundary realism] The exec-boundary hook's deny list covers the measured accident classes
  (protected-ref force-push, worktree-escaping `rm -rf`, destructive SQL, `sudo rm`), is
  allow-by-default outside it, makes no LLM calls, ships opt-in with a per-project config, and
  the hetero-engine boundary is honestly mapped to EXISTING gates (worktree containment,
  qc-gate pre-push) rather than claimed as new coverage.
- R5: [tier fail-closure] Tier resolution is deterministic from named evidence inputs, resolves
  unknown/stale/missing evidence to T2 (maximum scaffolding), records evidence_refs for audit,
  and the three prompt skeletons live in exactly one canonical reference consumed by assembly
  (no second canonical statement).
- R6: [cascade correctness] Escalation triggers add a fresh disjoint-family seat with an
  independent single-round verdict — never a rebuttal/debate round, never a same-family seat —
  existing risk-tier behavior is unchanged, and fixtures prove the trigger→seat mapping.
- R7: [gate adequacy] Each KR names a planted red case that MUST fail before the mechanism and
  pass after; the full-suite acceptance is defined against the recorded baseline fail set; the
  4-step new-script wiring and release gates (inventories, mirrors, preflight) are all in scope.
- R8: [scope discipline] Skill rewrites, tier A/B measurement, durable-execution machinery, and
  graph runtimes stay out of scope with named BACKLOG/decision homes; the PATCH/internal-only
  change-policy record is coherent; D6's resume work is audit-only.
