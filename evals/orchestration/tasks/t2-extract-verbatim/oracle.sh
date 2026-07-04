#!/usr/bin/env bash
# T2 oracle.sh — outcomes measure

set -u

# 1. Byte-fidelity check (A3 pattern)
fidelity_ok=0
INITIAL_COMMIT=$(git rev-list --max-parents=0 HEAD 2>/dev/null)
if [ -n "$INITIAL_COMMIT" ] && [ -f "lib/stats.py" ]; then
  # Reconstruct original heredoc from git
  git show "$INITIAL_COMMIT:bin/process-data.sh" | awk '
    /^python3 - .*<< '\''EOF'\''/ { flag=1; next }
    /^EOF/ { flag=0 }
    flag { print }
  ' > expected_stats.py

  if diff -u expected_stats.py lib/stats.py >/dev/null 2>&1; then
    echo "fidelity_ok=true"
    fidelity_ok=1
  else
    echo "fidelity_ok=false"
  fi
  rm -f expected_stats.py
else
  echo "fidelity_ok=false"
fi

# 2. Output of a fixed invocation identical to pinned golden file
behavior_ok=0
if [ -f "bin/process-data.sh" ] && [ -f "data/logs.jsonl" ] && [ -f "data/golden.txt" ]; then
  if ./bin/process-data.sh < data/logs.jsonl > actual_output.txt 2>/dev/null; then
    if diff -u data/golden.txt actual_output.txt >/dev/null 2>&1; then
      behavior_ok=1
    fi
  fi
  rm -f actual_output.txt
fi

# 3. Micro-repo tests pass
tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  fi
fi

# Final outcome
if [ $fidelity_ok -eq 1 ] && [ $behavior_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok, behavior_ok=$behavior_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
