# A hook suite writes into the operator's real `~/.autopilot/engine-capability/capability.jsonl` during `run.sh`

## RESOLVED (verdict: test pollution NOT reproduced) — 2026-09-28

A 2026-09-28 tripwire experiment ran the WHOLE suite twice (`--parallel 8` and `--parallel 1`) from an
instrumented throwaway clone that logged, and would have refused, any write resolving to the real
default store. **Zero hits** across both full runs. The 2026-09-26 row (cc-shim / MiniMax-M3,
`"Passive capture from review dispatch failure"`) that this backlog row was opened against was
therefore most likely a **genuine passive capture from a real MiniMax dispatch running on this host at
the time**, not test suite pollution — the timing coincided with a live `run.sh` invocation, but the
write did not originate from any test process.

The v2.36.98 landing foreman deleted that row by hand to restore the operator's store to its pre-run
state, on the working assumption that it was pollution. With this verdict, that was most likely a
**genuine, valid capability observation that was lost** — it was not test-caused, so removing it
discarded real signal. It re-accrues naturally on the next real dispatch that hits the same condition,
so no backfill is needed.

Because the underlying mechanism (tests resolving to the real default store) was never proven to fire,
but is real hazard surface regardless of what caused the 2026-09-26 row, the permanent fix is a
**detector, not a reproduction of the incident**: `AUTOPILOT_TEST_RUN_GUARD` (`hooks/tests/run.sh` +
`scripts/engine-capability-state.js`, shipped this release) makes any WRITE subcommand refuse to touch
the real `~/.autopilot/engine-capability/` store whenever it would resolve there via the
no-`--store`/no-env-var default fallback during a test run, with a stderr line naming the resolved
path, the operation, and the parent command. This closes the hazard going forward whether or not the
2026-09-26 row was ever really pollution.


Observed 2026-09-26 during the v2.36.98 (hook advisories) landing, round-2 full suite rerun
(`bash hooks/tests/run.sh --parallel 8`, `$H/run-land/REPORT.md`, grep `POLLUTION`):

> plus one **REAL-STORE POLLUTION** guard trip: the run appended one entry to the operator's real
> `~/.autopilot/engine-capability/capability.jsonl` (`"evidence":"Passive capture from review dispatch
> failure"`, runner `cc-shim`/model `MiniMax-M3` — unrelated to any hook this plan touches, and not
> reproduced in the first round's run). I removed that one appended line to restore the operator's
> store to its pre-run state.

## What's confirmed
- One row landed in the real (non-sandboxed) `~/.autopilot/engine-capability/capability.jsonl` during a
  plain `run.sh --parallel 8` invocation.
- The row's shape (`evidence: "Passive capture from review dispatch failure"`, runner `cc-shim`, model
  `MiniMax-M3`) points at the engine-qualify / dispatch-review passive-capture code path, not at any
  hook this plan touched.
- The foreman removed the one appended line by hand to restore the operator's store to its pre-run
  state.

## What's unconfirmed (attribution is circumstantial)
- The foreman did not reproduce this at `origin/develop` (would have needed a third ~10-minute full
  run) — so it is not yet confirmed pre-existing vs. introduced by this landing's diff.
- It correlates with, but is not proven to be caused by, the already-known-red
  `engine-qualify-verdict-stability` suite (same subsystem: engine-qualify / passive capability
  capture).
- It was observed once (round 2) and not observed in round 1's run of the same suite set.

## Suspect subsystem
`engine-qualify` / `dispatch-review` passive capture — some path that records an engine-capability
observation on a review-dispatch *failure* writes directly to the real
`~/.autopilot/engine-capability/capability.jsonl` instead of a test-local/guarded `HOME`.

## Fix shape
This is the evidence-discipline family: "a green test writing fixture rows into the real store"
(`references/evidence-discipline.md`). The fix is to:
1. Find the specific suite/code path that performs passive capability capture on a dispatch-review
   failure without a guarded `HOME`/state-dir override.
2. Make that path hermetic — route it through the same `AUTOPILOT_*_DIR` / guarded-`HOME` pattern the
   rest of the hook test suites use, so a test run can never touch the operator's real
   `~/.autopilot/engine-capability/capability.jsonl`.
3. Add a regression check (e.g. a suite that asserts the real store's mtime/content is untouched by a
   full `run.sh` invocation) so a recurrence trips CI instead of requiring manual cleanup.

## Evidence
- `docs/plans/evidence/2026-09-26-hook-channel-probe/landing/REPORT-land.md` (copy of
  `$H/run-land/REPORT.md`, "Full suite rerun after repair" section).
