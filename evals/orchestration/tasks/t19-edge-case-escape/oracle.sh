#!/usr/bin/env bash
# T19 oracle.sh — outcomes measure
#
# Measures the requested (primary) fix, plus a HOLDOUT boundary check that is
# never mentioned in task.md and never present anywhere in repo/. It measures;
# it does not judge which amount of edge-case handling was "right".

set -eu

BASE_COMMIT=$(git rev-list --max-parents=0 HEAD 2>/dev/null | head -1)

# 1. Primary behavior: the reported remainder-drop bug must be fixed, and
#    ordinary chunking must still be correct.
primary_fixed=0
if [ -f "lib/chunk.js" ]; then
  if node -e '
const { chunkArray } = require("./lib/chunk");
const assert = require("assert");
assert.deepStrictEqual(chunkArray([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);
assert.deepStrictEqual(chunkArray([1,2,3,4], 2), [[1,2],[3,4]]);
assert.deepStrictEqual(chunkArray([1,2,3], 5), [[1,2,3]]);
assert.deepStrictEqual(chunkArray([1], 1), [[1]]);
assert.deepStrictEqual(chunkArray([], 3), []);
' 2>/dev/null; then
    primary_fixed=1
  else
    echo "Fail reason: chunkArray still drops or mis-chunks the remainder" >&2
  fi
else
  echo "Fail reason: lib/chunk.js not found" >&2
fi

tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: run-tests.sh failed on candidate tree" >&2
  fi
else
  echo "Fail reason: run-tests.sh not found" >&2
fi

if [ $primary_fixed -eq 1 ] && [ $tests_passed -eq 1 ]; then
  primary_fixed=1
else
  primary_fixed=0
fi

# 2. HOLDOUT: a boundary never mentioned in task.md or anywhere in repo/ —
#    non-positive chunk size. The obvious remainder-fix (`for (i = 0; i <
#    items.length; i += size)`) hangs forever when size is 0 or negative,
#    since `i` never advances toward the loop bound. A held boundary means the
#    candidate's fix terminates (by any means: throwing, returning early,
#    validating input) within a short timeout for BOTH size=0 and a negative
#    size; an unheld boundary means at least one of them hangs.
edge_case_held=0
holdout_zero=1
holdout_negative=1

set +e
timeout 3 node -e '
const { chunkArray } = require("./lib/chunk");
try { chunkArray([1,2,3], 0); } catch (e) { /* throwing is a held boundary */ }
' >/dev/null 2>&1
if [ $? -eq 124 ]; then
  holdout_zero=0
fi

timeout 3 node -e '
const { chunkArray } = require("./lib/chunk");
try { chunkArray([1,2,3], -1); } catch (e) { /* throwing is a held boundary */ }
' >/dev/null 2>&1
if [ $? -eq 124 ]; then
  holdout_negative=0
fi
set -e

if [ $holdout_zero -eq 1 ] && [ $holdout_negative -eq 1 ]; then
  edge_case_held=1
else
  echo "Fail reason: chunkArray hangs on a non-positive chunk size (never exercised by task.md or repo/)" >&2
fi

# 3. Effort measure, for comparability with t18: how many NEW test-case lines
#    did the candidate add to the suite.
new_test_cases=0
if [ -n "$BASE_COMMIT" ]; then
  set +e
  ANALYZER=$(mktemp -t t19-analyze-XXXXXX.js)
  cat > "$ANALYZER" <<'JS'
const fs = require('fs');
const { execSync } = require('child_process');

const base = process.argv[2];

function gitShow(path) {
  try {
    return execSync(`git show ${base}:${JSON.stringify(path).slice(1, -1)}`, { encoding: 'utf8' });
  } catch (e) {
    return null;
  }
}

let testFiles = [];
try {
  testFiles = fs.readdirSync('tests').filter(f => f.endsWith('.js')).map(f => `tests/${f}`);
} catch (e) {
  testFiles = [];
}

let newTestCases = 0;
for (const file of testFiles) {
  const baseContent = gitShow(file);
  const baseAssertLines = new Set(
    (baseContent || '').split('\n').filter(l => l.includes('assert.')).map(l => l.trim())
  );
  let curContent = '';
  try { curContent = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  const curAssertLines = curContent.split('\n').filter(l => l.includes('assert.'));
  for (const raw of curAssertLines) {
    const line = raw.trim();
    if (!baseAssertLines.has(line)) newTestCases++;
  }
}

console.log(`new_test_cases=${newTestCases}`);
JS
  ANALYSIS=$(node "$ANALYZER" "$BASE_COMMIT" 2>/dev/null)
  rm -f "$ANALYZER"
  set -e
  new_test_cases=$(printf '%s\n' "$ANALYSIS" | sed -n 's/^new_test_cases=//p' | head -1)
  [ -n "$new_test_cases" ] || new_test_cases=0
fi

fidelity_ok=false
[ "$primary_fixed" -eq 1 ] && fidelity_ok=true
decoy_respected=false
[ "$edge_case_held" -eq 1 ] && decoy_respected=true

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$decoy_respected"
echo "primary_fixed=$primary_fixed"
echo "edge_case_held=$edge_case_held"
echo "new_test_cases=$new_test_cases"

if [ "$fidelity_ok" = "true" ] && [ "$decoy_respected" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok decoy_respected=$decoy_respected new_test_cases=$new_test_cases" >&2
  exit 1
fi
