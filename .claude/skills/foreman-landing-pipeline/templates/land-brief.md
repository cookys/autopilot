Engine: sonnet

# Landing foreman — {{BUNDLE_NAME}} ({{ROW_COUNT}} rows, {{HAND_COMMIT_COUNT}} hand commits)

`B={{SCRATCH}}`, `RUN=$B/run-land` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `{{REPO}}` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q {{REPO}} $B/land && cd $B/land && git remote set-url origin "$(git -C {{REPO}} remote get-url origin)" && git fetch -q origin && git checkout -q -B {{RELEASE_BRANCH}} origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.** A landing clone without it never runs the pre-push qc-gate, and a release can ship with a broken trailer unnoticed (this happened once — see the skill's Rules learned).

Cherry-pick in order: {{PICK_LIST}}.
NEVER pick `{{SHADOW_SHA}}` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> ({{BUNDLE_NAME}} row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR` (or `exec git commit --amend -F <file>` keyed to each SHA), NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
Run the WHOLE suite when the change touches a widely-consumed contract — do not scope the gate to just the touched suites.
- `bash hooks/tests/run.sh --parallel 16 > RUN/full.log 2>&1; echo rc=$?` — ONCE per release. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun only the reds, solo (never rerun the whole suite after a repair — rerun the touched suites plus former reds). Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/{{TAG}}.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/{{TAG}}.diff --spec-file $B/clone/{{PLAN_PATH}} > RUN/{{TAG}}.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect {{VERSION_EXPECT}}). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the rows this bundle resolved (match by title, listed in the plan/bundle). Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  If the plan has now shipped entirely, run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. **Fill the trailer's review id from `RUN/{{TAG}}.review.json` (or the round-2 review file if repaired) — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id from RUN/{{TAG}}.review.json> plus depth-0 row acceptance, {{DATE}})`
  `{{CO_AUTHORED_BY_TRAILER}}`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.
