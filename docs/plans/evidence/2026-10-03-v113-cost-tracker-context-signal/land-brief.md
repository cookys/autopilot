Engine: sonnet

# Landing foreman — w113 (1 rows, 3 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad`, `RUN=$B/run3-land` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land3 && cd $B/land3 && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/v2.36.113 origin/develop && git config core.hooksPath .githooks && git config user.name cookys && git config user.email 2537196+cookys@users.noreply.github.com && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.** A landing clone without it never runs the pre-push qc-gate, and a release can ship with a broken trailer unnoticed (this happened once — see the skill's Rules learned).

**Author email is the GitHub noreply address `2537196+cookys@users.noreply.github.com` (name `cookys`)**: GitHub's email-privacy setting rejects a push authored as the gmail address (the v2.36.111 landing had to rewrite 10 commits). Never a test identity, never `--no-verify`.

Cherry-pick in order: d8de05d2, e3ae206f, b408b4b3 (row I, branch hands/w113/I in the unit remote).
NEVER pick `(none)` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> (w113 row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR` (or `exec git commit --amend -F <file>` keyed to each SHA), NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
Run the WHOLE suite when the change touches a widely-consumed contract — do not scope the gate to just the touched suites.
- `bash hooks/tests/run.sh --parallel 16 > RUN/full.log 2>&1; echo rc=$?` — ONCE per release. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun only the reds, solo (never rerun the whole suite after a repair — rerun the touched suites plus former reds). A red "L1 unit suite" is ONE line for every `*.test.js`: after a repair rerun the whole L1 layer (`node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js`), never just the one file you fixed — v2.36.107 shipped a red `statusline-live-tee.test.js` that way. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- New test fixtures that contain `reviewer_engine:` must be registered with the Population B gate (`hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh`); no per-row Verify runs it, only the full suite does (v2.36.111). Hands run that suite in their consumer sweep when they add such a fixture.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/w113.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/w113.diff --spec-file $B/clone/../run3/bundle-w113.md > RUN/w113.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.113). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the rows this bundle resolved (match by title, listed in the plan/bundle). Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  If the plan has now shipped entirely, run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. **Fill the trailer's review id from `RUN/w113.review.json` (or the round-2 review file if repaired) — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id from RUN/w113.review.json> plus depth-0 row acceptance, 2026-10-03)`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.

## Bundle-specific additions (depth-0)
- No implement-foreman REPORT: keep each hand commit subject, append ` (w113 row I)`.
- Known flake: `resolve-review-loop-consult-discuss-switch` Population B "stale entry autopilot-engine-repair-branch.test.sh" has appeared twice under parallel runs and passed on rerun; if it reds in the full run, rerun solo before treating it as real (and report it either way).
- Release commit BACKLOG: no row is resolved by this bundle except none (the cost-tracker defect was never registered) — ADD these rows (each with a short sidecar under docs/backlog/, per references/backlog-entry.md; check-backlog-entries must exit 0):
  1. "Population B switch suite flakes with a stale entry under parallel runs" (S, Trigger FIRED — seen twice 2026-10-03: w112 G check and w113 hand I; green on solo rerun; find the race, e.g. a grep over a tree another process mutates, or a shared temp path).
  2. "cost-tracker/cost-fuse pricing table has no fable row and opus-5.x rates are hard-coded unverified" (S, next touch of hooks/cost-tracker-lib.js; verify against official Anthropic pricing with URL; until then fable spend is undercounted in both hooks).
  3. "cost-fuse dispatch exemption prefix and session-id collisions" (S, next touch of hooks/cost-fuse.js): prefix admits an env assignment whose value is the rail path and any path prefix (warn-mode only, advisory); `safe()` may collide distinct ids.
  4. "dispatch-plan-review: terminal-ticket reuse is a silent 0-call run" — ALREADY EXISTS from the v2.36.112 closeout; do not duplicate.
- CHANGELOG (Traditional Chinese, like existing sections): cost-tracker 的警告不再把累積 cache read 說成 context 很重，附上真實 context %，只有 context % ≥ 50（可調 `cost_tracker.context_clear_pct`）才建議 /clear；cost-fuse 顯示本 session／全主機花費，派工豁免只在 warn 模式。
- `node scripts/sync-version.js --version 2.36.113 --hook-count 32 --skill-count 30` (verify counts first).
