#!/usr/bin/env bash
# Checks: lib/stats.py exists, is non-empty, and compiles as Python.
# Deliberately misses: verbatim byte fidelity, process-data.sh integration, and behavioral parity.

set -u

if [ $# -lt 1 ]; then
  echo "Usage: $0 <workdir>" >&2
  exit 1
fi

cd "$1" || exit 1

if [ ! -s "lib/stats.py" ]; then
  echo "lib/stats.py missing or empty" >&2
  exit 1
fi

python3 -m py_compile "lib/stats.py"
