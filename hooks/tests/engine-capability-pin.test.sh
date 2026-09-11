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

# ── 5: unpin-seat twice — both exit 0; row gone after first ──
reset_pins
pin_cmd implementer 'owner ruling' >"$OUT" 2>"$ERR"
node "$CLI" unpin-seat --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
ec1=$?
node "$CLI" pins --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
count_after=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(d.length))' "$OUT")
node "$CLI" unpin-seat --role implementer --store "$CAP" >"$OUT" 2>"$ERR"
ec2=$?
if [ "$ec1" = "0" ] && [ "$ec2" = "0" ] && [ "$count_after" = "0" ]; then
  ok "5: unpin-seat twice both exit 0; row gone after first"
else
  bad "5: ec1=$ec1 ec2=$ec2 count_after=$count_after"
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

# ── 8: appendRow absent from the pin code path; withWriteLock+writeSnapshot present ──
pin_section=$(awk '/operator pin store \(pins\.jsonl\)/,/end operator pin store/' "$CLI")
if [ -z "$pin_section" ]; then
  bad "8: pin store section markers missing from engine-capability-state.js"
else
  append_hits=$(printf '%s\n' "$pin_section" | grep -n 'appendRow' || true)
  lock_hits=$(printf '%s\n' "$pin_section" | grep -n 'withWriteLock' || true)
  snap_hits=$(printf '%s\n' "$pin_section" | grep -n 'writeSnapshot' || true)
  if [ -z "$append_hits" ] && [ -n "$lock_hits" ] && [ -n "$snap_hits" ]; then
    ok "8: pin path uses withWriteLock+writeSnapshot; appendRow absent"
  else
    bad "8: append=[$append_hits] lock=[$lock_hits] snap=[$snap_hits]"
  fi
fi

echo "----"
echo "engine-capability-pin harness: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
