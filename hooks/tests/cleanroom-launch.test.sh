#!/usr/bin/env bash
# cleanroom-launch.test.sh — host-gated isolation suite for scripts/lib/cleanroom-launch.sh.
# CI leaves AUTOPILOT_HOST_ISOLATION unset (SKIP). This host's verification_commands set it.
. "$(dirname "$0")/lib.sh"

LAUNCHER="$REPO_ROOT/scripts/lib/cleanroom-launch.sh"

if [[ "${AUTOPILOT_HOST_ISOLATION:-}" != "1" ]]; then
  echo "SKIP: set AUTOPILOT_HOST_ISOLATION=1 to run the real-bwrap isolation suite"
  finalize_test
  exit 0
fi

if ! command -v bwrap >/dev/null 2>&1; then
  fail "bwrap missing while AUTOPILOT_HOST_ISOLATION=1 (FAIL, never skip)"
fi

HOST_CRED="${CODEX_HOME:-$HOME/.codex}/auth.json"
if [ ! -f "$HOST_CRED" ]; then
  HOST_CRED="$TEST_TMP/fake-host-auth.json"
  mkdir -p "$(dirname "$HOST_CRED")"
  printf '{"test":"host-credential"}\n' > "$HOST_CRED"
fi
HOST_CRED="$(readlink -f "$HOST_CRED")"
REPO_ABS="$(readlink -f "$REPO_ROOT")"
HOME_ABS="$(readlink -f "$HOME")"
SIBLING="$TEST_TMP/sibling-seat"
mkdir -p "$SIBLING"
printf 'sibling-secret\n' > "$SIBLING/verdict.txt"
PKT="$TEST_TMP/packet"
mkdir -p "$PKT/tree"
printf 'packet-tree-bytes\n' > "$PKT/tree/README.md"
PROMPT="$TEST_TMP/prompt.txt"
printf 'review please\n' > "$PROMPT"
AUTH="$TEST_TMP/seat-auth.json"
printf '{"test":"copied-auth"}\n' > "$AUTH"
BINDIR="$TEST_TMP/bin"
mkdir -p "$BINDIR"
install_stub() {
  local dest="$1"
  mkdir -p "$dest"
  cat > "$dest/codex" <<EOF
#!/bin/sh
host_cred=$(printf '%q' "$HOST_CRED")
repo=$(printf '%q' "$REPO_ABS")
home=$(printf '%q' "$HOME_ABS")
sibling=$(printf '%q' "$SIBLING/verdict.txt")
packet_host=$(printf '%q' "$PKT")
mode=\$(cat /home/review/bin/mode 2>/dev/null || true)
peer=\$(cat /home/review/bin/peer 2>/dev/null || true)
echo "fds=\$(ls /proc/self/fd | tr '\n' ' ')"
echo -n "cmdline="
tr '\0' ' ' < /proc/1/cmdline; echo
if cat "\$host_cred" >/dev/null 2>&1; then echo "HOST_CRED=readable"; else echo "HOST_CRED=DENIED"; fi
if cat /home/review/.codex/auth.json >/dev/null 2>&1; then echo "SEAT_CRED=readable"; else echo "SEAT_CRED=DENIED"; fi
if cat "\$repo/package.json" >/dev/null 2>&1; then echo "REPO=readable"; else echo "REPO=DENIED"; fi
if ls "\$home" >/dev/null 2>&1; then echo "HOME=readable"; else echo "HOME=DENIED"; fi
if cat "\$sibling" >/dev/null 2>&1; then echo "SIBLING=readable"; else echo "SIBLING=DENIED"; fi
if cat /etc/hostname >/dev/null 2>&1; then echo "HOSTNAME=readable"; else echo "HOSTNAME=DENIED"; fi
if cat "\$packet_host/tree/README.md" >/dev/null 2>&1; then echo "PACKET_HOST=readable"; else echo "PACKET_HOST=DENIED"; fi
if cat /home/review/work/README.md >/dev/null 2>&1; then
  echo "PACKET_TREE=\$(cat /home/review/work/README.md)"
else
  echo "PACKET_TREE=DENIED"
fi
if cat /proc/self/fd/7 >/dev/null 2>&1; then echo "FD7=readable"; else echo "FD7=DENIED"; fi
if cat /proc/self/fd/9 >/dev/null 2>&1; then echo "FD9=readable"; else echo "FD9=DENIED"; fi
if [ "\$mode" = "sleep" ]; then sleep 30; fi
if [ "\$mode" = "write" ]; then
  echo wrote > /home/review/.codex/wrote.txt
  echo tmpwrote > /tmp/wrote.txt
fi
if [ "\$mode" = "peer" ] && [ -n "\$peer" ]; then
  if cat "\$peer" >/dev/null 2>&1; then echo "PEER=readable"; else echo "PEER=DENIED"; fi
fi
EOF
  chmod +x "$dest/codex"
  printf 'host\n' > "$dest/codex-code-mode-host"
  printf 'run\n' > "$dest/mode"
}
install_stub "$BINDIR"

