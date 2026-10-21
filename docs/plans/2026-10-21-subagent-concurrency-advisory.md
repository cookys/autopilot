# Plan — subagent concurrency advisory (BL-0271 item 4)

> Status: draft 2026-10-21, inventory and design only, nothing implemented, awaiting hetero plan review. Origin: BL-0271 item 4. Owner reply to pending card d-26439c63: do not build yet; systematic inventory, then a plan, then hetero loop review, then decide.

## 0. Context / thesis

llm-playground's token-discipline rule 4 says lightweight subagents use a cheap model at low effort, at most 3 at the same time. Autopilot already counts how many subagents were dispatched. It does not know how many are running. The tokmech foreman judged that guessing liveness from transcript mtime is unreliable, because a parked subagent writes nothing for a long time. This plan inventories the running signals that already exist, and specifies an advisory (never a deny) that reads the agent-activity stamp only after a Phase 0 live spike settles the hook facts marked UNVERIFIED below. Nothing in this document is implemented.

Facts below are either read from this repo on 2026-10-21 (method `read-code`, with file and line) or taken from an official URL (method `official URL`). Anything the code and the docs do not settle stays on the UNVERIFIED list. No rate, card, or hook behaviour beyond that inventory is introduced.

## 1. Problem

Rule 4 needs a count of subagents that are running now. `hooks/subagent-budget.js` (PreToolUse on `Task` and `Agent`, matcher `Task|Agent` at `hooks/hooks.json:129-141`) counts only what was dispatched. It tallies `agent-*.jsonl` transcripts in the session subagents folder: per-lane dispatches, per-lane turns, and root turns in the last 60 minutes (`hooks/subagent-budget.js:10-31`). Defaults (`hooks/subagent-budget.js:49`): mode `remind` (which denies at the ceilings; header lines 28-29), `lane_dispatch_max` 4, `lane_turns_max` 300, `root_turns_per_hour_max` 400. Modes are `remind`, `warn` (additionalContext only), and `off`. A `Budget-Ack:` line overrides a would-be deny (`hooks/subagent-budget.js:33-35`, `ACK_RE` at line 52). Config is `~/.autopilot/config.json` key `subagent_budget`, plus `AUTOPILOT_SUBAGENT_BUDGET_*`, registered in `scripts/lib/config-keys.json` (names at lines 601, 622, 638, 654 and the env overrides at 3782-3829). The hook has no "currently running" input. It fails open on a missing or corrupt transcript (`hooks/subagent-budget.js:39-40`).

The question this plan answers is whether a reliable running signal already exists. The inventory says the closest on-disk signal is the agent-activity stamp, and that it is not reliable enough to deny on.

## Signal inventory

Verification method is `read-code` unless the row says otherwise. "Running" is the rule that row uses. False positives count something as running that is not doing work. False negatives miss something that is.

