#!/usr/bin/env bash
# hooks/tests/identifier-scan.test.sh — integration tests for scripts/identifier-scan.js

set -uo pipefail

. "$(dirname "$0")/lib.sh"

SCAN_JS="$REPO_ROOT/scripts/identifier-scan.js"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/identifier-scan"
DIRTY="$FIXTURES/dirty"
CLEAN="$FIXTURES/clean"

run_scan() {
  local out
  local exit_code=0
  out=$(node "$SCAN_JS" "$@" 2>&1) || exit_code=$?
  __SCAN_OUT="$out"
  __SCAN_EXIT="$exit_code"
}

# 1. Each dirty/ fixture: exit 1, and the reported kind for that file is the kind
# the file is named for. This pins kind-by-kind coverage, not just "something fired".
echo "Testing each dirty fixture reports its named kind..."
declare -A KIND_FOR_FILE=(
  [email.md]=email
  [ipv4.md]=ipv4
  [home-path.md]=home_path
  [fqdn.md]=fqdn
  [key-shape.md]=key_shape
)
for fname in "${!KIND_FOR_FILE[@]}"; do
  fpath="$DIRTY/$fname"
  expected_kind="${KIND_FOR_FILE[$fname]}"
  run_scan --json "$fpath"
  assert_exit_code "$__SCAN_EXIT" 1 "$fname: dirty fixture exits 1"
  has_kind=$(node -e "
    const d = JSON.parse(process.argv[1]);
    const kind = process.argv[2];
    process.stdout.write(d.findings.some(f => f.kind === kind) ? 'yes' : 'no');
  " "$__SCAN_OUT" "$expected_kind")
  assert_eq "$has_kind" "yes" "$fname: findings include kind '$expected_kind'"
done

# 2. The whole clean/ dir must not produce any findings.
echo "Testing clean/ directory as a whole passes..."
run_scan "$CLEAN"
assert_exit_code "$__SCAN_EXIT" 0 "clean/ directory exits 0"

# 3. negative-scope.md alone must pass. This is a PINNED, DELIBERATE blind spot, not
# an oversight: the fixture contains a bare hostname, a client name, and a tmux pane
# address, none of which are structured tokens this scanner covers. If someone later
# "fixes" this scanner to detect bare hostnames, THIS assertion goes red — which is
# the point: it forces them to also update the prose (elsewhere) that promises the
# human gate is the only defense against unstructured identifiers, rather than letting
# detection coverage silently expand out from under that promise.
echo "Testing negative-scope.md fixture is silently clean (deliberate blind spot)..."
run_scan "$CLEAN/negative-scope.md"
assert_exit_code "$__SCAN_EXIT" 0 "negative-scope.md alone exits 0 (pinned blind spot)"

# 4. stdin path.
echo "Testing stdin path..."
__SCAN_EXIT=0
__SCAN_OUT=$(printf 'a@b.com' | node "$SCAN_JS" 2>&1) || __SCAN_EXIT=$?
assert_exit_code "$__SCAN_EXIT" 1 "dirty text via stdin exits 1"

__SCAN_EXIT=0
__SCAN_OUT=$(printf 'nothing structured here' | node "$SCAN_JS" 2>&1) || __SCAN_EXIT=$?
assert_exit_code "$__SCAN_EXIT" 0 "clean text via stdin exits 0"

# 5. Usage error: a nonexistent path exits 2.
echo "Testing usage error on nonexistent path..."
run_scan "$FIXTURES/does-not-exist-anywhere"
assert_exit_code "$__SCAN_EXIT" 2 "nonexistent path exits 2"

# 6. Negative control — proves the suite can actually go red (evidence-discipline.md
# §2 / "the one question"). Copy identifier-scan.js to a TEMP file, neuter its pattern
# list, run a dirty fixture against the NEUTERED COPY, and assert it now exits 0 — i.e.
# with the detector removed, the dirty fixture is NOT caught. Never mutate the real
# script; this only proves the assertions above are load-bearing, not tautological.
echo "Testing negative control: neutered copy misses a dirty fixture..."
NEUTERED="$TEST_TMP/identifier-scan-neutered.js"
cp "$SCAN_JS" "$NEUTERED"
# Replace the PATTERNS array's contents with an empty array — the array declaration
# itself (`const PATTERNS = [`) and its closing `];` bracket line are left in place;
# only the pattern entries between them are deleted.
node -e "
  const fs = require('fs');
  const path = process.argv[1];
  let src = fs.readFileSync(path, 'utf8');
  const start = src.indexOf('const PATTERNS = [');
  if (start < 0) throw new Error('PATTERNS array not found in neutered copy');
  const closeIdx = src.indexOf('];', start);
  if (closeIdx < 0) throw new Error('PATTERNS array close not found in neutered copy');
  src = src.slice(0, start) + 'const PATTERNS = [];' + src.slice(closeIdx + 2);
  fs.writeFileSync(path, src);
" "$NEUTERED"

__SCAN_EXIT=0
__SCAN_OUT=$(node "$NEUTERED" "$DIRTY/email.md" 2>&1) || __SCAN_EXIT=$?
assert_exit_code "$__SCAN_EXIT" 0 "neutered copy (empty PATTERNS) does NOT catch a dirty fixture — proves the real detector is load-bearing"

# Sanity: the REAL script still catches it (guards against the neutering step itself
# being broken and silently no-op'ing on both copies).
__SCAN_EXIT=0
__SCAN_OUT=$(node "$SCAN_JS" "$DIRTY/email.md" 2>&1) || __SCAN_EXIT=$?
assert_exit_code "$__SCAN_EXIT" 1 "real script still catches the same fixture after neutering the copy"

# 7. Line numbers are correct: each dirty fixture has its token on line 4.
echo "Testing reported line numbers are correct..."
for fname in "${!KIND_FOR_FILE[@]}"; do
  fpath="$DIRTY/$fname"
  run_scan --json "$fpath"
  line=$(node -e "
    const d = JSON.parse(process.argv[1]);
    process.stdout.write(String(d.findings[0] ? d.findings[0].line : -1));
  " "$__SCAN_OUT")
  assert_eq "$line" "4" "$fname: reports line 4"
done

finalize_test
