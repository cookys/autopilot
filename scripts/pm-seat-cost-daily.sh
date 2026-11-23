#!/usr/bin/env bash
# Daily wrapper for scripts/pm-seat-cost-metrics.js: appends the previous UTC day's row to <out-dir>/rows.jsonl.
# Usage: pm-seat-cost-daily.sh --sessions-dir <dir> --out-dir <dir> [--day YYYY-MM-DD] [--dry-run]
# Default day = the UTC day before now; at 00:30 Taipei (16:30 UTC) that day is already complete.
set -euo pipefail
SESS=""; OUT=""; DAY=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --sessions-dir) SESS="$2"; shift 2 ;;
    --out-dir) OUT="$2"; shift 2 ;;
    --day) DAY="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SESS" ] && [ -n "$OUT" ] || { echo "need --sessions-dir and --out-dir" >&2; exit 2; }
[ -n "$DAY" ] || DAY="$(date -u -d 'yesterday' +%F)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD=(node "$HERE/pm-seat-cost-metrics.js" --sessions-dir "$SESS" --day "$DAY")
if [ "$DRY" = 1 ]; then printf '%s >> %s/rows.jsonl\n' "${CMD[*]}" "$OUT"; exit 0; fi
mkdir -p "$OUT"
ROW="$("${CMD[@]}")"
# one row per day: drop an earlier row of the same day, then append (idempotent re-run)
if [ -f "$OUT/rows.jsonl" ]; then grep -vF "\"day\":\"$DAY\"" "$OUT/rows.jsonl" > "$OUT/rows.jsonl.tmp" || true; mv "$OUT/rows.jsonl.tmp" "$OUT/rows.jsonl"; fi
printf '%s\n' "$ROW" >> "$OUT/rows.jsonl"
echo "pm-seat-cost-daily: wrote $DAY to $OUT/rows.jsonl"
