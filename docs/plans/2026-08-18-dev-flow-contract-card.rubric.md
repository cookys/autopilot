# Rubric — dev-flow contract-card rewrite, evidence-gated (成績單前置)

- R1: [experiment-validity] The three arms isolate exactly one variable (dev-flow
  presence/content): companion skill roster and task prompts byte-identical across arms, no hooks
  in the synthetic plugin, no required-artifacts contract in any prompt (the old orchestration
  harness's ON-arm confound is not reproduced); the measured channel is real plugin routing +
  loading (`--plugin-dir`), and the pre-registered prompt-injection fallback explicitly narrows
  the recorded claim instead of silently substituting the channel.
- R2: [pre-registration integrity] V1 manipulation check, V2 sensitivity gate, and V3
  non-inferiority rules (margins, family counts, verdict map) are frozen before the first live
  run, cover every outcome without a rerun-until-green path, bound ITERATE-CARD to one revision
  with a CARD-only re-run against the same frozen FULL/OFF rows, and invalidate blocks on CLI
  version drift or >10% arm-level infra_fail.
- R3: [marker soundness] Every marker is deterministic (git/FS residue, task-store JSON,
  transcript event order) with no LLM judging; generic-competence gaming is controlled by the OFF
  arm plus V2 (a family FULL≈OFF is demoted, not counted); the scorer's planted-red tests prove a
  vacuous FULL==OFF fixture can NEVER reach SHIP-GATE-MET and that no-op / planted-cheat fixtures
  fail their markers; the task-prompt leakage grep gate exists and is test-enforced.
- R4: [card fidelity] The disposition preserves byte-verbatim everything externally pinned:
  frontmatter `description:`, all four `` !`cat` `` injection lines, S-scope-gate block 220-233,
  rule-inventory owner lines (23 / 204-206 / 490), L-1.6/L-5/H-9 TaskCreate blocks, the L-1.5
  heading referenced by name from ceo-agent, 驗證合約 165-187, and Mission Routing Override; the
  card is a good-faith best effort (judgment prose relocated with pointers, not deleted), not a
  straw man built to pass V3.
- R5: [baseline re-establishment soundness] The successor guided-compatibility baseline proves
  relocation-not-loss (source universe extended to dev-flow references/), gives truly deleted
  duplicates explicit `removed` dispositions in the migration map, retains the old snapshot for
  audit, updates the three `798` literals and the baseline pointer in the same commit, ships a
  red-case test (deleting a rule present in the NEW baseline still fails), and adds no trust
  machinery (ADR-0001).
- R6: [claim honesty] Unmeasured surfaces are named as gaps, not covered by implication:
  multi-turn scope-creep, Mission Routing Override behavior, opus-class extrapolation; the prior
  skill-transport H1 leaf-channel result (D=0) is not conflated with the depth-0 claim; the
  per-skill line-budget ratchet distinguishes enforced (check 8 map) from `documented-only`
  (contract density) honestly.
- R7: [ship-surface completeness] All release rails are in scope with named verification
  commands: canonical-invariants, profiles catalog --check + isolation test, codex-mirror
  projected-skill resync + package test, sync-all --check, evals discoverability rows,
  preflight-release 8/8, PATCH semver rationale, `--update-baseline` timing, and single
  swap-commit rollback granularity for P7.
- R8: [scope discipline] dev-flow only; frontmatter/description untouched; quality-pipeline card,
  contract-density counter, and post-ship telemetry live in named BACKLOG rows; total live-run
  spend stays within the approved 60-90 primary budget (+bounded smoke/iteration allowances); no
  new severity vocabulary, no new trust machinery, no second canonical statement of card shape.
