#!/bin/bash
# samples live kimi-code exam children until chain.log says CHAIN DONE
R=~/.autopilot/qualify-drivers/roles; OUT=$R/effort-samples.log
while ! grep -q "CHAIN DONE" $R/chain.log 2>/dev/null; do
  for p in $(ps -eo pid,comm | awk '$2 ~ /^kimi-code/ {print $1}'); do
    env=$(tr '\0' '\n' < /proc/$p/environ 2>/dev/null)
    h=$(sed -n 's/^HOME=//p' <<<"$env"); e=$(grep -o 'KIMI_MODEL_THINKING_EFFORT=[a-z]*' <<<"$env")
    case "$h" in *qrp-clihome*) ;; *) continue;; esac
    w=$(sudo find /proc/$p/root$h/.kimi-code/sessions -name wire.jsonl 2>/dev/null | head -1)
    te=$([ -n "$w" ] && sudo grep -oE '"thinkingEffort":"[a-z]+"' "$w" | sort | uniq -c | tr -s ' \n' ' ')
    echo "$(date +%T) pid=$p ${e:-NO_ENV} wire=[${te}]" >> $OUT
  done
  sleep 2
done
