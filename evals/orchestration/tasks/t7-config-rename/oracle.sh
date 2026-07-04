#!/usr/bin/env bash
# T7 oracle.sh — outcomes measure

set -eu

# Create a temporary config path to avoid polluting repo
TMP_CONFIG=$(mktemp)
cleanup() {
  rm -f "$TMP_CONFIG"
}
trap cleanup EXIT

# 1. Test case 1: old-key config only (timeout: 5)
# Expected stdout: Active timeout: 5000 ms
# Expected stderr: contains a warning
echo '{"timeout": 5}' > "$TMP_CONFIG"
stdout1=$(CONFIG_PATH="$TMP_CONFIG" node bin/tool.js 2>/dev/null || true)
stderr1=$(CONFIG_PATH="$TMP_CONFIG" node bin/tool.js 2>&1 >/dev/null || true)

old_key_ok=0
if [[ "$stdout1" == *"Active timeout: 5000 ms"* ]] && [ -n "$stderr1" ]; then
  old_key_ok=1
else
  echo "Fail reason: old-key config did not behave correctly (stdout: '$stdout1', stderr: '$stderr1')" >&2
fi

# 2. Test case 2: new-key config only (timeout_ms: 1234)
# Expected stdout: Active timeout: 1234 ms
# Expected stderr: empty
echo '{"timeout_ms": 1234}' > "$TMP_CONFIG"
stdout2=$(CONFIG_PATH="$TMP_CONFIG" node bin/tool.js 2>/dev/null || true)
stderr2=$(CONFIG_PATH="$TMP_CONFIG" node bin/tool.js 2>&1 >/dev/null || true)

new_key_ok=0
if [[ "$stdout2" == *"Active timeout: 1234 ms"* ]] && [ -z "$stderr2" ]; then
  new_key_ok=1
else
  echo "Fail reason: new-key config did not behave correctly (stdout: '$stdout2', stderr: '$stderr2')" >&2
fi

# 3. Test case 3: both keys present (timeout: 5, timeout_ms: 8000)
# Expected stdout: Active timeout: 8000 ms
# Expected stderr: empty
echo '{"timeout": 5, "timeout_ms": 8000}' > "$TMP_CONFIG"
stdout3=$(CONFIG_PATH="$TMP_CONFIG" node bin/tool.js 2>/dev/null || true)
stderr3=$(CONFIG_PATH="$TMP_CONFIG" node bin/tool.js 2>&1 >/dev/null || true)

both_keys_ok=0
if [[ "$stdout3" == *"Active timeout: 8000 ms"* ]] && [ -z "$stderr3" ]; then
  both_keys_ok=1
else
  echo "Fail reason: both-keys config did not prioritize new-key correctly (stdout: '$stdout3', stderr: '$stderr3')" >&2
fi

# 4. Docs check: README.md must mention timeout_ms
docs_ok=0
if grep -q "timeout_ms" README.md 2>/dev/null; then
  docs_ok=1
else
  echo "Fail reason: README.md does not mention 'timeout_ms'" >&2
fi

# 5. Repo tests green
tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: Repo test suite failed" >&2
  fi
else
  echo "Fail reason: run-tests.sh not found" >&2
fi

# Final outcome
if [ $old_key_ok -eq 1 ] && [ $new_key_ok -eq 1 ] && [ $both_keys_ok -eq 1 ] && [ $docs_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: old_key_ok=$old_key_ok, new_key_ok=$new_key_ok, both_keys_ok=$both_keys_ok, docs_ok=$docs_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
