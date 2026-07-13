#!/usr/bin/env bash
# Independent depth-0 adversarial harness for scripts/engine-scorecard.js
# (NOT the implementer's self-test — that one was discarded as broken/false-green.
#  Written fresh by the dispatching session per the delegate-self-test rule.)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/scripts/engine-scorecard.js"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
export ENGINE_SCORECARD_DIR="$TESTDIR"
trap 'rm -rf "$TESTDIR"' EXIT

ok()   { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
reset(){ rm -f "$TESTDIR/scorecard.jsonl" "$TESTDIR/.lock"; }
arrlen(){ node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).length))"; }
jq_get(){ node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of '$1'.split('.'))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(String(v))"; }

row() { # engine runner family role corpus cap costsrc costin status expires [model_version]
  local engine="$1" runner="$2" family="$3" role="$4" corpus="$5" cap="$6" csrc="$7" cin="$8" status="$9" expires="${10}" mv="${11:-v1}"
  cat <<JSON
{"engine":"$engine","runner":"$runner","family":"$family","role":"$role","model_version":"$mv","version_source":"manual","corpus_version":"$corpus","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":$cap,"cost":{"source":"$csrc","usd_per_mtok_input":$cin,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"$status","qualified_at":"2026-06-30","expires":"$expires"}
JSON
}

# 1: monotonic event_id, caller value ignored
reset
echo "$(row e r f reviewer c@1 0.5 manual 0 qualified 2099-01-01)" | sed 's/^{/{"event_id":999,/' | node "$CLI" record >/tmp/o1 2>/dev/null
id1=$(jq_get event_id </tmp/o1)
echo "$(row e2 r f reviewer c@1 0.5 manual 0 qualified 2099-01-01)" | node "$CLI" record >/tmp/o2 2>/dev/null
id2=$(jq_get event_id </tmp/o2)
[ "$id1" = "1" ] && [ "$id2" = "2" ] && ok "1: monotonic event_id, caller 999 ignored" || bad "1: got '$id1','$id2' want 1,2"

# 2: same identity, failed supersedes earlier qualified
reset
echo "$(row A r f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row A r f reviewer c@1 0.9 manual 0 failed   2099-01-01)" | node "$CLI" record >/dev/null 2>&1
cnt=$(node "$CLI" current --role reviewer --now 2026-06-30 | arrlen)
st=$(node "$CLI" current --role reviewer --now 2026-06-30 | jq_get 0.status)
[ "$cnt" = "1" ] && [ "$st" = "failed" ] && ok "2: latest-wins, failed supersedes qualified" || bad "2: cnt=$cnt st=$st want 1,failed"

# 3: differ only in model_version => SAME identity
reset
echo "$(row A r f reviewer c@1 0.9 manual 0 qualified 2099-01-01 modelOLD)" | node "$CLI" record >/dev/null 2>&1
echo "$(row A r f reviewer c@1 0.9 manual 0 qualified 2099-01-01 modelNEW)" | node "$CLI" record >/dev/null 2>&1
cnt=$(node "$CLI" current --role reviewer --now 2026-06-30 | arrlen)
mv=$(node "$CLI" current --role reviewer --now 2026-06-30 | jq_get 0.model_version)
[ "$cnt" = "1" ] && [ "$mv" = "modelNEW" ] && ok "3: model_version not in identity" || bad "3: cnt=$cnt mv=$mv want 1,modelNEW"

# 4: differ in runner => DIFFERENT identities
reset
echo "$(row A r1 f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row A r2 f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
cnt=$(node "$CLI" current --role reviewer --now 2026-06-30 | arrlen)
[ "$cnt" = "2" ] && ok "4: differing runner => 2 identities" || bad "4: cnt=$cnt want 2"

# 5: TTL expiry derived at read time, no store mutation
reset
echo "$(row A r f reviewer c@1 0.9 manual 0 qualified 2026-01-01)" | node "$CLI" record >/dev/null 2>&1
st=$(node "$CLI" current --role reviewer --now 2026-06-30 | jq_get 0.status)
stored=$(grep -o '"status":"[a-z]*"' "$TESTDIR/scorecard.jsonl" | head -1)
[ "$st" = "expired" ] && [ "$stored" = '"status":"qualified"' ] && ok "5: past-expires => expired at read, store unmutated" || bad "5: derived=$st stored=$stored"

# 6: report --key cost: unknown-cost sorts LAST even at price 0
reset
echo "$(row CHEAP r f reviewer c@1 0.5 manual 1 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row UNK   r f reviewer c@1 0.5 unknown 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
first=$(node "$CLI" report --role reviewer --key cost | jq_get 0.engine)
last=$(node "$CLI" report --role reviewer --key cost | jq_get 1.engine)
[ "$first" = "CHEAP" ] && [ "$last" = "UNK" ] && ok "6: unknown-cost sorts last despite price 0" || bad "6: first=$first last=$last"

# 6b: report --key cost: a non-unknown (manual) row with MISSING price is unmeasured => sorts last, not "free"
reset
echo "$(row PRICED r f reviewer c@1 0.5 manual 2 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
# manual row with price fields stripped out (source=manual but no usd_per_mtok_*):
printf '{"engine":"NOPRICE","runner":"r","family":"f","role":"reviewer","model_version":"v","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"1/1","false_pass_critical":0,"specificity":"ok"},"capability_score":0.5,"cost":{"source":"manual"},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}\n' | node "$CLI" record >/dev/null 2>&1
first=$(node "$CLI" report --role reviewer --key cost | jq_get 0.engine)
last=$(node "$CLI" report --role reviewer --key cost | jq_get 1.engine)
[ "$first" = "PRICED" ] && [ "$last" = "NOPRICE" ] && ok "6b: unpriced manual row sorts last, not free" || bad "6b: first=$first last=$last (want PRICED,NOPRICE)"

# 7: report --key capability DESC
reset
echo "$(row LO r f reviewer c@1 0.3 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row HI r f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
top=$(node "$CLI" report --role reviewer | jq_get 0.engine)
[ "$top" = "HI" ] && ok "7: capability DESC" || bad "7: top=$top want HI"

# 8: ladder demotes same family to bottom but keeps it
reset
echo "$(row X r openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row Y r google reviewer c@1 0.8 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
botfam=$(node "$CLI" ladder --role reviewer --implementer-family openai | jq_get 1.family)
len=$(node "$CLI" ladder --role reviewer --implementer-family openai | arrlen)
[ "$botfam" = "openai" ] && [ "$len" = "2" ] && ok "8: same-family demoted to bottom, still present" || bad "8: bottomfam=$botfam len=$len"

# 8b: governed evidence roles are recordable/queryable, but not fallback-ladder routable yet
reset
echo "$(row VER r f verifier verifier-corpus@1 0.7 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row ORCH r f orchestrator orchestrator-corpus@1 0.6 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
verrole=$(node "$CLI" current --role verifier --now 2026-06-30 | jq_get 0.role)
orchrole=$(node "$CLI" report --role orchestrator | jq_get 0.role)
node "$CLI" ladder --role orchestrator >/dev/null 2>&1; ladder_ec=$?
[ "$verrole" = "verifier" ] && [ "$orchrole" = "orchestrator" ] && [ "$ladder_ec" = "2" ] && ok "8b: verifier/orchestrator rows are evidence-queryable but ladder-blocked" || bad "8b: verifier=$verrole orchestrator=$orchrole ladder_exit=$ladder_ec"

# 9: invalid record (bad enum) => exit 1, store unchanged
reset
echo "$(row A r f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
before=$(wc -l < "$TESTDIR/scorecard.jsonl")
echo "$(row A r f BOGUSROLE c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1; ec=$?
after=$(wc -l < "$TESTDIR/scorecard.jsonl")
[ "$ec" = "1" ] && [ "$before" = "$after" ] && ok "9: bad enum => exit 1, store unchanged" || bad "9: exit=$ec before=$before after=$after"

# 10: concurrent record (5-way) => all 5 lines, none corrupt
reset
for i in 1 2 3 4 5; do
  ( echo "$(row "eng$i" r f reviewer c@1 0.5 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1 ) &
done
wait
lines=$(wc -l < "$TESTDIR/scorecard.jsonl" 2>/dev/null | tr -d ' ')
valid=$(node -e "const fs=require('fs');let n=0,b=0;for(const l of fs.readFileSync('$TESTDIR/scorecard.jsonl','utf8').split('\n'))if(l.trim()){try{JSON.parse(l);n++}catch{b++}}process.stdout.write(n+'/'+b)")
[ "$lines" = "5" ] && [ "$valid" = "5/0" ] && ok "10: 5 concurrent records, all valid, none interleaved" || bad "10: lines=$lines valid(ok/bad)=$valid"

# 11: --help exit 0, unknown subcommand exit 2
node "$CLI" --help >/dev/null 2>&1; h=$?
node "$CLI" bogus >/dev/null 2>&1; u=$?
[ "$h" = "0" ] && [ "$u" = "2" ] && ok "11: --help=0, unknown-subcommand=2" || bad "11: help=$h unknown=$u"

# 12 (robustness, A1): a stale lock from a crashed writer must not permanently wedge writes
reset
echo "$(row A r f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
: > "$TESTDIR/.lock"   # simulate crashed writer that never released the lock
t0=$(date +%s)
echo "$(row B r f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | timeout 20 node "$CLI" record >/dev/null 2>&1; ec=$?
t1=$(date +%s)
if [ "$ec" = "0" ]; then ok "12: stale lock broken/recovered (record ok in $((t1-t0))s)"; else bad "12: stale lock wedged record (exit=$ec after $((t1-t0))s) — A1"; fi

# 13 (v2.32.25 R1): distinct efforts are distinct invocation-tuple identities —
# two rows for the same engine+runner at different codex efforts must BOTH
# survive into current/ladder, not collapse to the latest event.
reset
r1="$(row tupeng codex openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)"
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.effort='high';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.effort='xhigh';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
effs=$(node "$CLI" ladder --role reviewer 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const l=JSON.parse(d).filter(r=>r.engine==='tupeng').map(r=>r.effort).sort();process.stdout.write(l.join(','))})")
[ "$effs" = "high,xhigh" ] && ok "13: distinct efforts coexist as distinct tuples (got: $effs)" || bad "13: efforts collapsed (got: $effs) — R1"

echo "----"
echo "engine-scorecard harness: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
