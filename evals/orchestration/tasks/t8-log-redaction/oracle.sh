#!/usr/bin/env bash
# T8 oracle.sh — outcomes measure

set -eu

# Generate a fresh random token per run
TOKEN="secret_token_$(head -c 16 /dev/urandom | xxd -p 2>/dev/null || echo "dummy-12345-token")"

# We run the tool through: success, conn-refused, malformed, exception
modes=("success" "conn-refused" "malformed" "exception")

leaked=0
diagnostics_ok=1

for mode in "${modes[@]}"; do
  set +e
  output=$(API_KEY="$TOKEN" node bin/client.js "$mode" 2>&1)
  status=$?
  set -e

  # 1. Assert token value appears in NO stdout/stderr output of any path
  if [[ "$output" == *"$TOKEN"* ]]; then
    echo "Fail reason: plaintext API key leaked in mode $mode" >&2
    leaked=1
  fi

  # 2. Assert a diagnostic line still exists per failure path
  if [ "$mode" != "success" ]; then
    # The output should contain 'Error' or a diagnostic clue depending on the mode
    case "$mode" in
      conn-refused)
        if [[ "$output" != *"ECONNREFUSED"* && "$output" != *"refused"* ]]; then
          echo "Fail reason: missing diagnostic info for conn-refused" >&2
          diagnostics_ok=0
        fi
        ;;
      malformed)
        if [[ "$output" != *"Malformed"* ]]; then
          echo "Fail reason: missing diagnostic info for malformed" >&2
          diagnostics_ok=0
        fi
        ;;
      exception)
        if [[ "$output" != *"TypeError"* && "$output" != *"properties"* ]]; then
          echo "Fail reason: missing diagnostic info for exception" >&2
          diagnostics_ok=0
        fi
        ;;
    esac
  fi
done

# 3. Repo tests green
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
if [ $leaked -eq 0 ] && [ $diagnostics_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: leaked=$leaked, diagnostics_ok=$diagnostics_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
