#!/bin/bash
# trial.sh <n> : drop manifest kr1-run<n> (held by a live flock) and time the band until "running <n>"
K=$1; N=$2; IDENT=$(cat $K/ident)
: > $K/hold$N.lock
setsid flock $K/hold$N.lock sleep 600 < /dev/null > /dev/null 2>&1 &
echo $! > $K/hold$N.pid
sleep 0.5
T0=$(date +%s%N); echo $T0 > $K/T0.$N
printf '{"schema":1,"run_id":"kr1-run%s","role":"implementer","runner":"codex","model":"m","started_at":"%s","started_epoch":%s,"ended_at":null,"ended_epoch":null,"final_status":null,"log_path":"/nonexistent","lock_path":"%s","pid":null,"scope_unit":null,"log_format":"plain","ledger":null,"stage":null,"repo_identity":"%s","root_run_id":"root-kr1","parent_run_id":null,"depth":0}\n' "$N" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(date +%s)" "$K/hold$N.lock" "$IDENT" > $K/runs/kr1-run$N.manifest.json
end=$(( $(date +%s) + 90 )); : > $K/capture.$N.log
while [ $(date +%s) -lt $end ]; do
  line=$(tmux capture-pane -p -t kr1 | grep -o "running [0-9]* · oldest [0-9:—]*" | head -1)
  echo "$(date +%s%N) $line" >> $K/capture.$N.log
  case "$line" in "running $N "*) break;; esac
  sleep 1
done
TB=$(tail -1 $K/capture.$N.log | cut -d' ' -f1)
echo "trial $N delta_ms=$(( (TB - T0)/1000000 )) band='$(tail -1 $K/capture.$N.log | cut -d' ' -f2-)'" | tee $K/trial.$N.result
