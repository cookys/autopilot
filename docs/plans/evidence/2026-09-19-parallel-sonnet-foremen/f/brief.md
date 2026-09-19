# Brief F — unit name for this run: `suites-f` (repair: `suites-f-r2`, retry: `suites-f-retry`)
clone = /home/cookys/projects/autopilot-par2/f-suites · base_sha = 4360c58b2303e8ad5b8d4c7cc942c170d7bc0288 (clone HEAD, includes the shadow commit) · run_id = par3-f · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/f/run

# `provider-readiness-consumer` and `autopilot-cli` suites must be hermetic — they track the host's live review-loop config today

BACKLOG row: "provider-readiness-consumer / autopilot-cli suites track the live review-loop config — red since acf3b06c"
(5 + 33–36 failures at base; `resolveReviewLoopJson(['--check-scorecard'])` inside the suites exits 3 because the
host's cursor implementer has no row in the capability dir the sandbox sees). Evidence:
`docs/plans/evidence/2026-09-16-agy-effort-rail-wording/README.md` (`verify-prc-base.log`, `verify-autopilot-cli-base.log`).

Facts at base (verify): `hooks/tests/provider-readiness-consumer.test.sh:648-655` calls
`resolveReviewLoopJson(['--check-scorecard'], { cwd: root, env: process.env })` with the live env — no
`REVIEW_LOOP_CONFIG_OVERRIDE`, no `ENGINE_SCORECARD_DIR`. `hooks/tests/autopilot-cli.test.sh:497,502` already uses the
hermetic pair `ENGINE_SCORECARD_DIR="/empty-scorecard" REVIEW_LOOP_CONFIG_OVERRIDE=""` for two direct
calls, but its strict-L5/L4/L6 executable-fixture blocks (first at `:205-222`, `createStrictL5ProviderBootstrap`) reach
`--check-scorecard` without the override and inherit the host's scorecard state → the `"strict_l5_provider_readiness":
{"status":"ready"}` bundle never materialises. The same seam is used pervasively in `hooks/tests/resolve-review-loop.test.sh`,
`contract-parity.test.sh`, `dispatch-consult.test.sh`, `calendar-teeth-negative.test.sh`.

## Product
1. RED first: at base, record the exact failing assertion names of both suites (`bash hooks/tests/<suite> 2>&1 | grep
   FAIL`) into a comment block at the top of each suite's new hermetic-fixture section (`# RED at <base sha>: N FAIL — …`).
2. Make both suites hermetic: a fixture review-loop config (`REVIEW_LOOP_CONFIG_OVERRIDE`) whose roster names ONLY
   engines the fixture scorecard dir (`ENGINE_SCORECARD_DIR`) qualifies, built inside `TEST_TMP` by the suite itself
   (copy the shape from `autopilot-cli.test.sh:497,502` and `resolve-review-loop.test.sh`), applied to every
   `resolveReviewLoopJson` / `--check-scorecard` / strict-bootstrap call in both suites. Expectations become
   host-independent: nothing in either suite may read `.claude/review-loop-config.md`, `~/.autopilot`, or the host
   capability dir. If a strict-L5/L6 fixture needs a qualified row for a specific role, the suite WRITES that row into
   its own scorecard dir (find the writer the qualification suites use — `hooks/tests/engine-qualify*.test.sh` /
   `engine-capability-state` — and reuse it; never point at the host's dir).
3. Prove hermeticity: each suite gets one negative control — run the same block with the host's live env and an
   intentionally EMPTY `ENGINE_SCORECARD_DIR` and assert the fixture path still passes (i.e. the suite's verdict does
   not depend on what the host has qualified). Do NOT loosen any assertion that today checks a specific status,
   digest, phase or rejection code — fix the fixture, not the expectation. If an assertion turns out to be a genuine
   product defect (fails even with a fully qualified fixture), do NOT patch `src/`: leave it failing, name it in
   REPORT.md under "genuine reds", and stop there — that is a separate row.
4. Hermeticity also for `hooks/tests/lib.sh` helpers only if both suites need the same builder; otherwise keep the
   fixture local to each suite. No product code changes; no other suites.

## Tests
The two suites ARE the tests. Verify each runs green in a clean env (`env -i HOME=$HOME PATH=$PATH bash hooks/tests/<suite>`)
AND in the normal env, from inside the clone, and that `grep -c "review-loop-config.md\|\.autopilot" hooks/tests/provider-readiness-consumer.test.sh hooks/tests/autopilot-cli.test.sh`
shows only fixture paths under `TEST_TMP`.

## Verify (foreground, all exit 0)
```
bash hooks/tests/provider-readiness-consumer.test.sh
bash hooks/tests/autopilot-cli.test.sh
env -i HOME="$HOME" PATH="$PATH" bash hooks/tests/provider-readiness-consumer.test.sh
env -i HOME="$HOME" PATH="$PATH" bash hooks/tests/autopilot-cli.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/status-task.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`hooks/tests/provider-readiness-consumer.test.sh`, `hooks/tests/autopilot-cli.test.sh`, `hooks/tests/lib.sh` (a shared
fixture builder only if both need it). Nothing else — NO `src/`, `scripts/`, `bin/`, `schemas/` or config edits; if the
sync check flags a mirror, you touched something you must not have.

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
