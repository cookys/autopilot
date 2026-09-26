Engine: sonnet

# Closeout foreman — v2.36.98 (hook advisories): evidence, doc-sync, a BACKLOG row, HANDOFF (no version bump)

Repo `/home/cookys/projects/autopilot`, develop HEAD `5a838b2d` (clean). Nothing else runs here, so commit here. `H=/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/ha`.
Stay under ~40 tool calls. Pass an explicit Bash timeout on long commands and keep them in the foreground.

1. **Scoped doc-drift** on `git diff 9788b1bd 5a838b2d -- hooks scripts src`. The new surfaces are:
   - the `advisory-relay` hook and its opt-out `AUTOPILOT_ADVISORY_RELAY=off`;
   - the queue file location and format;
   - the multiplexer merge rules;
   - the fact that advisories are now model-visible.

   Check `hooks/README.md`, `references/` (any hook-authoring or multi-agent-portability notes that describe hook output channels, where stderr-with-exit-0 must NOT be described as model-visible),
   `docs/scripts-inventory.md`, `project-config-template/`, `README*.md`, and the skills that mention these hooks. Fix only real drift, then run `bash scripts/sync-codex-plugin-skills.sh` and `--check`, and
   `node scripts/doc-drift-gate.js .` (no new FAIL beyond the 3 known baseline ones).
2. **BACKLOG row** per `references/backlog-entry.md`:
   - title "A hook suite writes into the operator's real ~/.autopilot/engine-capability/capability.jsonl during run.sh";
   - Status open, Effort S;
   - Trigger "FIRED 2026-09-26: one row (cc-shim / MiniMax-M3, 'Passive capture from review dispatch failure') appeared during a full `run.sh --parallel 8` at the v2.36.98 landing and was removed by hand";
   - Source "v2.36.98 landing report";
   - Pointer: a new sidecar `docs/backlog/suite-pollutes-real-capability-store.md` with the details from `$H/run-land/REPORT.md` (grep "POLLUTION"): the attribution is unconfirmed, the suspect subsystem is engine-qualify / dispatch-review passive capture, and the fix is to find the suite with a guarded HOME and make it hermetic (evidence-discipline family: "a green test writing fixture rows into the real store").

   Then run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (exit 0).
3. **Evidence**: create `docs/plans/evidence/2026-09-26-hook-channel-probe/landing/` and copy into it:
   - `$H/brief.md`, `$H/brief-land.md`, this brief;
   - `$H/run/REPORT.md` as `REPORT-foreman.md`, `$H/run-land/REPORT.md` as `REPORT-land.md`;
   - `$H/run-land/ha.review.json` as `review-1.json`, and the round-2 review JSON (find it in `$H/run-land/`) as `review-2.json`.

   Run the secret grep on the copies. Add a README of 10–15 lines covering:
   - the shape;
   - the probes: PTU/PTUF/Stop and UserPromptSubmit;
   - the combined-review catches that the per-row reviews missed: the multiplexer dropping deny/ask, exit-2 paths touched, exit-1 dropped, the queue race, tsc not queued. **Lesson: per-row review cannot replace the combined review.**
   - the real-store pollution incident and its BACKLOG row.
4. **HANDOFF**: update `docs/projects/ongoing-maintenance/HANDOFF.md` 現況 to v2.36.98, record that hook advisories now reach the model, and list the next candidates:
   - the pollution row (S, fired);
   - grok `--timeout` (S);
   - the cost-shaped gate (not fired).

   Keep its zh-TW style.
5. **Gates**: `bash scripts/preflight-release.sh`, `node scripts/check-plan-graduation.js --repo-root . --json` (exit 0), `bash scripts/validate.sh`, `node scripts/check-hook-inventory.js --check`.
   If you touch a qc-protected path (`hooks/`, `references/`, `skills/`), run one fable review of the diff, with the same dispatch-review.sh shape as `$H/brief-land.md` §4, and put
   `QC-Verdict: PASS (reviewer claude-fable-5-1 <id>, 2026-09-27)` directly above `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` in the same final paragraph.
6. Make ONE commit, `docs(closeout): v2.36.98 — hook-advisory evidence, doc drift, suite-pollution backlog row, HANDOFF`, then run `git fetch origin && git rebase origin/develop && git push origin HEAD:develop`
   (no pipe, no --force). Confirm with ls-remote.

Final message: the drift findings (fixed, or none per surface), the BACKLOG row title, and the pushed SHA.
