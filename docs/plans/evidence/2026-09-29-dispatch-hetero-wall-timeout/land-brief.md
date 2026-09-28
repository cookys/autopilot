Engine: sonnet

# Landing foreman — dispatch-hetero wall-timeout watchdog (1 row, 5 hand commits)

`B=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/wdog`, `RUN=$B/run-land` (create it). Depth-0 accepted the row after checking it in git
and re-deriving a real cursor-rail proof at head 9d50f318 (`--timeout 20s`, agent told to `sleep 300`): returned in 26 s, `status:failure`,
`timed_out:true`, `timeout_enforced:true`, containment setsid, no surviving process. The implement foreman's REPORT could not be written by it; its content
is at `$B/run/REPORT.md` (depth-0 saved it).
Do NOT work in `/home/cookys/projects/autopilot` (the main checkout). Run every long command in the FOREGROUND (Bash timeout 600000) so that you don't park.
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.
If a subagent tool refuses to write a report file, write it with a Bash heredoc into `$RUN` instead — the brief requires it.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $B/land && cd $B/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/wdog origin/develop && git config core.hooksPath .githooks && git remote add unit $B/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

**`git config core.hooksPath .githooks` must run in this same setup line, before any pick or commit.**

Cherry-pick in order: `9b6e7e08`, `4821e68b`, `88d76b82`, `75e9cf5c`, `9d50f318` (verify each is an ancestor chain ending at `unit/hands/wdog/1-r5`).
Then squash into ONE commit with `git reset --soft origin/develop && git commit -F <file>` (NOT sed); subject:
`fix(dispatch-hetero): enforce --timeout on every rail with a central run_worker watchdog (explicit bounds only)` and a body summarising the
rule (enforced iff `--timeout` or a contract wall; default 9m unenforced and recorded as `timeout_source: default`, `timeout_enforced: false`;
TERM → 10 s grace → KILL of the worker's session/scope, never the dispatcher; `status: failure` + `timed_out: true` on expiry) and the five review rounds.
NEVER pick `1f81de14` (PARALLEL-RUN LOCAL ONLY shadow). After the picks, `grep enforcement_mode .claude/owner-kernel-governance.json` must still show `enforce`.
If a pick conflicts, stop and report the files; do not resolve product conflicts yourself.

## 2. Gates
`dispatch-hetero.sh` is the dispatch rail for everything — run the WHOLE suite.
- `bash hooks/tests/run.sh --parallel 8 > $RUN/full.log 2>&1; echo rc=$?`. Read the summary section and every `FAIL [` line; check the serial tail too.
- Rerun every red solo. Anything still red gets run at `origin/develop` in a throwaway worktree (`git worktree add $RUN/base origin/develop`).
  Known pre-existing reds at origin/develop (BACKLOG rows exist): `engine-qualify-verdict-stability.test.sh`, `migrate-backlog-entries.test.sh` — confirm, don't assume.
  Red only on your branch: STOP; report the failing suite and assertions. Do not repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`.

## 3. Final review
`git diff origin/develop..HEAD > $RUN/wdog.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file $RUN/wdog.diff --spec-file $B/run/implement-brief.md > $RUN/wdog.review.json`
in the foreground with a Bash timeout of 1500000. If no verdict, retry once with a spec copy that adds "You have no tools. Answer only with the verdict JSON."
SHIP-AS-IS is required. FIX-THEN-SHIP with 🔴/🟠 → STOP and report them. Do not self-adjudicate — that is depth-0's.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.101). Run `node scripts/sync-version.js --version <V>`.
- `docs/BACKLOG.md`: delete the row titled "`dispatch-hetero.sh --timeout` is accepted and recorded but never applied to the grok rail" and its sidecar
  `docs/backlog/dispatch-hetero-grok-timeout-not-applied.md` (grep first that no other row points at it; HANDOFF mentions are fine). ADD one row
  (same field shape as neighbours; Status open, Effort S, Trigger "next dispatch-hetero containment change", Source "v2.36.101 review 🔵 follow-ups",
  Pointer: new sidecar `docs/backlog/dispatch-hetero-watchdog-followups.md`) collecting the final review's 🔵 items (no-setsid/no-job-control degrade,
  cgroup-kill-failure has no fallback, deadline-coincidence mislabel, manifest duplicate-key nit — take the exact list from `$B/run/1-r5.review.json`
  and your own §3 review). `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` must exit 0.
- `CHANGELOG.md`: new top section for V in the file's **zh-TW house style** (see v2.36.100/v2.36.99 sections: 句子要主詞, gate 不譯), ≤ 12 lines:
  symptom (`--timeout` was recorded but enforced only on agy; a `--timeout 20m` grok run lived 22m+), the new rule, the behavior guarantee
  (default-only runs unchanged; manifest no longer claims an unenforced bound), one sentence on the detached-path miss that only the real-rail proof caught,
  and the 🔵 follow-ups row.
- `docs/projects/INDEX.md`: one row for V (existing row shape); merge column `—`.
- `node scripts/check-plan-graduation.js --repo-root . --json` exit 0; `bash scripts/preflight-release.sh` must pass.
- Commit (`chore(release): v<V> — dispatch-hetero wall-timeout watchdog`). **Fill the trailer's review id from `$RUN/wdog.review.json` — the real id, never a literal `<id>`.** Final paragraph, no blank line between:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review run id> plus depth-0 row acceptance, 2026-09-29)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  (Use exactly that Co-Authored-By line — the previous closeout used a different one by mistake.) If the pre-push qc-gate needs the trailer on the fix commit too, amend that commit's message the same way (reset/commit, not sed).
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a transient 5xx). Confirm `git ls-remote origin develop` equals HEAD.

## 5. Report
`$RUN/REPORT.md`: picked → landed SHAs, gate summary (total, red, pre-existing), review verdict and id, V, pushed SHA.
Final message: the REPORT path, V, the pushed SHA, and anything NOT done.
