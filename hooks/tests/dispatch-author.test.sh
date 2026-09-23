#!/usr/bin/env bash
# dispatch-author — raw authoring dispatch smoke tests (local engines only, no network).
# Covers: exact prompt forwarding, empty-output fail-closed, output parseability,
# and precondition failures on missing CLI args / missing env constraints.
. "$(dirname "$0")/lib.sh"

# Isolate from ambient session markers
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session_isolation"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=main -c commit.gpgsign=false"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan for the change and include exactly three bullet items." > "$PROMPT"

# --- 1. codex — raw prompt bytes preserved; no review-template leakage ---
RECEIVED="$TEST_TMP/prompt.received.codex"
STUB_COD="$TEST_TMP/runner-codex"
cat > "$STUB_COD" <<EOF
#!/usr/bin/env bash
echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2

sidecar=""
args=("\$@")
i=0
while [ "\$i" -lt "\${#args[@]}" ]; do
  if [ "\${args[\$i]}" = "--output-last-message" ]; then
    i=\$((i + 1))
    if [ "\$i" -lt "\${#args[@]}" ]; then
      sidecar="\${args[\$i]}"
    fi
  fi
  i=\$((i + 1))
done

cat > "$RECEIVED"
if [ -n "\$sidecar" ]; then
  printf '%s' "OK-WRITTEN" > "\$sidecar"
fi
echo "OK-WRITTEN"
EOF
chmod +x "$STUB_COD"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_COD" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "codex authored exit 0"
assert_file_exists "$RECEIVED" "codex stub received prompt body"
cmp -s "$PROMPT" "$RECEIVED"
assert_eq "0" "$?" "codex receives exact prompt bytes"
assert_contains "$OUT" '"status": "authored"' "codex status authored"
assert_not_contains "$OUT" "You are a code reviewer" "codex prompt is not reviewer-wrapped"
assert_not_contains "$OUT" "Diff under review" "codex prompt is not diff-wrapper"

# qoder author path (grok-shaped read-only, stderr discarded so the non-git-cwd git fatal
# never pollutes the authored text): status authored, runner reported qoderclicn.
STUB_QODER="$TEST_TMP/runner-qoder"
cat > "$STUB_QODER" <<'EOF'
#!/usr/bin/env bash
prompt=$(cat || true)
begin=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
end=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "OK-WRITTEN" "$end"
else
  echo "OK-WRITTEN"
fi
EOF
chmod +x "$STUB_QODER"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner qoderclicn --model Qwen3.8-Max-Preview --prompt-file "$PROMPT" --bin "$STUB_QODER" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "qoder authored exit 0"
assert_contains "$OUT" '"status": "authored"' "qoder status authored"
assert_contains "$OUT" '"runner": "qoderclicn"' "qoder runner reported"

