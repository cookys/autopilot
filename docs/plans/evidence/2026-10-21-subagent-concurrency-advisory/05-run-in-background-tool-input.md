# run_in_background on Agent tool_input

UNVERIFIED bullet: `run_in_background` as an Agent `tool_input` field.

Date: 2026-10-22

Cells: `m-sib`, `m-resume`, `m-agent`.

`PreToolUse` `tool_input` carries `run_in_background` when the model sets it (`true` in `m-sib`, `false` in `m-resume`) and omits it when the model did not set it (`m-agent`).

`m-sib/hooks.summary.txt` (full file). Both Agent calls set `"run_in_background":true`:

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run slow sleep subagent","prompt":"Run the shell command 'sleep 40; echo slow-done' and report its output.","subagent_type":"general-purpose","run_in_background":true},"tool_use_id":"toolu_0111rJdXtRLNNpoDa2EDiK5i"}
t+0.0s SubagentStart {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","agent_id":"a192476e36755845e","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+0.3s PreToolUse[Task|Agent] {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run fast echo subagent","prompt":"Run the shell command 'echo fast-done' and report its output.","subagent_type":"general-purpose","run_in_background":true},"tool_use_id":"toolu_01QH5Thf2Z2vh7Mz3JdHw1oE"}
t+0.4s SubagentStart {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","agent_id":"a2feb1cf32fc72c97","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+2.6s Stop {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"Both subagents are running in the background: the slow one (`sleep 40; echo slow-done`) an…","background_tasks":[{"id":"a192476e36755845e","type":"subagent","status":"running","description":"Run slow sleep subagent","agent_type":"general-purpose"},{"id":"a2feb1cf32fc72c97","type":"subagent","status":"running","description":"Run fast echo subagent","agent_type":"general-purpose"}],"session_crons":[]}
t+4.5s SubagentStop {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","agent_id":"a2feb1cf32fc72c97","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo fast-done` printed `fast-done`.","background_tasks":[{"id":"a192476e36755845e","type":"subagent","status":"running","description":"Run slow sleep subagent","agent_type":"general-purpose"},{"id":"a2feb1cf32fc72c97","type":"subagent","status":"running","description":"Run fast echo subagent","agent_type":"general-purpose"}],"session_crons":[]}
t+5.8s Stop {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The fast subagent has finished and reported `fast-done`. The slow one (`sleep 40; echo slo…","background_tasks":[{"id":"a192476e36755845e","type":"subagent","status":"running","description":"Run slow sleep subagent","agent_type":"general-purpose"},{"id":"bvuzqc6ws","type":"shell","status":"running","description":"Sleep 40 seconds then echo slow-done","command":"sleep 40; echo slow-done"}],"session_crons":[]}
t+6.4s SubagentStop {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","agent_id":"a192476e36755845e","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command is running in the background (task ID bvuzqc6ws). The harness blocked the fore…","background_tasks":[{"id":"a192476e36755845e","type":"subagent","status":"running","description":"Run slow sleep subagent","agent_type":"general-purpose"},{"id":"bvuzqc6ws","type":"shell","status":"running","description":"Sleep 40 seconds then echo slow-done","command":"sleep 40; echo slow-done"}],"session_crons":[]}
t+9.2s Stop {"session_id":"3d9757a4-eb8b-4f2a-976a-7197d42e4391","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"Not done yet. The slow subagent has reported back, but its result is interim: it started `…","background_tasks":[{"id":"bvuzqc6ws","type":"shell","status":"running","description":"Sleep 40 seconds then echo slow-done","command":"sleep 40; echo slow-done"}],"session_crons":[]}
```


`m-resume/hooks.summary.txt` first `PreToolUse` line sets `"run_in_background":false` (full file):

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


`m-agent/hooks.summary.txt` (full file). The `tool_input` object has `description`, `prompt`, and `subagent_type` and no `run_in_background` key:

```text
t+0.0s PreToolUse[Agent] {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hello-sub","prompt":"Run the shell command `echo hello-sub` and report its output. Do nothing else.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01EpBEVDdBKWGbUMBqQ1Y3nt"}
t+0.1s SubagentStart {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","agent_id":"a0201bdd810115b5e","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+1.7s Stop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The subagent is still running. I'll reply DONE once its notification arrives and it report…","background_tasks":[{"id":"a0201bdd810115b5e","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
t+3.2s SubagentStop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","agent_id":"a0201bdd810115b5e","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo hello-sub` printed `hello-sub`.","background_tasks":[{"id":"a0201bdd810115b5e","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
t+4.7s Stop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"DONE","background_tasks":[],"session_crons":[]}
```


In `m-agent`, with the field omitted, the main thread reached `Stop` at t+1.7s while the subagent was still listed running in `background_tasks`:

```text
t+1.7s Stop {"session_id":"143daf57-df05-4037-9bb4-72339d615a4b","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The subagent is still running. I'll reply DONE once its notification arrives and it report…","background_tasks":[{"id":"a0201bdd810115b5e","type":"subagent","status":"running","description":"Run echo hello-sub","agent_type":"general-purpose"}],"session_crons":[]}
```

The field being absent does not mean foreground.

`m-agent/err.txt` is empty, so that cell's process exit code was not captured. The hook file is the evidence for this bullet.

Verdict: SETTLED as an optional field. A note keyed on `run_in_background` must treat absence as unknown. Plan Options: if the field is absent, the background-versus-foreground note stays out of scope.
