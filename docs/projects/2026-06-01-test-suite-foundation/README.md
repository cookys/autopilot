# Test Suite Foundation

**Status**: 🟡 In progress — started 2026-06-01
**Branch**: `feat/test-suite-foundation`
**Source plan**: [`docs/plans/2026-05-14-test-suite.md`](../../plans/2026-05-14-test-suite.md) (2026-05-14, refreshed below)
**Backlog entry**: "Test suite for autopilot — automated coverage for hooks / scripts" (L ~12hr)
**Size**: L (multi-phase, full P1–P6 per user direction)

---

## Plan refresh (2026-06-01 vs 2026-05-14 baseline)

The source plan was authored on 2026-05-14. Since then the surface area has changed materially:

| What changed | Impact on test scope |
|---|---|
| **v2.7.4 disable batch**: only 3 Node hooks remain wired in `hooks.json` (intent-capture, reload-watch, state-checkpoint); 9 disabled-by-stdin-pipe-bug | P5 "60 tests across 17 hooks" is mostly low value — disabled hooks aren't wired. Tested as fail-open scripts only. |
| **New scripts shipped**: `sync-agent-bodies.sh`, `preflight-portability.sh`, `preflight-release.sh`, `setup-symlinks.{sh,ps1}`, `install-antigravity.{sh,ps1}`, `install-hooks.sh` | These already do **integration-style verification** (preflight-portability is effectively 12 black-box checks). Test suite focuses on the foundation layer; preflights remain the user-facing acceptance gate. |
| **`sync-version.js` got `--check`** | Already self-verifies on each commit via pre-commit gate; integration tests exercise the underlying invariants. |
| **`.opencode/plugins/autopilot.ts` (v2.7.3+v2.7.4)** | Added to P5 baseline since it's a runtime entry-point too. |
| **node v24.15.0 available** | `node:test` (Node 18+) confirmed usable — no `package.json`/jest/vitest dependency. |

User scope decision (2026-06-01): **full P1–P6 + lib-refactor + CI** ("處理好" + selected "全部 P1-P6"). Honoring directive even though CEO recommendation was the smaller L2-black-box first increment.

---

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| P1 | Harness: `hooks/tests/{run.sh, fixtures/, README.md}` + first proof test | ⬜ |
| P2 | `state-checkpoint.js` — lib-refactor + L1 unit tests + L2 12 R10 scenarios | ⬜ |
| P3 | `intent-capture.js` — lib-refactor + L1 unit tests + L2 6 scenarios | ⬜ |
| P4 | `sync-version.js` — 6 scenarios (incl. `--check` drift) | ⬜ |
| P5 | `reload-watch` + 9 disabled hooks (happy-path + fail-open) + bash hooks | ⬜ |
| P6 | CI: `.github/workflows/test.yml` running `node --test` + `hooks/tests/run.sh` | ⬜ |
| Glue | `quality-gate-config.md` Test Command update + reviewer prompt addition | ⬜ |
| Finish | Review → fix findings → bump 2.7.5 → CHANGELOG/INDEX/preflights → merge | ⬜ |

---

## Risks (from source plan, still active)

| # | Risk | Mitigation in this run |
|---|---|---|
| R1 | Lib-refactor breaks hook behavior | Each lib-extract commit: smoke-test before (current behavior baseline) + smoke-test after (same output). No behavioral change in the same commit as the refactor. |
| R2 | Test fixtures brittle to transcript schema drift | Fixtures are minimal-valid JSONL; CRLF/nested/UTF-8 edges as separate small files. |
| R3 | Bash harness portability (macOS/Linux) | Portable `stat`/`date`; if blocked, swap to Node-based runner. |
| R4 | CI false-positives disrupt PR flow | Workflow gated to feature branches + main; failures non-blocking initially (`continue-on-error: false` only after 1 week stable). |
| R5 | 60+ tests maintenance burden | Each hook ≥1 fail-open assertion is mandatory; deeper coverage only for the 3 active + sync-version. |
| R6 | Test suite duplicates review-as-test | Tests catch syntactic/local bugs (cheap); reviewer catches architectural drift (complementary). L-5.2 reviewer stays. |

---

## Acceptance (carried from source plan §5, adjusted)

1. ⬜ `hooks/tests/run.sh` umbrella runs all integration tests; per-hook pass/fail summary
2. ⬜ `state-checkpoint.js` 12 R10 scenarios codified; harness reports 12/12 pass
3. ⬜ `intent-capture.js` 6 + `sync-version.js` 6 scenarios codified and green
4. ⬜ Lib-refactor: `state-checkpoint-lib.js` + `intent-capture-lib.js` exportable; main scripts thin wrappers; pre/post smoke parity
5. ⬜ `node --test hooks/*.test.js` runs L1 unit suite green
6. ⬜ `hooks/tests/README.md` documents framework + add-a-test procedure
7. ⬜ `.github/workflows/test.yml` runs on push/PR (P6)
8. ⬜ `.claude/quality-gate-config.md` Test Command: N/A → `bash hooks/tests/run.sh`
9. ⬜ Reviewer prompt template adds "run hooks/tests/run.sh as pre-merge gate" step

---

## Out of scope (carried forward)

- Skill description routing tests — router-judge plan (T11) covers
- Agent (reviewer/debugger/planner) output-contract tests — LLM dispatch cost; deferred
- Production load / performance benchmarking — autopilot is dev tool
