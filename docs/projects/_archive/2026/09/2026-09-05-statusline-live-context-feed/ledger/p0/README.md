# P0 spike — real payloads and the id mapping (2026-09-05, aimax395, CC 2.1.260)

Method: `~/.claude/settings.json` `statusLine.command` → `sl-tee.sh` (tee stdin to tmpfs, exec `codeforge statusline`),
`subagentStatusLine.command` → `sub-tee.sh` (tee, print nothing), plus a throwaway PreToolUse `Bash|Read` hook
`hook-dump.sh` that saves the first payload carrying `agent_id`. One sonnet probe subagent ran two Bash calls and a
Read. Settings restored from `settings.json.bak` afterwards (verified: statusLine back to `codeforge statusline`,
no subagentStatusLine, zero PreToolUse entries in settings.json).

## Ruling: `tasks[].id` == hook `agent_id`

| Source | Field | Value |
|---|---|---|
| `subagent.json` | `tasks[0].id` | `a9c9b5673eb39f842` |
| `hook.json` | `agent_id` | `a9c9b5673eb39f842` |

Exact string equality. `foreman-guard.js` matches its row by `tasks[].id === payload.agent_id`; the `(model, cwd,
startTime)` fallback stays in the schema but is not needed on this CC version. Ambiguity rule from the plan
(0 or ≥ 2 rows ⇒ fail-open + diagnostic) still applies.

## Other facts pinned by the payloads

- Status line stdin carries the base hook fields: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`,
  `effort`, plus `model.id` (`claude-fable-5-1`), `version` (`2.1.260`), `context_window` with
  `context_window_size: 1000000`, `used_percentage: 26`, `total_input_tokens: 260633`, `current_usage{…}`,
  `exceeds_200k_tokens`, `prompt_cache`, `fast_mode`, `thinking`, `rate_limits` (redacted here), `cost` (redacted).
- Subagent status line stdin: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `columns`, `tasks[]`.
  Task row fields observed: `id, type ("local_agent"), status, description, label, startTime (ms epoch), model
  ("claude-sonnet-5"), contextWindowSize (1000000 — the subagent inherited the 1M window), tokenCount, tokenSamples[], cwd`.
  No `name` field on this version (plan schema lists it as optional; writer copies what exists).
- Hook stdin (subagent fire): `session_id` is the PARENT's, `transcript_path` is the parent's file, `agent_id`,
  `agent_type` ("general-purpose"). Confirms the v2.35.15 limitation the plan cites.
- Depth-0 at capture time: 260k of 1M (26%) — the very session whose `context-budget` fired T2 at 153k and 180k.

Files: `statusline.json`, `subagent.json`, `hook.json` (redacted copies), `sl-tee.sh`, `sub-tee.sh`, `hook-dump.sh`.
