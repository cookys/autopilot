# SubagentStop on a user interrupt

UNVERIFIED bullet: whether SubagentStop fires on a user interrupt.

Date: 2026-10-22

Cells: `m-int-SIGINT`, `m-int-SIGTERM`, `m-esc`, `m-esc-try1-sleep90`.

A true Esc-style interrupt of a running subagent could not be produced cleanly. Under `-p` the only interrupt available in these cells is a process signal. `sigcell.js` (from `m-int-SIGINT`; the same program sent SIGTERM in the other cell) finds the `claude` process whose command line contains `p0spike/run/bin/claude` and whose environment contains that cell's config dir, and sends the named signal:

```javascript
const fs=require('fs');const [cell,sig]=process.argv.slice(2);
for(const p of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{
 const cmd=fs.readFileSync(`/proc/${p}/cmdline`,'utf8');const env=fs.readFileSync(`/proc/${p}/environ`,'utf8');
 if(cmd.includes('p0spike/run/bin/claude')&&!cmd.includes('timeout')&&env.includes(`cells/${cell}/cfg`)){process.kill(+p,sig);console.log('sent',sig,'to',p);}
}catch(e){}}
```


The headless cells used `runc.sh` (model haiku, `bypassPermissions`, stdin `/dev/null`) with a prompt that asked for one foreground Agent running `sleep 60; echo slept`. SIGINT and SIGTERM were sent with `sigcell.js` while that subagent was in `SubagentStart` and before any stop hook.

`m-int-SIGINT/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"fe0fea75-76de-4f3d-aed1-9b5ee1d08fc0","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run sleep 60 command","prompt":"Run the shell command `sleep 60; echo slept` using the Bash tool, then reply with the exact output it produced…","run_in_background":false},"tool_use_id":"toolu_01ARQXpZf51LWcXZ43u67Dbr"}
t+0.1s SubagentStart {"session_id":"fe0fea75-76de-4f3d-aed1-9b5ee1d08fc0","agent_id":"a3f42b4dac8ee1ef5","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```


`m-int-SIGINT/err.txt`:

```text
rc=0
```


`m-int-SIGINT/out.json` is one JSON line. Fields kept below; other keys omitted:

```json
{
  "is_error": true,
  "subtype": "error_during_execution",
  "api_error_status": null,
  "terminal_reason": "aborted_tools",
  "result": null,
  "stop_reason": "tool_use",
  "session_id": "fe0fea75-76de-4f3d-aed1-9b5ee1d08fc0",
  "errors": [
    "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
    "Error: ENOENT: no such file or directory, open '<RUN>/cells/m-int-SIGINT/cfg/projects/<SLUG>/fe0fea75-76de-4f3d-aed1-9b5ee1d08fc0/subagents'\n    at async <anonymous> (node:fs/promises:179:56)\n    at async Qr (/$bunfs/root/chunk-4nazcye9.js:16:11376)\n    at async pw (/$bunfs/root/chunk-4nazcye9.js:16:9208)\n    at async <anonymous> (/$bunfs/root/chunk-9w2anv6v.js:19:10566)\n    at async C (/$bunfs/root/chunk-9w2anv6v.js:19:11789)\n    at async gt (/$bunfs/root/chunk-9w2anv6v.js:19:6413)\n    at async <anonymous> (/$bunfs/root/chunk-9w2anv6v.js:19:14734)"
  ]
}
```


`m-int-SIGTERM/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"bf54dbbf-46e3-4610-977b-a7900ec2a62d","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run sleep 60 command","prompt":"Run the shell command `sleep 60; echo slept` using the Bash tool, then reply with exactly the output it produc…","subagent_type":"general-purpose","run_in_background":false},"tool_use_id":"toolu_015nQyHeBD3VMs8amrhWhoT5"}
t+0.1s SubagentStart {"session_id":"bf54dbbf-46e3-4610-977b-a7900ec2a62d","agent_id":"ac2fcd062c0bf4db4","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```


