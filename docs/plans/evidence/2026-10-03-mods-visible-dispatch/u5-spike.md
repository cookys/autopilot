# U5 spike — what the live pane shows about "what is running now" (2026-10-15)

Question (mods-visible-dispatch §P6, U5): the pane cannot show what is running now (background work, sub-steps, progress); BACKLOG "Workflow snapshot" P2 (subagent roster) overlaps. Investigate sources first, then size.
Method: read the code on base `6fdcf5ac`, and opened the real files on this host (`/run/user/1000/autopilot`, `/tmp/autopilot-dispatch-runs`, `~/.claude/tasks`). No product code touched. Facts marked **[V]** were observed on disk; **[U]** are unverified and listed in §6.

## 0. Finding in one paragraph

U5 as worded is already about half delivered. The 現況 tab has a 背景工作 section (shells, monitors, running subagents, each with the last output line and quiet time) and a 任務 section (session task list); the 派工 tab has run rows and a foreman liveness block. What is genuinely missing is narrow: (a) a running subagent's **current step** (it shows only description and type), (b) a task's **activeForm** (the "doing X now" text Claude Code keeps), (c) a dispatch run's **stage/sub-step**, (d) **lineage** (which work started which), which is the dispatch-tree plan's job and is blocked by it. Every source for (a)-(c) already exists on disk and is readable from the mod; nothing needs a new producer except one additive field. Recommended split: 3 small deliverables (XS probe, S, S), 1 conditional M, 1 deliverable owned by another plan (L, blocked), plus owner decisions.

## 1. What the pane shows today, and from where

Source of truth for reads: `mods/live/register.ts` header (lines 7-30) and `refresh()`. The mod reads files through `$.fs` (no process spawn) and in-process APIs `$.session.messages()`, `$.agent.list()`.

| Pane location | Shows | Read from | Schema / shape |
|---|---|---|---|
| Band + 現況 位置 (progress, phase, stage, unit) | verdict, elapsed, progress `done/total`, phase | scope envelope `<live>/runs/<project_key>[--<root>].json`; job page `~/.autopilot/review/<key>/<date>/<job>/current/model.json` (progress, phase); session marker `~/.autopilot/session-mode/<sid>.json`; stage walk `<live>/stage/<sid>.json` | `autopilot.runs-live/1`; `review-job-model/1`; marker; stage walk |
| 現況 背景工作 (`backgroundPart`, tabs.ts:258) | shells and monitors: label, last output line, quiet age; running subagents: description + type | shells/monitors: scanned from `$.session.messages()` (`scanBackground`, model.ts:1727) plus the shell's `<id>.output` file (mtime, last line; `register.ts readActivity`); agents: `$.agent.list()` rows with status pending/running/waiting | in-process; output file is plain text |
| 現況 任務 (`tasksPart`) | session task subjects and status, counts | `<live>/tasks/<sid>.json` | `autopilot.session-tasks/1` (written by `hooks/session-tasks.js`) |
| 現況 要你處理 | permission / question / idle wait | `<live>/attention/<sid>.json` | attention file (W1e) |
| Band / header turn state | working vs ended | `<live>/turn/<sid>.json`, `turn-effective/<sid>.json` | `autopilot.session-turn/1` |
| 派工 執行中 / 已完成 | per run: id, role, engine/model, elapsed, last-seen age, state | envelope `runs[]` (`probe_age_s`, `alive`, `stall`, `rc`, `final_status`) | `autopilot.runs-live/1` |
| 派工 foreman block (`foremanLines`) | foreman subagents: description, label, age, quiet flag, stage + age | `<live>/runs/<scope_key>.foreman.json` | `autopilot.foreman-activity/1` (watcher-written from three sources, §2) |
| 審查 / 用量 / 殘留 | review rounds, QC, decisions, spend, residue | `.review.json`, `.qc.json`, `.decisions.json`, `spend-history.json`, `.residue.json` | other sidecars |

