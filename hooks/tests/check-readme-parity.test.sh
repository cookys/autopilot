#!/usr/bin/env bash
# check-readme-parity.js test — green path + badge / section-count drift detection.
#
# The script resolves REPO from its own location (dirname/..), so to exercise
# negative cases WITHOUT mutating the live repo we copy the script into a sandbox
# at sandbox/scripts/ and mirror the two READMEs at the same relative paths. The
# sandbox copy then reads/judges the sandbox files.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX/scripts"
cp "$REPO_ROOT/scripts/check-readme-parity.js" "$SBX/scripts/"
cp "$REPO_ROOT/README.md"       "$SBX/README.md"
cp "$REPO_ROOT/README.zh-TW.md" "$SBX/README.zh-TW.md"

SCRIPT="$SBX/scripts/check-readme-parity.js"
restore() { cp "$REPO_ROOT/$1" "$SBX/$1"; }

# 1. clean mirror → exit 0 (positive)
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "clean parity exit 0"
assert_contains "$OUT" "in parity" "clean mirror reports parity"

# 2. --help → exit 0
node "$SCRIPT" --help >/dev/null 2>&1
assert_eq "0" "$?" "--help exit 0"

# 3. badge VALUE drift: zh-TW skills badge falls behind EN (the original 20→16 regression
# class). Wildcard the current count so the negative case self-maintains across count bumps
# (a hardcoded old count silently no-ops the drift injection — caught at v2.21.0, skills 20→23).
sed -i -E 's#badge/skills-[0-9]+-#badge/skills-0-#' "$SBX/README.zh-TW.md"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "skills badge drift exit 1"
assert_contains "$OUT" "skills" "badge drift names the skills badge"
restore "README.zh-TW.md"

# 4. badge MISSING in one file (rename the hooks badge in zh only).
# Count-agnostic (the hooks count changes over releases — a hardcoded `hooks-20`
# silently no-ops this drift injection once the real badge moves, the same trap the
# skills-drift case above guards against; hooks 20→21 at v2.25.14 hit exactly this).
sed -i -E 's#badge/hooks-([0-9]+)-#badge/HOOKSGONE-\1-#' "$SBX/README.zh-TW.md"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "missing-badge exit 1"
assert_contains "$OUT" "hooks" "missing badge is named"
restore "README.zh-TW.md"

# 5. SECTION-count drift: a ## header exists in one file only
printf '\n## Extra Section\n' >> "$SBX/README.zh-TW.md"
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "section-count drift exit 1"
assert_contains "$OUT" "section count" "section drift names the check"
restore "README.zh-TW.md"

# 6. post-restore clean re-check → exit 0 (restores held)
node "$SCRIPT" >/dev/null 2>&1
assert_eq "0" "$?" "post-restore clean exit 0"

finalize_test
