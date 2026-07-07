#!/usr/bin/env bash
# Checks: parser.py exits 0 on a clean-ish fixture with no malformed lines.
# Deliberately misses: malformed-input hardening, output files, counts, and extracted content.

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
cat > logs.txt <<'EOF'
2026-07-06 10:00:00 INFO Service started
2026-07-06 10:01:00 ERROR Database connection failed
2026-07-06 10:02:00 INFO Done
EOF

if ! timeout 60 python3 parser.py >/dev/null 2>&1; then
  echo "parser.py crashed or exited non-zero" >&2
  exit 1
fi
