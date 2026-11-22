#!/usr/bin/env bash
# hetero-panel.sh — thin wrapper around scripts/dispatch-panel.js for PM two-engine panel runs.
#
# Usage:
#   scripts/hetero-panel.sh <prompt.md> [--attach FILE]... [--astra] [--upload] [--timeout 15m] [--run-id NAME] [--out-dir DIR] [--author-cmd PATH]
#
# Seats:
#   Default: PM's pinned judge engine resolved via scripts/resolve-dispatch.sh --role reviewer.
#   With --astra: adds a second independent seat (codex:astra).
#
# Exit codes:
#   0  all seats processed and receipts written
#   2  usage / CLI argument error
#   4  propagated from dispatch-panel.js (de-identification refusal, empty/unreadable prompt, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH_PANEL_JS="$SCRIPT_DIR/dispatch-panel.js"
RESOLVE_DISPATCH_SH="$SCRIPT_DIR/resolve-dispatch.sh"

PROMPT_FILE=""
ATTACH_FILES=()
USE_ASTRA=0
DO_UPLOAD=0
TIMEOUT="15m"
RUN_ID=""
OUT_DIR=""
AUTHOR_CMD=""

usage() {
  cat <<'EOF' >&2
Usage: scripts/hetero-panel.sh <prompt.md> [--attach FILE]... [--astra] [--upload] [--timeout 15m] [--run-id NAME] [--out-dir DIR] [--author-cmd PATH]
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      ;;
    --attach)
      [[ $# -ge 2 ]] || usage
      ATTACH_FILES+=("$2")
      shift 2
      ;;
    --astra)
      USE_ASTRA=1
      shift
      ;;
    --upload)
      DO_UPLOAD=1
      shift
      ;;
    --timeout)
      [[ $# -ge 2 ]] || usage
      TIMEOUT="$2"
      shift 2
      ;;
    --run-id)
      [[ $# -ge 2 ]] || usage
      RUN_ID="$2"
      shift 2
      ;;
    --out-dir)
      [[ $# -ge 2 ]] || usage
      OUT_DIR="$2"
      shift 2
      ;;
    --author-cmd)
      [[ $# -ge 2 ]] || usage
      AUTHOR_CMD="$2"
      shift 2
      ;;
    --*)
      echo "hetero-panel: unknown option: $1" >&2
      usage
      ;;
    *)
      if [[ -z "$PROMPT_FILE" ]]; then
        PROMPT_FILE="$1"
        shift
      else
        echo "hetero-panel: unexpected argument: $1" >&2
        usage
      fi
      ;;
  esac
done

[[ -n "$PROMPT_FILE" ]] || usage
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "hetero-panel: prompt file not found: $PROMPT_FILE" >&2
  exit 4
fi

TMP_WORK=""
cleanup() {
  if [[ -n "$TMP_WORK" && -d "$TMP_WORK" ]]; then
    rm -rf "$TMP_WORK"
  fi
}
trap cleanup EXIT

BASE_TMP="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
TMP_WORK="$(mktemp -d "${BASE_TMP%/}/hetero-panel.XXXXXX")"

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$(mktemp -d "${BASE_TMP%/}/hetero-panel-out.XXXXXX")"
else
  mkdir -p "$OUT_DIR"
fi

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="panel-$(date -u +%Y%m%dT%H%M%SZ)-$$"
fi

# Assemble prompt with any --attach files
EFFECTIVE_PROMPT="$PROMPT_FILE"
if [[ ${#ATTACH_FILES[@]} -gt 0 ]]; then
  EFFECTIVE_PROMPT="$TMP_WORK/prompt.md"
  cat "$PROMPT_FILE" > "$EFFECTIVE_PROMPT"
  for f in "${ATTACH_FILES[@]}"; do
    if [[ ! -f "$f" ]]; then
      echo "hetero-panel: attached file not found: $f" >&2
      exit 2
    fi
    printf '\n\n---\n## Attached: %s\n\n' "$f" >> "$EFFECTIVE_PROMPT"
    cat "$f" >> "$EFFECTIVE_PROMPT"
  done
fi

# Resolve default judge seat from resolve-dispatch.sh (no hardcoded model id)
RESOLVED_JSON="$(bash "$RESOLVE_DISPATCH_SH" --role reviewer)"
PRIMARY_SEAT="$(node -e '
const data = JSON.parse(process.argv[1]);
const m = String(data.model || "").trim();
if (!m) process.exit(1);
if (m.includes(":")) { console.log(m); }
else if (["sonnet","opus","haiku","fable"].includes(m)) { console.log("claude-native:" + m); }
else { console.log(m); }
' "$RESOLVED_JSON")"

PANEL_OUT="$TMP_WORK/panel"
PANEL_ARGS=(
  "$DISPATCH_PANEL_JS"
  --prompt-file "$EFFECTIVE_PROMPT"
  --out-dir "$PANEL_OUT"
  --timeout "$TIMEOUT"
  --seat "$PRIMARY_SEAT"
)
if [[ "$USE_ASTRA" -eq 1 ]]; then
  PANEL_ARGS+=(--seat "codex:astra")
fi
if [[ -n "$AUTHOR_CMD" ]]; then
  PANEL_ARGS+=(--author-cmd "$AUTHOR_CMD")
fi

# Run dispatch-panel in foreground; propagate its exit code (e.g. exit 4 on leak-guard hit)
set +e
node "${PANEL_ARGS[@]}"
PANEL_RC=$?
set -e
if [[ "$PANEL_RC" -ne 0 ]]; then
  exit "$PANEL_RC"
fi

PANEL_JSON="$PANEL_OUT/panel.json"
if [[ ! -f "$PANEL_JSON" ]]; then
  echo "hetero-panel: missing panel.json at $PANEL_JSON" >&2
  exit 1
fi

RECEIPT_DIR="$OUT_DIR/receipts/$RUN_ID"
mkdir -p "$RECEIPT_DIR"

# Extract seats from panel.json and copy answers to receipts/<run>/<engine>.md
SEAT_LINES="$(node -e '
const fs = require("fs");
const panel = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const s of (panel.seats || [])) {
  const name = String(s.seat || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  const outPath = s.out_path || "";
  const status = s.status || "unknown";
  console.log([name, status, outPath].join("\t"));
}
' "$PANEL_JSON")"

ANSWER_PATHS=()
BLOB_REFS=()
FLEET_CMD="${AUTOPILOT_FLEET_BIN:-fleet}"
FLEET_MISSING_NOTICED=0

while IFS=$'\t' read -r ENGINE STATUS OUT_PATH; do
  [[ -n "$ENGINE" ]] || continue
  if [[ "$STATUS" != "ok" || -z "$OUT_PATH" || ! -f "$OUT_PATH" ]]; then
    echo "seat=$ENGINE status=$STATUS sha16=- critical=0"
    continue
  fi

  RECEIPT_MD="$RECEIPT_DIR/${ENGINE}.md"
  cp "$OUT_PATH" "$RECEIPT_MD"
  SHA16="$(sha256sum "$RECEIPT_MD" | awk '{print substr($1, 1, 16)}')"
  printf '%s\n' "$SHA16" > "${RECEIPT_MD}.sha256"

  CRIT_COUNT="$(grep -c '🔴' "$RECEIPT_MD" || true)"
  VERDICT_LINE="$(grep -iE '^(verdict|score)[[:space:]]*:' "$RECEIPT_MD" | head -n 1 | tr '\r\n' '  ' || true)"

  if [[ -n "$VERDICT_LINE" ]]; then
    echo "seat=$ENGINE sha16=$SHA16 critical=$CRIT_COUNT verdict=\"$VERDICT_LINE\""
  else
    echo "seat=$ENGINE sha16=$SHA16 critical=$CRIT_COUNT"
  fi

  ANSWER_PATHS+=("$RECEIPT_MD")

  if [[ "$DO_UPLOAD" -eq 1 ]]; then
    if command -v "$FLEET_CMD" >/dev/null 2>&1; then
      BLOB_REF="$("$FLEET_CMD" upload "$RECEIPT_MD" 2>/dev/null | tail -n 1 || true)"
      if [[ -n "$BLOB_REF" ]]; then
        BLOB_REFS+=("$BLOB_REF")
      fi
    elif [[ "$FLEET_MISSING_NOTICED" -eq 0 ]]; then
      echo "hetero-panel: fleet CLI not found; skipping upload" >&2
      FLEET_MISSING_NOTICED=1
    fi
  fi
done <<< "$SEAT_LINES"

for p in "${ANSWER_PATHS[@]}"; do
  echo "$p"
done
for b in "${BLOB_REFS[@]}"; do
  echo "$b"
done
