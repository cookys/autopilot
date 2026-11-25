#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL_FILE="$REPO_ROOT/skills/handoff/SKILL.md"

if [[ ! -f "$SKILL_FILE" ]]; then
  echo "FAIL: $SKILL_FILE not found" >&2
  exit 1
fi

if grep -qi "auto-compact restores" "$SKILL_FILE"; then
  echo "FAIL: $SKILL_FILE still contains 'auto-compact restores'" >&2
  exit 1
fi

if ! grep -q "## 接續表" "$SKILL_FILE"; then
  echo "FAIL: $SKILL_FILE missing '## 接續表'" >&2
  exit 1
fi

for key in operator_thread artifacts pending_rulings subagent_outputs card_notes executor; do
  if ! grep -q "$key" "$SKILL_FILE"; then
    echo "FAIL: $SKILL_FILE missing key '$key'" >&2
    exit 1
  fi
done

echo "PASS: handoff skill continuation table and no auto-compact restores"
