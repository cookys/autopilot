## Plan
# Plan C — the park names the repair-round cost; a resume that cannot fit is refused honestly
1. RED: parked state exposes no estimate; a repair-authorising resume with remaining < round-1 cost is accepted.
2. Pure estimate function from the ledger (implement wall_secs + verify duration + review duration); null when rows are missing.
3. Park payload + summary + inspect carry wall_seconds_remaining / repair_round_estimate_seconds / repair_round_fits; old journals replay unchanged.
4. Resume preflight: repair-authorising disposition with remaining < estimate → campaign_wall_budget_insufficient_for_repair naming the shortfall; campaign stays parked. Non-repair dispositions unaffected.
5. Pins; sync mirrors; verify; ONE commit. No schema, no budget helpers, no terminalization code.
Acceptance: the 2-C shape (5435/7200, must-fix findings) parks with repair_round_fits=false and a --resume is refused with the numbers instead of burning the round.

## Product
1. RED first (two cases, model on `hooks/tests/implementation-campaign-state.test.sh:4340-4530` R7 park/resume block
   and the `:3765` exact-budget intake case): (a) a lineage parked at AWAITING_DISPOSITION with ledger rows showing
   implement 3600 s + verify 1260 s + review 540 s, `max_wall_seconds` 7200, elapsed 5435 — at base the park state exposes no
   repair-round estimate; (b) a disposition resume that authorises a repair round (`--campaign-disposition-authority`
   with must-fix-now findings) against that state — at base intake accepts it (no refusal) although 1765 s < the
   round-1 cost (5400 s). Record the exact observed outputs in the RED comments.
2. Derive `repair_round_estimate_seconds` = round-1 implementation `wall_secs` + round-1 verification duration + round-1
   in-loop review/panel duration (a repair round re-runs all three) from the campaign's own ledger — one pure function
   in `src/engine/implementation-campaign.js` (exported, unit-tested), used by both sides below. Missing rows ⇒ `null`
   (never a guess).
3. Park time: the AWAITING_DISPOSITION event payload and the run summary carry `wall_seconds_remaining`,
   `repair_round_estimate_seconds` and `repair_round_fits` (boolean, `null` when the estimate is null); the reducer
   accepts these optional fields and preserves them INSIDE `state.awaiting_disposition`, which `campaign inspect` /
   `status task` already pass through verbatim (`src/campaign/status.js:107`, `src/campaign/cli.js:526,878,1036`) — no
   edit to those two files. Pre-v2.36.71 journals without
   the fields replay byte-identically.
4. Resume time: in the resume preflight (`campaign-intake.js:1093-1121`), when the disposition authorises a repair round
   and `repair_round_estimate_seconds` is not null and `remaining < estimate`, reject with a NEW reason code
   `campaign_wall_budget_insufficient_for_repair` whose message names both numbers and the shortfall
   ("remaining 1765 s < repair round estimate 5400 s (implement 3600 + verify 1260 + review 540), shortfall 3635 s"),
   BEFORE any dispatch. The campaign MUST stay parked: the GREEN assertion shows phase still AWAITING_DISPOSITION, no
   TERMINAL_STOP / MUTATION_FAILED journaled, lease unchanged, still resumable. Verify at base how an intake rejection
   at resume is handled by the engine (`terminalizeManagedCampaignFailure` is the generic path for a blocked resume) —
   if keeping the campaign parked requires editing `src/engine/autopilot-engine.js` ~:9700-9790 (a sibling unit's
   zone), STOP and write ESCALATION.md naming the exact lines instead of editing them. A disposition that does NOT
   authorise a repair round (accept-as-is / stop) is unaffected. `elapsed >= max_wall_seconds` keeps today's code.
5. Do NOT touch `campaignWallBudgetStatus` / `campaignWallRemainingSeconds` / `campaignMutationBudgetStatus`
   (`autopilot-engine.js:1462-1531`), `terminalizeManagedCampaignFailure`, the wall-check call sites, or any schema —
   a sibling unit owns wall-expiry terminalization. If a schema with `additionalProperties:false` blocks the new
   optional fields on the receipt/summary, stop and write ESCALATION.md naming the schema file and the fields.
   Codex mirrors of every touched file via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first: run each new case against the unmodified code, record the exact observed output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken or delete an existing assertion)
- NEW suite file `hooks/tests/implementation-campaign-state-park.test.sh` (copy the prologue of
  `hooks/tests/implementation-campaign-state.test.sh`; do NOT edit that file — sibling units own it): the estimate function (rows present /
  rows missing → null); park payload fields accepted + preserved + replay of an old journal without them; resume
  refusal `campaign_wall_budget_insufficient_for_repair` with the message naming remaining/estimate/shortfall; a
  non-repair disposition on the same state still resumes; an estimate that fits still resumes.
