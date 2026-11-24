#!/usr/bin/env bash
# dispatch-from-scratch.sh — Route `Task-Shape: from-scratch` briefs to CN cloud
# engines (minimax first, kimi second) inside an empty non-git sandbox.
#
# Usage:
#   scripts/dispatch-from-scratch.sh --prompt-file <brief>
#
# Exit codes:
#   0  Dispatch succeeded; prints manifest path, engine, raw_log path, and review notice.
#   1  All candidate engines failed (prints reason).
#   2  Usage error or brief missing `Task-Shape: from-scratch` in its first 10 lines.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTHOR_BIN="${AUTHOR_BIN:-$SCRIPT_DIR/dispatch-author.sh}"

usage() {
  cat >&2 <<'EOF'
Usage: scripts/dispatch-from-scratch.sh --prompt-file <brief>
EOF
}

PROMPT_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      PROMPT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "dispatch-from-scratch: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$PROMPT_FILE" || ! -f "$PROMPT_FILE" ]]; then
  echo "dispatch-from-scratch: --prompt-file must point to an existing file" >&2
  exit 2
fi

if ! head -n 10 "$PROMPT_FILE" | grep -q 'Task-Shape: from-scratch'; then
  echo "dispatch-from-scratch: brief first 10 lines must contain 'Task-Shape: from-scratch'" >&2
  exit 2
fi

TMP_ROOT="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
SB=""
cleanup() {
  if [[ -n "${SB:-}" && "$SB" == "$TMP_ROOT"/* && -d "$SB" ]]; then
    rm -rf -- "$SB"
  fi
}
trap cleanup EXIT

SB="$(mktemp -d "$TMP_ROOT/from-scratch.XXXXXX")"
BRIEF_NAME="$(basename -- "$PROMPT_FILE")"
cp -- "$PROMPT_FILE" "$SB/$BRIEF_NAME"

export PATH="$PATH:$HOME/.local/bin:$HOME/.kimi-code/bin"

# Candidate engines: (label, runner, endpoint, model)
CANDIDATES=(
  "minimax|cc-shim|minimax|MiniMax-M3"
  "kimi|kimi||kimi-code/k3"
)

REASONS=()
for entry in "${CANDIDATES[@]}"; do
  IFS='|' read -r label runner endpoint model <<< "$entry"
  out=""
  rc=0
  ep_args=()
  [[ -z "$endpoint" ]] || ep_args=(--endpoint "$endpoint")
  out="$(cd "$SB" && "$AUTHOR_BIN" --runner "$runner" ${ep_args[@]+"${ep_args[@]}"} --model "$model" --prompt-file "$SB/$BRIEF_NAME" 2>&1)" || rc=$?

  if [[ $rc -eq 0 ]]; then
    manifest="$(printf '%s\n' "$out" | grep -o 'manifest=[^ ]*' | head -n 1 | cut -d= -f2- || true)"
    raw_log="$(printf '%s\n' "$out" | node -e '
      const fs = require("fs");
      const raw = fs.readFileSync(0, "utf8");
      for (const line of raw.split(/\r?\n/).reverse()) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          const j = JSON.parse(t);
          console.log(j.raw_log || "");
          process.exit(0);
        } catch {}
      }
    ' 2>/dev/null || true)"
    echo "engine: $label ($model)"
    echo "manifest: ${manifest:-<none>}"
    echo "raw_log: ${raw_log:-<none>}"
    echo "產出未審，進 repo 前須 Claude 席或 agy 審"
    exit 0
  fi

  if printf '%s' "$out" | grep -q 'precondition_failed\|kimi_local_stopped'; then
    REASONS+=("$label: precondition_failed (skipped)")
    continue
  fi
  REASONS+=("$label: rc=$rc")
done

echo "dispatch-from-scratch: all engines failed: ${REASONS[*]}" >&2
exit 1
