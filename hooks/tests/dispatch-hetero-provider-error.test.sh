#!/usr/bin/env bash
# Structured provider-error evidence on dispatch-hetero (owner d-8e9de3b3, option A).
# RED at 740f48841: cc-shim 529 envelope and opencode APIError were engine_unavailable from log text and had no provider_error key (2 failed, 1 passed).
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID \
  AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$(mktemp -d "$TEST_TMP/cap.XXXXXX")"
export DISPATCH_QUIET=1

SCRIPT="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email "t@t"
git -C "$SBX" config user.name "t"
git -C "$SBX" commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"
printf 'update repo file\n' > "$PROMPT"

last_json() {
  printf '%s\n' "$1" | grep '^{' | tail -n 1
}

assert_provider() {
  local json="$1" runner="$2" status="$3" field="$4" label="$5"
  node -e '
    const o = JSON.parse(process.argv[1]);
    const p = o.provider_error;
    if (!p || p.source !== "harness_structured" || p.runner !== process.argv[2]
        || p.http_status !== Number(process.argv[3]) || p.field !== process.argv[4]
        || o.status !== "engine_unavailable") {
      console.error(JSON.stringify(o));
      process.exit(1);
    }
  ' "$json" "$runner" "$status" "$field" || fail "$label"
}

assert_no_provider_key() {
  local json="$1" label="$2"
  node -e '
    const o = JSON.parse(process.argv[1]);
    if (Object.prototype.hasOwnProperty.call(o, "provider_error")) {
      console.error(JSON.stringify(o.provider_error));
      process.exit(1);
    }
  ' "$json" || fail "$label"
}

assert_error_category() {
  local json="$1" expected="$2" label="$3"
  node -e '
    const o = JSON.parse(process.argv[1]);
    const exp = process.argv[2] === "null" ? null : process.argv[2];
    if (!Object.prototype.hasOwnProperty.call(o, "error_category") || o.error_category !== exp) {
      console.error("error_category", JSON.stringify(o.error_category));
      process.exit(1);
    }
  ' "$json" "$expected" || fail "$label"
}

run_cc() {
  local stub="$1" branch="$2"
  local bindir="$TEST_TMP/bin-$branch"
  mkdir -p "$bindir"
  ln -sfn "$stub" "$bindir/claude"
  (cd "$SBX" && env PATH="$bindir:$PATH" \
      ANTHROPIC_BASE_URL="http://127.0.0.1:9" ANTHROPIC_AUTH_TOKEN="test-token" \
      AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
      "$SCRIPT" --runner cc-shim --model mini --branch "$branch" \
      --prompt-file "$PROMPT" --context-window off 2>&1)
}

# a. structured 529 on the harness envelope
STUB_A="$TEST_TMP/claude-529"
cat > "$STUB_A" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,api_error_status:529,terminal_reason:"api_error",result:"API Error: 529 overloaded"})+"\n")'
exit 1
EOF
chmod +x "$STUB_A"
OUT="$(run_cc "$STUB_A" feat/pe-a)"
JSON="$(last_json "$OUT")"
assert_provider "$JSON" cc-shim 529 api_error_status "cc-shim 529 envelope is harness_structured engine_unavailable"

# b. success-shaped envelope whose result TEXT mentions 529
STUB_B="$TEST_TMP/claude-text"
cat > "$STUB_B" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:false,subtype:"success",result:"API Error: 529 overloaded please retry"})+"\n")'
exit 1
EOF
chmod +x "$STUB_B"
OUT="$(run_cc "$STUB_B" feat/pe-b)"
JSON="$(last_json "$OUT")"
assert_no_provider_key "$JSON" "cc-shim success envelope with 529 prose has no provider_error"

# c. 529 only inside a nested text field, not top-level api_error_status
STUB_C="$TEST_TMP/claude-nested"
cat > "$STUB_C" <<'EOF'
#!/usr/bin/env bash
node -e '
  const nested = JSON.stringify({type:"result",is_error:true,api_error_status:529});
  process.stdout.write(JSON.stringify({type:"result",is_error:true,result:"529 overloaded\n"+nested})+"\n");
