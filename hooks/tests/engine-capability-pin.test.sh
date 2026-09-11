#!/usr/bin/env bash
# Independent depth-0 harness for the operator pin store (plan
# 2026-09-11-operator-pin-supersedes-qualification P1 / KR6):
# pin-seat / unpin-seat / pins over pins.jsonl via writeSnapshot.
# Never touch ~/.autopilot — isolated CAP=$(mktemp -d) only.
# Never assert through a pipeline (node … | grep hides a crash).

set -uo pipefail
# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/scripts/engine-capability-state.js"
LIB="$ROOT/scripts/lib/jsonl-store.js"
PASS=0; FAIL=0
CAP="$(mktemp -d)"
OUT="$CAP/out.txt"
ERR="$CAP/err.txt"
trap 'rm -rf "$CAP"' EXIT

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

reset_pins() {
  rm -f "$CAP/pins.jsonl" "$CAP/.lock" "$OUT" "$ERR"
}

pin_cmd() {
  # Usage: pin_cmd <role> <reason> [extra args…]
  local role="$1" reason="$2"
  shift 2
  node "$CLI" pin-seat \
    --engine gemini-3.8-flash-low \
    --runner agy \
    --role "$role" \
    --effort low \
    --endpoint local \
    --reason "$reason" \
    --operator cookys \
    --store "$CAP" \
    "$@"
}

# ── 1: round-trip: pin-seat then pins → exactly one row, expires: null ──
reset_pins
pin_cmd implementer 'owner ruling' >"$OUT" 2>"$ERR"
ec=$?
node "$CLI" pins --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
ec_pins=$?
count=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d.length))' "$OUT")
expires=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(d[0]&&d[0].expires===null?"null":String(d[0]&&d[0].expires))' "$OUT")
keys=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(Object.keys(d[0]||{}).sort().join(","))' "$OUT")
if [ "$ec" = "0" ] && [ "$ec_pins" = "0" ] && [ "$count" = "1" ] && [ "$expires" = "null" ] \
  && [ "$keys" = "effort,endpoint,engine,expires,operator,reason,role,runner" ]; then
  ok "1: round-trip pin-seat → pins returns one eight-key row with expires:null"
else
  bad "1: ec=$ec ec_pins=$ec_pins count=$count expires=$expires keys=$keys out=$(cat "$OUT") err=$(cat "$ERR")"
fi

# ── 2: --expires <date> exits non-zero and stderr names expires ──
reset_pins
pin_cmd implementer 'owner ruling' --expires 2026-12-01 >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" != "0" ] && grep -q 'expires' "$ERR"; then
  ok "2: --expires 2026-12-01 rejected naming expires (ec=$ec)"
else
  bad "2: ec=$ec err=$(cat "$ERR")"
fi

# ── 3: omitting --operator exits non-zero and stderr names operator ──
reset_pins
node "$CLI" pin-seat \
  --engine gemini-3.8-flash-low \
  --runner agy \
  --role implementer \
  --effort low \
  --endpoint local \
  --reason 'owner ruling' \
  --store "$CAP" >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" != "0" ] && grep -q 'operator' "$ERR"; then
  ok "3: omitting --operator rejected naming operator (ec=$ec)"
else
  bad "3: ec=$ec err=$(cat "$ERR")"
fi

# ── 4: replacement — two pin-seat on SAME role → one row, second reason ──
reset_pins
pin_cmd implementer 'first reason' >"$OUT" 2>"$ERR"
pin_cmd implementer 'second reason' >"$OUT" 2>"$ERR"
node "$CLI" pins --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
count=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d.length))' "$OUT")
reason=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d[0]&&d[0].reason))' "$OUT")
if [ "$count" = "1" ] && [ "$reason" = "second reason" ]; then
  ok "4: same-role replacement leaves one row with second reason"
else
  bad "4: count=$count reason=$reason out=$(cat "$OUT")"
fi

