# `/l5` and `/l6` Engine Integration

## Project Goal

> **Final goal**: Complete Phase 7 of `docs/plans/2026-07-01-cross-harness-engine-infrastructure.md` by moving `/l5` and `/l6` implementation/review orchestration onto the `AutopilotEngine` API and engine CLI.
> **Success criteria**:
> 1. `AutopilotEngine` can run a DI-tested implementer -> review -> repair loop with ledger rows for every dispatched unit; verified by `bash hooks/tests/autopilot-engine.test.sh`.
> 2. The CLI exposes the same path without direct shell orchestration from the skills; verified by `bash hooks/tests/autopilot-cli.test.sh`.
> 3. `/l5` and `/l6` skill docs name the engine CLI as the canonical path and keep direct shell scripts as compatibility fallback; verified by deterministic grep/review.
> 4. Existing resolver/reviewer boundaries still pass; verified by `bash hooks/tests/review-loop-runner.test.sh` and `bash hooks/tests/review-runner.test.sh`.
> 5. Version metadata is synced to `2.28.2`; verified by `node scripts/sync-version.js --check`.
> **Scope boundary**: Include Phase 7 engine API/CLI/docs/tests/version tracking only. Exclude new runner support, new sandbox/isolation models, parallel `/l5` hetero fan-out, and changing reviewer policy semantics.

## L-1.5 Scope Completeness Audit

| Dimension | Coverage |
| --- | --- |
| Source code + tests | Yes: `src/engine`, `src/runners`, `bin/autopilot.js`, focused shell tests. |
| User-facing docs | Yes: `/l5` and `/l6` skill docs, project tracking, changelog. |
| API / interface reference | Yes: exported `AutopilotEngine` methods and CLI command documented in skill docs. |
| Config templates / examples | No config shape change; roster still comes from existing `review-loop-config.md`. |
| CHANGELOG entry | Yes, release-worthy engine/skill behavior change. |
| Version bump | Yes, target `2.28.2`; sync via canonical script. |
| Version sync verification | Required before commit: grep/sync-version check after bump. |
| Migration guide / notes | Not required; shell scripts remain as fallback compatibility path. |
| Dependent repos / external consumers | No breaking change; existing shell contracts preserved. |
| Credit / attribution | Not applicable; no external design absorbed. |
| Dogfood target | Yes: implementation runs under `/l5` and final review uses `/l5` loop review. |

## L-1.6 Skill Routing

| Surface | Required skill | Result |
| --- | --- | --- |
| CEO `/l5` execution | `autopilot:l5`, `autopilot:ceo-agent` | Roster must be resolved from `scripts/resolve-review-loop.sh`; implementer uses immutable base SHA; final review loops to `SHIP-AS-IS`. |
| Code-touch workflow | `autopilot:dev-flow` | L-size project tracking, session SHA, scope audit, quality/finish-flow gates required. |
| L-size parallelization | `autopilot:team` | No extra collaborative team: implementation/review are sequentially coupled; `/l5` hetero implementer is the single delegation path. |
| Completion | `autopilot:finish-flow` | Mandatory at L-5 after implementation/review converge. |

## Phases

| Phase | Status | Verification |
| --- | --- | --- |
| P0 setup | Complete | Branch from updated `develop`, README + INDEX + tree init; committed `bd65508`. |
| P1 engine implementation | Complete | `/l5` hetero implementer commit `4a2d40e`; depth-0 hardening commit `232b2d1`; Codex payload support commit `0117f89`. |
| P2 docs/version | Complete | `/l5`/`/l6` skill docs, CHANGELOG, version mirrors, and Codex generated payload synced to `2.28.2`. |
| P3 quality + `/l5` loop review | In progress | Focused tests and deterministic gates passed; full suite has 4 pre-existing failures; `/l5` loop review pending. |
| P4 finish-flow | Pending | Final review, merge to `develop`, post-merge verification, archive, branch cleanup. |

## Decision Log

- 2026-07-02: Merged `origin/develop` into local `develop` before branching because local develop was `ahead 15, behind 1`; Phase 7 branch starts from `8178cc71888568ae95d5ad5075acd07ac4237e54`.
- 2026-07-02: Scope held to Phase 7 acceptance; no new runners, no policy semantic changes, no parallel hetero fan-out.
- 2026-07-02: First `/l5` dispatch failed because a relative prompt file was not visible after `dispatch-hetero.sh` changed into the isolated worktree. Retried with an absolute prompt path and then hardened `buildImplementationArgs()` to absolutize prompt paths.
- 2026-07-02: Focused verification passed: `autopilot-engine` 124 assertions, `autopilot-cli` 31, `review-loop-runner` 35, `review-runner` 19, `resolve-review-loop` 93, skill validation, version sync, hook inventory, canonical invariants, preflight release, completeness scan, and test-integrity L0.
- 2026-07-02: Full `bash hooks/tests/run.sh` result after fixing Codex payload drift: 78/82 files passed. The 4 failing files (`check-optin-changelog`, `check-test-integrity-l1`, `check-test-integrity`, `dispatch-hetero`) were all classified with `scripts/verify-preexisting.sh` as `head=fail, base=fail, verdict=PRE_EXISTING` against session start SHA `8178cc71888568ae95d5ad5075acd07ac4237e54`.
