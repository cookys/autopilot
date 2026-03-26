#!/usr/bin/env bash
# Autopilot SessionStart hook — inject lifecycle skill awareness.
# stdout is added as context for Claude (exit code 0 = context injection).
#
# If Superpowers is also installed, its hook handles "check skills before
# responding." This hook adds Autopilot-specific routing so the model knows
# WHICH lifecycle skill to use. The two are complementary, not redundant.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Build the context string
read -r -d '' CONTEXT << 'CONTEXT_EOF' || true
You have **Autopilot** lifecycle skills. Before starting any task, check if one applies:

| Trigger | Skill |
|---------|-------|
| Starting code work, "I'm working on X", quick fix, hotfix, continuing from yesterday | `autopilot:dev-flow` |
| Research options, "what do others use", compare X vs Y, 業界怎麼做 | `autopilot:survey` |
| Strategic decision, need perspectives, tradeoff analysis, 要辯論一下 | `autopilot:think-tank` |
| Full delegation, "get it done", CEO mode, 搞定, 全權處理 | `autopilot:ceo-agent` |
| Pre-commit/merge quality checks, "is this ready?" | `autopilot:quality-pipeline` |
| Archive project, bootstrap from plan, set up tracking | `autopilot:project-lifecycle` |
| Save a lesson, "record this", knowledge audit | `autopilot:learn` |
| Retrospective, commit history analysis, 回顧 | `autopilot:retro` |
| What to work on next, /next, highest priority | `autopilot:next` |
| Compare two implementations, feature parity check | `autopilot:audit` |

If uncertain, invoke the skill — it will guide you. Autopilot sets rules; Superpowers executes.
CONTEXT_EOF

# Escape for JSON
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

ESCAPED=$(escape_for_json "$CONTEXT")

# Output JSON for Claude Code context injection
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$ESCAPED"
else
    printf '{\n  "additional_context": "%s"\n}\n' "$ESCAPED"
fi

exit 0
