#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

COUNT="$(find "$REPO_ROOT/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"

CANON="$(cat "$REPO_ROOT/.claude-plugin/plugin.json")"
ROOT_PLUGIN="$(cat "$REPO_ROOT/plugin.json")"
MARKETPLACE="$(cat "$REPO_ROOT/.claude-plugin/marketplace.json")"
README_EN="$(cat "$REPO_ROOT/README.md")"
README_ZH="$(cat "$REPO_ROOT/README.zh-TW.md")"
SKILLS_DOC="$(cat "$REPO_ROOT/docs/skills.md")"
ARCH_DOC="$(cat "$REPO_ROOT/docs/architecture.md")"
HERO="$(cat "$REPO_ROOT/docs/assets/hero.svg")"
AGENTS_DOC="$(cat "$REPO_ROOT/AGENTS.md")"
CLAUDE_DOC="$(cat "$REPO_ROOT/CLAUDE.md")"

assert_contains "$CANON" "${COUNT} lifecycle skills" "canonical plugin skill count matches skills directory"
assert_contains "$ROOT_PLUGIN" "${COUNT} lifecycle skills" "root plugin skill count matches skills directory"
assert_contains "$MARKETPLACE" "${COUNT} skills + 3 methodology agents" "marketplace skill count matches skills directory"

assert_contains "$README_EN" "skills-${COUNT}-" "English README badge count matches skills directory"
assert_contains "$README_EN" "${COUNT} skills" "English README body count matches skills directory"
assert_contains "$README_ZH" "skills-${COUNT}-" "zh-TW README badge count matches skills directory"
assert_contains "$README_ZH" "${COUNT} 個 skill" "zh-TW README body count matches skills directory"

assert_contains "$SKILLS_DOC" "all ${COUNT} skills" "skills doc overview count matches skills directory"
assert_contains "$SKILLS_DOC" "ships **${COUNT} skills**" "skills doc shipped count matches skills directory"
assert_contains "$ARCH_DOC" "Why ${COUNT} skills" "architecture heading count matches skills directory"
assert_contains "$ARCH_DOC" "all ${COUNT} skills" "architecture body count matches skills directory"
assert_contains "$HERO" "${COUNT} skills" "hero SVG skill count matches skills directory"
assert_contains "$AGENTS_DOC" "${COUNT} lifecycle/methodology skills" "AGENTS.md skill count matches skills directory"
assert_contains "$CLAUDE_DOC" "${COUNT} skills, 3 methodology agents" "CLAUDE.md skill count matches skills directory"

for stale in 24 26; do
  [ "$stale" = "$COUNT" ] && continue
  assert_not_contains "$CANON" "${stale} lifecycle skills" "canonical plugin has no stale skill-count fragment $stale"
  assert_not_contains "$ROOT_PLUGIN" "${stale} lifecycle skills" "root plugin has no stale skill-count fragment $stale"
  assert_not_contains "$MARKETPLACE" "${stale} skills + 3 methodology agents" "marketplace has no stale skill-count fragment $stale"
  assert_not_contains "$README_EN" "skills-${stale}-" "English README badge has no stale skill-count $stale"
  assert_not_contains "$README_ZH" "skills-${stale}-" "zh-TW README badge has no stale skill-count $stale"
  assert_not_contains "$SKILLS_DOC" "all ${stale} skills" "skills doc overview has no stale skill-count $stale"
  assert_not_contains "$SKILLS_DOC" "ships **${stale} skills**" "skills doc shipped count has no stale skill-count $stale"
  assert_not_contains "$ARCH_DOC" "Why ${stale} skills" "architecture heading has no stale skill-count $stale"
  assert_not_contains "$ARCH_DOC" "all ${stale} skills" "architecture body has no stale skill-count $stale"
  assert_not_contains "$HERO" "${stale} skills" "hero SVG has no stale skill-count $stale"
  assert_not_contains "$AGENTS_DOC" "${stale} lifecycle/methodology skills" "AGENTS.md has no stale skill-count $stale"
  assert_not_contains "$CLAUDE_DOC" "${stale} skills, 3 methodology agents" "CLAUDE.md has no stale skill-count $stale"
done

finalize_test
