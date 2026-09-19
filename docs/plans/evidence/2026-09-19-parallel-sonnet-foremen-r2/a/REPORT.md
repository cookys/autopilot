# REPORT — unit A (resume-a)

## Hand
- Branch: `hands/par4-a/a`, head `8a11931b3708ecb6b18fad744b8e03fe2838b6d8` (single commit "dispatch-hetero(cursor): edits on hands/par4-a/a"), base `ff6037bfadeb2749d112ca985d4548cd67c1c07b`.
- No repair round needed (review SHIP-AS-IS on the first pass).

## diff --stat (base..hands/par4-a/a)
```
 hooks/tests/autopilot-engine-repair-branch.test.sh                | 698 +++++++++++++++++++++
 platforms/codex/plugin/src/engine/autopilot-engine.js              |  26 +-
 platforms/codex/plugin/src/engine/campaign-dispatch-projection.js  |   4 +-
 src/engine/autopilot-engine.js                                     |  26 +-
 src/engine/campaign-dispatch-projection.js                         |   4 +-
 5 files changed, 750 insertions(+), 8 deletions(-)
```
All within the allowed-files list (engine files + codex mirrors + one new test suite).

## Review verdict: SHIP-AS-IS
Three 🔵 findings, all CUT/FOLLOW-UP (no 🔴/🟠):
1. `sealed-contract-reread` — the managed `implement` closure re-reads `campaignControl.contract_path` from disk instead of an in-memory field to decide strict authority; degraded case still blocked by `expectedBranch`, not a hole. Refuted as a blocker — follow-up suggestion only, out of scope for this brief.
2. `source-text-pin` — new suite pins a literal source string (`engineSrc.includes('return expectedBranch({')`) as brittle but redundant given the behavioural parity loop. Refuted as a blocker — spec explicitly asked for the parity pin, which is present.
3. `projection-null-base-widening` — `expectedBranch` now returns `-base` for a null base instead of throwing; spec-sanctioned single-owner reconciliation, byte-identical to prior `buildRepairBranchName` output. Refuted as a blocker — explicitly allowed by spec item 2 (single-owner parity).

No repair round dispatched.

## Verify (run in the hand's committed worktree `/tmp/hetero-hands-par4-a-a-WkfG91`, each `< /dev/null`)
```
bash hooks/tests/autopilot-engine-repair-branch.test.sh          rc=0  (new suite: parity checks + repair_branch_suite=true)
bash hooks/tests/campaign-dispatch-projection.test.sh            rc=0  PASS 44 assertions
bash hooks/tests/autopilot-engine.test.sh                        rc=0  PASS 581 assertions
bash hooks/tests/implementation-campaign-state.test.sh           rc=0  PASS 300 assertions
bash hooks/tests/implementation-campaign-routing.test.sh         rc=0  PASS 116 assertions
bash hooks/tests/autopilot-engine-park-reserve.test.sh           rc=0  PASS 5 assertions
bash hooks/tests/autopilot-engine-boundary-resume.test.sh        rc=0  (red/green scenario asserts pass; unrelated to this fix)
bash scripts/sync-codex-plugin-skills.sh --check                 rc=0  "Codex plugin payload in sync"
node scripts/check-js-syntax.js                                  rc=0  666 files parse cleanly
```
`hooks/tests/dispatch-detached-campaign-authority.test.sh`: rc=1, 8 passed / 2 failed — both failures are pre-existing
(unrelated to branch derivation: `returns committed` / `changes only the narrow subset` assertions about a detached-dispatch
fixture, not about repair-branch naming). Set did not grow beyond these 2; brief only requires recording, not fixing.

Note: my first verify attempt ran against the **wrong tree** — `git checkout` in the clone failed silently
(`'hands/par4-a/a' is already used by worktree at /tmp/hetero-hands-par4-a-a-WkfG91`) so the loop executed against
stale base HEAD (all suites "passed" trivially except the new suite, which correctly 127'd on a missing file). Caught
by the missing-file failure; re-ran against the hand's actual worktree above, all figures in this report are from
that second, correct run.

## Consumer sweep (evidence-discipline §37/§39)
Grepped all `hooks/tests/*.test.sh` for `buildRepairBranchName`/`expectedBranch` outside the Verify-listed suites: no
other consumers found. Sweep log empty (no rows to report).

## Not done / deviations
- None from the brief's Product/Tests/Verify scope. Hand kept the fix confined to `autopilot-engine.js:~7394` +
  `buildRepairBranchName` and made `buildRepairBranchName` delegate to `campaign-dispatch-projection.js`'s
  `expectedBranch` for single-owner parity (item 2's explicit fallback), touching `campaign-dispatch-projection.js`
  minimally as the brief allowed.
- BACKLOG row text: the brief itself already corrected the row's framing (mismatch fires on first in-run repair round
  too, not only resume) — no further inaccuracy found in the row beyond what the brief already flagged.
