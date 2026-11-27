#!/usr/bin/env bash
# Same-class review gate: fixture JSON only, no engine CLI.
. "$(dirname "$0")/lib.sh"

LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
CLASS_JS="$REPO_ROOT/scripts/lib/finding-class.js"
LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"
# the Fleet-Task open check asks the fleet; point it at a stub so the suite never reaches the real fleet
FLEET_STUB="$TEST_TMP/fleet-open"; printf '#!/bin/sh\necho "{\\"status\\":\\"open\\"}"\n' > "$FLEET_STUB"; chmod +x "$FLEET_STUB"
CHILD_ENV=(env -i "PATH=$PATH" "HOME=$TEST_TMP" "TMPDIR=$TEST_TMP" "AUTOPILOT_FLEET_TASK=01M8F07G74HH0N19TG1BPQPE59" "FLEET_BIN=$FLEET_STUB")

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

# Production collect (not fix-round) refuses the next generation without class_scan.
REPO="$TEST_TMP/repo"
mkdir -p "$REPO/scripts"
(
  cd "$REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "c1"
  echo "second" > file.txt
  git add file.txt
  git commit -q -m "c2"
  git checkout -q -b work
)
BASE=$(git -C "$REPO" rev-parse HEAD~1)
HEAD1=$(git -C "$REPO" rev-parse HEAD)
mkdir -p "$TEST_TMP/collect-ledger/review-prod/g1"
printf '%s\n' "{\"findings\":[{\"id\":\"f1\",\"severity\":\"Major\",\"seat\":\"s0\",\"text\":\"bad\",\"class\":\"bad-value\",\"class_sites\":[\"a.js:1\"]}]}" > "$TEST_TMP/collect-ledger/review-prod/g1/findings.json"
printf '%s\n' "[{\"generation\":1,\"base\":\"$BASE\",\"head\":\"$HEAD1\",\"status\":\"finalized\",\"seats\":[{\"id\":\"s0\",\"status\":\"reviewed\",\"engine\":\"gpt-m1\",\"family\":\"openai\"}]}]" > "$TEST_TMP/collect-ledger/review-prod/chain.json"
(
  cd "$REPO"
  echo "third" >> file.txt
  git add file.txt
  git commit -q -m "c3"
)
STUB="$TEST_TMP/dispatch-stub.sh"
cat > "$STUB" << 'EOF'
#!/usr/bin/env bash
printf '%s\n' "$STUB_SEAT_RESPONSE"
EOF
chmod +x "$STUB"
export STUB_SEAT_RESPONSE='{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"none","no_finding_proof":"checked=all; evidence=clean; conclusion=safe"}'
COLLECT_ENV=(env -i "AUTOPILOT_FLEET_TASK=01M8F07G74HH0N19TG1BPQPE59" "FLEET_BIN=$FLEET_STUB" "PATH=$PATH" "HOME=$TEST_TMP" "TMPDIR=$TEST_TMP" "AUTOPILOT_TEST_CN_GATE_OFF=1" "AUTOPILOT_DISPATCH_REVIEW_SCRIPT=$STUB" "STUB_SEAT_RESPONSE=$STUB_SEAT_RESPONSE")
set +e
col="$("${COLLECT_ENV[@]}" node "$LOOP" collect --implementer-engine claude-sonnet-5 --repo-root "$REPO" --ledger "$TEST_TMP/collect-ledger" --phase prod --generation 2 --branch work --seats "gpt-m1/low@codex" 2>&1)"
col_rc=$?
set -e
assert_exit_code "$col_rc" "1" "collect without class_scan exits 1"
assert_contains "$col" "missing class_scan for bad-value" "collect names the missing class"
assert_file_absent "$TEST_TMP/collect-ledger/review-prod/g2" "collect does not open the next generation"
gate="$(cat "$TEST_TMP/collect-ledger/review-prod/class-gate.json")"
assert_contains "$gate" '"missing_class": "bad-value"' "collect gate names the class"
printf '%s\n' '{"class_scan":[{"class":"bad-value","sites":["a.js:1"]}]}' > "$TEST_TMP/collect-ledger/review-prod/class-scan.json"
set +e
bad="$("${COLLECT_ENV[@]}" node "$LOOP" collect --implementer-engine claude-sonnet-5 --repo-root "$REPO" --ledger "$TEST_TMP/collect-ledger" --phase prod --generation 2 --branch work --seats "gpt-m1/low@codex" 2>&1)"
bad_rc=$?
set -e
assert_exit_code "$bad_rc" "1" "collect rejects a string site with no test"
assert_contains "$bad" "missing class_scan for bad-value" "malformed class_scan names the class"
printf '%s\n' '{"class_scan":[{"class":"bad-value","sites":[{"site":"a.js:1","test":"a.test.js"}]}]}' > "$TEST_TMP/collect-ledger/review-prod/class-scan.json"
set +e
okc="$("${COLLECT_ENV[@]}" node "$LOOP" collect --implementer-engine claude-sonnet-5 --repo-root "$REPO" --ledger "$TEST_TMP/collect-ledger" --phase prod --generation 2 --branch work --seats "gpt-m1/low@codex" 2>&1)"
okc_rc=$?
set -e
assert_exit_code "$okc_rc" "0" "collect accepts a covered class_scan"
assert_file_exists "$TEST_TMP/collect-ledger/review-prod/g2/findings.json" "collect wrote the next generation"

