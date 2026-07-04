#!/usr/bin/env bash
set -euo pipefail

# Ensure scripts directory exists
cd "$(dirname "$0")/../.."

echo "=== Syntax Check ==="
node --check scripts/probe-mutation.js
echo "Pass: Syntax check"

# Create a temporary directory for sandbox repo and findings store
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

SANDBOX_REPO="$TEST_DIR/sandbox"
mkdir -p "$SANDBOX_REPO"
git -C "$SANDBOX_REPO" init -b main

# Configure git user for commits
git -C "$SANDBOX_REPO" config user.name "Test User"
git -C "$SANDBOX_REPO" config user.email "test@example.com"

# Create initial state
echo "invariant_content" > "$SANDBOX_REPO/file.txt"
git -C "$SANDBOX_REPO" add file.txt
git -C "$SANDBOX_REPO" commit -m "initial commit"
HEAD_SHA=$(git -C "$SANDBOX_REPO" rev-parse HEAD)

echo "=== Test 1: Valid mutation case ==="
OUT=$(node scripts/probe-mutation.js \
  --repo "$SANDBOX_REPO" \
  --ref "$HEAD_SHA" \
  --probe 'grep -q "invariant_content" file.txt' \
  --mutate 'sed -i "s/invariant_content/broken_content/g" file.txt' \
  --json)

