#!/usr/bin/env bash
# launch-cell.sh <scenario> <arm> <rep>   (run detached; prints rc= when done). Real seat calls.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
EVID="$(dirname "$HERE")"
ROOT="$(cd "$EVID/../../../.." && pwd)"
SC="$1"; ARM="$2"; REP="$3"; VAR="${4:-loc}"
TAG="$SC-$ARM-r$REP"
[ "$VAR" = raw ] && TAG="$SC-${ARM}raw-r$REP"
OUT="$EVID/cells"; mkdir -p "$OUT"
WORK="${D5_WORK:-/tmp/d5-work}"; mkdir -p "$WORK"
SEATS="$(cd "$ROOT" && bash scripts/resolve-review-loop.sh 2>/dev/null | grep '^{' | head -1)"
node -e '
const fs=require("fs");
const [, root, out, tag, sc, arm, work, evid, seatsJson, variant]=process.argv;
const seats=JSON.parse(seatsJson).qc_panel_seats.filter((s)=>s.runner!=="opencode");
fs.writeFileSync(out+"/"+tag+".ctx.json", JSON.stringify({root,out,tag,scenario:sc,arm,seats,workParent:work,budgetFile:out+"/spend.json",budgetCapUsd:40,specVariant:variant,pricesFile:evid+"/harness/prices.json"}));
' "$ROOT" "$OUT" "$TAG" "$SC" "$ARM" "$WORK" "$EVID" "$SEATS" "$VAR"
cd "$ROOT"
node "$HERE/run-cell.js" "$OUT/$TAG.ctx.json" > "$OUT/$TAG.stdout" 2> "$OUT/$TAG.stderr"
echo "rc=$? tag=$TAG" >> "$OUT/_done.log"
