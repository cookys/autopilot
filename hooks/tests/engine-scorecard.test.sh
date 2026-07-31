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

# 17 (A4+A1): transcript import is explicit-root, aggregate-only, deterministic,
# cohort-honest, and cannot mint a scorecard/routing row.
IMPORT_ROOT="$TESTDIR/transcripts"
IMPORT_OUT="$TESTDIR/imported-telemetry.json"
mkdir -p "$IMPORT_ROOT/codex" "$IMPORT_ROOT/grok" \
  "$IMPORT_ROOT/opencode/general" "$IMPORT_ROOT/opencode/swe-calibrate" "$IMPORT_ROOT/agy"
cat > "$IMPORT_ROOT/codex/session.jsonl" <<'JSONL'
{"type":"session_meta","payload":{"id":"secret-session-id","model":"gpt-5.6-sol","cwd":"/private/user/path"}}
{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"RAW_SECRET_SENTINEL"}]}}
{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120}}}}
{"type":"turn.completed","status":"completed"}
JSONL
cat > "$IMPORT_ROOT/grok/session.json" <<'JSON'
{"model":"grok-4.5","status":"completed","response_text":"RAW_SECRET_SENTINEL","usage":{"prompt_tokens":50,"completion_tokens":10,"total_tokens":60,"cost_usd":0.02},"session_id":"grok-secret"}
JSON
cat > "$IMPORT_ROOT/opencode/general/session.json" <<'JSON'
{"modelID":"glm-5.2","status":"completed","messages":[{"role":"assistant","content":"RAW_SECRET_SENTINEL"}],"usage":{"inputTokens":30,"outputTokens":5}}
JSON
cat > "$IMPORT_ROOT/opencode/swe-calibrate/session.json" <<'JSON'
{"modelID":"glm-5.2","status":"completed","messages":[{"role":"assistant","content":"calibration-only"}],"usage":{"inputTokens":9999,"outputTokens":999}}
JSON
cat > "$IMPORT_ROOT/agy/session.json" <<'JSON'
{"model":"Gemini 3.6 Flash (High)","status":"failed","output_text":"","finish_reason":"length","usage":{"input_tokens":777,"output_tokens":88,"cost_usd":99},"tool":{"status":"failed"},"credential":"RAW_SECRET_SENTINEL"}
JSON
printf '%s\n' '{malformed' > "$IMPORT_ROOT/codex/malformed.jsonl"

node "$CLI" import-transcripts \
  --root "codex=$IMPORT_ROOT/codex" \
  --root "grok=$IMPORT_ROOT/grok" \
  --root "opencode=$IMPORT_ROOT/opencode" \
  --root "agy=$IMPORT_ROOT/agy" \
  --output "$IMPORT_OUT" > "$TESTDIR/import.stdout"
cp "$IMPORT_OUT" "$TESTDIR/import.first"
node "$CLI" import-transcripts \
  --root "agy=$IMPORT_ROOT/agy" \
  --root "opencode=$IMPORT_ROOT/opencode" \
  --root "grok=$IMPORT_ROOT/grok" \
  --root "codex=$IMPORT_ROOT/codex" \
  --output "$IMPORT_OUT" > "$TESTDIR/import.second"

