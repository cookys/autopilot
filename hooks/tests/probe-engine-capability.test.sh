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

# Restore PATH
export PATH="$OLD_PATH"

echo "----"
echo "probe-engine-capability tests: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