Not shown anywhere (read from `tabs.ts` and `model.ts`): a subagent's last tool or token count; a task's `activeForm`; a run's `stage` / `scope_unit` / log tail; any parent/child relation between runs, subagents and child Claude sessions.

## 2. Sources by the three kinds of information

Columns: path, writer, update rate, session binding, readable from the pane. "Pane" = the mod process via `$.fs` / `$.session` / `$.agent`.

### 2.1 Background work

| Source | Path | Writer | Rate | Session binding | Pane-readable |
|---|---|---|---|---|---|
| Session transcript tool uses + `<task-notification>` | in-process `$.session.messages()` | Claude Code | per turn | this session only (inherent) | yes (already used). Known gap noted in model.ts:1699: a task that ends mid-turn keeps its row until the turn ends |
| Background shell output | the `...<id>.output` path named in the Bash result | Claude Code | live, streaming | via the transcript that names it | yes (already used; size-capped read, mtime gives quiet age) |
| `$.agent.list()` | in-process | Claude Code | live | this session; includes `parent` per the research note (`docs/plans/research/2026-10-03-claude-code-mods-integration.md:28`) | yes (already used for status + description + type). **[U]** the row's `id` equals hook `agent_id` |
| Subagent liveness stamps | `<live>/agents/<sid>/<agent_id>.json` | `hooks/live-session-lib.js` (SubagentStart, PostToolUse with `agent_id`, SubagentStop, TaskStop) | per tool call | by `<sid>` directory | yes (path under the live base, which the mod already reads) |
| Subagent status-line rows | `<live>/context/<sid>.tasks.json` | codeforge `subagent-statusline` (opt-in; `~/.claude/settings.json` has it on this host) | about 1 s while an agent exists | by `<sid>` in the file name | yes, same directory the mod already reads for `context/<sid>.json` |
| Dispatch-run manifests | `${TMPDIR}/autopilot-dispatch-runs/*.manifest.json` | the dispatch rails | at start/end | `session_id` field (launching `CLAUDE_CODE_SESSION_ID`, null when unset), `root_run_id`, `child_session_id` | not directly: they live in `/tmp`, outside the live base; the mod gets them through the watcher's envelope (below) |
| Scope envelope | `<live>/runs/<project_key>[--root].json` | the per-project watcher (`src/status/runs-watch.js`), flock-held | 60 s heartbeat, immediately on change | project scope, not session; `sessions{}` holds per-session cost only | yes (already used) |
| Foreman sidecar | `<live>/runs/<scope_key>.foreman.json` | watcher (`src/status/foreman-activity.js`) | same tick | session-bound (`binding: "session"`): two jobs in one session both see the same rows | yes (already used) |

Observed [V]:
- `<live>/agents/<this sid>/` holds **4633** stamp files, **4627 ended**; **4362 have `agent_type: null`** (created by SubagentStop with no start). The directory is not reaped while the session lives (only `removeAgentActivity` at session end). `scripts/lib/workflow-snapshot.js` already guards this with `ROSTER_READ_CAP = 40` (newest 40 by mtime). Any pane reader of this directory needs the same cap and must filter `ended_at`.
- `<live>/context/8c4bae60-....tasks.json` (the most recently written one) has one row per agent: `id` (equals the stamp's `agent_id` per `hooks/README.md:327`), `description`, **`label` (the agent's current step text, e.g. "Validating suspects.json crop paths")**, `status`, `startTime`, `tokenCount`, `model`, `type`. This is the richest "what is it doing now" source on disk. It exists only when codeforge's `subagentStatusLine` is installed; `foreman-activity.js` already treats it as optional and so must the pane.
- The scope envelope `/run/user/1000/autopilot/runs/9dc556b726c078d9.json` on this host has `published_at 2026-10-14T18:38Z` (about 8 h old when read) with `valid_for_s: 180`: the watcher had stopped. The pane's freshness handling already treats this as stale; any new reader of watcher output inherits that. The envelope's `runs[]` rows carry **no `stage`**: keys are run_id, role, runner, model, started/ended, parent_run_id, root_run_id, depth, manifest, elapsed_s, rc, final_status, project, stall, alive, source, fact_at, observed_at, probe_age_s.
- A manifest's keys include `stage`, `scope_unit`, `ledger`, `log_path`, `session_id`, `child_session_id`, `parent_run_id`, `root_run_id`, `depth`.

