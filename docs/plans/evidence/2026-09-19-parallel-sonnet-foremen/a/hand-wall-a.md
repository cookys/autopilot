## Plan
# Plan A — wall expiry terminalizes and always writes the summary
1. RED: engine case — hand returns implemented, clock past the wall → blocked/campaign_wall_budget, lease held, no terminal event.
2. Route every in-loop wall exhaustion (and the reducer's WALL_BUDGET_EXCEEDED) through terminalizeManagedCampaignFailure: MUTATION_FAILED with lease/lineage/candidate when a hand may have committed, TERMINAL_STOP otherwise; result status wall_expired; summary JSON never empty.
3. Implementation dispatch gets --timeout = remaining wall (builder-managed), refuse-and-terminalize when below the minimum.
4. Reducer pin; new suite; sync mirrors; verify; ONE commit.
Acceptance: the 2026-08-30 shape (commit lands, wall elapses before review) ends in a journaled terminal with the candidate named, lease released, non-empty summary.

## Product
1. RED first: engine-suite case modelled on `hooks/tests/autopilot-engine.test.sh:6483-6647` (the acceptance_failed
   case: injected `implementationDispatcher`, `reviewDispatcher` that throws if called, constructor `clock` option):
   sealed contract with a small `max_wall_seconds`, a `clock` that is already past `started_at + max_wall_seconds`
   when the loop re-checks the wall after the injected dispatcher returns `implemented` with a commit. At base the run
   result is `status: blocked, phase: campaign_wall_budget`, the journal's last event is NOT terminal and
   `live_lease !== null`. Record the exact observed output in the RED comment.
2. Fix — every in-loop wall exhaustion terminalizes through `terminalizeManagedCampaignFailure` (reuse; do not write a
   second receipt builder): reason names the wall (`campaign wall budget exhausted before <stage>`), receipt body
   carries `wall: {max_wall_seconds, elapsed_wall_seconds, stage}`, and — as with acceptance_failed — the event is
   `MUTATION_FAILED` (with the live lease identity and `repair_lineage` when the hand may have committed) or
   `TERMINAL_STOP` when no lease is live. The run result surfaces `status: 'wall_expired'` and `phase` = the terminal
   journal phase (mirror `journaledAcceptanceFailure` → a `journaledWallExpiry` predicate), the summary JSON is
   complete (never 0 bytes), `campaign inspect` shows the terminal phase with `activity: completed|terminal`, never
   `dead`, and `live_lease === null`. Where a retained candidate commit exists, the receipt must name it (commit,
   branch) so depth-0 can salvage it — the artifact was complete in both live incidents.
3. Pre-emption — the managed implementation dispatch passes an explicit `--timeout <remaining wall>s` to
   `dispatch-hetero.sh` exactly as review does (`:5014`), so a hand cannot outlive the wall; if the remaining wall is
   below the rail's minimum useful timeout, refuse to dispatch and terminalize per item 2 (stage `implement`) instead
   of dispatching. `buildImplementationArgs` gains `--timeout` as a builder-managed flag (callers may not pass it).
4. The reducer's `WALL_BUDGET_EXCEEDED` refusal on an ordinary progress event must ALSO route into item 2 (the
   catch at each `recordCampaignEvent` site recognises the code and terminalizes), not `blocked/campaign_event_journal`.
5. Keep every other reducer rule byte-identical (BOUNDARY_REJECTED, AWAITING_DISPOSITION, the durable waits, the
   evidence rule on `MUTATION_FAILED`). Do NOT change `campaignWallBudgetStatus` / `campaignWallRemainingSeconds` /
   `campaignMutationBudgetStatus` (`:1462-1531`) or `src/engine/campaign-intake.js` — a sibling unit owns the
   resume-side budget. Schema: if `schemas/implementation-campaign-receipt.schema.json` (`additionalProperties:false`)
   needs the `wall` block on the failure receipt, edit it and its codex twin in the same commit. Codex mirrors of every
   touched file via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first: run each new case against the unmodified code, record the exact observed output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken or delete an existing assertion)
- NEW suite file `hooks/tests/autopilot-engine-wall-expiry.test.sh` (copy the harness prologue of
  `hooks/tests/autopilot-engine.test.sh`; do NOT append to that file — sibling units are editing the engine): (a) the
  RED case of item 1 → GREEN terminal receipt + `MUTATION_FAILED` + `live_lease === null` + summary JSON non-empty
  + `campaign inspect` terminal; (b) wall already exhausted BEFORE the first dispatch → no dispatcher call,
  `TERMINAL_STOP`, stage `implement`; (c) the implementation argv carries `--timeout <remaining>s` and a caller-supplied
  `--timeout` in extra args is rejected.
- NEW suite file `hooks/tests/implementation-campaign-state-wall.test.sh` (copy the prologue of
  `hooks/tests/implementation-campaign-state.test.sh`; do NOT edit that file — sibling units own it): a `MUTATION_FAILED`
  whose receipt carries the `wall` block is accepted with the controller's own digest; wrong digest still refused.

## Verify (foreground, all exit 0)
```
bash hooks/tests/autopilot-engine-wall-expiry.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state-wall.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/campaign-terminalize.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/status-task.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(`hooks/tests/mission-runtime-v2.test.sh` and `hooks/tests/dispatch-detached-campaign-authority.test.sh`: run, record
the failing assertion names before and after, require the set does not grow; do not try to fix them.)

## Allowed files
`src/engine/autopilot-engine.js` (the wall-check call sites, `terminalizeManagedCampaignFailure` receipt body,
`buildImplementationArgs`, the result surfacing next to `journaledAcceptanceFailure`), `src/campaign/status.js`
(activity projection), `schemas/implementation-campaign-receipt.schema.json`, their codex twins under
`platforms/codex/plugin/` via the sync script, `hooks/tests/autopilot-engine-wall-expiry.test.sh` (new),
`hooks/tests/implementation-campaign-state-wall.test.sh` (new). Nothing else. The `wall` block lives in the RECEIPT BODY
(the reducer checks only the digest binding) — do NOT edit `src/engine/implementation-campaign.js`,
`hooks/tests/implementation-campaign-state.test.sh`, `campaign-intake.js`, `campaign-composition.js`, `bin/autopilot.js`, `scripts/dispatch-hetero.sh`, or `hooks/tests/autopilot-engine.test.sh`.

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it changed; run every verify command in the foreground before committing; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