| signal | source file and line | how it decides running | known false positives and false negatives | existing test | verification method |
|---|---|---|---|---|---|
| Agent activity stamp files | `hooks/live-session-lib.js`. Path: live dir, then `agents/<session id>/<agent_id>.json`. Schema `autopilot.agent-activity/1` (`readAgentFile` line 129, writers 141-201). `stampAgentActivity` (133-150): any tool call carrying `agent_id` rewrites the stamp with `last_tool_at` and `last_tool_name`, and keeps an existing `ended_at`. `endAgentActivity` (155-172): SubagentStop sets `ended_at`, first stop wins, creates the file if absent. `endAgentActivityIfPresent` (177-182): PostToolUse of TaskStop ends an existing stamp only. `startAgentActivity` (188-202): SubagentStart writes `last_tool_at` now with no `ended_at`, and is the one resurrection that clears a prior `ended_at`. Hosted by `hooks/awaiting-owner.js` (SubagentStart line 143, SubagentStop line 144, TaskStop leg lines 136-138). Deletion: `SessionEnd` calls `removeAgentActivity` (`hooks/awaiting-owner.js:145`, function `hooks/live-session-lib.js:205-207`). Read-code did not find a SessionStart caller. The authoring brief said SessionStart deletes the dir; the code deletes it on SessionEnd. Kill switch `AUTOPILOT_AGENT_ACTIVITY=off` (`scripts/lib/config-keys.json:3317`; `knobOff` at the top of each writer). | No `ended_at`. | False positives: a parked subagent stays running until the staleness cutoff if SubagentStop did not fire; a killed or crashed subagent with no Stop looks running until stale. False negatives: a long first tool call counts as running only until the 30 minute `AGENT_STALE_MS` cutoff in `scripts/lib/workflow-snapshot.js:32`, then drops out (a foreman blocked in gate-wait has this shape, because `last_tool_at` is not refreshed until the next tool). `docs/plans/evidence/2026-10-04-mods-p1c/gate/runs/RESULTS.md:56` says the resumed foreman kept the old `ended_at` (no new stamp). Line 63 of the same file says whether SubagentStart fires on a SendMessage resume is not yet verified. `docs/plans/evidence/2026-10-04-mods-p1c/gate/runs/RESULTS.md:55` records a foreman that returned early after a backgrounded shell: SubagentStop stamped `ended_at` while `gate-wait.sh` ran 5 minutes (a background shell outlived SubagentStop). `docs/plans/evidence/2026-10-04-mods-p1c/gate/runs/l4g/DRIVING.md:5` is the TaskStop case: no SubagentStop and no `ended_at` for a dead foreman. `agent_type` is often null: `docs/plans/evidence/2026-10-03-mods-visible-dispatch/u5-spike.md:45` counted 4362 of 4633 stamps with null `agent_type` (4362 of 4633; 4627 ended). Compaction: stamps live on disk keyed by session id. No compaction-specific handling was found (read-code only; `removeAgentActivity` is SessionEnd, not a compact source). Quota-hit subagents: no special handling, same as a missing Stop. | The brief named `hooks/live-session-hooks.test.js`. Read-code of that file found no agent-stamp assertions. Stamp assertions that do exist: `hooks/subagent-start.test.js`, `hooks/subagent-stop.test.js`, `hooks/hook-hosting.test.js` (schema `autopilot.agent-activity/1`). | read-code. The RESULTS.md, DRIVING.md, and u5-spike.md sentences are quotes from those evidence files (prior live runs), not a new live run for this plan. |
| `srcRoster` | `scripts/lib/workflow-snapshot.js:257-278` (mirror `platforms/codex/plugin/scripts/lib/workflow-snapshot.js:257-278`). `AGENT_STALE_MS` line 32 (30 minutes). `ROSTER_READ_CAP` line 33 (40). | Reads the stamp dir, sorts by mtime, reads only the newest 40 files. Running means no `ended_at` and `last_tool_at` within `AGENT_STALE_MS`. An unparseable `last_tool_at` counts as running (line 270: the stale skip runs only when `Date.parse` is finite). Prints `subagents: N recorded, M running (newest K read)` (line 273). | Quirk: N counts all files, M is counted only from the newest 40, so an old running agent beyond the cap is not counted. Same parked, crashed, resume, and stale false cases as the stamp row, plus this cap false negative. | `scripts/lib/workflow-snapshot.test.js` (running line 87, ended or silent agents and the cap at lines 195-208, corrupt-file coverage in the same file) and the mirror under `platforms/codex/plugin/scripts/lib/`. | read-code |
| mods `readActivity` | `mods/live/register.ts:82` (`LIVE_AGENT` = pending, running, waiting) and `readActivity` at lines 441-478 (`$.agent.list()` at 472, status filter at 475). | Harness API `agent.list()`, status in `LIVE_AGENT`. | Includes `waiting`, so a parked subagent counts as live (false positive for doing work). Parked, resume, quota, compaction: unknown whether `agent.list` status distinguishes them; verify by a live run in P0. Applicability: `agent.list` is only available inside the mod runtime, not to a PreToolUse hook, so it cannot supply a concurrency count to the budget hook. | `mods/live/live.test.ts` (mocked `agent.list` from line 4418, including the throw path in that block). | read-code |
| Shell and watch rows (not subagents) | `scanBackground` in `mods/live/model.ts:1805`, consumed by `readActivity` at `mods/live/register.ts:448`. | Scans task-notification text. These rows are shells and watches, not Agent-tool subagents. | Not a subagent signal. A row that never ends is the separate note `docs/backlog/mods-activity-row-never-ends.md`. | Covered beside the agent.list cases in `mods/live/live.test.ts`. | read-code |
| `hooks/subagent-budget.js` | File header lines 10-40; ceilings at 433-440. | Dispatch and turn counts from transcripts. No liveness input. | Not a running signal. Missing or corrupt transcript fails open (lines 39-40, 404). | `hooks/tests/subagent-budget.test.sh`. | read-code |
| Statusline tee | `scripts/statusline-live-tee.js` (header lines 4-16). | Tees the main-thread statusline only. It does not write subagent liveness. | No running count is produced here. | Not claimed by this inventory. | read-code |
| Live base directory | `scripts/lib/live-state-dir.js:10` and `:255`. | Resolves the live base only: `AUTOPILOT_LIVE_DIR`, then `XDG_RUNTIME_DIR/autopilot`, then `/run/user/<uid>/autopilot` (fallback text at line 293 also names `~/.autopilot`). | Not a liveness signal. | Not claimed. | read-code |
| `hooks/foreman-guard.js` | Lines 36 and 412-446. | Reads the subagent status line for this agent's context ceiling (`tasks` file, token window), not for a concurrency count. | A fresh `written_at` is not "this agent is doing work" for rule 4. `src/status/foreman-activity.js:11` and `:100` already say context_tasks `written_at` is the `subagentStatusLine` rewrite time (about 1 second while the agent exists). | Foreman-guard's own tests are out of this inventory's claim. | read-code |
| Official `statusLine` stdin vs `subagentStatusLine` | Official: `https://code.claude.com/docs/en/statusline.md`. Repo uses: `hooks/README.md:333` and `:347`, `hooks/foreman-guard.js:36`. | The official statusLine stdin JSON has no running-subagent count. The separate `subagentStatusLine` setting receives a `tasks` array with status `running`, `completed`, `failed`, or `killed` per subagent (official URL). | `git grep subagentStatusLine` finds uses. Autopilot does not use `subagentStatusLine` as the concurrency liveness input of `subagent-budget.js`. It uses the tasks file for the context ceiling and for foreman-activity age. Saying "not found in the repo" would be false. Parked, resume, quota, compaction: unknown how they map onto `running`/`completed`/`failed`/`killed`; verify by a live run in P0 or the official URL. Applicability: `subagentStatusLine` is a separate setting whose command runs for display and is not reachable from the budget hook without extra plumbing, so it cannot supply a concurrency count to the hook. | Not a concurrency test. | official URL for the field list; read-code for what this repo does with it |
| `scripts/agent-liveness-check.js` | Header lines 4-17. | Reports git and filesystem facts. The header says it is not a verdict and that PID liveness is wrong for a native foreman. The only strong signal is a missing worktree (`worktree_absent`). | Not usable for native subagent concurrency. | No dedicated test found (read-code: no `agent-liveness-check.test` file turned up in the hooks/scripts test search for this inventory). | read-code |
| `scripts/watch-foreman.js` | Header lines 2-26. | Watches the run ledger and dispatch manifests. Report-only. Does not track Agent-tool children. | Not usable for native subagents. | `hooks/tests/watch-foreman.test.sh`. | read-code |
| `scripts/dispatch-status.js` and the snapshot pid probe | `scripts/dispatch-status.js` header lines 3-16 (hetero dispatch manifests). Pid check for in-flight dispatches: `scripts/lib/workflow-snapshot.js:245-248` (`ended_at` and `process.kill(pid, 0)` on the manifest). | Pid probe plus `ended_at` and `final_status` for hetero engine dispatch manifests only. | Not usable for native subagents. A native foreman's shell pid is the wrong process (same reason `agent-liveness-check.js` gives). | Dispatch-status tests exist for manifests; they are not a native-subagent liveness suite. | read-code |
| `hooks/hooks.json` events | `SubagentStart` at lines 275-284, `SubagentStop` at lines 286-295. Both run only `hooks/awaiting-owner.js`, matcher `""`. | Registration only. Firing is not established by the JSON. | `docs/hook-harness-matrix.md:13` lists `awaiting-owner` events including SubagentStart and SubagentStop as 未驗證 (not verified) for Claude Code. `git grep -l SubagentStop` also hits that matrix and `hooks/hooks.json`. | The matrix is the harness record, not a passing fire-test. | read-code |
| additionalContext from this hook, this deployment | `hooks/subagent-budget.js:464` emits `additionalContext` on a Budget-Ack pass, and the warn path uses the same channel (header line 28). | Not a running signal. | The authoring brief for this plan states that the existing hook already printed an advisory line (`additionalContext`) in this very session. That is taken as proof that additionalContext from a PreToolUse Agent hook reaches the model in this deployment. The sentence is a session observation supplied by the brief, not a line read from a committed artifact. | `hooks/tests/subagent-budget.test.sh` covers the hook output shape. It does not record this session. | session observation (brief), plus read-code that the hook can emit `additionalContext` |