import_check=$(node - "$IMPORT_OUT" "$TESTDIR/import.first" "$TESTDIR/import.second" <<'NODE'
const fs = require('fs');
const [outFile, firstFile, secondFile] = process.argv.slice(2);
const raw = fs.readFileSync(outFile, 'utf8');
const report = JSON.parse(raw);
const oc = report.aggregates.filter((row) => row.provider === 'opencode');
const agy = report.aggregates.find((row) => row.provider === 'agy');
const codexSource = report.sources.find((row) => row.provider === 'codex');
const stable = raw === fs.readFileSync(firstFile, 'utf8')
  && raw === fs.readFileSync(secondFile, 'utf8');
const safe = !/RAW_SECRET_SENTINEL|secret-session-id|private\/user|grok-secret|credential/i.test(raw);
const cohorts = oc.length === 2
  && oc.some((row) => row.cohort === 'general' && row.tokens.input_tokens_total === 30)
  && oc.some((row) => row.cohort === 'swe-calibrate' && row.tokens.input_tokens_total === 9999);
const agyHonest = agy && agy.tokens.availability === 'unavailable'
  && agy.cost.availability === 'unavailable' && agy.truncation_rate === 1;
const coverage = codexSource && codexSource.candidate_files === 2
  && codexSource.parsed_sessions === 1 && codexSource.schema_coverage_rate === 0.5;
const authority = report.authority_status === 'untrusted_telemetry'
  && report.admissible === false && report.imported_scorecard_rows === 0
  && !raw.includes('"status": "qualified"');
process.stdout.write([stable, safe, cohorts, agyHonest, coverage, authority].join(':'));
NODE
)
import_ladder=$(node "$CLI" ladder --role reviewer | arrlen)
no_root_ec=$(node "$CLI" import-transcripts >/dev/null 2>&1; echo $?)
[ "$import_check" = "true:true:true:true:true:true" ] && [ "$import_ladder" = "0" ] \
  && [ "$no_root_ec" = "2" ] \
  && ok "17: transcript import is aggregate-only, deterministic, honest, and non-authoritative" \
  || bad "17: import check=$import_check ladder=$import_ladder no-root=$no_root_ec"

# 18: output containment is a physical-path boundary. An ancestor symlink on the
# transcript root must not make an output inside that root look external. Reject
# identically whether the output leaf is missing or already exists, and never
# create/replace it before the rejection.
REAL_PARENT="$TESTDIR/real-parent"
ALIAS_PARENT="$TESTDIR/alias-parent"
ALIAS_ROOT="$ALIAS_PARENT/transcripts"
ALIAS_OUTPUT="$REAL_PARENT/transcripts/aggregate.json"
mkdir -p "$REAL_PARENT/transcripts"
ln -s "$REAL_PARENT" "$ALIAS_PARENT"
cp "$ROOT/plugin.json" "$REAL_PARENT/transcripts/session.json"

node "$CLI" import-transcripts --root "codex=$ALIAS_ROOT" \
  --output "$ALIAS_OUTPUT" > /dev/null 2>"$TESTDIR/alias-missing.err"
alias_missing_ec=$?
alias_missing_err="$(cat "$TESTDIR/alias-missing.err")"
alias_missing_created=false
[ -e "$ALIAS_OUTPUT" ] && alias_missing_created=true

printf '%s\n' '{"sentinel":"preserve-existing-output"}' > "$ALIAS_OUTPUT"
alias_existing_before="$(cat "$ALIAS_OUTPUT")"
node "$CLI" import-transcripts --root "codex=$ALIAS_ROOT" \
  --output "$ALIAS_OUTPUT" > /dev/null 2>"$TESTDIR/alias-existing.err"
alias_existing_ec=$?
alias_existing_err="$(cat "$TESTDIR/alias-existing.err")"
alias_existing_after="$(cat "$ALIAS_OUTPUT")"

[ "$alias_missing_ec" = "2" ] \
  && [ "$alias_existing_ec" = "2" ] \
  && [ "$alias_missing_created" = "false" ] \
  && [ "$alias_existing_after" = "$alias_existing_before" ] \
  && [ "$alias_missing_err" = "$alias_existing_err" ] \
  && printf '%s' "$alias_missing_err" | grep -q -- '--output must be outside transcript roots' \
  && ok "18: realpath containment rejects ancestor-alias output deterministically" \
  || bad "18: missing=$alias_missing_ec/$alias_missing_created existing=$alias_existing_ec preserved=$([ "$alias_existing_after" = "$alias_existing_before" ] && echo true || echo false) err-stable=$([ "$alias_missing_err" = "$alias_existing_err" ] && echo true || echo false)"

