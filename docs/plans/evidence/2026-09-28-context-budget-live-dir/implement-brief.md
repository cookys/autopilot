Engine: sonnet

# Foreman brief — context-budget live-dir fix (1 row)

You are the foreman: you orchestrate and never edit product/test files yourself. Hands write the code; you verify from git
artifacts (`git diff --stat`, the hand's result JSON), never from a hand's self-report. Depth-0 lands the result.

## Setup (already done by depth-0 — authorized here, in the brief)
- Clone `C=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/livedir/clone`.
  Git hooks are enabled and push is disabled. `RUN=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/livedir/run`.
- develop base = `0ecc19b2`. On top of it the clone carries ONE clone-local commit `8de1afa6` "PARALLEL-RUN LOCAL ONLY — mission_convergence
  enforcement_mode shadow (never land)". This is the documented parallel-run recipe (`docs/plans/evidence/2026-09-19-parallel-sonnet-foremen/common.md`
  line 7). Without it, `dispatch-hetero.sh` refuses under Mission enforce. **BASE_SHA for row 1 = `8de1afa6`.** Never modify, revert, or reset that commit, and never
  touch `.claude/owner-kernel-governance.json`. Depth-0 cherry-picks only hand commits.
- Never touch `/home/cookys/projects/autopilot` (the main checkout), and never run fetch or pull inside the clone.

## The row (P1)
Evidence sidecar: `$C/docs/backlog/context-budget-live-dir-mismatch.md`. Depth-0 has already confirmed on this host, and
added a fact the sidecar lacks:

- The statusline writer (codeforge, external Rust, runs WITH `XDG_RUNTIME_DIR`) writes
  `/run/user/1000/autopilot/context/<sid>.json`. Hook processes run WITHOUT `XDG_RUNTIME_DIR`, so
  `resolveLiveDir()` (`scripts/lib/live-state-dir.js`) picks `/dev/shm/autopilot-1000`, where `context/` does not exist.
- **Second defect**: `/run/user/1000/autopilot` is mode **0775** (created by codeforge). `isOwnedMode700Dir` rejects any
  pre-existing candidate with `mode & 0o077`, so even a hook process WITH `XDG_RUNTIME_DIR` falls through to shm. Adding
  only an inferred-xdg candidate would ship green tests and change nothing in production.
- `/run/user/1000` itself is mode 0700, owned by the user, tmpfs.

Operator-approved fix shape (implement exactly this, in `scripts/lib/live-state-dir.js`):
1. **Inferred-xdg candidate.** When `XDG_RUNTIME_DIR` is unset/empty, insert a candidate `<runUserRoot>/<uid>/autopilot`
   with source `'xdg-inferred'`, after the (absent) xdg slot and before `shm`. `runUserRoot` defaults to `/run/user` and is
   injectable via `opts.runUserRoot` (same pattern as `opts.procMountsPath`) so tests never stat the real machine path.
   The candidate is only considered if its parent `<runUserRoot>/<uid>` already exists (never create `/run/user/<uid>`).
2. **Bounded group-bit tightening.** For a pre-existing candidate dir that is a real directory (not a symlink), owned by
   the current uid, whose mode has group bits set but NO other bits (`mode & 0o007 === 0`), AND whose parent directory
   is owned by the current uid with `(parentMode & 0o077) === 0`: chmod it to 0o700 and accept it. Rationale to put in the
   code comment: no other user could ever have traversed into it, so the old "a same-group plant survives chmod"
   concern (existing comment in `isOwnedMode700Dir`) does not apply. Every other case keeps the existing reject
   (other bits set, foreign uid, symlink, parent not private). Keep the existing comment's warning, narrowed to the
   case it still covers.
3. **Header contract comment** in `live-state-dir.js`: update the candidate order and the rejection rule; note that the
   Rust twin (codeforge `src/live.rs`) needs no change for resolution because the statusline process always has
   `XDG_RUNTIME_DIR`, but that codeforge should create the dir 0700 (depth-0 files that as a separate backlog row — the
   hand does not touch codeforge).
4. State migration note (no code): hook-owned state currently in `/dev/shm/autopilot-<uid>/{advisory-queue,context-budget,
   depth0-gate,dirty-tree-reminder}` is orphaned once hooks resolve to the xdg path; all of it is advisory/rebuildable.
   Depth-0 will record this in CHANGELOG — the hand writes no CHANGELOG.

## Per row (keep it to ≤ 8 tool calls; combine read-only commands)
1. **Premise check (1 call):** re-derive the defect at the base: `env -u XDG_RUNTIME_DIR node -e` requiring
   `scripts/lib/live-state-dir.js` and printing `resolveLiveDir()` → expect source `shm`. Gone → `SKIP 1 <evidence>`.
