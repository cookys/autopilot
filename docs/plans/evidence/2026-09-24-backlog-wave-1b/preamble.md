## WAVE-1b OVERRIDES — read first; where this section and the 09-21 text below disagree, THIS section wins

Context: the 09-21 foreman rules and row briefs below were written against develop `47b52eac`/`a95217a0`.
Develop is now `475ebdc7` (v2.36.92 + evidence commits; ~190 commits later). Wave-1 already landed every other row
of this bundle; only the rows listed in YOUR UNIT below remain.

1. **Repo & base.** Your clone: `CLONE` (already created, HEAD = `475ebdc78ac9c0494c8c1fb794de45e763fc3599` on branch
   `w1b-base`; git hooks enabled; push disabled). BASE_SHA = `475ebdc7…` for the first row. `<rail>` = `CLONE/scripts`.
   Run dir: `RUNDIR`. Never touch `/home/cookys/projects/autopilot` (the main checkout) — not even `git fetch`.
2. **Premise check FIRST, per row, before any hand.** One Bash call per row: re-derive the row's defect at base
   (grep the named symbol / run the named repro). Line numbers in the brief are stale — find the current site.
   - Defect gone at base → record `SKIP <n> already-shipped (<sha or file:line evidence>)` in REPORT.md, no hand.
   - Defect present but the brief's file list is wrong for the current tree → re-derive `Allowed files` yourself,
     minimal, and write it into the hand prompt; note the change in REPORT.md.
3. **Stacking.** Rows are STACKED in the order listed in your unit: row 1's `--base` = BASE_SHA; each later row's
   `--base` = accepted head of the previous DISPATCHED row (its `-r2` head if repaired). Track in
   `RUNDIR/accepted-heads.txt`. New assertions go into the bundle's EXISTING suite file named below (it already
   exists at base — append a new case function; do not recreate it). Every Verify includes `test -x` on that suite.
   Branch names: `hands/w1b-UNIT/<row-n>` (and `-r2`); run ids `w1b-UNIT-<row-n>`.
4. **Hand engine** stays as the 09-21 text says: `--runner cursor --model cursor-grok-4.6-low --effort low --timeout 40m`
   (roster `.claude/review-loop-config.md`; do not substitute an alias). If the hand rail itself fails before
   producing a commit (readiness / quota / 402 / Cannot use this model), stop that row, record `RAIL-FAIL <n> <rc> <stderr tail>`,
   and continue — do NOT author the code yourself.
5. **Waiting (this is where foremen stall).** The hand dispatch is ~10–40 min. Run the `dispatch-hetero.sh` call with the
   Bash tool's `run_in_background: true`, and IN THE SAME TURN start a second background Bash `sleep 2700; echo WAKE-UNIT-<row-n>`.
   Then end your turn. On any wake: check the dispatch stderr for `rc=`; if not done, wait once via
   `node <rail>/wait-dispatch-results.js --ledger RUNDIR/hands.ledger --expect w1b-UNIT-<row-n>.implement --timeout 500`
   (foreground, Bash timeout 560000). Never a shell sleep loop, never `Monitor`.
6. **Env hygiene.** Prefix EVERY rail and verify command with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`
   and suffix verify commands with `< /dev/null`. Run long suites one at a time; a red that only shows up while
   another suite runs gets re-run solo before you believe it.
7. **Review.** As written below (`dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m`).
   If the review returns tool-call-shaped text instead of a verdict, re-run once adding to the spec file the line
   "You have no tools. Answer only with the verdict JSON." A review that still yields no verdict → record
   `NO-VERDICT <n>` and move on; depth-0 will review.
8. **Budget.** A hook caps you at ~40 tool calls. Combine read-only commands into one Bash call; spend ≤ 8 calls per row.
   Skip the old "final §5 full verify" worktree step if you are under 6 calls left — instead run just the bundle suite on
   the last accepted head (`git -C CLONE worktree add RUNDIR/verify <head>`; run; `worktree remove`).
9. **Codex mirror.** If a row touches a mirrored path, the hand runs `bash scripts/sync-codex-plugin-skills.sh` then
   `--check` and includes the mirror in the same commit. `.githooks/pre-commit` runs `check-claude-md-inventory.js`:
   a new `scripts/lib/*` basename needs one CLAUDE.md grouped-list line (Allowed).
10. **Do not** bump versions, edit CHANGELOG, edit docs/BACKLOG.md, or merge. Depth-0 lands.
11. **Deliverable.** `RUNDIR/REPORT.md` per the 09-21 REPORT rules plus, per row, one of:
    `LAND <n> <head sha>` / `SKIP <n> …` / `FAIL <n> …` / `RAIL-FAIL <n> …` / `NO-VERDICT <n> <head sha>`.
    Your final message: the REPORT.md path and those per-row lines, nothing else.

