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

finalize_test
