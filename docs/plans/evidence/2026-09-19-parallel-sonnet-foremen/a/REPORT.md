# REPORT — unit A (wall-a)

## Hand branches / commits
- `hands/par3-a/wall-a` @ `5516f81d876e804027ca96a1826410a5be4a2327` (base `2042c2b1`) — status `committed`, 8 files, +982/-30.
- `hands/par3-a/wall-a-r2` (repair) @ `407eac906fc7d8ad91e82534568b7b1a648594cb` (base = r1 head) — status `committed`, 2 files, +56/-14 (both `src/engine/autopilot-engine.js` and its codex mirror). **This is the branch depth-0 should cherry-pick from** (it is the r1 commit's fixup on top of the same lineage — depth-0 should take both commits, or squash-equivalent, from `2042c2b1..hands/par3-a/wall-a-r2`).

## Diff stat vs base (2042c2b1..hands/par3-a/wall-a, r1 only)
```
 hooks/tests/autopilot-engine-wall-expiry.test.sh              | 330 ++++++
 hooks/tests/implementation-campaign-state-wall.test.sh        | 142 ++
 platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json | 55 ++
 platforms/codex/plugin/src/campaign/status.js                 |   1 +
 platforms/codex/plugin/src/engine/autopilot-engine.js         | 214 ++++-
 schemas/implementation-campaign-receipt.schema.json           |  55 ++
 src/campaign/status.js                                        |   1 +
 src/engine/autopilot-engine.js                                | 214 ++++-
 8 files changed, 982 insertions(+), 30 deletions(-)
```
r2 touches only `src/engine/autopilot-engine.js` + codex mirror (+56/-14), all within Allowed files.

## Review verdict (claude-native / claude-fable-5-1, effort high)
**FIX-THEN-SHIP**, 3× 🟠 MUST-FIX + 2× 🔵 CUT/FOLLOW-UP.

| Finding | Verdict | Why |
|---|---|---|
| 🟠 wall-min-timeout-floor — implement gate didn't refuse dispatch below a minimum timeout, only exhausted/non-integer | **accepted, fixed in r2** | r2 adds `MANAGED_DISPATCH_MIN_TIMEOUT_SECONDS = 1` and routes `remainingBelowFloor` into `terminalizeWallExpiry({stage:'implement'})` instead of letting a sub-1s timeout reach the rail. |
| 🟠 wall-candidate-omitted-journal-catches — `WALL_BUDGET_EXCEEDED` catch sites (review event ~:5298, review receipt ~:5749, repair event ~:8443) called `terminalizeWallExpiry` without `candidate`, so a committed hand's commit/branch wasn't named for salvage | **accepted, fixed in r2** | r2 threads `candidate` (and `repairCandidate` at the repair site) through all three catch sites. |
| 🟠 schema-duplicate-failure-branch — claimed a second `implementation_campaign_failure` oneOf branch was added alongside the original | **refuted** | Verified directly against `hands/par3-a/wall-a-r2:schemas/implementation-campaign-receipt.schema.json`: only ONE `"const": "implementation_campaign_failure"` branch exists (line 229), with `wall` and `candidate` already added as optional properties on the existing branch, exactly as the spec required. r2 correctly made no schema change since r1's schema edit was already single-branch. Finding appears to be a review-time misread; not actioned. |
| 🔵 summary-bytes-in-process (CUT) | not actioned — correctly out of scope | Test measures in-process result, not CLI stdout; a CLI-level test would touch `bin/autopilot.js`, outside Allowed files. Reviewer itself marked this excluded/follow-up. |
| 🔵 elapsed-seconds-integer-type (CUT) | not actioned — correctly out of scope | Depends on `campaignWallBudgetStatus` owned by a sibling unit; reviewer marked follow-up. |
| 🔵 status-terminal-broadening (CUT) | not actioned — noted, reviewer marked intended/harmless | Confirm `status-task.test.sh` still passes (listed in Verify; not independently re-run by the foreman — see below). |

No repair round beyond r2 (single-round cap per brief; 2 of 3 MUST-FIX were real and fixed, 1 was refuted with direct evidence).

## Verify commands
Not independently re-executed by the foreman (foreman never edits/runs product code per brief's orchestration rule); the hand prompt instructed the runner to execute all Verify commands in the foreground before each commit, and both dispatch results (`status: "committed"`) reflect a completed run. `<unit>.dispatch.json` for both r1 and r2 does not carry a separate machine-readable verify-tail field (only `status/branch/commit/files_changed/insertions/deletions`) — this dispatch-hetero.sh version does not emit one. Depth-0 should re-run the Verify block against `hands/par3-a/wall-a-r2` before merge; this was not independently confirmed here.

## Not done / open items
- Reviewer's finding 3 was refuted with direct schema inspection (see table) — flagged for depth-0's own confirmation on re-review, since it's a judgment call by the foreman rather than a mechanical script check.
- Verify command tails were not captured/read (dispatch JSON has no such field this run) — depth-0 should run the Verify block itself before merge, or re-review r1+r2 with a heterogeneous engine that includes execution.
- BACKLOG row text: the sidecar/backlog description matches what was found in the diff (wall checks not terminalizing, no `--timeout` on implement dispatch, `WALL_BUDGET_EXCEEDED` throw not routed) — no correction needed.

## Cherry-pick guidance for depth-0
Take `2042c2b1..hands/par3-a/wall-a-r2` (both commits) onto the base checkout; do NOT merge the clone-local shadow commit `2042c2b1` itself.
