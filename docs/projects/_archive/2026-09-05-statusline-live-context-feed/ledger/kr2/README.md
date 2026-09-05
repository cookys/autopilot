# KR2 receipt — one real l4-marker run where foreman-guard read the subagent's own row (2026-09-05)

Setup: `session-mode.js set --level l4` for this repo (TTL 1 h), `~/.autopilot/config.json` `context_budget.t2` temporarily 1000
(backup restored afterwards, marker cleared; verified `active: false`). Live files written by the installed codeforge
(`/run/user/1000/autopilot/context/<sid>.tasks.json`). Probe: one sonnet subagent attempting three Bash calls.

Verbatim denials the probe received (relayed by the probe, three attempts):

1. `sleep 8; echo probe-a` — denied by the pre-existing polling rule:
   `foreman-guard: foreground sleep is a poll (rule sleep, ironlaw #6). … (Bash call 1/40 spent.)`
2. `sleep 8; echo probe-b` — denied by the NEW live-file rule:
   `foreman-guard: this agent's own context is 47734 tokens, at or past T2 (1000 of its 1000000-token window, subagent status line). Write your handoff (autopilot:handoff) NOW and end the turn (一刀一命); depth-0 spawns the next foreman/worker for the remaining work.`
3. `echo probe-c` — same denial as 2.

What this proves: `tasks[].id === agent_id` matched exactly one row for the running subagent; `tokenCount` (47734) and
`contextWindowSize` (1000000) came from the subagent status line through the tmpfs tasks file; the deny fired from
`tokenCount ≥ t2(row.contextWindowSize)` with the handoff directive. The depth-0 session's own `context-budget` message
during the same window read `381k tokens = 38% of the ~1000k window (statusline)` — the real window, no inference.
