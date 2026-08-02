# Hook test harness determinism

> Status: IN PROGRESS — frozen and awaiting L4 foreman implementation
> Owner: depth-0 CEO + one worktree-isolated foreman
> Plan: [`docs/plans/2026-08-02-hook-test-harness-determinism.md`](../../plans/2026-08-02-hook-test-harness-determinism.md)

## Goal

Close the triggered output-quiescence flake and the newly reproduced session-start stdin
hang as one test-harness determinism batch, without touching production behavior.

## Deliverable

| Mission node | State | Evidence |
|--------------|-------|----------|
| `hook-test-harness-determinism` | frozen | Base quiescence test failed 3 semantic-green wall bounds; held-open stdin timed out after 3 seconds |

## Acceptance status

| Rubric | State |
|--------|-------|
| R1 Base failures | satisfied at freeze |
| R2–R7 Implementation and gates | pending |
| R8 Independent review and closure | pending |

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
