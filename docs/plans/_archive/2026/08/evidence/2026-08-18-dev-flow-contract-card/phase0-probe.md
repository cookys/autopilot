# Phase-0 probe — plugin-skill surfacing + TaskCreate residue (2026-08-18)

One live call (counts against the ≤6 smoke budget). CLI: claude 2.1.234. Model: sonnet.
Transcript: `phase0-probe-transcript.jsonl` (stream-json, 55,524 bytes).

## Setup

Synthetic plugin (`.claude-plugin/plugin.json` name=autopilot + byte-copy of
`skills/dev-flow/SKILL.md`), scratch HOME + scratch CLAUDE_CONFIG_DIR seeded with
`.credentials.json` only, tiny one-commit git repo as cwd. Flags:
`claude -p --model sonnet --plugin-dir <plugin> --setting-sources project
--strict-mcp-config --dangerously-skip-permissions --output-format stream-json --verbose`.
Prompt (mechanical, not a routing test): list available Skill-tool skills; invoke
autopilot:dev-flow; create a task titled probe-task if a task tool exists.

## Findings

1. **CONFIRMED — plugin skills surface and load headless.** The reply lists
   `autopilot:dev-flow` among available skills, and the transcript contains
   `tool_use: Skill {"skill":"autopilot:dev-flow","args":"probe"}`. The instrument's
   primary arm-realization channel (real `--plugin-dir` plugin, plan §3) works under
   exactly the eval flag set. The pre-registered prompt-injection fallback is NOT needed.
2. **REFUTED — task-store residue channel.** No TaskCreate tool exists in headless `-p`
   sessions on 2.1.234: the subject model's ToolSearch for TaskCreate returned no match,
   no `~/.claude/tasks/` residue was created (scratch HOME empty of task JSON). The
   plan §3 marker channel 2 (task-store JSON, `blockedBy` edges) is unmeasurable in the
   eval sandbox — not "path moved" but "tool absent".
3. Event shape pinned: assistant tool_use blocks carry `{type:"tool_use", name:"Skill",
   input:{skill, args}}` inside `message.content[]` of stream-json lines — the scorer's
   transcript channel can key on `name` + `input.skill`.

## Design consequence (folded into the plan before rules freeze)

F2 (forcing-function TaskCreates) leaves the marker family set: its text is KEEP-verbatim
pinned (rule-inventory owners + canonical invariants) so FULL and CARD are byte-identical
on it — it carries zero discriminating power for the non-inferiority claim, and its
FULL-vs-OFF sensitivity is unobservable headless (tool absent). Recorded as an unmeasured
surface next to multi-turn/Mission-mode. Task set d1/d2/d4 keep their F1/F3 markers;
family count drops 6 → 5; V2 validity threshold rescales accordingly (see plan §4 revision).
