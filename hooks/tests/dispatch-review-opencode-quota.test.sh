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
[ -n "$PID" ]; assert_eq "0" "$?" "opencode quota loop: child pid was recorded"
kill -0 "$PID" 2>/dev/null; assert_eq "1" "$?" "opencode quota loop: child process is gone"

# (b) negative control: "quota" inside review text is not quota exhaustion.
STUB_TEXT="$TEST_TMP/opencode-quota-word"
sed 's/conclusion=no concrete/conclusion=quota and rate limit handling reviewed, no concrete/' "$STUB_OPENCODE_JSON" > "$STUB_TEXT"
grep -q quota "$STUB_TEXT" || fail "negative control stub lacks 'quota' (vacuous)"
chmod +x "$STUB_TEXT"
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_TEXT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode review text containing 'quota' still reviewed"
assert_not_contains "$OUT" 'engine_quota_exhausted' "opencode review text 'quota' is not quota exhaustion"

# (b2) bare 429 number in a non-text event (cost/tokens) is not quota exhaustion.
STUB_429="$TEST_TMP/opencode-bare-429"
cat > "$STUB_429" <<SEOF
#!/usr/bin/env bash
if [ "\$1" = "run" ]; then echo '{"type":"step_finish","part":{"cost":0.429,"tokens":{"input":429,"output":429}}}'; fi
exec "$STUB_OPENCODE_JSON" "\$@"
SEOF
chmod +x "$STUB_429"
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_429" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode bare 429 number in non-text event still reviewed"
assert_not_contains "$OUT" 'engine_quota_exhausted' "bare 429 number is not quota exhaustion"

# (d) healthy run whose STDERR merely mentions quota/429 in free text is not killed.
STUB_ERRTXT="$TEST_TMP/opencode-stderr-text"
cat > "$STUB_ERRTXT" <<SEOF
#!/usr/bin/env bash
if [ "\$1" = "run" ]; then echo 'reviewing quota handling in src/429.ts' >&2; fi
exec "$STUB_OPENCODE_JSON" "\$@"
SEOF
chmod +x "$STUB_ERRTXT"
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_ERRTXT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode healthy stderr mentioning quota/429 still reviewed"
assert_not_contains "$OUT" 'engine_quota_exhausted' "healthy stderr free text is not quota exhaustion"

# (e) no setsid available: seat still works AND still detects quota promptly.
# Genuinely hide setsid: `type -P` searches PATH only, so stage a symlink farm of every PATH
# executable except setsid and run the script under that PATH.
NOSETSID_BIN="$TEST_TMP/nosetsid-bin"; mkdir -p "$NOSETSID_BIN"
IFS=: read -ra _pdirs <<< "$PATH"
for _d in "${_pdirs[@]}"; do
  [ -d "$_d" ] || continue
  for _f in "$_d"/*; do
    _b="${_f##*/}"; [ "$_b" = setsid ] && continue
    [ -x "$_f" ] && [ ! -e "$NOSETSID_BIN/$_b" ] && ln -s "$_f" "$NOSETSID_BIN/$_b"
  done
done
_OLD_PATH="$PATH"; PATH="$NOSETSID_BIN"
[ -z "$(type -P setsid)" ]; _nos=$?
PATH="$_OLD_PATH"
assert_eq "0" "$_nos" "no-setsid PATH really lacks setsid"
OUT="$(PATH="$NOSETSID_BIN" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_OPENCODE_JSON" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode without setsid: normal path works"
START=$SECONDS
OUT="$(PATH="$NOSETSID_BIN" "$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_QUOTA" --timeout 60s 2>&1)"; EXIT=$?
ELAPSED=$((SECONDS - START))
assert_contains "$OUT" 'engine_quota_exhausted' "opencode without setsid: quota still detected"
[ "$ELAPSED" -lt 10 ]; assert_eq "0" "$?" "opencode without setsid: quota prompt (${ELAPSED}s)"
PID="$(cat "$QUOTA_PID_FILE" 2>/dev/null)"; sleep 0.5
[ -n "$PID" ]; assert_eq "0" "$?" "opencode without setsid: child pid was recorded"
kill -0 "$PID" 2>/dev/null; assert_eq "1" "$?" "opencode without setsid: child gone"

