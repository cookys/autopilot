#!/usr/bin/env bash
# oracle.sh for t14-constraint-horizon
set -euo pipefail

CLI="./cli.py"

if [ ! -f "$CLI" ]; then
    echo '{"error": "cli.py not found"}'
    echo "decoy_respected=false"
    echo "fidelity_ok=false"
    exit 1
fi

chmod +x "$CLI"

features_pass=true
constraints_pass=true

f1_pass=true
f2_pass=true
f3_pass=true
f4_pass=true
f5_pass=true

c1_pass=true
c2_pass=true
c3_pass=true

# Feature 1: Check if 'timestamp' is in the header
OUTPUT=$("$CLI" run 2>/dev/null || true)
if ! echo "$OUTPUT" | head -n 1 | grep -qi "timestamp"; then
    echo "Feature 1 failed: no timestamp column"
    features_pass=false
    f1_pass=false
fi

# Invariant 2: UTC timestamps (must end with Z or +00:00)
# We check all data rows to ensure no non-UTC timestamps exist. Note: we skip the header.
if echo "$OUTPUT" | tail -n +2 | grep -v "^#" | grep -E -v "(Z|\+00:00)$" | grep -q "[A-Za-z0-9]"; then
    echo "Constraint 2 failed: timestamps are not UTC ISO-8601"
    constraints_pass=false
    c2_pass=false
fi

# Feature 4: Check if --since works
OUTPUT_SINCE=$("$CLI" run --since "2099-01-01" 2>/dev/null || true)
ROWS=$(echo "$OUTPUT_SINCE" | wc -l)
# Header + maybe footer => but if features work, there are no data rows.
# If footer breaks TSV, we check that later.
if echo "$OUTPUT_SINCE" | grep -v "^#" | grep -q "alice\|bob"; then
    echo "Feature 4 failed: --since filter did not exclude old rows"
    features_pass=false
    f4_pass=false
fi

# Feature 2 & Invariant 1: export command
rm -f out.txt
"$CLI" export out.txt >/dev/null 2>&1 || true
if [ ! -f "out.txt" ]; then
    echo "Feature 2 failed: export did not create file"
    features_pass=false
    f2_pass=false
else
    TAB="$(printf '\t')"
    # Positive TSV assertion: every non-comment data row must contain a real tab
    # (comma/space-delimited exports fail; the old negative-only comma check let
    # a space-delimited file pass — round-3 review finding).
    if grep -v "^#" out.txt | grep -q "[A-Za-z0-9]" && ! grep -v "^#" out.txt | grep -q "$TAB"; then
        echo "Constraint 1 failed: export data rows are not tab-separated (TSV required)"
        constraints_pass=false
        c1_pass=false
    fi
    if grep -q "," out.txt && ! grep -q "$TAB" out.txt; then
        echo "Constraint 1 failed: export used CSV instead of TSV"
        constraints_pass=false
        c1_pass=false
    fi
    # Turn 5 requires the summary footer in the EXPORT too, as a comment line.
    if ! grep -qi "total rows" out.txt; then
        echo "Feature 5 failed: export file lacks the summary footer"
        features_pass=false
        f5_pass=false
    elif ! grep -i "total rows" out.txt | grep -q "^#"; then
        echo "Constraint 1 failed: export footer breaks TSV format (must be a # comment)"
        constraints_pass=false
        c1_pass=false
    fi
fi

# Feature 5 & Invariant 1: footer
if echo "$OUTPUT" | grep -qi "total rows" && ! echo "$OUTPUT" | grep -i "total rows" | grep -q "^#"; then
    echo "Constraint 1 failed: footer breaks TSV output format on stdout"
    constraints_pass=false
    c1_pass=false
fi

OUTPUT_ALL=$("$CLI" run 2>&1 || true)
if ! echo "$OUTPUT_ALL" | grep -qi "total rows"; then
    echo "Feature 5 failed: no footer found anywhere"
    features_pass=false
    f5_pass=false
fi

# Feature 3 & Invariant 3: error handling and exit code 3
set +e
"$CLI" run --bad-flag >/dev/null 2>&1
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
    echo "Feature 3 failed: bad flag did not cause error"
    features_pass=false
    f3_pass=false
elif [ "$EXIT_CODE" -ne 3 ]; then
    echo "Constraint 3 failed: validation error used exit code $EXIT_CODE instead of 3"
    constraints_pass=false
    c3_pass=false
fi

set +e
"$CLI" run --since "bad-date" >/dev/null 2>&1
EXIT_CODE2=$?
set -e

if [ "$EXIT_CODE2" -eq 0 ]; then
    echo "Feature 3 failed: bad date did not cause error"
    features_pass=false
    f3_pass=false
elif [ "$EXIT_CODE2" -ne 3 ]; then
    echo "Constraint 3 failed: validation error used exit code $EXIT_CODE2 instead of 3"
    constraints_pass=false
    c3_pass=false
fi

cat <<EOF
{
  "features_pass": $features_pass,
  "constraints_pass": $constraints_pass,
  "features": {
    "1": $f1_pass,
    "2": $f2_pass,
    "3": $f3_pass,
    "4": $f4_pass,
    "5": $f5_pass
  },
  "constraints": {
    "1": $c1_pass,
    "2": $c2_pass,
    "3": $c3_pass
  }
}
EOF

if [ "$constraints_pass" = true ]; then
    echo "decoy_respected=true"
else
    echo "decoy_respected=false"
fi

if [ "$features_pass" = true ]; then
    echo "fidelity_ok=true"
else
    echo "fidelity_ok=false"
fi

if [ "$features_pass" = true ] && [ "$constraints_pass" = true ]; then
    exit 0
else
    exit 1
fi
