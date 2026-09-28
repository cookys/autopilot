Engine: sonnet

# Landing foreman — context-budget live-dir fix (1 row, 2 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/livedir`, `RUN=$B/run-land` (create it). Depth-0 accepted the row after checking it in git
(diff read; real-host end-to-end `hooks/context-budget.js` run with XDG unset: base → `present:false`, 200K inference, false T1 at 109k;
accepted head → `present:true`, `knownWindow:1000000`, silent).
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land && cd $B/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/livedir origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.**

Cherry-pick in order: `89ba821b` then `8edb870e`. Then squash them into ONE commit (the second is a review repair of the first) with message
`fix(live-state): infer /run/user/<uid> when hook env lacks XDG_RUNTIME_DIR; tighten a self-owned group-bit runtime dir under a private parent`
plus a short body taken from `$B/run/REPORT.md`. Use `git reset --soft origin/develop && git commit -F <file>` — NOT sed.
NEVER pick `8de1afa6` (PARALLEL-RUN LOCAL ONLY shadow). After the picks, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
`resolveLiveDir` is consumed by ~9 hooks — run the WHOLE suite.
- `bash hooks/tests/run.sh --parallel 8 > $RUN/full.log 2>&1; echo rc=$?`. Read the summary section and every `FAIL [` line. The parallel section's "ALL TESTS PASSED" line does not cover the serial tail, so check that too.
- Rerun every red solo. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add $RUN/base origin/develop`).
  Red at base too means pre-existing: record it. Red only on your branch: STOP; report the failing suite and assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.
- Also: `node scripts/lib/live-state-dir.test.js`, `node hooks/context-budget.test.js`, `node scripts/statusline-live-tee.test.js` (node suites may not be in run.sh).

## 3. Final review
Run `git diff origin/develop..HEAD > $RUN/livedir.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file $RUN/livedir.diff --spec-file $B/run/implement-brief.md > $RUN/livedir.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, STOP and report them. Do not self-adjudicate them away — that adjudication is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.100). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the row titled "context-budget reads a different live dir than statusline writes → false T2 at ~150k in 1M sessions"
  and its sidecar `docs/backlog/context-budget-live-dir-mismatch.md` (no other row points at it — verify with grep; the HANDOFF mention is fine).
  ADD one new row (same field shape as neighbours: Status open, Trigger, Effort S, Source, Pointer none, Context):
  title "codeforge statusline creates `$XDG_RUNTIME_DIR/autopilot` 0775 — should mkdir 0700"; Trigger: next codeforge release touching src/live.rs;
  Source: v2.36.100 live-dir fix; Context: autopilot's resolver now tightens a self-owned group-bit dir under a private parent, so this is hygiene,
  not a live defect; the writer should still create 0700 so a host where `/run/user/<uid>` is not 0700 does not fall back to shm.
  Then `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` must exit 0.
- `CHANGELOG.md`: new top section for V. User-facing: 1M-context sessions got false context-budget T1/T2 at ~100–200k because hooks
  (no `XDG_RUNTIME_DIR` in their env) read `/dev/shm` while the statusline writes `/run/user/<uid>`; resolver now infers `/run/user/<uid>/autopilot`
  and tightens that dir from 0775 to 0700 when the parent is private. **Migration note**: hook-owned state in `/dev/shm/autopilot-<uid>/`
  (advisory-queue, context-budget, depth0-gate, dirty-tree-reminder) is orphaned once — all advisory/rebuildable; queued advisories and
  window memory reset once. List the review 🔵 items as known follow-ups.
- `docs/projects/INDEX.md`: one row for V (follow the existing row shape); merge column `—` rather than "(this ship)".
- `node scripts/check-plan-graduation.js --repo-root . --json` exit 0; `bash scripts/preflight-release.sh` must pass.
- Commit (a second commit, `chore(release): v<V> …`). **Fill the trailer's review id from `$RUN/livedir.review.json` — the real id the manifest carries, never a literal `<id>` placeholder.** The final paragraph of the message holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id> plus depth-0 row acceptance, 2026-09-28)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  If the pre-push qc-gate needs the trailer on the fix commit too, amend that commit's message the same way (via reset/commit, not sed).
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient GitHub 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`$RUN/REPORT.md`: picked → landed SHAs, the gate summary (total, red, pre-existing), the review verdict and id, V, and the pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.