# 19: transcript model fields are untrusted output. Known credential/token shapes
# must collapse to "unknown", while ordinary model identifiers retain exact spelling.
# Construct planted controls in pieces so repository secret scanners do not mistake
# these inert test values for live credentials.
SECRET_MODEL_ROOT="$TESTDIR/secret-model-transcripts"
mkdir -p "$SECRET_MODEL_ROOT/codex" "$SECRET_MODEL_ROOT/grok" \
  "$SECRET_MODEL_ROOT/opencode" "$SECRET_MODEL_ROOT/agy"
node - "$SECRET_MODEL_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const planted = {
  aws: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  openai: ['sk-', 'abcdefghijklmnopqrstuvwxyz123456'].join(''),
  github: ['ghp_', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'].join(''),
};
const sess = 'sess_9f8e7d6c';
const session = 'session-01HZX3Y9K8M7N6P5Q4R3S2T1V0';
const uuid = '123e4567-e89b-12d3-a456-426614174000';
const rejected = {
  codex: [
    sess, session, uuid, `gpt-${session}`, `gpt-${uuid}`,
    'Customer roadmap', 'gpt-5.6-customer-roadmap', 'gpt-9.9-future',
  ],
  grok: [
    ...Object.values(planted), sess, session, uuid,
    `grok-${session}`, `grok-${uuid}`, 'Customer roadmap',
    'grok-4.5-customer-roadmap', 'grok-9.9',
  ],
  opencode: [
    sess, session, uuid, `glm-${session}`, `glm-${uuid}`,
    'Customer roadmap', 'glm-5.2-customer-roadmap', 'glm-9.9',
  ],
  agy: ['Customer roadmap', 'Gemini 9.9 Flash (High)'],
};
const accepted = {
  codex: ['gpt-5.6-sol', 'o3-mini'],
  grok: ['grok-4.5', 'grok-composer-2.5-fast'],
  opencode: ['glm-5.2', 'MiniMax-M3'],
  agy: ['Gemini 3.6 Flash (High)', 'Gemini 3.6 Pro (Medium)'],
};
const writeCodex = (name, model) => {
  const rows = [
    { type: 'session_meta', payload: { model } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'ok' } },
    { type: 'turn.completed' },
  ];
  fs.writeFileSync(
    path.join(root, 'codex', `${name}.jsonl`),
    `${rows.map(JSON.stringify).join('\n')}\n`,
  );
};
const writeRoot = (provider, name, model) => {
  const row = provider === 'opencode'
    ? { modelID: model, status: 'completed', messages: [{ role: 'assistant', content: 'ok' }] }
    : provider === 'agy'
      ? { model, status: 'completed', output_text: 'ok' }
      : { model, status: 'completed', response_text: 'ok' };
  fs.writeFileSync(path.join(root, provider, `${name}.json`), JSON.stringify(row));
};
for (const [provider, models] of Object.entries(rejected)) {
  models.forEach((model, index) => {
    if (provider === 'codex') writeCodex(`rejected-${index}`, model);
    else writeRoot(provider, `rejected-${index}`, model);
  });
}
for (const [provider, models] of Object.entries(accepted)) {
  models.forEach((model, index) => {
    if (provider === 'codex') writeCodex(`accepted-${index}`, model);
    else writeRoot(provider, `accepted-${index}`, model);
  });
}
NODE
node "$CLI" import-transcripts \
  --root "codex=$SECRET_MODEL_ROOT/codex" \
  --root "grok=$SECRET_MODEL_ROOT/grok" \
  --root "opencode=$SECRET_MODEL_ROOT/opencode" \
  --root "agy=$SECRET_MODEL_ROOT/agy" \
  > "$TESTDIR/secret-model-import.json"
