#!/usr/bin/env bash
# Prints the first hetero run that flips from running to terminal within ~9.5 minutes.
cd /home/cookys/projects/autopilot
seen=""
for i in $(seq 1 38); do
  for m in $(/bin/ls -t /tmp/autopilot-dispatch-runs/hetero-*.manifest.json | head -6); do
    id=$(basename "$m" .manifest.json)
    ph=$(node scripts/dispatch-status.js --run "$id" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.phase+" "+j.final_status)}catch{console.log("? ?")}})')
    case "$ph" in running*) seen="$seen $id";; *) case " $seen " in *" $id "*) b=$(node -e 'console.log(require(process.argv[1]).branch)' "$m"); echo "TERMINAL $id $b $ph"; exit 0;; esac;; esac
  done
  sleep 15
done
echo "NO-FLIP (running: $seen)"; exit 1
