# P0 method: subagent concurrency advisory

Date: 2026-10-22

Claude Code version, from `claude-version.txt`:

```text
2.1.306 (Claude Code)
```


The foreman ran the real `claude` binary (that version) under a temporary `HOME` and a fresh `CLAUDE_CONFIG_DIR`. The config directory held only credentials (copied from the operator config, mode 600) plus a `settings.json` whose hooks capture `SubagentStart`, `SubagentStop`, `PreToolUse`, and `Stop`. Each run used `--model haiku` and `--permission-mode bypassPermissions`. The environment unset `AUTOPILOT_SESSION_ID` and `CLAUDE_CODE_SESSION_ID` (and `XDG_RUNTIME_DIR`). Stdin was `/dev/null`. Each foreground invocation was wrapped in `timeout`.

Tokens, email addresses, and HOME paths were redacted in the captured files before these notes were written. Paths that would name the operator home appear as `<RUN>` or `<SLUG>` in the pasted blocks below.

Total spend across the captured `total_cost_usd` fields was about 0.040 USD, under 0.10 USD. Cells killed before they wrote a result JSON (`m-quota-unbounded-retry`, `m-int-SIGTERM`) contribute no cost field.

`mkcell.sh` (cell layout and capture hooks):

```bash
#!/bin/bash
# usage: mkcell.sh NAME [MATCHER_PRETOOL]  -> prints env setup dir
R=<RUN>
N=$1; M=${2:-"Task|Agent"}
CELL=$R/cells/$N; rm -rf $CELL; mkdir -p $CELL/cfg $CELL/home $CELL/work
cp ~/.claude/.credentials.json $CELL/cfg/.credentials.json; chmod 600 $CELL/cfg/.credentials.json
cat > $CELL/cap.sh <<EOS
#!/bin/bash
printf '%s\t%s\t' "\$1" "\$(date +%s.%N)" >> $CELL/hooks.tsv
cat | tr '\n' ' ' >> $CELL/hooks.tsv; echo >> $CELL/hooks.tsv
EOS
chmod +x $CELL/cap.sh
h(){ echo "{\"type\":\"command\",\"command\":\"$CELL/cap.sh $1\"}"; }
cat > $CELL/cfg/settings.json <<EOS
{"hooks":{
"SubagentStart":[{"hooks":[$(h SubagentStart)]}],
"SubagentStop":[{"hooks":[$(h SubagentStop)]}],
"PreToolUse":[{"matcher":"$M","hooks":[$(h PreToolUse[$M])]}],
"Stop":[{"hooks":[$(h Stop)]}]
}}
EOS
echo $CELL
```


`runc.sh` (one headless turn):

```bash
#!/bin/bash
# usage: runc.sh CELL TIMEOUT claude-args...  (prompt via args)
CELL=$1; T=$2; shift 2
cd $CELL/work
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u XDG_RUNTIME_DIR HOME=$CELL/home CLAUDE_CONFIG_DIR=$CELL/cfg \
 timeout $T <RUN>/bin/claude -p --model haiku --permission-mode bypassPermissions --output-format json "$@" </dev/null
echo "rc=$?" >&2
```


`sum.js` turned each `hooks.tsv` into the `hooks.summary.txt` pasted in the notes (one hook stdin per line, `t+` seconds since the first hook in that file). This session did not run `claude`.

## Index

1. [01-subagentstop-on-quota-error.md](01-subagentstop-on-quota-error.md) — quota / HTTP 429. SIMULATED, true usage-limit case ACCEPTED RISK.
2. [02-subagentstop-on-user-interrupt.md](02-subagentstop-on-user-interrupt.md) — process signals SETTLED; Esc interrupt of a running subagent ACCEPTED RISK.
3. [03-subagentstart-stop-on-resume.md](03-subagentstart-stop-on-resume.md) — resume SubagentStart and a second SubagentStop. SETTLED. Transcript-mtime row SKIPPED.
4. [04-parked-subagent-already-stopped.md](04-parked-subagent-already-stopped.md) — parked subagent already has `ended_at`. SETTLED.
5. [05-run-in-background-tool-input.md](05-run-in-background-tool-input.md) — `run_in_background` is optional. SETTLED.
6. [06-task-agent-matcher-alias.md](06-task-agent-matcher-alias.md) — `Task`-only matcher still sees `tool_name` Agent. SETTLED.
7. [07-background-tasks-siblings.md](07-background-tasks-siblings.md) — `background_tasks` lists siblings. SETTLED as a later-plan candidate.