secret_model_check="$(node - "$TESTDIR/secret-model-import.json" <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const report = JSON.parse(raw);
const find = (provider, engine) => report.aggregates.find((row) => (
  row.provider === provider && row.engine === engine
));
const planted = [
  ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  ['sk-', 'abcdefghijklmnopqrstuvwxyz123456'].join(''),
  ['ghp_', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'].join(''),
];
const sess = 'sess_9f8e7d6c';
const session = 'session-01HZX3Y9K8M7N6P5Q4R3S2T1V0';
const uuid = '123e4567-e89b-12d3-a456-426614174000';
const rejectedValues = [
  ...planted, sess, session, uuid,
  `gpt-${session}`, `gpt-${uuid}`, `grok-${session}`, `grok-${uuid}`,
  `glm-${session}`, `glm-${uuid}`, 'Customer roadmap',
  'gpt-5.6-customer-roadmap', 'gpt-9.9-future',
  'grok-4.5-customer-roadmap', 'grok-9.9',
  'glm-5.2-customer-roadmap', 'glm-9.9', 'Gemini 9.9 Flash (High)',
];
const rejected = find('codex', 'unknown')?.sample_size === 8
  && find('grok', 'unknown')?.sample_size === 11
  && find('opencode', 'unknown')?.sample_size === 8
  && find('agy', 'unknown')?.sample_size === 2
  && rejectedValues.every((value) => !raw.includes(value));
const ordinaryPreserved = [
  ['codex', 'gpt-5.6-sol'],
  ['codex', 'o3-mini'],
  ['grok', 'grok-4.5'],
  ['grok', 'grok-composer-2.5-fast'],
  ['opencode', 'glm-5.2'],
  ['opencode', 'MiniMax-M3'],
  ['agy', 'Gemini 3.6 Flash (High)'],
  ['agy', 'Gemini 3.6 Pro (Medium)'],
].every(([provider, engine]) => find(provider, engine)?.sample_size === 1);
process.stdout.write([rejected, ordinaryPreserved].join(':'));
NODE
)"
[ "$secret_model_check" = "true:true" ] \
  && ok "19: provider model contracts reject secrets/prose and preserve legitimate identifiers" \
  || bad "19: secret model sanitization check=$secret_model_check"

# 20: provider message/output bodies are opaque. Metadata-shaped objects nested
# inside content must not influence engine, completion, tool failure, truncation,
# tokens, or cost, and their raw fragments must never reach aggregate output.
OPAQUE_ROOT="$TESTDIR/opaque-content-transcripts"
mkdir -p "$OPAQUE_ROOT/codex" "$OPAQUE_ROOT/grok" "$OPAQUE_ROOT/opencode" "$OPAQUE_ROOT/agy"
node - "$OPAQUE_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const poison = {
  type: 'turn.failed',
  text: 'OPAQUE_NESTED_FRAGMENT',
  model: 'Customer roadmap',
  status: 'failed',
  usage: { input_tokens: 999999, output_tokens: 999999, cost_usd: 999999 },
  finish_reason: 'length',
  tool: { status: 'failed' },
};
const codex = [
  { type: 'session_meta', payload: { id: 'opaque-session' } },
  {
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [poison] },
  },
  { type: 'turn.completed', status: 'completed' },
];
fs.writeFileSync(
  path.join(root, 'codex', 'session.jsonl'),
  `${codex.map(JSON.stringify).join('\n')}\n`,
);
fs.writeFileSync(path.join(root, 'grok', 'session.json'), JSON.stringify({
  model: 'grok-4.5',
  status: 'completed',
  response_text: poison,
  usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
  cost_usd: 0.02,
}));
fs.writeFileSync(path.join(root, 'opencode', 'session.json'), JSON.stringify({
  modelID: 'glm-5.2',
  status: 'completed',
  messages: [{ role: 'assistant', content: poison }],
  usage: { inputTokens: 30, outputTokens: 5 },
}));
fs.writeFileSync(path.join(root, 'agy', 'session.json'), JSON.stringify({
  model: 'Gemini 3.6 Flash (High)',
  status: 'completed',
  output_text: poison,
}));
NODE
node "$CLI" import-transcripts \
  --root "codex=$OPAQUE_ROOT/codex" \
  --root "grok=$OPAQUE_ROOT/grok" \
  --root "opencode=$OPAQUE_ROOT/opencode" \
  --root "agy=$OPAQUE_ROOT/agy" \
  > "$TESTDIR/opaque-content-import.json"
