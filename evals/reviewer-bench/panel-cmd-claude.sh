#!/usr/bin/env bash
# panel-cmd-claude.sh — Adapter for native Claude CLI review panel
# Usage: panel-cmd-claude.sh <model>

set -uo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "Usage: $0 <model>" >&2
  exit 1
fi

MODEL="$1"

# Resolve claude binary absolute path before cd'ing to scratch cwd
CC_BIN="$(command -v claude 2>/dev/null || true)"
if [ -z "$CC_BIN" ]; then
  echo "panel-cmd-claude: claude binary not found" >&2
  echo "panel-cmd-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

case "$CC_BIN" in
  /*) ;;
  *)  CC_BIN="$(cd "$(dirname "$CC_BIN")" 2>/dev/null && pwd)/$(basename "$CC_BIN")" || true
      case "$CC_BIN" in /*) ;; *) echo "panel-cmd-claude: could not resolve claude to an absolute path" >&2; exit 1 ;; esac ;;
esac

DIFF_TEMP="$(mktemp -t panel-cmd-claude-diff-XXXXXX)"
PROMPT_TEMP="$(mktemp -t panel-cmd-claude-prompt-XXXXXX)"
CC_CWD="$(mktemp -d -t panel-cmd-claude-cwd-XXXXXX)"
RAW_LOG="$(mktemp -t panel-cmd-claude-log-XXXXXX)"

cleanup() {
  rm -f "$DIFF_TEMP" "$PROMPT_TEMP" "$RAW_LOG"
  rm -rf "$CC_CWD"
}
trap cleanup EXIT

# Read diff from stdin
cat > "$DIFF_TEMP"

# Build strict review prompt
cat <<EOF > "$PROMPT_TEMP"
You are a code reviewer.
Review the following diff. Find planted correctness or security defects in it.

Input diff:
$(cat "$DIFF_TEMP")

Instruction: Your final response MUST end with exactly one line:
VERDICT: SHIP-AS-IS
(if no defects are found) or
VERDICT: FIX-THEN-SHIP
(if defects are found).
Do not print anything after that line.
EOF

# Invoke claude with cc-shim hardening settings (except unsetting ANTHROPIC_API_KEY to preserve native API auth)
# stdout ONLY into RAW_LOG — the VERDICT is parsed from model output; stderr is
# diagnostics and must never be able to satisfy the parse (round-3 review finding).
ERR_LOG="$RAW_LOG.err"
timeout 300 env HOME="$CC_CWD" \
    bash -c 'cd "$1" && exec "$2" -p --model "$3" --setting-sources project --strict-mcp-config --tools "" < "$4"' \
    _ "$CC_CWD" "$CC_BIN" "$MODEL" "$PROMPT_TEMP" > "$RAW_LOG" 2>"$ERR_LOG"
CC_RC=$?
[ -s "$ERR_LOG" ] && sed 's/^/panel-cmd-claude[stderr]: /' "$ERR_LOG" >&2
rm -f "$ERR_LOG"

# Check for timeout or crash or empty output
if [ "$CC_RC" -ne 0 ] || [ ! -s "$RAW_LOG" ]; then
  echo "panel-cmd-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

# Extract the last VERDICT: line
LAST_VERDICT_LINE="$(grep -a "VERDICT:" "$RAW_LOG" | tail -n 1)"
VERDICT_VAL="$(echo "$LAST_VERDICT_LINE" | sed -n 's/.*VERDICT:[[:space:]]*\**\([a-zA-Z-]*\)\**.*/\1/p' | tr -d '\r')"

if [ "$VERDICT_VAL" = "SHIP-AS-IS" ]; then
  echo '{"verdict":"pass"}'
elif [ "$VERDICT_VAL" = "FIX-THEN-SHIP" ]; then
  echo '{"verdict":"fail"}'
else
  echo "panel-cmd-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
fi
