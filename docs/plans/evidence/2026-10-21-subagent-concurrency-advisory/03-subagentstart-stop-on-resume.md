# SubagentStart and SubagentStop on resume

UNVERIFIED bullet: whether a resumed subagent fires SubagentStop again at the end of the resume.

Date: 2026-10-22

Cells: `m-resume`, `m-stamp`.

Turn 1 spawns a foreground subagent. Turn 2 is `claude -p --resume <session id>` and asks the main agent to SendMessage the same subagent id. Both turns go through `runc.sh` (`--model haiku`, `--permission-mode bypassPermissions`, `--output-format json`, stdin `/dev/null`, `AUTOPILOT_SESSION_ID` and `CLAUDE_CODE_SESSION_ID` unset). The parent prompt string is not stored as its own file in the cell. The session id and agent id are in `ids.txt`. The subagent prompt on turn 1 is in the first `PreToolUse` line of `m-resume` (`echo first-turn`). Turn 2's result text says the follow-up was `echo resumed`.

`m-resume/ids.txt`:

```text
af6bd167-7791-4091-91fa-170be364b83c a3d25b9e3753e0ef5
```


Turn 1 command shape (`runc.sh` appends `--output-format` only through the caller; the script itself adds `-p --model haiku --permission-mode bypassPermissions`). The parent prompt text was not saved as its own file. `out1.json` `result` is `Agent ID: a3d25b9e3753e0ef5` plus the `echo first-turn` line and `DONE`, and `err1.txt` is `rc=0`.

```bash
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u XDG_RUNTIME_DIR \
  HOME="$CELL/home" CLAUDE_CONFIG_DIR="$CELL/cfg" \
  timeout "$T" "$CLAUDE" -p --model haiku --permission-mode bypassPermissions \
  --output-format json "<turn-1 prompt, not stored separately>" </dev/null
```

Turn 2 uses the same wrapper with `--resume` and the session id from `ids.txt`. `out2.json` `result` says the resumed subagent replied that `echo resumed` printed `resumed`, then `DONE2`. `err2.txt` is `rc=0`. The exact parent prompt string was not stored separately.

```bash
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u XDG_RUNTIME_DIR \
  HOME="$CELL/home" CLAUDE_CONFIG_DIR="$CELL/cfg" \
  timeout "$T" "$CLAUDE" -p --resume af6bd167-7791-4091-91fa-170be364b83c \
  --model haiku --permission-mode bypassPermissions --output-format json \
  "<turn-2 prompt, not stored separately>" </dev/null
```

`m-stamp` is the same two-turn shape with session id `ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117` from `m-stamp/ids.txt`. Numeric timeouts for these cells were not written next to the outputs.

`m-resume/err1.txt` and `err2.txt` are both `rc=0`.

`m-resume/hooks.summary.txt` (full file):

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


Quoted lines. First stop, end of turn 1:

```text
t+5.2s SubagentStop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo first-turn` printed `first-turn`.","background_tasks":[],"session_crons":[]}
```

On resume, a second `SubagentStart` with the same `agent_id`:

```text
t+12.8s SubagentStart {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```

`SubagentStop` fired again at the end of the resume:

```text
t+16.8s SubagentStop {"session_id":"af6bd167-7791-4091-91fa-170be364b83c","agent_id":"a3d25b9e3753e0ef5","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The first command, `echo first-turn`, printed `first-turn`. The follow-up you sent, `echo …","background_tasks":[{"id":"a3d25b9e3753e0ef5","type":"subagent","status":"running","description":"Run echo first-turn","agent_type":"general-purpose"}],"session_crons":[]}
```

`m-stamp` used the same two-turn shape. Its `settings.json` registers capture hooks and `ao.sh` on `SubagentStart`, `SubagentStop`, and `PostToolUse`. The cell directory in this evidence set does not include `hooks/awaiting-owner.js` itself. The foreman registered that hook through `ao.sh` with a private `AUTOPILOT_LIVE_DIR`, and the stamp files below are what that directory contained.

`m-stamp/ids.txt`:

```text
ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117 a2eb6dc6da8211db3
```


`m-stamp/settings.json`:

```json
{"hooks":{"SubagentStart":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-stamp/cap.sh SubagentStart"},{"type":"command","command":"<RUN>/cells/m-stamp/ao.sh"}]}],"SubagentStop":[{"hooks":[{"type":"command","command":"<RUN>/cells/m-stamp/cap.sh SubagentStop"},{"type":"command","command":"<RUN>/cells/m-stamp/ao.sh"}]}],
"PostToolUse":[{"matcher":"","hooks":[{"type":"command","command":"<RUN>/cells/m-stamp/ao.sh"}]}]}}
```


`m-stamp/hooks.summary.txt` (full file). Same agent id `a2eb6dc6da8211db3` gets `SubagentStart` at t+0.0s and again at t+12.4s, and `SubagentStop` at t+4.7s and again at t+16.4s:

```text
t+0.0s SubagentStart {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+4.7s SubagentStop {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command printed:\n\n```\nfirst-turn\n```","background_tasks":[],"session_crons":[]}
t+12.4s SubagentStart {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
t+16.4s SubagentStop {"session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","hook_event_name":"SubagentStop","stop_hook_active":false,"last_assistant_message":"The command `echo resumed` printed:\n\n```\nresumed\n```","background_tasks":[{"id":"a2eb6dc6da8211db3","type":"subagent","status":"running","description":"Run echo first-turn","agent_type":"general-purpose"}],"session_crons":[]}
```


`m-stamp/stamps-after-turn1.txt` (before resume):

```text
== ./agents/ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117/a2eb6dc6da8211db3.json
{"schema":"autopilot.agent-activity/1","session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","last_tool_at":"2026-10-21T17:38:22.755Z","last_tool_name":"Bash","ended_at":"2026-10-21T17:38:25.310Z"}

```


`m-stamp/stamps-after-resume.txt` (after resume):

```text
== ./agents/ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117/a2eb6dc6da8211db3.json
{"schema":"autopilot.agent-activity/1","session_id":"ec4d90fa-ffeb-4afc-bbd7-1dc1644f9117","agent_id":"a2eb6dc6da8211db3","agent_type":"general-purpose","last_tool_at":"2026-10-21T17:38:35.193Z","last_tool_name":"Bash","ended_at":"2026-10-21T17:38:37.018Z"}

```


`last_tool_at` moved from `2026-10-21T17:38:22.755Z` to `2026-10-21T17:38:35.193Z`. `ended_at` moved from `2026-10-21T17:38:25.310Z` to `2026-10-21T17:38:37.018Z`.

On resume `SubagentStart` did fire (second `SubagentStart` with the same `agent_id`) and `SubagentStop` fired again at the end of the resume. The stamp's `last_tool_at` and `ended_at` both moved forward.

Consequence: the transcript-mtime fallback `resume_mtime_after_ended_counts_running` is not needed. The oracle row prints SKIPPED with this reason: SubagentStart fired on resume, so a stamp that still has `ended_at` is not treated as running from transcript mtime.

This note also settles the UNVERIFIED bullet about a resumed subagent firing `SubagentStop` again: the second `SubagentStop` for the same `agent_id` is in the `m-resume` summary at t+16.8s and in the `m-stamp` summary at t+16.4s.

Verdict: SETTLED. P2 does not implement `resume_mtime_after_ended_counts_running`. The oracle prints SKIPPED with the reason that SubagentStart fired on resume.