`m-int-SIGTERM/err.txt`:

```text
rc=143
```


`m-int-SIGTERM/out.json` is empty (0 bytes). No result object was captured. The exit code on stderr is `rc=143`.

In both signal runs the captured hooks are `PreToolUse` and `SubagentStart` only. No `SubagentStop` and no `Stop` were captured. SIGINT produced an error result (`is_error` true, `subtype` `error_during_execution`, `terminal_reason` `aborted_tools`) with `rc=0` from the `timeout` wrapper. SIGTERM exited `rc=143`.

Interactive attempts used a tmux session that launched `claude` the way `run-tui.sh` does, with the same temp `HOME` and `CLAUDE_CONFIG_DIR`. Keystrokes are the pane captures. `m-esc` spawned agent `aaaa2c838dd377ece` (12 sequential `sleep 6; echo tick` runs). Esc was sent while the main thread was idle (`esc-sent-at.txt` value `1792604156.220997021`) and again from inside the subagent view (`esc2-sent-at.txt` value `1792604188.354612493`).

`m-esc/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"ec443fca-2d15-4afa-8216-4e1c8b5d5339","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run 12 sequential sleep ticks","prompt":"Run the Bash command `sleep 6; echo tick` exactly 12 times. Requirements:\n- Make each run a SEPARATE Bash tool…","subagent_type":"general-purpose"},"tool_use_id":"toolu_01P6SEi8gykSwBaGZj67EsbN"}
t+0.1s SubagentStart {"session_id":"ec443fca-2d15-4afa-8216-4e1c8b5d5339","agent_id":"aaaa2c838dd377ece","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+1.7s Stop {"session_id":"ec443fca-2d15-4afa-8216-4e1c8b5d5339","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"I've started the subagent. It's running the 12 sequential `sleep 6; echo tick` calls in th…","background_tasks":[{"id":"aaaa2c838dd377ece","type":"subagent","status":"running","description":"Run 12 sequential sleep ticks","agent_type":"general-purpose"}],"session_crons":[]}
t+32.5s SubagentStop {"session_id":"ec443fca-2d15-4afa-8216-4e1c8b5d5339","agent_id":"a1b66e913632a9c97","agent_type":"","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"Running third sleep-tick command","background_tasks":[{"id":"aaaa2c838dd377ece","type":"subagent","status":"running","description":"Run 12 sequential sleep ticks","agent_type":"general-purpose"}],"session_crons":[]}
t+63.8s SubagentStop {"session_id":"ec443fca-2d15-4afa-8216-4e1c8b5d5339","agent_id":"abfe671211a4806d4","agent_type":"","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"Running seventh sleep-tick command","background_tasks":[{"id":"aaaa2c838dd377ece","type":"subagent","status":"running","description":"Run 12 sequential sleep ticks","agent_type":"general-purpose"}],"session_crons":[]}
```


`m-esc/pane-before-esc.txt` (full file):

```text

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage

  ● main
  ◯ general-purpose  Run 12 sequential sleep ticks                                                                                        12s · ↓ 28.9k tokens
```


`m-esc/pane-after-esc.txt` (full file):

```text

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage

  ● main
  ◯ general-purpose  Run 12 sequential sleep ticks                                                                                        22s · ↓ 29.1k tokens
```


`m-esc/pane-before-esc2.txt` (full file):

```text




✢ Puzzling… (44s · ↓ 29.5k tokens)
  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude's current work

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── Run 12 sequential sleep ticks ─
❯ Message @general-purpose…
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ↑/↓ to select

  ◯ main
❯ ● general-purpose  Running third sleep-tick command                                                                                     44s · ↓ 29.5k tokens
```


`m-esc/pane-after-esc2.txt` (full file):

