#!/usr/bin/env bash
# Test for pm-seat-cost-daily.sh: re-running the same day keeps exactly one row (negative control: a plain append would give two).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/s"
printf '%s\n' '{"type":"assistant","timestamp":"2026-11-22T01:00:00.000Z","message":{"id":"a1","role":"assistant","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1,"cache_read_input_tokens":10}}}' > "$T/s/x.jsonl"
bash "$HERE/pm-seat-cost-daily.sh" --sessions-dir "$T/s" --out-dir "$T/o" --day 2026-11-22 >/dev/null
bash "$HERE/pm-seat-cost-daily.sh" --sessions-dir "$T/s" --out-dir "$T/o" --day 2026-11-22 >/dev/null
n="$(wc -l < "$T/o/rows.jsonl")"
[ "$n" = 1 ] || { echo "FAIL: expected 1 row after a re-run, got $n"; exit 1; }
grep -q '"day":"2026-11-22"' "$T/o/rows.jsonl" || { echo "FAIL: row has wrong day"; exit 1; }
if bash "$HERE/pm-seat-cost-daily.sh" --out-dir "$T/o" >/dev/null 2>&1; then echo "FAIL: missing --sessions-dir must exit non-zero"; exit 1; fi
echo "pm-seat-cost-daily.test.sh: ok"
