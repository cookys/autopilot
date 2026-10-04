#!/bin/bash
# capture-pane with epoch-ms timestamps once a second until the band shows "running 1" (or 90 s)
K=$1
end=$(( $(date +%s) + 90 ))
: > $K/capture.log
while [ $(date +%s) -lt $end ]; do
  line=$(tmux capture-pane -p -t kr1 | grep "running" | head -1)
  echo "$(date +%s%3N) $line" >> $K/capture.log
  case "$line" in *"running 1 "*) exit 0;; esac
  sleep 1
done