'
exit 1
EOF
chmod +x "$STUB_C"
OUT="$(run_cc "$STUB_C" feat/pe-c)"
JSON="$(last_json "$OUT")"
assert_no_provider_key "$JSON" "nested fake api_error_status is not the envelope field"

# d. opencode APIError event vs text event
STUB_OC="$TEST_TMP/opencode-api"
cat > "$STUB_OC" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
cat >/dev/null
printf '%s\n' '{"type":"error","error":{"name":"APIError","data":{"statusCode":529,"isRetryable":true,"message":"overloaded"}}}'
exit 1
EOF
chmod +x "$STUB_OC"
OUT="$(cd "$SBX" && AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  "$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor \
  --branch feat/pe-oc --prompt-file "$PROMPT" --opencode-bin "$STUB_OC" --context-window off 2>&1)"
JSON="$(last_json "$OUT")"
assert_provider "$JSON" opencode 529 error.data.statusCode "opencode APIError statusCode 529 is harness_structured"

STUB_OCT="$TEST_TMP/opencode-text"
cat > "$STUB_OCT" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo 1.19.2; exit 0; fi
cat >/dev/null
printf '%s\n' '{"type":"text","part":{"text":"529 overloaded"}}'
exit 1
EOF
chmod +x "$STUB_OCT"
OUT="$(cd "$SBX" && AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  "$SCRIPT" --runner opencode --model opencode-go/muse-spark-1.3-contributor \
  --branch feat/pe-oct --prompt-file "$PROMPT" --opencode-bin "$STUB_OCT" --context-window off 2>&1)"
JSON="$(last_json "$OUT")"
assert_no_provider_key "$JSON" "opencode text event saying 529 has no provider_error"

# e. agy has no structured source: text 529 keeps today's status and omits provider_error
STUB_AGY="$TEST_TMP/agy-text"
cat > "$STUB_AGY" <<'EOF'
#!/usr/bin/env bash
echo "529 overloaded"
exit 1
EOF
chmod +x "$STUB_AGY"
make_agy_stub_versioned "$STUB_AGY"
OUT="$(cd "$SBX" && AUTOPILOT_STRIKE_WRITER=off ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  "$SCRIPT" --runner agy --model gemini-3.7-flash --agy-bin "$STUB_AGY" \
  --branch feat/pe-agy --prompt-file "$PROMPT" --context-window off 2>&1)"
JSON="$(last_json "$OUT")"
assert_no_provider_key "$JSON" "agy text 529 does not gain provider_error"
assert_contains "$JSON" '"status": "question_suspected"' "agy stdout is not the classified log, so text 529 stays question_suspected"

# f. classify-error text category is diagnostic on the dispatch JSON.
# Plain cc-shim bytes (not a structured envelope) so CLASSIFIED_ERROR is overloaded
# and provider_error stays absent. Unclassifiable text leaves error_category null.
# # RED at 0e85be316: no error_category key yet (TypeError / missing key).
STUB_OL="$TEST_TMP/claude-overloaded-text"
cat > "$STUB_OL" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'server overloaded'
exit 1
EOF
chmod +x "$STUB_OL"
OUT="$(run_cc "$STUB_OL" feat/pe-ol)"
JSON="$(last_json "$OUT")"
assert_error_category "$JSON" overloaded "plain overloaded text sets error_category"
assert_no_provider_key "$JSON" "plain overloaded text has no provider_error"

STUB_UNK="$TEST_TMP/claude-unclassifiable"
cat > "$STUB_UNK" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'zzznoclass zzznoclass'
exit 1
EOF
chmod +x "$STUB_UNK"
OUT="$(run_cc "$STUB_UNK" feat/pe-unk)"
JSON="$(last_json "$OUT")"
assert_error_category "$JSON" null "unclassifiable failure has null error_category"
assert_no_provider_key "$JSON" "unclassifiable failure has no provider_error"

# --- Fix 1: cc-shim LOG stays diagnosable after the envelope split ---
log_text() {
  node -e 'const o=JSON.parse(process.argv[1]); process.stdout.write(require("fs").readFileSync(o.agent_log,"utf8"));' "$1"
}