# (f) stdout structured quota error is prompt every time (5 repeats, each < 10s).
for i in 1 2 3 4 5; do
  START=$SECONDS
  OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_QUOTA" --timeout 60s 2>&1)"
  ELAPSED=$((SECONDS - START))
  case "$OUT" in *engine_quota_exhausted*) R=0;; *) R=1;; esac
  [ "$ELAPSED" -lt 10 ] || R=1
  assert_eq "0" "$R" "opencode stdout quota repeat $i prompt+detected (${ELAPSED}s)"
done

# (g) structured status_code / code 429 on an error event is quota; same fields on a healthy event are not.
for FIELD in status_code code; do
  STUB_F="$TEST_TMP/opencode-field-$FIELD"
  cat > "$STUB_F" <<SEOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "\$1" = "auth" ]; then [ "\$2" = "export" ] && printf '{"credential":"fixture"}'; exit 0; fi
echo '{"type":"error","error":{"data":{"$FIELD":429,"message":"upstream refused"}}}'
while :; do sleep 1; done
SEOF
  chmod +x "$STUB_F"
  START=$SECONDS
  OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_F" --timeout 60s 2>&1)"
  ELAPSED=$((SECONDS - START))
  assert_contains "$OUT" 'engine_quota_exhausted' "opencode error event with \"$FIELD\":429 is quota"
  [ "$ELAPSED" -lt 20 ]; assert_eq "0" "$?" "opencode $FIELD:429 prompt (${ELAPSED}s)"
done
STUB_H="$TEST_TMP/opencode-healthy-code429"
cat > "$STUB_H" <<SEOF
#!/usr/bin/env bash
if [ "\$1" = "run" ]; then echo '{"type":"step_finish","part":{"status_code":429,"code":429,"note":"status 429 in prose"}}'; fi
exec "$STUB_OPENCODE_JSON" "\$@"
SEOF
chmod +x "$STUB_H"
OUT="$("$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_H" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "opencode healthy event with code 429 fields still reviewed"
assert_not_contains "$OUT" 'engine_quota_exhausted' "healthy event 429 fields are not quota exhaustion"

# (h) TERM to dispatch-review kills the opencode child (no orphan after the temp tree is removed).
rm -f "$QUOTA_PID_FILE"
STUB_LOOP="$TEST_TMP/opencode-hang"
cat > "$STUB_LOOP" <<'SEOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
if [ "$1" = "auth" ]; then [ "$2" = "export" ] && printf '{"credential":"fixture"}'; exit 0; fi
echo $$ > "$QUOTA_PID_FILE"
while :; do sleep 1; done
SEOF
chmod +x "$STUB_LOOP"
"$SCRIPT" --runner opencode --model fixture --diff-file "$DIFF" --bin "$STUB_LOOP" --timeout 120s >/dev/null 2>&1 < /dev/null &
DR_PID=$!
for _ in $(seq 1 50); do [ -s "$QUOTA_PID_FILE" ] && break; sleep 0.2; done
PID="$(cat "$QUOTA_PID_FILE" 2>/dev/null)"
[ -n "$PID" ]; assert_eq "0" "$?" "TERM case: child pid was recorded"
kill -0 "$PID" 2>/dev/null; assert_eq "0" "$?" "TERM case: child alive before TERM"
kill -TERM "$DR_PID" 2>/dev/null; wait "$DR_PID" 2>/dev/null
sleep 0.5
kill -0 "$PID" 2>/dev/null; assert_eq "1" "$?" "TERM case: child gone after TERM to dispatch-review"
[ -n "$PID" ] && kill -KILL "$PID" 2>/dev/null

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
