#!/usr/bin/env bash
# Independent depth-0 harness for scripts/probe-engine-capability.sh
# Proves that safe probes do not spend quota / run model queries.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROBE_CLI="$ROOT/scripts/probe-engine-capability.sh"
STATE_CLI="$ROOT/scripts/engine-capability-state.js"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
export ENGINE_CAPABILITY_DIR="$TESTDIR"
trap 'rm -rf "$TESTDIR"' EXIT

ok()   { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
reset(){ rm -f "$TESTDIR/capability.jsonl" "$TESTDIR/.lock"; }
arrlen(){ node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).length))"; }
jq_get(){ node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of '$1'.split('.'))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(String(v))"; }

# 1. Test safe probe by default (no paid model prompt, outputs unknown status)
reset
# Place a dummy codex executable in PATH to satisfy presence check
DUMMY_BIN_DIR="$TESTDIR/bin"
mkdir -p "$DUMMY_BIN_DIR"
cat > "$DUMMY_BIN_DIR/codex" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "exec" ]; then
  echo "ERROR: live spend attempted!" >&2
  exit 99
fi
echo "codex-cli 1.0.0-mock"
exit 0
EOF
chmod +x "$DUMMY_BIN_DIR/codex"

# Run with PATH pointing to our dummy bin
OLD_PATH="$PATH"
export PATH="$DUMMY_BIN_DIR:$PATH"

# Run safe probe (default)
OUT="$("$PROBE_CLI" quota --runner codex --model gpt-5.5 --store "$TESTDIR" 2>&1)"
EXIT_CODE=$?

# Verify no "live spend attempted!" was printed (meaning it didn't call 'codex exec')
assert_no_spend=1
if echo "$OUT" | grep -q "live spend attempted"; then
  assert_no_spend=0
fi

# Query capability state to see if it was recorded as unknown
status=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 --role reviewer --store "$TESTDIR" | jq_get capability.quota.status)
confidence=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 --role reviewer --store "$TESTDIR" | jq_get capability.quota.confidence)

if [ "$EXIT_CODE" -eq 0 ] && [ "$assert_no_spend" -eq 1 ] && [ "$status" = "unknown" ] && [ "$confidence" = "medium" ]; then
  ok "1: safe probe by default does not spend quota, emits unknown (medium confidence due to binary found)"
else
  bad "1: safe probe failed. exit=$EXIT_CODE spend=$assert_no_spend status=$status confidence=$confidence"
fi

# 2. Test live-spend probe failure classification
reset
# Replace dummy codex to fail with quota exhausted error on exec
cat > "$DUMMY_BIN_DIR/codex" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "exec" ]; then
  echo "OpenAI billing quota exceeded" >&2
  exit 1
fi
echo "codex-cli 1.0.0-mock"
exit 0
EOF
chmod +x "$DUMMY_BIN_DIR/codex"

# Run live-spend probe
bash "$PROBE_CLI" quota --runner codex --model gpt-5.5 --live-spend --store "$TESTDIR" >/dev/null 2>&1

status=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 --role reviewer --store "$TESTDIR" | jq_get capability.quota.status)
confidence=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 --role reviewer --store "$TESTDIR" | jq_get capability.quota.confidence)

if [ "$status" = "exhausted" ] && [ "$confidence" = "high" ]; then
  ok "2: live-spend probe correctly classifies quota exhausted"
else
  bad "2: live-spend status=$status confidence=$confidence"
fi

# 2b. qoderclicn live-spend path uses stdin + scratch cwd and records availability.
reset
cat > "$DUMMY_BIN_DIR/qoderclicn" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  echo "1.1.1-test"
  exit 0
fi
cat >/dev/null 2>&1 || true
echo "OK"
exit 0
EOF
chmod +x "$DUMMY_BIN_DIR/qoderclicn"
bash "$PROBE_CLI" quota --runner qoderclicn --model Qwen3.8-Max-Preview --live-spend --store "$TESTDIR" >/dev/null 2>&1

status=$(node "$STATE_CLI" current --runner qoderclicn --model Qwen3.8-Max-Preview --role reviewer --store "$TESTDIR" | jq_get capability.quota.status)
confidence=$(node "$STATE_CLI" current --runner qoderclicn --model Qwen3.8-Max-Preview --role reviewer --store "$TESTDIR" | jq_get capability.quota.confidence)

if [ "$status" = "available" ] && [ "$confidence" = "high" ]; then
  ok "2b: qoderclicn live-spend probe records available"
else
  bad "2b: qoderclicn live-spend status=$status confidence=$confidence"
fi

# 3. (P6 F6) a live-spend failure must NOT persist raw runner stderr (which can contain API
#    keys / tokens on auth failures) into the capability store's evidence — only a non-secret
#    classification. The raw diagnostic goes to the operator's stderr, never the store.
reset
SECRET="sk-SECRETdeadbeef0123456789TOKEN"
cat > "$DUMMY_BIN_DIR/codex" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "exec" ]; then
  echo "401 Unauthorized: invalid api key $SECRET authorization failed" >&2
  exit 1
