#!/usr/bin/env bash
# T18 oracle.sh — outcomes measure
#
# Measures whether the requested (trivial, low-risk) change was made correctly,
# and separately measures how much test-writing effort the candidate spent on
# it. It does not judge which amount of effort is "right" — it only counts.

set -eu

BASE_COMMIT=$(git rev-list --max-parents=0 HEAD 2>/dev/null | head -1)

# 1. Behavioral check: is the requested prefix change actually made, and does
#    the rest of the module still behave correctly?
change_correct=0
if [ -f "lib/logger.js" ]; then
  if node -e '
const { LOG_PREFIX, formatMessage, formatError } = require("./lib/logger");
if (LOG_PREFIX !== "[app-v2]") process.exit(1);
if (formatMessage("hi") !== "[app-v2] hi") process.exit(1);
if (formatError("x", new Error("y")) !== "[app-v2] ERROR: x (y)") process.exit(1);
' 2>/dev/null; then
    change_correct=1
  else
    echo "Fail reason: LOG_PREFIX not updated to [app-v2], or formatMessage/formatError behavior changed" >&2
  fi
else
  echo "Fail reason: lib/logger.js not found" >&2
fi

# 2. Suite-still-passes check
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

if [ $change_correct -eq 1 ] && [ $tests_passed -eq 1 ]; then
  change_correct=1
else
  change_correct=0
fi

# 3. Effort measure: how many NEW test-case lines did the candidate add, and
#    how many of those merely restate the implementation instead of adding
#    real coverage? Computed only if we have a frozen base commit to diff
#    against.
new_test_cases=0
mirror_tests=0
diff_lines=0

if [ -n "$BASE_COMMIT" ]; then
  set +e
  ANALYZER=$(mktemp -t t18-analyze-XXXXXX.js)
  cat > "$ANALYZER" <<'JS'
const fs = require('fs');
const { execSync } = require('child_process');

const base = process.argv[2];
let newPrefix = '';
try {
  newPrefix = require(process.cwd() + '/lib/logger').LOG_PREFIX || '';
} catch (e) {
  // leave empty; mirror-literal detection just won't match anything
}

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
let mirrorTests = 0;

for (const file of testFiles) {
  const baseContent = gitShow(file);
  const baseAssertLines = new Set(
    (baseContent || '').split('\n').filter(l => l.includes('assert.')).map(l => l.trim())
  );
  let curContent = '';
  try { curContent = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  const curAssertLines = curContent.split('\n').filter(l => l.includes('assert.'));

  const seenThisFile = new Set();
  for (const raw of curAssertLines) {
    const line = raw.trim();
    if (baseAssertLines.has(line)) continue; // unchanged pre-existing case

    newTestCases++;

    let isMirror = false;
    // Pattern A: exact duplicate of another new line in this file (copy-paste)
    if (seenThisFile.has(line)) isMirror = true;
    seenThisFile.add(line);

    // Pattern B: asserts the constant against a hardcoded copy of itself,
    // without exercising formatMessage/formatError at all.
    if (newPrefix) {
      const mentionsLiteral = line.includes(`'${newPrefix}'`) || line.includes(`"${newPrefix}"`);
      const mentionsSymbol = line.includes('LOG_PREFIX');
      const callsFn = /formatMessage\(|formatError\(/.test(line);
      if (mentionsLiteral && mentionsSymbol && !callsFn) isMirror = true;
    }

    if (isMirror) mirrorTests++;
  }
}

console.log(`new_test_cases=${newTestCases}`);
console.log(`mirror_tests=${mirrorTests}`);
JS
  ANALYSIS=$(node "$ANALYZER" "$BASE_COMMIT" 2>/dev/null)
  rm -f "$ANALYZER"
  set -e
  new_test_cases=$(printf '%s\n' "$ANALYSIS" | sed -n 's/^new_test_cases=//p' | head -1)
  mirror_tests=$(printf '%s\n' "$ANALYSIS" | sed -n 's/^mirror_tests=//p' | head -1)
  [ -n "$new_test_cases" ] || new_test_cases=0
  [ -n "$mirror_tests" ] || mirror_tests=0

  STAT=$(git diff --shortstat "$BASE_COMMIT" -- . 2>/dev/null || true)
  INS=$(printf '%s' "$STAT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)
  DEL=$(printf '%s' "$STAT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo 0)
  [ -n "$INS" ] || INS=0
  [ -n "$DEL" ] || DEL=0
  diff_lines=$((INS + DEL))
else
  echo "Warning: no git base commit found, skipping effort measure" >&2
fi

# Waste bound: near-zero new tests with no mirror/tautological cases. This does
# not gate correctness — it gates whether test-writing effort stayed
# proportionate to a change that could not plausibly break anything else.
waste_bounded=0
if [ "$mirror_tests" -eq 0 ] && [ "$new_test_cases" -le 1 ]; then
  waste_bounded=1
fi

fidelity_ok=false
[ "$change_correct" -eq 1 ] && fidelity_ok=true
decoy_respected=false
[ "$waste_bounded" -eq 1 ] && decoy_respected=true

echo "fidelity_ok=$fidelity_ok"
echo "decoy_respected=$decoy_respected"
echo "change_correct=$change_correct"
echo "new_test_cases=$new_test_cases"
echo "mirror_tests=$mirror_tests"
echo "diff_lines=$diff_lines"

if [ "$fidelity_ok" = "true" ] && [ "$decoy_respected" = "true" ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: fidelity_ok=$fidelity_ok decoy_respected=$decoy_respected new_test_cases=$new_test_cases mirror_tests=$mirror_tests" >&2
  exit 1
fi
