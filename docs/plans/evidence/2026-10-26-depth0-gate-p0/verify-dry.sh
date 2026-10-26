#!/usr/bin/env bash
# verify-dry.sh : free check of the probe tooling with the fake claude (never calls any API).
#  1. normal run: all cases run, armed cases block and continue, unarmed do not, summary says produced.
#  2. isolation: every native call saw a mktemp CLAUDE_CONFIG_DIR holding only .credentials.json and never the real ~/.claude; HOME is a mktemp dir.
#  3. negative control: a fake that reports 1.2 USD per call must stop the run after the first call.
#  4. refusal: without PROBE_PAID=1 and without PROBE_CLAUDE_BIN the real claude is not started.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"; echo '{"fake":true}' > "$T/creds.json"; FAKE="$HERE/fake-claude.js"; fail=0
ck() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
OUT="$T/o1" PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f1.log" bash "$HERE/run-all.sh" > "$T/r1.txt" 2>&1
S="$T/o1/summary.json"
ck "8 cases ran" '[ "$(node -e "console.log(Object.keys(require(process.argv[1]).cases).length)" "$S")" = 8 ]'
ck "all produced" '[ "$(node -e "console.log(Object.values(require(process.argv[1]).cases).filter(c=>c.status===\"produced\").length)" "$S")" = 8 ]'
ck "agent id equal (a_armed)" '[ "$(node -e "console.log(require(process.argv[1]).cases.a_armed.agent_id_equal)" "$S")" = true ]'
ck "hetero double wiring seen (cli+user)" '[ "$(node -e "const c=require(process.argv[1]).cases.c_hetero_armed.first_fire_calls_by_wiring;console.log(c[\"Stop/cli\"]===1&&c[\"Stop/user\"]===1)" "$S")" = true ]'
ck "author shape: user wiring not loaded" '[ "$(node -e "const c=require(process.argv[1]).cases.c_author_armed.first_fire_calls_by_wiring;console.log(c[\"Stop/cli\"]===1&&c[\"Stop/user\"]===undefined)" "$S")" = true ]'
ck "unarmed never blocked" '[ "$(node -e "console.log(Object.entries(require(process.argv[1]).cases).filter(([k])=>/unarmed/.test(k)).every(([,v])=>v.blocked===0))" "$S")" = true ]'
ck "every native config dir: only .credentials.json, under tmp, not ~/.claude" \
  'node -e "
