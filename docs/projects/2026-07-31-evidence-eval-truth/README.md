# Evidence and Eval Truth

> **Status**: In progress · **Size**: L · **Entry**: L6 · **Branch**: `feat/evidence-eval-truth`
> **Started**: 2026-07-31 · **Plan**:
> [evidence-eval-truth](../../plans/2026-07-31-evidence-eval-truth.md)

## OKR

**Objective**: make evaluation and engine telemetry honest before either can influence roster
decisions.

**Key results**:

- KR1 — every failed orchestration-eval row is classified; unclassified failures are rejected.
- KR2 — infrastructure failures are excluded from capability rates and loudly tallied.
- KR3 — transcript import is aggregate-only, deterministic, idempotent, and non-authoritative.
- KR4 — agy missing usage and OpenCode cohort bias remain explicit.
- KR5 — MiniMax's recorded diff-only limitation cannot be silently omitted from roster use.
- KR6 — the three named regression suites exit 0.

## Project Goal

> **Final goal**: make orchestration evaluation, transcript aggregation, and reviewer calibration
> fail closed against unexplained or overclaimed evidence.
>
> **Success criteria**: all KR1–KR6 are mechanically demonstrated by the commands in the plan.
>
> **Scope boundary**: eval truth, aggregate telemetry, and the MiniMax reviewer caveat only.
> Provider-readiness authority, Owner Kernel P4, raw transcript storage, versioning, release, and
> general roster redesign are excluded.

## Current admitted deliverable

| Mission node | Status | Dependencies | Acceptance |
|---|---|---|---|
| `evidence-eval-truth` | pending | none | A5 + A4 + A1 + A2; three named suites green |

Only this row is executable. The source phases below are coverage and gates inside the node.

## Source phase ledger

| Phase | Status | Detail |
|---|---|---|
| P1 — failure classification | pending | [phase-1](phase-1-failure-classification.md) |
| P2 — transcript aggregation | pending | [phase-2](phase-2-transcript-aggregation.md) |
| P3 — MiniMax calibration | pending | [phase-3](phase-3-minimax-calibration.md) |
| Finish-flow | pending | Authoritative depth-0 QC, integration, archive, cleanup |

## Scope completeness record

| Surface | Included or explicit exclusion |
|---|---|
| Eval runner/scorer | Included |
| Scorecard/resolver/config | Included only for telemetry and warning/demotion behavior |
| Existing hermetic tests | Included |
| Raw local transcript data | Excluded from prompts, commits, and artifacts |
| General docs/version/CHANGELOG | Integration owner only |
| Engine/controller core | Excluded; owned by the active Fable P0 line |
| B/C shared files | None |

## Requirements coverage

| User requirement | Evidence location |
|---|---|
| B backlog becomes a complete project/phase | This README, three phase files, plan, rubric |
| CEO uses L6 and a sub-orchestrator | Run ledger and foreman completion report |
| dev-flow progression | L-1.5/L-1.6/L-5 gates in foreman report |
| Safe parallel merge | Exact file ownership below and combined depth-0 QC |

## File ownership

The B foreman may modify only the exact campaign output paths. It must not touch:

- `docs/BACKLOG.md`, `docs/projects/INDEX.md`, `CHANGELOG.md`, `CLAUDE.md`;
- version manifests or release metadata;
- `src/engine/*`;
- C-line scripts/tests.

## Parallel execution

```text
B evidence-eval-truth ─┐
                       ├─ depth-0 combined QC → ordered integration
C correctness-gates ───┘
```

B and C have no expected file overlap. The active Controller/Fable P0 line owns engine core and
also has no expected overlap with B.

## Acceptance commands

```bash
bash hooks/tests/orchestration-eval.test.sh
bash hooks/tests/engine-scorecard.test.sh
bash hooks/tests/resolve-review-loop.test.sh
```

The foreman's green result is first-pass only. Depth 0 reruns these commands from the committed
candidate and performs the authoritative cross-family QC.

## Progress log

| Date | Event | Evidence |
|---|---|---|
| 2026-07-31 | Project bootstrapped from three triggered backlog entries | plan + rubric + Mission graph |

## Decisions

- One Mission node owns all three phases because scorecard semantics overlap.
- The importer extends `engine-scorecard.js`; no new top-level script or CLAUDE.md inventory row.
- Real transcript dogfood is local aggregate-only and remains a depth-0 trust duty.
