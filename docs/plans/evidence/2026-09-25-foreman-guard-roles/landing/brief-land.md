Engine: sonnet

# Landing foreman — foreman-guard role caps / close-out reserve / model-visible advisories (plan `2026-09-25-foreman-guard-role-caps-reserve`)

`F=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/fg`, `RUN=$F/run-land` (create it). Depth-0 accepted every phase from git.
Do NOT work in `/home/cookys/projects/autopilot`, the main checkout. Run every long command in the FOREGROUND (Bash timeout 600000).
Prefix every suite, rail, and review command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix it with `< /dev/null`.

## 1. Setup and picks
`git clone -q /home/cookys/projects/autopilot $F/land && cd $F/land && git remote set-url origin "$(git -C /home/cookys/projects/autopilot remote get-url origin)" && git fetch -q origin && git checkout -q -B release/fg origin/develop && git config core.hooksPath .githooks && git remote add unit $F/clone && git fetch -q unit 'refs/heads/hands/*:refs/remotes/unit/hands/*'`

Cherry-pick in this order, squashing each phase with its repair:
- P1 `245ffc62` then its repair `b8fc7bac`, squashed;
- P2 `9514ced7`;
- P3 `6d7a8606` then its repair `70dc78cb`, squashed;
- P4 `d8b6eed3`;
- P5 `c52a43e3`.

NEVER pick `93189f4f` (PARALLEL-RUN LOCAL ONLY). After every pick, `grep enforcement_mode .claude/owner-kernel-governance.json` must show `enforce`.
Reword the commits to `feat(foreman-guard): <phase summary> (plan foreman-guard-role-caps-reserve P<n>)`, using `$F/run/REPORT.md`. Use `GIT_SEQUENCE_EDITOR` or `exec git commit --amend -F`, never sed with `/`.
Then verify each message against its diffstat. P1 and P3 each have a KR4 re-expectation list in the original hand commit messages; keep those lists in the reworded messages.
If a pick conflicts, stop and report.

## 2. Gates. foreman-guard is a default-on hook, so run the WHOLE suite.
- `bash hooks/tests/run.sh --parallel 8 > RUN/full.log 2>&1; echo rc=$?`. Read the summary and every `FAIL [` line, including the serial tail.
- Rerun each red solo. Anything still red gets run at `origin/develop` in a throwaway worktree. Red there too means pre-existing: record it (`engine-qualify-verdict-stability` D6 is known).
  Red only on your branch: bisect, STOP, and report. Never repair anything yourself.
- `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check`, `bash scripts/validate.sh`, `node scripts/check-hook-inventory.js` (if it exists), and `node scripts/doc-drift-gate.js .` (no new FAIL beyond the 3 known baseline ones).

## 3. Final review (combined diff)
Run `git diff origin/develop..HEAD > RUN/fg.diff`, then
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m --diff-file RUN/fg.diff --spec-file $F/land/docs/plans/2026-09-25-foreman-guard-role-caps-reserve.md > RUN/fg.review.json`
in the foreground with a Bash timeout of 1500000. If you get no verdict, retry once with "You have no tools. Answer only with the verdict JSON." added.
SHIP-AS-IS is required. If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings, stop and report them.

## 4. Release (only with green gates and SHIP-AS-IS)
- Version = `git show origin/develop:.claude-plugin/plugin.json` + 1 PATCH (expect 2.36.97). Run `node scripts/sync-version.js --version <V>`; the hook count is unchanged because no new hook file was added.
- `CHANGELOG.md`: a new top section for V written for users. Cover:
  - Role-aware Bash caps: a `Role: worker|reviewer` line on line 2 of a dispatched prompt gives the subagent 120 calls; foremen and undeclared agents stay at 40.
  - The 8-call close-out reserve and its allowlist.
  - Advisories now reach the model through `additionalContext` (previously mode=warn wrote to stderr, which Claude never sees).
  - A no-marker advisory for autopilot-dispatched subagents: they are never denied and get one advisory every 40 calls.
  - The new config keys `foreman_guard.role_caps` / `reserve_calls` / `advisory_every` and their env equivalents.
  - Reported by the hangar session on openclaw.
  - The review's 🔵 items as known follow-ups.
  - The plan's FULL slug `2026-09-25-foreman-guard-role-caps-reserve` inside this section; `check-plan-graduation --fix` needs it.
- `docs/BACKLOG.md`: add ONE new row per `references/backlog-entry.md` (Status / Trigger / Effort / Source / Pointer / Context), titled
  "foreman-guard: a cost-shaped second gate (cumulative cache-read tokens or lifetime), which also covers clone-based foremen whose l4–l6 marker is INACTIVE".
  - Effort: M. Source: plan §7.
  - Trigger: "a hook-readable cumulative per-agent token feed exists, or a clone-based foreman is measured running away".
  - Pointer: a new sidecar `docs/backlog/foreman-guard-cost-shaped-gate.md`, summarizing plan §7 and the peer's follow-ups: foreman lifetime cap, per-subtree budget, signed role header.

  Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md`; it must exit 0.
- Run `node scripts/check-plan-graduation.js --repo-root . --fix` to archive the plan. It must then report exit 0, and the INDEX row must show V.
- `bash scripts/preflight-release.sh` must pass.
- Commit. The final paragraph holds both trailers, with no blank line between them:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 <review run id> plus depth-0 phase acceptance, 2026-09-25)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop`. If the version collides, take the next free number and re-stamp CHANGELOG, INDEX, and sync-version. Then `git push origin HEAD:develop`
  (no pipe, no --force; retry once on a 5xx). Confirm that `git ls-remote origin develop` equals HEAD.

## 5. Report
`RUN/REPORT.md`: picked → landed SHAs, the gate summary, the review verdict and id, V, and the pushed SHA. Final message: the REPORT path, V, the pushed SHA, and anything NOT done.
