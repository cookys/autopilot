#!/usr/bin/env bash
# panel-cmd-contract-claude.sh — Reviewer-bench panel-cmd adapter with contract injection
# Usage: panel-cmd-contract-claude.sh <reviewer-md-path> <code-review-md-path> <model>

set -uo pipefail

if [ $# -ne 3 ] || [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "Usage: $0 <reviewer-md-path> <code-review-md-path> <model>" >&2
  exit 1
fi

REVIEWER_MD="$1"
SPEC_MD="$2"
MODEL="$3"

if [ ! -f "$REVIEWER_MD" ] || [ ! -r "$REVIEWER_MD" ]; then
  echo "panel-cmd-contract-claude: reviewer methodology contract file does not exist or is not readable: $REVIEWER_MD" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

if [ ! -f "$SPEC_MD" ] || [ ! -r "$SPEC_MD" ]; then
  echo "panel-cmd-contract-claude: canonical review spec file does not exist or is not readable: $SPEC_MD" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

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

DIFF_TEMP="$(mktemp -t panel-cmd-contract-claude-diff-XXXXXX)"
PROMPT_TEMP="$(mktemp -t panel-cmd-contract-claude-prompt-XXXXXX)"
CC_CWD="$(mktemp -d -t panel-cmd-contract-claude-cwd-XXXXXX)"
RAW_LOG="$(mktemp -t panel-cmd-contract-claude-log-XXXXXX)"

cleanup() {
  rm -f "$DIFF_TEMP" "$PROMPT_TEMP" "$RAW_LOG" "$RAW_LOG.err"
  rm -rf "$CC_CWD"
}
trap cleanup EXIT

cat > "$DIFF_TEMP"

# Build prompt file by appending in stages to prevent parsing issues with markdown
cat "$REVIEWER_MD" > "$PROMPT_TEMP"
printf '\n\n' >> "$PROMPT_TEMP"
cat "$SPEC_MD" >> "$PROMPT_TEMP"
printf '\n\nInput diff:\n' >> "$PROMPT_TEMP"
cat "$DIFF_TEMP" >> "$PROMPT_TEMP"
printf '\n\nInstruction: Your final response MUST end with exactly one line:\nVERDICT: SHIP-AS-IS\n(if no defects are found) or\nVERDICT: FIX-THEN-SHIP\n(if defects are found).\nDo not print anything after that line.\n' >> "$PROMPT_TEMP"

ERR_LOG="$RAW_LOG.err"
timeout 300 bash -c 'cd "$1" && exec "$2" -p --model "$3" --setting-sources project --strict-mcp-config --tools "" < "$4"' \
    _ "$CC_CWD" "$CC_BIN" "$MODEL" "$PROMPT_TEMP" > "$RAW_LOG" 2>"$ERR_LOG"
CC_RC=$?
[ -s "$ERR_LOG" ] && sed 's/^/panel-cmd-contract-claude[stderr]: /' "$ERR_LOG" >&2
rm -f "$ERR_LOG"

if [ "$CC_RC" -ne 0 ] || [ ! -s "$RAW_LOG" ]; then
  echo "panel-cmd-contract-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

LAST_VERDICT_LINE="$(grep -a "VERDICT:" "$RAW_LOG" | tail -n 1)"
VERDICT_VAL="$(echo "$LAST_VERDICT_LINE" | sed -n 's/.*VERDICT:[[:space:]]*\**\([a-zA-Z-]*\)\**.*/\1/p' | tr -d '\r')"

if [ "$VERDICT_VAL" = "SHIP-AS-IS" ]; then
  echo '{"verdict":"pass"}'
elif [ "$VERDICT_VAL" = "FIX-THEN-SHIP" ]; then
  echo '{"verdict":"fail"}'
else
  echo "panel-cmd-contract-claude: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
fi
