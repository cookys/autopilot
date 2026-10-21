# Task matcher alias still receives Agent

UNVERIFIED bullet: the PreToolUse matcher alias from `Task` to `Agent` (the repo registers `Task|Agent` at `hooks/hooks.json:129`; whether the harness still delivers an Agent call to a `Task`-only matcher is the unverified part).

Date: 2026-10-22

Cells: `m-agent` (matcher `Agent` only) and `m-task` (matcher `Task` only). Each run registered that matcher alone, with the same prompt (spawn one subagent that runs `echo hello-sub`).

`m-agent/settings.json` matcher is `Agent`. `m-task/settings.json` matcher is `Task`.

First lines of `m-agent/hooks.summary.txt` and `m-task/hooks.summary.txt` (the files continue below in full):

```text
t+0.0s PreToolUse[Agent] {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hello-sub","prompt":"Run the shell command `echo hello-sub` and report its output. Do nothing else.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01EpBEVDdBKWGbUMBqQ1Y3nt"}
t+0.0s PreToolUse[Task] {"session_id":"a47d2053-5728-4cdf-812d-7f6a73973944","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hello-sub","prompt":"Run the shell command `echo hello-sub` and report its output. Do nothing else.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01BfZmfJq8zvt3yjm62TCmsk"}
```

`m-agent/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Agent] {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hello-sub","prompt":"Run the shell command `echo hello-sub` and report its output. Do nothing else.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01EpBEVDdBKWGbUMBqQ1Y3nt"}
t+0.1s SubagentStart {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","agent_id":"a0201bdd810115b5e","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+1.7s Stop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The subagent is still running. I'll reply DONE once its notification arrives and it report…","background_tasks":[{"id":"a0201bdd810115b5e","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
t+3.2s SubagentStop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","agent_id":"a0201bdd810115b5e","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo hello-sub` printed `hello-sub`.","background_tasks":[{"id":"a0201bdd810115b5e","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
t+4.7s Stop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"DONE","background_tasks":[],"session_crons":[]}
```


`m-task/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task] {"session_id":"a47d2053-5728-4cdf-812d-7f6a73973944","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hello-sub","prompt":"Run the shell command `echo hello-sub` and report its output. Do nothing else.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01BfZmfJq8zvt3yjm62TCmsk"}
t+0.1s SubagentStart {"session_id":"a47d2053-5728-4cdf-812d-7f6a73973944","agent_id":"a6492048f86e3e3e2","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+2.0s Stop {"session_id":"a47d2053-5728-4cdf-812d-7f6a73973944","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The subagent is still running `echo hello-sub`. I'll reply DONE once its completion notifi…","background_tasks":[{"id":"a6492048f86e3e3e2","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
t+3.0s SubagentStop {"session_id":"a47d2053-5728-4cdf-812d-7f6a73973944","agent_id":"a6492048f86e3e3e2","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo hello-sub` printed:\n\n```\nhello-sub\n```","background_tasks":[{"id":"a6492048f86e3e3e2","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
t+4.2s Stop {"session_id":"a47d2053-5728-4cdf-812d-7f6a73973944","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"DONE","background_tasks":[],"session_crons":[]}
```


`m-agent/settings.json`:

```json
{"hooks":{
"SubagentStart":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-agent/cap.sh SubagentStart"}]}],
"SubagentStop":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-agent/cap.sh SubagentStop"}]}],
"PreToolUse":[{"matcher":"Agent","hooks":[{"type":"command","command":"<RUN>/cells/m-agent/cap.sh PreToolUse[Agent]"}]}],
"Stop":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-agent/cap.sh Stop"}]}]
}}
```


`m-task/settings.json`:

```json
{"hooks":{
"SubagentStart":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-task/cap.sh SubagentStart"}]}],
"SubagentStop":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-task/cap.sh SubagentStop"}]}],
"PreToolUse":[{"matcher":"Task","hooks":[{"type":"command","command":"<RUN>/cells/m-task/cap.sh PreToolUse[Task]"}]}],
"Stop":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-task/cap.sh Stop"}]}]
}}
```


Both matchers fired. `tool_name` in the payload is `Agent` in both. `m-task/err.txt` is `rc=0`. `m-agent/err.txt` is empty.

Verdict: SETTLED. A `Task`-only matcher still receives the Agent call. Keeping `Task|Agent` in `hooks.json` is harmless.