echo "$OUT"
STATUS=$(echo "$OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).status)')
if [ "$STATUS" != "probe_valid" ]; then
  echo "FAIL: Expected status probe_valid, got $STATUS"
  exit 1
fi
echo "Pass: Valid case status is probe_valid"


echo "=== Test 2: Vacuous probe case ==="
set +e
OUT=$(node scripts/probe-mutation.js \
  --repo "$SANDBOX_REPO" \
  --ref "$HEAD_SHA" \
  --probe 'true' \
  --mutate 'sed -i "s/invariant_content/broken_content/g" file.txt' \
  --json)
RC=$?
set -e
echo "$OUT"
if [ $RC -ne 1 ]; then
  echo "FAIL: Expected exit code 1, got $RC"
  exit 1
fi
STATUS=$(echo "$OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).status)')
if [ "$STATUS" != "vacuous_probe" ]; then
  echo "FAIL: Expected status vacuous_probe, got $STATUS"
  exit 1
fi
echo "Pass: Vacuous case status is vacuous_probe and exits 1"


echo "=== Test 3: Baseline failing case ==="
set +e
OUT=$(node scripts/probe-mutation.js \
  --repo "$SANDBOX_REPO" \
  --ref "$HEAD_SHA" \
  --probe 'grep -q "not_there" file.txt' \
  --mutate 'sed -i "s/invariant_content/broken_content/g" file.txt' \
  --json)
RC=$?
set -e
echo "$OUT"
if [ $RC -ne 2 ]; then
  echo "FAIL: Expected exit code 2, got $RC"
  exit 1
fi
STATUS=$(echo "$OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).status)')
if [ "$STATUS" != "baseline_failing" ]; then
  echo "FAIL: Expected status baseline_failing, got $STATUS"
  exit 1
fi
echo "Pass: Baseline failing case is baseline_failing and exits 2"


echo "=== Test 4: Mutation failed case ==="
set +e
OUT=$(node scripts/probe-mutation.js \
  --repo "$SANDBOX_REPO" \
  --ref "$HEAD_SHA" \
  --probe 'grep -q "invariant_content" file.txt' \
  --mutate 'false' \
  --json)
RC=$?
set -e
echo "$OUT"
if [ $RC -ne 2 ]; then
  echo "FAIL: Expected exit code 2, got $RC"
  exit 1
fi
STATUS=$(echo "$OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).status)')
if [ "$STATUS" != "mutation_failed" ]; then
  echo "FAIL: Expected status mutation_failed, got $STATUS"
  exit 1
fi
echo "Pass: Mutation failed case is mutation_failed and exits 2"


echo "=== Test 5: Mutation noop case ==="
set +e
OUT=$(node scripts/probe-mutation.js \
  --repo "$SANDBOX_REPO" \
  --ref "$HEAD_SHA" \
  --probe 'grep -q "invariant_content" file.txt' \
  --mutate 'true' \
  --json)
RC=$?
set -e
echo "$OUT"
if [ $RC -ne 2 ]; then
  echo "FAIL: Expected exit code 2, got $RC"
  exit 1
fi
STATUS=$(echo "$OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).status)')
if [ "$STATUS" != "mutation_noop" ]; then
  echo "FAIL: Expected status mutation_noop, got $STATUS"
  exit 1
fi
echo "Pass: Mutation noop case is mutation_noop and exits 2"


echo "=== Test 6: Missing/invalid arguments ==="
set +e
node scripts/probe-mutation.js --repo "$SANDBOX_REPO" --ref "$HEAD_SHA" --probe 'true'
RC1=$?
node scripts/probe-mutation.js --repo "$SANDBOX_REPO" --ref "invalid_ref" --probe 'true' --mutate 'true'
RC2=$?
set -e
if [ $RC1 -ne 2 ] || [ $RC2 -ne 2 ]; then
  echo "FAIL: Expected exit codes 2, got $RC1 and $RC2"
  exit 1
fi
echo "Pass: Invalid args exit 2"


echo "=== Test 7: Round-trip to adjudicate-findings.js refute ==="
STORE_FILE="$TEST_DIR/findings.jsonl"

# Add a finding
ADD_PAYLOAD='{"finding_id":"F1", "claim":"invariant is broken", "severity":"🔴", "source":"reviewer_a"}'
echo "$ADD_PAYLOAD" | node scripts/adjudicate-findings.js add --store "$STORE_FILE"

# Probe it with observed_matches_expected: false
PROBE_PAYLOAD='{"probe_cmd":"grep -q \"invariant_content\" file.txt", "expected_signature":"exit 1", "observed_output":"invariant_content", "observed_matches_expected":false}'
echo "$PROBE_PAYLOAD" | node scripts/adjudicate-findings.js probe --store "$STORE_FILE" --id "F1"

# Run probe-mutation.js to validate the refute case
OUT=$(node scripts/probe-mutation.js \
  --repo "$SANDBOX_REPO" \
  --ref "$HEAD_SHA" \
  --probe 'grep -q "invariant_content" file.txt' \
  --mutate 'sed -i "s/invariant_content/broken_content/g" file.txt' \
  --json)

# Filter JSON to match refute signature
REFUTE_PAYLOAD=$(echo "$OUT" | node -e '
  const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const refute = {
    mutation_desc: input.mutation_desc,
    mutation_probe_output: input.mutation_probe_output,
    probe_fired_under_mutation: input.probe_fired_under_mutation
  };
  console.log(JSON.stringify(refute));
')

# Feed to adjudicate-findings.js refute
echo "$REFUTE_PAYLOAD" | node scripts/adjudicate-findings.js refute --store "$STORE_FILE" --id "F1"

# Check status in store
STATUS_OUT=$(node scripts/adjudicate-findings.js status --store "$STORE_FILE" --id "F1" --json)
echo "$STATUS_OUT"
STATUS=$(echo "$STATUS_OUT" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).status)')
if [ "$STATUS" != "REFUTED" ]; then
  echo "FAIL: Expected finding F1 to be REFUTED, got $STATUS"
  exit 1
fi
echo "Pass: Finding successfully transitioned to REFUTED"


echo "=== Test 8: Leftover worktrees check ==="
WORKTREES_COUNT=$(git -C "$SANDBOX_REPO" worktree list | wc -l)
if [ "$WORKTREES_COUNT" -ne 1 ]; then
  echo "FAIL: Leftover worktrees found!"
  git -C "$SANDBOX_REPO" worktree list
  exit 1
fi
echo "Pass: No leftover worktrees (count is 1)"

echo "ALL TESTS PASSED!"
