# background_tasks lists sibling subagents

UNVERIFIED bullet: whether `background_tasks` in a Stop or SubagentStop payload lists sibling subagents still running (it is documented as parent-session scoped; whether that scope includes siblings is the unverified part).

Date: 2026-10-22

Cells: `m-sib` (two parallel background subagents, one sleeping 40 s) and `m-resume` (the resume turn's stop payload also lists the subagent).

Command shape for `m-sib` is `runc.sh` with a prompt that asks for two background subagents, one running `sleep 40; echo slow-done` and one running `echo fast-done`. The parent prompt string is not a separate file. The two `PreToolUse` lines record `"run_in_background":true` and those shell commands.

`m-sib/hooks.summary.txt` (full file):

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


`m-sib/err.txt`:

```text
rc=0
```


Findings from those lines:

- The `Stop` at t+2.6s lists both subagents still running: `a192476e36755845e` (slow) and `a2feb1cf32fc72c97` (fast).
- The fast agent's `SubagentStop` at t+4.5s (`agent_id` `a2feb1cf32fc72c97`) lists the sibling `a192476e36755845e` as `status` `running`, and also lists itself (`a2feb1cf32fc72c97`) as `status` `running`.
- The slow agent's `SubagentStop` at t+6.4s (`agent_id` `a192476e36755845e`) lists itself as `status` `running` and lists shell `bvuzqc6ws` (`type` `shell`, command `sleep 40; echo slow-done`) as `status` `running`. That `SubagentStop` fired early: the last assistant message says the command is running in the background, and the next `Stop` at t+9.2s still lists that shell as running. `m-sib/out.json` `result` says the slow subagent's result is interim and the final notification had not arrived (`is_error` false). The slow subagent's `SubagentStop` fired while the shell kept running.

`m-resume` shows the same self-listing shape on the resume `SubagentStop` (the stopping agent is still `running` in its own payload). Full summary:

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


The resume `SubagentStop` at t+16.8s for `a3d25b9e3753e0ef5` includes `background_tasks` entry id `a3d25b9e3753e0ef5`, `type` `subagent`, `status` `running`.

Verdict: SETTLED as documented. `Stop` and `SubagentStop` `background_tasks` list sibling subagents that are still running, and also list the stopping agent itself as running at its own `SubagentStop`. Per plan Options, B does not switch to this payload. Record it as a candidate for a later plan.
