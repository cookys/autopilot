Engine: sonnet

# Closeout foreman — v2.36.101 (dispatch-hetero wall-timeout watchdog): evidence, doc-sync, lesson, HANDOFF (no version bump)

Repo `/home/cookys/projects/autopilot`, develop HEAD `27b2e583` (clean). Nothing else runs here, so commit here.
`H=/tmp/claude-1000/-home-cookys-projects-autopilot/d9a21e11-1567-4886-9a15-da347b58e585/scratchpad/wdog`.
Stay under ~40 tool calls. Explicit Bash timeouts; keep long commands in the foreground; never wait on a background monitor.
Prefix suites/rails with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID` and suffix `< /dev/null`.
If a subagent tool refuses to write a file this brief requires, write it with a Bash heredoc instead.

1. **Scoped doc-drift** on `git diff 9dbe88a7 27b2e583 -- hooks scripts src`. New surfaces:
   - `dispatch-hetero.sh --timeout` is now ENFORCED on every rail (central `run_worker` watchdog: TERM → 10 s grace → KILL of the worker's
     session/scope) iff the caller passed `--timeout` or a contract wall applies; the bare default 9m is NOT enforced;
   - result JSON fields `timed_out`, `timeout_enforced`; manifest `timeout_enforced` and `timeout_source: caller|contract_wall|caller_within_wall|default`.
   Check: the script's own header/OUTPUT comment, `references/hetero-dispatch.md` (and any reference describing `--timeout`, e.g. grep
   `--timeout` and `timeout_seconds` across `references/ skills/ docs/scripts-inventory.md README*.md`), `skills/l5` / `skills/l6` references and
   `.claude/skills/foreman-landing-pipeline/templates/*.md` (they pass `--timeout 40m` — still correct, but any text claiming the timeout is not
   enforced, or that implies default-only runs are bounded, is drift). Also `scripts/wait-dispatch-results.js` / `dispatch-status.js` docs if they
   describe result fields. Fix only real drift; `bash scripts/sync-codex-plugin-skills.sh` then `--check`; `node scripts/doc-drift-gate.js .`
   (no new FAIL beyond the baseline at 9dbe88a7 — measure in a throwaway worktree).
2. **Lesson** — `references/evidence-discipline.md`: read §26 and §40–§47 first. If no existing section already states it, append `§48`
   (same section shape, ≤ 15 lines): "A stub suite that never takes the production path proves the stub." Incident: all stub cases green at r3
   while every real dispatch runs through the detached child, whose `declare -f` serialisation list lacked `normalize_timeout_seconds`, so the
   watchdog was never armed; the brief's mandatory real-rail proof (`--timeout 20s`, agent told to `sleep 300`) ran 322 s and exposed it; the
   preventing artifact is the detached-path test case plus the real-rail proof clause in the brief. Add one line: the combined review found a
   🟠 (bare-pid fallback) on a diff byte-identical to one a per-row review had passed — reviewer verdicts are samples, which is why the combined
   review is not optional (cross-reference §43). If §43 already covers the second point, only add the cross-reference. `node scripts/check-reference-sizes.js` must pass.
3. **Evidence**: `docs/plans/evidence/2026-09-29-dispatch-hetero-wall-timeout/`: copy `$H/run/implement-brief.md`, `$H/land-brief.md`, this file,
   `$H/run/hand-1*.md`, `$H/run/REPORT.md` as `REPORT-foreman.md`, `$H/run-land/REPORT.md` (or wherever the landing foreman wrote it — `find $H -name REPORT.md`)
   as `REPORT-land.md`, every `*.review.json` from `$H/run/` and the landing run dir (rename `review-<n>-<scope>.json` in chronological order).
   Do NOT copy the `*.diff` files. Run `node scripts/secret-scan-diff.js` (or `identifier-scan.js`) on the copies. README (10–15 lines, zh-TW):
   pipeline shape (implement foreman + cursor grok hands r1–r6, landing foreman twice), depth-0 pre-check (run_worker had no bound on any rail;
   only agy enforced via its own CLI), operator decision (明訂上限才執行), what each review/proof caught (detached-path miss via real-rail proof;
   bare-pid fallback via combined review), the targeted-rerun decision on the final squash, and the BACKLOG follow-ups row.
4. **HANDOFF** `docs/projects/ongoing-maintenance/HANDOFF.md`: 現況 → v2.36.101 at the closeout SHA; record what shipped this session
   (v2.36.100 and v2.36.101); 下一步: remove the grok-timeout item; next candidates = the two pre-existing-red rows (`engine-qualify-verdict-stability`
   still red; `migrate-backlog-entries` currently green at 27b2e583 — say so, the row may be closable after one more check), the codeforge 0700 row,
   the new watchdog-follow-ups row; keep `foreman-guard-cost-shaped-gate` as not-yet-triggered. Add to 陷阱: a foreman that "waits for a monitor
   notification" can park forever with nothing running — depth-0's dead-man check must look at processes, not only git. Keep zh-TW style.
5. **Gates**: `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), `bash scripts/validate.sh`,
   `node scripts/check-hook-inventory.js --check`. `references/` is qc-protected: `git diff 27b2e583 > $H/closeout.diff`, then
   `scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 15m --diff-file $H/closeout.diff --spec-file $H/closeout-brief.md > $H/closeout.review.json`
   (foreground, Bash timeout 1000000). STOP on 🔴/🟠 and report. Trailer, final paragraph, no blank line between:
   `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review id — from the JSON or, if absent there, from the dispatch-review stderr>, 2026-09-29)`
   `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
6. ONE commit, `docs(closeout): v2.36.101 — wall-timeout watchdog evidence, doc drift, evidence-discipline, HANDOFF`, then
   `git fetch origin && git rebase origin/develop && git push origin HEAD:develop` (no pipe, no --force). Confirm with `git ls-remote origin develop`.

Final message: drift findings per surface (fixed / none), whether §48 was added or folded into an existing section, the review id, and the pushed SHA.
