#!/usr/bin/env bash
# record.sh <qwen|glm> <reviewer|implementer|author|consult> — append that cell's emit-row.json to the scorecard by hand.
# Local self-exam on the team account: recording directly is allowed. Run only after reading emit-row.json and stderr.log.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
r="${2:?role}"; [ "$r" = author ] && r=verification_author
D="$HERE/out/${1:?lane}-$r"
cd "$REPO" || exit 2
node scripts/engine-scorecard.js record --file "$D/emit-row.json" > "$D/record-out.json" 2> "$D/record-err.log"
echo "record rc=$?"; grep -o '"event_id":[0-9]*' "$D/record-out.json" | head -2
