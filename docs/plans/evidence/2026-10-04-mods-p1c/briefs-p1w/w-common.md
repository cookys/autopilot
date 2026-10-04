# P1W hand — common rules (read fully before your row brief)

P=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1c
Your worktree is `$P/wt-<row>` (branch `w/<row>`), already created by depth-0 with author identity set. Work ONLY there. Never touch /home/cookys/projects/autopilot (the main checkout), the real ~/.claude, or the real ~/.autopilot / /run/user/1000/autopilot (tests must use temp dirs; the suites' lib already isolates the live dir — keep it that way).
Binding design: /home/cookys/projects/autopilot/docs/plans/2026-10-03-mods-visible-dispatch.md §4 "P1W" (your row) plus §2.5 Global Constraints; evidence /home/cookys/projects/autopilot/docs/plans/evidence/2026-10-04-mods-p1c/wiring-inventory.md (file:line facts). Read both.
Other P1W rows run IN PARALLEL in sibling worktrees. Stay inside your row's files; if you must touch a file another row obviously owns (listed in the plan table), STOP and report instead.

Discipline:
- RED-first: write the failing test, run it, record RED counts in the test header comment, then implement.
- Mutation controls: for each guarded behaviour, break it deliberately, show the suite goes red, restore; save outputs to `$P/run-w/<row>/mut-*.txt`.
- Run long commands in the FOREGROUND (Bash timeout 600000). Prefix suites with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, suffix `< /dev/null`.
- Consumer sweep: every suite that greps the files/contracts you touch (`git grep -l <name> hooks/tests scripts`), plus the L1 layer `node --test hooks/*.test.js scripts/*.test.js scripts/lib/*.test.js` (the ONLY accepted pre-existing reds: 22 failures in scripts/import-aa-capabilities.test.js), `node scripts/check-js-syntax.js`, `bash scripts/sync-codex-plugin-skills.sh --check` (run the sync first if you changed mirrored files), `node scripts/check-claude-md-inventory.js` and `node scripts/check-hook-inventory.js --check` when you add a script or hook. Several hands run suites at once: if a red appears, rerun that suite alone before reporting it.
- New script → the four wiring places in CLAUDE.md "When adding a new script"; new hook → hooks.json + hook-classes + hook inventory + an opt-out knob documented in hooks/README.md. Do not bump the version, do not edit CHANGELOG / INDEX / the plan.
- No SKILL.md edits in W1 rows (guidance changes need eval evidence first).
- ONE commit per row, message `<type>(<area>): <what> (mods P1W <row>)`, body ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never --no-verify; if a pre-commit gate blocks, STOP and report the message.
- Report `$P/run-w/<row>/REPORT.md`: acceptance items one by one with evidence (command + result), commit SHA, `git diff --stat <base>..HEAD`, contracts/files other rows will consume (exact shape), anything NOT done or refused. Final message: report path, SHA, 5-line summary.
