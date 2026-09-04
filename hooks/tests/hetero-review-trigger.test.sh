#!/usr/bin/env bash
# hooks/tests/hetero-review-trigger.test.sh — asserts description triggers for hetero-review skill.
#
# Asserts:
# 1. Each of the four owner phrases occurs exactly once across the union of all skills/*/SKILL.md descriptions.
# 2. Each of the four owner phrases occurs exactly once within skills/hetero-review/SKILL.md's description.
# 3. No skills/*/SKILL.md description other than hetero-review's contains the substring "hetero review".
# 4. Includes negative controls to ensure failures trip the test.

. "$(dirname "$0")/lib.sh"

PARSER="$TEST_TMP/parse-frontmatter.js"
cat > "$PARSER" <<'JS'
const fs = require('fs');
const path = require('path');

const skillsDir = process.argv[2];
const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

const descriptions = {};

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
  if (!fs.existsSync(skillFile)) continue;
  const content = fs.readFileSync(skillFile, 'utf8');
  const lines = content.split('\n');
  if (lines[0].trim() !== '---') continue;

  let inFrontmatter = false;
  let inDesc = false;
  let descLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line.trim() === '---') {
      break;
    }
    if (inFrontmatter) {
      if (/^description:\s*(>|\|)?\s*$/.test(line)) {
        inDesc = true;
        descLines = [];
        continue;
      } else if (/^description:\s+(.+)$/.test(line)) {
        inDesc = true;
        const match = line.match(/^description:\s+(.+)$/);
        descLines = [match[1]];
        continue;
      }

      if (inDesc) {
        if (/^[a-zA-Z0-9_-]+:/.test(line)) {
          inDesc = false;
        } else if (/^\s+/.test(line)) {
          descLines.push(line.trim());
        } else if (line.trim() === '') {
          descLines.push('');
        } else {
          inDesc = false;
        }
      }
    }
  }

  descriptions[entry.name] = descLines.join(' ').replace(/\s+/g, ' ').trim();
}

process.stdout.write(JSON.stringify(descriptions, null, 2));
JS

SKILLS_DIR="$REPO_ROOT/skills"
JSON_OUT="$TEST_TMP/descriptions.json"
node "$PARSER" "$SKILLS_DIR" > "$JSON_OUT"

PHRASES=(
  "plan loop review hetero"
  "過 hetero loop review"
  "hetero review"
  "engage hetero engine review"
)

count_occurrences() {
  local haystack="$1"
  local needle="$2"
  node -e "
    const fs = require('fs');
    const h = fs.readFileSync(process.argv[1], 'utf8');
    const n = process.argv[2];
    let count = 0;
    let pos = 0;
    while ((pos = h.indexOf(n, pos)) !== -1) {
      count++;
      pos += n.length;
    }
    process.stdout.write(String(count));
  " "$haystack" "$needle"
}

# 1. Assertions on the real skills
HETERO_DESC="$TEST_TMP/hetero_desc.txt"
node -e "
  const data = JSON.parse(require('fs').readFileSync('$JSON_OUT', 'utf8'));
  process.stdout.write(data['hetero-review'] || '');
" > "$HETERO_DESC"

ALL_DESCS="$TEST_TMP/all_descs.txt"
node -e "
  const data = JSON.parse(require('fs').readFileSync('$JSON_OUT', 'utf8'));
  process.stdout.write(Object.values(data).join('\n---\n'));
" > "$ALL_DESCS"

OTHER_DESCS="$TEST_TMP/other_descs.txt"
node -e "
  const data = JSON.parse(require('fs').readFileSync('$JSON_OUT', 'utf8'));
  delete data['hetero-review'];
  process.stdout.write(Object.values(data).join('\n---\n'));
" > "$OTHER_DESCS"

for phrase in "${PHRASES[@]}"; do
  c_all=$(count_occurrences "$ALL_DESCS" "$phrase")
  assert_eq "$c_all" "1" "phrase '$phrase' must occur exactly once across all skill descriptions"

  c_self=$(count_occurrences "$HETERO_DESC" "$phrase")
  assert_eq "$c_self" "1" "phrase '$phrase' must occur exactly once within hetero-review description"
done

c_other_hetero_review=$(count_occurrences "$OTHER_DESCS" "hetero review")
assert_eq "$c_other_hetero_review" "0" "no skill description other than hetero-review should contain 'hetero review'"

# Negative controls: verify that bad descriptions trigger failures
NEG_TMP="$TEST_TMP/neg-control"
mkdir -p "$NEG_TMP/skills/hetero-review" "$NEG_TMP/skills/other-skill"

cat > "$NEG_TMP/skills/other-skill/SKILL.md" <<'OTHER_EOF'
---
name: other-skill
description: >
  Some description containing hetero review
---
OTHER_EOF

cat > "$NEG_TMP/skills/hetero-review/SKILL.md" <<'HETERO_EOF'
---
name: hetero-review
description: >
  plan loop review hetero and 過 hetero loop review and hetero review and engage hetero engine review
---
HETERO_EOF

node "$PARSER" "$NEG_TMP/skills" > "$NEG_TMP/desc.json"
neg_other="$NEG_TMP/other.txt"
node -e "
  const data = JSON.parse(require('fs').readFileSync('$NEG_TMP/desc.json', 'utf8'));
  delete data['hetero-review'];
  process.stdout.write(Object.values(data).join('\n'));
" > "$neg_other"
neg_count=$(count_occurrences "$neg_other" "hetero review")
if [ "$neg_count" -ne 0 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "negative control: expected other skill containing 'hetero review' to be detected"
fi

cat > "$NEG_TMP/skills/hetero-review/SKILL.md" <<'MISSING_EOF'
---
name: hetero-review
description: >
  only plan loop review hetero
---
MISSING_EOF

node "$PARSER" "$NEG_TMP/skills" > "$NEG_TMP/desc_missing.json"
neg_missing="$NEG_TMP/missing.txt"
node -e "
  const data = JSON.parse(require('fs').readFileSync('$NEG_TMP/desc_missing.json', 'utf8'));
  process.stdout.write(data['hetero-review'] || '');
" > "$neg_missing"
missing_count=$(count_occurrences "$neg_missing" "engage hetero engine review")
if [ "$missing_count" -eq 0 ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "negative control: expected missing phrase in hetero-review to be detected"
fi

finalize_test
