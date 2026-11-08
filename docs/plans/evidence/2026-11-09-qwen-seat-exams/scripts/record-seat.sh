#!/usr/bin/env bash
# record-seat.sh <cell-dir-name>   append that cell's emit-row.json to the scorecard (local self-exam on the team account,
# 11-08 precedent). Run only after reading emit-row.json and stderr.log.
SEATDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; REPO="${REPO:-$SEATDIR/land}"
D="$SEATDIR/cells/${1:?cell dir}"; cd "$REPO" || exit 2
node scripts/engine-scorecard.js record --file "$D/emit-row.json" > "$D/record-out.json" 2> "$D/record-err.log"
echo "record rc=$?"; grep -o '"event_id":[0-9]*' "$D/record-out.json" | head -3