### 2.2 Sub-steps

| Source | Path | Writer | Rate | Session binding | Pane-readable |
|---|---|---|---|---|---|
| Subagent current step | `context/<sid>.tasks.json` row `label` (above) | codeforge, opt-in | about 1 s | per sid | yes; absent without codeforge |
| Subagent last tool | stamp `last_tool_name`, `last_tool_at` | autopilot hooks, default-on (knob `AUTOPILOT_AGENT_ACTIVITY=off`) | per tool call | per sid | yes; tool name and age only, never a stage (by design, `live-session-lib.js:107`) |
| Native task list with `activeForm` | `~/.claude/tasks/<sid>/<n>.json` `{id, subject, description, activeForm, status, blocks, blockedBy}` [V on `05ff716b...`] | Claude Code | on TaskCreate/Update | dir name = session id | readable by path, but it is a Claude Code internal store with no schema version (a format change silently breaks it). The hook copy (next row) drops `activeForm` |
| Session task copy | `<live>/tasks/<sid>.json` `autopilot.session-tasks/1`: per task only `id`, `subject`, `status`, `started_seq` [V] | `hooks/session-tasks.js` (TaskCreated/Completed, PostToolUse TaskCreate/Update/List) | per task event | `session_id` inside | yes (already used). Adding `activeForm` is an additive field |
| Dispatch run stage | manifest `stage`, `scope_unit`, `ledger`, `log_path` [V keys] | rails | at stage change (rail dependent) | `session_id` | not in the envelope row, so the mod cannot read it today |
| Dispatch run log tail | manifest `log_path` | the runner | live | via manifest | outside the live base (`/tmp`); needs the watcher to publish it |
| Stage walk | `<live>/stage/<sid>.json` | `stage-advance.js` / hooks | per stage move | per sid | yes (already used) |

### 2.3 Progress

| Source | Path | Writer | Rate | Binding | Pane-readable |
|---|---|---|---|---|---|
| Job progress `done/total/percent/frozen` | job page `current/model.json` `progress` | the review renderer | on render | per job (root) | yes (already used; shown on band and 位置) |
| Campaign progress receipts | `<git-common-dir>/autopilot/work-orders/<root>/*.json` | the campaign controller | per receipt | per root | yes (already used for campaign start time) |
| `progress.json` projection with heartbeat | planned (mods plan P4, `src/status/work-round.js`) | watcher | 120 s heartbeat | per scope | not shipped; `src/status/` has no `work-round.js` [V] |
| Shell progress | the shell's output file last line | the command itself | live | via transcript | yes (already shown as the row's detail) |
| Subagent token count | `context/<sid>.tasks.json` `tokenCount` | codeforge | about 1 s | per sid | yes, opt-in |

There is no per-subagent "percent done" anywhere; only job-level progress. Do not promise one.

## 3. Overlap with the other plans

### 3.1 `2026-10-13-workflow-snapshot-at-compaction.md` (P1-P2 and P4 landed, P3 deferred)

That plan's roster (`scripts/lib/workflow-snapshot.js` `srcRoster`) reads the same `<live>/agents/<sid>/*.json` stamps and renders text for a **compaction summary**, not a pane. Its P2 stopped short of the one field both could want: "a human-readable description of what the agent was asked, which lives in the `Agent` tool_input on PostToolUse, not on SubagentStart ... larger than S, stopped here" (§2.4). (The BACKLOG file has no row with the title "Workflow snapshot"; the plan names it as its source, so this spike used the plan itself.)