### Official Claude Code facts

Each item is method `official URL`. Source `https://code.claude.com/docs/en/hooks.md` unless the row names another page. These were fetched by the foreman before this plan was written. This authoring pass did not re-fetch them. They stay marked `official URL`, not `read-code`.

- SubagentStart fires when a subagent is spawned, when Claude resumes a subagent, and when an in-process agent-team teammate handles a new message. Input has `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `agent_id`, `agent_type`. It cannot block. It can inject `additionalContext`. URL: `https://code.claude.com/docs/en/hooks.md`.
- SubagentStop fires when a subagent has finished responding, also for internal agents (prompt suggestions, `/btw`). Input has `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `background_tasks`, `session_crons`. A decision `block` keeps the subagent running. Same URL.
- Stop and SubagentStop input carry `background_tasks` entries with `id`, `type` (`shell`, `subagent`, `monitor`, `workflow`, `teammate`, `cloud session`, `MCP task`), `status`, `description`, `command`, `agent_type`. The arrays are scoped to the parent session. Same URL.
- PreToolUse on tool name `Agent` (renamed from `Task` in 2.1.63 per `https://code.claude.com/docs/en/sub-agents.md`; `Task` still works as an alias in settings) sees `tool_input` fields `prompt`, `description`, `subagent_type`, `model`. `run_in_background` is not in the documented Agent field table (that absence is why the field is UNVERIFIED below, not a claim that the field is absent at runtime).
- PreToolUse can return `permissionDecision` `allow`, `deny`, `ask`, or `defer`, plus `permissionDecisionReason`, `additionalContext` (advisory text), and `updatedInput` (could rewrite `model`). URL: `https://code.claude.com/docs/en/hooks.md`.
- PostToolUse `tool_response` for Agent has `status` `completed` for foreground and `async_launched` for background, plus `agentId`. Same URL.
- statusLine fields: `https://code.claude.com/docs/en/statusline.md`.

