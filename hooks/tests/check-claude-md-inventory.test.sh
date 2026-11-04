#!/usr/bin/env bash
# check-claude-md-inventory.js test — membership + size-cap gate.
#
# Sandbox pattern (the script resolves REPO via dirname/.. → the sandbox): copy the
# script into a mirror tree with minimal fixtures, then mutate copies for negatives.
# BL-0383 (option A): the script NAME LIST lives in scripts/CLAUDE.md, so membership is read
# there; the root CLAUDE.md and AGENTS.md are entry docs held to a 10,240-byte cap each. The size cases encode the 2026-07 lesson: release commits appending
# per-version notes to inventory rows grew CLAUDE.md 11KB → 81KB with no gate.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX/scripts/lib"
cp "$REPO_ROOT/scripts/check-claude-md-inventory.js" "$SBX/scripts/"
cp "$REPO_ROOT/scripts/lib/repo-layout.js" "$SBX/scripts/lib/"
SCRIPT="$SBX/scripts/check-claude-md-inventory.js"

write_fixture() {
  # F5: the inventory file must exist (a missing one is red), and name every script in the sandbox.
  INV_REL="$(layout_path scripts_inventory_doc)"
  mkdir -p "$SBX/$(dirname "$INV_REL")"
  printf 'check-claude-md-inventory.js\nrepo-layout.js\n' > "$SBX/$INV_REL"
  printf '# root fixture\n' > "$SBX/CLAUDE.md"
  printf '# agents fixture\n' > "$SBX/AGENTS.md"
  cat > "$SBX/scripts/CLAUDE.md" <<'EOF'
# fixture

| Script | Purpose |
|--------|---------|
| check-claude-md-inventory.js | membership + size gate. |
| lib/repo-layout.js | layout registry the gate reads. |
EOF
}
write_fixture

# 1. clean sandbox → exit 0, reports counts
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "clean sandbox exit 0"
assert_contains "$OUT" "all 2 scripts named" "clean sandbox reports membership"
assert_contains "$OUT" "bytes" "clean sandbox reports size"

# 2. --help → exit 0
node "$SCRIPT" --help >/dev/null 2>&1
assert_eq "0" "$?" "--help exit 0"

# 3. unknown arg → exit 2
node "$SCRIPT" --bogus >/dev/null 2>&1
assert_eq "2" "$?" "unknown arg exit 2"

# 4. unlisted script planted → exit 1, named in output (scripts/ and scripts/lib/)
touch "$SBX/scripts/planted-unlisted.sh" "$SBX/scripts/lib/planted-lib.js"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "unlisted scripts exit 1"
assert_contains "$OUT" "scripts/planted-unlisted.sh" "names the unlisted script"
assert_contains "$OUT" "scripts/lib/planted-lib.js" "names the unlisted lib file"
rm "$SBX/scripts/planted-unlisted.sh" "$SBX/scripts/lib/planted-lib.js"

# 5. test files are exempt from membership
touch "$SBX/scripts/something.test.sh"
node "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "*.test.sh exempt from membership"
rm "$SBX/scripts/something.test.sh"

# 6. per-line byte cap: an 900-byte ASCII line → exit 1 naming the line
write_fixture
printf '| fat-row | %s |\n' "$(head -c 880 /dev/zero | tr '\0' 'x')" >> "$SBX/scripts/CLAUDE.md"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "over-cap line exit 1"
assert_contains "$OUT" "line cap" "reports the line cap"
assert_contains "$OUT" "CHANGELOG.md" "fix hint points history to CHANGELOG"

# 7. cap measures BYTES not chars: 300 CJK chars ≈ 900 bytes but < 800 chars
write_fixture
CJK_LINE="$(python3 -c "print('版' * 300)" 2>/dev/null || node -e "console.log('版'.repeat(300))")"
printf '%s\n' "$CJK_LINE" >> "$SBX/scripts/CLAUDE.md"
node "$SCRIPT" >/dev/null 2>&1
assert_eq "1" "$?" "multibyte line measured in bytes"

# 8. --max-line-bytes override lets the same fixture pass
node "$SCRIPT" --max-line-bytes 2000 >/dev/null 2>&1
assert_eq "0" "$?" "--max-line-bytes override honored"