# is_error is not true: result text is in the log; exit 0 + no edits → no_op.
STUB_OK="$TEST_TMP/claude-log-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo "STDERR_KEPT_MARKER" >&2
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:false,subtype:"success",result:"nothing to do here"})+"\n")'
exit 0
EOF
chmod +x "$STUB_OK"
OUT="$(run_cc "$STUB_OK" feat/pe-log-ok)"
JSON="$(last_json "$OUT")"
LOGTXT="$(log_text "$JSON")"
assert_contains "$LOGTXT" "nothing to do here" "success envelope appends result text"
assert_not_contains "$LOGTXT" '"is_error"' "success envelope does not append the raw JSON"
assert_contains "$LOGTXT" "STDERR_KEPT_MARKER" "cc-shim stderr still reaches the agent log"
assert_contains "$JSON" '"status": "no_op"' "exit 0 with no edits is no_op"

# is_error true, empty result: the error message text is what the log gets.
STUB_ERRMSG="$TEST_TMP/claude-log-errmsg"
cat > "$STUB_ERRMSG" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,result:"",error:"please say which file you want changed"})+"\n")'
exit 1
EOF
chmod +x "$STUB_ERRMSG"
OUT="$(run_cc "$STUB_ERRMSG" feat/pe-log-errmsg)"
JSON="$(last_json "$OUT")"
LOGTXT="$(log_text "$JSON")"
assert_contains "$LOGTXT" "please say which file you want changed" "is_error with empty result appends the error message"
assert_not_contains "$LOGTXT" '"api_error_status"' "error-message append is not the raw envelope"
assert_contains "$JSON" '"status": "question_suspected"' "question-shaped failure text is question_suspected"

# is_error true with result text (the question the old plain mode would have logged).
STUB_Q="$TEST_TMP/claude-log-question"
cat > "$STUB_Q" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,result:"I need to ask a clarifying question before editing"})+"\n")'
exit 1
EOF
chmod +x "$STUB_Q"
OUT="$(run_cc "$STUB_Q" feat/pe-log-q)"
JSON="$(last_json "$OUT")"
LOGTXT="$(log_text "$JSON")"
assert_contains "$LOGTXT" "I need to ask a clarifying question before editing" "is_error result text is in the log"
assert_contains "$JSON" '"status": "question_suspected"' "question result text keeps question_suspected"

# Not one JSON object (two documents): raw stdout, unchanged.
STUB_MULTI="$TEST_TMP/claude-log-multi"
cat > "$STUB_MULTI" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"type":"result","is_error":false,"result":"first document"}'
printf '%s\n' '{"type":"result","is_error":false,"result":"I need to ask a clarifying question before editing"}'
exit 1
EOF
chmod +x "$STUB_MULTI"
OUT="$(run_cc "$STUB_MULTI" feat/pe-log-multi)"
JSON="$(last_json "$OUT")"
LOGTXT="$(log_text "$JSON")"
assert_contains "$LOGTXT" '"result":"first document"' "multi-document stdout is appended raw"
assert_contains "$LOGTXT" "I need to ask a clarifying question before editing" "raw multi-document keeps the question text"
assert_contains "$JSON" '"status": "question_suspected"' "multi-document question text is question_suspected"

# Non-zero exit, envelope has no result text: raw bytes (not a dropped log).
STUB_RAW="$TEST_TMP/claude-log-rawnz"
cat > "$STUB_RAW" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:false})+"\n")'
exit 1
EOF
chmod +x "$STUB_RAW"
OUT="$(run_cc "$STUB_RAW" feat/pe-log-rawnz)"
JSON="$(last_json "$OUT")"
LOGTXT="$(log_text "$JSON")"
assert_contains "$LOGTXT" '"type":"result"' "non-zero exit without result text keeps raw stdout"
assert_contains "$JSON" '"status": "question_suspected"' "raw non-error envelope with exit 1 is question_suspected"

