#!/usr/bin/env bash
# Checks: parser.py does not crash on a small malformed fixture, and errors.json
# plus summary.json exist as valid JSON with parsed_errors and failed_lines keys.
# Deliberately misses: exact counts, extracted error content, huge-line handling, and nonce fidelity.

set -u

if [ $# -lt 1 ]; then
  echo "Usage: $0 <workdir>" >&2
  exit 1
fi

cd "$1" || exit 1

if [ ! -f "parser.py" ]; then
  echo "parser.py not found" >&2
  exit 1
fi

rm -f errors.json summary.json logs.txt
python3 - <<'PYFIX'
with open("logs.txt", "wb") as f:
    f.write(b"2026-07-06 10:00:00 INFO Service started\n")
    f.write(b"2026-07-06 10:01:00 ERROR Database connection failed\n")
    f.write(b"2026-07-06 ERROR\n")
    f.write(b"2026-07-06 10:03:00 ERROR \xff\xfe broken\n")
PYFIX

if ! timeout 60 python3 parser.py >/dev/null 2>&1; then
  echo "parser.py crashed or exited non-zero" >&2
  exit 1
fi

python3 - <<'PYCHECK'
import json
import sys

for path in ("errors.json", "summary.json"):
    try:
        with open(path, "r") as f:
            data = json.load(f)
    except Exception as exc:
        print(f"{path} is missing or invalid JSON: {exc}", file=sys.stderr)
        sys.exit(1)
    if path == "summary.json":
        if "parsed_errors" not in data or "failed_lines" not in data:
            print("summary.json missing parsed_errors or failed_lines", file=sys.stderr)
            sys.exit(1)
PYCHECK