opaque_content_check="$(node - "$TESTDIR/opaque-content-import.json" <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const report = JSON.parse(raw);
const byProvider = new Map(report.aggregates.map((row) => [row.provider, row]));
const codex = byProvider.get('codex');
const grok = byProvider.get('grok');
const opencode = byProvider.get('opencode');
const agy = byProvider.get('agy');
const cleanRates = (row) => row && row.completion_rate === 1
  && row.zero_output_rate === 0 && row.tool_failure_rate === 0 && row.truncation_rate === 0;
const safe = codex && codex.engine === 'unknown' && cleanRates(codex)
  && codex.tokens.availability === 'unavailable'
  && grok && grok.engine === 'grok-4.5' && cleanRates(grok)
  && grok.tokens.input_tokens_total === 50 && grok.tokens.output_tokens_total === 10
  && grok.tokens.total_tokens === 60 && grok.cost.usd_total === 0.02
  && opencode && opencode.engine === 'glm-5.2' && cleanRates(opencode)
  && opencode.tokens.input_tokens_total === 30 && opencode.tokens.output_tokens_total === 5
  && agy && agy.engine === 'Gemini 3.6 Flash (High)' && cleanRates(agy)
  && agy.tokens.availability === 'unavailable' && agy.cost.availability === 'unavailable';
const opaque = !raw.includes('OPAQUE_NESTED_FRAGMENT')
  && !raw.includes('Customer roadmap') && !raw.includes('999999');
process.stdout.write([safe, opaque].join(':'));
NODE
)"
[ "$opaque_content_check" = "true:true" ] \
  && ok "20: provider metadata extraction never recurses into opaque content" \
  || bad "20: opaque content isolation check=$opaque_content_check"

# 21: recognized provider model fields accept direct strings only, and an
# explicit OpenCode root retains its own cohort context. Object-shaped session
# metadata must not become an engine identifier, and both general and nested
# swe-calibrate roots must keep their established behavior.
BOUNDARY_ROOT="$TESTDIR/provider-boundary-transcripts"
mkdir -p "$BOUNDARY_ROOT/codex" "$BOUNDARY_ROOT/grok" "$BOUNDARY_ROOT/agy" \
  "$BOUNDARY_ROOT/opencode/general-root/nested/swe-calibrate" \
  "$BOUNDARY_ROOT/opencode/swe-calibrate"
node - "$BOUNDARY_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const codex = [
  { type: 'session_meta', payload: { model: { id: 'codex_session_ref' } } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'ok' } },
  { type: 'turn.completed' },
];
fs.writeFileSync(
  path.join(root, 'codex', 'session.jsonl'),
  `${codex.map(JSON.stringify).join('\n')}\n`,
);
writeJson(path.join(root, 'grok', 'session.json'), {
  model: { id: 'sess_9f8e7d6c' },
  status: 'completed',
  response_text: 'ok',
});
writeJson(path.join(root, 'agy', 'session.json'), {
  model: { model_id: 'agy_session_ref' },
  status: 'completed',
  output_text: 'ok',
});
writeJson(path.join(root, 'opencode', 'general-root', 'object-model.json'), {
  modelID: { name: 'opencode_session_ref' },
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
});
writeJson(path.join(root, 'opencode', 'general-root', 'general.json'), {
  modelID: 'glm-5.2',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
});
writeJson(path.join(root, 'opencode', 'general-root', 'nested', 'swe-calibrate', 'nested.json'), {
  modelID: 'glm-5.2',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
});
writeJson(path.join(root, 'opencode', 'swe-calibrate', 'explicit-root.json'), {
  modelID: 'glm-5.2',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
});
NODE
node "$CLI" import-transcripts \
  --root "codex=$BOUNDARY_ROOT/codex" \
  --root "grok=$BOUNDARY_ROOT/grok" \
  --root "agy=$BOUNDARY_ROOT/agy" \
  --root "opencode=$BOUNDARY_ROOT/opencode/general-root" \
  --root "opencode=$BOUNDARY_ROOT/opencode/swe-calibrate" \
  > "$TESTDIR/provider-boundary-import.json"
