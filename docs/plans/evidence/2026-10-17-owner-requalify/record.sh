#!/usr/bin/env bash
# record.sh <out-dir-name> -- append out/<name>/emit-row.json to the scorecard by hand; print summary. Read emit-row.json and stderr.log first.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; REPO="$(cd "$HERE/../../../.." && pwd)"
D="$HERE/out/${1:?out dir name}"
cd "$REPO" || exit 2
node scripts/engine-scorecard.js record --file "$D/emit-row.json" > "$D/record-out.json" 2> "$D/record-err.log"
echo "record rc=$?"
grep -o '"event_id":[0-9]*' "$D/record-out.json" | head -2
node -e 'const r=require(process.argv[1]);console.log(JSON.stringify(r.quality), JSON.stringify(r.latency), r.status)' "$D/emit-row.json"
