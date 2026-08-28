# 2026-08-28 — Foreman must not poll

Status: **implemented on `feat/foreman-no-polling`** (not merged).

## Background

revival.3d session `5ca9b104` cost split: 30 opus foremen, 28 of them spent more
than all their sonnet leaves combined (foremen 227M vs leaves 130M). Tool mix
3971 Bash / 337 Edit. Bash is almost entirely `sleep 240` loops plus
`cat <leaf>.output` fed back into the foreman context. Every wake is a full-price
inference on a 200–500k prompt.

BACKLOG 2026-08-28 item 1 (P1). Item 2 (implementer ladder) is a sibling branch.

## Spec

1. Hard rule (identical sentence) on `skills/l4`, `skills/l5`, `skills/l6`: wait
   on leaves only via `run_in_background` / child-Agent task-notification, then
   end the turn. Forbidden: `sleep` loops; `cat`/`tail` of leaf output into own
   context (schema criteria tables only); Monitor to wait on a leaf; Bash > 40.
2. Rewrite `level-front-door.md` sites that taught `Monitor(sleep …)` and
   snapshot/directive poll loops: deadline = one-shot `Bash(run_in_background)`;
   `directive-poll` once at a stage boundary.
3. Gate `scripts/check-foreman-polling.js` over one or more transcripts.
4. Depth-0 harvest: red transcript ⇒ do not merge
   (`skills/l6/references/full-dispatch-pipeline.md` step 7).

## Gate criteria (any one is RED)

| Id | Condition |
|----|-----------|
| a | ≥ 3 Bash calls containing `sleep N` with N ≥ 30 |
| b | any `cat` / `tail` / `sed -n` / `head` whose target path contains `/tasks/` and ends in `.output` |
| c | Bash tool_use count > 40 |

Stdout JSON `{file, verdict, reasons[], counts}`. Exit 1 if any file is RED.
`--self-test` uses in-process fixtures (never copies revival.3d samples into the
repo).

## Out of scope

- Workflow-script canonical foreman (BACKLOG still allows it as a later shape).
- Implementer ladder (sibling worktree `.worktrees/ag-impl-ladder`).
- Monitor-tool detection (gate is Bash-only; the skill text forbids Monitor wait).
