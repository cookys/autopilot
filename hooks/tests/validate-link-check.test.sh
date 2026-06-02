#!/usr/bin/env bash
# scripts/validate.sh link-check (L2): the validator must flag broken relative
# markdown links inside SKILL.md AND skill-local reference docs, while ignoring
# links that appear inside fenced code blocks (templates/examples).
#
# Regression guard for the level-3 doc-rot batch: the original validator scanned
# only SKILL.md with a `references/`-prefix-only regex, so broken `../_base/x.md`
# and doubled `references/references/x.md` links shipped undetected.
. "$(dirname "$0")/lib.sh"

# Build a self-contained sandbox repo so validate.sh (ROOT_DIR = scripts/..)
# scans the fixtures, not the live skills/ tree.
SANDBOX="$TEST_TMP/repo"
mkdir -p "$SANDBOX/scripts" "$SANDBOX/skills/good/references"
cp "$REPO_ROOT/scripts/validate.sh" "$SANDBOX/scripts/validate.sh"

# --- good skill: valid sibling link + a fenced-code placeholder (must be ignored) ---
cat > "$SANDBOX/skills/good/SKILL.md" <<'EOF'
---
name: good
description: valid links plus a fenced placeholder that must not be validated
---
See [the ref](references/real.md).

```markdown
[plan](../../plans/YYYY-MM-DD-<name>.md)   # example placeholder, not a real link
```
EOF
echo "# real" > "$SANDBOX/skills/good/references/real.md"

run_one() { ( cd "$SANDBOX" && bash scripts/validate.sh >"$TEST_TMP/out" 2>&1; echo $? > "$TEST_TMP/code" ); }

# Case 1: good-only → exit 0, placeholder NOT flagged.
run_one
GOOD_CODE=$(cat "$TEST_TMP/code"); GOOD_OUT=$(cat "$TEST_TMP/out")
assert_exit_code "$GOOD_CODE" 0 "clean fixtures pass"
assert_not_contains "$GOOD_OUT" "YYYY-MM-DD" "fenced-code placeholder is ignored"

# --- bad skill: a real (non-fenced) broken link in a reference doc ---
mkdir -p "$SANDBOX/skills/bad/references"
cat > "$SANDBOX/skills/bad/SKILL.md" <<'EOF'
---
name: bad
description: has a broken link in a reference doc
---
Body. See [policy](references/policy.md).
EOF
cat > "$SANDBOX/skills/bad/references/policy.md" <<'EOF'
# policy
> Full list: [missing](../_base/ghost.md)
EOF

# Case 2: broken link in a *reference* file → exit 1 + named.
run_one
BAD_CODE=$(cat "$TEST_TMP/code"); BAD_OUT=$(cat "$TEST_TMP/out")
assert_exit_code "$BAD_CODE" 1 "broken link fails validation"
assert_contains "$BAD_OUT" "broken link" "broken link is reported"
assert_contains "$BAD_OUT" "../_base/ghost.md" "the offending link is named"
assert_contains "$BAD_OUT" "policy.md" "reports the containing reference file, not just SKILL.md"

finalize_test
