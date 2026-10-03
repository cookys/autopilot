#!/bin/bash
# prints pid(s) holding LOCK: via /proc/locks inode match -> /proc/<pid>/fd
LOCK="$1"
INODE=$(stat -c %i "$LOCK")
echo "lock inode=$INODE"
grep -E ":$INODE( |$)" /proc/locks | sed 's/^/proc\/locks: /'
for p in /proc/[0-9]*; do
  for fd in $p/fd/*; do
    [ "$(stat -L -c %i "$fd" 2>/dev/null)" = "$INODE" ] && [ "$(readlink "$fd")" = "$LOCK" ] && echo "fd-holder pid=$(basename $p) cmd=$(tr '\0' ' ' < $p/cmdline | cut -c1-120)"
  done
done 2>/dev/null
