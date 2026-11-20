#!/usr/bin/env bash
# Same-class review gate: fixture JSON only, no engine CLI.
. "$(dirname "$0")/lib.sh"

LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
CLASS_JS="$REPO_ROOT/scripts/lib/finding-class.js"
LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"
CHILD_ENV=(env -i "PATH=$PATH" "HOME=$TEST_TMP" "TMPDIR=$TEST_TMP")

run_loop() {
  "${CHILD_ENV[@]}" node "$LOOP" "$@" < /dev/null
}

assert_invalid() {
  local name="$1" file="$2" expect="$3"
  local err rc
  err="$("${CHILD_ENV[@]}" node "$CLASS_JS" validate-review "$file" 2>&1 >/dev/null)" || rc=$?
  rc=${rc:-0}
  assert_exit_code "$rc" "1" "$name exits 1"
  assert_contains "$err" "$expect" "$name names the schema failure"
}

cat > "$TEST_TMP/missing-class.json" <<'EOF'
{"findings":[{"class_sites":["a.js:1"]}]}
EOF
cat > "$TEST_TMP/empty-sites.json" <<'EOF'
{"findings":[{"class":"bad-value","class_sites":[]}]}
EOF
cat > "$TEST_TMP/ok.json" <<'EOF'
{"findings":[{"class":"bad-value","class_sites":["a.js:1","b.js:4"]}]}
EOF
assert_invalid "missing class" "$TEST_TMP/missing-class.json" "lacks class"
assert_invalid "empty class_sites" "$TEST_TMP/empty-sites.json" "empty class_sites"
ok_out="$("${CHILD_ENV[@]}" node "$CLASS_JS" validate-review "$TEST_TMP/ok.json" 2>&1)"
assert_exit_code "$?" "0" "complete review JSON is valid"
assert_contains "$ok_out" "bad-value" "complete review names the class"

cat > "$TEST_TMP/review.json" <<'EOF'
{"findings":[{"class":"bad-value","class_sites":["a.js:1"]}]}
EOF
cat > "$TEST_TMP/no-scan.json" <<'EOF'
{"note":"forgot the table"}
EOF
set +e
rej="$("${CHILD_ENV[@]}" node "$LOOP" fix-round --ledger "$LEDGER" --phase sweep --generation 1 \
  --review "$TEST_TMP/review.json" --report "$TEST_TMP/no-scan.json" --implementer-engine grok 2>&1)"
rej_rc=$?
set -e
assert_exit_code "$rej_rc" "1" "missing class_scan is rejected"
assert_contains "$rej" "missing class_scan for bad-value" "rejection names the class"
gate="$(cat "$LEDGER/review-sweep/class-gate.json")"
assert_contains "$gate" '"merged": false' "rejection is not merged"
assert_contains "$gate" '"missing_class": "bad-value"' "state names the missing class"

scan_for() {
  local klass="$1"
  printf '{"class_scan":[{"class":"%s","sites":[{"site":"a.js:1","test":"t.test.js"}]}]}\n' "$klass" > "$TEST_TMP/scan.json"
}

for klass in bad-value missing-field stale-age old-format display-surface; do
  printf '{"findings":[{"class":"%s","class_sites":["a.js:1"]}]}\n' "$klass" > "$TEST_TMP/prev.json"
  printf '{"findings":[{"class":"%s","class_sites":["b.js:9"]}]}\n' "$klass" > "$TEST_TMP/next.json"
  scan_for "$klass"
  out="$(run_loop fix-round --ledger "$LEDGER" --phase sweep --generation 2 \
    --review "$TEST_TMP/next.json" --report "$TEST_TMP/scan.json" --prev "$TEST_TMP/prev.json" \
    --implementer-engine grok --ladder grok,other-engine 2>&1)"
  assert_exit_code "$?" "0" "repeat $klass escalates"
  assert_contains "$out" "same_class_repeat:$klass" "repeat $klass records the reason"
  assert_contains "$out" '"to":"other-engine"' "repeat $klass leaves the same engine"
  brief="$(cat "$LEDGER/review-sweep/g2/hands-brief.md")"
  assert_contains "$brief" "Class $klass sites b.js:9" "brief lists the class sites"
  assert_contains "$brief" "class_scan" "brief requires class_scan"
done

printf '%s\n' '{"findings":[{"class":"bad-value","class_sites":["a.js:1"]}]}' > "$TEST_TMP/prev.json"
printf '%s\n' '{"findings":[{"class":"missing-field","class_sites":["c.js:3"]}]}' > "$TEST_TMP/next.json"
scan_for missing-field
out="$(run_loop fix-round --ledger "$LEDGER" --phase sweep --generation 2 \
  --review "$TEST_TMP/next.json" --report "$TEST_TMP/scan.json" --prev "$TEST_TMP/prev.json" \
  --implementer-engine grok --ladder grok,other-engine 2>&1)"
assert_exit_code "$?" "0" "a different class does not escalate"
assert_not_contains "$out" "same_class_repeat" "different class has no repeat reason"
assert_contains "$out" '"status":"accepted"' "different class is accepted"

printf '%s\n' '{"findings":[{"class":"Bad Value","class_sites":["a.js:1"]}]}' > "$TEST_TMP/prev.json"
printf '%s\n' '{"findings":[{"class":"bad_value","class_sites":["b.js:2"]}]}' > "$TEST_TMP/next.json"
printf '%s\n' '{"class_scan":[{"class":"bad-value ","sites":[{"site":"b.js:2","test":"t.test.js"}]}]}' > "$TEST_TMP/scan.json"
out="$(run_loop fix-round --ledger "$LEDGER" --phase sweep --generation 2 \
  --review "$TEST_TMP/next.json" --report "$TEST_TMP/scan.json" --prev "$TEST_TMP/prev.json" \
  --implementer-engine grok --ladder grok,other-engine 2>&1)"
assert_exit_code "$?" "0" "normalised class still matches"
assert_contains "$out" "same_class_repeat:bad-value" "Bad Value and bad_value are one class"

finalize_test