2. **Write `RUN/hand-1.md`** with these sections:
   - **Product:** the four points above, described in prose. The redispatch-prompt hygiene gate rejects fenced code blocks and "around line N".
   - **Tests (RED-first):** new suite `hooks/tests/live-dir-xdg-inference.test.sh` (`chmod +x`, and `test -x` it — `git update-index --chmod` alone is reverted by a later `git add`). Cases, all using a temp dir as the injected `runUserRoot`
     (the temp root lives on whatever fs; inject `procMountsPath` with a synthetic mounts file declaring it tmpfs and
     force the /proc/mounts path by injecting an `execFile` that throws ENOENT, mirroring `scripts/lib/live-state-dir.test.js`):
     `assert_r1_split_env_reader_finds_writer` — writer-side resolution with `XDG_RUNTIME_DIR=<root>/<uid>` writes a
     valid `context/<sid>.json` (schema_version 1, fresh `written_at`, `context_window_size` 1000000); reader-side
     resolution with XDG unset and the same injected root returns source `xdg-inferred` and `readLive` returns the object;
     `assert_r1_group_bits_tightened` — pre-existing 0775 candidate under a 0700 parent is accepted and ends 0700;
     `assert_r1_other_bits_rejected` — 0777 candidate is still rejected (falls through);
     `assert_r1_public_parent_rejected` — 0775 candidate under a 0755 parent is still rejected and NOT chmodded;
     `assert_r1_missing_parent_skipped` — no `<root>/<uid>` → no directory created there, falls through to shm/tmp;
     `assert_r1_context_budget_reads_1m` — run `hooks/context-budget.js` (read its header for how it takes input and
     which env/opts steer the live dir; use `AUTOPILOT_LIVE_DIR` only if no other seam exists, and say so) with XDG
     unset and a live file declaring 1000000, and assert it does not treat the window as 200K.
     Before fixing, run the suite against the unmodified base and record the red output as a `# RED at <sha>:` comment.
     Existing pins: `scripts/lib/live-state-dir.test.js` likely pins candidate order and the reject-on-0o077 rule — update
     those cases to the new contract, do not delete them.
   - **Verify:** `test -x` on the new suite, then run each solo, foreground, with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID ... < /dev/null`:
     the new suite; `node scripts/lib/live-state-dir.test.js`; `node scripts/statusline-live-tee.test.js`;
     `node hooks/context-budget.test.js`; `bash hooks/tests/context-budget-window-memory.test.sh`;
     `bash hooks/tests/hooks-live-state-misc.test.sh`; `bash hooks/tests/context-window.test.sh`;
     `bash hooks/tests/foreman-guard.test.sh`; `bash hooks/tests/advisory-relay.test.sh`;
     `bash hooks/tests/hook-advisory-channel.test.sh`; plus any other suite `grep -rl resolveLiveDir hooks scripts` finds;
     `node scripts/check-js-syntax.js`; `bash scripts/sync-codex-plugin-skills.sh --check`.
   - **Allowed files:** `scripts/lib/live-state-dir.js`, `scripts/lib/live-state-dir.test.js`,
     `hooks/tests/live-dir-xdg-inference.test.sh`, `hooks/tests/run.sh` (only if suites are registered by name there),
     `hooks/README.md` (only if it states the candidate order), plus `platforms/codex/plugin/` mirrors via `bash scripts/sync-codex-plugin-skills.sh`.
   - This line, verbatim: "Commit ONE commit; touch no other file; run every Verify command in the foreground before committing."
3. **Dispatch** (Bash `run_in_background: true`, AND in the same turn a background `sleep 2700; echo WAKE-livedir-1`; then END YOUR TURN):
   `cd $C && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-hetero.sh --branch hands/livedir/1 --base 8de1afa6 --ledger RUN/hands.ledger --run-id livedir-1 --stage implement --runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m --prompt-file RUN/hand-1.md > RUN/1.dispatch.json 2> RUN/1.dispatch.err; echo "rc=$?" >> RUN/1.dispatch.err`
   On any wake: look for `rc=` in `RUN/1.dispatch.err`. If it is not there, wait once with `node scripts/wait-dispatch-results.js --ledger RUN/hands.ledger --expect livedir-1.implement --timeout 500`
   (foreground, Bash timeout 560000).
4. **Review:** diff `8de1afa6..hands/livedir/1` into `RUN/1.diff`, then run
   `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file RUN/1.diff --spec-file RUN/hand-1.md > RUN/1.review.json`
   in the FOREGROUND with Bash timeout 1000000. If you get no verdict or tool-call-shaped text, retry once with "You have no tools. Answer only with the verdict JSON." added to the spec.
   Ask the reviewer explicitly (in the spec) to scrutinise the chmod-tightening condition for a privilege/plant hole.
   If the verdict is FIX-THEN-SHIP with 🔴/🟠 findings you judge real, dispatch ONE repair hand on `hands/livedir/1-r2` (base = the head of `hands/livedir/1`) and re-review.
   You may not dismiss a 🔴/🟠 yourself — list it in the REPORT for depth-0.
5. A hand-rail failure (quota, readiness, 402, "Cannot use this model", precondition) → `RAIL-FAIL 1 <rc> <stderr tail>`. NEVER author the code yourself.

## After the row
In a throwaway worktree at the accepted head (`git -C $C worktree add RUN/verify <head>`), rerun the Verify list solo, one at a time,
each with the env prefix and `< /dev/null`. Also run, from that worktree, the real-host proof:
`env -u XDG_RUNTIME_DIR node -e` printing `resolveLiveDir()` (expect source `xdg-inferred`, base `/run/user/1000/autopilot`)
— note that this call WILL chmod the real `/run/user/1000/autopilot` to 0700; depth-0 authorizes that. Then `readLive` on one
fresh sid from `/run/user/1000/autopilot/context/` and print its `context_window_size`. Then remove the worktree.

## Report
`RUN/REPORT.md`: `LAND 1 <head>` / `SKIP` / `FAIL` / `RAIL-FAIL` / `NO-VERDICT`, with the diff stat, the review verdict and findings, the RED line,
the verify table (rc per suite), and the real-host proof output.
Final message: the REPORT path and that line. Do not bump the version, edit CHANGELOG or BACKLOG, merge, or push.
