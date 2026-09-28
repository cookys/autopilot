#!/usr/bin/env bash
# Guard: tests must not write the operator's real capability store.

set -uo pipefail
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/scripts/engine-capability-state.js"
PASS=0; FAIL=0
SUITE_HOME="$(mktemp -d)"
trap 'rm -rf "$SUITE_HOME"' EXIT

ok()   { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

event_json() {
  cat <<'JSON'
{
  "schema_version": 1,
  "observed_at": "2026-09-28T00:00:00Z",
  "runner": "codex",
  "model": "gpt-5.5",
  "role": "reviewer",
  "runner_version": "v1.0.0",
  "capability": {
    "quota": {
      "status": "available",
      "confidence": "high",
      "ttl_seconds": 3600,
      "reset_at": null,
      "evidence": "guard-test"
    }
  }
}
JSON
}

default_store() {
  printf '%s/.autopilot/engine-capability/capability.jsonl' "$1"
}

# Isolate from any ambient store env the harness may inject.
unset ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE AUTOPILOT_TEST_REAL_HOME_OVERRIDE

# 1. Guard on, HOME=temp, no store override → ALLOWED
export HOME="$SUITE_HOME"
export AUTOPILOT_TEST_RUN_GUARD=1
unset AUTOPILOT_TEST_REAL_HOME_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE
store1="$(default_store "$SUITE_HOME")"
rm -f "$store1"
out1="$(mktemp)"
err1="$(mktemp)"
set +e
echo "$(event_json)" | env -u ENGINE_CAPABILITY_DIR -u ENGINE_CAPABILITY_FILE \
  HOME="$SUITE_HOME" AUTOPILOT_TEST_RUN_GUARD=1 \
  node "$CLI" record >"$out1" 2>"$err1"
ec1=$?
set -e
if [ "$ec1" = "0" ] && [ -s "$store1" ]; then
  ok "1: guard on + temp HOME allows default-fallback write"
else
  bad "1: exit=$ec1 store_exists=$([ -s "$store1" ] && echo yes || echo no) stderr=$(cat "$err1")"
fi
rm -f "$out1" "$err1"

# 2. Guard on + REAL_HOME_OVERRIDE=$HOME (simulates real home) → REFUSED
export AUTOPILOT_TEST_REAL_HOME_OVERRIDE="$SUITE_HOME"
store2="$(default_store "$SUITE_HOME")"
before2=""
[ -f "$store2" ] && before2="$(cat "$store2")"
err2="$(mktemp)"
out2="$(mktemp)"
set +e
echo "$(event_json)" | env -u ENGINE_CAPABILITY_DIR -u ENGINE_CAPABILITY_FILE \
  HOME="$SUITE_HOME" AUTOPILOT_TEST_RUN_GUARD=1 \
  AUTOPILOT_TEST_REAL_HOME_OVERRIDE="$SUITE_HOME" \
  node "$CLI" record >"$out2" 2>"$err2"
ec2=$?
set -e
after2=""
[ -f "$store2" ] && after2="$(cat "$store2")"
stderr2="$(tr '\n' ' ' <"$err2")"
if [ "$ec2" != "0" ] \
  && echo "$stderr2" | grep -q "$SUITE_HOME/.autopilot/engine-capability" \
  && echo "$stderr2" | grep -q "record" \
  && echo "$stderr2" | grep -qF "set ENGINE_CAPABILITY_DIR (hooks/tests/lib.sh does this)" \
  && [ "$before2" = "$after2" ]; then
  ok "2: guard refuses default-fallback under simulated real home"
else
  bad "2: exit=$ec2 stderr=$(cat "$err2") before_eq_after=$([ "$before2" = "$after2" ] && echo yes || echo no)"
fi
rm -f "$err2" "$out2"

# 3. Guard unset, same override → ALLOWED (opt-in only)
store3="$(default_store "$SUITE_HOME")"
rm -f "$store3"
out3="$(mktemp)"
err3="$(mktemp)"
set +e
echo "$(event_json)" | env -u ENGINE_CAPABILITY_DIR -u ENGINE_CAPABILITY_FILE \
  -u AUTOPILOT_TEST_RUN_GUARD \
  HOME="$SUITE_HOME" AUTOPILOT_TEST_REAL_HOME_OVERRIDE="$SUITE_HOME" \
  node "$CLI" record >"$out3" 2>"$err3"
ec3=$?
set -e
if [ "$ec3" = "0" ] && [ -s "$store3" ]; then
  ok "3: guard unset allows write even with real-home override"
else
  bad "3: exit=$ec3 store_exists=$([ -s "$store3" ] && echo yes || echo no) stderr=$(cat "$err3")"
fi
rm -f "$out3" "$err3"

# 4. Guard on + explicit --store, even with override → ALLOWED
explicit="$(mktemp -d)"
trap 'rm -rf "$SUITE_HOME" "$explicit"' EXIT
out4="$(mktemp)"
err4="$(mktemp)"
set +e
echo "$(event_json)" | env -u ENGINE_CAPABILITY_DIR -u ENGINE_CAPABILITY_FILE \
  HOME="$SUITE_HOME" AUTOPILOT_TEST_RUN_GUARD=1 \
  AUTOPILOT_TEST_REAL_HOME_OVERRIDE="$SUITE_HOME" \
  node "$CLI" record --store "$explicit" >"$out4" 2>"$err4"
ec4=$?
set -e
if [ "$ec4" = "0" ] && [ -s "$explicit/capability.jsonl" ]; then
  ok "4: explicit --store allowed under guard + override"
else
  bad "4: exit=$ec4 store_exists=$([ -s "$explicit/capability.jsonl" ] && echo yes || echo no) stderr=$(cat "$err4")"
fi
rm -f "$out4" "$err4"

echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
