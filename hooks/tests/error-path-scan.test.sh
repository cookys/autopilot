#!/usr/bin/env bash
# hooks/tests/error-path-scan.test.sh

. "$(dirname "$0")/lib.sh"

git init -q "$TEST_TMP/repo"
cd "$TEST_TMP/repo"
git config user.email "test@example.com"
git config user.name "Test"

# Setup base commit
echo "initial" > file.py
echo "initial" > file.js
echo "initial" > script.sh
echo "initial" > src.go
echo "initial" > src.rs
git add .
git commit -q -m "initial"

# Add seeded positives
cat <<'EOF' >> file.py
try:
  do_something()
except Exception: pass

try:
  do_other()
except Exception:
  print("err")
except:
  print("bare")
EOF

cat <<'EOF' >> file.js
try {
  foo();
} catch (e) {}
EOF

cat <<'EOF' >> script.sh
curl http://example.com || true
rm -f /tmp/foo || true
mkdir -p /tmp/bar || true
EOF

cat <<'EOF' >> src.go
_ = err
err != nil { }
EOF

cat <<'EOF' >> src.rs
let x = foo.unwrap_or_default();
EOF

echo "raise Exception('err')" >> error.py

git add .
# Don't commit, leave it in staged

# Run scanner
OUT="$(bash "$REPO_ROOT/scripts/error-path-scan.sh" --staged)"
EXIT=$?

assert_eq "0" "$EXIT" "exit code is 0"
assert_contains "$OUT" "swallowed_error" "detects swallowed errors"
assert_contains "$OUT" "broadened_catch" "detects broadened catch"
assert_contains "$OUT" "\"kind\":\"error_path_untested\"" "detects untested error path"
assert_contains "$OUT" "except Exception: pass" "shows py swallowed"
assert_contains "$OUT" "catch (e) {}" "shows js swallowed"
assert_contains "$OUT" "unwrap_or_default()" "shows rs swallowed"
assert_contains "$OUT" "curl http://example.com || true" "shows sh swallowed"
assert_not_contains "$OUT" "rm -f /tmp/foo || true" "does not flag trivial rm"
assert_not_contains "$OUT" "mkdir -p /tmp/bar || true" "does not flag trivial mkdir"
assert_contains "$OUT" "except Exception:" "shows py broadened"
assert_contains "$OUT" "except:" "shows py bare broadened"

# Test finding with test file
git reset --hard -q
echo "raise Exception('err')" > error.py
echo "test" > test_error.py
git add .
OUT2="$(bash "$REPO_ROOT/scripts/error-path-scan.sh" --staged)"
assert_not_contains "$OUT2" "\"kind\":\"error_path_untested\"" "no untested error path when tests modified"

finalize_test
