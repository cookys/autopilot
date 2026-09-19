# Brief G — unit name for this run: `planreview-g` (repair: `planreview-g-r2`, retry: `planreview-g-retry`)
clone = /home/cookys/projects/autopilot-par2/g-planreview · base_sha = 15ae809f898104212d14dfb4cce1869c0dc17ed1 (clone HEAD, includes the shadow commit) · run_id = par3-g · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par3/g/run

# Two small rows: a plan-review seat killed by a precondition must record the precondition's reason; the secret-scan suite must not plant key literals

Row 1 — "/l5 recipe: set the l5 marker AFTER the plan hetero loop — under it codex seats are refused as non-strict
dispatch" (fired 2026-09-15). The recipe order is already corrected (`skills/l5/references/hetero-impl-loop.md` 5b); the
residual is the rail: the seat artifact recorded EMPTY stdout and `transport_exhausted` instead of the reason
`active session-mode=l5 blocks non-strict dispatch`. Facts at base (verify): `scripts/dispatch-plan-review.js:1058-1106`
(`dispatchSeat`) spawns `dispatch-author.sh`, parses its stdout JSON into `authorEnvelope` (`:1071-1076`) but builds
`raw` only from `authorEnvelope.raw_log` (`:1077-1080`); on `die_precondition` (`scripts/dispatch-author.sh:452-478`,
exit 2, reason in the envelope's `.error` on STDOUT) `raw_log` is null → `raw = Buffer.alloc(0)`, `child.stderr` is the
real (empty) stderr, so `src/transport/runner-envelope.js:167-174` classifies `exit_failure` and retries fold into
`transport_status: 'transport_exhausted'` (`:1852,1855,1867,1989`). Schema `schemas/plan-review-artifact.schema.json`:
`transport_status` enum `complete|transport_exhausted|policy_stop` (`:60-63`), `policy_reason` (`:64`, 1–512 chars).

Row 2 — "`secret-scan-diff.test.sh` plants key literals in-repo — the scanner's own fixture is a finding on diffs
touching it" (v2.36.70 release-range scan exited 1 naming the suite). Literals: `hooks/tests/secret-scan-diff.test.sh`
lines 16, 25, 87, 102 (`sk-ant-1234567890123456789012345`) and 52 (`AKIAIOSFODNN7EXAMPLE`).

## Product
1. RED first (row 1), in `hooks/tests/dispatch-plan-review.test.sh` (model: the `transport_exhausted` cases at `:425`,
   `:639`, `:1395` and their fake `dispatch-author` seam): a seat whose dispatch-author exits 2 with a precondition
   envelope `{"status":"precondition_failed","error":"active session-mode=l5 blocks non-strict dispatch (repo=…)"}` and
   empty raw_log — at base the seat record shows empty output and the artifact ends `transport_exhausted` with no trace
   of the reason. Record the observed output in the RED comment.
2. Fix: `dispatchSeat` carries the author envelope's `status` and `error` into the seat's transport record — when the
   envelope is a `precondition_failed` (or any non-`authored` status with an `error`), the seat outcome is a NEW
   classification `precondition_failed` (not `exit_failure`), it is NOT retried (a precondition does not heal by
   retrying), and the seat record + artifact carry the reason verbatim: seat-level `error`/`reason` field, and at the
   artifact level `transport_status: 'transport_exhausted'` stays (do NOT widen the enum) while `policy_reason` names
   it (`seat <id> precondition_failed: active session-mode=l5 blocks non-strict dispatch …`, truncated to 512). If the
   seat-record schema (`schemas/plan-review-artifact.schema.json` or a seat sub-schema with `additionalProperties:false`)
   blocks a new seat field, add the optional field to the schema AND its codex twin in the same commit; never store the
   reason only in a log.
3. Row 2: rewrite the five literals as runtime concatenation (`SK="sk-ant-""1234567890123456789012345"`,
   `AK="AKIA""IOSFODNN7EXAMPLE"`, or `printf` of two halves) so no complete key-shaped token exists in the tree; the
   suite's assertions keep testing the same behaviour (the scanner must still detect the assembled secret at runtime).
   Then prove it: `node scripts/secret-scan-diff.js --files hooks/tests/secret-scan-diff.test.sh` (read its header for
   the exact flag) exits 0 on the rewritten file and `bash hooks/tests/secret-scan-diff.test.sh` is green.
4. Codex mirrors of every touched script/schema via `bash scripts/sync-codex-plugin-skills.sh` (same commit).

## Tests (RED-first; `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- `hooks/tests/dispatch-plan-review.test.sh`: the RED case → seat outcome `precondition_failed`, zero retries, reason in
  the seat record and in `policy_reason`; existing `transport_exhausted` cases unchanged.
- `hooks/tests/secret-scan-diff.test.sh`: same assertions, literals gone; add one assertion that the scanner over the
  suite file itself reports nothing.

## Verify (foreground, all exit 0)
```
bash hooks/tests/dispatch-plan-review.test.sh
bash hooks/tests/secret-scan-diff.test.sh
node scripts/secret-scan-diff.js --files hooks/tests/secret-scan-diff.test.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/plan-review-transport-fallback.test.sh
bash hooks/tests/plan-review-transport-fixes.test.sh
bash hooks/tests/plan-review-panel-status.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(all four plan-review suites listed above are real; run each.)

## Allowed files
`scripts/dispatch-plan-review.js` (ONLY `dispatchSeat` ~:1058-1106 and the seat/transport folding at ~:1840-1870/1989 —
a sibling unit may add status `truncated` elsewhere in the file; do not touch `dispatch-author.sh`),
`src/transport/runner-envelope.js` (classification only), `schemas/plan-review-artifact.schema.json`, their codex twins
under `platforms/codex/plugin/` via the sync script, `hooks/tests/dispatch-plan-review.test.sh`,
`hooks/tests/secret-scan-diff.test.sh`. Nothing else.

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
