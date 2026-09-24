Engine: sonnet

# Landing foreman — B1 review-loop-resolver-a (7 BACKLOG rows, 8 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/b1`, `RUN=$B/run-land` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land && cd $B/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/b1 origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`
Cherry-pick in order: `789c7f6a` (row 23), `09a47301` (36), `2678cf10` (41), `e4c3e1dc` (42), `65527b86` (43), `28b25cb8` (44), `82e9dc04` then `05f4f20e` (row 54 and its repair; you may squash these two).
NEVER pick `56189ee6` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> (backlog B1 row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR`, NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates. `resolve-review-loop.sh` is consumed widely, so run the WHOLE suite.
- `bash hooks/tests/run.sh --parallel 8 > RUN/full.log 2>&1; echo rc=$?`. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun every red solo. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/b1.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/b1.diff --spec-file $B/clone/docs/plans/2026-09-21-backlog-review-loop-resolver-a.md > RUN/b1.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, stop and report them.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.96). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the 7 rows whose titles start with:
  - "`probe-unknown.js classify` spawns"
  - "resolve-review-loop.sh: audit every remaining"
  - "resolve-review-loop.test.sh capability-warning"
  - "`normalize_agy_alias()` rewrites"
  - "`resolve-review-loop.sh` `auto` knobs read"
  - "`contract-parity` / `resolve-review-loop-consult-discuss-switch` tests read"
  - "`resolve-review-loop-consult-discuss-gate` case (xix)"

  Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  The B1 plan `docs/plans/2026-09-21-backlog-review-loop-resolver-a.md` has now shipped entirely, so run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it
  and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <review run id> plus depth-0 row acceptance, 2026-09-25)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.