fi
echo "codex-cli 1.0.0-mock"
exit 0
EOF
chmod +x "$DUMMY_BIN_DIR/codex"

PROBE_STDERR="$TESTDIR/probe-stderr.txt"
bash "$PROBE_CLI" quota --runner codex --model gpt-5.5 --live-spend --store "$TESTDIR" >/dev/null 2>"$PROBE_STDERR"
evidence=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 --role reviewer --store "$TESTDIR" | jq_get capability.quota.evidence)
if printf '%s' "$evidence" | grep -q "$SECRET"; then
  bad "3: evidence leaked the raw runner stderr secret: $evidence"
else
  ok "3: live-spend failure evidence does not persist raw runner stderr (no secret leak)"
fi
# 3b. (P6 F6 r2) the operator-facing stderr diagnostic must also be redacted (CI/operator logs
#     can capture it), so the secret must not appear there either.
if grep -q "$SECRET" "$PROBE_STDERR"; then
  bad "3b: stderr diagnostic leaked the secret: $(cat "$PROBE_STDERR")"
else
  ok "3b: live-spend failure stderr diagnostic is redacted (no secret leak)"
fi

# 4. Exact Codex effort + explicit no-endpoint is genuinely applied to argv
#    before an available row is written.
reset
CAPTURE="$TESTDIR/codex-argv.txt"
cat > "$DUMMY_BIN_DIR/codex" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "exec" ]; then
  printf '%s\n' "$*" >"$PROBE_ARGV_CAPTURE"
  printf 'probe\n'
  exit 0
fi
printf 'codex-cli 1.0.0-mock\n'
EOF
chmod +x "$DUMMY_BIN_DIR/codex"
PROBE_ARGV_CAPTURE="$CAPTURE" bash "$PROBE_CLI" quota --runner codex \
  --model gpt-5.5 --role implementer --effort high --endpoint @none \
  --live-spend --store "$TESTDIR" >/dev/null 2>&1
exact_status=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 \
  --role implementer --effort high --endpoint @none --store "$TESTDIR" \
  | jq_get capability.quota.status)
if [ "$exact_status" = "available" ] \
    && grep -q 'model_reasoning_effort="high"' "$CAPTURE" \
    && grep -q -- '--sandbox read-only' "$CAPTURE"; then
  ok "4: Codex live probe applies exact effort/no-endpoint tuple before authorizing"
else
  bad "4: exact_status=$exact_status argv=$(cat "$CAPTURE" 2>/dev/null)"
fi

# 5. A named endpoint is not a Codex control surface. The exact tuple remains
#    unknown and the runner must not be called.
reset
rm -f "$CAPTURE"
PROBE_ARGV_CAPTURE="$CAPTURE" bash "$PROBE_CLI" quota --runner codex \
  --model gpt-5.5 --role implementer --effort high --endpoint primary \
  --live-spend --store "$TESTDIR" >/dev/null 2>&1
named_status=$(node "$STATE_CLI" current --runner codex --model gpt-5.5 \
  --role implementer --effort high --endpoint primary --store "$TESTDIR" \
  | jq_get capability.quota.status)
if [ "$named_status" = "unknown" ] && [ ! -e "$CAPTURE" ]; then
  ok "5: unsupported Codex named-endpoint tuple stays unknown without runner call"
else
  bad "5: named_status=$named_status runner_called=$([ -e "$CAPTURE" ] && echo yes || echo no)"
fi

# 6. cc-shim has a verified named-endpoint transport but no verified effort
#    control. An effort-bearing tuple must remain unknown without invoking it.
reset
CC_CAPTURE="$TESTDIR/cc-shim-argv.txt"
cat > "$DUMMY_BIN_DIR/claude" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  printf 'claude 1.0.0-mock\n'
  exit 0
fi
printf '%s\n' "$*" >"$PROBE_CC_CAPTURE"
exit 0
EOF
chmod +x "$DUMMY_BIN_DIR/claude"
rm -f "$CC_CAPTURE"
PROBE_CC_CAPTURE="$CC_CAPTURE" bash "$PROBE_CLI" quota --runner cc-shim \
  --model claude-test --role implementer --effort high --endpoint @none \
  --live-spend --store "$TESTDIR" >/dev/null 2>&1
cc_status=$(node "$STATE_CLI" current --runner cc-shim --model claude-test \
  --role implementer --effort high --endpoint @none --store "$TESTDIR" \
  | jq_get capability.quota.status)
if [ "$cc_status" = "unknown" ] && [ ! -e "$CC_CAPTURE" ]; then
  ok "6: unsupported cc-shim effort tuple stays unknown without runner call"
else
  bad "6: cc_status=$cc_status runner_called=$([ -e "$CC_CAPTURE" ] && echo yes || echo no)"
fi

# Restore PATH
export PATH="$OLD_PATH"

echo "----"
echo "probe-engine-capability tests: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
