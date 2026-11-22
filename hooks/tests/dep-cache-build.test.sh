#!/usr/bin/env bash
# Runtime dependencies include only files actually loaded by each suite.
. "$(dirname "$0")/lib.sh"
fixture="$TEST_TMP/repo"
mkdir -p "$fixture/scripts" "$fixture/hooks/tests" "$fixture/lib"
git -C "$fixture" init -q
git -C "$fixture" -c user.name=Test -c user.email=test@example.invalid commit --allow-empty -qm fixture
printf 'module.exports = 1;\n' > "$fixture/lib/a.js"
printf 'module.exports = 2;\n' > "$fixture/lib/b.js"
printf 'module.exports = 3;\n' > "$fixture/lib/c.js"
printf 'module.exports = 4;\n' > "$fixture/lib/d.js"
cat > "$fixture/scripts/x.test.js" <<'JS'
require('../lib/a');
function run() { require('../lib/b'); }
run();
JS
printf ':\n' > "$fixture/hooks/tests/helper.sh"
printf "require('../../lib/d');\n" > "$fixture/hooks/tests/child.js"
cat > "$fixture/hooks/tests/y.test.sh" <<'SH'
. hooks/tests/helper.sh
node hooks/tests/child.js
SH
printf 'sleep 10\n' > "$fixture/hooks/tests/slow.test.sh"
builder="${DEP_CACHE_BUILDER:-$REPO_ROOT/scripts/build-dep-cache.js}"
timeout 25 node "$builder" --repo "$fixture" --suites scripts/x.test.js,hooks/tests/y.test.sh,hooks/tests/slow.test.sh --out "$TEST_TMP/cache.json" --timeout-s 2 > "$TEST_TMP/out" 2> "$TEST_TMP/err"
assert_eq "$?" 0 'builder succeeds'
assert_eq "$(cat "$TEST_TMP/out")" '' 'builder stdout silent'
assert_eq "$(cat "$TEST_TMP/err")" '' 'builder stderr silent'
if [ -f "$TEST_TMP/cache.json" ]; then
  x="$(node -e 'console.log(JSON.stringify(require(process.argv[1]).suites["scripts/x.test.js"].files))' "$TEST_TMP/cache.json")"
  y="$(node -e 'console.log(JSON.stringify(require(process.argv[1]).suites["hooks/tests/y.test.sh"].files))' "$TEST_TMP/cache.json")"
  slow="$(node -e 'console.log(JSON.stringify(require(process.argv[1]).suites["hooks/tests/slow.test.sh"]))' "$TEST_TMP/cache.json")"
  assert_contains "$x" 'lib/a.js' 'x loads a.js'
  assert_contains "$x" 'lib/b.js' 'x executes lazy b.js'
  assert_not_contains "$x" 'lib/c.js' 'x never loads c.js'
  assert_contains "$y" 'hooks/tests/helper.sh' 'y sources helper'
  assert_contains "$y" 'lib/d.js' 'y child loads d.js'
  assert_contains "$slow" '"rc":124' 'timeout exit code'
  assert_contains "$slow" '"traced":false' 'timeout is untrusted'
else
  fail 'cache file missing'
fi
AUTOPILOT_DEP_TRACE_FILE="$TEST_TMP/direct" AUTOPILOT_DEP_TRACE_ROOT="$fixture" NODE_OPTIONS="--require $REPO_ROOT/scripts/lib/dep-trace-hook.js" node -e '' > "$TEST_TMP/direct-out" 2> "$TEST_TMP/direct-err"
assert_eq "$(cat "$TEST_TMP/direct-out" "$TEST_TMP/direct-err")" '' 'node preload is silent'
AUTOPILOT_DEP_TRACE_FILE="$TEST_TMP/direct" BASH_ENV="$REPO_ROOT/scripts/lib/dep-trace-bash.sh" bash -c ':' > "$TEST_TMP/direct-out" 2> "$TEST_TMP/direct-err"
assert_eq "$(cat "$TEST_TMP/direct-out" "$TEST_TMP/direct-err")" '' 'bash preload is silent'
finalize_test
