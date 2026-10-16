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
  echo '{"refresh":"old"}' >"$H/.kimi-code/credentials/kimi-code.json"; chmod 644 "$H/.kimi-code/credentials/kimi-code.json"
  cp "$H/.kimi-code/credentials/kimi-code.json" "$H/stage/credentials/kimi-code.json"
  touch -d '2 hours ago' "$H/.kimi-code/credentials/kimi-code.json"
}
runner() { # $1 home, $2 mode: rotate|same|kill
  HOME="$1" QUALIFY_KIMI_REAL_DIR="$1/.kimi-code" bash -c '
    source "$0"; qualify_kimi_arm_writeback "$HOME/stage"
    if [ "$1" != same ]; then echo "{\"refresh\":\"new\"}" >"$HOME/stage/credentials/kimi-code.json"; fi
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
echo "passed=$pass failed=$fail"; [ "$fail" = 0 ]
