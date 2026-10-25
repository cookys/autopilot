#!/usr/bin/env bash
# hooks/tests/claude-call-capture.test.sh -- scripts/lib/claude-call-capture.js (BL-0294): the byte-exact mirror and the record states
# used by the judge. The wrapper-level behaviour (run_eval stand-ins, orphans, boundary probe) is in paid-batch-auth-stop.test.sh.
. "$(dirname "$0")/lib.sh"

JS="$REPO_ROOT/scripts/lib/claude-call-capture.js"
W="$TEST_TMP/w"; mkdir -p "$W"
head -c 6000000 /dev/urandom > "$W/src.bin"
cat > "$W/slow.py" <<'EOS'
import sys, time
out = open(sys.argv[1], "wb")
while True:
    d = sys.stdin.buffer.read1(65536)
    if not d:
        break
    out.write(d)
    time.sleep(0.02)   # slow reader: ~3 MB/s, so the pipe backs up and the mirror has to wait
out.close()
EOS

# 1. 6 MB through a slow reader; the monitored process dies in the middle of the transfer, the writer keeps the pipe open afterwards.
sleep 1 & KEEP=$!
( cat "$W/src.bin"; sleep 4 ) | node "$JS" mirror --pid "$KEEP" --rec "$W/rec1.out" --fd 1 | python3 "$W/slow.py" "$W/recv1.bin"
wait "$KEEP" 2>/dev/null
cmp -s "$W/src.bin" "$W/recv1.bin"; assert_eq "$?" "0" "mirror: the reader received every byte, bit for bit, through a slow reader (6 MB, process death mid-transfer)"
cmp -s "$W/src.bin" "$W/rec1.out"; assert_eq "$?" "0" "mirror: the record file is bit-identical to the input"
assert_file_exists "$W/rec1.out.closed" "mirror: closed marker written after the last byte"

# 2. The reader goes away early (EPIPE): the record is still complete, and the broken output is reported, not hidden.
sleep 30 & KEEP2=$!
cat "$W/src.bin" | node "$JS" mirror --pid "$KEEP2" --rec "$W/rec2.out" --fd 1 | head -c 1000 > "$W/recv2.bin"
kill "$KEEP2" 2>/dev/null; wait "$KEEP2" 2>/dev/null
cmp -s "$W/src.bin" "$W/rec2.out"; assert_eq "$?" "0" "mirror: the record is complete although the reader closed after 1000 bytes"
assert_file_exists "$W/rec2.out.outbroken" "mirror: the broken output is recorded (.outbroken), not pretended away"
assert_file_exists "$W/rec2.out.closed" "mirror: closed marker written after an EPIPE"
assert_eq "$(wc -c < "$W/recv2.bin" | tr -d ' ')" "1000" "mirror: the reader got what it read"

# 3. Record states in the judge. A record is listed by its .pid only.
D="$W/judge"; mkdir -p "$D"
echo "999999 1" > "$D/r1.pid"; printf 'Authentication error\n' > "$D/r1.err"; : > "$D/r1.err.closed"      # dead, stdout never created, stderr closed
T0=$(date +%s)
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: a dead record with no .out file and an authentication stderr is judged (listed by .pid), not ignored"
assert_file_exists "$D/STOP" "judge: STOP written"
assert_not_contains "$(ls "$D")" "STOP.tmp" "judge: no STOP.tmp.<pid> left behind"
rm -rf "$D"; mkdir -p "$D"
echo "999999 1" > "$D/r2.pid"; echo '{"type":"result","subtype":"success","is_error":false,"result":"ok"}' > "$D/r2.out"   # dead, never closed
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "0" "judge: a dead unclosed record with nothing wrong in what exists is not a stop"
assert_file_absent "$D/r2.ok" "judge: an unclosed record is judged as a failed record but never cached as clean"
rm -rf "$D"; mkdir -p "$D"
echo "999999 1" > "$D/r3.pid"; printf 'boom\n' > "$D/r3.out"; echo 'Authentication error' > "$D/r3.err"   # dead, unclosed, phrase in what exists
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: a dead unclosed record counts as FAILED, so an auth phrase in its partial .err stops (not skipped, not clean)"
rm -rf "$D"; mkdir -p "$D"
ME=$$; START="$(node -e 'console.log(require(process.argv[1]).procStat(process.argv[2]).start)' "$JS" "$ME")"
echo "$ME $START" > "$D/r4.pid"; echo '{"type":"result","is_error":true,"result":"boom"}' > "$D/r4.out"; echo 'Authentication error' > "$D/r4.err"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "0" "judge: a record whose process is alive (same starttime) is skipped"
assert_file_absent "$D/r4.ok" "judge: and never cached"
echo "$ME 1" > "$D/r4.pid"                                                                         # same pid, different starttime = pid reuse
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: a reused pid (starttime differs) is a dead record"
rm -rf "$D"; mkdir -p "$D"
echo "999999 1" > "$D/r5.pid"; echo '{"type":"result","subtype":"success","is_error":false,"result":"Invalid API key quoted"}' > "$D/r5.out"; : > "$D/r5.err"; : > "$D/r5.out.closed"; : > "$D/r5.err.closed"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "0" "judge: a closed, successful record quoting a phrase is clean"
assert_file_exists "$D/r5.ok" "judge: and cached"

