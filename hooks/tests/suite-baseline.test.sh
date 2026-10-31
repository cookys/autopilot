#!/usr/bin/env bash
# suite-baseline.test.sh -- tools/migrate/suite-baseline.js on synthetic results (never runs the real suite).
# SUITE_BASELINE_JS may point at a mutated copy to prove each negative control goes red.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SB="${SUITE_BASELINE_JS:-$REPO_ROOT/tools/migrate/suite-baseline.js}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1"; }
rcis() { local want="$1" label="$2"; shift 2; "$@" >"$T/out" 2>"$T/err" </dev/null; local rc=$?; if [ "$rc" = "$want" ]; then ok; else bad "$label (rc=$rc want=$want)"; sed 's/^/    /' "$T/out" "$T/err" | head -5; fi; }
has() { if grep -q -- "$2" "$T/out"; then ok; else bad "$1 (no '$2' in output)"; fi; }

mkdir -p "$T/root/scripts/tests"
: > "$T/root/scripts/tests/pend-a.test.sh"

# synthetic run: node suite, two sh suites, one failing suite
cat > "$T/run1.txt" <<'X'
✔ a (1ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0

rc=0 hooks/a.test.js
PASS=7 FAIL=0
rc=0 hooks/tests/b.test.sh
Summary: 5 passed, 0 failed
rc=0 hooks/tests/c.test.sh
something printed no count
rc=1 hooks/tests/d.test.sh
X
printf 'PASS [pend-a] 4 assertions\nrc=0 scripts/tests/pend-a.test.sh\n' > "$T/pend.txt"
rcis 0 "record" node "$SB" record --results "$T/run1.txt" --pending-results "$T/pend.txt" --root "$T/root" --out "$T/base.json"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).suites;
const e=(c,m)=>{if(!c){console.log("BAD "+m);process.exit(1)}};
e(s["hooks/a.test.js"].count===10,"node count");
e(s["hooks/tests/b.test.sh"].count===7,"PASS= count");
e(s["hooks/tests/c.test.sh"].count===5,"passed count");
e(s["hooks/tests/d.test.sh"].count===null&&s["hooks/tests/d.test.sh"].count_reason==="no_count_line"&&s["hooks/tests/d.test.sh"].status==="fail","null count + reason");
e(s["scripts/tests/pend-a.test.sh"].pending_join==="P3"&&s["scripts/tests/pend-a.test.sh"].standalone.count===4,"pending_join");
' "$T/base.json" >"$T/out" 2>&1 && ok || { bad "record content"; cat "$T/out"; }

# identical -> consistent
cp "$T/base.json" "$T/same.json"
rcis 0 "identical run is consistent" node "$SB" compare --baseline "$T/base.json" --current "$T/same.json"

