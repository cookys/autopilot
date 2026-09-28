Engine: sonnet

# Closeout foreman — {{VERSION_EXPECT}} ({{BUNDLE_NAME}}): evidence, doc-sync, a BACKLOG row, HANDOFF (no version bump)

Repo `{{REPO}}`, develop HEAD `{{RELEASE_TIP_SHA}}` (clean). Nothing else runs here, so commit here. `H={{SCRATCH}}`.
Stay under ~40 tool calls. Pass an explicit Bash timeout on long commands and keep them in the foreground.

1. **Scoped doc-drift** on `git diff {{BASE_SHA}} {{RELEASE_TIP_SHA}} -- hooks scripts src`. List the new surfaces this bundle introduced:
   - {{NEW_SURFACE_1}}
   - {{NEW_SURFACE_2}}

   Check `hooks/README.md`, `references/` (any doc that describes the same channel/behavior), `docs/scripts-inventory.md`, `project-config-template/`, `README*.md`, and the skills that mention what changed. Fix only real drift, then run `bash scripts/sync-codex-plugin-skills.sh` and `--check`, and
   `node scripts/doc-drift-gate.js .` (no new FAIL beyond the known baseline count).
2. **BACKLOG row** per `references/backlog-entry.md`, for anything discovered mid-pipeline that is out of scope to fix now:
   - title "{{BACKLOG_TITLE}}";
   - Status open, Effort {{EFFORT}};
   - Trigger "{{TRIGGER_TEXT}}";
   - Source "{{SOURCE_TEXT}}";
   - Pointer: a new sidecar `docs/backlog/{{SIDECAR_SLUG}}.md` with the details from `$H/run-land/REPORT.md`.

   Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (exit 0).
3. **Evidence**: create `docs/plans/evidence/{{DATE}}-{{SLUG}}/landing/` and copy into it:
   - `$H/brief.md`, `$H/brief-land.md`, this brief;
   - `$H/run/REPORT.md` as `REPORT-foreman.md`, `$H/run-land/REPORT.md` as `REPORT-land.md`;
   - the review JSONs from `$H/run-land/` in review-id order (`review-1.json`, `review-2.json`, …).

   Run the secret grep (`node scripts/secret-scan-diff.js` or `identifier-scan.js`) on the copies. Add a README of 10–15 lines covering:
   - the shape of the pipeline that produced this bundle;
   - what was probed and its result;
   - what the combined review caught that the per-row reviews missed. **Lesson: per-row review cannot replace the combined review.**
   - any incident opened as a BACKLOG row above.
4. **HANDOFF**: update `docs/projects/ongoing-maintenance/HANDOFF.md` 現況 to {{VERSION_EXPECT}}, record what shipped, and list the next candidates (from the review's 🔵 follow-ups and any new BACKLOG rows). Keep its zh-TW style.
5. **Gates**: `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), `bash scripts/validate.sh`, `node scripts/check-hook-inventory.js --check`.
   If you touch a qc-protected path (`hooks/`, `references/`, `skills/`), run one fable review of the diff, with the same `dispatch-review.sh` shape as the land brief §3, and put
   `QC-Verdict: PASS (reviewer claude-fable-5-1 <the real review id>, {{DATE}})` directly above `{{CO_AUTHORED_BY_TRAILER}}` in the same final paragraph.
6. Make ONE commit, `docs(closeout): {{VERSION_EXPECT}} — {{SLUG}} evidence, doc drift, backlog row, HANDOFF`, then run `git fetch origin && git rebase origin/develop && git push origin HEAD:develop`
   (no pipe, no --force). Confirm with ls-remote.

Final message: the drift findings (fixed, or none per surface), the BACKLOG row title, and the pushed SHA.
