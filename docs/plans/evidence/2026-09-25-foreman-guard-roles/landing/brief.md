Engine: sonnet

# Foreman brief — foreman-guard: role-aware caps, close-out reserve, model-visible advisories (phases P1–P5)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/fg/clone`. Git hooks are enabled and push is disabled.
  `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/fg/run`.
- develop base = `44336243`. On top of it the clone carries ONE clone-local commit `93189f4f` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)". This is the documented parallel-run recipe (`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`
  line 7). Without it, `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `93189f4f`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.

## The plan
`$C/docs/plans/2026-09-25-foreman-guard-role-caps-reserve.md` (review-frozen: G2 plus a bounded repair; its §2.5 Global Constraints go VERBATIM into every hand prompt).
Work the phases P1, P2, P3, P4, P5 in that order; a "row" below means a phase, and `<n>` is `p1`..`p5`. P0 is done (route a′ holds); so is P1's live probe (additionalContext IS visible
inside a subagent: `docs/plans/evidence/2026-09-25-foreman-guard-roles/p1-probe/RULING.md`). So P1 uses `additionalContext` and P4 stays in scope, with no deny-reason fallback needed.
Each phase's Product/Tests/Acceptance comes from plan §4, with KR1–KR4 in §2 and the review-frozen dispositions in `…g1-dispositions.json` / `…g2-dispositions.json` (all "accepted" items are requirements).
The new suite is `hooks/tests/foreman-guard-roles.test.sh`: P1's hand creates it, and later phases append. The only allowed edits to `hooks/tests/foreman-guard.test.sh` are the
KR4 re-expectations, and each one must be listed in the commit message. Build test fixtures under a temp HOME/TMPDIR: fake `transcript_path` plus `<session>/subagents/agent-<id>.jsonl`
files, and a fake session-mode marker via the suite's existing mechanism. Never touch the real `~/.autopilot` or `~/.claude`.

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** re-derive the defect at the current base (grep the symbol / run the repro). Gone → `SKIP <n> <evidence>`, no hand.
2. **Write `RUN/hand-<n>.md`** with these sections:
   - **Product:** what to change and why, described in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** new case functions in `hooks/tests/foreman-guard-roles.test.sh` (P1 creates it, `chmod +x`; later phases append).
     Before fixing, run it against the unmodified base and record the red output as a `# RED at <sha>:` comment.
   - **Verify:** `test -x` on the new suite, then run the new suite AND every CONSUMER suite of the contract the row changes, not only the bundle suite.
     Always include `hooks/tests/{foreman-guard,foreman-guard-roles,dispatch-model-guard}.test.sh`, plus every suite `grep -l foreman-guard hooks/tests/*.sh` finds. Add `node scripts/check-js-syntax.js` and `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** the minimal set, from plan §3 for that phase (plus `platforms/codex/plugin/` mirrors, synced via `bash scripts/sync-codex-plugin-skills.sh`).
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-fg-<n>`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/fg/<n> --base <prev accepted head or 93189f4f> --ledger RUN/hands.ledger --run-id fg-<n> --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-<n>.md`
   On any wake: look for `rc=` in the dispatch output. If it is not there, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect fg-<n>.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `<base>..hands/fg/<n>` into `RUN/<n>.diff`, then run
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/<n>.diff --spec-file RUN/hand-<n>.md > RUN/<n>.review.json`
   in the FOREGROUND with Bash timeout 1000000. If you get no verdict or tool-call-shaped text, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec.
   If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on `hands/fg/<n>-r2` (base = the head of `hands/fg/<n>`) and re-review.
5. **Stacking:** each row's `--base` = the previous row's accepted head (its `-r2` head if repaired). Track this in `RUN/accepted-heads.txt`.
6. A hand-rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL <n> <rc> <stderr tail>`, then continue. NEVER author the code yourself.

## After all rows
In a throwaway worktree at the last accepted head (`git -C $C worktree add RUN/verify <head>`), run, one at a time and solo, each with the env prefix and `< /dev/null`:
- the plan §5 suites;
- `check-js-syntax`;
- `sync --check`.

Then remove the worktree.

## Report
`RUN/REPORT.md`: per row, `LAND <n> <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, together with the diff stat, the review verdict and findings, and the RED line. At the end, the aggregate verify table (rc per suite).
Final message: the REPORT path and those per-row lines. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.
