#!/usr/bin/env bash
# verify-dry.sh : free check of the probe tooling with the fake claude (never calls any API).
#  1. normal run: all cases run, armed cases block and continue, unarmed do not, summary says produced.
#  2. isolation: every native call saw a mktemp CLAUDE_CONFIG_DIR holding only .credentials.json (plus the
#     settings.json the probe itself writes for probe a) and never the real ~/.claude; HOME is a mktemp dir.
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
ck "every native config dir: only credentials (+settings.json for a), under tmp, not ~/.claude" \
  'node -e "
const l=require(\"fs\").readFileSync(process.argv[1],\"utf8\").trim().split(\"\n\").map(JSON.parse);
const real=require(\"os\").homedir()+\"/.claude\";
const bad=l.filter(x=>x.config_dir&&(x.config_dir.startsWith(real)||!x.config_dir.startsWith(require(\"os\").tmpdir())||x.config_files.some(f=>![\".credentials.json\",\"settings.json\"].includes(f))));
const homeBad=l.filter(x=>x.home===require(\"os\").homedir()||!x.home.startsWith(require(\"os\").tmpdir()));
process.exit(bad.length||homeBad.length||!l.some(x=>x.config_dir)?1:0)" "$T/f1.log"'
# negative control: expensive fake
OUT="$T/o2" PROBE_CLAUDE_BIN="$FAKE" PROBE_CREDS_SRC="$T/creds.json" FAKE_LOG="$T/f2.log" FAKE_COST=1.2 bash "$HERE/run-all.sh" > "$T/r2.txt" 2>&1
ck "negative control: only 1 claude call at 1.2 USD/call" '[ "$(wc -l < "$T/f2.log")" = 1 ]'
ck "negative control: later cases marked not run" '[ "$(node -e "console.log(Object.values(require(process.argv[1]).cases).filter(c=>c.status===\"not run\").length)" "$T/o2/summary.json")" = 7 ]'
ck "negative control: cap_reached true" '[ "$(node -e "console.log(require(process.argv[1]).cap_reached)" "$T/o2/summary.json")" = true ]'
# refusal without PAID / fake
OUT="$T/o3" PROBE_CREDS_SRC="$T/creds.json" bash "$HERE/probe.sh" b > "$T/r3.txt" 2>&1; rc3=$?
ck "real claude refused without PROBE_PAID=1 (rc=3, nothing written)" '[ "$rc3" = 3 ] && [ ! -d "$T/o3/b" ]'
echo "scratch: $T"; exit $fail