# Wrapped non-codex prompt is a dispatcher output-format contract, not an identity override.
WRAP_DUMP="$TEST_TMP/wrapped-prompt.dump"
STUB_WRAP="$TEST_TMP/runner-wrap-dump"
cat > "$STUB_WRAP" <<EOF
#!/usr/bin/env bash
prompt=\$(cat || true)
printf '%s\n' "\$prompt" > "$WRAP_DUMP"
begin=\$(printf '%s\n' "\$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
end=\$(printf '%s\n' "\$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
if [ -n "\$begin" ] && [ -n "\$end" ]; then
  printf '%s\n%s\n%s\n' "\$begin" "OK-WRITTEN" "\$end"
else
  echo "OK-WRITTEN"
fi
EOF
chmod +x "$STUB_WRAP"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner claude-native --model claude-fable-5-1 --prompt-file "$PROMPT" --bin "$STUB_WRAP" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "wrap-dump authored exit 0"
WRAP_BODY="$(cat "$WRAP_DUMP")"
assert_not_contains "$WRAP_BODY" "You are an authoring engine" "wrapped prompt is not an identity override"
assert_not_contains "$WRAP_BODY" "Do NOT echo these instructions" "wrapped prompt does not echo-instruction ban"
assert_contains "$WRAP_BODY" "<<<AUTOPILOT-AUTHOR-" "wrapped prompt keeps BEGIN marker line"
assert_contains "$WRAP_BODY" "NONCE=" "wrapped prompt keeps NONCE line"
assert_contains "$WRAP_BODY" "AUTHORING TASK:" "wrapped prompt keeps AUTHORING TASK"

# --- 2. empty output → empty_output, exit 1, fail-closed ---
STUB_EMPTY="$TEST_TMP/runner-empty"
cat > "$STUB_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_EMPTY"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "empty output exits 1"
assert_contains "$OUT" '"status": "empty_output"' "empty output mapped to empty_output"
assert_not_contains "$OUT" '"status": "precondition_failed"' "empty output is not precondition_failed"

# --- 2.1: runner non-zero with output → runner_failed, exit 3 ---
STUB_PARTIAL_FAIL="$TEST_TMP/runner-codex-partial-fail"
cat > "$STUB_PARTIAL_FAIL" <<'EOF'
#!/usr/bin/env bash
echo "partial-output"
exit 42
EOF
chmod +x "$STUB_PARTIAL_FAIL"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_PARTIAL_FAIL" 2>&1)"; EXIT=$?
assert_eq "3" "$EXIT" "partial output with non-zero runner exits 3"
assert_contains "$OUT" '"status": "runner_failed"' "non-zero runner maps to runner_failed"
assert_contains "$OUT" '"error": "runner exited 42"' "runner_failed includes exit code"
RUNNER_RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RUNNER_RAW_LOG_PATH" "runner_failed raw_log exists"
assert_contains "$(cat "$RUNNER_RAW_LOG_PATH")" "partial-output" "runner_failed raw_log retains partial output"

# --- 3. normal output JSON parseable + raw_log path exists ---
STUB_OK="$TEST_TMP/runner-ok"
cat > "$STUB_OK" <<'EOF'
#!/usr/bin/env bash
echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2

sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    if [ "$i" -lt "${#args[@]}" ]; then
      sidecar="${args[$i]}"
    fi
  fi
  i=$((i + 1))
done

cat >/dev/null 2>&1 || true
msg="Authoring result for ${MODEL}."
if [ -n "$sidecar" ]; then
  printf '%s\n' "$msg" > "$sidecar"
fi
printf '%s\n' "$msg"
EOF
chmod +x "$STUB_OK"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "normal output exits 0"
assert_contains "$OUT" '"status": "authored"' "normal output returns authored status"

# --- RED: 100-byte preamble ending in `[` (non-codex fake-runner seam) ---
# RED at 6d19cd18ca676318440fac9e40b7fa7a95971a0e: observed
#   status: authored  exit: 0  error: null
#   (first 100 bytes of OUT JSON: {"runner": "grok", "model": "grok-build", "status": "authored", "raw_log": )
STUB_PREAMBLE="$TEST_TMP/runner-preamble-trunc"
cat > "$STUB_PREAMBLE" <<'EOF'
#!/usr/bin/env bash
# 99 bytes of filler + '[' = 100 bytes, exit 0
printf '%s' 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx['
exit 0
EOF
chmod +x "$STUB_PREAMBLE"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_PREAMBLE" 2>&1)"; EXIT=$?
assert_eq "5" "$EXIT" "preamble-only draft exits 5"
assert_contains "$OUT" '"status": "truncated"' "preamble-only maps to truncated"
assert_contains "$OUT" "frame_missing" "preamble-only truncated reason is frame_missing"

python3 -c 'import json,sys; json.load(sys.stdin)' <<<"$OUT"
assert_eq "0" "$?" "author output is valid JSON"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_not_contains "$RAW_LOG_PATH" '$' "raw_log path extracted cleanly"
if [ -n "$RAW_LOG_PATH" ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "raw_log path is absent"
fi

# --- 4. precondition: missing runner ---
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --model gpt-5.5 --prompt-file "$PROMPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing --runner exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing --runner => precondition_failed"
assert_contains "$OUT" "--runner is required" "missing --runner message"

# --- 4.1. Deliberately buggy verification-author dispatches require an exact
#       polarity receipt before any runner is spawned.
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" \
  --bin "$STUB_COD" --require-polarity-receipt 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "required polarity receipt without path exits 2"
assert_contains "$OUT" "requires --polarity-receipt" "missing polarity receipt path is named"
POLARITY_BAD="$TEST_TMP/bad-polarity.json"
printf '%s\n' '{}' > "$POLARITY_BAD"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" \
  --bin "$STUB_COD" --polarity-receipt "$POLARITY_BAD" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "malformed polarity receipt exits 2"
assert_contains "$OUT" "shipping validation requires --polarity-base-sha" "polarity shipping path requires controller-known candidate identity"

# --- 4.2: shipping polarity validates against independently observed commits ---
POL_REPO="$TEST_TMP/polarity-repo"
$GIT init "$POL_REPO" >/dev/null 2>&1
printf '%s\n' 'echo 3' > "$POL_REPO/calc.sh"
printf '%s\n' '#!/usr/bin/env bash' '[ "$(bash calc.sh)" = "5" ]' > "$POL_REPO/calc.test.sh"
chmod +x "$POL_REPO/calc.test.sh"
$GIT -C "$POL_REPO" add calc.sh calc.test.sh >/dev/null 2>&1
$GIT -C "$POL_REPO" commit -m base >/dev/null 2>&1
POL_BASE="$($GIT -C "$POL_REPO" rev-parse HEAD)"
printf '%s\n' 'echo 5' > "$POL_REPO/calc.sh"
printf '%s\n' '#!/usr/bin/env bash' '[ "$(bash calc.sh)" = "5" ] # head artifact' > "$POL_REPO/calc.test.sh"
chmod +x "$POL_REPO/calc.test.sh"
$GIT -C "$POL_REPO" add -A >/dev/null 2>&1
$GIT -C "$POL_REPO" commit -m head >/dev/null 2>&1
POL_HEAD="$($GIT -C "$POL_REPO" rev-parse HEAD)"
POL_VERIFY="$POL_REPO/calc.test.sh"
POL_RECEIPT="$TEST_TMP/polarity-valid.json"
"$REPO_ROOT/scripts/verify-red-green.sh" --base "$POL_BASE" --head "$POL_HEAD" \
  --verify-cmd "$POL_VERIFY" --repo "$POL_REPO" --assertion-artifact calc.test.sh --receipt-out "$POL_RECEIPT" >/dev/null
# The Grok-shaped transport owns a live stdin under its timeout wrapper.  Keep
# this polarity acceptance fixture independent of stdin so a valid receipt
# cannot be mistaken for a transport hang.
STUB_GROK="$TEST_TMP/runner-grok"
cat > "$STUB_GROK" <<'EOF'
#!/usr/bin/env bash
pf=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--prompt-file" ]; then
    i=$((i + 1)); pf="${args[$i]}"
  fi
  i=$((i + 1))
done
begin=""; end=""
if [ -n "$pf" ] && [ -f "$pf" ]; then
  begin=$(grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' "$pf" | head -n1)
  end=$(grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' "$pf" | head -n1)
fi
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "grok polarity fixture" "$end"
else
  printf '%s\n' "grok polarity fixture"
fi
EOF
chmod +x "$STUB_GROK"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model gpt-test --prompt-file "$PROMPT" \
  --bin "$STUB_GROK" --require-polarity-receipt --polarity-receipt "$POL_RECEIPT" \
  --repo-root "$POL_REPO" --polarity-base-sha "$POL_BASE" --polarity-head-sha "$POL_HEAD" \
  --polarity-verify-cmd "$POL_VERIFY" --polarity-assertion-artifact calc.test.sh 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "independently observed polarity receipt permits dispatch"
assert_contains "$OUT" '"polarity_receipt_digest": "' "dispatch result carries polarity receipt digest"
assert_not_contains "$OUT" '\\"' "polarity receipt digest serialization has no literal quote escapes"
POL_FORGED="$TEST_TMP/polarity-forged.json"
node - "$POL_RECEIPT" "$POL_FORGED" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
source.base_exit_code = 0;
const canonical = (value) => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : (value && typeof value === 'object' ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value));
const body = { ...source }; delete body.receipt_digest;
source.receipt_digest = crypto.createHash('sha256').update(canonical(body)).digest('hex');
fs.writeFileSync(process.argv[3], JSON.stringify(source));
NODE
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model gpt-test --prompt-file "$PROMPT" \
  --bin "$STUB_GROK" --require-polarity-receipt --polarity-receipt "$POL_FORGED" \
  --repo-root "$POL_REPO" --polarity-base-sha "$POL_BASE" --polarity-head-sha "$POL_HEAD" \
  --polarity-verify-cmd "$POL_VERIFY" --polarity-assertion-artifact calc.test.sh 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "forged self-digested polarity receipt is rejected"
assert_contains "$OUT" "red-before/green-after" "forged polarity rejection names observed transition"

# --- 5. precondition: missing binary ---
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$TEST_TMP/no-bin" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing runner binary exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "missing binary => precondition_failed"
assert_not_contains "$OUT" "authored" "missing binary does not report authored"

# --- 6. precondition: cc-shim env preconditions ---
STUB_NOENV="$TEST_TMP/runner-ccshim"
cat > "$STUB_NOENV" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null 2>&1 || true
echo "ccshim out"
EOF
chmod +x "$STUB_NOENV"
OUT="$(unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_NOENV" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "missing cc-shim env exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "cc-shim env missing => precondition_failed"
assert_not_contains "$OUT" '"status": "authored"' "cc-shim missing env not authored"

# --- 7. optional: agy path can run when script(1) exists and prompt is still raw ---
if command -v script >/dev/null 2>&1; then
  STUB_AGY_OK="$TEST_TMP/runner-agy-ok"
  cat > "$STUB_AGY_OK" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "models" ]; then
  printf '%s\n' 'gemini-3.6-flash-low' 'gemini-3.6-flash-medium' 'gemini-3.6-flash-high'
  exit 0
fi
begin=""; end=""
contains=0
for a in "$@"; do
  if [ -z "$begin" ]; then
    begin=$(printf '%s\n' "$a" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
  fi
  if [ -z "$end" ]; then
    end=$(printf '%s\n' "$a" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
  fi
  grep -q "Write a verification plan for the change" < <(printf '%s' "$a") && contains=1
done
body=""
skip_next=0
for a in "$@"; do
  if [ "$skip_next" = "1" ]; then skip_next=0; continue; fi
  if [ "$a" = "-p" ]; then
    body="${body}ARG=-p"$'\n'
    skip_next=1
    continue
  fi
  body="${body}ARG=${a}"$'\n'
done
[ "$contains" = "1" ] && body="${body}CONTAINS_ORIGINAL=1"$'\n'
body="${body}ok from agy"
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "$body" "$end"
else
  printf '%s\n' "$body"
fi
EOF
  chmod +x "$STUB_AGY_OK"
  STUB_BIN_DIR="$TEST_TMP/fake-bin"
  mkdir -p "$STUB_BIN_DIR"
  ln -sf "$STUB_AGY_OK" "$STUB_BIN_DIR/agy"
  ORIGINAL_PATH="$PATH"
  PATH="$STUB_BIN_DIR:$PATH"

  # Keep a shadow copy for AGY_CWD temp command assertions.
  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin agy 2>&1)"; EXIT=$?
  PATH="$ORIGINAL_PATH"
  assert_eq "0" "$EXIT" "agy path with script wrapper exits 0"
  assert_contains "$OUT" '"status": "authored"' "agy path returns authored"
  AGY_RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
  assert_file_exists "$AGY_RAW_LOG_PATH" "agy path raw_log exists"
  AGY_RAW_LOG_TEXT="$(cat "$AGY_RAW_LOG_PATH")"
  assert_contains "$AGY_RAW_LOG_TEXT" "CONTAINS_ORIGINAL=1" "agy -p payload still contains the original authoring prompt"
  assert_contains "$AGY_RAW_LOG_TEXT" "ok from agy" "agy raw_log contains stub output"

  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash --prompt-file "$PROMPT" --bin "$STUB_AGY_OK" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "agy generic alias exits 0"
  assert_contains "$OUT" '"model": "gemini-3.6-flash-high"' "agy generic alias resolves to the newest canonical tier before spend"
  AGY_ALIAS_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
  assert_contains "$(cat "$AGY_ALIAS_LOG_PATH")" 'ARG=gemini-3.6-flash-high' "agy runner receives the resolved canonical model"

  # agy argv-payload ceiling (v2.35.7): this rail's generated run.sh embeds `-p "$(cat <prompt>)"`,
  # so an oversized authoring prompt dies at execve with a bare 126/127 and no vendor text. It must
  # be refused by name, before dispatch.
  BIG_AUTHOR_PROMPT="$TEST_TMP/big-author-prompt.txt"
  node -e 'process.stdout.write("z".repeat(200000))' > "$BIG_AUTHOR_PROMPT"
  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-3.6-flash-high --prompt-file "$BIG_AUTHOR_PROMPT" --bin "$STUB_AGY_OK" 2>&1)"; EXIT=$?
  assert_eq "2" "$EXIT" "oversized agy authoring payload is a precondition failure"
  assert_contains "$OUT" 'single-argv ceiling' "the authoring refusal names the argv ceiling"
  assert_contains "$OUT" 'has no --prompt-file' "the authoring refusal says why it cannot be streamed"
  assert_not_contains "$OUT" '"status": "authored"' "an unexecable payload never reports authored"

  STUB_AGY_FAIL="$TEST_TMP/runner-agy-fail"
  cat > "$STUB_AGY_FAIL" <<'EOF'
#!/usr/bin/env bash
echo "partial from agy"
exit 7
EOF
  chmod +x "$STUB_AGY_FAIL"
  ln -sf "$STUB_AGY_FAIL" "$STUB_BIN_DIR/agy"
  PATH="$STUB_BIN_DIR:$PATH"
  OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin agy 2>&1)"; EXIT=$?
  assert_eq "3" "$EXIT" "agy non-zero runner exits 3"
  assert_contains "$OUT" '"status": "runner_failed"' "agy non-zero maps to runner_failed"
  assert_contains "$OUT" '"error": "runner exited 7"' "agy runner_failed includes exit code"

  # --- 7.2: agy empty-output path should fail-closed (exit 1) ---
  STUB_AGY_EMPTY="$TEST_TMP/runner-agy-empty"
  cat > "$STUB_AGY_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$STUB_AGY_EMPTY"
  ln -sf "$STUB_AGY_EMPTY" "$STUB_BIN_DIR/agy"
  PATH="$STUB_BIN_DIR:$PATH"
  OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin agy 2>&1)"; EXIT=$?
  assert_eq "1" "$EXIT" "agy empty-output exit 1"
  assert_contains "$OUT" '"status": "empty_output"' "agy empty-output maps to empty_output"
  assert_not_contains "$OUT" '"status": "authored"' "agy empty-output is not authored"
fi

# Regression Test 4: grok late-flush stub
STUB_GROK_LATE_FLUSH="$TEST_TMP/runner-grok-late-flush"
cat > "$STUB_GROK_LATE_FLUSH" <<'EOF'
#!/usr/bin/env bash
pf=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--prompt-file" ]; then
    i=$((i + 1)); pf="${args[$i]}"
  fi
  i=$((i + 1))
done
(
  sleep 1
  begin=""; end=""
  if [ -n "$pf" ] && [ -f "$pf" ]; then
    begin=$(grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' "$pf" | head -n1)
    end=$(grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' "$pf" | head -n1)
  fi
  if [ -n "$begin" ] && [ -n "$end" ]; then
    printf '%s\n%s\n%s\n' "$begin" "the answer" "$end"
  else
    echo "the answer"
  fi
) &
exit 0
EOF
chmod +x "$STUB_GROK_LATE_FLUSH"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_GROK_LATE_FLUSH" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "grok late-flush exits 0"
assert_contains "$OUT" '"status": "authored"' "grok late-flush returns authored status"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RAW_LOG_PATH" "grok late-flush raw_log exists"
assert_contains "$(cat "$RAW_LOG_PATH")" "the answer" "grok raw_log contains late-flushed output"

# --- RED: tool-narration fences inside a draft (non-codex fake-runner seam) ---
# RED at 6d19cd18ca676318440fac9e40b7fa7a95971a0e: observed
#   status: authored  exit: 0  error: null
#   raw_log body included the ```tool fence and was treated as a complete draft.
STUB_TOOL_NARR="$TEST_TMP/runner-tool-narration"
cat > "$STUB_TOOL_NARR" <<'EOF'
#!/usr/bin/env bash
body=$'draft with narration\n```tool\ncall something\n```'
pf=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--prompt-file" ]; then
    i=$((i + 1))
    pf="${args[$i]}"
  fi
  i=$((i + 1))
done
begin=""; end=""
if [ -n "$pf" ] && [ -f "$pf" ]; then
  begin=$(grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' "$pf" | head -n1)
  end=$(grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' "$pf" | head -n1)
fi
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "$body" "$end"
else
  printf '%s\n' "$body"
fi
exit 0
EOF
chmod +x "$STUB_TOOL_NARR"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_TOOL_NARR" 2>&1)"; EXIT=$?
assert_eq "5" "$EXIT" "tool-narration draft exits 5"
assert_contains "$OUT" '"status": "truncated"' "tool-narration maps to truncated"
assert_contains "$OUT" "tool_narration" "tool-narration truncated reason is tool_narration"

# Regression Test 5: grok truly-empty stub
STUB_GROK_EMPTY="$TEST_TMP/runner-grok-empty"
cat > "$STUB_GROK_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_GROK_EMPTY"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_GROK_EMPTY" 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "grok truly-empty exits 1"
assert_contains "$OUT" '"status": "empty_output"' "grok truly-empty maps to empty_output"

# --- 8. --endpoint flag parity ---
# Configure a fake endpoint via environment variables
export AUTOPILOT_ENDPOINT_TESTEP_URL="http://127.0.0.1:9999/v1"
export AUTOPILOT_ENDPOINT_TESTEP_TOKEN="fake-token-value-12345"

STUB_CC_ENV_DUMP="$TEST_TMP/runner-cc-env-dump"
cat > "$STUB_CC_ENV_DUMP" <<'EOF'
#!/usr/bin/env bash
prompt=$(cat || true)
begin=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
end=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
body="BASE:$ANTHROPIC_BASE_URL
TOKEN:$ANTHROPIC_AUTH_TOKEN
dummy response"
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "$body" "$end"
else
  printf '%s\n' "$body"
fi
exit 0
EOF
chmod +x "$STUB_CC_ENV_DUMP"

# Run cc-shim with --endpoint TESTEP
OUT="$(unset ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_ENV_DUMP" --endpoint TESTEP 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "cc-shim with resolved --endpoint exits 0"
assert_contains "$OUT" '"status": "authored"' "cc-shim resolved endpoint reports authored"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RAW_LOG_PATH" "cc-shim raw_log exists"
assert_contains "$(cat "$RAW_LOG_PATH")" "BASE:http://127.0.0.1:9999/v1" "cc-shim stub received ANTHROPIC_BASE_URL"
assert_contains "$(cat "$RAW_LOG_PATH")" "TOKEN:fake-token-value-12345" "cc-shim stub received ANTHROPIC_AUTH_TOKEN"

# Unknown endpoint name -> precondition_failed exit 2
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_ENV_DUMP" --endpoint UNKNOWN_EP 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "unknown --endpoint exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "unknown endpoint reports precondition_failed"

# Non-cc-shim with --endpoint -> precondition_failed exit 2
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_COD" --endpoint TESTEP 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "non-cc-shim with --endpoint exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "non-cc-shim endpoint reports precondition_failed"
assert_contains "$OUT" "--endpoint applies only to --runner anthropic-compatible or cc-shim" "correct runner restriction error message"

# `--endpoint @none` is the roster convention for "native auth" (review-loop-config.md);
# the resolver reads it as endpoint=null. A CLI-direct caller copying the roster value
# verbatim must not die at the runner restriction (7840hs, 2026-09-12: both seats dead).
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner codex --model gpt-5.5 --prompt-file "$PROMPT" --bin "$STUB_COD" --endpoint @none 2>&1)"
EXIT=$?
assert_not_contains "$OUT" "--endpoint applies only to" "--endpoint @none is not an endpoint: no runner restriction error"
assert_not_contains "$OUT" '"status": "precondition_failed"' "--endpoint @none reaches the runner"
assert_eq "0" "$EXIT" "--endpoint @none: exit 0 with the codex stub"

# --- 8b. anthropic-compatible seam + endpoint gate behavior ---
STUB_ANTHRO_JS="$TEST_TMP/runner-anthropic-compatible-ok.js"
cat > "$STUB_ANTHRO_JS" <<'EOF'
#!/usr/bin/env node
const fs = require('fs');
let prompt = '';
const idx = process.argv.indexOf('--prompt-file');
if (idx >= 0 && process.argv[idx + 1]) {
  try { prompt = fs.readFileSync(process.argv[idx + 1], 'utf8'); } catch (e) { prompt = ''; }
}
const begin = (prompt.match(/^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$/m) || [])[0];
const end = (prompt.match(/^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$/m) || [])[0];
const body = "authoring body line 1\nauthoring body line 2";
if (begin && end) process.stdout.write(begin + "\n" + body + "\n" + end + "\n");
else process.stdout.write(body);
EOF
chmod +x "$STUB_ANTHRO_JS"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model mini --prompt-file "$PROMPT" --bin "$STUB_ANTHRO_JS" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "anthropic-compatible with fake-js exits 0"
assert_contains "$OUT" '"status": "authored"' "anthropic-compatible reports authored"
ANTHRO_RAW_LOG_PATH="$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("raw_log", ""))' <<<"$OUT")"
ANTHRO_EXPECT=$'authoring body line 1\nauthoring body line 2'
assert_eq "$ANTHRO_EXPECT" "$(cat "$ANTHRO_RAW_LOG_PATH")" "anthropic-compatible fake body is written to raw_log"

STUB_ANTHRO_FAIL_JS="$TEST_TMP/runner-anthropic-compatible-fail.js"
cat > "$STUB_ANTHRO_FAIL_JS" <<'EOF'
#!/usr/bin/env node
process.exit(7);
EOF
chmod +x "$STUB_ANTHRO_FAIL_JS"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model mini --prompt-file "$PROMPT" --bin "$STUB_ANTHRO_FAIL_JS" 2>&1)"
EXIT=$?
assert_eq "3" "$EXIT" "anthropic-compatible non-zero fake-js exits 3"
assert_contains "$OUT" '"status": "runner_failed"' "anthropic-compatible non-zero maps to runner_failed"

OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner anthropic-compatible --model mini --prompt-file "$PROMPT" --bin "$STUB_ANTHRO_JS" --endpoint UNKNOWN_EP 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "anthropic-compatible unknown endpoint exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "anthropic-compatible unknown endpoint precondition failed"
assert_not_contains "$OUT" "--endpoint applies only to --runner cc-shim" "anthropic-compatible endpoint gate no longer cc-shim-only"
assert_contains "$OUT" "--endpoint 'UNKNOWN_EP' not ready" "anthropic-compatible endpoint resolution reports not-ready"

# --- 9. late-flush and per-runner settle bound under cc-shim ---
STUB_CC_LATE_FLUSH="$TEST_TMP/runner-cc-late-flush"
cat > "$STUB_CC_LATE_FLUSH" <<'EOF'
#!/usr/bin/env bash
prompt=$(cat || true)
(
  sleep 5
  begin=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
  end=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
  if [ -n "$begin" ] && [ -n "$end" ]; then
    printf '%s\n%s\n%s\n' "$begin" "late response" "$end"
  else
    echo "late response"
  fi
) &
exit 0
EOF
chmod +x "$STUB_CC_LATE_FLUSH"

# With default 10s wait for cc-shim, a 5s late flush should be caught and status should be authored
OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake"; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_LATE_FLUSH" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "cc-shim 5s late-flush exits 0 with 10s settle default"
assert_contains "$OUT" '"status": "authored"' "cc-shim 5s late-flush is authored"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_contains "$(cat "$RAW_LOG_PATH")" "late response" "cc-shim raw_log contains late response"

# Truly-empty cc-shim -> empty_output, exit 1
STUB_CC_EMPTY="$TEST_TMP/runner-cc-empty"
cat > "$STUB_CC_EMPTY" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_CC_EMPTY"

OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake"; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_EMPTY" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "cc-shim truly-empty exits 1"
assert_contains "$OUT" '"status": "empty_output"' "cc-shim truly-empty is empty_output"

# AUTOPILOT_SETTLE_MS=500 shortens the wait, so the 5s late flush is not caught -> empty_output, exit 1
OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake" AUTOPILOT_SETTLE_MS=500; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_LATE_FLUSH" 2>&1)"
EXIT=$?
assert_eq "1" "$EXIT" "cc-shim 5s late-flush with 500ms settle exits 1 (fails to capture)"
assert_contains "$OUT" '"status": "empty_output"' "cc-shim 5s late-flush with 500ms settle is empty_output"

# Malformed AUTOPILOT_SETTLE_MS exits 2
OUT="$(export ANTHROPIC_BASE_URL="http://127.0.0.1:9999/v1" ANTHROPIC_AUTH_TOKEN="fake" AUTOPILOT_SETTLE_MS=abc; DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" --bin "$STUB_CC_EMPTY" 2>&1)"
EXIT=$?
assert_eq "2" "$EXIT" "malformed AUTOPILOT_SETTLE_MS exits 2"
assert_contains "$OUT" '"status": "precondition_failed"' "malformed AUTOPILOT_SETTLE_MS reports precondition_failed"

# --- agy effort follows resolved model id (v2.36.55) ---
count_fold_notes() {
  printf '%s\n' "$1" | grep -c 'model id encodes the tier' || true
}
normalize_argv() {
  sed -E \
    -e 's#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#UUID#g' \
    -e 's#/tmp/[^[:space:]]+#PATH#g' \
    -e 's#'"$TEST_TMP"'[^[:space:]]*#PATH#g'
}

if command -v script >/dev/null 2>&1; then
  STUB_AGY_EFFORT="$TEST_TMP/runner-agy-effort"
  cat > "$STUB_AGY_EFFORT" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "models" ]; then
  printf '%s\n' 'gemini-3.6-flash-low' 'gemini-3.6-flash-medium' 'gemini-3.6-flash-high' 'gemini-3.6-flash'
  exit 0
fi
begin=""; end=""
for a in "\$@"; do
  [ -z "\$begin" ] && begin=\$(printf '%s\n' "\$a" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
  [ -z "\$end" ] && end=\$(printf '%s\n' "\$a" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
done
body=""
skip_next=0
for a in "\$@"; do
  if [ "\$skip_next" = "1" ]; then skip_next=0; continue; fi
  if [ "\$a" = "-p" ]; then
    body="\${body}ARG=-p"\$'\\n'
    skip_next=1
    continue
  fi
  body="\${body}ARG=\${a}"\$'\\n'
done
body="\${body}ok from agy effort"
if [ -n "\$begin" ] && [ -n "\$end" ]; then
  printf '%s\\n%s\\n%s\\n' "\$begin" "\$body" "\$end"
else
  printf '%s\\n' "\$body"
fi
EOF
  chmod +x "$STUB_AGY_EFFORT"
  author_agy_effort() {
    python3 -c '
import json,sys,re
out=sys.stdin.read()
# JSON contract may be mixed with notes; find last {
i=out.rfind("{")
raw=""
if i>=0:
  try:
    raw=json.loads(out[i:]).get("raw_log") or ""
  except Exception:
    pass
text=open(raw).read() if raw else out
m=re.search(r"ARG=--effort\nARG=(\S+)|ARG=--effort\nARG=([^\n]+)", text)
# ARG= lines are one per argv token
vals=[ln[4:] for ln in text.splitlines() if ln.startswith("ARG=")]
eff=""
for i,v in enumerate(vals):
  if v=="--effort" and i+1 < len(vals):
    eff=vals[i+1]
    break
print(eff)
' <<<"$1"
  }

  # RED at base fe225ff5: gemini-flash-medium default effort reached stub as --effort high
  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-medium \
    --prompt-file "$PROMPT" --bin "$STUB_AGY_EFFORT" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "author gemini-flash-medium default effort exit 0"
  assert_eq "medium" "$(author_agy_effort "$OUT")" \
    "author alias gemini-flash-medium default effort reaches stub as --effort medium"

  # RED at base fe225ff5: gemini-flash-high --effort low, no fold note
  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-high \
    --effort low --prompt-file "$PROMPT" --bin "$STUB_AGY_EFFORT" 2>&1)"; EXIT=$?
  assert_eq "0" "$EXIT" "author gemini-flash-high --effort low exit 0"
  assert_eq "high" "$(author_agy_effort "$OUT")" \
    "author gemini-flash-high --effort low reaches stub as --effort high"
  assert_eq "1" "$(count_fold_notes "$OUT")" "author fold note exactly one line when values differ"
  assert_contains "$OUT" "agy effort low (clamped low) folded to high: model id encodes the tier" \
    "author fold note names requested, folded tier, and model-id reason"

  # (preservation, green at base)
  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-high \
    --effort high --prompt-file "$PROMPT" --bin "$STUB_AGY_EFFORT" 2>&1)"; EXIT=$?
  assert_eq "high" "$(author_agy_effort "$OUT")" \
    "author gemini-flash-high --effort high stays --effort high"
  assert_eq "0" "$(count_fold_notes "$OUT")" "author zero fold notes when clamp matches suffix"

  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-flash-high \
    --prompt-file "$PROMPT" --bin "$STUB_AGY_EFFORT" 2>&1)"; EXIT=$?
  assert_eq "high" "$(author_agy_effort "$OUT")" \
    "author gemini-flash-high default xhigh reaches stub as --effort high"
  assert_eq "0" "$(count_fold_notes "$OUT")" "author zero fold notes for default xhigh on -high id"

  OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner agy --model gemini-3.6-flash \
    --prompt-file "$PROMPT" --bin "$STUB_AGY_EFFORT" 2>&1)"; EXIT=$?
  assert_eq "high" "$(author_agy_effort "$OUT")" \
    "author bare agy id under default effort reaches stub as --effort high"