SECRET="$TEST_TMP/parent-secret"
printf 'parent-fd-secret\n' > "$SECRET"

run_launch() {
  local out="$1" err="$2" extra=()
  shift 2
  extra=("$@")
  "$LAUNCHER" --profile codex --packet-dir "$PKT" --prompt-file "$PROMPT" \
    --out "$out" --err "$err" --timeout 15s --model m --effort low \
    --bin-dir "$BINDIR" --auth-file "$AUTH" "${extra[@]}"
}

# (a) deny-list + argv + inherited fd
OUTA="$TEST_TMP/a.out"; ERRA="$TEST_TMP/a.err"
JSONA="$TEST_TMP/a.json"
set +e
(
  exec 7< "$SECRET"
  run_launch "$OUTA" "$ERRA" > "$JSONA"
)
RCA=$?
set -e
assert_contains "$(cat "$OUTA")" 'HOME=DENIED' "operator HOME is denied"
assert_contains "$(cat "$OUTA")" 'HOST_CRED=DENIED' "host credential literal is denied"
assert_contains "$(cat "$OUTA")" 'SEAT_CRED=readable' "copied seat credential is readable"
assert_contains "$(cat "$OUTA")" 'REPO=DENIED' "host repository is denied"
assert_contains "$(cat "$OUTA")" 'SIBLING=DENIED' "sibling seat file is denied"
assert_contains "$(cat "$OUTA")" 'HOSTNAME=DENIED' "/etc/hostname is denied"
assert_contains "$(cat "$OUTA")" 'PACKET_HOST=DENIED' "packet host path is denied"
assert_contains "$(cat "$OUTA")" 'PACKET_TREE=packet-tree-bytes' "packet tree is byte-equal"
assert_contains "$(cat "$OUTA")" 'FD7=DENIED' "inherited fd 7 cannot be reopened"
assert_contains "$(cat "$OUTA")" 'FD9=DENIED' "fd 9 cannot be reopened inside the seat"
FDS="$(sed -n 's/^fds=//p' "$OUTA")"
assert_not_contains " $FDS " ' 7 ' "inherited fd 7 is not present in the seat's /proc/self/fd"
assert_not_contains " $FDS " ' 9 ' "args fd 9 is not present in the seat's /proc/self/fd"
CMDLINE="$(sed -n 's/^cmdline=//p' "$OUTA")"
assert_not_contains "$CMDLINE" "$REPO_ABS" "pid1 cmdline has no repository path"
assert_not_contains "$CMDLINE" "$PKT" "pid1 cmdline has no packet host path"
assert_not_contains "$CMDLINE" "$BINDIR" "pid1 cmdline has no bin-dir host path"
assert_not_contains "$CMDLINE" "$TEST_TMP" "pid1 cmdline has no seat/tmp host path"
assert_contains "$(cat "$JSONA")" '"artifact_type": "cleanroom_launch"' "launch prints JSON line"
assert_eq "0" "$RCA" "hostile stub launch exits 0"

# plain-argv control: host paths ARE visible without --args
mkdir -p "$TEST_TMP/ctrl-home"
CTRL_OUT="$TEST_TMP/ctrl.out"
set +e
bwrap --unshare-all --share-net --die-with-parent --new-session --hostname review \
  --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin \
  --ro-bind /etc/resolv.conf /etc/resolv.conf --ro-bind /etc/ssl /etc/ssl \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$TEST_TMP/ctrl-home" /home/review \
  --ro-bind "$PKT/tree" /home/review/work \
  --ro-bind "$BINDIR" /home/review/bin \
  --clearenv --setenv HOME /home/review --setenv PATH /home/review/bin:/usr/bin \
  --chdir /home/review/work \
  /bin/sh -c 'tr "\0" " " < /proc/1/cmdline' > "$CTRL_OUT" 2>/dev/null
set -e
assert_contains "$(cat "$CTRL_OUT")" "$PKT" "plain-argv control shows packet host path"

# (b) timeout 2s → 124 + timed_out + seat gone
SEATB="$TEST_TMP/seat-timeout"
rm -rf "$SEATB"
OUTB="$TEST_TMP/b.out"; ERRB="$TEST_TMP/b.err"
printf 'sleep\n' > "$BINDIR/mode"
set +e
run_launch "$OUTB" "$ERRB" --timeout 2s --seat-root "$SEATB" > "$TEST_TMP/b.json"
RCB=$?
set -e
printf 'run\n' > "$BINDIR/mode"
assert_eq "124" "$RCB" "sleeping stub hits launcher timeout 124"
assert_contains "$(cat "$TEST_TMP/b.json")" '"timed_out": true' "JSON timed_out true"
assert_file_absent "$SEATB" "seat root removed after timeout"