# Plain text and mixed reviews take the invalid-review path inside collect.
PLAIN_LEDGER="$TEST_TMP/plain-ledger"
mkdir -p "$PLAIN_LEDGER"
export STUB_SEAT_RESPONSE='{"status":"reviewed","verdict":"FIX-THEN-SHIP","findings":"🟠 [id] MUST-FIX skipped site"}'
PLAIN_ENV=(env -i "AUTOPILOT_FLEET_TASK=01M8F07G74HH0N19TG1BPQPE59" "FLEET_BIN=$FLEET_STUB" "PATH=$PATH" "HOME=$TEST_TMP" "TMPDIR=$TEST_TMP" "AUTOPILOT_TEST_CN_GATE_OFF=1" "AUTOPILOT_DISPATCH_REVIEW_SCRIPT=$STUB" "STUB_SEAT_RESPONSE=$STUB_SEAT_RESPONSE")
set +e
plain="$("${PLAIN_ENV[@]}" node "$LOOP" collect --implementer-engine claude-sonnet-5 --repo-root "$REPO" --ledger "$PLAIN_LEDGER" --phase plain --generation 1 --branch work --phase-base "$BASE" --seats "gpt-m1/low@codex" 2>&1)"
plain_rc=$?
set -e
assert_exit_code "$plain_rc" "1" "plain finding without class is invalid"
assert_contains "$plain" "invalid review" "plain finding uses the invalid-review path"
assert_contains "$plain" "lacks class" "plain finding names the missing class metadata"
chain="$(cat "$PLAIN_LEDGER/review-plain/chain.json")"
assert_contains "$chain" '"reason": "invalid_review"' "plain finding aborts as invalid_review"

# Severity word without MUST-FIX is still a finding and needs class metadata.
printf '%s\n' 'Major [id] broken check' > "$TEST_TMP/severity-only.txt"
set +e
sev="$("${CHILD_ENV[@]}" node "$CLASS_JS" validate-review-text "$TEST_TMP/severity-only.txt" 2>&1)"
sev_rc=$?
set -e
assert_exit_code "$sev_rc" "1" "severity word without MUST-FIX exits 1"
assert_contains "$sev" "lacks class" "severity word without MUST-FIX lacks class"

# Two emoji headers: metadata on only one is invalid; metadata on each counts as two.
printf '%s\n' '🟠 [id-a] first' 'class: emoji-split' 'class_sites: a.js:1' '🟠 [id-b] second has no metadata' > "$TEST_TMP/emoji-one.txt"
set +e
one="$("${CHILD_ENV[@]}" node "$CLASS_JS" validate-review-text "$TEST_TMP/emoji-one.txt" 2>&1)"
one_rc=$?
set -e
assert_exit_code "$one_rc" "1" "two emoji findings with one metadata pair exit 1"
assert_contains "$one" "lacks class" "collapsed emoji finding lacks class"

printf '%s\n' '🟠 [id-a] first' 'class: emoji-a' 'class_sites: a.js:1' '🟠 [id-b] second' 'class: emoji-b' 'class_sites: b.js:2' > "$TEST_TMP/emoji-two.txt"
node -e '
const fs = require("fs");
const findingClass = require(process.argv[1]);
const result = findingClass.validateReviewText(fs.readFileSync(process.argv[2], "utf8"));
if (!result.ok || result.findings.length !== 2) process.exit(1);
if (result.findings[0].class !== "emoji-a" || result.findings[1].class !== "emoji-b") process.exit(1);
' "$CLASS_JS" "$TEST_TMP/emoji-two.txt" < /dev/null
assert_exit_code "$?" "0" "two emoji findings with metadata count as two"

finalize_test