```text




· Puzzling… (52s · ↓ 29.7k tokens)
  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude's current work

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── Run 12 sequential sleep ticks ─
❯ Message @general-purpose…
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on (shift+tab to cycle) · ↓ to manage

  ◯ main
  ● general-purpose  Running third sleep-tick command                                                                                     52s · ↓ 29.7k tokens
```


The subagent ran in the background while the main thread was idle. Esc on the idle main thread and Esc inside the subagent view did not stop it: the pane still lists `general-purpose` / `Run 12 sequential sleep ticks` after each Esc, and the hook summary never shows `SubagentStop` for `aaaa2c838dd377ece`.

Side finding: the `SubagentStop` lines that did appear in `m-esc` belong to other agent ids (`a1b66e913632a9c97`, `abfe671211a4806d4`) with empty `agent_type`, not the spawned subagent `aaaa2c838dd377ece`. Those stops still list `aaaa2c838dd377ece` as a running subagent in `background_tasks`.

`m-esc-try1-sleep90` is a separate interactive attempt (`sleep 90`). Its summary is pasted because the cell is part of this bullet. It does not show an Esc stop of the spawned agent either: `SubagentStop` for `a0a9a4c68b4129173` fires while that same id is still `status` `running`, alongside a `shell` entry, which is the background-shell shape also recorded in note 07.

`m-esc-try1-sleep90/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"8d16d855-c05f-4b0a-8132-bfcef2f5e2c6","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run sleep 90 command","prompt":"Run the shell command `sleep 90; echo slept` using the Bash tool, exactly as written. Do not run anything else…","subagent_type":"general-purpose"},"tool_use_id":"toolu_01QA3tW1xwkBSHTRdFNAdnN2"}
t+0.1s SubagentStart {"session_id":"8d16d855-c05f-4b0a-8132-bfcef2f5e2c6","agent_id":"a0a9a4c68b4129173","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+1.9s Stop {"session_id":"8d16d855-c05f-4b0a-8132-bfcef2f5e2c6","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The subagent is still running the `sleep 90; echo slept` command. I'll reply DONE once it …","background_tasks":[{"id":"a0a9a4c68b4129173","type":"subagent","status":"running","description":"Run sleep 90 command","agent_type":"general-purpose"}],"session_crons":[]}
t+6.8s SubagentStop {"session_id":"8d16d855-c05f-4b0a-8132-bfcef2f5e2c6","agent_id":"a0a9a4c68b4129173","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command is running in the background now, and I'll reply with its output when it finis…","background_tasks":[{"id":"a0a9a4c68b4129173","type":"subagent","status":"running","description":"Run sleep 90 command","agent_type":"general-purpose"},{"id":"br19df38m","type":"shell","status":"running","description":"Sleep 90 seconds then echo slept","command":"sleep 90; echo slept"}],"session_crons":[]}
t+8.6s Stop {"session_id":"8d16d855-c05f-4b0a-8132-bfcef2f5e2c6","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"The subagent has not finished yet. It reported that its `sleep 90` is still running in the…","background_tasks":[{"id":"br19df38m","type":"shell","status":"running","description":"Sleep 90 seconds then echo slept","command":"sleep 90; echo slept"}],"session_crons":[]}
```


`m-esc-try1-sleep90/pane-before-esc.txt` and `pane-after-esc.txt` (full files). The subagent line is still present after Esc:

```text





────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 1 shell · ↓ to manage

  ● main
  ◯ general-purpose  Run sleep 90 command                                                                                                  6s · ↓ 29.3k tokens
```


```text





────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ 
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ bypass permissions on · 1 shell · ↓ to manage

  ● main
  ◯ general-purpose  Run sleep 90 command                                                                                                  6s · ↓ 29.6k tokens
```


Verdict: process-kill case SETTLED (no SubagentStop). User Esc interrupt of a running subagent is ACCEPTED RISK. Fallback from plan Options: the stamp looks running until stale, advisory cost is one line, no deny.
