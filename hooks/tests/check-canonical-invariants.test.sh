#!/usr/bin/env bash
# check-canonical-invariants.sh test — negative + positive cases for both modes.
#
# The script resolves REPO from its own location (dirname/..), so to exercise
# negative cases WITHOUT mutating the live repo we copy the script into a sandbox
# at sandbox/scripts/ and mirror the seeded files at the same relative paths. The
# sandbox copy then reads/judges the sandbox files.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX/scripts" \
         "$SBX/agents" \
         "$SBX/references" \
         "$SBX/skills/quality-pipeline/_base" \
         "$SBX/skills/quality-pipeline/references"

cp "$REPO_ROOT/scripts/check-canonical-invariants.sh" "$SBX/scripts/"
# Mirror every seeded file at its real relative path.
cp "$REPO_ROOT/CLAUDE.md"                                              "$SBX/CLAUDE.md"
cp "$REPO_ROOT/agents/reviewer.md"                                    "$SBX/agents/reviewer.md"
cp "$REPO_ROOT/references/blind-dispatch.md"                          "$SBX/references/blind-dispatch.md"
cp "$REPO_ROOT/skills/quality-pipeline/_base/prohibited-behaviors.md" "$SBX/skills/quality-pipeline/_base/prohibited-behaviors.md"
cp "$REPO_ROOT/skills/quality-pipeline/references/code-review.md"     "$SBX/skills/quality-pipeline/references/code-review.md"

SCRIPT="$SBX/scripts/check-canonical-invariants.sh"
SEVERITY="🔴 Critical / 🟠 Major / 🟡 Minor / 🔵 Suggestion"

# 1. aligned tree → exit 0 (positive)
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "aligned tree exit code"
assert_contains "$OUT" "all canonical invariants hold" "aligned tree message"

# 2. --help exits 0 and mentions the ritual
HELP="$("$SCRIPT" --help 2>&1)"; HEXIT=$?
assert_eq "0" "$HEXIT" "--help exit code"
assert_contains "$HELP" "SAME-COMMIT UPDATE RITUAL" "--help documents the update ritual"

# 3. repeat negative: delete the severity phrase from ONE listed file → exit 1 naming it
#    (use a fresh sandbox copy of just that file)
grep -vF -- "$SEVERITY" "$SBX/agents/reviewer.md" > "$SBX/agents/reviewer.md.tmp"
mv "$SBX/agents/reviewer.md.tmp" "$SBX/agents/reviewer.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "repeat-delete exit code"
assert_contains "$OUT" "agents/reviewer.md" "repeat-delete names the offending file"
assert_contains "$OUT" "severity-vocab" "repeat-delete names the invariant label"
# restore
cp "$REPO_ROOT/agents/reviewer.md" "$SBX/agents/reviewer.md"

# 4. same-commit reword ritual: change the phrase in BOTH the seed AND every file →
#    exit 0 (proves the false-positive ritual works, not just blind matching).
NEWPHRASE="🔴 Crit / 🟠 Maj / 🟡 Min / 🔵 Sugg"
for f in CLAUDE.md agents/reviewer.md references/blind-dispatch.md \
         skills/quality-pipeline/_base/prohibited-behaviors.md \
         skills/quality-pipeline/references/code-review.md; do
  sed -i "s|$SEVERITY|$NEWPHRASE|g" "$SBX/$f"
done
# update the inline seed in the sandbox script copy (the "same commit" seed edit)
sed -i "s|$SEVERITY|$NEWPHRASE|g" "$SCRIPT"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "reword+seed-update (same-commit ritual) exit code"
assert_contains "$OUT" "all canonical invariants hold" "reword+seed-update passes"
# restore script + files for the reference-mode cases
cp "$REPO_ROOT/scripts/check-canonical-invariants.sh" "$SCRIPT"
cp "$REPO_ROOT/agents/reviewer.md"                                "$SBX/agents/reviewer.md"
cp "$REPO_ROOT/skills/quality-pipeline/references/code-review.md" "$SBX/skills/quality-pipeline/references/code-review.md"
cp "$REPO_ROOT/CLAUDE.md"                                         "$SBX/CLAUDE.md"
cp "$REPO_ROOT/references/blind-dispatch.md"                      "$SBX/references/blind-dispatch.md"
cp "$REPO_ROOT/skills/quality-pipeline/_base/prohibited-behaviors.md" "$SBX/skills/quality-pipeline/_base/prohibited-behaviors.md"

# 5. reference negative: rename '## Invocation' heading in code-review.md WITHOUT
#    touching reviewer.md → exit 1 (structural anchor break, correct direction)
sed -i 's|^## Invocation|## Dispatch|' "$SBX/skills/quality-pipeline/references/code-review.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "reference-rename exit code"
assert_contains "$OUT" "lost the referenced heading" "reference-rename names the structural break"
cp "$REPO_ROOT/skills/quality-pipeline/references/code-review.md" "$SBX/skills/quality-pipeline/references/code-review.md"

# 6. environment error: a seeded path missing → exit 2 (distinct from a broken invariant)
rm "$SBX/agents/reviewer.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing-seeded-file exit code (env error, not invariant break)"
assert_contains "$OUT" "does not exist" "missing-seeded-file message"

finalize_test
