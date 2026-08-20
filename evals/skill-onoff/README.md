# skill-onoff — depth-0 skill presence/content instrument

Measures whether a skill's body, loaded as a REAL plugin skill at depth 0 (`--plugin-dir`
routing + loading — NOT prompt injection), changes orchestrator behavior on micro-tasks with
deterministic markers. Built for the dev-flow contract-card rewrite (成績單前置 evidence);
pre-registered rules and claim scoping live in
`docs/plans/2026-08-18-dev-flow-contract-card.md` §3-§4 (FROZEN R2).

## Arms

| Arm | `skills/dev-flow/` in the synthetic plugin |
|---|---|
| `full` | frozen byte-copy of the 713-line SKILL.md + its references tree |
| `card` | frozen 499-line contract-card draft + the card's references tree |
| `off`  | absent (companion catalog still present — controls for "any skills exist") |

Companion roster (finish-flow / quality-pipeline / learn) is byte-identical across arms
(test-asserted). Prompts are byte-identical across arms and carry NO artifacts contract — the
old orchestration-harness ON-arm confound is removed by construction. All packs are
digest-frozen in `packs/manifest.json`; a mismatch is a fatal harness error. Any card edit
invalidates CARD-arm rows (re-run per the frozen rules).

Since the 2026-08-18 P7 quality-gate fix, `packs/dev-flow-full/` is a **historical** freeze of the
body that was measured — it no longer matches the live `skills/dev-flow/SKILL.md`, and must not be
re-synced. The next campaign re-freezes all three arms from scratch.

## Run

```bash
# one cell
bash evals/skill-onoff/run-skill-onoff-eval.sh \
  --task d3-fix-known-bug --arm full --model sonnet --out /tmp/cell
# campaign (resume-by-cell: re-run the same command after interruption)
bash evals/skill-onoff/run-skill-onoff-matrix.sh \
  --model sonnet --reps 3 --results results/primary-sonnet.jsonl
# score (mechanical verdict per the frozen V1/V2/V3 rules)
node evals/skill-onoff/score-onoff.js --results results/primary-sonnet.jsonl
```

Spend-free regression: `hooks/tests/skill-onoff-{eval,markers,score}.test.sh` (stub runner via
`ONOFF_STUB_BIN`; planted red cases — the vacuous FULL==OFF fixture can never reach
SHIP-GATE-MET).

## Honesty rails

- **V2 sensitivity gate**: a family where FULL≈OFF is demoted (not counted); if <4 of 5
  families are load-bearing the whole instrument is INSTRUMENT-INVALID — no card verdict is
  recorded from a vacuous instrument (references/evidence-discipline.md "The one question").
- **work_done conjunction**: every marker is ANDed with a task-owned work-completion predicate,
  so a no-op run scores false everywhere (a marker that passes on no-op measures nothing).
- **Paired exclusion**: a cell missing after 3 infra attempts drops that (task,rep) from ALL
  arms; ≥2 lost pairs in a family invalidates the block. Mixed models / runner-version drift
  invalidate the block.
- **Claim scoping**: single-turn, sonnet-class depth-0, five marker families. NOT measured:
  multi-turn scope-creep, Mission Routing Override, forcing-function TaskCreates (headless `-p`
  has no TaskCreate tool — Phase-0 probe evidence in the plan's evidence dir; those blocks are
  KEEP-verbatim pinned so FULL/CARD are byte-identical on them).
