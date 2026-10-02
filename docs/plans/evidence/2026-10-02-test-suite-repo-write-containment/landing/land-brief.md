Engine: sonnet

# Landing foreman — test-suite repo write containment (6 rows, 13 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/trwc`, `RUN=$B/run-land` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land && cd $B/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/trwc origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.** A landing clone without it never runs the pre-push qc-gate, and a release can ship with a broken trailer unnoticed (this happened once — see the skill's Rules learned).

Cherry-pick in order: 362d2a45 (row 0), 1c89c87c + c6755303 (row 1), 2c0597e6 + 183c6e9e (row 2), 9badd71f + 414ef8ac (row 3), bec1c3bc + 5d5785fb (row 4a), 8b222da3 + 9a8e1414 (row 4b), 8ff995fa + e0cf0511 (row 1-r3) — exactly these 13, in this order; they are stacked. Squash each row's picks into ONE commit (7 commits total).
NEVER pick `63c4caeb` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> (test-suite repo write containment row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR` (or `exec git commit --amend -F <file>` keyed to each SHA), NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
Run the WHOLE suite when the change touches a widely-consumed contract — do not scope the gate to just the touched suites.
- `bash hooks/tests/run.sh --parallel 8 > RUN/full.log 2>&1; echo rc=$?`. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun every red solo. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/trwc.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/trwc.diff --spec-file $B/clone/docs/plans/2026-10-02-test-suite-repo-write-containment.md > RUN/trwc.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect v2.36.105 (read origin; another session may have taken it)). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the rows this bundle resolved (match by title, listed in the plan/bundle). Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  If the plan has now shipped entirely, run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. **Fill the trailer's review id from `RUN/trwc.review.json` (or the round-2 review file if repaired) — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id from RUN/trwc.review.json> plus depth-0 row acceptance, 2026-10-02)`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.

## Bundle-specific notes (depth-0)
- This bundle CHANGES `hooks/tests/run.sh` itself: the full suite now runs inside a disposable snapshot (`${TMPDIR}/autopilot-test-snapshot.*/repo`). This landing is its first real full-suite use. Before and after the gate run, record in RUN: `git -C $B/land config --local --list`, `git -C $B/land for-each-ref | sha256sum`, `git -C $B/land status --porcelain`. All three must be identical (the outer guard should also have said nothing). After the run, `ls -d ${TMPDIR:-/tmp}/autopilot-test-snapshot.* 2>/dev/null` must be empty.
- Gate run twice, one after the other (never in parallel): (a) default (snapshot on) and (b) `AUTOPILOT_TEST_SNAPSHOT=0` (in place; expect the `test-snapshot: disabled` line). Compare both red sets to the pre-existing list: `engine-qualify` and `resolve-review-loop` are known load timeouts (solo-green). Anything else red only on the branch → bisect and STOP.
- `hooks/tests/test-snapshot.test.sh` went red once in the implement verify (`P4 pgid: SIGINT to inner group is trapped (130): expected 130, got 0`), green twice after. Run it solo 6 times in a row and record each rc. Any red → STOP and report (depth-0 decides whether it is a race in run.sh's signal handling or a test-timing flake). Tell the reviewer about this in the review spec.
- The new `.githooks/pre-commit`/`pre-merge-commit`/`pre-push` identity gate is live in this clone (hooksPath). Your commits must use the real identity (`git var GIT_AUTHOR_IDENT` should show cookys); never set a test identity and never use `--no-verify`.
- Review spec additions (append to a copy of the plan used as `--spec-file`): "Check every signal/trap path in hooks/tests/run.sh for races between child start and trap install; check that no new test writes outside its own mktemp dir (a hand's test already wrote a stray tracked.txt once); check the pre-push commit-set algorithm against a new branch, a deleted ref (all-zero local sha), and a force-push."
- BACKLOG: this bundle resolves no existing row. Do NOT add rows (closeout does). Plan graduates: run `check-plan-graduation.js --fix` per step 4.
- CHANGELOG: list the four open nits from `$B/run/REPORT.md` ("Open nits") as known follow-ups, plus whatever the combined review raises as 🔵/🟡.
