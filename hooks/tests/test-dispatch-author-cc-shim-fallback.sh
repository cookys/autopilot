#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DISPATCH_AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SANDBOX_HOME="$TMP_DIR/home"
mkdir -p "$SANDBOX_HOME/.local/bin"

PROMPT_FILE="$TMP_DIR/prompt.txt"
echo "hello" > "$PROMPT_FILE"

FAKE_CLAUDE="$SANDBOX_HOME/.local/bin/claude"
cat > "$FAKE_CLAUDE" <<'EOF'
#!/usr/bin/env bash
echo '{"type":"result","subtype":"success","result":"ok"}'
exit 0
EOF
chmod +x "$FAKE_CLAUDE"

# Minimal PATH that has bash/node/coreutils but no claude
CLEAN_PATH="/usr/local/bin:/usr/bin:/bin"

# 1. Positive case: PATH has no claude, HOME/.local/bin/claude is executable -> succeeds
OUT_POS="$TMP_DIR/out_pos.log"
set +e
HOME="$SANDBOX_HOME" \
PATH="$CLEAN_PATH" \
ANTHROPIC_BASE_URL="https://example.invalid" \
ANTHROPIC_AUTH_TOKEN="dGVzdC10b2tlbg==" \
bash "$DISPATCH_AUTHOR" \
  --runner cc-shim \
  --model glm-5 \
  --prompt-file "$PROMPT_FILE" \
  --raw-log "$OUT_POS" \
  --timeout 15 >/dev/null 2>&1
RC_POS=$?
set -e

if grep -q "claude binary not found" "$OUT_POS" 2>/dev/null; then
  echo "FAIL: positive case hit 'claude binary not found'"
  exit 1
fi
echo "PASS: positive case did not hit 'claude binary not found' (rc=$RC_POS)"

# 2. Negative control: remove executable bit from HOME/.local/bin/claude -> must fail with claude binary not found
chmod -x "$FAKE_CLAUDE"
OUT_NEG="$TMP_DIR/out_neg.log"
set +e
HOME="$SANDBOX_HOME" \
PATH="$CLEAN_PATH" \
ANTHROPIC_BASE_URL="https://example.invalid" \
ANTHROPIC_AUTH_TOKEN="dGVzdC10b2tlbg==" \
bash "$DISPATCH_AUTHOR" \
  --runner cc-shim \
  --model glm-5 \
  --prompt-file "$PROMPT_FILE" \
  --raw-log "$OUT_NEG" \
  --timeout 15 >"$TMP_DIR/neg_stdout.log" 2>&1
RC_NEG=$?
set -e

if [ "$RC_NEG" -eq 0 ]; then
  echo "FAIL: negative control unexpectedly succeeded"
  exit 1
fi
if ! grep -q "claude binary not found" "$TMP_DIR/neg_stdout.log" "$OUT_NEG" 2>/dev/null; then
  echo "FAIL: negative control did not report 'claude binary not found'"
  exit 1
fi
echo "PASS: negative control failed with 'claude binary not found' (rc=$RC_NEG)"
