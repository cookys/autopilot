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

# 6: disk-only report cannot surface a qualified candidate, regardless of cost.
reset
echo "$(row CHEAP r f reviewer c@1 0.5 manual 1 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row UNK   r f reviewer c@1 0.5 unknown 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
len=$(node "$CLI" report --role reviewer --key cost | arrlen)
[ "$len" = "0" ] && ok "6: cost report cannot route disk telemetry" || bad "6: report len=$len want 0"

# 6b: missing prices cannot make a disk row routable.
reset
echo "$(row PRICED r f reviewer c@1 0.5 manual 2 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
# manual row with price fields stripped out (source=manual but no usd_per_mtok_*):
printf '{"engine":"NOPRICE","runner":"r","family":"f","role":"reviewer","model_version":"v","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"1/1","false_pass_critical":0,"specificity":"ok"},"capability_score":0.5,"cost":{"source":"manual"},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}\n' | node "$CLI" record >/dev/null 2>&1
len=$(node "$CLI" report --role reviewer --key cost | arrlen)
[ "$len" = "0" ] && ok "6b: unpriced disk telemetry cannot rank as free" || bad "6b: report len=$len want 0"

# 7: capability report cannot turn stored scores into admission.
reset
echo "$(row LO r f reviewer c@1 0.3 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row HI r f reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
len=$(node "$CLI" report --role reviewer | arrlen)
[ "$len" = "0" ] && ok "7: capability report cannot route disk telemetry" || bad "7: report len=$len want 0"

# 8: fallback ladder cannot be restored from same-UID disk rows.
reset
echo "$(row X r openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row Y r google reviewer c@1 0.8 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
len=$(node "$CLI" ladder --role reviewer --implementer-family openai | arrlen)
[ "$len" = "0" ] && ok "8: disk-only fallback ladder is empty" || bad "8: ladder len=$len want 0"

# 8b: legacy role aliases canonicalize at the CLI boundary; evidence-only roles stay off ladders.
reset
echo "$(row VER r f verifier verifier-corpus@1 0.7 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row ORCH r f orchestrator orchestrator-corpus@1 0.6 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row VA r f verification_author verification-corpus@1 0.6 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
echo "$(row EXP r f explorer explorer-corpus@1 0.6 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
verrole=$(node "$CLI" current --role verifier --now 2026-06-30 | jq_get 0.role)
orchrole=$(node "$CLI" current --role orchestrator | jq_get 0.role)
verstatus=$(node "$CLI" current --role verifier --now 2026-06-30 | jq_get 0.status)
varole=$(node "$CLI" current --role verification_author | jq_get 0.role)
exprole=$(node "$CLI" current --role explorer | jq_get 0.role)
node "$CLI" ladder --role owner >/dev/null 2>&1; owner_ladder_ec=$?
node "$CLI" ladder --role explorer >/dev/null 2>&1; explorer_ladder_ec=$?
[ "$verrole" = "reviewer" ] && [ "$orchrole" = "owner" ] \
  && [ "$verstatus" = "provisional" ] && [ "$varole" = "verification_author" ] \
  && [ "$exprole" = "explorer" ] && [ "$owner_ladder_ec" = "0" ] \
  && [ "$explorer_ladder_ec" = "2" ] \
  && ok "8b: role aliases canonicalize and evidence-only roles remain ladder-blocked" \
  || bad "8b: verifier=$verrole owner=$orchrole verification_author=$varole explorer=$exprole owner_ladder=$owner_ladder_ec explorer_ladder=$explorer_ladder_ec"

