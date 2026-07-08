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

Batch completed clean: 15/15 runs finished all 5 turns (harness stable, no auth-loss, no
run errors). Depth-0-owned collection (per-run auth-liveness circuit breaker + resume-skip).

| Arm | constraints-held | features-built (fidelity) | oracle_pass | n |
|-----|------------------|---------------------------|-------------|---|
| re-inject ON (arm=off + `--reinject`) | 3/15 (20.0%) | 7/15 | 0/15 | 15 |
| OFF baseline (archive, arm=off, no reinject) | 1/18 (5.6%) | 10/18 | 0/18 | 18 |
| _prior: prose-pack ON (archive DATA B)_ | _3/17 (17.6%)_ | _7/17_ | _0/17_ | _17_ |

**constraints-held ON vs OFF: one-tailed Fisher exact p = 0.234 — NOT significant.**

### Honest conclusion

1. **The instrument works.** 15/15 runs completed the full 5-turn horizon with the
   `CONSTRAINTS REMINDER` block mechanically prepended every turn; the collection rail
   (auth breaker + resume-skip) held. `--reinject` is a real, reusable long-horizon knob.
2. **Per-turn re-injection did NOT beat prose at n=15.** 3/15 (20.0%) constraints-held vs
   the baseline 1/18 (5.6%) is directionally higher but **not significant** (p=0.234) — and
   lands essentially on top of the archive's prose-pack arm (3/17, 17.6%, p=0.279). Restating
   the constraints verbatim every single turn was statistically indistinguishable from
   stating them once. This holds the series' consistent result: **the lever moves vocabulary,
   not behavior.**
3. **The drift is deeper than recency.** If long-horizon constraint loss were a "the model
   stopped seeing the rules" problem, mechanical every-turn re-injection should have rescued
   it. It didn't. At haiku tier the failure is the model not *honoring* constraints it is
   currently looking at, not forgetting they exist — so the fix space is model capability
   (or hard verification/gating), not prompt refresh.
4. **n=15 is directional, not conclusive** (series rule: sub-30 samples are hints). p=0.234
   neither confirms nor refutes a small real effect; a decisive read needs n≥30 per arm. But
   the *tie with the prose pack* is the load-bearing observation, and that is robust to n:
   two different delivery mechanisms for the same constraint text produced the same ~18-20%.

### Follow-up (BACKLOG candidate)
Per-turn mechanical **verification/gating** (reject a turn whose output violates a
constraint, force a retry) is the untested lever left — distinct from re-injection, which
this measurement shows is not the answer. Re-injection is now available as a harness knob if
a larger-n or different-tier study wants it.

## Provenance

- Branch: `worktree-agent-a99587d3c46e5f721`; base `3bdfce4` (v2.32.9); impl commit
  `841c226` (`l6-t14-reinject-impl`, gpt-5.3-codex-spark via `engine implement-review`,
  cgroup-contained, verify-first pass, convergence_reason=verification).
- Raw per-run results: `reinject-results.jsonl` (this dir, 15 lines).
- Measurement collected at depth-0 (2026-07-09) after the /l6 foreman hit a model quota
  limit mid-batch; instrument work was recovered from the committed branch artifact and the
  batch re-driven by a resumable depth-0 harness.
