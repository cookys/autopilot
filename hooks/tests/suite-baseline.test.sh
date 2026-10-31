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

echo "suite-baseline: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