# mutate helper: node script edits suites of a copy of base.json
mut() { node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const f=new Function("s",process.argv[3]);f(j.suites);fs.writeFileSync(process.argv[2],JSON.stringify(j))' "$T/base.json" "$1" "$2"; }

# (a) suite removed from current
mut "$T/a.json" 'delete s["hooks/tests/b.test.sh"]'
rcis 1 "(a) removed suite is red" node "$SB" compare --baseline "$T/base.json" --current "$T/a.json"
has "(a) names the suite" "missing: hooks/tests/b.test.sh"

# (b) injected nonexistent suite
mut "$T/b.json" 's["hooks/tests/ghost.test.sh"]={rc:0,status:"pass",count:1}'
rcis 1 "(b) injected suite is red" node "$SB" compare --baseline "$T/base.json" --current "$T/b.json"
has "(b) names the suite" "undeclared new: hooks/tests/ghost.test.sh"

# (c) pass -> fail
mut "$T/c.json" 's["hooks/a.test.js"].rc=1;s["hooks/a.test.js"].status="fail"'
rcis 1 "(c) pass->fail is red" node "$SB" compare --baseline "$T/base.json" --current "$T/c.json"
has "(c) says result changed" "result changed: hooks/a.test.js"
# fail -> pass is also a change
mut "$T/c2.json" 's["hooks/tests/d.test.sh"].rc=0;s["hooks/tests/d.test.sh"].status="pass"'
rcis 1 "(c2) fail->pass is red" node "$SB" compare --baseline "$T/base.json" --current "$T/c2.json"

# (d) count decreased; increased is fine
mut "$T/d.json" 's["hooks/a.test.js"].count=9'
rcis 1 "(d) count decrease is red" node "$SB" compare --baseline "$T/base.json" --current "$T/d.json"
has "(d) says decreased" "count decreased: hooks/a.test.js 10 -> 9"
mut "$T/d2.json" 's["hooks/a.test.js"].count=11'
rcis 0 "(d2) count increase is allowed" node "$SB" compare --baseline "$T/base.json" --current "$T/d2.json"
mut "$T/d3.json" 's["hooks/a.test.js"].count=null'
rcis 1 "(d3) count becoming unparseable is red" node "$SB" compare --baseline "$T/base.json" --current "$T/d3.json"

# (e) rename through layout-map
mut "$T/e.json" 's["tests/b.test.sh"]=s["hooks/tests/b.test.sh"];delete s["hooks/tests/b.test.sh"]'
echo '{"hooks/tests/b.test.sh":"tests/b.test.sh"}' > "$T/map.json"
rcis 0 "(e) rename with layout-map is green" node "$SB" compare --baseline "$T/base.json" --current "$T/e.json" --layout-map "$T/map.json"
rcis 1 "(e) same rename without a map is red" node "$SB" compare --baseline "$T/base.json" --current "$T/e.json"
has "(e) both directions reported" "undeclared new: tests/b.test.sh"
echo '{"hooks/tests/":"t/"}' > "$T/dirmap.json"
mut "$T/e2.json" 'for(const k of Object.keys(s)){if(k.startsWith("hooks/tests/")){s["t/"+k.slice(12)]=s[k];delete s[k]}}'
node "$SB" compare --baseline "$T/base.json" --current "$T/e2.json" --layout-map "$T/dirmap.json" >"$T/out" 2>&1 </dev/null && ok || { bad "(e2) directory-prefix map is green"; cat "$T/out"; }

# (f) undeclared new red, declared green; declared-but-absent red
mut "$T/f.json" 's["hooks/tests/new.test.sh"]={rc:0,status:"pass",count:3}'
rcis 1 "(f) undeclared new is red" node "$SB" compare --baseline "$T/base.json" --current "$T/f.json"
echo '["hooks/tests/new.test.sh"]' > "$T/decl.json"
rcis 0 "(f) declared new is green" node "$SB" compare --baseline "$T/base.json" --current "$T/f.json" --declared-new "$T/decl.json"
rcis 1 "(f) declared but absent is red" node "$SB" compare --baseline "$T/base.json" --current "$T/same.json" --declared-new "$T/decl.json"

# pending_join: absent is fine (done above in identity? present in both); absent in current:
mut "$T/p1.json" 'delete s["scripts/tests/pend-a.test.sh"]'
rcis 0 "(p) pending_join suite may be absent" node "$SB" compare --baseline "$T/base.json" --current "$T/p1.json"
mut "$T/p2.json" 's["scripts/tests/pend-a.test.sh"].rc=1;s["scripts/tests/pend-a.test.sh"].status="fail"'
rcis 1 "(p) pending_join suite once present must keep its standalone result" node "$SB" compare --baseline "$T/base.json" --current "$T/p2.json"

# exit 2 on bad input
rcis 2 "missing baseline file" node "$SB" compare --baseline "$T/nope.json" --current "$T/same.json"
echo 'not json' > "$T/junk.json"
rcis 2 "junk current file" node "$SB" compare --baseline "$T/base.json" --current "$T/junk.json"
rcis 2 "junk layout map" node "$SB" compare --baseline "$T/base.json" --current "$T/same.json" --layout-map "$T/junk.json"
echo 'no rc lines here' > "$T/norc.txt"
rcis 2 "record without rc lines" node "$SB" record --results "$T/norc.txt" --out "$T/x.json" --root "$T/root"
rcis 2 "unknown subcommand" node "$SB" frobnicate

# JSON record input (affected-suites --record shape): counts null with reason
echo '{"schema":1,"suites":[{"path":"hooks/a.test.js","rc":0,"seconds":1}]}' > "$T/rec.json"
rcis 0 "record from JSON record" node "$SB" record --results "$T/rec.json" --out "$T/r2.json" --root "$T/root"
grep -q json_record_has_no_output "$T/r2.json" && ok || bad "json record count reason"

# list: real tree, no execution; must equal affected-suites --list-all plus mods runners
node "$SB" list --root "$REPO_ROOT" > "$T/list.txt" 2>/dev/null </dev/null
node "$REPO_ROOT/scripts/affected-suites.js" --list-all > "$T/all.txt" 2>/dev/null </dev/null
mods=$(find "$REPO_ROOT/mods" -maxdepth 2 -name run-tests.sh | wc -l)
if [ "$(wc -l < "$T/list.txt")" = "$(( $(wc -l < "$T/all.txt") + mods ))" ]; then ok; else bad "list count != affected-suites --list-all + mods"; fi
grep -q '^scripts/tests/' "$T/list.txt" && bad "list must not include scripts/tests" || ok

# ---- run-all --jobs (BL-0353): fixture suites only, never the real tree ----
FX="$T/fx"; mkdir -p "$FX/hooks/tests/lib" "$FX/stamps"
printf '# serial list\nhooks/tests/s1.test.sh\nhooks/tests/s2.test.sh\n' > "$FX/hooks/tests/lib/serial-suites.txt"
mk() { printf '%s\n' "$2" > "$FX/hooks/tests/$1"; }
stamp='echo "$1 $EPOCHREALTIME"'
for n in p1 p2 p3 p4; do
  mk "$n.test.sh" "echo ${n}-start >&1; echo \"\$EPOCHREALTIME\" > \"\$FXSTAMPS/$n.start\"; for i in 1 2 3; do echo ${n}-line-\$i; sleep 0.2; done; echo ${n}-err >&2; echo \"\$EPOCHREALTIME\" > \"\$FXSTAMPS/$n.end\"; echo 'Summary: 3 passed, 0 failed'"
done
for n in s1 s2; do
  mk "$n.test.sh" "echo \"\$EPOCHREALTIME\" > \"\$FXSTAMPS/$n.start\"; sleep 0.6; echo \"\$EPOCHREALTIME\" > \"\$FXSTAMPS/$n.end\"; echo 'Summary: 2 passed, 0 failed'"
done
# red in the pool the first time (a flag file marks the first run), green alone
mk flaky.test.sh 'if [ -e "$FXSTAMPS/flaky.flag" ]; then echo "Summary: 4 passed, 0 failed"; else : > "$FXSTAMPS/flaky.flag"; echo "Summary: 3 passed, 1 failed"; exit 1; fi'
mk redboth.test.sh 'echo "Summary: 1 passed, 1 failed"; exit 1'
mk tmpdir.test.sh 'case "$TMPDIR" in /tmp/sbj.*) echo "Summary: 1 passed, 0 failed" ;; *) echo "TMPDIR=$TMPDIR"; exit 1 ;; esac'
export FXSTAMPS="$FX/stamps"
printf '%s\n' hooks/tests/p1.test.sh hooks/tests/p2.test.sh hooks/tests/s1.test.sh hooks/tests/p3.test.sh hooks/tests/s2.test.sh hooks/tests/p4.test.sh > "$T/ids-ovl.txt"

# --jobs 1 (and no --jobs) are byte-identical to the one-at-a-time format
node "$SB" run-all --root "$FX" --ids "$T/ids-ovl.txt" > "$T/j0.out" 2>/dev/null </dev/null
node "$SB" run-all --root "$FX" --ids "$T/ids-ovl.txt" --jobs 1 > "$T/j1.out" 2>/dev/null </dev/null
{ for n in p1 p2; do printf '%s-start\n%s-line-1\n%s-line-2\n%s-line-3\nSummary: 3 passed, 0 failed\n%s-err\n\nrc=0 hooks/tests/%s.test.sh\n' $n $n $n $n $n $n; done; } > "$T/j-exp-head.txt"
head -c 20 "$T/j1.out" | grep -q '^p1-start' && ok || bad "--jobs 1 starts with the first suite's own output"
cmp -s "$T/j0.out" "$T/j1.out" && ok || bad "--jobs 1 output differs from no --jobs"
printf 'p1-start\np1-line-1\np1-line-2\np1-line-3\nSummary: 3 passed, 0 failed\np1-err\n\nrc=0 hooks/tests/p1.test.sh\n' > "$T/p1-exp.txt"
head -n 8 "$T/j1.out" | cmp -s - "$T/p1-exp.txt" && ok || bad "--jobs 1 first block is stdout, stderr, blank line, rc line (old format)"
[ "$(grep -c '^rc=0 ' "$T/j1.out")" = 6 ] && ok || bad "--jobs 1 prints six rc lines"

# overlap check: python-free, node reads the stamp files
overlap() { node -e '
const fs=require("fs");const d=process.argv[1];const g=(n,k)=>Number(fs.readFileSync(d+"/"+n+"."+k,"utf8"));
let bad=0;
for(const s of ["s1","s2"]){for(const o of ["p1","p2","p3","p4","s1","s2"]){if(o===s)continue;
  if(g(s,"start")<g(o,"end")&&g(o,"start")<g(s,"end")){console.log("OVERLAP "+s+" "+o);bad=1}}}
process.exit(bad)' "$FX/stamps"; }
overlapped_pool() { node -e '
const fs=require("fs");const d=process.argv[1];const g=(n,k)=>Number(fs.readFileSync(d+"/"+n+"."+k,"utf8"));
process.exit(g("p1","start")<g("p2","end")&&g("p2","start")<g("p1","end")?0:1)' "$FX/stamps"; }

rm -f "$FX/stamps"/*
node "$SB" run-all --root "$FX" --ids "$T/ids-ovl.txt" --jobs 4 > "$T/jp.out" 2>"$T/jp.err" </dev/null
overlap > "$T/ov.txt" && ok || { bad "serial-listed suites overlapped another suite (--jobs 4)"; cat "$T/ov.txt"; }
overlapped_pool && ok || bad "pool suites p1/p2 did not run concurrently (--jobs 4 is not parallel)"
[ "$(grep -c '^rc=0 ' "$T/jp.out")" = 6 ] && ok || bad "--jobs 4 prints six rc lines"
grep -q '6 run (4 pooled, 2 serial)' "$T/jp.err" && ok || bad "--jobs 4 stderr tally"

# no interleaving: each suite's lines are one contiguous block ending in its own rc line
node -e '
const L=require("fs").readFileSync(process.argv[1],"utf8").split("\n");
let cur=null,bad=0;
for(const l of L){const m=/^(p\d)-/.exec(l);const r=/^rc=\d+ hooks\/tests\/(\w+)\.test\.sh/.exec(l);
  if(m){if(cur&&cur!==m[1])bad=1;cur=m[1]}
  if(r){if(cur&&cur!==r[1])bad=1;cur=null}}
process.exit(bad)' "$T/jp.out" && ok || bad "outputs of different suites interleaved"
for n in p1 p2 p3 p4; do grep -c "^$n-line-" "$T/jp.out" | grep -q '^3$' && ok || bad "$n lost lines in --jobs 4 output"; done

# NEGATIVE CONTROL: with the exclusivity removed (serial-listed suites join the pool) the overlap check goes red
sed 's/const serial = serialSuites(root);/const serial = new Set();/' "$SB" > "$T/mut-sb.js"
if cmp -s "$SB" "$T/mut-sb.js"; then bad "negative control mutation did not hit (anchor drifted)"; else
  rm -f "$FX/stamps"/*
  node "$T/mut-sb.js" run-all --root "$FX" --ids "$T/ids-ovl.txt" --jobs 6 > /dev/null 2>&1 </dev/null
  if overlap >/dev/null; then bad "negative control: overlap check stayed green with exclusivity removed"; else ok; fi
fi

# flaky / red-in-both reruns, TMPDIR isolation
printf '%s\n' hooks/tests/p1.test.sh hooks/tests/flaky.test.sh hooks/tests/redboth.test.sh hooks/tests/tmpdir.test.sh hooks/tests/s1.test.sh > "$T/ids-fl.txt"
rm -f "$FX/stamps"/*
node "$SB" run-all --root "$FX" --ids "$T/ids-fl.txt" --jobs 3 > "$T/fl.out" 2>"$T/fl.err" </dev/null
grep -q '^flaky-under-parallel: hooks/tests/flaky.test.sh (rc=1 in pool)$' "$T/fl.out" && ok || bad "flaky marker line missing"
grep -q '^rc=0 hooks/tests/flaky.test.sh$' "$T/fl.out" && ok || bad "flaky suite should end rc=0 after the rerun"
grep -q '^red-in-both-runs: hooks/tests/redboth.test.sh (rc=1 in pool, rc=1 alone)$' "$T/fl.out" && ok || bad "red-in-both marker line missing"
grep -q '^rc=1 hooks/tests/redboth.test.sh$' "$T/fl.out" && ok || bad "red-in-both suite should end rc=1"
grep -q '^rc=0 hooks/tests/tmpdir.test.sh$' "$T/fl.out" && ok || bad "pool suite did not get its own /tmp/sbj.* TMPDIR"

# record reads the markers: default conservative (fail), --flaky-as-green passes it; both-red stays fail
mkdir -p "$T/root0"
rcis 0 "record of a parallel run" node "$SB" record --results "$T/fl.out" --root "$T/root0" --out "$T/fl.json"
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).suites;
const f=s["hooks/tests/flaky.test.sh"],b=s["hooks/tests/redboth.test.sh"];
const ok=f.flaky_under_parallel===true&&f.pool_rc===1&&f.rc===0&&f.status==="fail"&&f.count===4&&b.red_in_both_runs===true&&b.status==="fail"&&!s["hooks/tests/p1.test.sh"].flaky_under_parallel;
process.exit(ok?0:1)' "$T/fl.json" && ok || bad "record default: flaky stored as fail with flaky_under_parallel/pool_rc"
grep -q 'red in the pool, green alone (stored as fail): hooks/tests/flaky.test.sh' "$T/fl.err" || true
rcis 0 "record --flaky-as-green" node "$SB" record --results "$T/fl.out" --root "$T/root0" --out "$T/fl2.json" --flaky-as-green
node -e '
const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).suites;
process.exit(s["hooks/tests/flaky.test.sh"].status==="pass"&&s["hooks/tests/flaky.test.sh"].flaky_under_parallel===true&&s["hooks/tests/redboth.test.sh"].status==="fail"?0:1)' "$T/fl2.json" && ok || bad "record --flaky-as-green: flaky pass (still marked), both-red still fail"
node "$SB" record --results "$T/fl.out" --root "$T/root0" --out "$T/fl3.json" 2>&1 >/dev/null </dev/null | grep -q 'hooks/tests/flaky.test.sh' && ok || bad "record lists flaky suites on stderr"
rcis 2 "--jobs 0 is bad input" node "$SB" run-all --root "$FX" --ids "$T/ids-fl.txt" --jobs 0


echo "suite-baseline: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