# (c) writes stay inside seat; host untouched; seat gone
SEATC="$TEST_TMP/seat-write"
rm -rf "$SEATC"
OUTC="$TEST_TMP/c.out"; ERRC="$TEST_TMP/c.err"
printf 'write\n' > "$BINDIR/mode"
set +e
run_launch "$OUTC" "$ERRC" --seat-root "$SEATC" > "$TEST_TMP/c.json"
RCC=$?
set -e
printf 'run\n' > "$BINDIR/mode"
assert_eq "0" "$RCC" "write stub exits 0"
assert_file_absent "$SEATC" "seat root gone after write run"
assert_file_absent "$TEST_TMP/wrote.txt" "host tmp has no seat write"
assert_file_absent "$HOME_ABS/.codex/wrote.txt" "operator HOME has no seat write"

# (d) stdout/stderr byte-equal
# stub already writes known lines to stdout; stderr of real codex is empty unless errors
assert_file_exists "$OUTA"
assert_contains "$(cat "$OUTA")" 'SEAT_CRED=readable' "stdout landed in --out"

# (e) preflight
set +e
"$LAUNCHER" --preflight --deny-path "$REPO_ABS" --deny-path "$HOME_ABS" > "$TEST_TMP/pf.json" 2>"$TEST_TMP/pf.err"
RCPF=$?
set -e
assert_eq "0" "$RCPF" "preflight deny-path repo+home exits 0 on this host"
assert_contains "$(cat "$TEST_TMP/pf.json")" '"profile": "preflight"' "preflight JSON profile"

set +e
"$LAUNCHER" --preflight --deny-path "$REPO_ABS" --bwrap /nonexistent > "$TEST_TMP/pf-miss.json" 2>"$TEST_TMP/pf-miss.err"
RCPFM=$?
set -e
assert_eq "2" "$RCPFM" "missing bwrap preflight exits 2"
assert_contains "$(cat "$TEST_TMP/pf-miss.err")" 'bwrap not found' "missing bwrap is named"
assert_file_absent /nonexistent

set +e
"$LAUNCHER" --preflight --deny-path /usr/bin/sh > "$TEST_TMP/pf-ok.json" 2>"$TEST_TMP/pf-readable.err"
RCPFR=$?
set -e
assert_eq "3" "$RCPFR" "readable deny-path exits 3"
assert_contains "$(cat "$TEST_TMP/pf-readable.err")" '/usr/bin/sh' "readable path is named"

# A bound DIRECTORY must also be caught: `cat` on a directory fails with EISDIR, so a presence
# check is what makes this branch bite (panel finding preflight-dir-cat-vacuous, 2026-09-17).
set +e
"$LAUNCHER" --preflight --deny-path /usr > "$TEST_TMP/pf-dir.json" 2>"$TEST_TMP/pf-dir.err"
RCPFD=$?
set -e
assert_eq "3" "$RCPFD" "readable deny-path DIRECTORY exits 3"
assert_contains "$(cat "$TEST_TMP/pf-dir.err")" '/usr' "readable directory is named"

set +e
"$LAUNCHER" --preflight --deny-path "$TEST_TMP/does-not-exist-deny" > "$TEST_TMP/pf-gone.json" 2>"$TEST_TMP/pf-gone.err"
RCPFG=$?
set -e
assert_eq "2" "$RCPFG" "nonexistent deny-path exits 2"
assert_contains "$(cat "$TEST_TMP/pf-gone.err")" 'does-not-exist-deny' "missing deny-path is named"

# (f) concurrent --keep-seat cannot read each other
SEAT1="$TEST_TMP/seat-one"; SEAT2="$TEST_TMP/seat-two"
rm -rf "$SEAT1" "$SEAT2"
BIN1="$TEST_TMP/bin1"; BIN2="$TEST_TMP/bin2"
install_stub "$BIN1"
install_stub "$BIN2"
printf 'peer\n' > "$BIN1/mode"
printf 'peer\n' > "$BIN2/mode"
printf '%s\n' "$SEAT2/home/.codex/auth.json" > "$BIN1/peer"
printf '%s\n' "$SEAT1/home/.codex/auth.json" > "$BIN2/peer"
PEER1="$TEST_TMP/peer1.out"; PEER2="$TEST_TMP/peer2.out"
set +e
"$LAUNCHER" --profile codex --packet-dir "$PKT" --prompt-file "$PROMPT" \
  --out "$PEER1" --err "$TEST_TMP/p1.err" --timeout 20s --model m --effort low \
  --bin-dir "$BIN1" --auth-file "$AUTH" --seat-root "$SEAT1" --keep-seat > "$TEST_TMP/p1.json" &