| Need | Snapshot plan | U5 |
|---|---|---|
| Read the stamp directory with a cap | done (cap 40) | same cap needed |
| Subagent description on the stamp | **not done** (touches hot PostToolUse host) | not needed in the pane: `$.agent.list()` and `tasks.json` already carry the description |
| Task card (`task-card.js`) | done (P2); `~/.autopilot/task-card/` does not exist on this host [V] because nothing calls it (dev-flow wiring is P3, deferred as guidance) | out of scope: it is an intent statement, not a running activity |
| Plan P3 (`/handoff` reads snapshot, dev-flow calls task-card) | deferred, eval-gated | unrelated; do not couple |
| Pane reading | forbidden ("Do not touch `mods/live/`", §2.5) | the whole point |

Conclusion: no blocking dependency either way. U5 does not need the snapshot plan's P3, and its unfinished roster-description item is made unnecessary for the pane by `$.agent.list()` and `context/<sid>.tasks.json`. The two share only the stamp-directory read discipline (cap, ended filter, null-type noise).

### 3.2 `2026-10-13-dispatch-tree.md` (frozen plan; only the read-only `scripts/dispatch-tree.js` shipped; producers 3a, 3b, 3c, 5 and renderer R not shipped)

Only one file matches `docs/plans/2026-10-13-dispatch-tree*.md`. It owns: the 派工 tab reading subagent records (its D1), the tree component, exact-edge lineage, `origin_agent_id`, child-session markers. Everything U5 would need about **who started what / nesting** is inside it, and it carries its own D0 live-measurement gate and re-open protocol. Its order is D0, 3a, 3b, 3c, 5, R: producer changes before the renderer.

| U5 item | Covered by dispatch-tree | U5-only |
|---|---|---|
| Subagents listed in the 派工 tab | yes (D1 / step R) | - |
| Nesting / parent of a run or agent | yes | - |
| "Cannot be traced" labels | yes | - |
| Running subagent shown in 現況 背景工作 with current step | no (its tree rows carry "identity and lifetime only", §4 end) | **yes** |
| Task `activeForm` | no | **yes** |
| Dispatch run stage / sub-step | no (it reads manifests for edges, not stage) | **yes** |
| Shell/monitor rows | no (already shipped) | already done |

Risk: if U5 adds subagent rows to the 派工 tab it duplicates dispatch-tree's D1. Keep U5 in 現況 and leave the 派工 tab and any parent/child display to the tree plan.

### 3.3 Other shipped coverage

`mods-visible-dispatch` W2c (foreman visibility) is shipped as `foreman.json` and its 派工 block. It is scope-bound (needs a watcher scope and a job); a plain interactive session with ad-hoc `Agent` calls has no foreman sidecar, which is exactly the case 現況 背景工作 covers.

## 4. Gaps, stated as testable claims

1. A running subagent row shows description and type only. Its current step (`label`), tool (`last_tool_name`) and token count are on disk and unread. Join key: `agent_id` (stamp file name, tasks.json `id`). **[U]** whether `$.agent.list()` rows expose an `id` of the same value.
2. A task row shows subject and status only; `activeForm` is dropped by the hook copy.
3. A dispatch run row shows no stage. The manifest has `stage` and `scope_unit`; the envelope row does not copy them, and `/tmp` is outside the live base, so a pane-side fix is impossible without a watcher change.
4. Lineage is invisible; owned by dispatch-tree.

## 5. Recommended split

