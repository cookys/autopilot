#!/usr/bin/env bash
# BL-0107: scripts/lib/review-fanout.js bounds concurrent seats (payload max_concurrency or
# AUTOPILOT_REVIEW_MAX_CONCURRENCY); default and non-positive values keep all seats at once.
. "$(dirname "$0")/lib.sh"

exp_eq() { assert_eq "$2" "$1" "$3"; }
FANOUT="$REPO_ROOT/scripts/lib/review-fanout.js"
LOG="$TEST_TMP/overlap.log"
SEAT="$TEST_TMP/seat.sh"
cat > "$SEAT" <<'SH'
#!/usr/bin/env bash
# fake runner: log start/end with ms timestamps, sleep $2 seconds
printf 'S %s %s\n' "$1" "$(date +%s%N)" >> "$LOG_FILE"
sleep "${2:-0.4}"
printf 'E %s %s\n' "$1" "$(date +%s%N)" >> "$LOG_FILE"
echo "seat-$1"
SH
chmod +x "$SEAT"

# max_overlap <log> -> peak number of simultaneously running seats
max_overlap() {
  node -e '
    const ev = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map((l) => l.split(" "));
    ev.sort((a, b) => (BigInt(a[2]) < BigInt(b[2]) ? -1 : BigInt(a[2]) > BigInt(b[2]) ? 1 : 0) || ((a[0] === "E") - (b[0] === "E")) * -1);
    let cur = 0, max = 0;
    for (const e of ev) { cur += e[0] === "S" ? 1 : -1; if (cur > max) max = cur; }
    console.log(max);
  ' "$1"
}

six_jobs() { # $1 = extra top-level json fields (e.g. "max_concurrency":2,)
  node -e '
    const jobs = [0,1,2,3,4,5].map((i) => ({ id: String(i), argv: [process.argv[1], String(i), "0.4"], env: Object.assign({}, process.env, { LOG_FILE: process.argv[2] }) }));
    const extra = process.argv[3] ? JSON.parse("{" + process.argv[3].replace(/,$/, "") + "}") : {};
    process.stdout.write(JSON.stringify(Object.assign({ jobs }, extra)));
  ' "$SEAT" "$LOG" "$1"
}

# 1. limit 2 via payload: 6 seats, never more than 2 at once, all 6 results, input order kept
: > "$LOG"
OUT="$(six_jobs '"max_concurrency":2,' | node "$FANOUT")"
exp_eq "2" "$(max_overlap "$LOG")" "payload limit 2: peak overlap is exactly 2"
exp_eq "6 0,1,2,3,4,5 seat-0,seat-1,seat-2,seat-3,seat-4,seat-5" \
  "$(printf '%s' "$OUT" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.length,r.map(x=>x.id).join(","),r.map(x=>x.stdout.trim()).join(","))')" \
  "payload limit 2: every seat answered, in input order"

# 2. limit via env var
: > "$LOG"
six_jobs '' | AUTOPILOT_REVIEW_MAX_CONCURRENCY=3 node "$FANOUT" > /dev/null
exp_eq "3" "$(max_overlap "$LOG")" "env limit 3: peak overlap is exactly 3"

# 3. NEGATIVE CONTROL: no limit configured -> all 6 at once (>2), proving the cap is what holds the peak
: > "$LOG"
six_jobs '' | env -u AUTOPILOT_REVIEW_MAX_CONCURRENCY node "$FANOUT" > /dev/null

exp_eq "6" "$(max_overlap "$LOG")" "no limit (default): all seats start at once"

# 4. invalid / non-positive limit behaves as unlimited
for bad in 0 -1 abc 1.5; do
  : > "$LOG"
  six_jobs '' | AUTOPILOT_REVIEW_MAX_CONCURRENCY="$bad" node "$FANOUT" > /dev/null
  exp_eq "6" "$(max_overlap "$LOG")" "limit '$bad' is treated as unbounded"
done

# 5. timeout clock starts when the seat actually starts, not while it queues
: > "$LOG"
node -e '
  const env = Object.assign({}, process.env, { LOG_FILE: process.argv[2] });
  const jobs = [
    { id: "a", argv: [process.argv[1], "a", "1.5"], env },
    { id: "b", argv: [process.argv[1], "b", "0.5"], env, timeout_seconds: 1 },
  ];
  process.stdout.write(JSON.stringify({ jobs, max_concurrency: 1 }));
' "$SEAT" "$LOG" | node "$FANOUT" > "$TEST_TMP/q.json"
exp_eq "0 null" "$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const b=r[1];console.log(b.status,b.signal)' "$TEST_TMP/q.json")" \
  "queued seat with 1s timeout (queued 1.5s, runs 0.5s) is not timed out"

finalize_test
