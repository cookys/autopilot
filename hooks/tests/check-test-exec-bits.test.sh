#!/usr/bin/env bash
# check-test-exec-bits.test.sh — contract + negative-control suite for scripts/check-test-exec-bits.js.
# RED before scripts/check-test-exec-bits.js exists: node fails with MODULE_NOT_FOUND (rc != 0).

TEST_NAME="check-test-exec-bits"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID

SRC="$REPO_ROOT/scripts/check-test-exec-bits.js"
assert_file_exists "$SRC" "scripts/check-test-exec-bits.js exists"

# 1. Real repository tracked suites are all 100755
OUT="$(node "$SRC" < /dev/null 2>&1)"; RC=$?
assert_exit_code "$RC" "0" "check-test-exec-bits exits 0 on real repo"
assert_contains "$OUT" "100755" "success output mentions 100755"

# 2. Temp git repo with one 100644 suite -> exit 1 and path listed; all 100755 -> exit 0
SCRATCH="$TEST_TMP/scratch"
mkdir -p "$SCRATCH/hooks/tests"
git -C "$SCRATCH" init -q

printf '#!/usr/bin/env bash\nexit 0\n' > "$SCRATCH/hooks/tests/good.test.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SCRATCH/hooks/tests/bad.test.sh"
chmod 755 "$SCRATCH/hooks/tests/good.test.sh"
chmod 644 "$SCRATCH/hooks/tests/bad.test.sh"
git -C "$SCRATCH" add hooks/tests/good.test.sh hooks/tests/bad.test.sh
# Ensure deterministic index modes regardless of filesystem/umask
git -C "$SCRATCH" update-index --chmod=+x hooks/tests/good.test.sh
git -C "$SCRATCH" update-index --chmod=-x hooks/tests/bad.test.sh

OUT="$(node "$SRC" --root "$SCRATCH" < /dev/null 2>&1)"; RC=$?
assert_exit_code "$RC" "1" "temp repo with 100644 suite -> exit 1"
assert_contains "$OUT" "hooks/tests/bad.test.sh" "output lists the 100644 suite path"
assert_not_contains "$OUT" "hooks/tests/good.test.sh" "output does not list the 100755 suite"

# Also check cwd auto-detection inside scratch repo
OUT_CWD="$(cd "$SCRATCH" && node "$SRC" < /dev/null 2>&1)"; RC_CWD=$?
assert_exit_code "$RC_CWD" "1" "cwd mode with 100644 suite -> exit 1"
assert_contains "$OUT_CWD" "hooks/tests/bad.test.sh" "cwd mode lists the 100644 suite path"

# Fix bad.test.sh to 100755 -> exit 0
git -C "$SCRATCH" update-index --chmod=+x hooks/tests/bad.test.sh
chmod +x "$SCRATCH/hooks/tests/bad.test.sh"
OUT_OK="$(node "$SRC" --root "$SCRATCH" < /dev/null 2>&1)"; RC_OK=$?
assert_exit_code "$RC_OK" "0" "all 100755 -> exit 0"

# 3. Registered in sync-all.sh / sync-manifest.json with fix hint
LIST="$(bash "$REPO_ROOT/scripts/sync-all.sh" --list < /dev/null 2>/dev/null)"
assert_contains "$LIST" "check-test-exec-bits" "sync-all --list includes check-test-exec-bits"

SYNC_SCRATCH="$TEST_TMP/sync-scratch"
mkdir -p "$SYNC_SCRATCH/scripts/lib" "$SYNC_SCRATCH/hooks/tests"
cp "$REPO_ROOT/scripts/sync-all.sh" "$SYNC_SCRATCH/scripts/sync-all.sh"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$SYNC_SCRATCH/scripts/lib/json-emit.sh"
cp "$REPO_ROOT/scripts/sync-manifest.json" "$SYNC_SCRATCH/scripts/sync-manifest.json"
cp "$SRC" "$SYNC_SCRATCH/scripts/check-test-exec-bits.js"
printf '#!/usr/bin/env bash\nexit 0\n' > "$SYNC_SCRATCH/hooks/tests/nonexec.test.sh"
chmod 644 "$SYNC_SCRATCH/hooks/tests/nonexec.test.sh"
git -C "$SYNC_SCRATCH" init -q
git -C "$SYNC_SCRATCH" add scripts hooks/tests/nonexec.test.sh
git -C "$SYNC_SCRATCH" update-index --chmod=-x hooks/tests/nonexec.test.sh

SYNC_OUT="$(cd "$SYNC_SCRATCH" && bash scripts/sync-all.sh --check --only check-test-exec-bits < /dev/null 2>&1)"; SYNC_RC=$?
assert_exit_code "$SYNC_RC" "1" "sync-all --check --only check-test-exec-bits refuses 100644 suite"
assert_contains "$SYNC_OUT" "hooks/tests/nonexec.test.sh" "sync-all output names offending suite"
assert_contains "$SYNC_OUT" "git update-index --chmod=+x" "sync-all output includes fix hint"

git -C "$SYNC_SCRATCH" update-index --chmod=+x hooks/tests/nonexec.test.sh
chmod +x "$SYNC_SCRATCH/hooks/tests/nonexec.test.sh"
SYNC_OK="$(cd "$SYNC_SCRATCH" && bash scripts/sync-all.sh --check --only check-test-exec-bits < /dev/null 2>&1)"; SYNC_OK_RC=$?
assert_exit_code "$SYNC_OK_RC" "0" "sync-all --check --only check-test-exec-bits passes once 100755"

# 4. Negative control: disable mode check -> broken 100644 repo wrongly passes
git -C "$SCRATCH" update-index --chmod=-x hooks/tests/bad.test.sh
MUT_EXEC="$TEST_TMP/mut-exec.js"
sed_mutant "$SRC" "$MUT_EXEC" "s#if (mode !== '100755') {#if (false) {#"
MUT_OUT="$(node "$MUT_EXEC" --root "$SCRATCH" < /dev/null 2>&1)"; MUT_RC=$?
assert_exit_code "$MUT_RC" "0" "negative control: disabled mode check lets 100644 suite pass"
REAL_OUT="$(node "$SRC" --root "$SCRATCH" < /dev/null 2>&1)"; REAL_RC=$?
assert_exit_code "$REAL_RC" "1" "real checker blocks 100644 suite"

finalize_test
