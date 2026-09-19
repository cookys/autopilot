# Brief B — unit name for this run: `boundary-b` (repair: `boundary-b-r2`, retry: `boundary-b-retry`)
clone = /home/cookys/projects/autopilot-par2/b-boundary · base_sha = 14168cad6c352d3651e60104202b3faa1a6ff588 (clone HEAD, includes the shadow commit) · run_id = par3-b · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/b/run

# A managed campaign parked at BOUNDARY_REJECTED must be resumable into a re-dispatch, as its own message promises

BACKLOG row: "Managed rail: `boundary_rejected` says 're-dispatch once quiescent' but `--resume` from it always
terminalizes" (fired 2026-09-18, 2-A attempt 1: boundary_rejected after a 91-min hand round whose commit `30b69a1a`
was complete; resume refused `campaign resume from BOUNDARY_REJECTED cannot dispatch implementation` and terminalized).
Evidence: `docs/plans/evidence/2026-09-18-blind-review-panel-parallel/impl-run1-attempt1-boundary-rejected.json`,
`impl-run3-resume-refused.json`.

Depth-0 root cause (verify at base before coding, then fix the real one and say so if it differs):
- `src/engine/autopilot-engine.js:9759-9784`: `durableResumablePhases` includes BOUNDARY_REJECTED but the predicate also
  requires `campaignControl.generation_claim.resume_candidate`; when missing → rejection reason
  `campaign resume from ${phase} cannot dispatch implementation` → `terminalizeManagedCampaignFailure` → blocked.
- `src/engine/campaign-intake.js:1024-1032` sets `existing.resume_candidate` only when
  `existing.candidate_reference.kind === 'git_candidate'`; `candidate_reference` is populated from journal artifact
  references of kind `git_candidate` (`src/campaign/cli.js:914-917`), which only IMPLEMENTATION_COMPLETED writes.
- BOUNDARY_REJECTED fires from IMPLEMENTING/REPAIRING before IMPLEMENTATION_COMPLETED; its own event
  (`src/engine/campaign-composition.js:1728-1743`, reducer `src/engine/implementation-campaign.js:990-1027`) carries only
  `{reason, boundary_reason, candidate_ref, boundary_receipt_digest}` with artifact kind `campaign_boundary_rejected`,
  so `resume_candidate` is never recorded → resume can never re-dispatch.

## Product
1. RED first: an engine-suite case (model: `hooks/tests/dispatch-detached-campaign-authority.test.sh:1432-1447`
   `durableManagedControl()` fixture with `initial_state.phase = 'BOUNDARY_REJECTED'`, `generation_claim.resume_candidate:
   null`, and the resume-block naming convention of `hooks/tests/autopilot-engine.test.sh:5177-5279`) that at base
   records `status: blocked` with reason `campaign resume from BOUNDARY_REJECTED cannot dispatch implementation`.
2. Fix — record the candidate at rejection so the durable resume has one: when the boundary rejection happens AFTER the
   hand committed (the worktree is retained, the branch/commit exist), the BOUNDARY_REJECTED journal event must carry a
   `git_candidate`-shaped artifact reference (`commit`, `tree_sha`, `branch`, `writer_fence`, `repair_lineage` — the
   exact shape `verifyResumeCandidate` in `src/engine/campaign-intake.js:733-838` already validates) in addition to the
   boundary receipt binding, so that journal replay (`src/campaign/cli.js:882-918`) populates `candidate_reference` and
   `claimCampaignGeneration` records `resume_candidate` for that generation. The reducer (`implementation-campaign.js:990`)
   accepts and preserves it. When the rejection happens BEFORE any commit, keep today's behaviour but make the
   controller's `next_action`/message honest: say "no candidate — re-dispatch is a new attempt" instead of promising a
   resume.