| # | Deliverable | What | Size | Blocked by | Notes |
|---|---|---|---|---|---|
| U5e | Probes P1 and P2 | P1: in a real pane, log `$.agent.list()` row keys and compare `id` to a `<live>/agents/<sid>/` file name while one subagent runs. P2: run one `dispatch-author.sh` or `dispatch-hetero.sh` and sample `manifest.stage` every 10 s | XS | needs an interactive run (owner uses ssh + tmux) | do first; it sets U5a to S or M and U5c to M or dropped |
| U5a | Agent current step in 現況 背景工作 | Mod reads `<live>/context/<sid>.tasks.json` (optional) and the newest-40 stamps; for each live agent from `$.agent.list()` adds meta `label` / last tool + age / token count. Without codeforge, falls back to last tool + age; without either, today's row. Join strictly by id; an agent with no id match shows today's row, never a guessed one | S | **[U] P1** (id equality). If ids differ it becomes M: joining by description text is a guess and is not allowed, so a watcher-published join would be needed | mod only, no producer. Needs a negative control: a foreign-session file must read as absent (same sid-in-filename + `session_id` check the other readers use) |
| U5b | Task `activeForm` in 任務 | `hooks/session-tasks.js` copies `activeForm` (clipped, additive field in `autopilot.session-tasks/1`); mod shows it for the in-progress task | S | owner question Q2 (hook vs reading `~/.claude/tasks`) | touches a shipped default-on hook: PATCH-class under the versioning table, version held at 3.0.0 so no bump. Mechanism change, not guidance |
| U5c | Dispatch run stage in 派工 | Watcher copies manifest `stage` (and `scope_unit`) into the `runs[]` row; `runs-live/1` is `additionalProperties:false`, so this needs a schema bump or a sidecar; mod adds a column or detail line | M, conditional | schema decision (Q3); live-pane table width rules | only worth it if rails write `stage` during a run: **[U] P2** |
| U5d | Lineage / who started what in the pane | owned by `2026-10-13-dispatch-tree.md` (D0, then 3a, 3b, 3c, 5, R) | L (that plan's own scale, not re-sized here) | the tree plan's D0 gate and producers | U5 takes no action; replace this item of U5 with a pointer |

Order: U5e, then U5a and U5b in parallel (different files), U5c last and only if P2 shows mid-run stage movement. Excluding U5c and U5d the total is about XS + S + S.

What U5 should NOT do: add a per-subagent percentage (no source), read `/tmp/autopilot-dispatch-runs` from the mod (outside the live base, project-wide not session-bound), add subagent rows to 派工 (dispatch-tree D1), or touch the snapshot plan's collector.

## 6. Unverified, and why

- P1 (`$.agent.list()` id shape): cannot be observed from a shell; the list exists only inside Claude Code's mod runtime. `live.test.ts` fixtures show the shape the mod expects (`status`, `description`, `type`), not what the host sends.
- P2 (manifest `stage` cadence): the manifests on this host are finished runs; none was live during this spike.
- The watcher on this host is stopped, so no live envelope or foreman sidecar was seen updating. Their shapes are from files on disk and from `src/status/*.js`.
- Whether codeforge's `subagent-statusline` exists for other users: it is opt-in (`hooks/README.md:341`). The design must treat `tasks.json` as optional.

## 7. Questions for the owner (plain words)

1. **Is it enough that the pane shows each running subagent's current step and last tool, instead of a percent bar?** There is no data source for a per-subagent percent. Recommended: yes. If you want a bar, someone first has to define what "done" means per agent.
2. **For a task's "doing X now" text, may I change the existing task-list hook to keep it (small, shipped code), or should the pane read Claude Code's own task files directly (no hook change, but it breaks silently if Claude Code changes the format)?** Recommended: change the hook.
3. **If a dispatch run's stage should appear in the 派工 tab, are you willing to change the watcher's published file format?** The current format rejects extra fields. Alternative: a separate small file next to it. Recommended: wait for probe P2; if stages only change at the end, skip it.
4. **Should the pane use codeforge's subagent status line for the richest step text?** Recommended: use it when present, fall back to last tool + age when not, and show nothing extra otherwise.
5. **Is it OK to call U5 done after U5a and U5b, and move lineage into the dispatch-tree plan's schedule?** Recommended: yes; U5c only if P2 supports it.

**Owner ruling 2026-10-16** (decision d-75aeb796, answered 「全照建議」): Q1–Q5 are all accepted as recommended above.

## 8. Suggested status line for U5 in `mods-visible-dispatch.md`

`U5 | pane 看不出現在在跑什麼 | S+S (U5a agent 目前步驟、U5b task activeForm), M 條件式 (U5c run stage), 譜系歸 dispatch-tree | spike 完成，先跑 probe P1/P2 | evidence/2026-10-03-mods-visible-dispatch/u5-spike.md`