provider_boundary_check="$(node - "$TESTDIR/provider-boundary-import.json" <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const report = JSON.parse(raw);
const find = (provider, engine, cohort) => report.aggregates.find((row) => (
  row.provider === provider && row.engine === engine && row.cohort === cohort
));
const directStringsOnly = find('codex', 'unknown', 'general')?.sample_size === 1
  && find('grok', 'unknown', 'general')?.sample_size === 1
  && find('agy', 'unknown', 'general')?.sample_size === 1
  && find('opencode', 'unknown', 'general')?.sample_size === 1;
const cohorts = find('opencode', 'glm-5.2', 'general')?.sample_size === 1
  && find('opencode', 'glm-5.2', 'swe-calibrate')?.sample_size === 2;
const objectFragmentsAbsent = [
  'codex_session_ref',
  'sess_9f8e7d6c',
  'agy_session_ref',
  'opencode_session_ref',
].every((fragment) => !raw.includes(fragment));
process.stdout.write([directStringsOnly, cohorts, objectFragmentsAbsent].join(':'));
NODE
)"
[ "$provider_boundary_check" = "true:true:true" ] \
  && ok "21: provider model fields are direct-string-only and explicit roots retain cohort context" \
  || bad "21: provider boundary check=$provider_boundary_check"

# 22: direct model strings that match bounded session identifier shapes are not
# engine names. Metrics accept only actual finite nonnegative JSON numbers:
# invalid scalar/container types stay unavailable, while numeric zero remains
# observed. Both root and Codex response-item tool exit-code paths share this
# strict boundary.
STRICT_ROOT="$TESTDIR/strict-schema-transcripts"
mkdir -p "$STRICT_ROOT/session-models" "$STRICT_ROOT/metrics" \
  "$STRICT_ROOT/cost-precedence" "$STRICT_ROOT/codex"
node - "$STRICT_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const sessionIds = [
  'sess_9f8e7d6c',
  'session-01HZX3Y9K8M7N6P5Q4R3S2T1V0',
  '123e4567-e89b-12d3-a456-426614174000',
];
sessionIds.forEach((model, index) => writeJson(
  path.join(root, 'session-models', `session-${index}.json`),
  { model, status: 'completed', response_text: 'ok' },
));

const invalidMetrics = [
  ['null', null],
  ['empty', ''],
  ['whitespace', '   '],
  ['numeric-string', '7'],
  ['false', false],
  ['true', true],
  ['object', { value: 1 }],
  ['array', [1]],
  ['negative', -1],
];
invalidMetrics.forEach(([name, value]) => writeJson(
  path.join(root, 'metrics', `${name}.json`),
  {
    model: 'grok-4.5',
    status: 'completed',
    response_text: 'ok',
    usage: {
      input_tokens: value,
      output_tokens: value,
      total_tokens: value,
      cost_usd: value,
    },
    cost_usd: value,
    tool: { exit_code: value },
  },
));
writeJson(path.join(root, 'metrics', 'valid-zero.json'), {
  model: 'grok-4.5',
  status: 'completed',
  response_text: 'ok',
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 },
  cost_usd: 0,
  tool: { exit_code: 0 },
});
writeJson(path.join(root, 'cost-precedence', 'usage-only.json'), {
  modelID: 'glm-5.2',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
  usage: { cost_usd: 0.01 },
});
writeJson(path.join(root, 'cost-precedence', 'root-only.json'), {
  modelID: 'MiniMax-M3',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
  cost_usd: 0.02,
});
writeJson(path.join(root, 'cost-precedence', 'both.json'), {
  modelID: 'qwen-3.8',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
  usage: { cost_usd: 0.03 },
  cost_usd: 0.99,
});

const codex = [
  { type: 'session_meta', payload: { model: 'gpt-5.6-sol' } },
  { type: 'response_item', payload: { type: 'tool_output', exit_code: true } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'ok' } },
  { type: 'turn.completed' },
];
fs.writeFileSync(
  path.join(root, 'codex', 'session.jsonl'),
  `${codex.map(JSON.stringify).join('\n')}\n`,
);
NODE
node "$CLI" import-transcripts \
  --root "grok=$STRICT_ROOT/session-models" \
  --root "grok=$STRICT_ROOT/metrics" \
  --root "opencode=$STRICT_ROOT/cost-precedence" \
  --root "codex=$STRICT_ROOT/codex" \
  > "$TESTDIR/strict-schema-import.json"
