Engine: sonnet

# Landing foreman — w112 (4 rows, 9 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad`, `RUN=$B/run2-land` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land2 && cd $B/land2 && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/v2.36.112 origin/develop && git config core.hooksPath .githooks && git config user.name cookys && git config user.email 2537196+cookys@users.noreply.github.com && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.** A landing clone without it never runs the pre-push qc-gate, and a release can ship with a broken trailer unnoticed (this happened once — see the skill's Rules learned).

**Author email is the GitHub noreply address `2537196+cookys@users.noreply.github.com` (name `cookys`)**: GitHub's email-privacy setting rejects a push authored as the gmail address (the v2.36.111 landing had to rewrite 10 commits). Never a test identity, never `--no-verify`.

Cherry-pick in order: c90e7d87, 6996617d (E); 1a19afd3, 74452fec, 2623c044 (F); bf81332c, f1b8985e, 7f087a2f (G); 62aa00f8 (H) — branches hands/w112/{E,F,G,H} in the unit remote.
NEVER pick `(none — no shadow commit in this bundle)` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> (w112 row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR` (or `exec git commit --amend -F <file>` keyed to each SHA), NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
Run the WHOLE suite when the change touches a widely-consumed contract — do not scope the gate to just the touched suites.
- `bash hooks/tests/run.sh --parallel 16 > RUN/full.log 2>&1; echo rc=$?` — ONCE per release. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun only the reds, solo (never rerun the whole suite after a repair — rerun the touched suites plus former reds). A red "L1 unit suite" is ONE line for every `*.test.js`: after a repair rerun the whole L1 layer (`node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js`), never just the one file you fixed — v2.36.107 shipped a red `statusline-live-tee.test.js` that way. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- New test fixtures that contain `reviewer_engine:` must be registered with the Population B gate (`hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh`); no per-row Verify runs it, only the full suite does (v2.36.111). Hands run that suite in their consumer sweep when they add such a fixture.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/w112.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/w112.diff --spec-file $B/clone/../run2/bundle-w112.md > RUN/w112.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.112). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the rows this bundle resolved (match by title, listed in the plan/bundle). Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  If the plan has now shipped entirely, run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. **Fill the trailer's review id from `RUN/w112.review.json` (or the round-2 review file if repaired) — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id from RUN/w112.review.json> plus depth-0 row acceptance, 2026-10-03)`
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.

## Bundle-specific additions (depth-0)
- No implement-foreman REPORT exists (depth-0 ran hands directly); reword content comes from `$B/run2/bundle-w112.md` and each commit's own subject — keep the subject, append ` (w112 row <E|F|G|H>)`.
- **Expected conflict, resolve it yourself (test allowlist only):** E and F both edit the allowlist in `hooks/tests/test-suite-finalize-gate.test.sh` (E deletes the `autopilot-engine-boundary-resume.test.sh` line; F deletes four other lines and changes the recognizer). If a pick conflicts ONLY there, resolve so the allowlist holds exactly `codex-postcompact-production-live-driver`, `orchestration-eval`, `probe-mutation` (with their comments) and F's recognizer code is kept; then run that gate suite and `autopilot-engine-boundary-resume` solo. Any other conflict: stop and report.
- A flake was seen once on `resolve-review-loop-consult-discuss-switch` (Population B "stale entry: autopilot-engine-repair-branch.test.sh", green on rerun at base and at the G head). If it reds in the full run, rerun it solo before treating it as real.
- Release commit BACKLOG edits: DELETE the rows (and sidecars, if no other row points at them) titled
  "A campaign that passed through BOUNDARY_REJECTED can never reach terminal success (controller transcript audit blocks it)" (match the actual title text in docs/BACKLOG.md — it may be shortened),
  "Five lib.sh suites are green by construction (never finalize)",
  "Final-panel seat artifacts under the git common dir are never reaped",
  "v2.36.111 review follow-ups" and "Reviewer output budget: follow-ups from v2.36.111".
  ADD one row "v2.36.112 review follow-ups" (Effort S, Trigger: next touch of the respective file, Pointer to a new sidecar `docs/backlog/v2-36-112-review-follow-ups.md`) collecting the 🔵 items NOT fixed in this bundle, read from `$B/run2/*.review.json` and your combined review: run.sh does not surface `SKIP [` lines in its summary (mission-terminal-rollover's vacuous-run SKIP is invisible there); mission-terminal-rollover zero-assertion guard unexercised on the normal path in a registry-less clone; seat sweep reaps `terminal` regardless of lock and TERMINAL_EVENT_TYPES vs an "abandoned" event (verify vocabulary); RUN_LEDGER_MAX_ROTATIONS read from the sweep's env; verify-red-green optional refusal of an in-repo symlink escaping the repo; B3 rejection code not pinned; `finish_reason=length` with whitespace-only content. Campaigns parked in BOUNDARY_REJECTED before v2.36.112 stay blocked (immutable rows, no migration) — say so in CHANGELOG, not as a row.
- CHANGELOG: follow the existing section language (Traditional Chinese). One user-facing line per row, plus the parked-before-fix note and known follow-ups.
- `node scripts/sync-version.js --version 2.36.112 --hook-count 32 --skill-count 30` (verify counts against the current plugin.json description first).
