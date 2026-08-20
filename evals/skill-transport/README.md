# Skill-transport payoff experiments

This directory contains the frozen fixtures, deterministic drivers, and bounded evidence for
the role-specific prompt-pack A/B experiments registered in
`docs/plans/2026-07-15-skill-transport-payoff-ab.md`.

## Reviewer arm (complete)

The reviewer experiment uses `run-matrix.sh`, `report.js`, the `match/` predicates, and the
frozen reviewer/placebo packs. Its committed evidence is `results/matrix.jsonl` plus
`results/report.{json,txt}`. Re-run its no-spend mechanics proof with:

```bash
bash evals/skill-transport/test/matrix-mechanics.test.sh
```

## Implementer arm

The implementer experiment is exactly eight frozen orchestration micro-repositories × two
arms. `implementer-tasks.json` binds every `task.md` and source `oracle.sh` by SHA-256.
`run-implementer-matrix.sh` validates all bindings and proves all eight pristine repositories
are base-red before it creates a schedule or calls a model.

The two implementation prompts are byte-identical. The `pack` treatment is applied only by
the existing `scripts/dispatch-hetero.sh` prompt-pack path. Because that CLI accepts a skill
name rather than a fixture path, the runner creates a private, uncommitted adapter root where:

- `scripts/dispatch-hetero.sh` resolves to the canonical production script with the same digest;
- its required `scripts/` and `src/` support files resolve to the canonical repository bytes;
- `skills/implementer-pack/SKILL.md` resolves to the frozen fixture with the registered digest.

The adapter is an evaluation transport shim, not a production rail or default change. Both
arms traverse it; only `pack` passes `--skill-mode prompt --skill implementer-pack`.

No-spend verification:

```bash
bash evals/skill-transport/test/implementer-matrix-mechanics.test.sh

# Validate the production eight-task bindings, base-red controls, and adapter without a model call.
bash evals/skill-transport/run-implementer-matrix.sh \
  --seed 20260802 \
  --out /tmp/implementer-validation.jsonl \
  --seed-file /tmp/implementer-validation.seed \
  --private-root /tmp/implementer-validation-private \
  --validate-only
```

Live execution is resumable by the exact key `<engine>|<arm>|<task>`. The seed file and result
ledger must be reused unchanged. Existing `completed`, `infra_failed`, and `invalid` keys are
terminal and are never silently rerolled. A one-cell first traversal uses `--limit 1`; omitting
that flag runs every remaining scheduled cell.

Outcome authority is deliberately separate from the implementer. The runner executes the
digest-bound source oracle in a detached candidate worktree and sends only the candidate diff
plus frozen task specification to one reviewer tuple selected before cell one. Raw provider,
oracle, and review logs remain under the private run root; committed JSONL stores only bounded
metadata and normalized defect fingerprints.

Fold a complete ledger with:

```bash
node evals/skill-transport/implementer-report.js \
  --in evals/skill-transport/results/implementer-matrix.jsonl
```

The report mechanically applies the pre-registered H1 rules. It exits zero only when the
ledger is structurally complete and internally consistent; capability failures may still yield
the explicit decision `no_capability_verdict`.