### UNVERIFIED (keep until a Phase 0 spike settles each item)

A live `claude` run in a temp HOME is the verification method. None of these are read-code facts.

- UNVERIFIED: whether SubagentStop fires on a quota error.
- UNVERIFIED: whether SubagentStop fires on a user interrupt.
- UNVERIFIED: whether a resumed subagent fires SubagentStop again at the end of the resume.
- UNVERIFIED: whether a parked subagent (completed, waiting for SendMessage) has already fired SubagentStop when it parked.
- UNVERIFIED: `run_in_background` as an Agent `tool_input` field.
- UNVERIFIED: the PreToolUse matcher alias from `Task` to `Agent` (the repo registers `Task|Agent` at `hooks/hooks.json:129`; whether the harness still delivers an Agent call to a `Task`-only matcher is the unverified part).
- UNVERIFIED: whether `background_tasks` in a Stop or SubagentStop payload lists sibling subagents still running (it is documented as parent-session scoped; whether that scope includes siblings is the unverified part).

What changes if a spike goes the other way is in Options, under the recommendation, and again as the Phase 0 acceptance.

## Options and trade-offs

### A. Do nothing in code

Document rule 4 only: guidance in the dev-flow and level skills and in `AGENTS.md`. Cost is a doc edit. A passive checklist gets skipped. `CLAUDE.md` treats a guidance change as something that needs eval evidence before it counts as holding a behaviour (mechanism versus guidance). This option does not buy a mechanism, and it does not satisfy that rule by itself. It remains available if Phase 0 shows the stamp cannot be made honest enough even for one advisory line.

### B. Advisory only (recommended)

Extend `hooks/subagent-budget.js` so that on PreToolUse of Agent it reads the stamp dir (signal 1, through the same reader as `workflow-snapshot.js` `srcRoster`, shared rather than copied) and emits `additionalContext` saying `N subagents appear running (stale cutoff X); the rule is at most 3 concurrent` when N reaches the knob. It never denies. An optional note when the dispatched model is not a cheap alias, or when no low effort is evident from the brief, ships only if the PreToolUse input fields allow it. Otherwise that note is out of scope (the documented Agent fields are `prompt`, `description`, `subagent_type`, `model`; effort is not in that table).

Knob: `subagent_budget.concurrent_advise_max`, default 3, `0` disables. Env: `AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX`. Register it in `scripts/lib/config-keys.json`. The hook never blocks on this count, so a false positive costs one extra line of context.

### C. Hard deny at the ceiling

Same stamp reader, deny when N reaches the ceiling, with the existing `Budget-Ack` override. Rejected as the default. Signal 1 has known false positives (parked, crashed, missing Stop) and false negatives (a resume that keeps the old `ended_at`, `RESULTS.md:56`). A deny on a wrong count would block legitimate work. Keep C as a possible later opt-in mode only after the Phase 0 spikes measure the false-positive rate. This plan does not specify that mode's config key.

### Recommendation

Recommend B. Default advisory, threshold 3. Prerequisite: Phase 0 spikes that settle each UNVERIFIED hook fact by actually running `claude` (headless, temp HOME, never the real `~/.autopilot`) and recording evidence under `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/`. The recommendation depends on SubagentStart firing on resume, because `startAgentActivity` is the only writer that clears `ended_at` (`hooks/live-session-lib.js:185-187`).

If the resume spike shows SubagentStart does not fire on resume, B must additionally treat an agent whose transcript file was written after its `ended_at` as running. That fallback gets its own test (a stamp with `ended_at` set, and a transcript mtime newer than that timestamp, counts as running). Transcript mtime is not the general liveness signal. It is only this fallback, and only for the resume miss. Using transcript mtime alone for every agent stays out of scope.

Other spike outcomes, and what B does:

- If SubagentStop does not fire on quota error, a quota-hit stamp ages out through `AGENT_STALE_MS` (the negative control). B does not add a quota parser.
- If SubagentStop does not fire on user interrupt, the stamp looks running until stale. Advisory cost is one line. No deny is added.
- If a resumed subagent does not fire SubagentStop again at the end of the resume, the stamp stays without `ended_at` until stale or until some other end. B still only advises.
- If a parked subagent has already fired SubagentStop, `ended_at` is set and it does not count (the parked negative control). If it has not fired, the parked agent counts until stale. That false positive is why C stays rejected.
- If `run_in_background` is absent from Agent `tool_input`, the background-versus-foreground note stays out of scope.
- If a `Task`-only matcher does not see `Agent`, P2 keeps the existing `Task|Agent` matcher and records the spike. No second hook is added unless the spike shows the current matcher misses one of the two names.
- If `background_tasks` does not list sibling subagents, B does not switch to that payload. The stamp reader remains the source. If it does list them, that is recorded as a candidate for a later plan. This plan does not add a second reader.