strict_schema_check="$(node - "$TESTDIR/strict-schema-import.json" <<'NODE'
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const report = JSON.parse(raw);
const find = (provider, engine) => report.aggregates.find((row) => (
  row.provider === provider && row.engine === engine
));
const unknown = find('grok', 'unknown');
const metrics = find('grok', 'grok-4.5');
const codex = find('codex', 'gpt-5.6-sol');
const sessionIdsRejected = unknown?.sample_size === 3 && [
  'sess_9f8e7d6c',
  'session-01HZX3Y9K8M7N6P5Q4R3S2T1V0',
  '123e4567-e89b-12d3-a456-426614174000',
].every((value) => !raw.includes(value));
const strictMetrics = metrics?.sample_size === 10
  && metrics.tokens.availability === 'available'
  && metrics.tokens.observed_samples === 1
  && metrics.tokens.input_tokens_total === 0
  && metrics.tokens.output_tokens_total === 0
  && metrics.tokens.total_tokens === 0
  && metrics.cost.availability === 'available'
  && metrics.cost.observed_samples === 1
  && metrics.cost.usd_total === 0
  && metrics.tool_failure_rate === 0;
const codexToolStrict = codex?.tool_failure_rate === 0;
const exactCost = (engine, expected) => {
  const row = find('opencode', engine);
  return row?.cost.availability === 'available'
    && row.cost.observed_samples === 1 && row.cost.usd_total === expected;
};
const costPrecedence = exactCost('glm-5.2', 0.01)
  && exactCost('MiniMax-M3', 0.02)
  && exactCost('qwen-3.8', 0.03);
process.stdout.write([
  sessionIdsRejected,
  strictMetrics,
  codexToolStrict,
  costPrecedence,
].join(':'));
NODE
)"
[ "$strict_schema_check" = "true:true:true:true" ] \
  && ok "22: session IDs, strict metrics, and cost precedence enforce schema boundaries" \
  || bad "22: strict schema check=$strict_schema_check"

# 23: schema coverage counts only recognized provider shapes; cohort matching is
# exact by path component (including explicit roots below swe-calibrate); and
# overlapping roots count each physical file once per provider regardless of
# argument order.
IMPORT_BOUNDARY_ROOT="$TESTDIR/import-boundary-transcripts"
mkdir -p "$IMPORT_BOUNDARY_ROOT/coverage/codex" \
  "$IMPORT_BOUNDARY_ROOT/coverage/grok" \
  "$IMPORT_BOUNDARY_ROOT/cohort/not-swe-calibrate-backup" \
  "$IMPORT_BOUNDARY_ROOT/cohort/swe-calibrate/below" \
  "$IMPORT_BOUNDARY_ROOT/overlap/parent/child"
node - "$IMPORT_BOUNDARY_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const writeRaw = (file, value) => fs.writeFileSync(file, `${value}\n`);
const writeJson = (file, value) => writeRaw(file, JSON.stringify(value));
for (const provider of ['codex', 'grok']) {
  const dir = path.join(root, 'coverage', provider);
  writeJson(path.join(dir, 'unsupported-object.json'), {});
  writeJson(path.join(dir, 'unsupported-array.json'), []);
  writeJson(path.join(dir, 'unsupported-string.json'), 'hello');
}
const codex = [
  { type: 'session_meta', payload: { model: 'gpt-5.6-sol' } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'ok' } },
  { type: 'turn.completed' },
];
writeRaw(
  path.join(root, 'coverage', 'codex', 'recognized.jsonl'),
  codex.map(JSON.stringify).join('\n'),
);
writeJson(path.join(root, 'coverage', 'grok', 'recognized.json'), {
  model: 'grok-4.5',
  status: 'completed',
  response_text: 'ok',
});
writeJson(path.join(root, 'cohort', 'not-swe-calibrate-backup', 'session.json'), {
  modelID: 'glm-5.2',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
});
writeJson(path.join(root, 'cohort', 'swe-calibrate', 'below', 'session.json'), {
  modelID: 'MiniMax-M3',
  status: 'completed',
  messages: [{ role: 'assistant', content: 'ok' }],
});
writeJson(path.join(root, 'overlap', 'parent', 'child', 'session.json'), {
  model: 'grok-composer-2.5-fast',
  status: 'completed',
  response_text: 'ok',
});
NODE
node "$CLI" import-transcripts \
  --root "codex=$IMPORT_BOUNDARY_ROOT/coverage/codex" \
  --root "grok=$IMPORT_BOUNDARY_ROOT/coverage/grok" \
  > "$TESTDIR/schema-coverage-import.json"
