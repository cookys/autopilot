# Brief C — unit name for this run: `park-c` (repair: `park-c-r2`, retry: `park-c-retry`)
clone = /home/cookys/projects/autopilot-par2/c-park · base_sha = 56e2c097fcf6fd7898f65fb75205bf5a6d9b99a0 (clone HEAD, includes the shadow commit) · run_id = par3-c · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/c/run

# A park at `awaiting_disposition` must account for the repair round it authorises: name the shortfall, refuse a resume that cannot fit

BACKLOG row: "Managed rail: a park at `awaiting_disposition` reserves no wall for the repair round it authorises"
(fired 2026-09-18: 2-C shared-packet parked at 5435/7200 s — implement 60 min + verify 21 + panel 9; two must-fix
findings needed a repair round the remaining 1765 s could not fit, so depth-0 degraded to l3 instead of `--resume`).
Evidence: `docs/plans/evidence/2026-09-18-blind-review-shared-packet/README.md`, `impl-run1-awaiting-disposition.json`.
Depth-0 decision: NO new sealed-contract knob (no schema change). The reserve is DERIVED from round 1 and the rail
tells the truth at park time and refuses honestly at resume time.

Facts at base (verify):
- Park journaling: reducer `src/engine/implementation-campaign.js:1042-1056` (ADJUDICATING → AWAITING_DISPOSITION,
  payload `reason`, `findings_digest`, `candidate_ref`); the parked clock is frozen (v2.36.67,
  `WALL_CLOCK_PAUSED_STATES`, `campaignClockElapsedSeconds`, `:54-69`). The park payload/summary carries no
  wall-remaining or repair-cost field (evidence JSON: only `ledger[]` rows with `wall_secs`/`started_at`/`ended_at`).
- Resume preflight `src/engine/campaign-intake.js:1093-1121` refuses only when `elapsed >= max_wall_seconds`
  (`campaign_wall_budget_exhausted`); a remaining wall smaller than a repair round passes, and the round then burns until
  `autopilot-engine.js:7253-7261` (`campaign mutation budget exhausted`) — the panel-only reserve lives in
  `campaignWallBudgetStatus` (`autopilot-engine.js:1462-1490`, `consumer === 'panel'`).
- Round-1 costs are measurable from the ledger: `dispatch_implementation.wall_secs` (`autopilot-engine.js:4313-4332`),
  `campaign_verification` started_at/ended_at (~`:7983-8085`), `dispatch_review` per-seat started_at/ended_at.

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
