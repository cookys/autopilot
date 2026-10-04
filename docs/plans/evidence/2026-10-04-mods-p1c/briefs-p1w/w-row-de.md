Engine: sonnet

# Row W1de — task-list writer (W1d) + awaiting-the-owner writer (W1e). Worktree wt-w1de, base develop 39cc491c. Read w-common.md first.

Spike facts (S10/S11, Claude Code 2.1.289, interactive tmux; depth-0 re-checked the raw log). Report + raw logs:
/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1c/s10/REPORT.md and logs/events.jsonl — read both; build test fixtures from the REAL payload lines there.
- Permission prompt and AskUserQuestion: `PermissionRequest` (tool_name distinguishes them) at t=0, then `Notification` type `permission_prompt` +6 s. End: `PostToolUse` of that tool on approve/answer. Deny: no end event — only the next `UserPromptSubmit`.
- Idle: `Stop` at turn end, then `Notification` type `idle_prompt` 60 s later. End: next `UserPromptSubmit`.
- Tasks: `TaskCreated` {task_id, task_subject}; `TaskCompleted` on completion; in_progress only visible in `PostToolUse` with tool TaskUpdate (`statusChange.to`). No TaskUpdated event.
- Task tools are gated: for sonnet/opus they need `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (repo pins it in .claude/settings.json; other projects may not). Out of scope to fix here; document it.

## W1d — `<live>/tasks/<sid>.json`
A classic hook (Node, default-on, opt-out knob, multiplexed per the repo's existing pattern) on TaskCreated, TaskCompleted and PostToolUse(TaskUpdate|TaskCreate|TaskList if useful) maintains, per session id, an atomic JSON file under the live base (`scripts/lib/live-state-dir.js` resolveLiveDir; never the real dir in tests):
`{schema:"autopilot.session-tasks/1", session_id, cwd, project_key|null, updated_at, first_created_at, tasks:[{id, subject, status: pending|in_progress|completed|deleted}], counts:{total, completed, in_progress}, current:{id, subject}|null}`.
current = the most recently started in_progress task. Idempotent on replays; tolerate events out of order; never throw (fail-open, one stderr line). Fast (no git calls beyond what project-key needs; reuse `src/status/project-key.js`).

## W1e — `<live>/attention/<sid>.json`
Hook(s) on PermissionRequest, Notification (permission_prompt, idle_prompt), Stop, PostToolUse, UserPromptSubmit maintaining:
`{schema:"autopilot.attention/1", session_id, project_key|null, kind: "permission"|"question"|"idle", tool_name|null, summary, since, updated_at}` — present while waiting, REMOVED (or `kind:null`) when the matching end signal fires: PostToolUse of the same tool ends permission/question; UserPromptSubmit ends everything. Idle starts at `idle_prompt` (not at Stop). permission vs question: AskUserQuestion → question (summary = the question text if the payload has it), else permission (summary = tool + short command/path, truncated, no secrets: run the summary through the repo's secret redaction if one exists, else only tool_name). Deny leaves the file until the next prompt: include `since` so readers can show age.

## Both
Add hooks to hooks.json + hook-classes + hook inventory, documented in hooks/README.md with the knobs. W1c (SessionStart watcher autostart) is being built in parallel and also edits hooks.json/hook-classes: keep your edits additive and minimal so the landing merge is mechanical; do not touch SessionStart entries. Tests: replay the real payload sequences from the spike log for cases A (approve, deny), B, C, D and assert the files after each step; out-of-order and duplicate events; knob off → no files; the hook never exits non-zero. Mutation controls per guarded rule (end signal, question vs permission, idle start at idle_prompt not Stop, current task choice, counts).
ONE commit: `feat(hooks): live task list and awaiting-owner state per session (mods P1W W1d W1e)`. Report at $P/run-w/w1de/REPORT.md with the exact file shapes (W3a, the mod, consumes them).
