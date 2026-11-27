#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Assert scheduled-wakeup-guard.js UserPromptSubmit output is under 220 bytes
OUT_WAKEUP=$(printf '{"hook_event_name":"UserPromptSubmit","turnOrigin":"scheduled","prompt":"check status"}\n' | node "$ROOT/hooks/scheduled-wakeup-guard.js")
BYTES_WAKEUP=$(printf '%s' "$OUT_WAKEUP" | wc -c)
if [ "$BYTES_WAKEUP" -gt 220 ]; then
  echo "FAIL: scheduled-wakeup-guard.js UserPromptSubmit emitted $BYTES_WAKEUP bytes (> 220)" >&2
  exit 1
fi

# Assert scheduled-wakeup-guard.js PreToolUse ScheduleWakeup output is under 240 bytes
OUT_GO=$(printf '{"hook_event_name":"PreToolUse","tool_name":"ScheduleWakeup","tool_input":{"prompt":"PM go"}}\n' | node "$ROOT/hooks/scheduled-wakeup-guard.js")
BYTES_GO=$(printf '%s' "$OUT_GO" | wc -c)
if [ "$BYTES_GO" -gt 240 ]; then
  echo "FAIL: scheduled-wakeup-guard.js PreToolUse emitted $BYTES_GO bytes (> 240)" >&2
  exit 1
fi

echo "PASS: injection-size.test.sh (wakeup=${BYTES_WAKEUP}B, go=${BYTES_GO}B)"