# Unstructured text, not an envelope. Text classifier, no provider_error.
STUB_U529="$TEST_TMP/claude-log-u529"
cat > "$STUB_U529" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '529 overloaded'
exit 1
EOF
chmod +x "$STUB_U529"
OUT="$(run_cc "$STUB_U529" feat/pe-log-u529)"
JSON="$(last_json "$OUT")"
LOGTXT="$(log_text "$JSON")"
assert_contains "$LOGTXT" "529 overloaded" "unparsed stdout is stored unchanged"
assert_contains "$JSON" '"status": "engine_unavailable"' "plain 529 overloaded is engine_unavailable"
assert_error_category "$JSON" overloaded "plain 529 overloaded sets error_category"
assert_no_provider_key "$JSON" "unstructured 529 overloaded has no provider_error"

# --- Fix 2: structured 529 wins on every no-commit non-zero shape ---
# Already green on the pre-fix branch: the equality branch (no new commit,
# AGENT_EXIT != 0) called _prefer_structured_classified_error before
# _is_engine_unavailable. (a) generic stop, (b) question-shaped result, and
# (c) boilerplate/empty result all land on that one path, so structured 529
# already became engine_unavailable. The dirty-tree non-zero path did not.
write_529() {
  local dest="$1" result="$2"
  cat > "$dest" <<EOF
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,api_error_status:529,terminal_reason:"api_error",result:${result}})+"\\n")'
exit 1
EOF
  chmod +x "$dest"
}

STUB_BR_A="$TEST_TMP/claude-br-a"
write_529 "$STUB_BR_A" '"worker stopped without editing"'
OUT="$(run_cc "$STUB_BR_A" feat/pe-br-a)"
JSON="$(last_json "$OUT")"
assert_provider "$JSON" cc-shim 529 api_error_status "exit 1 with no commit and structured 529 is engine_unavailable"

STUB_BR_B="$TEST_TMP/claude-br-b"
write_529 "$STUB_BR_B" '"I need to ask a clarifying question before editing"'
OUT="$(run_cc "$STUB_BR_B" feat/pe-br-b)"
JSON="$(last_json "$OUT")"
assert_provider "$JSON" cc-shim 529 api_error_status "question-shaped text with structured 529 is engine_unavailable"
assert_not_contains "$JSON" '"status": "question_suspected"' "structured 529 is not left as question_suspected"

STUB_BR_C="$TEST_TMP/claude-br-c"
write_529 "$STUB_BR_C" '""'
OUT="$(run_cc "$STUB_BR_C" feat/pe-br-c)"
JSON="$(last_json "$OUT")"
assert_provider "$JSON" cc-shim 529 api_error_status "empty no_op-shaped text with structured 529 is engine_unavailable"
assert_not_contains "$JSON" '"status": "no_op"' "structured 529 non-zero exit is not no_op"

# --- Fix 3: one stub per allowed status, plus one outside the set ---
for pair in "429:feat/pe-429" "503:feat/pe-503" "402:feat/pe-402"; do
  code="${pair%%:*}"
  branch="${pair##*:}"
  stub="$TEST_TMP/claude-$code"
  cat > "$stub" <<EOF
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,api_error_status:${code},terminal_reason:"api_error",result:"status ${code}"})+"\\n")'
exit 1
EOF
  chmod +x "$stub"
  OUT="$(run_cc "$stub" "$branch")"
  JSON="$(last_json "$OUT")"
  assert_provider "$JSON" cc-shim "$code" api_error_status "cc-shim structured ${code} is harness_structured engine_unavailable"
done

STUB_500="$TEST_TMP/claude-500"
cat > "$STUB_500" <<'EOF'
#!/usr/bin/env bash
node -e 'process.stdout.write(JSON.stringify({type:"result",is_error:true,api_error_status:500,terminal_reason:"api_error",result:"internal error"})+"\n")'
exit 1
EOF
chmod +x "$STUB_500"
OUT="$(run_cc "$STUB_500" feat/pe-500)"
JSON="$(last_json "$OUT")"
assert_no_provider_key "$JSON" "structured status 500 is outside the set and has no provider_error"

finalize_test
