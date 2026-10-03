# import-aa-capabilities test is host-pinned: fails when /tmp is inside a git worktree

Source: foreman landing run of v2.36.114 on aimax395, 2026-10-03.

- **Observed**: 22 failures at origin/develop on aimax395 because `/tmp/.git` exists, so the import's
  "AA cache directory must be outside a Git worktree" check fires for every fixture cache under `/tmp`.
- **Fix shape**: make the test use an isolated tmp root verified not to be inside a worktree (e.g. probe
  with `git rev-parse` and pick another base), or set `GIT_CEILING_DIRECTORIES` for the test process.
- **Class**: evidence-discipline "assertion pinned to one machine" (`references/evidence-discipline.md`).