3. `--resume` from BOUNDARY_REJECTED with a recorded candidate is admissible when `verifyResumeCandidate` passes
   (commit / tree / branch / writer_fence intact) and the sealed base is unchanged; it then continues the loop from the
   retained candidate exactly as a resume from AWAITING_DISPOSITION continues (verification → review), never dispatching
   a second implementation of the same generation. No new fingerprinting at resume time — the boundary rail is not in
   scope; a candidate that fails `verifyResumeCandidate` is refused with that function's own reason (today's code).
4. Keep every other reducer rule byte-identical (AWAITING_DISPOSITION, TERMINAL_STOP, MUTATION_FAILED, durable waits).
   Do not weaken `verifyResumeCandidate`. If `schemas/implementation-campaign-receipt.schema.json:125-170`
   (`implementation_campaign_boundary_rejected`, `additionalProperties:false`) must grow fields, edit it AND its codex twin
   in the same commit; the sync script mirrors `src/engine/*` and `schemas/*` under `platforms/codex/plugin/`.

## Tests (RED-first: run each new case against the unmodified code, record the exact observed output in a
`# RED at <base sha>: …` comment beside the assertion; never weaken or delete an existing assertion)
- NEW suite file `hooks/tests/autopilot-engine-boundary-resume.test.sh` (copy the harness prologue of
  `hooks/tests/autopilot-engine.test.sh`; do NOT append to that file — sibling units are editing it): the RED case of
  item 1; GREEN: with a recorded candidate the resume re-dispatches nothing new, runs verification/review, and the
  journal shows no TERMINAL_STOP; the no-candidate case still blocks with the honest message.
- NEW suite file `hooks/tests/implementation-campaign-state-boundary.test.sh` (copy the prologue of
  `hooks/tests/implementation-campaign-state.test.sh`; do NOT edit that file — sibling units own it): reducer pin —
  BOUNDARY_REJECTED with the git_candidate reference is accepted and `candidate_reference` survives replay; a
  BOUNDARY_REJECTED whose boundary digest is wrong is still refused (evidence rule not weakened).
- `hooks/tests/campaign-boundary-receipt-e2e.test.sh`: extend the existing e2e (`:279-502`) with a follow-up
  `claimCampaignGeneration({resume:true})` asserting `resume_candidate !== null`.

## Verify (foreground, all exit 0)
```
bash hooks/tests/autopilot-engine-boundary-resume.test.sh
bash hooks/tests/implementation-campaign-state-boundary.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/campaign-boundary-receipt-e2e.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/campaign-claim-resolve.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/campaign-terminalize.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(`hooks/tests/dispatch-detached-campaign-authority.test.sh` is a KNOWN RED at base — run it, record its failing
assertion names before and after, and require that the set does not grow; do not try to fix it.)

## Allowed files
`src/engine/campaign-composition.js`, `src/engine/implementation-campaign.js`, `src/engine/campaign-intake.js`,
`src/engine/autopilot-engine.js` (only the resume predicate zone ~:9700-9790 and the rejection message),
`src/campaign/cli.js` (journal replay + eligibility only), `schemas/implementation-campaign-receipt.schema.json`,
their codex twins under `platforms/codex/plugin/` via the sync script, `hooks/tests/autopilot-engine-boundary-resume.test.sh`
(new), `hooks/tests/implementation-campaign-state-boundary.test.sh` (new), `hooks/tests/campaign-boundary-receipt-e2e.test.sh`.
Nothing else. Do not touch `bin/autopilot.js`, `hooks/tests/autopilot-engine.test.sh`,
`hooks/tests/implementation-campaign-state.test.sh`, `scripts/lib/main-checkout-boundary.sh`, or any wall-budget code.

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
  mirror in the same commit if it changed; run every verify command in the foreground before committing; never set
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
- REPORT.md (write to `<run_dir>/REPORT.md`, ≤ 80 lines) must name: hand branch(es) and head sha(s), `diff --stat`
  vs base, the review verdict and every finding with accepted/refuted + one line why, the verify commands' tail lines
  as recorded in the dispatch JSON, anything NOT done, and any BACKLOG-row text you found to be wrong. Your final
  message to depth 0 is the REPORT.md content verbatim, nothing else.
