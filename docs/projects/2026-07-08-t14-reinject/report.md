# t14 per-turn constraint re-injection — instrument + first measurement

**Date**: 2026-07-08 · **Version**: v2.32.10 · **Run**: /l6 (depth-1 foreman) · **Size**: S

Follows up the 2026-07-06 eval-instruments series
([report](../_archive/2026-07-06-eval-instruments/report.md) DATA B, L194-221), which
defined "mechanical per-turn constraint re-injection" as the next instrument after prose
asset packs failed to hold long-horizon constraints (t14 n=35: constraints-held ON 3/17
vs OFF 1/18, one-tailed Fisher p=0.279, **not significant**).

## Deliverable A — the instrument (shipped code)

`evals/orchestration/run-orchestration-eval.sh` gains an opt-in `--reinject <relpath>`
flag. When set on a `turns/` task, the harness mechanically prepends a
`CONSTRAINTS REMINDER` block — the **verbatim** content of the task's frozen
`repo/<relpath>` — to **every** composed turn prompt (turn 1..N), for both the `cc` and
`stub` runners. This replaces "turn 1 stated the rules once, hope they survive to turn 5"
with "the rules are restated every turn."

Design invariants:
- `<relpath>` resolves against the FROZEN source repo (`$TASK_DIR/repo/<relpath>`), never
  the mutable per-run copy — the reminder is always the original constraint text.
- **Byte-identical when off**: with `--reinject` omitted, all behavior and output are
  byte-for-byte identical to before (both single-prompt and multi-turn). Implemented via
  a no-op `emit_reinject_block` and an empty result.json JSON fragment.
- `--reinject` on a single-prompt (no `turns/`) task errors `exit 2`.
- Multi-turn `result.json` gains `"reinject":"<relpath>"` ONLY when the flag is set.
- Unit test: `hooks/tests/orchestration-eval-reinject.test.sh`.

### Verification (independent signals, artifact-not-self-report)

1. **Implementer's unit test** (openai gpt-5.3-codex-spark authored): green.
2. **Existing suite** `hooks/tests/orchestration-eval.test.sh`: green (regression guard).
3. **Depth-0 byte-diff probe**: off-mode on the new harness vs the base-commit harness
   (3bdfce4) for t14 — `turn_01.md`, `turn_02.md`, and `result.json` (duration/version
   normalized) **byte-identical**.
4. **Decorrelated cross-family review** (glm-4.6 via cc-shim, zhipu ≠ openai implementer):
   **SHIP-AS-IS, no findings**.
5. **Independent verification authoring** (MiniMax-M3, minimax family): authored a
   from-scratch 3-check probe; after depth-0 fixed three glue defects in the *authored
   script* (direct non-exec harness invocation, wrong `--output-dir` flag, missing
   `--task`), its assertion logic passed all 3 checks.

## Deliverable B — first real measurement

**Design**: isolate the re-injection variable against the archive's weakest baseline.
- **ON arm (new)**: `--arm off --reinject CONSTRAINTS.md`, t14-constraint-horizon, haiku,
  5-turn, `cc` runner.
- **OFF baseline (reused, not re-run)**: archive DATA B `--arm off` (PADDING pack, no
  reinject), n=18, constraints-held **1/18**. Same harness, same task, same model tier.
- The ONLY difference between the two groups is the presence of `--reinject`.

**Metric**: constraints-held = oracle `decoy_respected=true` (all 3 CONSTRAINTS.md
invariants — TSV-only, UTC ISO-8601, exit-code-3-reserved — survive to the final state).

**Rails carried from the 2026-07-06 lessons**: per-run auth-liveness circuit breaker
(haiku `AUTH_OK` probe before every run), resume-skip-existing, same oracle both arms.

### Results

_PENDING — measurement batch in progress; table + Fisher p + honest conclusion filled on
completion._

| Arm | constraints-held | features-built (fidelity) | oracle_pass | n |
|-----|------------------|---------------------------|-------------|---|
| re-inject ON (arm=off + `--reinject`) | TBD | TBD | TBD | TBD |
| OFF baseline (archive, arm=off, no reinject) | 1/18 | 10/18 | 0/18 | 18 |

### Honest conclusion

_PENDING._

## Provenance

- Branch: `worktree-agent-a99587d3c46e5f721`; base `3bdfce4` (v2.32.9); impl commit
  `841c226` (`l6-t14-reinject-impl`, gpt-5.3-codex-spark via `engine implement-review`,
  cgroup-contained, verify-first pass, convergence_reason=verification).
- Raw per-run results: `reinject-results.jsonl` (this dir, added on completion).
