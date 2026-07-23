#!/usr/bin/env bash
# Independent depth-0 adversarial harness for scripts/lib/jsonl-store.js — the shared
# JSONL-store concurrency primitives (flock + PID-stale-breaker + atomic-append +
# monotonic event_id) extracted from engine-scorecard / engine-capability-state /
# adjudicate-findings. Authored by the dispatching session, NOT the implementer, per
# the delegate-self-test rule. Proves: concurrent-writer exclusion, stale-PID lock
# break, atomic append under contention, monotonic event_id, and that a LIVE lock is
# respected (never over-stolen) with the named timeout message.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIB="$ROOT/scripts/lib/jsonl-store.js"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"' EXIT

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

STORE="$TESTDIR/store.jsonl"
LOCK="$TESTDIR/.lock"

# A real writer PROCESS: append N rows, each event_id = maxEventId(existing)+1, under the
# write lock. The read-max-then-append is the exact critical section the stores run; the
# lock is what makes it atomic across processes.
writer() { # <n>
  node -e '
    const s = require(process.argv[1]);
    const fs = require("fs");
    const [ , , storeDir, lockFile, storeFile, nRaw ] = process.argv;
    const n = Number(nRaw);
    for (let k = 0; k < n; k++) {
      s.withWriteLock({ storeDir, lockFile, name: "test" }, () => {
        let rows = [];
        try {
          rows = fs.readFileSync(storeFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
        } catch {}
        const id = s.maxEventId(rows) + 1;
        // Widen the read→append window so a MISSING lock deterministically races two
        // writers into a duplicate id (lost update). Under a real lock this is just
        // serialized and slower — the ids stay a contiguous 1..N sequence.
        s.sleepMs(2);
        s.appendRow(storeFile, { event_id: id, pid: process.pid, k });
      });
    }
  ' "$LIB" "$TESTDIR" "$LOCK" "$STORE" "$1"
}

count_valid() { # -> "<okCount>/<badCount>"
  node -e 'const fs=require("fs");let ok=0,bad=0;for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean)){try{JSON.parse(l);ok++}catch{bad++}}process.stdout.write(ok+"/"+bad)' "$STORE"
}

# ── 1: concurrent-writer exclusion + atomic append + monotonic event_id ──
# Two real processes each append 25 rows concurrently. If the lock excludes and the
# append is atomic, the file has exactly 50 well-formed JSON lines (no torn/interleaved
# writes) and the event_ids are exactly the contiguous sequence 1..50 (strictly
# monotonic, no duplicate, no gap) — a lost update or a non-atomic read-modify-write
# would produce a duplicate id or a gap.
rm -f "$STORE" "$LOCK"
writer 25 & p1=$!
writer 25 & p2=$!
wait "$p1"; r1=$?
wait "$p2"; r2=$?
lines=$(grep -c '' "$STORE" 2>/dev/null || echo 0)
valid=$(count_valid)
seq=$(node -e '
  const fs=require("fs");
  const ids=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l).event_id).sort((a,b)=>a-b);
  const expect=Array.from({length:ids.length},(_,i)=>i+1);
  process.stdout.write(JSON.stringify(ids)===JSON.stringify(expect)?"seq-ok":"seq-bad["+ids.join(",")+"]");
' "$STORE")
if [ "$r1" = "0" ] && [ "$r2" = "0" ] && [ "$lines" = "50" ] && [ "$valid" = "50/0" ] && [ "$seq" = "seq-ok" ]; then
  ok "1: 2 procs × 25 concurrent appends → 50 valid rows, event_id 1..50 monotonic (exit $r1/$r2)"
else
  bad "1: exits=$r1/$r2 lines=$lines valid=$valid seq=$seq"
fi

# ── 2a: stale-PID lock break — EMPTY lockfile (crashed mid-write) ──
# An empty/garbage lock content is a dead holder; a fresh writer must break it, not wedge.
rm -f "$STORE"; : > "$LOCK"
if timeout 20 bash -c "$(declare -f writer count_valid); LIB='$LIB' TESTDIR='$TESTDIR' LOCK='$LOCK' STORE='$STORE'; writer 1" >/dev/null 2>&1; then
  lines=$(grep -c '' "$STORE" 2>/dev/null || echo 0)
  [ "$lines" = "1" ] && ok "2a: empty stale lock broken, append recorded" || bad "2a: recovered but rows=$lines"
else
  bad "2a: empty stale lock wedged the writer (timeout/err)"
fi

# ── 2b: stale-PID lock break — DEAD numeric pid ──
# $(bash -c 'echo $$') yields the pid of a bash that has already exited → guaranteed dead.
rm -f "$STORE" "$LOCK"
deadpid="$(bash -c 'echo $$')"
printf '%s' "$deadpid" > "$LOCK"
if timeout 20 bash -c "$(declare -f writer count_valid); LIB='$LIB' TESTDIR='$TESTDIR' LOCK='$LOCK' STORE='$STORE'; writer 1" >/dev/null 2>&1; then
  lines=$(grep -c '' "$STORE" 2>/dev/null || echo 0)
  [ "$lines" = "1" ] && ok "2b: dead-pid ($deadpid) stale lock broken, append recorded" || bad "2b: recovered but rows=$lines"
else
  bad "2b: dead-pid stale lock wedged the writer (timeout/err)"
fi

# ── 3: a LIVE lock is respected (never over-stolen) + named timeout message ──
# Same process holds the lock (content = our own live pid); a second acquire with a tiny
# timeout must NOT steal it — it must back off and throw the timeout error carrying the
# store name. Proves the stale-breaker doesn't cannibalize a live holder.
rm -f "$STORE" "$LOCK"
result=$(node -e '
  const s = require(process.argv[1]);
  const [ , , storeDir, lockFile ] = process.argv;
  s.acquireLock({ storeDir, lockFile, name: "test" });
  let msg = "no-throw";
  try {
    s.acquireLock({ storeDir, lockFile, name: "test", timeoutMs: 300 });
  } catch (e) { msg = e.message; }
  s.releaseLock(lockFile);
  process.stdout.write(msg);
' "$LIB" "$TESTDIR" "$LOCK")
if [ "$result" = "timed out waiting for test lock (held by a live process)" ]; then
  ok "3: live lock respected; timeout error carries store name"
else
  bad "3: expected named-timeout throw, got: [$result]"
fi

echo "----"
echo "jsonl-store harness: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
