# Spike S10/S11 — events when Claude Code waits on the human; Task-tool hooks

Version: `claude --version` = 2.1.289. Event list source: the installed binary's own hook-event array (`strings $(which claude)`,
33 names) — 32 registered via a scratch plugin (WorktreeCreate skipped: its stdout is a contract). Not from official docs URL (unknown whether identical).
Harness: isolated CLAUDE_CONFIG_DIR (only `.credentials.json` + minimal `.claude.json`), HOME/TMPDIR redirected, real tmux session, interactive (not `-p`),
model claude-haiku-4-5, permission mode "default" (shown as "manual mode"). Raw logs: `$SPK/logs/events.jsonl` (all 51 events), `marks.txt` (my keystroke times), probe outputs.
Every payload carries: session_id, transcript_path, cwd, hook_event_name, scratchpad_dir (+ prompt_id on most, permission_mode on tool events).
Events that fired in the whole run: SessionStart, ConfigChange, UserPromptSubmit, PreToolUse, PermissionRequest, Notification, PostToolUse, PostToolBatch,
MessageDisplay, Stop, TaskCreated, TaskCompleted, SessionEnd. Registered but NEVER fired (not exercised): PermissionDenied, PostToolUseFailure, StopFailure, Subagent*, Pre/PostCompact,
Pre/PostModelSwitch, Setup, TeammateIdle, Elicitation*, InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, WorktreeRemove, UserPromptExpansion.

## A. Permission prompt (Bash `touch`, outside allowlist), held 81 s, then approve; second time deny
| t (s rel. to PermissionRequest) | event | key fields |
|---|---|---|
| -0.1 | PreToolUse | tool_name=Bash, tool_input.command, tool_use_id |
| 0 | **PermissionRequest** | tool_name=Bash, tool_input{command,description}, permission_suggestions[...] (no tool_use_id) |
| +6.0 | **Notification** | notification_type=`permission_prompt`, message="Claude needs your permission" |
| +6..+84 | (nothing) | no repeat/heartbeat for 78 s |
| +84 (approve key sent) | **PostToolUse** (then PostToolBatch, MessageDisplay, Stop) | tool_response, duration_ms=161 |
Approve evidence: `1791128352.1 PermissionRequest ... 1791128358.1 Notification permission_prompt ... 1791128436.5 PostToolUse` (approve pressed 436).
**Deny** (second run, option 3, prompt held 75 s): PreToolUse -> PermissionRequest -> Notification(+6.0 s) and then NOTHING. No PermissionDenied, no PostToolUseFailure,
no PostToolUse, no Stop. Screen shows "Interrupted · What should Claude do instead?" and the session idles. The only later event was the next UserPromptSubmit (T+~100 s after, next case B).
START = PermissionRequest (instant; Notification lags 6 s). END on approve = PostToolUse (same tool_use_id as PreToolUse; PermissionRequest lacks tool_use_id — correlate by tool_name+tool_input).
END on deny = NO distinguishing event (unknown whether PermissionDenied fires only for auto-denials/rules; it did not fire for the interactive human "No").
Note: a rule-allowed Bash call emits PreToolUse+PostToolUse without PermissionRequest (inferred from ToolSearch/Task tool cases, which had no PermissionRequest).

## B. AskUserQuestion (3 options), held 70 s, then answered "Green"
| t | event | key fields |
|---|---|---|
| 0 | PreToolUse | tool_name=AskUserQuestion, tool_input.questions[{question,header,options[]}] |
| +0.1 | **PermissionRequest** | tool_name=AskUserQuestion (same shape as A; no suggestions of note) |
| +6.0 | **Notification** | notification_type=`permission_prompt`, message="Claude needs your permission" (IDENTICAL text to case A) |
| +73 (answer sent) | **PostToolUse** | tool_name=AskUserQuestion, tool_response = answers (stringified/truncated in my logger), duration_ms=1 |
| +73.1 | PostToolBatch, then Stop(+2 s) | |
Evidence: `1791128563.6 PermissionRequest tool_name=AskUserQuestion`, `1791128569.6 Notification permission_prompt`, `1791128636.6 PostToolUse AskUserQuestion`.
AskUserQuestion is distinguishable from a permission prompt ONLY via PermissionRequest/PreToolUse tool_name; the Notification is not distinguishing. No Elicitation event fired.
START = PermissionRequest(tool_name=AskUserQuestion). END = PostToolUse(AskUserQuestion). Cancel/Esc path: not tested = unknown.