# ── 5: unpin-seat twice — idempotent at the STATE level, not just the exit code.
# A second call that recreated or corrupted the store would still pass an
# exit-code-only + row-count-only check, so this seeds a second, unrelated
# role, captures the full file after the first unpin, and requires the second
# unpin to leave the file BYTE-IDENTICAL with the unrelated role's row intact.
reset_pins
pin_cmd implementer 'owner ruling' >"$OUT" 2>"$ERR"
pin_cmd reviewer 'unrelated seat' >"$OUT" 2>"$ERR"
node "$CLI" unpin-seat --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
ec1=$?
snapshot1=$(cat "$CAP/pins.jsonl")
node "$CLI" unpin-seat --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
ec2=$?
snapshot2=$(cat "$CAP/pins.jsonl")
unrelated_present=$(node -e '
  const fs=require("fs");
  const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).filter(l=>l.trim().length>0);
  const rows=lines.map((l)=>JSON.parse(l));
  process.stdout.write(rows.some((r)=>r.role==="reviewer") ? "yes" : "no");
' "$CAP/pins.jsonl")
if [ "$ec1" = "0" ] && [ "$ec2" = "0" ] && [ "$snapshot1" = "$snapshot2" ] && [ "$unrelated_present" = "yes" ]; then
  ok "5: unpin-seat twice is byte-identical at the file level; unrelated role's row survives"
else
  identical=$([ "$snapshot1" = "$snapshot2" ] && echo yes || echo no)
  bad "5: ec1=$ec1 ec2=$ec2 identical=$identical unrelated_present=$unrelated_present"
fi