const l=require(\"fs\").readFileSync(process.argv[1],\"utf8\").trim().split(\"\n\").map(JSON.parse);
const real=require(\"os\").homedir()+\"/.claude\";
const bad=l.filter(x=>x.config_dir&&(x.config_dir.startsWith(real)||!x.config_dir.startsWith(require(\"os\").tmpdir())||JSON.stringify(x.config_files)!==JSON.stringify([\".credentials.json\"])));
const homeBad=l.filter(x=>x.home===require(\"os\").homedir()||!x.home.startsWith(require(\"os\").tmpdir()));
process.exit(bad.length||homeBad.length||!l.some(x=>x.config_dir)?1:0)" "$T/f1.log"'
# negative control: expensive fake
OUT="$T/o2" PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f2.log" FAKE_COST=1.2 bash "$HERE/run-all.sh" > "$T/r2.txt" 2>&1
ck "negative control: only 1 claude call at 1.2 USD/call" '[ "$(wc -l < "$T/f2.log")" = 1 ]'
ck "negative control: later cases marked not run" '[ "$(node -e "console.log(Object.values(require(process.argv[1]).cases).filter(c=>c.status===\"not run\").length)" "$T/o2/summary.json")" = 7 ]'
ck "negative control: cap_reached true" '[ "$(node -e "console.log(require(process.argv[1]).cap_reached)" "$T/o2/summary.json")" = true ]'
# refusal without PAID / fake
env -u PROBE_PAID -u PROBE_CLAUDE_BIN OUT="$T/o3" PROBE_CREDS_SRC="$T/creds.json" bash "$HERE/probe.sh" b > "$T/r3.txt" 2>&1; rc3=$?
ck "real claude refused without PROBE_PAID=1 (rc=3, nothing written)" '[ "$rc3" = 3 ] && [ ! -d "$T/o3/b" ]'
# strict cap: spent 0.90, cap 1.0 -> next call gets --max-budget-usd 0.1000; spent 1.0 -> no launch
mkdir -p "$T/o4"; echo '{"total":0.9,"runs":{"x":0.9}}' > "$T/o4/spend.json"
OUT="$T/o4" PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f4.log" FAKE_COST=0.05 bash "$HERE/probe.sh" b > /dev/null 2>&1
ck "strict cap: first call after 0.90 spent gets budget 0.1000" 'node -e "const l=require(\"fs\").readFileSync(process.argv[1],\"utf8\").trim().split(\"\n\").map(JSON.parse);const a=l[0].argv;process.exit(a[a.indexOf(\"--max-budget-usd\")+1]===\"0.1000\"?0:1)" "$T/f4.log"'
ck "strict cap: 0.90 + 0.05 -> 0.95 left, second call budget 0.0500" 'node -e "const l=require(\"fs\").readFileSync(process.argv[1],\"utf8\").trim().split(\"\n\").map(JSON.parse);const a=l[1].argv;process.exit(l.length===2&&a[a.indexOf(\"--max-budget-usd\")+1]===\"0.0500\"?0:1)" "$T/f4.log"'
# crash (no result event) is charged the full budget
cat > "$T/crash.sh" <<'CR'
#!/usr/bin/env bash
cat > /dev/null; echo "{}" >> "$FAKE_LOG"; exit 1
CR
chmod +x "$T/crash.sh"
OUT="$T/o5" PROBE_CLAUDE_BIN="$T/crash.sh" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f5.log" PROBE_MAX_USD=0.20 bash "$HERE/probe.sh" b > /dev/null 2>&1
ck "crash without result event is charged its budget (0.15), second call gets 0.05" '[ "$(node -e "const s=require(process.argv[1]);console.log(Object.values(s.runs).map(x=>x.toFixed(2)).join(\",\"))" "$T/o5/spend.json")" = "0.15,0.05" ]'
# red control: with the cap lifted to 100 the same 1.2 USD/call fake is called 8 times (so the 1-call result above is the cap's doing)
OUT="$T/o6" PROBE_MAX_USD=100 PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f6.log" FAKE_COST=1.2 bash "$HERE/run-all.sh" > /dev/null 2>&1
ck "red control: cap 100 -> 8 claude calls" '[ "$(wc -l < "$T/f6.log")" = 8 ]'
# floor, never round up: remaining 0.00006 -> no launch; remaining 0.12345 -> budget 0.1234
mkdir -p "$T/o7" "$T/o8"; echo '{"total":0.99994,"runs":{"x":0.99994}}' > "$T/o7/spend.json"; echo '{"total":0.87655,"runs":{"x":0.87655}}' > "$T/o8/spend.json"
OUT="$T/o7" PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f7.log" bash "$HERE/probe.sh" b > /dev/null 2>&1
ck "floor: remaining 0.00006 does not launch (0 claude calls)" '[ ! -s "$T/f7.log" ]'
OUT="$T/o8" PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f8.log" FAKE_COST=0.001 bash "$HERE/probe.sh" b > /dev/null 2>&1
ck "floor: remaining 0.12345 gives --max-budget-usd 0.1234" 'node -e "const l=require(\"fs\").readFileSync(process.argv[1],\"utf8\").trim().split(\"\n\").map(JSON.parse);const a=l[0].argv;process.exit(a[a.indexOf(\"--max-budget-usd\")+1]===\"0.1234\"?0:1)" "$T/f8.log"'
# red control for floor: toFixed(4) of 0.00006 is 0.0001 (would launch above the remaining cap)
ck "red control: toFixed(4) would have rounded 0.00006 up to 0.0001" '[ "$(node -e "console.log((0.00006).toFixed(4))")" = 0.0001 ]'
ck "analyze regression + red control (test-analyze.js)" 'node "$HERE/test-analyze.js" > "$T/ta.txt" 2>&1 || { cat "$T/ta.txt"; false; }'
echo "scratch: $T"; exit $fail
