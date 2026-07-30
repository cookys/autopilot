# Correctness Gates

> **Status**: In progress · **Size**: L · **Entry**: L6 · **Branch**: `fix/correctness-gates`
> **Started**: 2026-07-31 · **Plan**:
> [correctness-gates](../../plans/2026-07-31-correctness-gates.md)

## OKR

**Objective**: repair four deterministic false-green/false-positive gates without changing
unrelated interfaces.

**Key results**:

- KR1 — only the current version section can justify >5% prose growth.
- KR2 — repo-owned red-green verification runs from each tested worktree.
- KR3 — truly external absolute verify commands remain compatible.
- KR4 — protected binary paths reach risk classification, including quoted/space paths.
- KR5 — added secrets block; deletion-only removal passes.
- KR6 — all six named regression suites exit 0.

## Project Goal

> **Final goal**: restore the four named gates so each rejects its planted defect and accepts its
> corresponding safe operation.
>
> **Success criteria**: all KR1–KR6 are mechanically demonstrated.
>
> **Scope boundary**: named scripts/hooks/tests only. No shared test substrate, release/version
> work, generalized policy engine, or engine/controller core.

## Current admitted deliverable

| Mission node | Status | Dependencies | Acceptance |
|---|---|---|---|
| `correctness-gates` | pending | none | A2 + A5 + A1; six named suites green |

Only this row is executable. P1–P4 are coverage and gates inside it.

## Source phase ledger

| Phase | Status | Detail |
|---|---|---|
| P1 — current-version prose | pending | [phase-1](phase-1-current-version-prose.md) |
| P2 — worktree red-green | pending | [phase-2](phase-2-worktree-red-green.md) |
| P3 — binary path risk | pending | [phase-3](phase-3-binary-path-risk.md) |
| P4 — added-lines secret scan | pending | [phase-4](phase-4-added-lines-secret-scan.md) |
| Finish-flow | pending | Authoritative depth-0 QC, integration, archive, cleanup |

## Scope completeness record

| Surface | Included or explicit exclusion |
|---|---|
| Four scripts/hooks | Included |
| Six existing tests | Included |
| `hooks/tests/lib.sh` | Explicitly excluded |
| `.gitleaks.toml` policy support | Explicitly excluded |
| General docs/version/CHANGELOG | Integration owner only |
| Engine/controller core | Excluded; owned by active Fable P0 |
| B evidence files | Excluded |

## Requirements coverage

| User requirement | Evidence location |
|---|---|
| C backlog becomes a complete project/phase | This README, four phase files, plan, rubric |
| CEO uses L6 and a sub-orchestrator | Run ledger and foreman completion report |
| dev-flow progression | L-1.5/L-1.6/L-5 gates in foreman report |
| Easy merge | Exact file ownership and no shared tracking-doc edits |

## File ownership

The C foreman may modify only the exact campaign output paths. It must not touch:

- `docs/BACKLOG.md`, `docs/projects/INDEX.md`, `CHANGELOG.md`, `CLAUDE.md`;
- version manifests;
- `hooks/tests/lib.sh`;
- `src/engine/*`;
- B-line files.

## Parallel execution

C runs in parallel with B and the already-running Controller/Fable P0 line. Its file allowlist
overlaps neither. P1–P4 remain sequential commits inside C for reviewability.

## Acceptance commands

```bash
bash hooks/tests/preflight-release-routing.test.sh
bash hooks/tests/verify-red-green.test.sh
bash hooks/tests/classify-diff-risk.test.sh
bash hooks/tests/classify-diff-risk-filename-space.test.sh
bash hooks/tests/secret-scan-diff.test.sh
bash hooks/tests/reenabled-blockers.test.sh
```

The foreman's result is first-pass only. Depth 0 reruns every command from the candidate commit and
owns the authoritative QC verdict.

## Progress log

| Date | Event | Evidence |
|---|---|---|
| 2026-07-31 | Project bootstrapped from four triggered backlog entries | plan + rubric + Mission graph |

## Decisions

- One Mission node owns four small phase commits.
- `verify-red-green.sh` gets the tool-side repair; shared `hooks/tests/lib.sh` remains untouched.
- Secret blocking is additions-only; `.gitleaks.toml` policy work remains out of scope.
