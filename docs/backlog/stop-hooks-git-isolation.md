# Stop hooks that run git on the worker tree (BL-0325)

Same class as BL-0319 (closed): git reading a worker-owned .git/config can be steered by the worker. per-turn-gate is handled (no git call in the hook; gate-verify isolates). The hooks below are not.

Grep of hooks/hooks.json Stop and SubagentStop groups, then git calls in each hook (2026-10-29, base b60ab831a):

- hooks/dirty-protected-paths.js (Stop, default-on): git() helper at line 54 runs `git status --porcelain=v1 -z` (line 153), `git diff --numstat HEAD` (line 159) and `git rev-parse --show-toplevel` (line 187) with cwd = worker tree. No config isolation.
- hooks/opt-in-multiplexer.js Stop list (opt-in, off by default) dispatches hooks/session-summary.js (git at line 19) and hooks/check-console.js (git diff --name-only HEAD, line 37); batch-format is in the same list and was not checked.
- hooks/cost-tracker.js, hooks/owner-question-guard.js, hooks/awaiting-owner.js, hooks/per-turn-gate.js: no git call found.
- hooks/live-session-lib.js handles Stop events but no git call was found in it.

Fix direction: reuse the isolation gate-verify applies (core.fsmonitor=false, core.hooksPath and core.excludesFile off, GIT_* cleared) in one shared helper, with a decoy-config negative control per hook.