# 4. incomplete evidence is a failed record and is never cached
mkrec() { # name pidstart: closed record with a successful result prefix and an authentication stderr
  echo "999999 ${2-1}" > "$D/$1.pid"; echo '{"type":"result","subtype":"success","is_error":false,"result":"fine"}' > "$D/$1.out"
  echo 'Authentication error' > "$D/$1.err"; : > "$D/$1.out.closed"; : > "$D/$1.err.closed"; }
rm -rf "$D"; mkdir -p "$D"; mkrec w1; echo EIO > "$D/w1.out.writeerror"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: record write failed (.writeerror) + success result prefix + auth stderr -> stop"
rm -rf "$D"; mkdir -p "$D"; mkrec w2; echo EIO > "$D/w2.err.writeerror"; echo ok > "$D/w2.err"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "0" "judge: incomplete but no phrase in what exists -> no stop"
assert_file_absent "$D/w2.ok" "judge: an incomplete record is never cached as .ok"
rm -rf "$D"; mkdir -p "$D"; mkrec w3 ""
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: unreadable starttime -> failed record rules (auth stderr stops)"
rm -rf "$D"; mkdir -p "$D"; mkrec w4; echo '{"type":"result","subtype":"success","is_error":false,"result":"fine"}' > "$D/w4.out"; : > "$D/w4.err"; echo EPIPE > "$D/w4.out.outbroken"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "0" "judge: .outbroken only (record complete) is judged by content: clean"
assert_file_exists "$D/w4.ok" "judge: and cached"

# 5. unreadable evidence is incomplete evidence (a read error is never "empty text")
rm -rf "$D"; mkdir -p "$D"; mkrec u1; rm -f "$D/u1.out"; mkdir "$D/u1.out"       # a directory posing as the stream file: EISDIR
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: .out unreadable (EISDIR) + auth stderr -> stop"
assert_file_absent "$D/u1.ok" "judge: and no .ok"
rm -rf "$D"; mkdir -p "$D"; mkrec u2; echo '{"type":"result","subtype":"success","is_error":false,"result":"fine"}' > "$D/u2.out"; echo ok > "$D/u2.err"
rm -f "$D/u2.err"; mkdir "$D/u2.err"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "0" "judge: .err unreadable but nothing wrong in what is readable -> no stop"
assert_file_absent "$D/u2.ok" "judge: an unreadable stream is never cached as clean"
rm -rf "$D"; mkdir -p "$D"; mkrec u3; rm -f "$D/u3.pid"; mkdir "$D/u3.pid"
node "$JS" judge --dir "$D" < /dev/null 2>/dev/null; RC=$?
assert_eq "$RC" "6" "judge: .pid unreadable (directory) -> failed record rules, the auth stderr stops"
assert_file_absent "$D/u3.ok" "judge: unreadable .pid -> no .ok"

# 6. one read per source: the judge path reads /proc/<pid>/stat exactly once per record, and an EIO on it is a recorded reason
rm -rf "$D"; mkdir -p "$D"; mkrec p1 "$START"; echo "$ME $START" > "$D/p1.pid"
cat > "$W/probe_reads.js" <<'EOS'
const fs = require('fs'); const real = fs.readFileSync; let n = 0; const mode = process.argv[4];
fs.readFileSync = function (f, ...a) {
  if (String(f).startsWith('/proc/')) { n++; if (mode === 'eio-second' && n > 1) { const e = new Error('EIO'); e.code = 'EIO'; throw e; }
    if (mode === 'eio-first') { const e = new Error('EIO'); e.code = 'EIO'; throw e; } }
  return real.call(this, f, ...a);
};
const snap = require(process.argv[2]).snapshot(process.argv[3]);
console.log(JSON.stringify({ reads: n, state: snap.state, reasons: snap.reasons }));
EOS
R="$(node "$W/probe_reads.js" "$JS" "$D/p1" eio-second)"
assert_contains "$R" '"reads":1' "snapshot: /proc stat is read exactly once per record"
R="$(node "$W/probe_reads.js" "$JS" "$D/p1" eio-first)"
assert_contains "$R" 'proc-unreadable:EIO' "snapshot: an EIO on the /proc read is recorded as a reason"

finalize_test