# ── 6: concurrency — two pin-seat DIFFERENT roles in parallel both land ──
reset_pins
pin_cmd implementer 'impl pin' >"$CAP/p1.out" 2>"$CAP/p1.err" &
pid1=$!
pin_cmd reviewer 'rev pin' >"$CAP/p2.out" 2>"$CAP/p2.err" &
pid2=$!
wait "$pid1"; r1=$?
wait "$pid2"; r2=$?
node "$CLI" pins --store "$CAP" >"$OUT" 2>"$ERR"
parse_ok=$(node -e '
  const fs=require("fs");
  try {
    const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    if (!Array.isArray(d)) { process.stdout.write("not-array"); process.exit(0); }
    const roles=d.map(r=>r.role).sort().join(",");
    process.stdout.write(d.length+"|"+roles);
  } catch (e) { process.stdout.write("parse-fail:"+e.message); }
' "$OUT")
file_parse_ok=$(node -e '
  const fs=require("fs");
  const p=require("path");
  const f=p.join(process.argv[1],"pins.jsonl");
  try {
    const lines=fs.readFileSync(f,"utf8").split(/\r?\n/).filter(l=>l.trim().length>0);
    for (const l of lines) JSON.parse(l);
    process.stdout.write("ok:"+lines.length);
  } catch (e) { process.stdout.write("fail:"+e.message); }
' "$CAP")
if [ "$r1" = "0" ] && [ "$r2" = "0" ] && [ "$parse_ok" = "2|implementer,reviewer" ] && [ "$file_parse_ok" = "ok:2" ]; then
  ok "6: concurrent pin-seat on different roles both land; file parses"
else
  bad "6: r1=$r1 r2=$r2 parse_ok=$parse_ok file=$file_parse_ok p1=$(cat "$CAP/p1.err") p2=$(cat "$CAP/p2.err")"
fi

# ── 7: crash atomicity — kill between temp-write and rename; pre-call rows intact ──
reset_pins
pin_cmd implementer 'pre-crash row' >"$OUT" 2>"$ERR"
cp "$CAP/pins.jsonl" "$CAP/pins.pre.jsonl"
node -e '
  const fs = require("fs");
  const store = require(process.argv[1]);
  const pinsFile = process.argv[2];
  const pre = fs.readFileSync(pinsFile, "utf8");
  fs.renameSync = function () { process.exit(42); };
  try {
    store.writeSnapshot(pinsFile, [{
      engine: "crash-engine",
      runner: "agy",
      role: "reviewer",
      effort: "low",
      endpoint: "local",
      reason: "should-not-land",
      operator: "cookys",
      expires: null,
    }]);
    process.exit(0);
  } catch (e) {
    process.stderr.write(String(e && e.message || e));
    process.exit(1);
  }
' "$LIB" "$CAP/pins.jsonl" >"$OUT" 2>"$ERR"
crash_ec=$?
pre_bytes=$(cat "$CAP/pins.pre.jsonl")
post_bytes=$(cat "$CAP/pins.jsonl")
still_parses=$(node -e '
  const fs=require("fs");
  try {
    const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).filter(l=>l.trim().length>0);
    const rows=lines.map(JSON.parse);
    process.stdout.write(rows.length===1 && rows[0].reason==="pre-crash row" ? "ok" : "bad-shape");
  } catch (e) { process.stdout.write("parse-fail"); }
' "$CAP/pins.jsonl")
if [ "$crash_ec" = "42" ] && [ "$pre_bytes" = "$post_bytes" ] && [ "$still_parses" = "ok" ]; then
  ok "7: crash between temp-write and rename leaves pins.jsonl intact and parseable"
else
  bad "7: crash_ec=$crash_ec still_parses=$still_parses pre_eq_post=$([ "$pre_bytes" = "$post_bytes" ] && echo yes || echo no) err=$(cat "$ERR")"
fi

# ── 8: behavioral proof — pinSeat AND unpinSeat each actually take the write
# lock. A grep over the section's source text passed even when the CODE didn't
# lock, because the section's own COMMENT mentions withWriteLock/writeSnapshot
# (reproduced: removing withWriteLock from unpinSeat left the old grep-based
# test PASSING). Instead: hold $CAP/.lock with a live PID, launch the mutator
# in the background, and assert it is STILL RUNNING a beat later — a mutator
# that skips withWriteLock finishes almost instantly and this fails. Then
# release the lock and confirm the mutator completes and actually applied.
reset_pins
pin_cmd implementer 'seed row' >"$OUT" 2>"$ERR"

# -- pinSeat must block on a live-held lock --
sleep 300 & holder_pid=$!
printf '%s' "$holder_pid" > "$CAP/.lock"
pin_cmd reviewer 'should block on lock' >"$CAP/pin8.out" 2>"$CAP/pin8.err" &
pin_bg_pid=$!
sleep 0.5
if kill -0 "$pin_bg_pid" 2>/dev/null; then pin_still_running=yes; else pin_still_running=no; fi
rm -f "$CAP/.lock"
kill "$holder_pid" 2>/dev/null; wait "$holder_pid" 2>/dev/null
wait "$pin_bg_pid"; pin_ec=$?
pin_landed=$(node -e '
  const fs=require("fs");
  const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).filter(l=>l.trim().length>0);
  const rows=lines.map((l)=>JSON.parse(l));
  process.stdout.write(rows.some((r)=>r.role==="reviewer") ? "yes" : "no");
' "$CAP/pins.jsonl")

# -- unpinSeat must block on a live-held lock --
sleep 300 & holder_pid2=$!
printf '%s' "$holder_pid2" > "$CAP/.lock"
node "$CLI" unpin-seat --role implementer --store "$CAP" >"$CAP/unpin8.out" 2>"$CAP/unpin8.err" &
unpin_bg_pid=$!
sleep 0.5
if kill -0 "$unpin_bg_pid" 2>/dev/null; then unpin_still_running=yes; else unpin_still_running=no; fi
rm -f "$CAP/.lock"
kill "$holder_pid2" 2>/dev/null; wait "$holder_pid2" 2>/dev/null
wait "$unpin_bg_pid"; unpin_ec=$?
unpin_landed=$(node -e '
  const fs=require("fs");
  const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/).filter(l=>l.trim().length>0);
  const rows=lines.map((l)=>JSON.parse(l));
  process.stdout.write(rows.some((r)=>r.role==="implementer") ? "still-there" : "removed");
' "$CAP/pins.jsonl")

if [ "$pin_still_running" = "yes" ] && [ "$pin_ec" = "0" ] && [ "$pin_landed" = "yes" ] \
  && [ "$unpin_still_running" = "yes" ] && [ "$unpin_ec" = "0" ] && [ "$unpin_landed" = "removed" ]; then
  ok "8: pinSeat and unpinSeat each block on a live-held lock (behavioral, not a token grep)"
else
  bad "8: pin_still_running=$pin_still_running pin_ec=$pin_ec pin_landed=$pin_landed unpin_still_running=$unpin_still_running unpin_ec=$unpin_ec unpin_landed=$unpin_landed pin_err=$(cat "$CAP/pin8.err" 2>/dev/null) unpin_err=$(cat "$CAP/unpin8.err" 2>/dev/null)"
fi

# ── 9: unparsable stored row fails LOUD (names the file + 1-based line number)
# instead of being silently discarded. Reproduced: appending garbage then
# pin-seat-ing a different role used to make the garbage line vanish from
# pins.jsonl with nothing reported (readPinRows skipped it; the next
# writeSnapshot persisted only the survivors).
reset_pins
pin_cmd implementer 'valid row' >"$OUT" 2>"$ERR"
printf 'THIS IS NOT JSON {{{\n' >> "$CAP/pins.jsonl"
before_bytes=$(cat "$CAP/pins.jsonl")
line_no=$(wc -l < "$CAP/pins.jsonl" | tr -d ' ')

node "$CLI" pins --store "$CAP" >"$OUT" 2>"$ERR"
pins_ec=$?
pins_names_file=$(grep -qF "$CAP/pins.jsonl" "$ERR" && echo yes || echo no)
pins_names_line=$(grep -q "line $line_no" "$ERR" && echo yes || echo no)
after1=$(cat "$CAP/pins.jsonl")

pin_cmd reviewer 'attempted pin' >"$OUT" 2>"$ERR"
pinseat_ec=$?
pinseat_names_file=$(grep -qF "$CAP/pins.jsonl" "$ERR" && echo yes || echo no)
pinseat_names_line=$(grep -q "line $line_no" "$ERR" && echo yes || echo no)
after2=$(cat "$CAP/pins.jsonl")

node "$CLI" unpin-seat --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
unpinseat_ec=$?
unpinseat_names_file=$(grep -qF "$CAP/pins.jsonl" "$ERR" && echo yes || echo no)
unpinseat_names_line=$(grep -q "line $line_no" "$ERR" && echo yes || echo no)
after3=$(cat "$CAP/pins.jsonl")

if [ "$pins_ec" != "0" ] && [ "$pins_names_file" = "yes" ] && [ "$pins_names_line" = "yes" ] \
  && [ "$pinseat_ec" != "0" ] && [ "$pinseat_names_file" = "yes" ] && [ "$pinseat_names_line" = "yes" ] \
  && [ "$unpinseat_ec" != "0" ] && [ "$unpinseat_names_file" = "yes" ] && [ "$unpinseat_names_line" = "yes" ] \
  && [ "$after1" = "$before_bytes" ] && [ "$after2" = "$before_bytes" ] && [ "$after3" = "$before_bytes" ]; then
  ok "9: unparsable row fails loud on pins/pin-seat/unpin-seat naming file+line; pins.jsonl byte-unchanged"
else
  bad "9: pins_ec=$pins_ec(file=$pins_names_file,line=$pins_names_line) pinseat_ec=$pinseat_ec(file=$pinseat_names_file,line=$pinseat_names_line) unpinseat_ec=$unpinseat_ec(file=$unpinseat_names_file,line=$unpinseat_names_line) err1=$(cat "$ERR")"
fi

echo "----"
echo "engine-capability-pin harness: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
