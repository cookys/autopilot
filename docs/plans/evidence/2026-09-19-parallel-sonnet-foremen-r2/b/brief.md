# Brief B — unit name for this run: `migrate-b` (repair: `migrate-b-r2`, retry: `migrate-b-retry`)
clone = /home/cookys/projects/autopilot-par3/b-migrate · base_sha = 488dc6dca085a26a7a0896a8b76352cfd883f396 (clone HEAD, includes the shadow commit) · run_id = par4-b · run_dir = /tmp/claude-1000/-home-cookys-projects-autopilot/38a23a44-ca0a-4350-96bd-315ba7dd269d/scratchpad/par4/b/run

# `migrate-backlog-entries.js` table migration must never invent a status, drop a column, or claim `preserved` for bytes it lost

BACKLOG row: "PEER-REPORTED (cuda): backlog table migration — unmapped Status → open, extra column dropped, gate 305 after"
(fired 2026-09-16; revival.3d dry-run on a real 196 KB table). Read the row (`grep -n "backlog table migration" docs/BACKLOG.md`).
Four defects, all confirmed at base by depth-0:
1. `scripts/migrate-backlog-entries.js:317` `statusMap[word] || DEFAULT_STATUS_MAP[word] || 'open'` — an unmapped status word
   silently becomes `open` (34 rows in the report).
2. `headerIndex` (`:363-371`) builds an index only for header cells whose `colMap[h] || h` is in `TABLE_FIELDS` (`:264`); a header
   column outside `## Columns` gets no index and its cells are read nowhere in the row loop (`:404-480`) — dropped in place (13 cells).
3. `applyWrites` (`:628-687`) sets `preserved:true` unconditionally on the no-sidecar branch (`:639`); the only byte-retention
   check (`:660-666`) runs only when sidecars exist. Manifest totals (`:484-492`, `:599-609`): `moved_bytes` counts only
   `moveVerbatim` calls, so `bytes_before − bytes_after ≠ moved_bytes` whenever a column is dropped.
4. `main()` (`:695-746`) never runs the gate after `--apply`; `check-backlog-entries.js` exports helpers but not `runCheck` (`:981-998`).
`references/backlog-entry.md:29` already promises "a row whose cells carry text the schema columns cannot hold moves its original row
line verbatim to a sidecar" — the code contradicts its own doc.

## Product
1. RED first, one new case (p) in `hooks/tests/migrate-backlog-entries.test.sh` modelled on cases (n) `:280-340` and (o) `:343-395`:
   a table fixture with (a) one row whose status word is in neither `## Status map` nor the defaults, (b) one header column absent
   from `## Columns` with non-empty cells, (c) a `--apply` run. At base assert the observed wrong outputs (`Status: open` for (a);
   the (b) cells absent from output AND from every sidecar; manifest `preserved:true`; `bytes_before − bytes_after ≠ moved_bytes`).
2. Fix, aligned to the doc: (a) an unmapped status word → the row goes VERBATIM to a sidecar and the run records an error entry
   (`unmapped_status`, word, line) in the manifest; `open` is never synthesised; the default dry-run lists them; `--apply` exits non-zero
   when any exist unless `--allow-unmapped-to-sidecar` (name it exactly so) is passed — then it moves them and still records the errors.
   (b) a header column outside `## Columns` and outside `TABLE_FIELDS` is an error at plan time (`unmapped_column`, header, cell
   count); nothing is written; the fix message names the `## Columns` line to add. (c) `preserved` is computed, never assumed: after
   the write, every byte of every input row is accounted as either present in the output, present in a sidecar, or explicitly
   listed as `dropped` (which must be empty on success); `bytes_before === bytes_after + moved_bytes` must reconcile exactly
   (whitespace normalisation counted separately as `normalized_bytes` if the script normalises anything — measure, do not guess).
   (d) `--apply` runs the gate on the output (export `runCheck` from `check-backlog-entries.js`, import it the way the other helpers
   are at `:32-41`) and fails the apply (restoring the original file from its in-memory copy) when the gate exit is non-zero;
   the gate report is embedded in the manifest.
3. `references/backlog-entry.md` table-style paragraph (`:29`): one sentence each for unmapped status and unmapped column.
4. Codex mirrors of both scripts and the reference via `bash scripts/sync-codex-plugin-skills.sh` (same commit). Heading-style
   migration (this repo's own config) must be byte-identical in behaviour: `node scripts/migrate-backlog-entries.js --backlog docs/BACKLOG.md --json`
   (dry-run is the default) before and after produces the same manifest except timestamp/run-id fields.

## Tests (RED-first, `# RED at <base sha>: …` beside each new assertion; never weaken an existing one)
- case (p) above → GREEN: sidecar holds the unmapped-status row verbatim, manifest lists `unmapped_status` + `unmapped_column`
  errors, `--apply` refuses without the flag and succeeds with it, `preserved` reflects reality, bytes reconcile, gate embedded.
- a negative control: a fully mapped table (case (n)'s fixture) still migrates with zero errors and identical output to base.

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/migrate-backlog-entries.test.sh
bash hooks/tests/check-backlog-entries.test.sh
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
node scripts/migrate-backlog-entries.js --backlog docs/BACKLOG.md --json   # dry-run is the default; --apply is the only writer
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```
(if a suite name above does not exist, `ls hooks/tests | grep backlog` and run every match.)

## Allowed files
`scripts/migrate-backlog-entries.js`, `scripts/check-backlog-entries.js` (export only), `references/backlog-entry.md`, their codex
twins under `platforms/codex/plugin/` via the sync script, `hooks/tests/migrate-backlog-entries.test.sh`. Nothing else; do not edit
`docs/BACKLOG.md` or `.claude/backlog-config.md`.


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
