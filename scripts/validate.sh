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

    # Check markdown links resolve — across SKILL.md AND every skill-local .md
    # doc (references/, _base/, …). Each `[text](path.md)` link (anchor stripped)
    # must resolve relative to the containing file OR the repo root. Catches the
    # patterns the old SKILL.md-only / `references/`-prefix-only check missed:
    # `../_base/x.md`, doubled `references/references/x.md`, links inside ref files.
    # Skips http(s)/mailto and pure-anchor links. Links with a title
    # (`](x.md "t")`) are not matched and therefore not checked.
    while IFS= read -r md_file; do
      file_dir="$(dirname "$md_file")"
      while IFS= read -r link; do
        target="${link%%#*}"          # strip #anchor
        [[ -z "$target" ]] && continue
        case "$target" in
          http://*|https://*|mailto:*) continue ;;
        esac
        # The filesystem resolves `..`, so no realpath needed (portable).
        if [[ ! -f "$file_dir/$target" && ! -f "$ROOT_DIR/$target" ]]; then
          rel="${md_file#"$ROOT_DIR"/}"
          errors+=("broken link in $rel: $link")
        fi
      done < <(awk '/^[[:space:]]*```/{f=!f; next} !f' "$md_file" 2>/dev/null | grep -oE '\]\([^)]+\.md(#[^)]*)?\)' | sed -E 's/^\]\(//; s/\)$//' | sort -u)
    done < <(find "$skill_dir" -name '*.md' 2>/dev/null)
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
