#!/usr/bin/env bash
# Tests for scripts/dispatch-from-scratch.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/dispatch-from-scratch.sh"

TMP_ROOT="${TMPDIR:-/tmp}"
TEST_DIR=""
cleanup() {
  if [[ -n "${TEST_DIR:-}" && "$TEST_DIR" == "$TMP_ROOT"/* && -d "$TEST_DIR" ]]; then
    rm -rf -- "$TEST_DIR"
  fi
}
trap cleanup EXIT
TEST_DIR="$(mktemp -d "$TMP_ROOT/dfs-test.XXXXXX")"

export HOME="$TEST_DIR/home"
export XDG_RUNTIME_DIR="$TEST_DIR/runtime"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"

PASS=0
FAIL=0
assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected=$expected actual=$actual)" >&2
    FAIL=$((FAIL + 1))
  fi
}

# 1. Reject brief missing Task-Shape: from-scratch
BAD_BRIEF="$TEST_DIR/bad.md"
printf '# Normal brief\nDo something\n' > "$BAD_BRIEF"
rc=0
bash "$TARGET" --prompt-file "$BAD_BRIEF" >/dev/null 2>&1 || rc=$?
assert_eq "rejects missing Task-Shape" "2" "$rc"

# Valid brief
GOOD_BRIEF="$TEST_DIR/good.md"
printf 'Task-Shape: from-scratch\n# Slugify\nWrite slugify\n' > "$GOOD_BRIEF"

# 2. Sandbox contains ONLY the brief, and first engine succeeds
FAKE_AUTHOR="$TEST_DIR/fake-author.sh"
cat > "$FAKE_AUTHOR" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
count="$(ls -1A "$PWD" | wc -l | tr -d ' ')"
if [[ "$count" != "1" ]]; then
  echo "sandbox_not_clean: count=$count" >&2
  exit 9
fi
echo 'dispatch-author: run_id=r1 manifest=/tmp/m.json (watch: x)' >&2
echo '{"status":"authored","raw_log":"/tmp/r.log"}'
EOF
chmod +x "$FAKE_AUTHOR"

rc=0
out="$(AUTHOR_BIN="$FAKE_AUTHOR" bash "$TARGET" --prompt-file "$GOOD_BRIEF" 2>&1)" || rc=$?
assert_eq "first engine succeeds with clean sandbox" "0" "$rc"
if ! printf '%s' "$out" | grep -q '產出未審，進 repo 前須 Claude 席或 agy 審'; then
  echo "FAIL: missing review notice" >&2
  FAIL=$((FAIL + 1))
else
  echo "PASS: review notice printed"
  PASS=$((PASS + 1))
fi

if printf '%s' "$out" | grep -q '^manifest: /tmp/m.json$' && printf '%s' "$out" | grep -q '^raw_log: /tmp/r.log$'; then
  echo "PASS: manifest and raw_log parsed from real dispatch-author output"
  PASS=$((PASS + 1))
else
  echo "FAIL: manifest or raw_log not parsed" >&2
  FAIL=$((FAIL + 1))
fi

# 3. First engine fails -> falls back to second engine
cat > "$FAKE_AUTHOR" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"minimax"* ]]; then
  echo '{"status":"runner_failed","reason":"boom"}' >&2
  exit 1
fi
echo '{"status":"ok","manifest_path":"/tmp/m2.json","raw_log":"/tmp/r2.log"}'
EOF
chmod +x "$FAKE_AUTHOR"

rc=0
out="$(AUTHOR_BIN="$FAKE_AUTHOR" bash "$TARGET" --prompt-file "$GOOD_BRIEF" 2>&1)" || rc=$?
assert_eq "falls back to second engine" "0" "$rc"
if ! printf '%s' "$out" | grep -q 'engine: kimi'; then
  echo "FAIL: expected kimi fallback" >&2
  FAIL=$((FAIL + 1))
else
  echo "PASS: kimi fallback selected"
  PASS=$((PASS + 1))
fi

# 4. All engines fail -> exit 1
cat > "$FAKE_AUTHOR" <<'EOF'
#!/usr/bin/env bash
echo '{"status":"precondition_failed","reason":"kimi_local_stopped"}' >&2
exit 2
EOF
chmod +x "$FAKE_AUTHOR"

rc=0
AUTHOR_BIN="$FAKE_AUTHOR" bash "$TARGET" --prompt-file "$GOOD_BRIEF" >/dev/null 2>&1 || rc=$?
assert_eq "all engines fail exits 1" "1" "$rc"

echo "Summary: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
