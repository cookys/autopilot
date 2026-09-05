# P2 — autopilot consumes the live files (2026-09-05)

- Hands: sonnet, worktree `autopilot-wt-p2`, branch `feat/v2.36.1-p2` from `04d40f5d`. Commits: `d4c11998` RED, `d8a05990` fix, `aa2b08ac` report.
  The hands parked four times waiting for its own background suite notification (the documented parked-foreman trap);
  depth-0 ran its own waiter on the suite processes and re-derived everything below.
- Depth-0 re-derivation: at `d4c11998` `hooks/context-budget.test.js` 30 pass / 3 fail (RED proven); at `d8a05990` 33/0;
  `scripts/lib/live-state-dir.test.js` 20/0; `hooks/tests/foreman-guard.test.sh` 97 assertions PASS.
  Full suite (`AUTOPILOT_TOPOLOGY_FILE=/nonexistent hooks/tests/run.sh --parallel 4`, log 2396 lines): parallel `ALL TESTS PASSED`; failing files
  `context-window` (2), `resolve-review-loop-consult-discuss-switch` (2), `resolve-review-loop-role-admission` (1), `slash-entry-probe` (0-byte under load) —
  each re-run by depth-0 on the base tree with the same env: identical counts ⇒ pre-existing.
- Hetero seat: MiniMax-M3 (cc-shim, high, 15m) → **FIX-THEN-SHIP**, one 🟠 `codex-vector-path-broken`: the codex-mirror twin test resolved the shared
  vector fixture two levels up and threw ENOENT (reproduced: 19/1). Depth-0 one-line-class repair `3f9ad130`: both twins walk up to the repo-root
  fixture (twins stay byte-identical); 20/0 at both depths; `check-js-syntax` 608 files clean. Artifacts: `review-minimax.json`, `diff.patch`, `spec.md`.
- Integration: merged `--no-ff` into `feat/v2.36.1-statusline-live-context-feed`; worktree removed. The plugin cache `dev` symlink points at this
  checkout, so the merged `context-budget.js` is live for the running depth-0 session from the next tool call.