- NEW suite file `hooks/tests/autopilot-engine-park-reserve.test.sh` (copy the harness prologue of
  `hooks/tests/autopilot-engine.test.sh`; do NOT append to that file): a managed loop that parks (injected dispatchers
  as in `autopilot-engine.test.sh` awaiting_disposition cases) shows the three fields in the run summary and in
  `campaign inspect`.

## Verify (foreground, all exit 0)
```
bash hooks/tests/implementation-campaign-state-park.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/autopilot-engine-park-reserve.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/campaign-claim-resolve.test.sh
bash hooks/tests/status-task.test.sh
bash hooks/tests/campaign-terminalize.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(`hooks/tests/autopilot-engine.test.sh` and `hooks/tests/controller-execution-independent.test.sh`: run, record the
failing assertion names before and after, require the set does not grow; do not try to fix pre-existing reds.)

## Allowed files
`src/engine/implementation-campaign.js`, `src/engine/campaign-intake.js`, `src/engine/autopilot-engine.js` (ONLY the
place that builds the AWAITING_DISPOSITION event payload and the run summary for the park — no budget helpers, no
terminalization), their codex twins under `platforms/codex/plugin/` via the sync script,
`hooks/tests/implementation-campaign-state-park.test.sh` (new), `hooks/tests/autopilot-engine-park-reserve.test.sh` (new).
Nothing else; no schema files; no `bin/autopilot.js`, `src/campaign/status.js`, `src/campaign/cli.js`, or
`hooks/tests/implementation-campaign-state.test.sh`.

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it changed; run every verify command in the foreground before committing; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.

## Retry note
Previous dispatch attempt failed with: "prompt file not readable: .../hand-park-c.md" (foreman file-naming error, not a rejection of this task's premise). Proceed normally with the plan/product/tests/verify above.

## Repair round — fix these review findings
🟠 [engine-park-fits-unasserted] MUST-FIX The new `hooks/tests/autopilot-engine-park-reserve.test.sh` reproduces the exact 2-C shape (impl 3600 s, verify to 4861, review to 5401, park at 5435, max 7200) but only asserts `typeof wall_seconds_remaining === 'number'` and `hasOwnProperty` on the other two fields, and `campaign inspect` is checked only for the field *names*. If the engine-side `ledger` rows for `verify_round` / `dispatch_review` lack `started_at`/`ended_at`/`duration_seconds`, `estimateRepairRoundSeconds(ledger)` yields `null` and `repair_round_fits: null` and this test still passes, so the spec's acceptance ("parks with repair_round_fits=false") is not proven for the real engine path. Smallest fix: assert `result.repair_round_estimate_seconds === 5400`, `result.wall_seconds_remaining === 1765`, `result.repair_round_fits === false`, and that inspect output contains `"repair_round_fits": false` (or equivalent); if that goes red, populate the missing timing on the engine ledger rows at the park site (still within the allowed engine zone).
🟠 [engine-resume-park-unverified] MUST-FIX Spec §4 requires verifying how a blocked resume intake is handled by the engine (it names `terminalizeManagedCampaignFailure` as the generic path) and either proving the campaign stays parked or writing ESCALATION.md naming `autopilot-engine.js` ~:9700-9790. The diff wires `campaignDispositionAuthority` into the engine's intake call but provides neither an engine-level GREEN assertion nor ESCALATION.md; the only stay-parked evidence is at the `runCampaignIntake` layer, which cannot show what the engine does with the `blocked` result. Impact: an operator `--resume` through the engine may terminalize a fitting-but-refused campaign instead of leaving it parked, the opposite of the intended outcome. Smallest fix: add one case to `autopilot-engine-park-reserve.test.sh` that resumes the parked campaign through the engine with a must-fix-now authority and asserts status blocked with code `campaign_wall_budget_insufficient_for_repair`, phase still AWAITING_DISPOSITION, no `terminal_stop`/`mutation_failed` rows; if that fails because of the engine's generic terminalization path, write ESCALATION.md with the exact lines instead.
🟡 [red-comments-missing-case-b] MUST-FIX Spec requires a `# RED at <base sha>: …` comment recording the base observation beside every new assertion. The `campaign_wall_budget_insufficient_for_repair` refusal assertion in `implementation-campaign-state-park.test.sh` (case b: "at base intake accepts it") and the run-summary/inspect field assertions in `autopilot-engine-park-reserve.test.sh` carry no RED comment. Smallest fix: add the two comments with the exact base output (e.g. `status=admitted` / fields absent from summary and inspect).

Fix all three. Re-run every verify command in the foreground before committing (one commit, same allowed files). If fixing engine-resume-park-unverified truly requires editing autopilot-engine.js ~:9700-9790 (sibling zone), write ESCALATION.md instead of editing it and explain why in the commit message.
