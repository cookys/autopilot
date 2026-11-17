# P3 probe — PostToolUse output replacement for Bash

Date: 2026-11-17 (Taipei). Claude Code 2.1.326, `claude -p --model claude-haiku-5-5`, throwaway CLAUDE_CONFIG_DIR holding only `.credentials.json`, hooks supplied via `--settings`. Prompt: run `echo ORIGINAL-OUTPUT-91c2` and echo the tool result. Evidence read from the `tool_result` block of `--output-format stream-json`.

| Arm | Hook | tool_result seen by the model |
|---|---|---|
| A | PostToolUse Bash, `updatedToolOutput: "<string>"` | `ORIGINAL-OUTPUT-91c2` — **not replaced** |
| B | PostToolUse Bash, `updatedToolOutput: {...tool_response, stdout: "<text>"}` | `PROBE-REPLACED-OBJ-7f3a` — replaced |
| C | PreToolUse Bash, `updatedInput.command` rewritten to `( <cmd>\n) > /dev/null 2>&1; rc=$?; echo …; exit $rc` | `PROBE-REWRITTEN-PRE-7f3a` — replaced |

Bash `tool_response` keys at PostToolUse: `stdout, stderr, interrupted, isImage, noOutputExpected`.

Decision: Bash stays on PostToolUse and returns `updatedToolOutput` as an object with the same keys as `tool_response` (arm B); the PreToolUse fallback (arm C) is not needed. MCP stays on PostToolUse `updatedMCPToolOutput` (not probed here).
