# Evidence and Eval Truth

> **Status**: Completed · **Size**: L · **Entry**: L6 · **Branch**: `develop`
> **Started**: 2026-07-31 · **Plan**:
> [evidence-eval-truth](../../../plans/2026-07-31-evidence-eval-truth.md)

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
| `evidence-eval-truth` | complete | none | A5 + A4 + A1 + A2; named suites and aggregate qualification green |

Only this row is executable. The source phases below are coverage and gates inside the node.

## Source phase ledger

| Phase | Status | Detail |
|---|---|---|
| P1 — failure classification | complete | [phase-1](phase-1-failure-classification.md) |
| P2 — transcript aggregation | complete | [phase-2](phase-2-transcript-aggregation.md) |
| P3 — MiniMax calibration | complete | [phase-3](phase-3-minimax-calibration.md) |
| Finish-flow | complete | 258/258 tests, independent Gemini review, no-ff integration, archive |

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
| CEO uses L6 and a sub-orchestrator | Mission attempt-3 claim plus persistent Codex implementer transcript |
| dev-flow progression | Mission admission, committed implementation, aggregate L-5 gates |
| Safe parallel merge | Disjoint ownership, merge `9f26e082`, and combined depth-0 QC |

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
candidate and performs the authoritative cross-family QC. Final depth-0 evidence: all 258 test
files passed and Gemini 3.6 Flash High returned `SHIP-AS-IS` with no findings.

## Progress log

| Date | Event | Evidence |
|---|---|---|
| 2026-07-31 | Project bootstrapped from three triggered backlog entries | plan + rubric + Mission graph |
| 2026-07-31 | P1–P3 implemented and repaired on one persistent branch/transcript | `796c5e73`, `1634e1bb` |
| 2026-07-31 | Combined B/C qualification passed | 258/258 test files; Gemini `SHIP-AS-IS` |
| 2026-07-31 | Landed to `develop` and archived | merge `9f26e082` |

## Final results

- Failed eval rows now use the closed `capability_fail|infra_fail` vocabulary; invalid or
  missing classifications are rejected, while infrastructure failures are excluded and tallied.
- Transcript import is explicit-root, aggregate-only, deterministic, idempotent, and remains
  non-authoritative; agy missing usage and OpenCode calibration cohorts stay honest.
- The MiniMax diff-only limitation is emitted as an advisory and is fail-closed for managed
  dogfood rosters without contaminating operational `capability_warnings`.
- Target suites passed at 20/20 and 261/261 assertions; the repaired readiness consumers passed
  at 52/52 and 22/22; the repository aggregate passed all 258 test files.

## Decisions

- One Mission node owns all three phases because scorecard semantics overlap.
- The importer extends `engine-scorecard.js`; no new top-level script or CLAUDE.md inventory row.
- Real transcript dogfood is local aggregate-only and remains a depth-0 trust duty.
