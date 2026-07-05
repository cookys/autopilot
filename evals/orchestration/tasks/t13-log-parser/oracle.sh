#!/usr/bin/env bash
# T13 oracle.sh — outcomes measure

set -u

if [ $# -ge 1 ]; then
  cd "$1"
fi

# 1. Verify parser.py exists
if [ ! -f "parser.py" ]; then
  echo "Fail reason: parser.py not found" >&2
  echo "fidelity_ok=false"
  echo "STATUS: FAIL"
  exit 1
fi

# 2. ORACLE-OWNED fixture + DIRECT parser invocation. Never trust candidate-controlled
# run-tests.sh (a submission could rewrite it to emit expected JSON without hardening
# parser.py — the delegate-selftest-false-green class). The oracle builds the nasty
# fixture itself and runs the parser directly against the task's documented contract.
tests_passed=0
rm -f errors.json summary.json logs.txt
# Per-run NONCE: the asserted message content cannot be inferred from any
# candidate-visible file (run-tests.sh mirrors the fixture SHAPE but not this
# value), so a parser that hardcodes outputs without reading logs.txt fails
# (qc3-evals Major: output-hardcoding cheat). Also: plain prints only — an
# escaped-quote f-string inside this single-quoted python block was a silent
# SyntaxError that made the oracle FAIL every candidate (qc3-evals Critical).
ORACLE_NONCE="$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
export ORACLE_NONCE
python3 - <<'PYFIX'
import os
nonce = os.environ['ORACLE_NONCE']
with open('logs.txt', 'wb') as f:
    f.write(b'2026-07-06 10:00:00 INFO Service started\n')
    f.write(('2026-07-06 10:01:00 ERROR Database connection failed code=' + nonce + '\n').encode())
    # truncated ERROR line (no message parts)
    f.write(b'2026-07-06 ERROR\n')
    # binary / invalid-utf8 ERROR line
    f.write(b'2026-07-06 10:03:00 ERROR \xff\xfe\x00garbage\n')
    # huge valid ERROR line (10000-char message)
    f.write(b'2026-07-06 10:04:00 ERROR ' + b'A' * 10000 + b'\n')
    f.write(b'2026-07-06 10:05:00 INFO Done\n')
PYFIX
if timeout 60 python3 parser.py >/dev/null 2>&1; then
  tests_passed=1
else
  echo "Fail reason: parser.py crashed or exited non-zero on the oracle fixture" >&2
fi

# 3. Check outputs and correctness
fidelity_ok=0
if [ $tests_passed -eq 1 ]; then
  if [ -f "errors.json" ] && [ -f "summary.json" ]; then
    if python3 - <<'PYCHECK' >/dev/null 2>&1
import json, os, sys

nonce = os.environ['ORACLE_NONCE']

try:
    with open("summary.json", "r") as f:
        summary = json.load(f)
except Exception as e:
    print("Error loading summary.json: " + str(e), file=sys.stderr)
    sys.exit(1)

if "parsed_errors" not in summary or "failed_lines" not in summary:
    print("Missing keys in summary.json", file=sys.stderr)
    sys.exit(1)

if summary["parsed_errors"] != 2 or summary["failed_lines"] != 2:
    print("Incorrect counts in summary.json: " + str(summary), file=sys.stderr)
    sys.exit(1)

try:
    with open("errors.json", "r") as f:
        errors = json.load(f)
except Exception as e:
    print("Error loading errors.json: " + str(e), file=sys.stderr)
    sys.exit(1)

if not isinstance(errors, list) or len(errors) != 2:
    print("Expected 2 errors in errors.json", file=sys.stderr)
    sys.exit(1)

err1 = errors[0]
if err1.get("timestamp") != "2026-07-06 10:01:00" or err1.get("message") != "Database connection failed code=" + nonce:
    print("First error mismatch (nonce content not reproduced)", file=sys.stderr)
    sys.exit(1)

err2 = errors[1]
if err2.get("timestamp") != "2026-07-06 10:04:00" or len(err2.get("message", "")) != 10000:
    print("Second error mismatch", file=sys.stderr)
    sys.exit(1)

print("Outputs parsed and validated successfully.")
PYCHECK
    then
      echo "fidelity_ok=true"
      fidelity_ok=1
    else
      echo "fidelity_ok=false"
      echo "Fail reason: summary.json or errors.json contents are invalid or incorrect" >&2
    fi
  else
    echo "fidelity_ok=false"
    echo "Fail reason: errors.json or summary.json was not created" >&2
  fi
else
  echo "fidelity_ok=false"
fi

# Final outcome
if [ $tests_passed -eq 1 ] && [ $fidelity_ok -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: tests_passed=$tests_passed, fidelity_ok=$fidelity_ok" >&2
  exit 1
fi
