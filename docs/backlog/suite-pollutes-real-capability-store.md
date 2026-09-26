# A hook suite writes into the operator's real `~/.autopilot/engine-capability/capability.jsonl` during `run.sh`

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
