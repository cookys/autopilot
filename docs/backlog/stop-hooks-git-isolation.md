# Stop hooks that run git on the worker tree (BL-0325)

Same class as BL-0319 (closed): git reading a worker-owned .git/config can be steered by the worker. per-turn-gate is handled (no git call in the hook; gate-verify isolates). The hooks below are not.

Checked at HEAD ea1d04ebe, every hook in the hooks/hooks.json Stop and SubagentStop groups, then every hook in the opt-in-multiplexer Stop list.

hooks.json Stop group:
- hooks/opt-in-multiplexer.js: no git call of its own (spawnSync at line 106 only launches the hooks in its own list, below).
- hooks/cost-tracker.js: no git call.
- hooks/dirty-protected-paths.js (default-on): git() helper at line 54 runs `git status --porcelain=v1 -z` (line 153), `git diff --numstat HEAD` (line 159) and `git rev-parse --show-toplevel` (line 187) with cwd = worker tree. No config isolation.
- hooks/owner-question-guard.js: no git call.
- hooks/per-turn-gate.js: no git call (its spawnSync at line 143 runs gate-verify, which isolates git).
- hooks/awaiting-owner.js: no git call.

hooks.json SubagentStop group:
- hooks/per-turn-gate.js: no git call (as above).
- hooks/awaiting-owner.js: no git call.

opt-in-multiplexer Stop list (opt-in, off by default):
- hooks/session-summary.js: git at line 19 (spawnSync with caller-supplied args, cwd and config not isolated).
- hooks/check-console.js: `git diff --name-only HEAD` at line 37.
- hooks/batch-format.js: no git call, but a different class of exposure. At Stop it runs prettier --write (spawnSync, line 102) and `npx tsc --noEmit` (line 116) inside the worker tree, so it executes the project's own prettier and tsc configuration and the tools under node_modules, which the worker controls. The exposure is running worker-controlled tools, not git config.

Also: hooks/live-session-lib.js handles Stop events but has no git call.

Fix direction: reuse the isolation gate-verify applies (core.fsmonitor=false, core.hooksPath and core.excludesFile off, GIT_* cleared) in one shared helper, with a decoy-config negative control per hook.