## C. Turn finished, session idle 70 s+
| t | event | key fields |
|---|---|---|
| 0 | MessageDisplay(final=true) + **Stop** | last_assistant_message, stop_hook_active=false, background_tasks[], session_crons[] |
| +60.0 | **Notification** | notification_type=`idle_prompt`, message="Claude is waiting for your input" |
Evidence: Stop 1791128638.4 -> idle_prompt 1791128698.4; Stop 744.1 -> idle_prompt 804.1 (exactly +60 s both times). Fired once per idle, no repeat seen within 70 s (longer = unknown).
START = Stop (instant) — idle_prompt is a delayed 60 s confirmation; END = next UserPromptSubmit. Stop fires every turn end, including right before the human's next input.
Idle-after-deny: no Stop fired, so no idle_prompt either was observed in the post-deny window? Not measured — unknown.

## D. Task tools (TaskCreate x3, TaskUpdate in_progress, completed, TaskList)
Task tools were deferred: model first called ToolSearch (PreToolUse/PostToolUse ToolSearch), then:
| event | payload fields |
|---|---|
| PreToolUse TaskCreate | tool_input{subject, description} (no id yet) |
| **TaskCreated** | task_id="1", task_subject="alpha", task_description |
| PostToolUse TaskCreate | tool_response.task{id,subject} |
| PreToolUse/PostToolUse TaskUpdate | tool_input{taskId,status}; tool_response{success,taskId,updatedFields,statusChange{from,to}} |
| **TaskCompleted** | task_id="1", task_subject="alpha" (fires on status->completed, between Pre and Post) |
| PostToolUse TaskList | tool_response.tasks[{id,subject,status,blockedBy}] (stringified in my log) |
No TaskUpdated event exists; in_progress is visible only via PostToolUse TaskUpdate (statusChange.to) — TaskUpdate subject/status changes beyond completed have no dedicated event. Multiple parallel TaskCreate calls arrive as separate Pre/Created/Post triples (+0.1 s apart). PostToolBatch adds a per-batch summary.
Task payloads have NO task status in TaskCreated (new = pending, inferred) and no counts: derive counts by folding events (or call TaskList).
`probe-todo-tools-pin.js --cwd $SPK/proj` (no pin, env var unset, -p): **sonnet -> {"expectation":"present","observed":"absent","ok":false} rc=1**;
claude-haiku-4-5 -> present rc=0; sonnet with CLAUDE_CODE_ENABLE_TODO_TOOLS=1 -> present rc=0 (logs/probe-todo-pin*.out).
So: CLAUDE_CODE_ENABLE_TODO_TOOLS IS needed for sonnet in this harness; NOT needed for haiku 4.5 (interactive D ran without it). Interactive+sonnet without the var: unknown (probe was -p).

## Recommendations
Awaiting-human file:
- START (write file): PermissionRequest (covers tool permission AND AskUserQuestion; store tool_name, tool_input summary, ts). Do not wait for Notification (6 s late, same text for both).
  Optional secondary START: Notification idle_prompt (turn idle, +60 s after Stop) — or Stop for "needs next prompt" immediately.
- END (clear file): PostToolUse where tool_name matches the stored one (approve / answer); UserPromptSubmit (any human typing, also the only end on deny); Stop/SessionEnd as safety clears.
- Gap: human DENY and Esc emit nothing -> a file written at PermissionRequest stays stale until the next UserPromptSubmit. Mitigation: expire/clear on UserPromptSubmit and treat age as advisory. Race: auto-allowed calls skip PermissionRequest.
- Hook timing: all hooks ran synchronously and sub-100 ms; no hook ordering anomalies seen.
Task list: fold TaskCreated (task_id, task_subject) -> pending; PostToolUse TaskUpdate (tool_input.taskId, tool_response.statusChange.to) -> status; TaskCompleted -> completed.
Counts = fold, or snapshot from PostToolUse TaskList. Caveats: task tools gated for sonnet w/o env var (see D); TaskDelete/other updates: unknown; PreToolUse-only view lacks id for create.
Unverified: desktop app and `-p` event sets (unknown; `-p` not tested here for hooks), PermissionDenied semantics, Elicitation (MCP) events, sub-agent (Task/Agent tool) events, behaviour for auto-mode/bypass modes.
