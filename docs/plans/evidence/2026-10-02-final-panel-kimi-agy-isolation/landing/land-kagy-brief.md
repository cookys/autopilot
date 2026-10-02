Engine: sonnet

# Landing foreman — final-panel kimi/agy isolation (5 rows, 7 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/7236b3c6-6662-4434-ab03-07d7d2a66500/scratchpad/wave`, `RUN=$B/run-land-kagy` (create it). Depth-0 accepted every row after checking it in git.
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land-kagy && cd $B/land-kagy && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/kagy origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/kagy/*:refs/remotes/unit/kagy/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.** A landing clone without it never runs the pre-push qc-gate, and a release can ship with a broken trailer unnoticed (this happened once — see the skill's Rules learned).

Cherry-pick in order: ff719bc7 (P1), 5e9a2876 (P1 repair), 2e064404 (P2), acd03d9c (P3), 033750f9 (P4), 92455ca3 (P5), 16a985db (P5 repair) — stacked, in this order (P2 was originally based on 53ddc02f and was combined after P1 as 47a0e1c6; if picking 2e064404 conflicts, pick the combined 47a0e1c6 instead). Squash each phase with its repair (5 commits).
NEVER pick `(none — no shadow commit on these branches)` (PARALLEL-RUN LOCAL ONLY shadow). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
Reword each commit to `fix(<area>): <what> (final-panel kimi/agy isolation row <n>)`, taking the content from `$B/run/REPORT.md`. Use `git rebase -i` with `GIT_SEQUENCE_EDITOR` (or `exec git commit --amend -F <file>` keyed to each SHA), NOT sed with `/` delimiters.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
Run the WHOLE suite when the change touches a widely-consumed contract — do not scope the gate to just the touched suites.
- `bash hooks/tests/run.sh --parallel 16 > RUN/full.log 2>&1; echo rc=$?` — ONCE per release. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun only the reds, solo (never rerun the whole suite after a repair — rerun the touched suites plus former reds). Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: bisect it (`git bisect run`) and STOP; report the first-bad commit and the failing assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
Run `git diff origin/develop..HEAD > RUN/kagy.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/kagy.diff --spec-file $B/clone/docs/plans/2026-10-02-final-panel-kimi-agy-isolation.md > RUN/kagy.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect v2.36.108 if wave-B shipped v2.36.107 first (read origin)). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the rows this bundle resolved (match by title, listed in the plan/bundle). Delete a sidecar only if no other row points at it. Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (it must exit 0).
- `CHANGELOG.md`: a new top section for V, one user-facing line per row (the problem, then what changed), plus the 🔵 items from the review listed as known follow-ups.
- `docs/projects/INDEX.md`: one row for V; put the release SHA in the merge column after the commit, or write `—` rather than `(this ship)`.
  If the plan has now shipped entirely, run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive it and resolve its INDEX `active` row. After that, `check-plan-graduation --json` must return exit 0.
- `bash scripts/preflight-release.sh` must pass.
- Commit. **Fill the trailer's review id from `RUN/kagy.review.json` (or the round-2 review file if repaired) — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id from RUN/kagy.review.json> plus depth-0 row acceptance, 2026-10-03)`
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.

## Bundle-specific notes (depth-0)
- Start ONLY after `git ls-remote origin develop` shows the wave-B release (v2.36.107) — never run two full suites at once (oracle lock).
- Full suite exactly ONCE (`--parallel 16`); afterwards only reds + touched suites (consumer sweep incl. L1 `.test.js`).
- Also run once, solo, the real-bwrap model-free gates: `AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch-kimi-agy.test.sh`.
- Review spec = the plan, plus: "Live-fire passed for both runners (receipts in docs/plans/evidence/2026-10-02-final-panel-kimi-agy-isolation/live-fire/{kimi,agy-rerun}/). Deviations from plan text, all depth-0-ruled from real evidence: agy never logs the agent name — the cleanroom marker is agent=true + agentScript=true + no fallback + exactly one agent across the agents dirs; agy 1.2.15 migrates antigravity-cli/agents to config/agents via an absolute symlink — launcher seeds both, audit judges the union. Check: non-blind kimi/agy and codex paths unchanged; no secret in receipts; tier tables in parity; intake refuses unknown for kimi/agy."
- Plan graduates: run `check-plan-graduation.js --fix` (archives the plan); CHANGELOG names both runners, the two evidence-driven deviations, agy auto-update 1.2.14→1.2.15 seen during the work, and known follow-ups from the review.
- BACKLOG: none to delete (the row became the plan). Peer notice is depth-0's job.
