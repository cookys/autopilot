# Brief A — unit name for this run: `wall-a` (repair: `wall-a-r2`, retry: `wall-a-retry`)
clone = /home/cookys/projects/autopilot-par2/a-wall · base_sha = 2042c2b122408095d2b72596db5705aca5cb041a (clone HEAD, includes the shadow commit) · run_id = par3-a · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/a/run

# A managed campaign whose wall expires must reach a journaled terminal disposition and always write its summary JSON

BACKLOG row: "A managed campaign whose wall expires leaves no terminal summary and no journal disposition" (fired twice
2026-08-30: the leaf committed, `max_wall_seconds` elapsed before the review round, `engine implement-review` ended
with 0-byte stdout, campaign sits at `phase=IMPLEMENTING, activity=dead, wall_seconds_remaining=0` with a held lease
and a live Mission claim). Sidecar: `docs/backlog/a-managed-campaign-whose-wall-expires-leaves-no-terminal-summary-and-no-journal.md`.
v2.36.70 (`git show faf738ee`) fixed the sibling: an `acceptance_failed` hand now journals `MUTATION_FAILED` through
`AutopilotEngine.terminalizeManagedCampaignFailure` (`src/engine/autopilot-engine.js:2767-2911`) with the digest-bound
`campaign_terminal` reference (`boundCampaignArtifactDigest`, `implementation-campaign.js:246-278`) and surfaces
`status: acceptance_failed` (`:8936-8953`, `journaledAcceptanceFailure`). Wall expiry must reuse that path.

Depth-0 findings at base (verify, then fix the real cause if it differs and say so):
- The in-loop wall checks never terminalize. `autopilot-engine.js:9886-9910` (per-round before dispatch),
  `:7842` (before verification), `:5001-5023` (before review, managed), `:10287/:10313` (before review, legacy path)
  all return a bare `finish({status:'blocked', phase:'campaign_wall_budget', …})` / `{passed:false}` — no journal
  event, lease still held, `campaignControl.terminal_failure` unset; only the composition-status branch
  (`:8505`, `:9781`) ever calls `terminalizeManagedCampaignFailure`.
- The implementation dispatch carries NO `--timeout` derived from the wall (`buildImplementationArgs`, ~:895-960:
  the allowed-flag list has no `--timeout`), unlike review (`:5014`, `:10312` clamp `--timeout` to the wall
  remainder). A 60-min hand under a 3600 s wall therefore runs past the wall; the loop only regains control when the
  hand returns, and an external deadline kill of the `node bin/autopilot.js` process yields the observed 0-byte
  stdout (`bin/autopilot.js:9014-9019` is the only summary writer and runs only after the loop returns).
- The reducer's own `WALL_BUDGET_EXCEEDED` throw (`implementation-campaign.js:754-755`) is caught at every
  `recordCampaignEvent` site and turned into `blocked / campaign_event_journal` — again no disposition.

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
