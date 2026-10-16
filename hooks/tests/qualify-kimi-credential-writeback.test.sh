#!/usr/bin/env bash
# BL-0199: staged kimi credential is written back (with backup) on exit; unchanged => untouched. All in a fake HOME.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="${QUALIFY_LIB:-$REPO/scripts/lib/qualify-stage-credentials.sh}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok() { if [ "$1" = 0 ]; then pass=$((pass+1)); echo "PASS: $2"; else fail=$((fail+1)); echo "FAIL: $2"; fi; }
mkhome() {
  H="$T/$1"; mkdir -p "$H/.kimi-code/credentials" "$H/stage/credentials"
  echo '{"refresh_token":"old"}' >"$H/.kimi-code/credentials/kimi-code.json"; chmod 644 "$H/.kimi-code/credentials/kimi-code.json"
  cp "$H/.kimi-code/credentials/kimi-code.json" "$H/stage/credentials/kimi-code.json"
  touch -d '2 hours ago' "$H/.kimi-code/credentials/kimi-code.json"
}
runner() { # $1 home, $2 mode: rotate|same|kill
  HOME="$1" QUALIFY_KIMI_REAL_DIR="$1/.kimi-code" bash -c '
    source "$0"; qualify_kimi_arm_writeback "$HOME/stage"
    if [ "$1" != same ]; then echo "{\"refresh_token\":\"new\"}" >"$HOME/stage/credentials/kimi-code.json"; fi
    if [ "$1" = kill ]; then echo $$ >"$HOME/pid"; sleep 30 & wait; fi
    exit 0' "$LIB" "$2"
}
R() { echo "$1/.kimi-code/credentials/kimi-code.json"; }
nbak() { ls "$1/.kimi-code/credentials/" | grep -c 'kimi-code.json.bak-'; }

mkhome a; runner "$H" rotate
grep -q new "$(R "$H")"; ok $? "rotated token written back"
[ "$(nbak "$H")" = 1 ]; ok $? "backup created"
grep -q old "$H"/.kimi-code/credentials/kimi-code.json.bak-*; ok $? "backup holds the old token"
[ "$(stat -c %a "$(R "$H")")" = 600 ]; ok $? "written-back file is 0600"

mkhome b; runner "$H" same
grep -q old "$(R "$H")" && [ "$(nbak "$H")" = 0 ]; ok $? "unchanged => original untouched, no backup"

mkhome c
runner "$H" kill & P=$!
for _ in $(seq 50); do [ -s "$H/pid" ] && break; sleep 0.1; done
kill -TERM "$(cat "$H/pid")"; wait "$P" 2>/dev/null; sleep 1
grep -q new "$(R "$H")" && [ "$(nbak "$H")" = 1 ]; ok $? "killed exam still writes back"
# Standard entry: staging via qualify_stage_credential auto-arms; a fake kimi rotates the staged token; no explicit arm call.
H="$T/d"; mkdir -p "$H/.kimi-code/credentials" "$H/stage/.kimi-code/credentials"
echo '{"refresh_token":"old"}' >"$H/.kimi-code/credentials/kimi-code.json"; touch -d '2 hours ago' "$H/.kimi-code/credentials/kimi-code.json"
printf '#!/bin/sh\necho "{\\"refresh_token\\":\\"new\\"}" >"$HOME/.kimi-code/credentials/kimi-code.json"\n' >"$T/kimi"; chmod +x "$T/kimi"
HOME="$H" bash -c 'source "$0"; qualify_stage_credential "$HOME/stage/.kimi-code/credentials/kimi-code.json" "$HOME/.kimi-code/credentials/kimi-code.json" execute
  HOME="$HOME/stage" "$1"; exit 0' "$LIB" "$T/kimi"
grep -q new "$(R "$H")" && [ "$(nbak "$H")" = 1 ]; ok $? "standard entry (qualify_stage_credential) auto-arms write-back"

