#!/usr/bin/env bash
# fleet-usage-smoke — repo carries a vendored fleet-usage skill and documents harness coverage.
# No real fleet CLI/MCP calls; grep-only assertions on the skill file and guide inventory row.
. "$(dirname "$0")/lib.sh"

SKILL="$REPO_ROOT/skills/fleet-usage/SKILL.md"
GUIDE="$REPO_ROOT/docs/guide/fleet-usage-by-harness.md"
INV="$REPO_ROOT/docs/guide/skills.md"

assert_file_exists "$SKILL" "skills/fleet-usage/SKILL.md exists"

body="$(cat "$SKILL")"
assert_contains "$body" "fleet watch" "fleet-usage skill documents fleet watch"
assert_contains "$body" "upload" "fleet-usage skill documents upload"
assert_contains "$body" "fetch" "fleet-usage skill documents fetch"
assert_contains "$body" "task_result" "fleet-usage skill documents task_result"

first="$(head -1 "$SKILL")"
assert_eq "---" "$first" "fleet-usage SKILL.md has YAML frontmatter"
fm="$(awk 'NR==1{next} /^---$/{exit} {print}' "$SKILL")"
assert_contains "$fm" "name: fleet-usage" "frontmatter names fleet-usage"
assert_contains "$fm" "description:" "frontmatter has description"

assert_file_exists "$GUIDE" "fleet-usage-by-harness guide exists"
guide="$(cat "$GUIDE")"
assert_contains "$guide" "skills/fleet-usage" "harness guide names the shared skill path"
assert_contains "$guide" "Claude Code" "harness guide lists Claude Code"
assert_contains "$guide" "codex" "harness guide lists codex"

assert_contains "$(cat "$INV")" "fleet-usage" "skills catalog inventory lists fleet-usage"

finalize_test