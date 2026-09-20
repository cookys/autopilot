# Correctness Gates

> **Status**: Product complete · archived with lifecycle evidence debt tracked in BACKLOG · **Size**: L · **Entry**: L6 · **Branch**: `develop`
> **Started**: 2026-07-31 · **Plan**:
> [correctness-gates](../../../plans/2026-07-31-correctness-gates.md)

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
| `correctness-gates` | complete | none | A2 + A5 + A1; six named suites and aggregate qualification green |

Only this row is executable. P1–P4 are coverage and gates inside it.

## Source phase ledger

| Phase | Status | Detail |
|---|---|---|
| P1 — current-version prose | complete | [phase-1](phase-1-current-version-prose.md) |
| P2 — worktree red-green | complete | [phase-2](phase-2-worktree-red-green.md) |
| P3 — binary path risk | complete | [phase-3](phase-3-binary-path-risk.md) |
| P4 — added-lines secret scan | complete | [phase-4](phase-4-added-lines-secret-scan.md) |
| Product qualification | complete | 259/259 merged-head test files; artifact-only Google/OpenAI/Anthropic terminal panel |
| Lifecycle closeout | deferred | Historical campaign lacks canonical task-status input and an exact controller Work Order; `can_close` is not asserted, no receipt is forged, and migration/reconciliation is tracked in BACKLOG |

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
| CEO uses L6 and a sub-orchestrator | Mission attempt-3 claim plus persistent Codex implementer transcript |
| dev-flow progression | Mission admission, four phase commits, aggregate L-5 gates |
| Easy merge | Disjoint ownership, initial merge `9f26e082`, repair chain through `6aea50fa`, and upstream integration `0941e277` |

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
owns the authoritative QC verdict. The terminal artifact-only panel produced valid
`SHIP-AS-IS` receipts from Google, OpenAI, and Anthropic with zero blocking findings. OpenAI and
Anthropic reviewed the combined B/C artifact; Google's terminal seat reviewed full B because the
combined artifact exceeded the proven transport argument limit. The final merged head passed all
259 test files in a clean independent clone.

## Progress log

| Date | Event | Evidence |
|---|---|---|
| 2026-07-31 | Project bootstrapped from four triggered backlog entries | plan + rubric + Mission graph |
| 2026-07-31 | P1–P4 implemented as four reviewable commits | `1cab214e` through `4812a7ab` |
| 2026-07-31 | Combined B/C terminal qualification passed | Google/OpenAI/Anthropic `SHIP-AS-IS`; zero blocking findings |
| 2026-07-31 | Initial B/C landing and repair chain completed | merge `9f26e082`; repairs through `6aea50fa` |
| 2026-07-31 | Current upstream integrated and merged head requalified | merge `0941e277`; 259/259 test files |
| 2026-07-31 | Lifecycle close receipt held fail-closed | task-status and exact controller Work Order unavailable; marker retained and migration/reconciliation tracked in BACKLOG |

## Final results

- Release prose justification is scoped to the current canonical version section.
- Repo-owned verification commands execute the matching detached-worktree copy while external
  absolute executables retain their prior identity and exit behavior.
- Binary-only, quoted, space-containing, control-character, and literal top-level `b/` paths
  reach existing risk rules without ambiguous header splitting.
- Commit secret scanning examines added lines only: additions still block with redaction and
  deletion-only cleanup passes.
- The six targeted suites passed (9, 25, 24, 14, 6, and 16 assertions respectively), and the
  merged-head repository aggregate passed all 259 test files.

## Decisions

- One Mission node owns four small phase commits.
- `verify-red-green.sh` gets the tool-side repair; shared `hooks/tests/lib.sh` remains untouched.
- Secret blocking is additions-only; `.gitleaks.toml` policy work remains out of scope.
