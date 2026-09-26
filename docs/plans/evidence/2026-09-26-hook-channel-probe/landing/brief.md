Engine: sonnet

# Foreman brief — hook advisories reach the model (plan `2026-09-26-hook-advisories-reach-model`, 4 rows)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/ha/clone`. Git hooks are enabled and push is disabled.
  `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/ha/run`.
- develop base = `9788b1bd`. On top of it the clone carries ONE clone-local commit `0a57d55e` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)". This is the documented parallel-run recipe (`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`
  line 7). Without it, `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `0a57d55e`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.

## The plan
`$C/docs/plans/2026-09-26-hook-advisories-reach-model.md` (review-frozen: G2 plus a bounded repair). Its §2.5 Global Constraints go VERBATIM into every hand prompt.
The review dispositions `…g1-dispositions.json` and `…g2-dispositions.json` are requirements: every accepted item is in scope. P0 is done (UserPromptSubmit additionalContext is visible).
Work these rows in this order (`<n>` = the id):
- `p1a`: plan P1 for the DEFAULT-ON group-T hooks: cost-fuse, context-budget (T1 only), depth0-delegate-gate (nudge), reload-watch, and dispatch-model-guard (warn lines).
- `p1b`: plan P1 for the multiplexer hard requirement (merge; exit-2 passthrough; strip allow) plus the OPT-IN group-T hooks: orchestrator-edit-gate, branch-protection, large-file-warner, design-quality, test-runner, and mcp-health.
- `p2`: plan P2, the group-S queue writers plus the new `hooks/advisory-relay.js` and its hooks.json wiring. Do NOT run sync-version; the hook count is synced at landing.
- `p3`: plan P3 docs.

New suites: `hooks/tests/hook-advisory-channel.test.sh` (p1a creates it, p1b appends) and `hooks/tests/advisory-relay.test.sh` (p2 creates it). Existing suites change ONLY on plan §5's list, and each
change is named in the commit message. Test fixtures run under a temp HOME, TMPDIR, and XDG_RUNTIME_DIR; never touch the real `~/.autopilot` or `~/.claude`.
Every advisory's text must stay byte-identical, and each test asserts the exact text.

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** re-derive the defect at the current base (grep the symbol / run the repro). Gone → `SKIP <n> <evidence>`, no hand.
2. **Write `RUN/hand-<n>.md`** with these sections:
   - **Product:** what to change and why, described in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** new case functions in the row's new suite, as listed above (`chmod +x`).
     Before fixing, run it against the unmodified base and record the red output as a `# RED at <sha>:` comment.
   - **Verify:** `test -x` on the new suite, then run the new suite AND every CONSUMER suite of the contract the row changes, not only the bundle suite.
     Always include the row's new suite, plus every existing suite that `grep -l <hook basename> hooks/tests/* hooks/*.test.js` finds for each hook the row touches (run `.test.js` files with `node --test`). Add `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** the minimal set, from plan §3 for that row (plus `platforms/codex/plugin/` mirrors, synced via `bash scripts/sync-codex-plugin-skills.sh`).
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-ha-<n>`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/ha/<n> --base <prev accepted head or 0a57d55e> --ledger RUN/hands.ledger --run-id ha-<n> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<n>.md`
   On any wake: look for `rc=` in the dispatch output. If it is not there, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect ha-<n>.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `<base>..hands/ha/<n>` into `RUN/<n>.diff`, then run
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/<n>.diff --spec-file RUN/hand-<n>.md > RUN/<n>.review.json`
   in the FOREGROUND with Bash timeout 1000000. If you get no verdict or tool-call-shaped text, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec.
   If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on `hands/ha/<n>-r2` (base = the head of `hands/ha/<n>`) and re-review.
5. **Stacking:** each row's `--base` = the previous row's accepted head (its `-r2` head if repaired). Track this in `RUN/accepted-heads.txt`.
6. A hand-rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL <n> <rc> <stderr tail>`, then continue. NEVER author the code yourself.

## After all rows
In a throwaway worktree at the last accepted head (`git -C $C worktree add RUN/verify <head>`), run, one at a time and solo, each with the env prefix and `< /dev/null`:
- both new suites and every touched hook's consumer suites;
- `check-js-syntax`;
- `sync --check`.

Then remove the worktree.

## Report
`RUN/REPORT.md`: per row, `LAND <n> <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, together with the diff stat, the review verdict and findings, and the RED line. At the end, the aggregate verify table (rc per suite).
Final message: the REPORT path and those per-row lines. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.
