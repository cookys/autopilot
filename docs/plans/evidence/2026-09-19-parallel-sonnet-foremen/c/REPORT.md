# Unit C — park-c — REPORT

## Branches / commits
- `hands/par3-c/park-c-retry` @ `d91302d6` (base `56e2c097`, r1 hand — first dispatch failed `precondition_failed` due to a foreman prompt-file naming mistake, not the hand; retried successfully)
- `hands/par3-c/park-c-r2` @ `9754e376` (base `d91302d6`, repair round)
- Final head for depth-0 to cherry-pick: `9754e376` (`hands/par3-c/park-c-r2`)

## diff --stat (base 56e2c097 → r1 head d91302d6)
```
 hooks/tests/autopilot-engine-park-reserve.test.sh        | 205 ++
 .../implementation-campaign-state-park.test.sh            | 551 ++
 platforms/codex/plugin/src/engine/autopilot-engine.js     |  44 +-
 platforms/codex/plugin/src/engine/campaign-intake.js      |  61 +
 platforms/codex/plugin/src/engine/implementation-campaign.js | 164 +
 src/engine/autopilot-engine.js                             |  44 +-
 src/engine/campaign-intake.js                              |  61 +
 src/engine/implementation-campaign.js                       | 164 +
 8 files changed, 1290 insertions(+), 4 deletions(-)
```
## diff --stat (r1 d91302d6 → r2 9754e376, repair round)
```
 hooks/tests/autopilot-engine-park-reserve.test.sh          | 193 ++
 hooks/tests/implementation-campaign-state-park.test.sh      |  17 +
 platforms/codex/plugin/src/engine/implementation-campaign.js |   4 +-
 src/engine/implementation-campaign.js                        |   4 +-
 4 files changed, 210 insertions(+), 8 deletions(-)
```
All touched files within allowed set (no `status.js`, `cli.js`, `bin/autopilot.js`, no schema files touched).

## Review verdict (claude-fable-5-1, high effort, on r1 diff)
**FIX-THEN-SHIP.** 3 MUST-FIX + 5 CUT/FOLLOW-UP findings.

| Finding | Severity | Disposition | Why |
|---|---|---|---|
| engine-park-fits-unasserted | 🟠 MUST-FIX | accepted, fixed in r2 | Engine test only checked `typeof`/`hasOwnProperty`, not exact values; real bug found: engine ledger uses `campaign_verification` not `verify_round`, estimate was silently `null`. r2 now asserts `=== 5400` / `=== 1765` / `=== false` and fixes the estimator to read `campaign_verification` rows. |
| engine-resume-park-unverified | 🟠 MUST-FIX | accepted, fixed in r2 | Spec §4 required proving the engine-level resume stays parked (or an ESCALATION.md). r2 adds an engine-process resume case: intake returns `blocked`/`campaign_wall_budget_insufficient_for_repair`, phase stays `AWAITING_DISPOSITION`, no `terminal_stop`/`mutation_failed`; confirmed `terminalizeManagedCampaignFailure` (~9821) is not called on this path — no ESCALATION.md needed. |
| red-comments-missing-case-b | 🟡 MUST-FIX | accepted, fixed in r2 | Added `# RED at 56e2c097: …` comments at the case-b refusal assertion and the run-summary/inspect field assertions. |
| test-only-estimate-override | 🔵 CUT | refuted (deferred) | Reviewer marks it explicitly acceptable for this version; a test-hook input on intake, not spec-mandated — left as-is per reviewer's own note. |
| mixed-estimate-components | 🔵 CUT | refuted (deferred) | Cosmetic breakdown-vs-total drift only when two sources disagree; does not affect the refusal decision. |
| two-clock-reads-at-park | 🔵 CUT | refuted (deferred) | Sub-second drift between two `now()` reads at park time; does not affect the ledger-derived refusal decision. |
| durable-wait-fields-overbroad | 🔵 CUT | refuted (deferred) | Extra fields on other durable-wait states are harmless. |
| reducer-hard-fail-on-nan | 🔵 CUT | refuted (deferred) | Hardening deferred per reviewer. |
| stray-indent-8432 | 🔵 CUT | refuted (deferred) | Whitespace-only, unrelated line; excluded. |

No second review dispatch was run on the r2 delta (budget); the r2 diff was instead directly checked against each MUST-FIX finding's required assertion text (grep on the diff) — all three confirmed present and matching the finding's "smallest fix" ask.

## Verify tail (from hand's r2 result, all foreground, exit codes as reported)
```
implementation-campaign-state-park.test.sh   0
implementation-campaign-state.test.sh        0
autopilot-engine-park-reserve.test.sh        0
implementation-campaign-routing.test.sh      0
implementation-campaign-receipt.test.sh      0
campaign-claim-resolve.test.sh               0
status-task.test.sh                          0
campaign-terminalize.test.sh                 0
sync-codex-plugin-skills.sh / --check        0 / 0
check-js-syntax.js                           0
autopilot-engine.test.sh                     0 (581 assertions; failing set did not grow)
controller-execution-independent.test.sh     1 — pre-existing `blocked !== ready` at
                                              `final_panel_metadata_incomplete` ([stdin]:2061);
                                              not in allowed files, not caused by this work
```

## Not done / out of scope
- No `ESCALATION.md` was needed — the engine-side blocked-resume path does not route through
  `terminalizeManagedCampaignFailure`, confirmed empirically by the r2 hand.
- git commit/push/merge left to depth-0 (foreman does not merge).
- No schema, `campaignWallBudgetStatus`, `status.js`, `cli.js` touched, per allowed-files constraint.

## BACKLOG row correctness
The BACKLOG row's numbers (2-C: 5435/7200 s, implement 60 min + verify 21 + panel 9) matched the shape both
hands reproduced and tested against (impl 3600 s, verify→4861, review/panel→5401, park at 5435, remaining
1765 s < round-1 cost 5400 s, shortfall 3635 s). No inaccuracy found in the row text.