fi

AUTHOR_GROK_ARGV="$TEST_TMP/author-grok.argv"
cat > "$TEST_TMP/author-grok-argv" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$AUTHOR_GROK_ARGV"
pf=""
args=("\$@")
i=0
while [ "\$i" -lt "\${#args[@]}" ]; do
  if [ "\${args[\$i]}" = "--prompt-file" ]; then
    i=\$((i + 1)); pf="\${args[\$i]}"
  fi
  i=\$((i + 1))
done
begin=""; end=""
if [ -n "\$pf" ] && [ -f "\$pf" ]; then
  begin=\$(grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' "\$pf" | head -n1)
  end=\$(grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' "\$pf" | head -n1)
fi
if [ -n "\$begin" ] && [ -n "\$end" ]; then
  printf '%s\n%s\n%s\n' "\$begin" "grok-ok" "\$end"
else
  echo grok-ok
fi
EOF
chmod +x "$TEST_TMP/author-grok-argv"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner grok --model grok-4.6 \
  --prompt-file "$PROMPT" --bin "$TEST_TMP/author-grok-argv" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "author grok argv capture exit 0"
assert_eq "$(normalize_argv < "$AUTHOR_GROK_ARGV")" "$(printf '%s\n' \
  --prompt-file PATH --cwd PATH --model grok-4.6 --reasoning-effort xhigh \
  --no-alt-screen --output-format plain --disable-web-search)" \
  "author grok argv matches frozen literal (preservation, green at base)"

AUTHOR_CODEX_ARGV="$TEST_TMP/author-codex.argv"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner codex --model gpt-5.5 \
  --prompt-file "$PROMPT" --bin "$STUB_COD" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "author codex argv capture exit 0"
# STUB_COD already records the prompt; pin a frozen argv fragment via a wrapper dump.
cat > "$TEST_TMP/author-codex-argv" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$AUTHOR_CODEX_ARGV"
exec "$STUB_COD" "\$@"
EOF
chmod +x "$TEST_TMP/author-codex-argv"
OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 "$SCRIPT" --runner codex --model gpt-5.5 \
  --prompt-file "$PROMPT" --bin "$TEST_TMP/author-codex-argv" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "author codex argv wrapper exit 0"
assert_file_exists "$AUTHOR_CODEX_ARGV" "author codex stub recorded argv"
# Frozen literal (codex transport, default effort xhigh, no --repo-root): the oracle
# must not be derived from the capture it checks (codex r1 MUST-FIX, 2026-09-16).
assert_eq "$(normalize_argv < "$AUTHOR_CODEX_ARGV")" "$(printf '%s\n' \
  exec --model gpt-5.5 --sandbox read-only --skip-git-repo-check \
  -c 'model_reasoning_effort="xhigh"' --output-last-message PATH)" \
  "author codex argv matches frozen literal (preservation, green at base)"

AUTHOR_CC_ARGV="$TEST_TMP/author-cc.argv"
cat > "$TEST_TMP/author-cc-argv" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$AUTHOR_CC_ARGV"
prompt=\$(cat || true)
begin=\$(printf '%s\n' "\$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
end=\$(printf '%s\n' "\$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
if [ -n "\$begin" ] && [ -n "\$end" ]; then
  printf '%s\n%s\n%s\n' "\$begin" "cc-ok" "\$end"
else
  echo cc-ok
fi
EOF
chmod +x "$TEST_TMP/author-cc-argv"
OUT="$(env ANTHROPIC_BASE_URL="http://127.0.0.1:9/v1" ANTHROPIC_AUTH_TOKEN="t" AUTOPILOT_SETTLE_MS=0 \
  DISPATCH_QUIET=1 "$SCRIPT" --runner cc-shim --model mini --prompt-file "$PROMPT" \
  --bin "$TEST_TMP/author-cc-argv" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "author cc-shim argv capture exit 0"
assert_eq "$(normalize_argv < "$AUTHOR_CC_ARGV")" "$(printf '%s\n' \
  -p --model mini --setting-sources project --strict-mcp-config --tools '')" \
  "author cc-shim argv matches frozen literal (preservation, green at base)"

# Well-framed non-codex draft → authored; artifact/raw_log has no frame lines.
STUB_FRAMED_OK="$TEST_TMP/runner-framed-ok"
cat > "$STUB_FRAMED_OK" <<'EOF'
#!/usr/bin/env bash
pf=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--prompt-file" ]; then
    i=$((i + 1)); pf="${args[$i]}"
  fi
  i=$((i + 1))
done
begin=""; end=""
if [ -n "$pf" ] && [ -f "$pf" ]; then
  begin=$(grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' "$pf" | head -n1)
  end=$(grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' "$pf" | head -n1)
fi
printf '%s\n%s\n%s\n' "$begin" "complete framed draft body" "$end"
EOF
chmod +x "$STUB_FRAMED_OK"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_FRAMED_OK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "well-framed draft exits 0"
assert_contains "$OUT" '"status": "authored"' "well-framed draft returns authored"
RAW_LOG_PATH="$(python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('raw_log', ''))" <<<"$OUT")"
assert_file_exists "$RAW_LOG_PATH" "well-framed raw_log exists"
assert_contains "$(cat "$RAW_LOG_PATH")" "complete framed draft body" "well-framed artifact is the inner body"
assert_not_contains "$(cat "$RAW_LOG_PATH")" "AUTOPILOT-AUTHOR-" "authored artifact has no AUTHOR frame line"
assert_not_contains "$(cat "$RAW_LOG_PATH")" "AUTOPILOT-END-" "authored artifact has no END frame line"

# Frame present but foreign nonce → truncated
STUB_FOREIGN="$TEST_TMP/runner-foreign-nonce"
cat > "$STUB_FOREIGN" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '<<<AUTOPILOT-AUTHOR-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>>>' 'foreign nonce body' '<<<AUTOPILOT-END-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>>>'
exit 0
EOF
chmod +x "$STUB_FOREIGN"
OUT="$(DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" --bin "$STUB_FOREIGN" 2>&1)"; EXIT=$?
assert_eq "5" "$EXIT" "foreign nonce exits 5"
assert_contains "$OUT" '"status": "truncated"' "foreign nonce maps to truncated"
assert_contains "$OUT" "frame_missing" "foreign nonce truncated reason is frame_missing"

# Exported AUTOPILOT_ROOT_RUN_ID appears in the manifest (hetero-style lineage).
LINEAGE_RUNS="$TEST_TMP/author-lineage-runs"
mkdir -p "$LINEAGE_RUNS"
OUT="$(
  AUTOPILOT_DISPATCH_RUNS_DIR="$LINEAGE_RUNS" \
  AUTOPILOT_PARENT_RUN_ID="parent-run-abc" \
  AUTOPILOT_ROOT_RUN_ID="root-run-xyz" \
  AUTOPILOT_DISPATCH_DEPTH=2 \
  DISPATCH_QUIET=1 "$SCRIPT" --runner grok --model grok-build --prompt-file "$PROMPT" \
    --bin "$STUB_FRAMED_OK" --run-id author-lineage-root-probe 2>&1
)"; EXIT=$?
assert_eq "0" "$EXIT" "lineage probe authored exit 0"
MANIFEST="$LINEAGE_RUNS/author-lineage-root-probe.manifest.json"
assert_file_exists "$MANIFEST" "lineage manifest exists"
assert_contains "$(cat "$MANIFEST")" '"root_run_id": "root-run-xyz"' "exported AUTOPILOT_ROOT_RUN_ID appears in the manifest"
assert_contains "$(cat "$MANIFEST")" '"parent_run_id": "parent-run-abc"' "exported AUTOPILOT_PARENT_RUN_ID appears in the manifest"
assert_contains "$(cat "$MANIFEST")" '"depth": 2' "exported AUTOPILOT_DISPATCH_DEPTH appears in the manifest"

finalize_test