# 8c: pre-canonicalization disk rows migrate at read time.
reset
echo "$(row LEGACY r f owner legacy-corpus@1 0.6 manual 0 qualified 2099-01-01)" | node "$CLI" record >/dev/null 2>&1
node - "$TESTDIR/scorecard.jsonl" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const row = JSON.parse(fs.readFileSync(file, 'utf8').trim());
row.role = 'planner';
fs.writeFileSync(file, `${JSON.stringify(row)}\n`);
NODE
legacyrole=$(node "$CLI" current --role owner --now 2026-06-30 | jq_get 0.role)
legacycount=$(node "$CLI" current --role planner --now 2026-06-30 | arrlen)
[ "$legacyrole" = "owner" ] && [ "$legacycount" = "1" ] \
  && ok "8c: legacy disk roles migrate at read time" \
  || bad "8c: owner role=$legacyrole planner query count=$legacycount"

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
# survive into current telemetry, not collapse to the latest event.
reset
r1="$(row tupeng codex openai reviewer c@1 0.9 manual 0 qualified 2099-01-01)"
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.effort='high';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.effort='xhigh';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
effs=$(node "$CLI" current --role reviewer 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const l=JSON.parse(d).filter(r=>r.engine==='tupeng').map(r=>r.effort).sort();process.stdout.write(l.join(','))})")
[ "$effs" = "high,xhigh" ] && ok "13: distinct efforts coexist as telemetry tuples (got: $effs)" || bad "13: efforts collapsed (got: $effs) — R1"

# 14 (v2.32.25 R4): model is an alias REFINEMENT — re-recording the same
# engine+runner+effort with model added must SUPERSEDE the model-less row in
# the current telemetry view.
reset
r1="$(row aliaseng claude-native anthropic reviewer c@1 0.9 manual 0 qualified 2099-01-01)"
echo "$r1" | node "$CLI" record >/dev/null 2>&1
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.model='haiku';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
al=$(node "$CLI" current --role reviewer 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const l=JSON.parse(d).filter(r=>r.engine==='aliaseng');process.stdout.write(l.length+':'+l.map(r=>r.model).join(','))})")
[ "$al" = "1:haiku" ] && ok "14: model refinement supersedes the model-less telemetry row (got: $al)" || bad "14: stale model-less row survives (got: $al) — R4"

# 15 (v2.32.25 R5): a LATER failed re-qualification retires the rung — the
# older qualified model-less row must NOT survive the supersede.
reset
r1="$(row retireng claude-native anthropic reviewer c@1 0.9 manual 0 qualified 2099-01-01)"
echo "$r1" | node "$CLI" record >/dev/null 2>&1
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.model='haiku';r.status='failed';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
rl=$(node "$CLI" ladder --role reviewer 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(String(JSON.parse(d).filter(r=>r.engine==='retireng').length))})")
current_status=$(node "$CLI" current --role reviewer 2>/dev/null | jq_get 0.status)
[ "$rl" = "0" ] && [ "$current_status" = "failed" ] && ok "15: later failed re-qual retires the telemetry tuple and no rung exists" || bad "15: ladder=$rl current=$current_status — R5"

# 16 (v2.32.25 R7): supersede preserves configured identity — rows from a
# DIFFERENT corpus (distinct qualification setup) must not retire each other.
reset
r1="$(row corpeng claude-native anthropic reviewer c@1 0.9 manual 0 qualified 2099-01-01)"
echo "$r1" | node "$CLI" record >/dev/null 2>&1
echo "$(node -e "const r=JSON.parse(process.argv[1]);r.corpus_version='c@2';r.status='failed';console.log(JSON.stringify(r))" "$r1")" | node "$CLI" record >/dev/null 2>&1
cl=$(node "$CLI" current --role reviewer 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(String(JSON.parse(d).filter(r=>r.engine==='corpeng').length))})")
ladder_len=$(node "$CLI" ladder --role reviewer 2>/dev/null | arrlen)
[ "$cl" = "2" ] && [ "$ladder_len" = "0" ] && ok "16: cross-corpus telemetry rows remain distinct without creating a rung" || bad "16: current=$cl ladder=$ladder_len — R7"

echo "----"
echo "engine-scorecard harness: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
