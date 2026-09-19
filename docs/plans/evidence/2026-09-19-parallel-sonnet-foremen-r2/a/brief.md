# Brief A — unit name for this run: `resume-a` (repair: `resume-a-r2`, retry: `resume-a-retry`)
clone = /home/cookys/projects/autopilot-par3/a-resume · base_sha = ff6037bfadeb2749d112ca985d4548cd67c1c07b (clone HEAD, includes the shadow commit) · run_id = par4-a · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par4/a/run

# The managed rail must derive the repair-round branch itself — on every round ≥ 2, resumed or not

BACKLOG row: "Managed rail: a disposition resume into a repair round refuses the caller's --branch (expects the derived one)" (fired
2026-09-16): `--resume --campaign-disposition-authority` with must-fix-now findings passes intake → REPAIR_AUTHORIZED, then
`prepare_implementation` fails `caller branch disagrees with campaign stage (expected <branch>-repair-r2-<sha7>)`.

Facts at base (depth-0 verified; re-verify before coding) — the row's framing is too narrow, fix the real thing:
- `expectedBranch` (`src/engine/campaign-dispatch-projection.js:108-111`): generation 0 → `campaignBranch`; else
  `${campaignBranch}-repair-r${generation+1}-${base.slice(0,7)}`. `deriveCampaignDispatchUnit` (`:438-467`) throws the exact string
  at `:462-464` when the caller branch differs. It only runs when the sealed contract is strict (`hasCampaignDispatchAuthority`,
  `:351-355`; gate at `autopilot-engine.js:3792`).
- `buildRepairBranchName` (`src/engine/autopilot-engine.js:1176-1179`) exists and the NON-managed loop uses it every round
  (`:10190-10195`). The MANAGED loop `_runManagedCampaignComposition` (`:4637-9218`) never does: its `implement` closure sets
  `const currentBranch = branch;` (`:7394-7395`) and passes it to `implementTask` (`:7521-7527`) with
  `implementationRound: candidateImplementationRound` → `resolveImplementationLedgerStage` (`:246-261`) yields
  `campaign-implementation#r<round>` → generation ≥ 1 → `expectedBranch` demands the suffix the branch never carries.
  So the mismatch fires on the FIRST in-run repair round of any strict campaign too, not only on resume.