# --- review fixes: chaining, signals, subshell, umask, content check, older staged ---
chain() { # $1 home, $2 order: early (caller trap before arm) | late (caller uses qualify_trap_add after arm)
  HOME="$1" QUALIFY_KIMI_REAL_DIR="$1/.kimi-code" bash -c '
    source "$0"
    [ "$1" = early ] && trap "echo early >>\"$HOME/marks\"" EXIT
    qualify_kimi_arm_writeback "$HOME/stage"
    [ "$1" = late ] && qualify_trap_add "echo late >>\"$HOME/marks\"" EXIT
    echo "{\"refresh_token\":\"new\"}" >"$HOME/stage/credentials/kimi-code.json"; exit 7' "$LIB" "$2"
  return $?
}
for ord in early late; do
  mkhome e$ord; chain "$H" $ord; rc=$?
  grep -q new "$(R "$H")" && grep -q $ord "$H/marks" && [ "$rc" = 7 ]; ok $? "caller $ord EXIT trap preserved + write-back + exit status"
done
for sig in INT HUP; do
  mkhome s$sig
  HOME="$H" QUALIFY_KIMI_REAL_DIR="$H/.kimi-code" python3 -c 'import os,signal,sys
for g in (signal.SIGINT,signal.SIGHUP): signal.signal(g,signal.SIG_DFL)
os.execvp("bash",["bash"]+sys.argv[1:])' -c '
    source "$0"; trap "echo mine >>\"$HOME/marks\"" '$sig'; qualify_kimi_arm_writeback "$HOME/stage"
    echo "{\"refresh_token\":\"new\"}" >"$HOME/stage/credentials/kimi-code.json"; echo $$ >"$HOME/pid"; sleep 30 & wait; exit 0' "$LIB" &
  P=$!; for _ in $(seq 50); do [ -s "$H/pid" ] && break; sleep 0.1; done; kill -$sig "$(cat "$H/pid")"; wait $P 2>/dev/null; sleep 1
  grep -q new "$(R "$H")" && grep -q mine "$H/marks"; ok $? "$sig: write-back and caller $sig trap both ran"
done
mkhome sub
w="$(HOME="$H" bash -c 'source "$0"; x=$(qualify_kimi_arm_writeback "$HOME/stage" 2>&1 >/dev/null); echo "$x"' "$LIB")"
echo "$w" | grep -q 'subshell'; ok $? "arm in a subshell warns"
mkhome um   # umask 022 + 0644 staged: final and backup must be 0600
chmod 644 "$H/stage/credentials/kimi-code.json"
( umask 022; HOME="$H" QUALIFY_KIMI_REAL_DIR="$H/.kimi-code" bash -c 'source "$0"; qualify_kimi_arm_writeback "$HOME/stage"; echo "{\"refresh_token\":\"new\"}" >"$HOME/stage/credentials/kimi-code.json"; chmod 644 "$HOME/stage/credentials/kimi-code.json"; exit 0' "$LIB" )
[ "$(stat -c %a "$(R "$H")")" = 600 ] && [ "$(stat -c %a "$H"/.kimi-code/credentials/kimi-code.json.bak-*)" = 600 ]; ok $? "umask 022: final and backup are 0600"
mkhome bad; echo '{"refresh_token":""}' >"$H/stage/credentials/kimi-code.json"
HOME="$H" QUALIFY_KIMI_REAL_DIR="$H/.kimi-code" bash -c 'source "$0"; qualify_kimi_arm_writeback "$HOME/stage"; exit 0' "$LIB" 2>"$H/err"
grep -q old "$(R "$H")" && [ "$(nbak "$H")" = 0 ] && grep -q refresh_token "$H/err"; ok $? "empty refresh_token: not written back, warned"
mkhome old; touch -d '1 hour ago' "$H/stage/credentials/kimi-code.json"; echo '{"refresh_token":"stale"}' >"$H/stage/credentials/kimi-code.json"; touch -d '3 hours ago' "$H/stage/credentials/kimi-code.json"
HOME="$H" QUALIFY_KIMI_REAL_DIR="$H/.kimi-code" bash -c 'source "$0"; qualify_kimi_arm_writeback "$HOME/stage"; exit 0' "$LIB"
grep -q old "$(R "$H")" && [ "$(nbak "$H")" = 0 ]; ok $? "staged older than real: original untouched"
echo "passed=$pass failed=$fail"; [ "$fail" = 0 ]
