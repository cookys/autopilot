Engine: sonnet

# Landing foreman — w111 (4 rows, 8 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad`, `RUN=$B/run-land` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land && cd $B/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/v2.36.111 origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.** A landing clone without it never runs the pre-push qc-gate, and a release can ship with a broken trailer unnoticed (this happened once — see the skill's Rules learned).

Cherry-pick in order: 779a8f5d (A), ea71eee6 (C), 7f06ad8c (C-r2), 4c3b7a71 (A-r2), fdf52225 (A3), d1700c56 (A3 repair), 655a3b02 (B), 81f22a61 (D) — fetch them from the unit remote by SHA (they are on branches hands/w111/{A,C,C2,A2,A3,B,D} (A3 holds two commits); hands/w111/AC is a depth-0 scratch stack, never pick it).
NEVER pick `(none — this bundle used no shadow commit)` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> (w111 row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR` (or `exec git commit --amend -F <file>` keyed to each SHA), NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
Run the WHOLE suite when the change touches a widely-consumed contract — do not scope the gate to just the touched suites.
- `bash hooks/tests/run.sh --parallel 16 > RUN/full.log 2>&1; echo rc=$?` — ONCE per release. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun only the reds, solo (never rerun the whole suite after a repair — rerun the touched suites plus former reds). A red "L1 unit suite" is ONE line for every `*.test.js`: after a repair rerun the whole L1 layer (`node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js`), never just the one file you fixed — v2.36.107 shipped a red `statusline-live-tee.test.js` that way. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/w111.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/w111.diff --spec-file $B/clone/../run/bundle-w111.md > RUN/w111.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.111). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the rows this bundle resolved (match by title, listed in the plan/bundle). Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  If the plan has now shipped entirely, run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. **Fill the trailer's review id from `RUN/w111.review.json` (or the round-2 review file if repaired) — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id from RUN/w111.review.json> plus depth-0 row acceptance, 2026-10-03)`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.

## Bundle-specific additions (depth-0)
- There is no REPORT.md from an implement foreman: depth-0 ran the hands directly. Take reword content from `$B/run/bundle-w111.md` and each commit's own message. Keep each hand commit's subject; append ` (w111 row <A|C|C-r2|A-r2|A3|B|D>)`.
- The release commit's BACKLOG edit:
  - DELETE these three rows (match by title) and their sidecars (`docs/backlog/campaign-resume-reviewing-phase-and-zero-write-budget.md`, `docs/backlog/review-seat-max-tokens-exhausted-by-thinking.md`, `docs/backlog/final-panel-resume-reruns-all-seats.md`) — only if no other row points at them:
    "`campaign resume` refuses a final-panel retry: REVIEWING unsupported; zero-write resume hits file cap", "Reviewer seats at max effort can spend the whole 4096-token output budget on thinking and return no text", "Final-panel resume after a seat transport failure re-runs every seat, discarding valid verdicts".
  - ADD the two rows in `$B/run/backlog-new/ROWS.md` (place them where the deleted peer rows were) and copy `$B/run/backlog-new/boundary-rejected-campaign-cannot-reach-terminal-success.md` into `docs/backlog/`. If `check-backlog-entries.js` rejects `Pointer: —`, use whatever the checker accepts for "no sidecar" (read its header) — do not invent a sidecar.
- CHANGELOG lines (user-facing, problem first): REVIEWING resume after a transient final-panel fault; review-only resume no longer hits the changed-file cap; final-panel resume reuses valid seat verdicts (re-derived from the stored artifact bound to the same packet, re-qualified, per-seat attempt budget 3); max-effort reviewer output budget 16384 and `output_budget_exhausted`; symlinked TMPDIR no longer breaks agy author dispatch or the polarity receipt; a gate rejects lib.sh suites that never finalize (7 known always-green suites allowlisted). Known follow-ups: the boundary-rejected terminal-audit defect (new BACKLOG row) and the review 🔵s.
- The full suite runs with the new `test-suite-finalize-gate.test.sh` included; it must be green.
- Reword `d1700c56` to `fix(tests): finalize gate counts a bare FAIL test only as the last command; a node exitCode is no longer a finalizer (w111 row A3 repair)` — its original subject wrongly says the exitCode rule was restricted; it was dropped.
