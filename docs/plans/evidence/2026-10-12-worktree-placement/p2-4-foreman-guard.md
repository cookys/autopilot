# P2.4 — foreman-guard close-out `rm` allowance

Question: `hooks/foreman-guard.js` `isTmpSafePath` (the close-out reserve allows `rm`/`rmdir` only under
`/tmp` or `$TMPDIR`). With the foreman worktree moved under `<main>/.claude/worktrees/`, does any step of the
foreman protocol `rm` its own worktree, which the guard would now refuse?

Grep (2026-10-12, at commit 28ab4d92):

- `scripts/dispatch-foreman.sh`: two deletions, both run by the rail process, not by the foreman model:
  `rm -f "$RUN_DIR/ESCALATION.md"` (:414, run dir, not the worktree) and
  `git worktree remove --force "$WT"` (:485, the rail's own teardown). foreman-guard is a PreToolUse hook on
  the foreman's tool calls; it never sees the rail's shell.
- `skills/l5/references/`, `skills/l6/`: no `rm -r` / `rm -rf` step for the foreman.
- `isTmpSafePath` is referenced only by `hooks/foreman-guard.js` and `hooks/tests/foreman-guard-roles.test.sh`.

Result: no change needed. The foreman's own scratch still goes to the temp dir, where the allowance applies;
the worktree is removed by the rail.
