# opencode implementer rail + muse-spark-1.3 administration (v2.35.12)

**Branch**: `feat/v2.35.12-opencode-implementer-rail` · **Plan**: [`docs/plans/2026-09-03-opencode-implementer-rail.md`](../../plans/2026-09-03-opencode-implementer-rail.md) · **Status**: in progress

## Project Goal

> **Final goal**: `dispatch-hetero.sh --runner opencode` is a real implementer rail, and `muse-spark-1.3` (OpenCode Go contributor tier) has an implementer qualification row produced by the live-rail exam over it.
> **Success criteria**: (1) `hooks/tests/dispatch-opencode.test.sh` asserts committed / no_op / failure paths with a stub binary, and the full suite is green; (2) one real `dispatch-hetero.sh --runner opencode --model opencode-go/muse-spark-1.3-contributor` probe returns `committed` + `contained: true`; (3) `engine-scorecard.js seat-status --engine opencode-go/muse-spark-1.3-contributor --runner opencode --role implementer --effort high` returns a row (qualified or failed); (4) preflight-release 8/8 for v2.35.12.
> **Scope boundary**: IN — dispatch-hetero opencode rail + every runner-token registration point on the implementer path, tests, docs, exam. OUT — reviewer/author rails, usage parsing, auto-routing.

## Scope completeness audit (L-1.5)

| Dimension | Coverage |
|---|---|
| Source + tests | P0 rail (dispatch-hetero) + P1 registration (runner-binary, engine-qualify, implementer-ladder, resolve-review-loop) + new test file + enum assertions |
| User-facing docs | hetero-dispatch.md runner table row; multi-agent-portability.md opencode headless facts |
| Config templates | none (runner enum in review-loop-config prose updated via resolve-review-loop error text) |
| CHANGELOG / version | v2.35.12 + sync + grep |
| Migration | none — additive runner |
| Dependent consumers | codex mirror sync |
| Dogfood | P2 real probe + administration |

**User-stated requirements**: 「用 opencode / muse spark 1.3 考看看」→ P0+P1 (rail) + P2 (administration); 「go」→ build the L.

## Skill routing (L-1.6)
No `.claude/skill-routing.md`; dev-flow invoked; areas N/A (CLAUDE.md language table).

## Progress

| Phase | Status | Commit |
|---|---|---|
| P0 opencode rail in dispatch-hetero + stub test | pending | |
| P1 runner registration (runner-binary, engine-qualify, implementer-ladder, resolve-review-loop) + tests | pending | |
| P2 docs, CHANGELOG, version, real probe, administration | pending | |
| L-5 finish-flow | pending | |
