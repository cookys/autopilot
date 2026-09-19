
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
