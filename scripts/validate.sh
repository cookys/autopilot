#!/usr/bin/env bash
# validate.sh — Validate all skills have correct SKILL.md structure
# Checks: YAML frontmatter, required fields, file references

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/skills"

total=0
passed=0
failed=0
failures=()

for skill_dir in "$SKILLS_DIR"/*/; do
  skill_name="$(basename "$skill_dir")"
  skill_file="$skill_dir/SKILL.md"
  total=$((total + 1))
  errors=()

  # Check SKILL.md exists
  if [[ ! -f "$skill_file" ]]; then
    errors+=("SKILL.md not found")
  else
    # Check YAML frontmatter starts with ---
    first_line="$(head -1 "$skill_file")"
    if [[ "$first_line" != "---" ]]; then
      errors+=("missing YAML frontmatter (first line is not ---)")
    else
      # Extract frontmatter (between first and second ---)
      frontmatter="$(awk 'NR==1{next} /^---$/{exit} {print}' "$skill_file")"

      # Check name: field
      if ! echo "$frontmatter" | grep -q '^name:'; then
        errors+=("missing 'name:' field in frontmatter")
      fi

      # Check description: field
      if ! echo "$frontmatter" | grep -q '^description:'; then
        errors+=("missing 'description:' field in frontmatter")
      fi
    fi

    # Check file references exist
    # Look for references like `references/foo.md` or references/foo.md in the content
    while IFS= read -r ref; do
      ref_path="$skill_dir/$ref"
      if [[ ! -f "$ref_path" ]]; then
        errors+=("referenced file not found: $ref")
      fi
    done < <(grep -oP '(?:references/[a-zA-Z0-9_.-]+(?:\.[a-zA-Z]+)?)' "$skill_file" 2>/dev/null | sort -u)
  fi

  if [[ ${#errors[@]} -eq 0 ]]; then
    passed=$((passed + 1))
    echo "  PASS  $skill_name"
  else
    failed=$((failed + 1))
    echo "  FAIL  $skill_name"
    for err in "${errors[@]}"; do
      echo "        - $err"
    done
    failures+=("$skill_name")
  fi
done

echo ""
echo "Summary: $total skills found, $passed passed, $failed failed"

if [[ $failed -gt 0 ]]; then
  echo "Failed skills: ${failures[*]}"
  exit 1
fi

echo "All skills valid."
exit 0
