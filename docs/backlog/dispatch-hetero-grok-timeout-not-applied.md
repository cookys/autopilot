# `dispatch-hetero.sh --timeout` is accepted, recorded, and never applied to the grok rail

Found 2026-09-22 on cuda, while a foreman was planning around a deadline that does not
exist.

## The defect

`--timeout` is parsed, validated against the contract's `budget.wall_seconds`, assigned a
`TIMEOUT_SOURCE`, and emitted into the run manifest as `timeout_seconds` (`:911-913`). It
reaches the worker on some rails and not on others:

    agy  (:3468)  _ "$WT" "$AGY_BIN" "…" "$MODEL" "$TIMEOUT" \        <- passed
    grok (:3319)  _ "$WT" "$GROK_BIN" "$GROK_PROMPT_FILE" "$MODEL" \
                    "$(grok_effort_clamp "$EFFORT")" "$RESUME_SESSION_ID"   <- absent
    grok (:3324)  same shape, `--session-id` variant                        <- absent

`run_worker` adds none of its own: it selects containment (cgroup / setsid / plain) and
then `wait`s for the child to exit on its own.

Observed: a `--timeout 20m` grok dispatch alive at 22m39s, both wrapper and child, with
no deadline event pending.

## Why it matters more than it looks

1. **An unbounded run has no upper bound at all.** Nothing stops a grok dispatch except
   the engine finishing or a human killing it.
2. **Callers plan around the number.** A foreman that reads `--timeout 20m` as a bound
   waits for an event that will never fire; the run reads as "still working" forever.
3. **The manifest states a bound that was never enforced.** `timeout_seconds` in the run
   record is a claim, not a fact — the exact shape ADR-0001 exists to prevent.
4. **grok is the subscription rail**, so it is the one most likely to be dispatched in
   volume. This is the rail where a missing bound costs the most.

## Fix

Pass `$TIMEOUT` through both grok `run_worker` invocations the way the agy branch does,
and audit every other runner branch for the same omission rather than fixing only grok —
the defect is "some branches forward it", so the question is which others do not.

A test should pin it mechanically: dispatch with a short `--timeout` against a stub
runner that sleeps past it, and assert the run is terminated and the result says
`timeout`. Asserting only that the flag parses is what let this survive.

## Do NOT

Do not "fix" it by shortening the default. The default (`9m`) is not the problem; the
problem is that no value is enforced on this rail.