- Intake (`campaign-intake.js:2247-2252`) rightly requires the caller's `--branch`/`--base` to equal the sealed contract's on every
  invocation (campaign identity) — the caller must NOT be asked to pass the derived name. sha7 = the round's base commit
  (`currentBase`: the prior round's committed candidate, or `resumeCandidate.commit` on resume, `:4700`), never `contract.base_sha`.

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


## How you work (foreman rules — identical for every unit)
- You ORCHESTRATE. You never edit code yourself, never merge, never push, never checkout, never `cd` the main
  checkout. All product work is done by ONE hand you dispatch; you verify by git artifacts (`git -C <clone> diff --stat`,
  `git -C <clone> log`, the hand's result JSON), never by its self-report. Depth 0 reaches the verdict from git after you
  finish. Every git/script command runs against YOUR clone: `git -C <clone> …` and `cd <clone> && bash scripts/…`.
- Your clone carries one clone-local commit ("PARALLEL-RUN LOCAL ONLY … enforcement_mode shadow") on top of the base;
  `<base_sha>` for the hand is that clone HEAD (given at the top of the brief). Depth 0 cherry-picks the hand's commit
  only; the shadow commit is never merged. Do not touch `.claude/owner-kernel-governance.json`.
- Hand dispatch (exact form; substitute <unit>, <clone>, <run_dir>, <base_sha>; keep every other flag). Run it with the
  Bash tool's `run_in_background: true` (it takes up to 40 min; a foreground call would time out) and **in the same
  turn** start a dead-man's switch, also `run_in_background: true`: `sleep 3000; echo WAKE-<unit>`. Then END YOUR TURN
  and wait for the harness notification (either one). Never foreground-poll, never `sleep` in the foreground, never
  read the background task's output file with a shell command.
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-hetero.sh --branch hands/<run_id>/<unit> --base <base_sha> --ledger <run_dir>/hands.ledger --run-id <unit> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.dispatch.json 2> <run_dir>/<unit>.dispatch.err; echo "rc=$?" >> <run_dir>/<unit>.dispatch.err`
  Write `<run_dir>/hand-<unit>.md` first (one heredoc): paste the "Product", "Tests", "Verify" and "Allowed files"
  sections below VERBATIM plus: "Commit ONE commit on the branch you are on; do not touch other files; do not run sync
  scripts on the codex mirror by hand — run `bash scripts/sync-codex-plugin-skills.sh` then `--check` and include the
  mirror in the same commit if it changed; run every verify command in the foreground before committing (each with `< /dev/null`); every NEW `*.test.sh` you create must be `chmod +x` and must pass `test -x` — `run.sh` refuses 100644 suites; never set
  `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run."
  On ANY wake (notification or dead-man): first `grep -c '^rc=' <run_dir>/<unit>.dispatch.err`. If 0 the hand is
  still running (the dispatch is detached and lands its result in the ledger even if the shell was killed): run
  `cd <clone> && node scripts/wait-dispatch-results.js --ledger <run_dir>/hands.ledger --expect <unit>.implement --timeout 500 --json`
  in the foreground once; if it reports landed, read the result from the ledger/dispatch JSON; if not, start another
  background dead-man (`sleep 1500; echo WAKE-<unit>`) and end your turn — at most 3 extra waits, then ESCALATION.md.
  When the result is there: read `<run_dir>/<unit>.dispatch.json` with `head -c 3000` (status, branch, head sha, acceptance) — never
  the raw hand log. `status: implemented` + `git -C <clone> log --oneline <base_sha>..hands/<run_id>/<unit>` showing
  exactly one commit is the only success signal.
- Review (decorrelated family, required before you report done): produce the diff with
  `git -C <clone> diff <base_sha>..hands/<run_id>/<unit> > <run_dir>/<unit>.diff` and run (also `run_in_background`
  + a `sleep 1200; echo WAKE-review-<unit>` dead-man; append `; echo "rc=$?" >> <run_dir>/<unit>.review.err` the same way):
  `cd <clone> && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file <run_dir>/<unit>.diff --spec-file <run_dir>/hand-<unit>.md > <run_dir>/<unit>.review.json 2> <run_dir>/<unit>.review.err`
  Read the verdict with `node -e` printing only `verdict`, and each finding's severity + title (never the whole JSON).
  If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on branch
  `hands/<run_id>/<unit>-r2` with `--base <head sha of hands/<run_id>/<unit>>` and `--run-id <unit>-r2`, prompt =
  the original hand prompt + "## Repair round — fix these review findings" listing them verbatim; re-review the delta
  (`git diff <r1 head>..hands/<run_id>/<unit>-r2`). At most one repair round; then report.
- Budget: 40 Bash calls total (a guard denies the 41st). Plan them: write prompt (1), dispatch+deadman (2), read
  result (1), log/diff-stat (2), review+deadman (2), read verdict (1), optional repair (6), report (1). Do NOT read
  large files into your context; use `head`/`grep -n`/`sed -n`.
- If the hand fails before committing (precondition_failed, transport error, acceptance_failed with no commit), read
  `<unit>.dispatch.err` tail and the failure reason, then dispatch ONE retry with the same prompt plus the failure
  reason appended (`--run-id <unit>-retry`, branch `hands/<run_id>/<unit>-retry`). Two failures ⇒ write ESCALATION.md
  (exact reason, what you tried) and stop.
- Before you write REPORT.md, run the consumer sweep yourself (evidence-discipline §37/§39) in ONE Bash call: `cd <clone> && for s in $(grep -l '<identifiers the hand renamed/added/removed>' hooks/tests/*.test.sh | grep -v -e <each Verify suite>); do bash "$s" > <run_dir>/sweep.$(basename $s).log 2>&1 < /dev/null; echo "rc=$? $s"; done > <run_dir>/sweep.txt`; then `grep -v '^rc=0' <run_dir>/sweep.txt` and list the red ones in REPORT.md with their failing assertion names (`grep ^FAIL`). Do not fix them yourself; depth-0 decides.
- REPORT.md (write to `<run_dir>/REPORT.md`, ≤ 80 lines) must name: hand branch(es) and head sha(s), `diff --stat`
  vs base, the review verdict and every finding with accepted/refuted + one line why, the verify commands' tail lines
  as recorded in the dispatch JSON, anything NOT done, and any BACKLOG-row text you found to be wrong. Your final
  message to depth 0 is the REPORT.md content verbatim, nothing else.
