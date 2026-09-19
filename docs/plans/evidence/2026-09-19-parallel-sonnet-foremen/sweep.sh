#!/usr/bin/env bash
cd "$1"; out="$2"; : > "$out"
while read -r s; do t0=$(date +%s); env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" > "$out.$(basename $s).log" 2>&1 < /dev/null; echo "rc=$? $(( $(date +%s)-t0 ))s $s" >> "$out"; done < "$3"
echo DONE >> "$out"
