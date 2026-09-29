Engine: sonnet

# Closeout foreman — v2.36.104 (dispatch-hetero watchdog follow-ups): evidence, doc-sync, a BACKLOG row, HANDOFF (no version bump)

Repo `/home/cookys/projects/autopilot`, develop HEAD `8b893744` (clean). Nothing else runs here, so commit here. `H=/tmp/claude-1000/-home-cookys-projects-autopilot/f66e4da1-524e-49e7-9bb6-ef4e7a6c5451/scratchpad/wdogfu`.
Stay under ~40 tool calls. Pass an explicit Bash timeout on long commands and keep them in the foreground.

1. **Scoped doc-drift** on `git diff ab00b82e 8b893744 -- hooks scripts src`. List the new surfaces this bundle introduced:
   - `_watchdog_worker_alive` semantics: dead only when positively proven dead, unknown => alive (fires); `timeout_enforced:false` on the no-setsid/no-job-control degrade path; cgroup-kill pgid fallback; `.fired` stamped only after the target is confirmed alive
   - detached branch now reaps its container; OUTPUT contract comment no longer lists `default` for result-JSON timeout_source (manifest only)

   Check `hooks/README.md`, `references/` (any doc that describes the same channel/behavior), `docs/scripts-inventory.md`, `project-config-template/`, `README*.md`, and the skills that mention what changed. Fix only real drift, then run `bash scripts/sync-codex-plugin-skills.sh` and `--check`, and
   `node scripts/doc-drift-gate.js .` (no new FAIL beyond the known baseline count).
2. **BACKLOG row** per `references/backlog-entry.md`, for anything discovered mid-pipeline that is out of scope to fix now:
   - title "dispatch-hetero watchdog round-2 cleanups: dead _watchdog_pgid_has_live, test-helper hygiene, HETERO_TEST_* knobs";
   - Status open, Effort S;
   - Trigger "next dispatch-hetero containment change";
   - Source "v2.36.104 landing review rounds 1-4";
   - Pointer: a new sidecar `docs/backlog/dispatch-hetero-watchdog-round2-cleanups.md` with the details from `$H/run-land/REPORT.md`.

   Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (exit 0).
3. **Evidence**: create `docs/plans/evidence/2026-09-29-dispatch-hetero-watchdog-followups/landing/` and copy into it:
   - `$H/brief.md`, `$H/brief-land.md`, this brief;
   - `$H/run/REPORT.md` as `REPORT-foreman.md`, `$H/run-land/REPORT.md` as `REPORT-land.md`;
   - the review JSONs from `$H/run-land/` in review-id order (`review-1.json`, `review-2.json`, …).

   Run the secret grep (`node scripts/secret-scan-diff.js` or `identifier-scan.js`) on the copies. Add a README of 10–15 lines covering:
   - the shape of the pipeline that produced this bundle;
   - what was probed and its result;
   - what the combined review caught that the per-row reviews missed. **Lesson: per-row review cannot replace the combined review.**
   - any incident opened as a BACKLOG row above.
4. **HANDOFF**: update `docs/projects/ongoing-maintenance/HANDOFF.md` 現況 to v2.36.104, record what shipped, and list the next candidates (from the review's 🔵 follow-ups and any new BACKLOG rows). Keep its zh-TW style.
5. **Gates**: `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), `bash scripts/validate.sh`, `node scripts/check-hook-inventory.js --check`.
   If you touch a qc-protected path (`hooks/`, `references/`, `skills/`), run one fable review of the diff, with the same `dispatch-review.sh` shape as the land brief §3, and put
   `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review id>, 2026-09-29)` directly above `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` in the same final paragraph.
6. Make ONE commit, `docs(closeout): v2.36.104 — dispatch-hetero-watchdog-followups evidence, doc drift, backlog row, HANDOFF`, then run `git fetch origin && git rebase origin/develop && git push origin HEAD:develop`
   (no pipe, no --force). Confirm with ls-remote.

Final message: the drift findings (fixed, or none per surface), the BACKLOG row title, and the pushed SHA.


## Bundle-specific notes (depth-0)
- Brief paths differ from the template: implement brief = `$H/run/implement-brief.md`, land brief = `$H/run/land-brief.md`, hand briefs `$H/run/hand-*.md`, implement REPORT `$H/run/REPORT.md`, land REPORT `$H/run-land/REPORT.md`, reviews `$H/run-land/wdfu*.review.json` (r1..r4, in that order) plus the implement-side `$H/run/*.review.json`. Copy them all under `docs/plans/evidence/2026-09-29-dispatch-hetero-watchdog-followups/`.
- BACKLOG row content = the still-open 🔵/🟡 items listed in the v2.36.104 CHANGELOG "known follow-ups" (read them there; do not re-invent). Sidecar items 4 and 7 were verified non-defects: do NOT list them.
- Evidence README must state the pipeline's real shape: implement foreman + cursor grok hands (R1-R5, with repairs on R2 and R3), landing foreman with FOUR combined-review rounds. Round 1 🟠 alive-check fail-open (ps unusable => watchdog exits, run unbounded, timeout_enforced still true); round 2 same defect in the SCOPE_UNIT branch when fallback pgid empty; round 3 same defect when WORKER_RP and fallback both empty. Three per-shape repairs did not converge; the operator chose a single-rule rewrite ("dead only when positively proven, everything else alive") which passed round 4 SHIP-AS-IS. Also: every hand's dispatch reported status failure "wall timeout 2400s" although a verified commit existed; depth-0 verified red-at-base / green-at-head by running suites in the hand worktrees itself.
- Add a new section to `references/evidence-discipline.md` (next free section number, follow its existing format): "fixing a fail-open one shape per review round does not converge — enumerate the shape matrix and rewrite as one rule". This touches a qc-protected path, so step 5's fable review applies. Do not create a memory file; the repo file is the home for this class of lesson.
- HANDOFF: mark the watchdog follow-ups item done (v2.36.104), keep the remaining candidates (foreman-guard cost gate parked), add the new BACKLOG row as a candidate, and note the trailer id `axDOqP` in the v2.36.104 release commit is a raw_log path suffix (the manifest has no run-id field) — a known format inconsistency, not a defect.
