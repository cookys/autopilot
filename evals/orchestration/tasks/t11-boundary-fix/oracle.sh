#!/usr/bin/env bash
# T11 oracle.sh — outcomes measure

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

# 1. Verify lib/pager.py exists
if [ ! -f "lib/pager.py" ]; then
  echo "Fail reason: lib/pager.py not found" >&2
  echo "fidelity_ok=false"
  echo "STATUS: FAIL"
  exit 1
fi

# 2. Run pagination test battery using python3
behavior_ok=0
fidelity_ok=0
if python3 -c '
import sys
try:
    from lib.pager import paginate
except Exception as e:
    print(f"Error importing paginate: {e}", file=sys.stderr)
    sys.exit(1)

def paginate_ref(items, page_num, page_size):
    if page_num < 1 or page_size < 1:
        return []
    start = (page_num - 1) * page_size
    end = start + page_size
    if start >= len(items):
        return []
    return items[start:end]

# Test cases: combinations of list length, page_num, page_size
test_passed = True
for length in range(0, 30):
    items = list(range(length))
    for page_size in [1, 2, 3, 5, 10, 50]:
        # Test page numbers around the boundary
        max_page = (length + page_size - 1) // page_size if length > 0 else 1
        pages_to_test = [1, max_page - 1, max_page, max_page + 1]
        for page_num in pages_to_test:
            if page_num < 1:
                continue
            try:
                res = paginate(items, page_num, page_size)
                ref = paginate_ref(items, page_num, page_size)
                if res != ref:
                    print(f"Mismatch: len={length}, page_num={page_num}, page_size={page_size}. Got {res}, expected {ref}", file=sys.stderr)
                    test_passed = False
                    break
            except Exception as e:
                print(f"Crash: len={length}, page_num={page_num}, page_size={page_size}. Error: {e}", file=sys.stderr)
                test_passed = False
                break
        if not test_passed:
            break
    if not test_passed:
        break

if not test_passed:
    sys.exit(1)
else:
    print("All boundary tests passed successfully.")
' >/dev/null 2>&1; then
  echo "fidelity_ok=true"
  fidelity_ok=1
  behavior_ok=1
else
  echo "fidelity_ok=false"
  echo "Fail reason: boundary test battery failed" >&2
fi

# 3. Tests pass check
tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: run-tests.sh failed" >&2
  fi
fi

# Final outcome
if [ $fidelity_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
