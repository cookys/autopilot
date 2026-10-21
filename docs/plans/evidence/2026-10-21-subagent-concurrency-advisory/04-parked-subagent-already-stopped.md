# Parked subagent already stopped

UNVERIFIED bullet: whether a parked subagent (completed, waiting for SendMessage) has already fired SubagentStop when it parked.

Date: 2026-10-22

Cells: `m-resume` turn 1, `m-stamp` `stamps-after-turn1.txt`.

After the subagent finished and before any SendMessage, `SubagentStop` had already fired. The same agent was later resumable (note 03, turn 2, same `agent_id`).

From `m-resume/hooks.summary.txt`, turn 1 stop, then the main `Stop`, then the resume `SubagentStart` (SendMessage is the later turn). The stop line:

```text
t+5.2s SubagentStop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo first-turn` printed `first-turn`.","background_tasks":[],"session_crons":[]}
t+7.3s Stop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"Agent ID: a3d25b9e3753e0ef5\n\nIts `echo first-turn` printed `first-turn`.\n\nDONE","background_tasks":[],"session_crons":[]}
```

Full `m-resume/hooks.summary.txt`:

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo first-turn","prompt":"Run the shell command `echo first-turn` and report its output.","run_in_background":false},"tool_use_id":"toolu_01N5qdwzKxVCh6smmDTs8rEf"}
t+0.1s SubagentStart {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+5.2s SubagentStop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo first-turn` printed `first-turn`.","background_tasks":[],"session_crons":[]}
t+7.3s Stop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"Agent ID: a3d25b9e3753e0ef5\n\nIts `echo first-turn` printed `first-turn`.\n\nDONE","background_tasks":[],"session_crons":[]}
t+12.8s SubagentStart {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+15.6s Stop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The message reached subagent a3d25b9e3753e0ef5 and it resumed, but I don't have its reply …","background_tasks":[{"id":"a3d25b9e3753e0ef5","type":"subagent","status":"running","description":"Run echo first-turn","agent_type":"general-purpose"}],"session_crons":[]}
t+16.8s SubagentStop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The first command, `echo first-turn`, printed `first-turn`. The follow-up you sent, `echo …","background_tasks":[{"id":"a3d25b9e3753e0ef5","type":"subagent","status":"running","description":"Run echo first-turn","agent_type":"general-purpose"}],"session_crons":[]}
t+19.0s Stop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The resumed subagent (a3d25b9e3753e0ef5) replied that `echo resumed` printed `resumed`.\n\nD…","background_tasks":[],"session_crons":[]}
```


`m-stamp/stamps-after-turn1.txt` (stamp already has `ended_at` before resume):

```text
== ./agents/ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117/a2eb6dc6da8211db3.json
{"schema":"autopilot.agent-activity/1","session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","last_tool_at":"2026-10-21T17:38:22.755Z","last_tool_name":"Bash","ended_at":"2026-10-21T17:38:25.310Z"}

```


`m-stamp/hooks.summary.txt` turn 1 stop, before the t+12.4s resume `SubagentStart`:

```text
t+0.0s SubagentStart {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+4.7s SubagentStop {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command printed:\n\n```\nfirst-turn\n```","background_tasks":[],"session_crons":[]}
t+12.4s SubagentStart {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+16.4s SubagentStop {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo resumed` printed:\n\n```\nresumed\n```","background_tasks":[{"id":"a2eb6dc6da8211db3","type":"subagent","status":"running","description":"Run echo first-turn","agent_type":"general-purpose"}],"session_crons":[]}
```


The turn-1 stamp line is `ended_at` `2026-10-21T17:38:25.310Z` on agent `a2eb6dc6da8211db3`. Note 03 shows that same id accepted a later SendMessage.

Verdict: SETTLED. A parked subagent has `ended_at` and does not count. The parked negative control holds.