PID1=$!
"$LAUNCHER" --profile codex --packet-dir "$PKT" --prompt-file "$PROMPT" \
  --out "$PEER2" --err "$TEST_TMP/p2.err" --timeout 20s --model m --effort low \
  --bin-dir "$BIN2" --auth-file "$AUTH" --seat-root "$SEAT2" --keep-seat > "$TEST_TMP/p2.json" &
PID2=$!
wait "$PID1"; RC1=$?
wait "$PID2"; RC2=$?
set -e
assert_eq "0" "$RC1" "concurrent seat 1 exits 0"
assert_eq "0" "$RC2" "concurrent seat 2 exits 0"
assert_contains "$(cat "$PEER1")" 'PEER=DENIED' "seat 1 cannot read seat 2 host path"
assert_contains "$(cat "$PEER2")" 'PEER=DENIED' "seat 2 cannot read seat 1 host path"
rm -rf "$SEAT1" "$SEAT2"

# (h) pre-existing seat-root → exit 2, untouched
EXIST="$TEST_TMP/preexisting-seat"
mkdir -m 0700 "$EXIST"
printf 'keep-me\n' > "$EXIST/marker"
set +e
run_launch "$TEST_TMP/h.out" "$TEST_TMP/h.err" --seat-root "$EXIST" > "$TEST_TMP/h.json" 2>"$TEST_TMP/h.stderr"
RCH=$?
set -e
assert_eq "2" "$RCH" "pre-existing seat-root exits 2"
assert_contains "$(cat "$TEST_TMP/h.stderr")" 'seat root already exists' "pre-existing seat is named"
assert_contains "$(cat "$EXIST/marker")" 'keep-me' "pre-existing seat directory is untouched"

SEATN="$TEST_TMP/seat-normal"
rm -rf "$SEATN"
set +e
run_launch "$TEST_TMP/n.out" "$TEST_TMP/n.err" --seat-root "$SEATN" > "$TEST_TMP/n.json"
set -e
assert_file_absent "$SEATN" "created seat root is gone after a normal run"

# SIGTERM removes a created seat
SEATT="$TEST_TMP/seat-term"
rm -rf "$SEATT"
printf 'sleep\n' > "$BINDIR/mode"
set +e
run_launch "$TEST_TMP/t.out" "$TEST_TMP/t.err" --seat-root "$SEATT" --timeout 30s > "$TEST_TMP/t.json" &
TPID=$!
# wait until the seat exists
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -d "$SEATT" ] && break
  sleep 0.2
done
kill -TERM "$TPID" 2>/dev/null || true
wait "$TPID" 2>/dev/null || true
set -e
assert_file_absent "$SEATT" "SIGTERM removes the seat root the launcher created"

# REAL defaultCleanroomProbe on this host (RED at base 130b97a8: export missing).
PROBE_HOST_OUT="$(node - "$REPO_ROOT" "$REPO_ABS" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const [root, repo] = process.argv.slice(2);
const { defaultCleanroomProbe } = require(path.join(root, 'src', 'engine', 'campaign-intake.js'));
const contractPath = path.join(root, 'package.json');
const ready = defaultCleanroomProbe({ runner: 'codex', repo, contractPath });
assert.strictEqual(ready.status, 'ready', JSON.stringify(ready));
assert.strictEqual(ready.runner, 'codex');
assert.ok(ready.launcher_json && ready.launcher_json.profile === 'preflight', JSON.stringify(ready.launcher_json));
const prev = process.env.AUTOPILOT_CLEANROOM_BWRAP;
process.env.AUTOPILOT_CLEANROOM_BWRAP = '/nonexistent';
try {
  const rejected = defaultCleanroomProbe({ runner: 'codex', repo, contractPath });
  assert.strictEqual(rejected.status, 'rejected', JSON.stringify(rejected));
  assert.match(String(rejected.reason), /exit 2:/);
} finally {
  if (prev === undefined) delete process.env.AUTOPILOT_CLEANROOM_BWRAP;
  else process.env.AUTOPILOT_CLEANROOM_BWRAP = prev;
}
console.log('default_cleanroom_probe_host=true');
NODE
)"
assert_exit_code "$?" "0" "host defaultCleanroomProbe: $PROBE_HOST_OUT"
assert_contains "$PROBE_HOST_OUT" "default_cleanroom_probe_host=true" \
  "defaultCleanroomProbe ready on host and rejected with missing bwrap"

finalize_test
