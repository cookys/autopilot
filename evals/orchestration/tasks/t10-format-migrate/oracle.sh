#!/usr/bin/env bash
# T10 oracle.sh — outcomes measure

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

# 1. Check if config.json exists
json_exists=0
if [ -f "config.json" ]; then
  json_exists=1
else
  echo "Fail reason: config.json not found" >&2
fi

# 2. Check if reader.py is updated to use config.json
reader_updated=0
if [ -f "reader.py" ]; then
  if grep -q "config.json" reader.py && ! grep -q "config.conf" reader.py; then
    reader_updated=1
  else
    echo "Fail reason: reader.py is not updated to use config.json or still references config.conf" >&2
  fi
fi

# 3. Behavioral and semantic checks via Python script
fidelity_ok=0
compat_ok=0
if [ $json_exists -eq 1 ] && [ -f "reader.py" ]; then
  BASE_COMMIT=$(git rev-list --max-parents=0 HEAD 2>/dev/null | head -1)
  if [ -n "$BASE_COMMIT" ]; then
    # We run a python helper to parse the base config.conf and the modified config.json
    # and compare their semantic content.
    if python3 -c '
import json, sys, subprocess

# 1. Parse original config.conf from base commit
try:
    conf_bytes = subprocess.check_output(["git", "show", "'$BASE_COMMIT':config.conf"])
    conf_str = conf_bytes.decode("utf-8")
except Exception as e:
    print(f"Error reading base config.conf: {e}", file=sys.stderr)
    sys.exit(1)

expected = {}
for line in conf_str.splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split("=", 1)
    if len(parts) == 2:
        expected[parts[0].strip()] = parts[1].strip()

# 2. Load candidate config.json
try:
    with open("config.json", "r") as f:
        actual = json.load(f)
except Exception as e:
    print(f"Error parsing config.json: {e}", file=sys.stderr)
    sys.exit(1)

# Compare dictionaries exactly
if expected != actual:
    print(f"Mismatch: Expected {expected}, got {actual}", file=sys.stderr)
    sys.exit(1)

# 3. Test reader.py output
try:
    output = subprocess.check_output(["python3", "reader.py"]).decode("utf-8").strip()
    expected_output = "\n".join(f"{k}: {expected[k]}" for k in sorted(expected.keys()))
    if output != expected_output:
        print(f"Reader output mismatch. Expected:\n{expected_output}\nGot:\n{output}", file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f"Error running reader.py: {e}", file=sys.stderr)
    sys.exit(1)

print("Semantic consistency checks passed.")
' >/dev/null 2>&1; then
      echo "fidelity_ok=true"
      fidelity_ok=1
      compat_ok=1
    else
      echo "fidelity_ok=false"
      echo "Fail reason: JSON config structure or reader output does not match original config.conf semantics" >&2
    fi
  else
    echo "fidelity_ok=false"
    echo "Warning: no git base commit found" >&2
  fi
else
  echo "fidelity_ok=false"
fi

# 4. Tests pass check
tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: run-tests.sh failed" >&2
  fi
fi

# Final outcome
if [ $json_exists -eq 1 ] && [ $reader_updated -eq 1 ] && [ $fidelity_ok -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: json_exists=$json_exists, reader_updated=$reader_updated, fidelity_ok=$fidelity_ok, tests_passed=$tests_passed" >&2
  exit 1
fi
