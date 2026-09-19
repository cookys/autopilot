## Plan
# Plan A — the managed loop derives its own repair branch
1. RED: strict campaign, in-run repair round and disposition resume both block "caller branch disagrees with campaign stage".
2. `currentBranch` = round 1 ? branch : buildRepairBranchName(branch, round, currentBase); one owner with expectedBranch.
3. GREEN both cases; non-strict control unchanged; parity pin for generations 1..3.
4. New suite (+x); mirrors; verify; ONE commit.
Acceptance: `--resume --campaign-disposition-authority` into a repair round dispatches `<branch>-repair-r2-<sha7>` without the caller changing `--branch`.

## Product
1. RED first, two cases (new suite; model on `hooks/tests/campaign-dispatch-projection.test.sh:145-292` for the strict fixture and the
   `implementationDispatcher` capture, and on `hooks/tests/implementation-campaign-state.test.sh:1722-2040` `strictContract`):
   (a) a strict campaign driven through `_runManagedCampaignComposition` (public entry `runImplementationReviewLoop`) to a repair round
   in-run (injected review returns must-fix findings, injected disposition authorises repair) — at base the run blocks with
   `caller branch disagrees with campaign stage (expected <branch>-repair-r2-<sha7>)`; (b) the same campaign parked at
   AWAITING_DISPOSITION then a NEW engine instance with `resume: true` + `campaignDispositionAuthority` — same block at base.
   Both REDs must reproduce the LITERAL string `caller branch disagrees with campaign stage`; case (b) now passes through v2.36.71's
   resume preflight first (`campaign_wall_budget_insufficient_for_repair`, `verifyResumeCandidate`) — a different block reason is a
   fixture problem (give it enough wall / a null estimate / a valid recorded candidate), not a second defect. Record the exact
   observed outputs in the RED comments.
2. Fix at `autopilot-engine.js:7394-7395`: `currentBranch = candidateImplementationRound === 1 ? branch :
   buildRepairBranchName({ branch, round: candidateImplementationRound, previousCommit: currentBase })` (reuse the existing helper;
   no second implementation). Confirm `buildRepairBranchName` and `expectedBranch` agree byte-for-byte for every generation
   (round N ↔ generation N-1; `'base'` fallback vs `slice(0,7)` — if they disagree on any input, make `buildRepairBranchName` call
   the projection module's `expectedBranch` so one owner remains). The derived branch is what reaches the dispatcher, the ledger
   row and the repair lineage; argv `--branch` stays the campaign identity for intake.
3. Before writing the ternary, verify the round↔generation mapping at BOTH sites (`:4878` `implementationRound = initial_state.generation + 1` and `:7394` `candidateImplementationRound = implementationRound + 1`) — if read literally a fresh campaign's first round would already derive `-repair-r2-`; the fix must make round 1 of a fresh strict campaign dispatch the plain `branch`. GREEN: the dispatcher receives `--branch <branch>-repair-r2-<sha7 of the round-1 candidate>` in both cases; the non-managed loop
   (`:10190`) is untouched and its existing cases stay green; a non-strict campaign's repair round behaves exactly as today
   (assert the branch it dispatches is unchanged from base — RED comment records what base does).
4. Keep every other rule byte-identical; do not touch `campaign-dispatch-projection.js` unless item 2's parity check forces one
   owner (then say so in the report). Codex mirrors via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first, `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- NEW suite `hooks/tests/autopilot-engine-repair-branch.test.sh` (chmod +x; copy the prologue of `hooks/tests/autopilot-engine.test.sh`;
  do NOT append to that file): cases (a), (b), the non-strict control, a STRICT round-1 control (fresh strict campaign dispatches the plain `branch`), and a pin that `buildRepairBranchName` === `expectedBranch`
  for generations 1..3 with real and `null` previous commits.

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/autopilot-engine-repair-branch.test.sh
bash hooks/tests/campaign-dispatch-projection.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/autopilot-engine-park-reserve.test.sh
bash hooks/tests/autopilot-engine-boundary-resume.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(`hooks/tests/dispatch-detached-campaign-authority.test.sh`: run, record failing names before/after, set must not grow.)

## Allowed files
`src/engine/autopilot-engine.js` (the `implement` closure branch derivation ~:7394 and `buildRepairBranchName` ~:1176 only),
`src/engine/campaign-dispatch-projection.js` (only for the single-owner parity of item 2), their codex twins via the sync script,
`hooks/tests/autopilot-engine-repair-branch.test.sh` (new). Nothing else; no intake, no schema, no `bin/autopilot.js`.

Commit ONE commit on the branch you are on; do not touch other files; do not run sync scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the mirror in the same commit if it changed; run every verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh` you create must be `chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