## 2. OKR / KRs

- KR1. With `concurrent_advise_max` at its default (3) and N stamps running at or above 3, the Agent PreToolUse hook output contains one advisory line and no deny (`permissionDecision` is absent, or is not `deny`).
- KR2. With the knob at 0, the hook stdout is byte-identical to today's hook on the same fixture.
- KR3. Every scenario in the Negative-control section has its own named test and its own mutant. Each named test is red under its own mutant and green under the correct implementation. The oracle command is `hooks/tests/subagent-budget-mutants.test.sh` (P2 ships it; it does not exist yet). For each mapping row it enables that row's mutant through a test-only env switch, requires the named test to FAIL with that test's own assertion marker in the output, then runs the same test against the correct implementation and requires PASS. The script exits nonzero if any test passes under its mutant, or fails for an unrelated reason (a thrown execution error, a missing fixture, or a non-assertion exit). The red run is recorded before the green run.
- KR4. The UNVERIFIED list is empty, or each remaining item is documented as an accepted risk with the fallback that item requires (the resume fallback is the one this plan already names).

## Knobs and defaults

- New knob: `subagent_budget.concurrent_advise_max`. Default: `3`. Env override: `AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX`. Value `0` disables the advisory.
- Filesystem budget per Agent call, initial values to tune in P0 and P2: 200 operations and a 50 ms wall-clock cap. The operation count covers directory enumeration (`readdir`), per-entry metadata (`stat`), and JSON reads together. When the budget is exhausted mid-scan the reader stops, returns the count so far with `partial=true`, the advisory says `at least N appear running (scan truncated)`, the hook still never denies, and it fails open.
- Off means byte-identical hook output to today: no extra `additionalContext` line from this feature, and no other stdout change. `AUTOPILOT_AGENT_ACTIVITY=off` is the same for this feature, because there are no stamps to read; the hook then emits no concurrency line.
- Mode stays advisory. `remind` continues to deny on the existing dispatch and turn ceilings. This knob adds no new deny path.
- The existing ceilings (`lane_dispatch_max` 4, `lane_turns_max` 300, `root_turns_per_hour_max` 400) and `Budget-Ack` stay as they are.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- Docs and mechanism only where a phase says so. P0 writes evidence notes. P1 extracts a shared stamp reader. P2 adds the advisory knob and tests. P3 is wiring docs. No phase edits skill text, `AGENTS.md`, or `CLAUDE.md`.
- Version stays at the current number. No version bump. CHANGELOG is allowed only in P3, and only for the advisory behaviour that P2 shipped.
- The concurrency path never returns `permissionDecision` `deny`. The existing dispatch and turn denies in `hooks/subagent-budget.js` stay. This plan does not change their ceilings.
- Default advisory threshold is 3. Knob `subagent_budget.concurrent_advise_max`. Env `AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX`. Value 0 produces byte-identical stdout to the hook without this feature.
- Stale cutoff stays `AGENT_STALE_MS` (30 minutes), the constant in `scripts/lib/workflow-snapshot.js`. Do not invent a second cutoff.
- Reader is shared with `srcRoster`, not copied. Snapshot output for the newest-40 line stays byte-compatible unless a test says otherwise.
- The advisory count must include a running stamp outside the newest 40. The snapshot's display cap may remain 40.
- Read cost is bounded per Agent call. Initial values, tuned in P0 and P2: 200 filesystem operations (`readdir`, `stat`, and JSON reads together) and a 50 ms wall-clock cap. Exhausting the budget mid-scan stops the reader, returns the count so far with `partial=true`, and the advisory says `at least N appear running (scan truncated)`. The hook never denies and fails open. It does not scan without that cap.
- Fail open. An unreadable stamp dir, a thrown reader, or `AUTOPILOT_AGENT_ACTIVITY=off` adds no stdout and exits 0.
- Every new check ships with a negative control shown red before green.
- Phase 0 runs `claude` only under a temp HOME. It never reads or writes the operator's real `~/.autopilot`. It does not set `AUTOPILOT_SESSION_ID` or `CLAUDE_CODE_SESSION_ID`. It does not run `scripts/dispatch-hetero.sh`, `dispatch-author.sh`, or `engine-capability-state.js` unless `ENGINE_CAPABILITY_DIR` is a fresh temp directory and `AUTOPILOT_STRIKE_WRITER=off`.
- ADR-0001 stands. No hash chain, signature, witness, or attestation. A stamp is a local file, not a trust root.
- Transcript mtime is not a liveness signal, except the single resume fallback named in Options if Phase 0 shows SubagentStart does not fire on resume.
- Evidence files for P0 land only under `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/`.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only`. Consumers are the PreToolUse hook stdout and the operator config key. Default 3 adds one `additionalContext` line when the stamp count is at or above 3. Knob 0 matches today's stdout. No published API, no schema break, no removal.
- **Dependency decision**: `existing`. The stamp writer (`hooks/live-session-lib.js`) and `srcRoster` (`scripts/lib/workflow-snapshot.js`) already exist. A new package does not help: the signal is a local JSON file. Platform APIs do not expose this file. `agent.list()` exists only inside the mod runtime (`mods/live/register.ts:472`) and is not callable from the hook.

## 3. File-structure map

- `hooks/subagent-budget.js` — on PreToolUse, after the existing ceiling logic, call the shared reader and maybe append one advisory line. No new deny.
- `scripts/lib/workflow-snapshot.js` — `srcRoster` calls the extracted reader so the running rule lives in one function. Snapshot text stays the parity pin.
- `platforms/codex/plugin/scripts/lib/workflow-snapshot.js` — mirror of that extraction if the file still copies the function. P3 runs the sync check.
- `scripts/lib/config-keys.json` — one key `subagent_budget.concurrent_advise_max` and one env `AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX`.
- `hooks/tests/subagent-budget.test.sh` — advisory line, knob 0 byte match, and the green half of the negative controls.
- `hooks/tests/subagent-budget-mutants.test.sh` — planned, created in P2, not in the tree yet. One command: each named test red under its own mutant, then green.
- `scripts/lib/workflow-snapshot.test.js` — parity: the extracted reader matches the old function on the existing fixtures, including the newest-40 print line.
- `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/` — P0 spike notes. One file per UNVERIFIED item.
- `CHANGELOG.md` and the scripts inventory — P3 only, and only if a phase added a user-visible behaviour or a new script. No new script is required if the reader stays inside `scripts/lib/workflow-snapshot.js`.
- This plan does not edit skills, `AGENTS.md`, or `CLAUDE.md`.

## 4. Phases

Phases are independently shippable. P2 depends on P0 and P1. P3 depends on P2.

### P0 — spikes (dev-flow size S)

Settle each UNVERIFIED item by a live `claude` run in a temp HOME. Record the command, the hook stdin or the captured hook stdout, and the stamp file before and after, under `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/`. One note per item.

Acceptance: each UNVERIFIED bullet is either moved to a dated evidence note with a pasted run, or left on the list as an accepted risk that names the fallback. The resume note states whether SubagentStart fired. If it did not, the note quotes the fallback (transcript mtime after `ended_at` counts as running) and P2 must implement that fallback.

Negative control for the spike notes: a claim with no pasted output is not marked settled.

### P1 — shared stamp reader (dev-flow size S)

Extract the running rule from `srcRoster` (`scripts/lib/workflow-snapshot.js:257-278`) into a function both the snapshot and the hook call. Inputs: stamp directory, `now`, stale milliseconds, and the filesystem budget below. Running: no `ended_at`, and `last_tool_at` within the stale window, with an unparseable `last_tool_at` counting as running (same as line 270 today).

`srcRoster` today lists the whole directory, stats every file, and sorts before its 40-file cap, so a large stamp dir (the u5 spike saw 4633 files) is an unbounded `readdir` plus one `stat` per file. The new reader must not do that. Approach settled in P1, with a parity test against `srcRoster` on small directories (same running set when every file fits in the budget): read the directory in bounded chunks in directory order. That order is a cheap key and does not require `stat`. Ordering by mtime would stat every entry first, which is the behaviour this bound rejects. A per-session index was not chosen: it needs a new writer contract and can drift from the stamps, while chunked reads stay identical to `srcRoster` whenever the directory is small enough to finish.

Budget, initial values to tune in P0 and P2: 200 filesystem operations per Agent call, counting `readdir`, `stat`, and JSON reads together, plus a 50 ms wall-clock cap. When either cap trips mid-scan the reader stops, returns the count so far with `partial=true`, and the advisory text is `at least N appear running (scan truncated)`. The hook never denies and fails open. If the one qualifying running stamp lies outside the inspected subset, the advisory is still that partial lower bound, never a false deny.

The snapshot call keeps `ROSTER_READ_CAP` 40 so its printed line stays the same (`N recorded, M running` with M from the newest 40). The advisory call must not use that cap as the running filter. On a directory that fits in the budget it includes a running stamp older than the newest 40. The 40-file cap and the 200-operation budget are different limits.

Acceptance: `node --test scripts/lib/workflow-snapshot.test.js` passes, including a parity assertion that the extracted function and the previous behaviour agree on the existing fixtures when the directory is small. The "more than 40" fixture (`older_running_stamp_included`) counts the older running stamp on the advisory call. `oversized_dir_op_budget` builds about 5000 stamp files, wraps `fs.readdirSync`, `fs.statSync`, and `fs.readFileSync` (or the equivalents the reader calls), and fails if total operations exceed 200, including when the one qualifying running stamp is outside the inspected subset (expect `partial=true` and a lower bound, no deny).

### P2 — advisory in the hook (dev-flow size M)

Depends on P0 and P1. Wire the knob, the env, `scripts/lib/config-keys.json`, and `hooks/subagent-budget.js`. When the advisory count is at or above the knob and the knob is not 0, append one `additionalContext` line and do not deny. Apply the resume fallback only if P0 required it.

Acceptance: KR1 and KR2 pass via `hooks/tests/subagent-budget.test.sh`. KR3 passes via `hooks/tests/subagent-budget-mutants.test.sh` (planned; P2 creates it). Per scenario the red output must contain that test's assertion, and the green run must PASS. Expected failing assertion under the mutant: `parked_ended_not_running` (ended agent counted as running); `resume_restart_counts_running` (restart that cleared `ended_at` not counted); `crash_stale_not_running` (stale agent counted); `quota_silent_ages_out` (silent stamp still counted after `AGENT_STALE_MS`); `unparseable_fail_open` (reader threw, or the hook did not exit 0 with no deny); `compaction_no_double_count` (two rows for one `agent_id`); `knob_zero_silent` (advisory appended when `concurrent_advise_max` is 0); `activity_off_silent` (advisory appended when `AUTOPILOT_AGENT_ACTIVITY=off`); `older_running_stamp_included` (older running stamp omitted); `oversized_dir_op_budget` (operations over the 200 budget). A pass under the mutant, or a failure whose output lacks that scenario's assertion marker, fails the command.

### P3 — wiring (dev-flow size XS)

If P1 or P2 added a script, add the scripts-inventory row. CHANGELOG entry for the advisory line and the knob. Codex mirror if `workflow-snapshot.js` changed, then `bash scripts/sync-codex-plugin-skills.sh --check`. No version bump.

Acceptance: the sync check exits 0, and `node scripts/check-config-docs.js` exits 0.

## 5. Test / validation

Script-gated. No human judgement for KR1-KR3.

- `node --test scripts/lib/workflow-snapshot.test.js` after P1.
- `hooks/tests/subagent-budget.test.sh` after P2, with the fixtures in the negative-control section.
- `hooks/tests/subagent-budget-mutants.test.sh` after P2 (planned file). Each row red under its mutant, then green.
- P0 is evidence notes, not a unit test. A note without a pasted command output does not close its UNVERIFIED item.
- Commands that prove the KRs, once P2 exists: the budget test script's advisory cases. The assertion is a string match for the one advisory line and a check that stdout has no `permissionDecision` of `deny` from this feature. Knob 0 is a byte compare against the fixture captured from the pre-change hook.

## Negative-control test design

Every scenario has its own named test and its own mutant. Each named test is red under its own mutant and green under the correct implementation.

The one command is `hooks/tests/subagent-budget-mutants.test.sh` (P2 ships it; the file is planned and does not exist yet). For each row it runs the named test with that row's mutant enabled through a test-only env switch and requires FAIL, and the failure output must contain that test's assertion marker. It then runs the same test against the correct implementation and requires PASS. It exits nonzero if any test passes under its mutant (unexpected pass) or fails for an unrelated reason (a thrown execution error, a missing fixture, or a non-assertion exit).

| scenario | named test | mutant | assertion marker the mutant must trip |
|---|---|---|---|
| parked agent with `ended_at` set does not count | `parked_ended_not_running` | reader counts agents that have `ended_at` as running | `ASSERT parked_ended_not_running` |
| resume: a stamp rewritten by SubagentStart (`ended_at` cleared) counts | `resume_restart_counts_running` | reader ignores a restart that cleared `ended_at` (keeps treating the agent as ended) | `ASSERT resume_restart_counts_running` |
| stale crash: no `ended_at` but `last_tool_at` older than `AGENT_STALE_MS` does not count | `crash_stale_not_running` | reader ignores `AGENT_STALE_MS` | `ASSERT crash_stale_not_running` |
| quota age-out: a stamp that stops updating ages out (distinct fixture from the crash row; same mutant family) | `quota_silent_ages_out` | reader ignores `AGENT_STALE_MS` (distinct test; must also be red under that mutant) | `ASSERT quota_silent_ages_out` |
| unparseable stamp: hook exits 0 with no deny | `unparseable_fail_open` | reader throws on unparseable JSON | `ASSERT unparseable_fail_open` |
| compaction: two reads of the same stamp dir, and a duplicate stamp for one `agent_id`, yield one row per `agent_id` | `compaction_no_double_count` | reader emits two rows for one `agent_id` | `ASSERT compaction_no_double_count` |
| knob 0: output byte-identical to today | `knob_zero_silent` | hook still appends the advisory when `concurrent_advise_max` is 0 | `ASSERT knob_zero_silent` |
| `AUTOPILOT_AGENT_ACTIVITY=off`: output byte-identical to today | `activity_off_silent` | advisory still appended when that kill switch is off | `ASSERT activity_off_silent` |
| more than the cap: 40 newer ended stamps plus one older running stamp are included | `older_running_stamp_included` | reader keeps only the newest 40 files | `ASSERT older_running_stamp_included` |
| oversized directory (about 5000 stamp files) stays inside the op budget; if the one qualifying running stamp is outside the inspected subset the advisory is `partial=true` with a lower bound (`at least N appear running (scan truncated)`), never a false deny | `oversized_dir_op_budget` | reader enumerates and stats every file | `ASSERT oversized_dir_op_budget` |

Resume fallback, only if P0 required it, stays inside `resume_restart_counts_running`: a stamp that still has `ended_at` whose transcript mtime is newer than `ended_at` counts, and an older transcript does not. The snapshot's newest-40 print line may still omit the older running stamp (parity with today's quirk). The advisory count on a directory that fits in the budget must include it. The instrumented count for `oversized_dir_op_budget` wraps `fs.readdirSync`, `fs.statSync`, and `fs.readFileSync` (or the equivalents the reader calls) and fails if the total exceeds 200.

## 6. Risks + inversion

What guarantees failure:

- The reader trusts parked agents (no `ended_at`, fresh `last_tool_at` or a missing Stop). Mitigation: advisory only, so the failure mode is one extra context line, not a blocked dispatch. C stays rejected until a measured false-positive rate exists. The parked negative control locks the `ended_at` case.
- A resume keeps the old `ended_at` (`RESULTS.md:56` and line 63). Mitigation: P0 measures SubagentStart on resume before P2 ships. If it does not fire, the transcript-mtime fallback is mandatory and tested. Without that fallback, B under-counts resumed work and the advisory never fires when it should.
- Hook latency on a large stamp dir. The u5 spike saw 4633 stamp files in one session (`u5-spike.md:45`). Mitigation: a hard budget of filesystem operations per Agent call covering `readdir`, `stat`, and JSON reads together (initial value 200) and a wall-clock cap (initial value 50 ms), both tuned in P0 and P2. Hitting the budget stops the scan, returns the count so far with `partial=true`, and the advisory says `at least N appear running (scan truncated)`. The hook still never denies and fails open. The newest-40 quirk is not this budget: that quirk hides a running agent, which `older_running_stamp_included` forbids when the directory fits in the budget. `oversized_dir_op_budget` is red under a reader that enumerates and stats every file.
- Inversion check: if someone wires option C on top of this reader before the spikes, a parked or crashed stamp denies real work. This plan's global constraint forbids that deny. A review that finds a `permissionDecision` `deny` on the concurrency path is a failed plan implementation.

## 7. Out of scope

- Any deny or block on the concurrency count.
- Changing the existing dispatch or turn ceilings, or the `Budget-Ack` contract.
- Guidance text edits to skills, `AGENTS.md`, or `CLAUDE.md` (those need eval evidence).
- Model or effort enforcement beyond what PreToolUse input fields expose.
- A new liveness daemon.
- Trust or attestation machinery (ADR-0001).
- Using transcript mtime as a general liveness signal (the resume fallback is the only exception, and only if P0 requires it).
- Cross-harness equivalents for Codex or agy.
- Option C's opt-in deny mode. It is named so a later plan can pick it up. It is not designed here.

## 8. Open questions

Only the owner can answer these.

- Is 3 the right threshold for resident seats, or should the default be a different integer?
- Is a later opt-in deny mode wanted at all, after the false-positive rate is measured?

## Review log

- R0 (2026-10-21): author draft, inventory and design only, nothing implemented. Depth-0 will assign `logical_plan_id` and write the plan-review-manifest beside this plan. No manifest path exists yet. No reviewer verdict exists yet.
- G1 (generation 1): verdict CONDITIONAL (two reviewers STOP, one READY; three blockers and one non-blocking finding, all accepted by depth-0).
- fa599f72: accepted. Fixed in the Negative-control section, KR3, and P2 acceptance (one oracle: every scenario, own named test, own mutant).
- 95cac1db: accepted. Fixed in the Negative-control section, KR3, and P2 acceptance (same every-scenario oracle; shared "fail some of them" wording is gone).
- 27e2ebf2: accepted. Fixed in P1, the knobs section, and the Negative-control table (`oversized_dir_op_budget`; bound covers readdir, stat, and JSON reads).
- 691616ba: accepted. Fixed in the Signal inventory rows for mods `agent.list` and `subagentStatusLine` tasks (parked, resume, quota, compaction).

## Review rubric

- R1: [inventory complete and honest] Every candidate signal named in the Problem and Inventory (stamp files, srcRoster, mods agent.list, subagent-budget, statusline, agent-liveness-check, watch-foreman, dispatch-status, foreman-guard, hooks.json events, official hook docs) has a row with file and line, running rule, false-positive and false-negative cases (parked, resume, quota, compaction) and a verification method, and nothing is presented as verified that is only read from code.
- R2: [unverified facts quarantined] Every Claude Code hook fact either carries an official URL or is on the UNVERIFIED list with a spike in Phase 0, and the recommendation states what changes if each spike goes the other way.
- R3: [options fair] The do-nothing option and a hard-deny option are described with real costs, and the recommendation follows from the inventory's false-positive evidence rather than preference.
- R4: [default safe and bounded] The default is advisory, never blocks, off switch produces byte-identical output, and the read cost on large stamp directories is bounded.
- R5: [negative controls decidable] Each misjudgement scenario has a test that is shown red against a deliberately broken reader before green, and the acceptance conditions can be checked by a command rather than by judgement.
