#!/usr/bin/env bash
# Tests for scripts/hetero-panel.sh

. "$(dirname "$0")/../hooks/tests/lib.sh"

SCRIPT="$REPO_ROOT/scripts/hetero-panel.sh"
BIN_DIR="$TEST_TMP/bin"
mkdir -p "$BIN_DIR"

# Fake fleet CLI: handles `directory` (for dispatch-panel.js) and `upload` (for --upload)
cat > "$BIN_DIR/fleet" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  directory)
    echo '{"members":[{"namespace":"ns","courier":"courier-zulu-7","member":"member-omega-99","host":"gpu-node-44"}]}'
    exit 0
    ;;
  upload)
    echo "blob://fake-sha256-$(basename "${2:-file}")"
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod +x "$BIN_DIR/fleet"

# Fake author-cmd: emits distinct deterministic answers with 🔴 markers
cat > "$BIN_DIR/fake-author.sh" <<'EOF'
#!/usr/bin/env bash
MODEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat <<OUT
Verdict: NEEDS-WORK
🔴 Critical: finding one from $MODEL
🔴 Critical: finding two from $MODEL
🟡 Minor: minor note
OUT
EOF
chmod +x "$BIN_DIR/fake-author.sh"

export PATH="$BIN_DIR:$PATH"
export AUTOPILOT_FLEET_BIN="$BIN_DIR/fleet"

# 1. Two fake seats (--astra) produce two receipts with correct sha16 and Critical counts
PROMPT_OK="$TEST_TMP/prompt-ok.md"
cat > "$PROMPT_OK" <<'EOF'
Please review this design for correctness and edge cases.
EOF

OUT_1="$TEST_TMP/out1"
OUT_STDOUT="$("$SCRIPT" "$PROMPT_OK" --astra --out-dir "$OUT_1" --run-id "run1" --author-cmd "$BIN_DIR/fake-author.sh")"
RC_1=$?
assert_eq "$RC_1" "0" "two-seat run exits 0"
assert_contains "$OUT_STDOUT" "critical=2" "summary line reports 2 critical findings"
assert_contains "$OUT_STDOUT" "$OUT_1/receipts/run1/" "receipt path printed"

RECEIPT_COUNT="$(find "$OUT_1/receipts/run1" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
assert_eq "$RECEIPT_COUNT" "2" "two receipt markdown files created"

for md in "$OUT_1/receipts/run1"/*.md; do
  sha_file="${md}.sha256"
  assert_file_exists "$sha_file" "sha256 file exists for $md"
  expected_sha16="$(sha256sum "$md" | awk '{print substr($1, 1, 16)}')"
  actual_sha16="$(tr -d '[:space:]' < "$sha_file")"
  assert_eq "$actual_sha16" "$expected_sha16" "sha16 matches receipt content"
done

# 2. Leak-guard hit exits 4 and writes no receipts
PROMPT_LEAK="$TEST_TMP/prompt-leak.md"
cat > "$PROMPT_LEAK" <<'EOF'
Please check courier-zulu-7 on gpu-node-44.
EOF

OUT_2="$TEST_TMP/out2"
set +e
"$SCRIPT" "$PROMPT_LEAK" --out-dir "$OUT_2" --run-id "run2" --author-cmd "$BIN_DIR/fake-author.sh" >/dev/null 2>&1
RC_2=$?
set -e
assert_eq "$RC_2" "4" "leak-guard hit propagates exit 4"
assert_file_absent "$OUT_2/receipts/run2" "no receipts written on exit 4"

# 3. --upload with fake fleet prints blob refs
OUT_3="$TEST_TMP/out3"
OUT_UPLOAD="$("$SCRIPT" "$PROMPT_OK" --astra --upload --out-dir "$OUT_3" --run-id "run3" --author-cmd "$BIN_DIR/fake-author.sh")"
RC_3=$?
assert_eq "$RC_3" "0" "--upload run exits 0"
assert_contains "$OUT_UPLOAD" "blob://fake-sha256-" "blob ref printed on --upload"

finalize_test
