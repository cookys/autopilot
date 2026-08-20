# Hook test harness determinism

> Status: COMPLETE — authoritative depth-0 QC passed and locally integrated
> Owner: depth-0 CEO + one worktree-isolated foreman
> Plan: [`docs/plans/2026-08-02-hook-test-harness-determinism.md`](../../plans/2026-08-02-hook-test-harness-determinism.md)

## Goal

Close the triggered output-quiescence flake and the newly reproduced session-start stdin
hang as one test-harness determinism batch, without touching production behavior.

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `hook-test-harness-determinism` | complete | Factor-1 focused tests passed (`22` quiescence and `18` session-start assertions); timing-factor-3 hook suite passed all `260` test files |

## Acceptance status

| Rubric | State |
|--------|-------|
| R1 Base failures | satisfied: unchanged base reproduced `9>5`, `10>5`, `9>6` and held-open stdin exit `124` |
| R2–R5 Deterministic harness behavior | satisfied: logical poll instrumentation plus `8>4` planted rejection; explicit EOF/FIFO regression exit `0` |
| R6 Production boundary | satisfied: only test and tracking paths changed |
| R7 Focused and repository gates | satisfied: focused tests and `260`-file suite green |
| R8 Lifecycle closure | satisfied: exact backlog trigger removed; `HTHD-001` repaired; three parser-valid final-QC seats returned `SHIP-AS-IS`; locally integrated to `develop` with no push |

## Fixed scope

- Test-only changes under `hooks/tests/` plus exact backlog/project tracking.
- One bundled implementation and first-pass review; depth-0 performs the sole authoritative
  final gate.
- No production hook/dispatcher changes, release, push, PR, or publication.

## Execution ledger

| Date | Event | Result |
|------|-------|--------|
| 2026-08-02 | Backlog trigger | `dispatch-output-quiescence.test.sh` red during finish flow; base reproduced the same three drifting upper bounds |
| 2026-08-02 | Adjacent harness reproduction | `session-start.test.sh` with held-open stdin exited 124 at the 3-second guard |
| 2026-08-02 | Plan/rubric freeze | One grouped L4 mission; no feature worktree or implementation effect yet |
| 2026-08-02 | Base reproduction | At load average ~49, semantic classifications stayed green while wall ceilings failed at `9/10/9` seconds; held-open stdin timed out `124` before assertions |
| 2026-08-02 | Deterministic repair | Test-scoped `sleep 0.25` observation measured the production helper's logical clock; normal paths used 4 polls and the planted delayed-stability path used 8 and was rejected |
| 2026-08-02 | Bundle verification | Factor-1 focused tests passed (`22` and `18` assertions); `AUTOPILOT_TEST_TIMING_FACTOR=3 bash hooks/tests/run.sh` passed all `260` test files |
| 2026-08-02 | First-pass review | `repair_blind_verifier` passed R1–R7 and found only `HTHD-001`: candidate/completed lifecycle wording disagreed. The wording was made consistently terminal while retaining depth-0 integration ownership. |
| 2026-08-02 | Authoritative final QC | GPT-5.5/Codex, Gemini 3.6 Flash (High)/agy, and Claude Sonnet 4.6/agy independently reviewed the complete candidate diff; all returned parser-valid `SHIP-AS-IS` with no findings. Opus and Fable were unavailable and were not counted. |
| 2026-08-02 | Depth-0 verification and integration | Focused tests passed again (`22` and `18` assertions); validation, sync, manifest, inventory, scope, and diff gates were green; locally merged to `develop` without push, release, PR, or publication. |
