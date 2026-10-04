Engine: sonnet

# Spike S10/S11 — which hook events fire when Claude Code waits on the human, and what Task-tool hooks see

Probe-only. Produce facts, not product code. Write everything under
SPK=/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1c/s10
and the report to $SPK/REPORT.md. Do not edit the repo at /home/cookys/projects/autopilot, do not touch the real ~/.claude or ~/.autopilot. Use the isolated harness that the C1 probe (S7) already built: read
/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/p1c/c1/{cc.sh,launch.sh,seed.py} and
/home/cookys/projects/autopilot/docs/plans/evidence/2026-10-03-mods-spikes/S7-clear-interactive.md first, and copy that setup into $SPK (isolated CLAUDE_CONFIG_DIR seeded with only `.credentials.json`; a scratch project dir; a scratch plugin). Known trap: giving a child process the real ~/.claude resets it — never do that.

## What to measure (real interactive session in tmux, not `-p`)
Register a scratch plugin whose classic hooks log the FULL JSON stdin payload plus a timestamp to a JSONL file for EVERY hook event Claude Code offers (enumerate them from the installed CLI's own docs/`--help`/schema or the official hooks docs URL; record the version from `claude --version` and the source of the event list). At minimum: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification (all matchers/types), Stop, SubagentStop, PreCompact, SessionEnd, and any permission-related event if one exists.
Drive the session (tmux send-keys; avoid paste bursts) through:
 A. a tool call that needs permission (e.g. a Bash command outside the allowlist) — leave the prompt open 70 s, then approve; then repeat and deny.
 B. the model calling AskUserQuestion (prompt it to ask you a multiple-choice question) — wait 70 s, then answer.
 C. the model finishing its turn and the session sitting idle waiting for input for 70 s+.
 D. TaskCreate, TaskUpdate (in_progress, completed), TaskList — prompt the model to create 3 tasks and complete 1. Also run `node /home/cookys/projects/autopilot/scripts/probe-todo-tools-pin.js --cwd $SPK/proj` once and record its verdict, and record whether CLAUDE_CODE_ENABLE_TODO_TOOLS is needed in this harness.
For each of A–D answer: which events fired, in what order, with what timing; the exact payload fields (event name, notification type/message, tool_name, tool_input incl. task subject/status/id, session_id, cwd); which event marks the START of "waiting on the human" and which marks its END (user reply / approval / answer). Say plainly if a case produced NO distinguishing event.

## Report ($SPK/REPORT.md, ≤150 lines)
A table per case A–D with the event sequence and the key payload fields (paste trimmed real payload lines from the JSONL as evidence). Then: recommended START/END signals for an "awaiting the human" file, and for a per-session task list (subject, status, counts), with any caveats (e.g. task tools gated, events missing in desktop/`-p`). Mark every unverified statement `unknown`. Keep the raw JSONL logs in $SPK/logs/. Final message: report path + 5-line summary.
