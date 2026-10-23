#!/usr/bin/env bash
# dispatch-review.sh opencode quota fail-fast + BL-0287 (printf option error). Stubs only.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/dispatch-review-fixtures.sh"
export DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0

# (a) quota error on stdout NDJSON, then loops forever (retry loop). Must exit promptly.
STUB_QUOTA="$TEST_TMP/opencode-quota-loop"
cat > "$STUB_QUOTA" <<'SEOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "export" ]; then printf '{"credential":"fixture"}'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "import" ]; then exit 0; fi
echo $$ > "$QUOTA_PID_FILE"
echo '{"type":"error","error":{"name":"APIError","data":{"message":"You exceeded your current quota (insufficient_quota)"}}}'
while :; do sleep 1; done
SEOF
chmod +x "$STUB_QUOTA"
export QUOTA_PID_FILE="$TEST_TMP/quota.pid"
START=$SECONDS
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_QUOTA" --timeout 60s 2>&1)"; EXIT=$?
ELAPSED=$((SECONDS - START))
assert_eq "1" "$EXIT" "opencode quota loop: no_verdict exit 1"
assert_contains "$OUT" 'engine_quota_exhausted' "opencode quota loop: distinct reason recorded"
assert_not_contains "$OUT" 'rc=124' "opencode quota loop: not a bare timeout"
[ "$ELAPSED" -lt 20 ]; assert_eq "0" "$?" "opencode quota loop: exits promptly (${ELAPSED}s)"
PID="$(cat "$QUOTA_PID_FILE" 2>/dev/null)"
sleep 0.5
kill -0 "$PID" 2>/dev/null; assert_eq "1" "$?" "opencode quota loop: child process is gone"

# (b) negative control: "quota" inside review text is not quota exhaustion.
STUB_TEXT="$TEST_TMP/opencode-quota-word"
sed 's/conclusion=no concrete/conclusion=quota and rate limit handling reviewed, no concrete/' "$STUB_OPENCODE_JSON" > "$STUB_TEXT"
chmod +x "$STUB_TEXT"
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_TEXT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode review text containing 'quota' still reviewed"
assert_not_contains "$OUT" 'engine_quota_exhausted' "opencode review text 'quota' is not quota exhaustion"

# (c) normal stub unchanged.
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_OPENCODE_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode normal path exit 0"
assert_contains "$OUT" '"verdict": "SHIP-AS-IS"' "opencode normal path verdict"

# BL-0287: spec-file block must not leak printf option errors on stderr (cc-shim path).
SPEC="$TEST_TMP/spec.md"; printf 'spec\n' > "$SPEC"
ERRF="$TEST_TMP/ccshim.err"
"$SCRIPT" --runner cc-shim --model fixture --diff-file "$DIFF" --spec-file "$SPEC" --bin "$STUB_SPAWN_MARKER" >/dev/null 2>"$ERRF"
assert_not_contains "$(cat "$ERRF")" 'invalid option' "cc-shim spec path leaves stderr free of 'invalid option'"
finalize_test
