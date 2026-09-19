# REPORT — run par2-d, unit `terminal-d`

## Hand branches
- `hands/par2-d/terminal-d` head `f82398f059c4ce2611ffc5542e9a406a595d5a8d` (one commit, result status `committed`, exit 0)
- No repair round needed (review SHIP-AS-IS, no 🔴/🟠).

## diff --stat vs base dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6
```
 hooks/tests/autopilot-engine.test.sh               | 174 +++++++++++++++++++++
 hooks/tests/implementation-campaign-state.test.sh  |  46 +++++-
 platforms/codex/plugin/src/engine/autopilot-engine.js    |  37 ++++-
 platforms/codex/plugin/src/engine/campaign-intake.js     |   3 +-
 platforms/codex/plugin/src/engine/implementation-campaign.js   |  62 ++++++--
 src/engine/autopilot-engine.js                     |  37 ++++-
 src/engine/campaign-intake.js                      |   3 +-
 src/engine/implementation-campaign.js              |  62 ++++++--
 8 files changed, 385 insertions(+), 39 deletions(-)
```
Only allowed files touched (3 engine sources + codex twins + 2 test files). Depth-0 hypothesis confirmed: a shared digest-binding helper now covers `{kind, digest[, repair_lineage]}` on both appender (`campaign-intake.js`) and reducer (`implementation-campaign.js`); evidence rule (sha256 receipt digest + `possibly_effectful: true`) retained.

## Review
`terminal-d.review.json`: **SHIP-AS-IS** (claude-native/claude-fable-5-1, effort high). Findings, all 🔵, all accepted as non-blocking:
- 🔵 bound-digest comment wording vs code — comment-only, behavior correct. Accepted; not worth a repair round.
- 🔵 summary-bytes proven in-process, not via CLI stdout — hardening, not a spec gap. Accepted.
- 🔵 wall-expiry row untouched — spec permits when it is a different path. Accepted (see Not done).
Reviewer independently verified: symmetric digest binding, evidence guards retained, byte-identical codex mirrors, no schema/bin/composition files touched.

## Verify (re-run by foreman in hand worktree `/tmp/hetero-hands-par2-d-terminal-d-I50vsT`, all exit 0)
```
autopilot-engine.test.sh              PASS 580 assertions
implementation-campaign-state.test.sh PASS 300 assertions
implementation-campaign-routing.test.sh PASS 116 assertions
implementation-campaign-receipt.test.sh PASS 25 assertions
campaign-terminalize.test.sh          PASS 6 assertions
mission-runtime-v2.test.sh            PASS 103 assertions
sync-codex-plugin-skills.sh --check   exit=0 "Codex plugin payload in sync"
check-js-syntax.js                    exit=0 (666 files parse)
```

## Done
- RED repro (blocked / campaign_terminal_journal / MUTATION_FAILURE_EVIDENCE_REQUIRED at base) recorded in test comments; GREEN: terminal receipt, `MUTATION_FAILED` journaled, `live_lease === null`.
- Reducer pin: correct controller-bound digest with `repair_lineage` accepted; wrong digest still refused MUTATION_FAILURE_EVIDENCE_REQUIRED.
- Codex mirrors in same commit; `campaign inspect` shows terminal phase (asserted in engine test).

## Not done
- Wall-expiry row (`WALL_BUDGET_EXCEEDED` terminal summary): hand and reviewer both identify it as a DIFFERENT code path (`validateUsage` on non-overrun events), so per spec item 3 it was left unchanged. Still open.
- 🔵 hardening: CLI-stdout capture test for summary-bytes; comment wording on `boundCampaignArtifactDigest`.
