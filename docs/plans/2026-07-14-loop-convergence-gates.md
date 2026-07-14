# Loop-Convergence Gates — hetero review-loop non-convergence防護

**Date**: 2026-07-14
**Status**: In progress (feature/loop-convergence-gates)
**Origin**: 2026-07-14 codex replay-driver incident — a hetero engine's self-directed
review loop ran 8 artifact generations (v1 → v3.4), `tests_executed:false` for the
*entire* run (zero actual execution), `ship_ready:false` monotonic, review verdicts
oscillating FAIL/PASS across generations, generation counter climbing for hours with no
depth-0 clock owner pulling the brake. Real fixtures preserved at
`hooks/tests/fixtures/loop-convergence/accident-replay-driver/` (7 gens, self-contained
copies of `~/.local/state/twgs-security-replay-driver/*/REVIEW_STATUS.json`).

## Methodology

`ironlaw-to-gate`: the "a human should have pulled the brake" rule is downgraded from
"someone remembers to watch" into deterministic machine gates. Gates 1 + 3 are pure
mechanical (决定可判 — counting over an artifact sequence); gate 2 is半机械 (spec-hash
freeze is mechanical, finding→spec mapping is review-only); gates 4 + 5 are brief-template
hard constraints (documentation forcing functions, no code gate possible).

## The 5 gates

### Gate 1 — verification-anchored loop guard 🔴 (mechanical)
A续轮 must be anchored to a red→green change in *executable* verification. Two consecutive
generations with zero execution (`tests_executed:false`) ⇒ the loop is spinning on static
readback, not verification ⇒ **halt + escalate**.
- **Impl**: `scripts/check-loop-convergence.js` — walk artifacts in generation order;
  a run of ≥2 consecutive `tests_executed:false` trips gate 1.
- **落点**: consumed by the depth-0 control loop / `resolve-review-loop` caller as a
  standalone gate (the accident loop was self-directed, NOT `engine implement-review`,
  so the gate must be consumable outside the engine loop).

### Gate 2 — rubric freeze gate (semi-mechanical)
Round 0 seals the acceptance criteria (sha256 of the spec/rubric). A later blocking finding
that maps to nothing in the sealed rubric = scope expansion → escalate, do NOT open a new
round. Mechanical part = spec-hash seal + drift detection; finding→rubric mapping = review-only.
- **Impl**: `scripts/rubric-freeze.js seal|check`.

### Gate 3 — generation cap 🔴 (mechanical)
Artifact version番号 is the round counter. Cap 3 generations; if maxGen ≥ cap and the latest
artifact is still REWORK-shape (`ship_ready!=true` or a verdict field matches FAIL/REJECT/REWORK)
⇒ **halt**.
- **Impl**: same `scripts/check-loop-convergence.js`. Generation parse MUST accept both
  number (`2`) and string (`"3.4"`) forms — the accident fixtures use both.

### Gate 4 — 裸跑禁令 (brief-template hard constraint)
A multi-hour autonomous hetero loop MUST have a named depth-0 clock owner. Written into the
foreman/dispatch brief template (`references/hetero-dispatch.md`).

### Gate 5 — 规模预算 (brief-template hard constraint)
Every dispatch brief carries a LOC / complexity budget; over-budget ⇒ escalate rather than
grind. Written into the dispatch brief template + points at existing `measure-task-width.sh`.

## Gate 1+3 contract (`scripts/check-loop-convergence.js`)

```
node scripts/check-loop-convergence.js --artifacts-dir <dir> [--generation-cap N] [--json] [--enforce]
node scripts/check-loop-convergence.js <file1.json> <file2.json> ...
```

- **Input**: N REVIEW_STATUS.json artifacts (one per generation). `--artifacts-dir` reads
  every `*.json` and orders by parsed `artifact_generation` ascending; explicit file list is
  taken in given order.
- **Generation parse**: number `2` OR string `"3.4"` → `parseFloat`; missing field ⇒ 1.
- **Gate 1 trip**: any run of ≥2 consecutive artifacts (generation order) with
  `tests_executed !== true`.
- **Gate 3 trip**: `maxGeneration >= cap` (default 3) AND latest (highest-gen) artifact is
  REWORK-shape (`ship_ready !== true` OR any `*verdict*` string field ~ `/FAIL|REJECT|REWORK/i`).
- **Output**: JSON `{ verdict:"TRIP"|"PASS", gate1_zero_execution:{...}, gate3_generation_cap:{...}, reasons:[] }`.
- **Exit**: data mode (default) always exit 0 (mirrors `resolve-review-loop`/`resolve-doa`
  siblings — resolver REPORTS); `--enforce` ⇒ exit 3 on TRIP, 0 on PASS; exit 2 = usage error.

### Honest limitations (per ironlaw-to-gate Step 4)
- Catches **HONEST-but-WEAK** loops (worker truthfully reports `tests_executed:false`). A
  worker that LIES (`tests_executed:true` without running) is NOT caught — needs execution
  provenance/oracle, out of scope.
- Generation ordering trusts `artifact_generation` monotonicity; forged/rewritten counters
  not detected.
- REWORK-shape is a field-name heuristic; a converged artifact omitting `ship_ready` with no
  verdict field reads as REWORK (fail-toward-halt — the safe direction).

## Red-case proof (mandatory, gates 1 + 3)
- **Red case**: accident-replay-driver sequence ⇒ gate 1 trips (all 7 gens zero-execution)
  AND gate 3 trips (maxGen 3.4 ≥ cap 3, latest REWORK-shape).
- **Negative control**: `healthy-convergence/` (tests_executed:true, red→green, gen ≤ 3,
  latest ship_ready:true) ⇒ PASS; `boundary-single-zero-exec/` (one non-consecutive
  zero-exec round then green) ⇒ PASS (proves the ≥2-consecutive threshold).

## Rules → gates map
`docs/ironlaw-to-gate-map.md` — the single source of truth table + review-only list.

## Provenance discipline (this branch)
- Implementer: `gpt-5.3-codex-spark` (`--runner codex`) via canonical `engine implement-review`.
- Verification authoring: cross-family (MiniMax-M3 / GLM) via `scripts/dispatch-author.sh`.
- Engine unavailable ⇒ halt + escalate (no silent Claude fallback).
