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
         "$SBX/src/engine" \
         "$SBX/hooks/tests" \
         "$SBX/references" \
         "$SBX/skills/ceo-agent/references" \
         "$SBX/skills/dev-flow" \
         "$SBX/skills/quality-pipeline/_base" \
         "$SBX/skills/quality-pipeline/references" \
         "$SBX/skills/dev-flow/references" \
         "$SBX/skills/survey/references" \
         "$SBX/skills/think-tank/references"

cp "$REPO_ROOT/scripts/check-canonical-invariants.sh" "$SBX/scripts/"
# Mirror every seeded file at its real relative path.
cp "$REPO_ROOT/CLAUDE.md"                                              "$SBX/CLAUDE.md"
cp "$REPO_ROOT/agents/reviewer.md"                                    "$SBX/agents/reviewer.md"
cp "$REPO_ROOT/references/blind-dispatch.md"                          "$SBX/references/blind-dispatch.md"
cp "$REPO_ROOT/skills/ceo-agent/references/level-front-door.md"       "$SBX/skills/ceo-agent/references/level-front-door.md"
cp "$REPO_ROOT/skills/quality-pipeline/_base/prohibited-behaviors.md" "$SBX/skills/quality-pipeline/_base/prohibited-behaviors.md"
cp "$REPO_ROOT/skills/quality-pipeline/references/code-review.md"     "$SBX/skills/quality-pipeline/references/code-review.md"
cp "$REPO_ROOT/skills/dev-flow/SKILL.md"                              "$SBX/skills/dev-flow/SKILL.md"
cp "$REPO_ROOT/skills/ceo-agent/SKILL.md"                             "$SBX/skills/ceo-agent/SKILL.md"
cp "$REPO_ROOT/references/model-routing.md"                           "$SBX/references/model-routing.md"
# engine-unavailable error-prefix contract seeds (v2.32.54)
cp "$REPO_ROOT/scripts/dispatch-hetero.sh"                            "$SBX/scripts/dispatch-hetero.sh"
cp "$REPO_ROOT/src/engine/autopilot-engine.js"                        "$SBX/src/engine/autopilot-engine.js"
cp "$REPO_ROOT/hooks/tests/autopilot-engine.test.sh"                  "$SBX/hooks/tests/autopilot-engine.test.sh"
for c in dev-flow quality-pipeline survey think-tank; do
  cp "$REPO_ROOT/references/model-routing.md" "$SBX/skills/$c/references/model-routing.md"
done

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

# 5b. reference negative (superset rename): rename '## Invocation' → '## Invocation Steps'
#     which CONTAINS the old substring — substring-only match would give false EXIT 0.
#     With the -Fx (exact-line) fix this must correctly return EXIT 1.
sed -i 's|^## Invocation$|## Invocation Steps|' "$SBX/skills/quality-pipeline/references/code-review.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "reference-superset-rename exit code"
assert_contains "$OUT" "lost the referenced heading" "reference-superset-rename names the structural break"
cp "$REPO_ROOT/skills/quality-pipeline/references/code-review.md" "$SBX/skills/quality-pipeline/references/code-review.md"

# 5c. mirror negative: hand-edit ONE generated copy → exit 1 naming it + the fix ritual
echo "<!-- hand edit -->" >> "$SBX/skills/survey/references/model-routing.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "mirror-hand-edit exit code"
assert_contains "$OUT" "out of byte-parity" "mirror-hand-edit names the drift"
assert_contains "$OUT" "sync-model-routing.sh" "mirror-hand-edit points at the sync script"
cp "$REPO_ROOT/references/model-routing.md" "$SBX/skills/survey/references/model-routing.md"

# 5d. mirror negative: a copy that is a symlink (even if content-identical) → exit 1
rm "$SBX/skills/survey/references/model-routing.md"
ln -s ../../../references/model-routing.md "$SBX/skills/survey/references/model-routing.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "mirror-symlink exit code"
assert_contains "$OUT" "symlink" "mirror-symlink names the violation"
rm "$SBX/skills/survey/references/model-routing.md"
cp "$REPO_ROOT/references/model-routing.md" "$SBX/skills/survey/references/model-routing.md"

# 5e. lint negative: relative markdown link in the canonical → exit 1
#     (copies resolve ../ at different depths; canonical must stay repo-root-stable)
echo "see [other](../docs/foo.md)" >> "$SBX/references/model-routing.md"
# keep copies byte-equal so ONLY the lint fires, not the mirror check
for c in dev-flow quality-pipeline survey think-tank; do
  cp "$SBX/references/model-routing.md" "$SBX/skills/$c/references/model-routing.md"
done
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "relative-link lint exit code"
assert_contains "$OUT" "relative markdown links" "relative-link lint names the violation"
cp "$REPO_ROOT/references/model-routing.md" "$SBX/references/model-routing.md"
for c in dev-flow quality-pipeline survey think-tank; do
  cp "$REPO_ROOT/references/model-routing.md" "$SBX/skills/$c/references/model-routing.md"
done

# 5b. reader-allowlist (verdict-bytes preservation): a synthetic consumer that reads
# unratified_verdict as authority, placed OUTSIDE the closed allowlist → exit 1
# naming the rogue file (the g1-disposition red proof for the guard itself).
mkdir -p "$SBX/src/engine"
cat > "$SBX/src/engine/rogue-consumer.js" <<'ROGUE'
// synthetic authority leak: promotes salvage data to a verdict
const verdict = result.unratified_verdict || result.verdict;
ROGUE
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "rogue unratified consumer exit code"
assert_contains "$OUT" "reader-allowlist[unratified-columns]" "rogue consumer names the invariant"
assert_contains "$OUT" "src/engine/rogue-consumer.js" "rogue consumer names the offending file"
rm "$SBX/src/engine/rogue-consumer.js"

# 5c. the same content under an allowlisted location (tests) → exit 0 (closed set,
# not a blanket token ban).
mkdir -p "$SBX/hooks/tests"
printf '%s\n' 'assert unratified_verdict fixture' > "$SBX/hooks/tests/vbp-fixture-note.txt"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "allowlisted unratified mention passes"
rm "$SBX/hooks/tests/vbp-fixture-note.txt"

# 6. environment error: a seeded path missing → exit 2 (distinct from a broken invariant)
rm "$SBX/agents/reviewer.md"
OUT="$("$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing-seeded-file exit code (env error, not invariant break)"
assert_contains "$OUT" "does not exist" "missing-seeded-file message"

finalize_test