node "$CLI" import-transcripts \
  --root "opencode=$IMPORT_BOUNDARY_ROOT/cohort/not-swe-calibrate-backup" \
  --root "opencode=$IMPORT_BOUNDARY_ROOT/cohort/swe-calibrate/below" \
  > "$TESTDIR/cohort-boundary-import.json"
node "$CLI" import-transcripts \
  --root "grok=$IMPORT_BOUNDARY_ROOT/overlap/parent" \
  --root "grok=$IMPORT_BOUNDARY_ROOT/overlap/parent/child" \
  > "$TESTDIR/overlap-first.json"
node "$CLI" import-transcripts \
  --root "grok=$IMPORT_BOUNDARY_ROOT/overlap/parent/child" \
  --root "grok=$IMPORT_BOUNDARY_ROOT/overlap/parent" \
  > "$TESTDIR/overlap-second.json"
import_boundary_check="$(node - \
  "$TESTDIR/schema-coverage-import.json" \
  "$TESTDIR/cohort-boundary-import.json" \
  "$TESTDIR/overlap-first.json" \
  "$TESTDIR/overlap-second.json" <<'NODE'
const fs = require('fs');
const [coverageFile, cohortFile, overlapFirstFile, overlapSecondFile] = process.argv.slice(2);
const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));
const cohort = JSON.parse(fs.readFileSync(cohortFile, 'utf8'));
const overlapFirstRaw = fs.readFileSync(overlapFirstFile, 'utf8');
const overlapSecondRaw = fs.readFileSync(overlapSecondFile, 'utf8');
const source = (report, provider) => report.sources.find((row) => row.provider === provider);
const codexSource = source(coverage, 'codex');
const grokSource = source(coverage, 'grok');
const schemaCoverage = codexSource?.candidate_files === 4
  && codexSource.parsed_sessions === 1
  && codexSource.schema_coverage_rate === 0.25
  && grokSource?.candidate_files === 4
  && grokSource.parsed_sessions === 1
  && grokSource.schema_coverage_rate === 0.25
  && coverage.aggregates.length === 2
  && coverage.aggregates.every((row) => row.engine !== 'unknown');
const cohortRow = (engine, name) => cohort.aggregates.find((row) => (
  row.engine === engine && row.cohort === name
));
const exactCohorts = cohortRow('glm-5.2', 'general')?.sample_size === 1
  && cohortRow('MiniMax-M3', 'swe-calibrate')?.sample_size === 1;
const overlap = JSON.parse(overlapFirstRaw);
const overlapSource = source(overlap, 'grok');
const overlapDeduped = overlapFirstRaw === overlapSecondRaw
  && overlapSource?.candidate_files === 1
  && overlapSource.parsed_sessions === 1
  && overlapSource.schema_coverage_rate === 1
  && overlap.aggregates.length === 1
  && overlap.aggregates[0].engine === 'grok-composer-2.5-fast'
  && overlap.aggregates[0].sample_size === 1;
process.stdout.write([schemaCoverage, exactCohorts, overlapDeduped].join(':'));
NODE
)"
[ "$import_boundary_check" = "true:true:true" ] \
  && ok "23: schema coverage, cohort components, and overlapping roots are deterministic" \
  || bad "23: import boundary check=$import_boundary_check"

echo "----"
echo "engine-scorecard harness: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