# 9. whole-file cap via --max-total-bytes override → exit 1
write_fixture
OUT="$(node "$SCRIPT" --max-total-bytes 10 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "total-byte cap exit 1"
assert_contains "$OUT" "exceeds" "reports the total cap"

# 10. --json shape: ok/missing/total_bytes/long_lines present and coherent
OUT="$(node "$SCRIPT" --json 2>&1)"
assert_contains "$OUT" '"ok":true' "json clean ok:true"
assert_contains "$OUT" '"missing":[]' "json clean missing empty"
assert_contains "$OUT" '"long_lines":[]' "json clean long_lines empty"
printf '| fat-row | %s |\n' "$(head -c 880 /dev/zero | tr '\0' 'x')" >> "$SBX/scripts/CLAUDE.md"
OUT="$(node "$SCRIPT" --json 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "json violation exit 1"
assert_contains "$OUT" '"ok":false' "json violation ok:false"
assert_contains "$OUT" '"long_lines":[{"file":' "json violation long_lines populated"

# 11. --max-total-bytes rejects garbage → exit 2
node "$SCRIPT" --max-total-bytes banana >/dev/null 2>&1
assert_eq "2" "$?" "non-numeric cap exit 2"

# 12. the REAL repo passes the shipped defaults (regression anchor)
node "$REPO_ROOT/scripts/check-claude-md-inventory.js" >/dev/null 2>&1
assert_eq "0" "$?" "real repo passes default caps"

# 13. BL-0383 negative control: the name list is read from scripts/CLAUDE.md, NOT the root file.
#     A script named only in the root CLAUDE.md is still unlisted -> red; restore -> green.
write_fixture
touch "$SBX/scripts/only-in-root.sh"
printf 'only-in-root.sh\n' >> "$SBX/CLAUDE.md"
printf 'only-in-root.sh\n' >> "$SBX/$(layout_path scripts_inventory_doc)"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "name only in root CLAUDE.md is red (gate reads scripts/CLAUDE.md)"
assert_contains "$OUT" "scripts/only-in-root.sh" "names the script missing from scripts/CLAUDE.md"
assert_contains "$OUT" "scripts/CLAUDE.md" "fix hint names scripts/CLAUDE.md"
printf 'only-in-root.sh\n' >> "$SBX/scripts/CLAUDE.md"
node "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "listed in scripts/CLAUDE.md -> green again"
rm "$SBX/scripts/only-in-root.sh"

# 14. BL-0383 root CLAUDE.md cap (10,240 bytes): over -> red, --max-root-bytes override -> green
write_fixture
head -c 10300 /dev/zero | tr '\0' 'x' | fold -w 200 >> "$SBX/CLAUDE.md"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "root CLAUDE.md over 10240 bytes exit 1"
assert_contains "$OUT" "root CLAUDE.md size" "reports the root CLAUDE.md cap"
node "$SCRIPT" --max-root-bytes 20000 >/dev/null 2>&1
assert_eq "0" "$?" "--max-root-bytes override honored"
write_fixture
node "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "root CLAUDE.md restored -> green"

# 15. BL-0383 root AGENTS.md cap (10,240 bytes): over -> red, --max-agents-bytes override -> green
head -c 10300 /dev/zero | tr '\0' 'x' | fold -w 200 >> "$SBX/AGENTS.md"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "root AGENTS.md over 10240 bytes exit 1"
assert_contains "$OUT" "root AGENTS.md size" "reports the root AGENTS.md cap"
node "$SCRIPT" --max-agents-bytes 20000 >/dev/null 2>&1
assert_eq "0" "$?" "--max-agents-bytes override honored"
write_fixture
node "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "root AGENTS.md restored -> green"

# 16. a missing scripts/CLAUDE.md is an env error (exit 2), not a silent pass
mv "$SBX/scripts/CLAUDE.md" "$SBX/scripts/CLAUDE.md.away"
node "$SCRIPT" >/dev/null 2>&1
assert_eq "2" "$?" "missing scripts/CLAUDE.md exit 2"
mv "$SBX/scripts/CLAUDE.md.away" "$SBX/scripts/CLAUDE.md"

finalize_test
