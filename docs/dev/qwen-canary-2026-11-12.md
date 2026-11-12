# Qwen implementer canary: final report (2026-11-12)

Window: ended 2026-11-12 12:00 Taipei (UTC+8).

## Scope

The hippo, codeforge and autopilot lanes dispatched the local Qwen3.8-27B-QUASAR-NVFP4 seat (`qwen_local` on the local GPU host) as implementer via:

`scripts/dispatch-hetero.sh --runner cc-shim --endpoint qwen_local --sandbox bwrap --worktree-parent`

The roster was unchanged during the canary.

## Excluded windows

Qwen outage or power loss. These windows are excluded from the totals:

- 2026-11-11 12:36 to 12:41 (Taipei)
- 2026-11-11 12:57 to 13:28 (Taipei)
- 2026-11-11 19:26 to 2026-11-12 04:22 (Taipei)

## Reconciliation

The two lane logs match the dispatch manifests, 8 qwen dispatches in total:

- `hippo-qwen-canary.jsonl` (lane log), sha256 prefix `3cd24567`
- `codeforge-qwen-canary.jsonl` (lane log), sha256 prefix `26187beb`

## Per-lane results

### hippo (3 dispatches, all committed)

- First review: 1 FIX-THEN-SHIP (scrub.py identity literals), 2 SHIP-AS-IS.
- The fix was re-reviewed and returned SHIP-AS-IS.
- bwrap blocked 5 writes to `/tmp` on the first run (mktemp in the deploy test scripts). No write landed outside the worktree.

### codeforge (3 committed, plus 3 non-committed outcomes)

- Committed: 2 SHIP-AS-IS in the first round, and 1 FIX-THEN-SHIP for spawn without PATH resolution. That one was fixed in one round, then returned SHIP-AS-IS.
- 1 `boundary_rejected`. The orchestrator rebased another branch during the round, so the cause was not qwen. The candidate was still reviewed SHIP-AS-IS and merged.
- 1 cancelled when the PM dropped the task.
- 1 pre-probe returned 503 busy inside the 12:57 to 13:28 excluded window. It was re-dispatched by hand 2 minutes later.

### autopilot (0 qwen dispatches)

Its implementation work went to grok and agy.

## After recovery

After the 04:22 recovery there were 0 dispatches in any lane. The last 7.5 hours of the window carry no data.

## Totals

Excluding the excluded windows and the cancelled task:

- 7 candidates: 5 SHIP-AS-IS in the first round, 2 fixed in one round.
- Fallbacks: 0.
- Refusals attributable to qwen: 0.
- Quality problems that reached merge: 0.

## Limitation

With an explicit `--endpoint`, `dispatch-hetero` exits `engine_unavailable` (exit 1) when the pre-probe fails. It has no automatic fallback.

"0 fallbacks" only means every pre-probe passed. The fallback path was never exercised. The one 503 was re-dispatched by hand.

## PM verdict

Fleet message `01M76WDT193M2A7QRQ9X5YFWVZ`, 2026-11-12: PASS, conditional.

- Until the fallback ships, the qwen implementer is used only in attended lanes.
- After the fallback ships, rerun the canary for one week and measure fallback as well.
- Tracked as BL-0435 in `project/backlog/BACKLOG.md`, with details in `project/backlog/hetero-endpoint-fallback.md`.
