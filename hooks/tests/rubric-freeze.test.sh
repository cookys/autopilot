#!/usr/bin/env bash
# hooks/tests/rubric-freeze.test.sh
# Gate 2 (rubric freeze): ironlaw-to-gate. Verifies that sealing a round-0
# acceptance rubric by content hash produces a deterministic seal, and that
# subsequent checks correctly distinguish FROZEN from DRIFT.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/rubric-freeze.js"

SPEC="$TEST_TMP/spec.md"
SEAL="$TEST_TMP/seal.json"
printf '# round-0 acceptance rubric\n- criterion 1\n' > "$SPEC"

# 1. SEAL+FROZEN
node "$SCRIPT" seal "$SPEC" --out "$SEAL" ; rc=$?
assert_exit_code "$rc" 0 "seal --out should exit 0"
assert_file_exists "$SEAL" "seal file should be written"

out=$(node "$SCRIPT" check "$SPEC" "$SEAL" --json) ; rc=$?
assert_exit_code "$rc" 0 "check on unmodified spec should exit 0 (FROZEN)"
v=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.verdict))')
assert_eq "$v" "FROZEN" "verdict on unmodified spec should be FROZEN"

# 2. DRIFT: mutate the spec, re-check
printf '- criterion 2 (added later)\n' >> "$SPEC"
out=$(node "$SCRIPT" check "$SPEC" "$SEAL" --json) ; rc=$?
assert_exit_code "$rc" 3 "check on mutated spec should exit 3 (DRIFT)"
v=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.verdict))')
assert_eq "$v" "DRIFT" "verdict on mutated spec should be DRIFT"

# 3. SEAL to stdout
out=$(node "$SCRIPT" seal "$SPEC") ; rc=$?
assert_exit_code "$rc" 0 "seal to stdout should exit 0"
hash=$(printf '%s' "$out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.spec_sha256))')
match=$(printf '%s' "$hash" | node -e 'const h=require("fs").readFileSync(0,"utf8").trim();process.stdout.write(/^[0-9a-f]{64}$/.test(h) ? "yes" : "no")')
assert_eq "$match" "yes" "stdout seal spec_sha256 should be 64 lowercase hex chars"

# 4. USAGE: check with nonexistent seal file
node "$SCRIPT" check "$SPEC" "$TEST_TMP/does-not-exist.json" --json ; rc=$?
assert_exit_code "$rc" 2 "check with missing seal file should exit 2"

# 5. USAGE: unknown subcommand
node "$SCRIPT" frobnicate "$SPEC" ; rc=$?
assert_exit_code "$rc" 2 "unknown subcommand should exit 2"

finalize_test
