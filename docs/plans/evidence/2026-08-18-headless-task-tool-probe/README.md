# Headless task-tool probe — resolving a contradiction in our own evidence (2026-08-18)

Two live calls, sonnet, `claude 2.1.234`. Run while scoping option B (a multi-turn harness),
because whether forcing functions are observable decides that design.

## The contradiction

| Source | Claim |
|---|---|
| `references/multi-agent-portability.md:221` (2026-06-12, CC 2.1.175) | Tasks persist as durable JSON under `~/.claude/tasks/<session-id>/`, with `blocks`/`blockedBy`; described as reachable from a **headless** probe |
| `…/2026-08-18-dev-flow-contract-card/phase0-probe.md` (2026-08-18, CC 2.1.234) | **No TaskCreate tool exists in headless `-p`** — and on that basis the F2 marker family was permanently dropped from the instrument |

If the newer probe's finding were an artifact of its flag set
(`--setting-sources project --strict-mcp-config`), then a whole marker family — the one covering
dev-flow's forcing functions, which is exactly what option B most wants to see — was retired for
a flag, not a fact. That is worth two calls to settle.

## Method

Identical prompt both runs: *"List the exact names of every tool you can call that creates or
lists tasks. If a task-creating tool exists, call it to create a task titled probe-task-X and
report the tool name. If none exists, say NO_TASK_TOOL."* Scratch `HOME` + scratch
`CLAUDE_CONFIG_DIR` seeded with `.credentials.json` only (never the real `~/.claude`, which gets
reset), fresh one-commit git repo as cwd, `--output-format stream-json --verbose`.

| Probe | Flags | Result |
|---|---|---|
| A | `--setting-sources project --strict-mcp-config --dangerously-skip-permissions` | `NO_TASK_TOOL`; tool_use names = `ToolSearch` only; **0** `tasks/*.json` residue |
| B | `--dangerously-skip-permissions` only (default setting sources) | `NO_TASK_TOOL`; tool_use names = `ToolSearch` only; **0** `tasks/*.json` residue |

In both runs the subject searched for the tool itself (`ToolSearch`) before answering, so the
negative is the runtime's, not a prompt-comprehension failure.

## Finding

**Runtime absence, twice verified, not a flag artifact and not a moved path.** The Phase-0
conclusion stands and F2's removal was correct. The June 2026 record held at 2.1.175 and no
longer describes 2.1.234; `multi-agent-portability.md` is corrected with a dated
re-verification rather than a deletion, because the older observation may have been true then.

## Consequence for option B

A multi-turn harness built on `claude -p` inherits this blindness **regardless of turn count**.
So option B splits cleanly:

- **Reachable by multi-turn**: the families that died as "ceremony" — L setup
  (`.claude/session-start-sha`, plan file, project README), scope-creep escalation, session-end
  behaviour. These are FS/git residue and tool_use, both already observable; the untested
  hypothesis is whether they failed because of single-turn truncation or because the skill does
  not drive them. Multi-turn is exactly the manipulation that separates those.
- **NOT reachable in `-p`**: every forcing-function family (L-1.6, L-5, H-9, S-scope-gate).
  Reaching those needs a different runtime, and B must establish which one before designing
  around them — not assume one exists.
