Engine: sonnet

# Closeout foreman — v2.36.97 (foreman-guard): small fixes, evidence, doc-sync, HANDOFF (no version bump)

Repo `/home/cookys/projects/autopilot`, develop HEAD `edc0e9cc` (clean). Nothing else runs here, so commit here. `F=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/fg`.
Stay under ~40 tool calls. Run long commands in the foreground with an explicit Bash timeout.

1. **Known follow-ups from the landing self-review and the final review (fix them):**
   - `CHANGELOG.md` v2.36.97 section: the simplified-Chinese `没` must be the Traditional `沒`. Grep the whole v2.36.97 section for other simplified characters too.
   - `hooks/README.md` foreman-guard row: it still opens with "depth-0 and plain sessions are untouched", which conflicts with the new no-marker advisory for `Engine:`-dispatched subagents. Reword it minimally.
   - `hooks/tests/foreman-guard-roles.test.sh`: the TMPDIR-unset case fails instead of skipping on a host without `/dev/shm`. Make it skip with a printed SKIP line when `/dev/shm` is absent. This is a test-only change.

   Verify with `bash hooks/tests/foreman-guard-roles.test.sh` and `bash hooks/tests/foreman-guard.test.sh`, both with the env -u prefix and `< /dev/null`.
2. **Scoped doc-drift** on `git diff f8a8a5f9 edc0e9cc -- hooks scripts src`. The new surfaces are:
   - config keys `foreman_guard.role_caps` / `reserve_calls` / `advisory_every`;
   - env `AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS` and any other new env vars;
   - the `Role:` line convention.

   Check `docs/scripts-inventory.md`, `project-config-template/`, `references/`, `skills/**`, `hooks/README.md`, and the config docs wherever `foreman_guard.mode` / `bash_cap` are documented. Every place that documents the old keys should also document the new ones. Fix only real drift, then run
   `bash scripts/sync-codex-plugin-skills.sh` and `--check`, and `node scripts/doc-drift-gate.js .` (no new FAIL beyond the 3 known baseline ones).
3. **Evidence:** create `docs/plans/evidence/2026-09-25-foreman-guard-roles/landing/` and copy into it:
   - `$F/brief.md`, `$F/brief-land.md`, this brief;
   - `$F/run/REPORT.md` as `REPORT-foreman.md`, `$F/run-land/REPORT.md` as `REPORT-land.md`;
   - `$F/run-land/fg.review.json` as `review-1-fix-then-ship.json`, `$F/run-land/fg2.review.json` as `review-2-ship.json`.

   Run the secret grep on the copies. Add a README (10–15 lines) covering:
   - the shape;
   - the P0/P1 probes;
   - the allow-bypass finding and its fix, as the key lesson: an advisory hook must never emit `permissionDecision:"allow"`;
   - the gate results;
   - that the plan-review chair was swapped to fable for one run because codex quota was exhausted.
4. **HANDOFF:** update `docs/projects/ongoing-maintenance/HANDOFF.md` 現況 to v2.36.97, and record that foreman-guard role caps shipped. Keep its zh-TW style.
   The next candidates are:
   - the cost-shaped-gate BACKLOG row (not fired);
   - grok `--timeout` not applied (S).
5. **Gates:** `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), `bash scripts/validate.sh`, `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md`.
   `hooks/README.md` and `hooks/tests` are probably not qc-protected. If the pre-push qc-gate demands a trailer, run one fable review of the diff (the same dispatch-review.sh command shape as in `$F/brief-land.md` §3) and add
   `QC-Verdict: PASS (reviewer claude-fable-5-1 <id>, 2026-09-25)` right above `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` in the same final paragraph.
6. Make ONE commit, `docs(closeout): v2.36.97 — foreman-guard evidence, doc drift, zh-TW typo, /dev/shm skip, HANDOFF`, then run `git fetch origin && git rebase origin/develop && git push origin HEAD:develop`
   (no pipe, no --force). Confirm with ls-remote.

Final message: each fix as file:line, the drift findings (fixed, or none per surface), and the pushed SHA.
