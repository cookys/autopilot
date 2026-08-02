# Acceptance rubric — hook test harness determinism

This rubric is content-bound to the frozen execution plan by the Mission source manifest.
Every item is required; suggestions do not silently expand scope.

## R1 Reproduced base failures

The project record preserves both unchanged-base witnesses: three semantic-green but
wall-clock-red quiescence assertions under current host load, and a held-open-stdin
session-start run that times out before its assertions. The fix is evaluated against those
exact failure modes.

## R2 Semantic quiescence measurement

The quiescence test no longer treats raw dispatcher wall seconds as sole authority for the
three load-sensitive promptness claims. It traverses the real dispatch path and measures
logical poll/grace behavior directly or against a same-run control. Raising fixed seconds
or relying on `AUTOPILOT_TEST_TIMING_FACTOR>1` for the focused test does not satisfy this
item.

## R3 Discriminating timing control

A planted over-budget or delayed-quiescence control fails under the revised oracle while
the intended genuine-empty, immediate-content, and large-output cases pass. The control
uses the same assertion mechanism, proving the replacement is not vacuous.

## R4 Existing classifications preserved

Late flush remains authored and contains its late answer; genuine empty remains
`empty_output`; immediate and multi-KB output remain authored; drip-writer execution stays
deadline-bounded; runner timeout remains `runner_failed`. Existing lower bounds and raw-log
checks remain meaningful.

## R5 Explicit stdin EOF with negative control

The no-plugin-root direct Node invocation receives explicit EOF. A bounded regression run
with parent stdin deliberately held open exits normally, is not killed by timeout, and
still asserts the expected `additional_context` payload.

## R6 Production boundary untouched

No production hook, dispatcher, quiescence library, manifest, version mirror, dependency,
or release surface changes. Any need to cross that boundary stops this mission rather than
being assumed.

## R7 Focused and repository gates green

Both focused tests pass with timing factor 1 under the observed saturated host. The full
hook suite passes with `AUTOPILOT_TEST_TIMING_FACTOR=3`; `scripts/validate.sh`,
`sync-version.js --check`, `check-hook-inventory.js --check`, and `scripts/sync-all.sh
--check` pass without exclusions attributable to this diff.

## R8 Honest lifecycle closure

Independent depth-0 full-diff review finds no unresolved Critical or Major issue. The
project tracker and index cite concrete evidence, and only the exact triggered backlog
entry is removed. Work is locally merged to `develop`; no push, release, PR, or publication
occurs.
