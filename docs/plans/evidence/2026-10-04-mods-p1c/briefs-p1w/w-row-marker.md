# P1W row MARKER — the session-mode marker becomes the per-session record (DRAFT, dispatch only after owner go)

Read `w-common.md` first. Base: `w/int2` (e227528e). Worktree `$P/wt-marker`, branch `w/marker`.

## Why
The marker was built as the /l3–/l6 mode flag, but the plan already uses it as the per-session record (§2.7/§2.8: `project_key`, `root_run_id`, `started_at`; W1f job root; W2b-m `phase`; W3a elapsed). One reader, `scripts/dispatch-hetero.sh`, treats a marker without `level` as corrupt and blocks every hetero dispatch on the host (PHASE+PICK STOP finding: `check_session_mode_gate` ~L985–1022, `check_marker_campaign_admission_bridge` ~L1448; pinned by `hooks/tests/session-mode-phase.test.sh` §8). Owner 2026-10-05: no workaround (no separate phase file); fix the contract.

## Contract
- `level: null` = plain session (no orchestrator mode). `level ∈ {l3,l4,l5,l6}` unchanged. Header comment of `scripts/session-mode.js`, `references/` text that documents the marker (find it), and the marker schema if one exists state this.
- `session-mode.js set` without `--level` (or `--level none`) writes `level: null`; with `--phase` sets the phase too. `status` prints `level: none`.
- `root_run_id` stays `null` for a plain-session marker unless `--root-run-id` or `AUTOPILOT_ROOT_RUN_ID` is given (assigning job roots to plain sessions is OUT OF SCOPE).

## Deliverables (each RED-first, mutation output under `$P/run-w/marker/`)
1. **Readers** — every marker reader handles `level: null` explicitly as "not an orchestrator marker":
   - `scripts/dispatch-hetero.sh` classifier + campaign bridge: skip `level: null` (and expired) markers exactly as if absent; a malformed `level` (not null, not l3–l6) stays invalid. Test with the real script: plain marker present → hetero dispatch proceeds past the gate (stub the rest as the existing suites do); malformed level → still refused.
   - Every other reader (start from the PHASE report list: orchestrator-edit-gate, foreman-guard, run-approval-gate, context-budget, transcript-reader-lib, live-pointer, runs-watch + runs-watch-autostart, autopilot-engine, merge/cli, repair-lineage-cleanup, decision-ledger, dispatch-author.sh, next-pick; re-derive with `git grep -l -e session-mode -e SESSION_MODE_DIR` over hooks/ scripts/ src/): one test each proving behaviour with a `level: null` marker equals behaviour with no marker, except fields that are meant to be read (project_key, root_run_id, phase, started_at).
2. **Writer for plain sessions** — the W1c SessionStart path (`hooks/runs-watch-autostart.js`, same opt-in rule and `AUTOPILOT_RUNS_WATCH_AUTOSTART` knob) ENSURES a marker for this session id: create `level: null` only when no unexpired marker exists for this session; NEVER overwrite. Tests: active l5 marker + SessionStart `compact` → marker bytes unchanged; `resume` same; no marker + `startup` in an opted-in repo → plain marker created; not opted-in repo → nothing created; expired marker → replaced by a plain one (state the rule in the header).
   Ordering: deliverable 1 lands in the SAME commit as 2 (never the writer alone).
3. **Phase** — `set --phase` on a `level: null` marker updates in place (the PHASE path). `set --phase` with no marker still exits 2 (fail-closed), message updated.
4. **Not-opted-in prompt cost** (INT2 latency: +47 ms per UserPromptSubmit in a repo that is not opted in, from the git spawn that resolves scope inside `advisory-relay.js`'s hosted autostart work): decide opt-in WITHOUT spawning git first (walk up from cwd for the repo's opt-in signals — project config file, marker of this session, knob — read the exact rule from `runs-watch-autostart.js`), spawn git only when a signal is found. Target: not-opted-in added cost ≤ 10 ms in the host process, measured with `hooks/tests/hook-latency.js` A/B against `w/int2`, `/proc/loadavg` recorded.
5. Mods/watcher: a plain-session marker must make dev-flow sessions resolve `project_key` through the marker path (plan §2.8 (a)) — add one watcher/live-pointer test proving a dev-flow session with a plain marker gets its project and phase.

## Verify
Consumer sweep for every reader touched + L1 + checks per w-common. The long suites run strictly one at a time, foreground: `dispatch-hetero.test.sh`, `dispatch-hetero-contract.test.sh`, `dispatch-hetero-wall-timeout.test.sh`, `resolve-review-loop*.test.sh`, `hetero-review-loop*.test.sh`. Hook count unchanged (no new hook); if hooks.json changes, recompute counts with `sync-version.js --version 2.36.116` (no bump).

## Report
`$P/run-w/marker/REPORT.md`: reader table (reader, file:line, behaviour with null level, test name), the ensure rule, latency table, everything not done. One commit `feat(session-mode): plain-session markers with level null, readers and SessionStart ensure (mods P1W MARKER)`.
