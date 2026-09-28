Engine: sonnet

# Closeout foreman — v2.36.100 (context-budget live-dir fix): evidence, doc-sync, BACKLOG, lesson, HANDOFF (no version bump)

Repo `/home/cookys/projects/autopilot`, develop HEAD `b8d0aa43` (clean). Nothing else runs here, so commit here.
`H=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/livedir`.
Stay under ~40 tool calls. Pass an explicit Bash timeout on long commands and keep them in the foreground.
Prefix suites/rails with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix `< /dev/null`.

1. **Scoped doc-drift** on `git diff 0ecc19b2 b8d0aa43 -- hooks scripts src`. New surfaces:
   - `resolveLiveDir()` candidate `xdg-inferred` (`/run/user/<uid>/autopilot` when `XDG_RUNTIME_DIR` is unset) and `opts.runUserRoot`;
   - private-parent tightening: a self-owned candidate with group/other bits under a private (0700, self-owned) parent is chmod'd 0700 and accepted.
   Check `hooks/README.md`, `references/` (grep `XDG_RUNTIME_DIR`, `/dev/shm`, `live-state`, `resolveLiveDir`), `docs/scripts-inventory.md`
   (row for `lib/live-state-dir.js`), `project-config-template/`, `README*.md`, skills mentioning the live dir. Fix only real drift, then
   `bash scripts/sync-codex-plugin-skills.sh` and `--check`, and `node scripts/doc-drift-gate.js .` (no new FAIL beyond the baseline at 0ecc19b2 — measure baseline in a throwaway worktree if unsure).
2. **CHANGELOG v2.36.100 section**: rewrite it in the file's zh-TW house style (see v2.36.99 section and memory rule: 句子要主詞, gate 不譯),
   ≤ 12 lines, same facts: symptom → cause → new rule (private-parent) → migration note → the review-round story in ONE sentence → pre-existing reds.
   Do not change the heading version.
3. **BACKLOG rows** per `references/backlog-entry.md`, ONLY for items not already in `docs/BACKLOG.md` (grep first):
   - the two pre-existing reds found at base during landing: `engine-qualify-verdict-stability.test.sh` (D6 honest/parity grader-hash drift) and
     `migrate-backlog-entries.test.sh` (real `docs/BACKLOG.md` migratable-entry count below its ≥100 gate — a test that reads the real store;
     note it may be affected by BACKLOG row count). Details from `$H/run-land/REPORT.md`. Status open, Effort S, Trigger "FIRED — red at origin/develop 2026-09-28",
     Source "v2.36.100 landing gate". One sidecar `docs/backlog/preexisting-reds-2026-09-28.md` shared by both rows is fine.
   Then `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (exit 0).
4. **Lesson** — append `§47` to `references/evidence-discipline.md` in the file's existing section shape (incident, why the green lied, the preventing artifact):
   "A real-host proof that mutates the state it proves makes every later proof vacuous." Incident: round 1's real-host proof chmod'd the real
   `/run/user/1000/autopilot` 0775→0700; round 2's proof and depth-0's own before/after then ran against 0700 and passed, while the r2 rule
   still rejected the production 0775 dir; only the landing combined review caught it (🔴). Also: the spec author (depth-0) had written the wrong
   rule ("no other bits") despite having observed 0775 in the pre-check. Preventing artifact: the r3 proof restores the precondition (`chmod 0775`
   and `stat` it) before each run, and the test names the production case (0775 under 0700 parent). Also note round 1 wrote a synthetic
   `livedir-proof-*.json` into the real context dir (removed by depth-0) — proofs must not write into real stores.
   Keep it ≤ 15 lines. Check `node scripts/check-reference-sizes.js` still passes.
5. **Evidence**: create `docs/plans/evidence/2026-09-28-context-budget-live-dir/` and copy: `$H/run/implement-brief.md`, `$H/run/repair-r3-brief.md`,
   `$H/land-brief.md`, `$H/closeout-brief.md` (this file), `$H/run/hand-1*.md`, `$H/run/REPORT.md` as `REPORT-foreman.md`,
   `$H/run-land/REPORT.md` as `REPORT-land.md`, every `*.review.json` from `$H/run/` and `$H/run-land/` (name them `review-<round>-<scope>.json`,
   in order). Run `node scripts/secret-scan-diff.js` (or `identifier-scan.js`) over the copies. README (10–15 lines, zh-TW): pipeline shape
   (implement foreman + cursor grok hands r1/r2/r3, landing foreman twice), the depth-0 pre-check (dir 0775, parent 0700), what the combined
   review caught that the per-row reviews missed, the operator decisions (雙邊修; 只看父目錄), and the BACKLOG rows opened.
6. **HANDOFF** `docs/projects/ongoing-maintenance/HANDOFF.md`: 現況 → v2.36.100 at the closeout SHA; record what shipped; update 下一步:
   item 1 is done (the peer session 308-d1 asked to be told — the operator was told; no reply to 308-d1 needed); next = `docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`,
   then the new pre-existing-red rows, then the codeforge 0700 row; keep `foreman-guard-cost-shaped-gate` as not-yet-triggered. Remove the 陷阱 line about
   1M sessions getting false T2. Keep its zh-TW style.
7. **Gates**: `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), `bash scripts/validate.sh`,
   `node scripts/check-hook-inventory.js --check`. `references/` is qc-protected: run one review of your diff —
   `git diff b8d0aa43 > $H/closeout.diff`, `scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file $H/closeout.diff --spec-file $H/closeout-brief.md > $H/closeout.review.json`
   (foreground, Bash timeout 1000000). STOP on 🔴/🟠 and report. Put
   `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review id from $H/closeout.review.json>, 2026-09-28)` directly above
   `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` in the same final paragraph.
8. ONE commit, `docs(closeout): v2.36.100 — context-budget live-dir evidence, doc drift, backlog rows, evidence-discipline §47, HANDOFF`, then
   `git fetch origin && git rebase origin/develop && git push origin HEAD:develop` (no pipe, no --force). Confirm with `git ls-remote origin develop`.

Final message: drift findings per surface (fixed / none), BACKLOG row titles added (or "already present"), the review id, and the pushed SHA.
