#!/usr/bin/env bash
# Deterministic Phase-2 implementer A/B runner. The implementation prompt is byte-identical
# across arms; the pack arm's sole treatment is canonical dispatch-hetero prompt injection.
# Candidate tests and self-reports are never authoritative: the frozen source oracle and a
# preselected non-OpenAI reviewer own the outcome.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
MANIFEST="$HERE/implementer-tasks.json"
TASKS_ROOT="$REPO_ROOT/evals/orchestration/tasks"
PACK="$HERE/packs/implementer-pack.md"
OUT="$HERE/results/implementer-matrix.jsonl"
SEED_FILE="$HERE/results/implementer-matrix.seed"
SEED=""
ENGINE="gpt-5.3-codex-spark"
RUNNER="codex"
EFFORT="high"
TIMEOUT="12m"
REVIEWER_RUNNER="claude-native"
REVIEWER_MODEL="claude-opus"
REVIEWER_EFFORT="high"
DISPATCH_CMD=""
REVIEWER_CMD=""
CODEX_BIN="codex"
PRIVATE_ROOT=""
CAPABILITY_STORE=""
ROOT_RUN_ID="skill-transport-implementer-arm"
LIMIT=0
TEST_MODE=0
VALIDATE_ONLY=0

usage() {
  sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Usage: run-implementer-matrix.sh [options]
  --manifest <json> --tasks-root <dir> --pack <file>
  --out <jsonl> --seed-file <file> [--seed <uint32>] [--limit <n>]
  --engine <model> --effort <level> --timeout <duration> --codex-bin <path>
  --reviewer-runner <runner> --reviewer-model <model> --reviewer-effort <level>
  --dispatch-cmd <path> --reviewer-cmd <path> --private-root <dir>
  --capability-store <dir> --root-run-id <id>
  --validate-only   validate hashes, all base-red controls, and adapter; dispatch zero cells
  --test-mode   permit a non-production manifest/task count (mechanics tests only)
EOF
}

die() { printf 'run-implementer-matrix: ERROR: %s\n' "$*" >&2; exit 2; }
sha256() { sha256sum "$1" | awk '{print $1}'; }
is_uint() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

while [ $# -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --tasks-root) TASKS_ROOT="${2:-}"; shift 2 ;;
    --pack) PACK="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --seed-file) SEED_FILE="${2:-}"; shift 2 ;;
    --seed) SEED="${2:-}"; shift 2 ;;
    --engine) ENGINE="${2:-}"; shift 2 ;;
    --effort) EFFORT="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --reviewer-runner) REVIEWER_RUNNER="${2:-}"; shift 2 ;;
    --reviewer-model) REVIEWER_MODEL="${2:-}"; shift 2 ;;
    --reviewer-effort) REVIEWER_EFFORT="${2:-}"; shift 2 ;;
    --dispatch-cmd) DISPATCH_CMD="${2:-}"; shift 2 ;;
    --reviewer-cmd) REVIEWER_CMD="${2:-}"; shift 2 ;;
    --codex-bin) CODEX_BIN="${2:-}"; shift 2 ;;
    --private-root) PRIVATE_ROOT="${2:-}"; shift 2 ;;
    --capability-store) CAPABILITY_STORE="${2:-}"; shift 2 ;;
    --root-run-id) ROOT_RUN_ID="${2:-}"; shift 2 ;;
    --limit) LIMIT="${2:-}"; shift 2 ;;
    --validate-only) VALIDATE_ONLY=1; shift ;;
    --test-mode) TEST_MODE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -r "$MANIFEST" ] || die "manifest is not readable: $MANIFEST"
[ -d "$TASKS_ROOT" ] || die "tasks root is not a directory: $TASKS_ROOT"
[ -r "$PACK" ] || die "pack is not readable: $PACK"
command -v node >/dev/null 2>&1 || die "node is required"
command -v git >/dev/null 2>&1 || die "git is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
is_uint "$LIMIT" || die "--limit must be a non-negative integer"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) die "invalid implementer effort: $EFFORT" ;; esac
case "$REVIEWER_EFFORT" in low|medium|high|xhigh|max) ;; *) die "invalid reviewer effort: $REVIEWER_EFFORT" ;; esac
[[ "$ROOT_RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] || die "--root-run-id has an invalid character"
if [ "$TEST_MODE" -ne 1 ]; then
  [ "$ENGINE" = "gpt-5.3-codex-spark" ] || die "production matrix requires gpt-5.3-codex-spark"
  [ "$RUNNER" = "codex" ] || die "production matrix requires runner codex"
  case "$REVIEWER_RUNNER" in claude-native|agy) ;; *) die "production reviewer must be claude-native or agy" ;; esac
fi

MANIFEST_TSV="$(mktemp)" || die "cannot allocate manifest validation file"
cleanup_manifest() { rm -f "$MANIFEST_TSV"; }
trap cleanup_manifest EXIT

# Validate schema/path safety before any run directory, seed, or dispatcher effect. Emit a
# bounded TSV only after the complete manifest is valid.
node - "$MANIFEST" "$TEST_MODE" > "$MANIFEST_TSV" <<'NODE' || die "invalid task manifest"
const fs = require('fs');
const [file, testModeRaw] = process.argv.slice(2);
const testMode = testModeRaw === '1';
const expected = [
  't1-fix-with-decoy','t3-vacuous-test','t4-config-layer','t7-config-rename',
  't8-log-redaction','t11-boundary-fix','t13-log-parser','t15-cache-invalidation'
];
const digest = /^[0-9a-f]{64}$/;
const safe = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
let m;
try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`parse: ${e.message}`); }
if (m.schema_version !== 1 || !Array.isArray(m.tasks)) throw new Error('schema_version/tasks invalid');
if (!digest.test(m.pack_sha256 || '')) throw new Error('pack_sha256 invalid');
if (!testMode && JSON.stringify(m.tasks.map(t => t.id)) !== JSON.stringify(expected)) throw new Error('production task set/order drift');
if (testMode && m.tasks.length < 1) throw new Error('test manifest must contain a task');
const seen = new Set();
for (const t of m.tasks) {
  if (!safe.test(t.id || '') || !safe.test(t.path || '')) throw new Error('unsafe task id/path');
  if (seen.has(t.id)) throw new Error(`duplicate task id: ${t.id}`); seen.add(t.id);
  if (!digest.test(t.task_sha256 || '') || !digest.test(t.oracle_sha256 || '')) throw new Error(`bad digest: ${t.id}`);
  if (JSON.stringify(t.verify_cmd) !== JSON.stringify(['bash','oracle.sh'])) throw new Error(`verify_cmd drift: ${t.id}`);
  process.stdout.write([t.id,t.path,t.task_sha256,t.oracle_sha256,m.pack_sha256].join('\t')+'\n');
}
NODE

validate_inputs() {
  local id path task_hash oracle_hash pack_hash task_dir
  while IFS=$'\t' read -r id path task_hash oracle_hash pack_hash; do
    task_dir="$TASKS_ROOT/$path"
    [ -d "$task_dir/repo" ] || die "missing task repo: $id"
    [ -f "$task_dir/task.md" ] || die "missing task.md: $id"
    [ -f "$task_dir/oracle.sh" ] || die "missing oracle.sh: $id"
    [ "$(sha256 "$task_dir/task.md")" = "$task_hash" ] || die "task.md digest drift: $id"
    [ "$(sha256 "$task_dir/oracle.sh")" = "$oracle_hash" ] || die "oracle.sh digest drift: $id"
  done < "$MANIFEST_TSV"
  pack_hash="$(cut -f5 "$MANIFEST_TSV" | head -1)"
  [ "$pack_hash" = "3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca" ] \
    || die "manifest does not bind the frozen implementer pack"
  [ "$(sha256 "$PACK")" = "$pack_hash" ] || die "frozen implementer pack digest drift"
}
validate_inputs

# Fail closed on a corrupt/mixed prior ledger before any new dispatch.
if [ -s "$OUT" ]; then
  node - "$OUT" "$ENGINE" "$EFFORT" "$REVIEWER_RUNNER" "$REVIEWER_MODEL" "$REVIEWER_EFFORT" <<'NODE' \
    || die "existing result ledger is corrupt or belongs to a different tuple"
const fs=require('fs'); const [f,engine,effort,rr,rm,re]=process.argv.slice(2);
const seen=new Set();
for(const [i,line] of fs.readFileSync(f,'utf8').split('\n').entries()){
  if(!line.trim()) continue; let r; try{r=JSON.parse(line)}catch(e){throw new Error(`line ${i+1}`)}
  if(!['completed','infra_failed','invalid'].includes(r.status)) throw new Error('nonterminal row');
  if(r.cell_key!==`${r.engine}|${r.arm}|${r.task}` || seen.has(r.cell_key)) throw new Error('bad/duplicate key');
  if(r.engine!==engine || r.runner!=='codex' || r.effort!==effort || r.reviewer_runner!==rr || r.reviewer_model!==rm || r.reviewer_effort!==re) throw new Error('tuple drift');
  seen.add(r.cell_key);
}
NODE
fi

# Baseline qualification runs every frozen oracle against a fresh root commit. All tasks are
# qualified before the seed/schedule or any implementation adapter is created.
QUAL_ROOT="$(mktemp -d)" || die "cannot allocate base-red root"
cleanup_qual() { rm -rf "$QUAL_ROOT"; }
trap 'cleanup_qual; cleanup_manifest' EXIT
while IFS=$'\t' read -r id path _; do
  q="$QUAL_ROOT/$id"
  mkdir -p "$q"
  cp -a "$TASKS_ROOT/$path/repo/." "$q/"
  git -C "$q" init -q
  git -C "$q" config user.name "Autopilot Eval"
  git -C "$q" config user.email "eval@example.com"
  git -C "$q" config commit.gpgsign false
  git -C "$q" add -A
  git -C "$q" commit -q --no-verify -m "frozen base"
  set +e
  (cd "$q" && bash "$TASKS_ROOT/$path/oracle.sh") > "$q.oracle.log" 2>&1
  oracle_rc=$?
  set -e
  [ "$oracle_rc" -ne 0 ] && grep -q '^STATUS: FAIL$' "$q.oracle.log" \
    || die "base-red qualification rejected $id (exit=$oracle_rc)"
done < "$MANIFEST_TSV"
cleanup_qual

mkdir -p "$(dirname "$OUT")" "$(dirname "$SEED_FILE")"
if [ -f "$SEED_FILE" ]; then
  recorded_seed="$(tr -d '[:space:]' < "$SEED_FILE")"
  is_uint "$recorded_seed" || die "seed file is not a numeric seed"
  [ -z "$SEED" ] || [ "$SEED" = "$recorded_seed" ] || die "requested seed disagrees with persisted seed"
  SEED="$recorded_seed"
else
  if [ -z "$SEED" ]; then SEED="$(node -e 'console.log(require("crypto").randomBytes(4).readUInt32LE(0))')"; fi
  is_uint "$SEED" || die "--seed must be an unsigned integer"
  printf '%s\n' "$SEED" > "$SEED_FILE"
fi
[ "$SEED" -le 4294967295 ] || die "seed exceeds uint32"

if [ -z "$PRIVATE_ROOT" ]; then
  PRIVATE_ROOT="${AUTOPILOT_PRIVATE_RUN_ROOT:-${HOME}/.autopilot/runs}/skill-transport-${SEED}"
fi
umask 077
mkdir -p "$PRIVATE_ROOT"
SCHEDULE="$PRIVATE_ROOT/schedule.json"
node - "$MANIFEST_TSV" "$ENGINE" "$SEED" "$SCHEDULE" <<'NODE'
const fs=require('fs'); const [tsv,engine,seedRaw,out]=process.argv.slice(2);
const tasks=fs.readFileSync(tsv,'utf8').trim().split('\n').filter(Boolean).map(x=>x.split('\t')[0]);
let x=Number(seedRaw)>>>0; const rand=()=>{x|=0;x=x+0x6D2B79F5|0;let t=Math.imul(x^x>>>15,1|x);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const cells=[]; for(const task of tasks) for(const arm of ['nopack','pack']) cells.push({engine,arm,task,cell_key:`${engine}|${arm}|${task}`});
for(let i=cells.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[cells[i],cells[j]]=[cells[j],cells[i]];}
cells.forEach((c,i)=>c.schedule_position=i+1);
fs.writeFileSync(out,JSON.stringify({schema_version:1,seed:Number(seedRaw),cells},null,2)+'\n',{mode:0o600});
NODE

if [ -s "$OUT" ]; then
  prior_seed="$(node -e 'const fs=require("fs");const s=new Set(fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(x=>String(JSON.parse(x).seed)));if(s.size!==1)process.exit(2);process.stdout.write([...s][0])' "$OUT")" \
    || die "existing rows have mixed seeds"
  [ "$prior_seed" = "$SEED" ] || die "existing rows disagree with persisted seed"
fi

# Eval-only byte adapter: production scripts stay untouched. The symlinked dispatch script
# resolves its support files inside this private root, while the frozen pack is exposed under
# the slash-free skill name accepted by the canonical CLI.
ADAPTER="$PRIVATE_ROOT/adapter"
mkdir -p "$ADAPTER/scripts" "$ADAPTER/skills/implementer-pack"
[ -e "$ADAPTER/src" ] || ln -s "$REPO_ROOT/src" "$ADAPTER/src"
for entry in "$REPO_ROOT/scripts"/*; do
  name="$(basename "$entry")"
  [ -e "$ADAPTER/scripts/$name" ] || ln -s "$entry" "$ADAPTER/scripts/$name"
done
ln -sfn "$PACK" "$ADAPTER/skills/implementer-pack/SKILL.md"
canonical_dispatch="$(readlink -f "$REPO_ROOT/scripts/dispatch-hetero.sh")"
adapter_dispatch="$(readlink -f "$ADAPTER/scripts/dispatch-hetero.sh")"
[ "$adapter_dispatch" = "$canonical_dispatch" ] || die "adapter dispatch does not resolve to canonical rail"
[ "$(sha256 "$adapter_dispatch")" = "$(sha256 "$canonical_dispatch")" ] || die "adapter dispatch byte drift"
[ "$(sha256 "$ADAPTER/skills/implementer-pack/SKILL.md")" = "$(sha256 "$PACK")" ] || die "adapter pack byte drift"
[ -n "$DISPATCH_CMD" ] || DISPATCH_CMD="$ADAPTER/scripts/dispatch-hetero.sh"
[ -n "$REVIEWER_CMD" ] || REVIEWER_CMD="$REPO_ROOT/scripts/dispatch-review.sh"
[ -x "$DISPATCH_CMD" ] || die "dispatch command is not executable: $DISPATCH_CMD"
[ -x "$REVIEWER_CMD" ] || die "reviewer command is not executable: $REVIEWER_CMD"
if [ "$VALIDATE_ONLY" -eq 1 ]; then
  command -v "$CODEX_BIN" >/dev/null 2>&1 || die "codex binary is unavailable: $CODEX_BIN"
  "$CODEX_BIN" exec --help 2>&1 | grep -q -- '--dangerously-bypass-hook-trust' \
    || die "codex binary lacks the required hook-trust bypass flag"
  printf 'run-implementer-matrix: VALIDATED tasks=%s seed=%s dispatch_sha=%s pack_sha=%s\n' \
    "$(wc -l < "$MANIFEST_TSV" | tr -d ' ')" "$SEED" "$(sha256 "$canonical_dispatch")" "$(sha256 "$PACK")" >&2
  exit 0
fi

terminal_keys="$PRIVATE_ROOT/terminal-keys.txt"
if [ -s "$OUT" ]; then
  node -e 'const fs=require("fs");for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){if(l.trim())console.log(JSON.parse(l).cell_key)}' "$OUT" | sort -u > "$terminal_keys"
else : > "$terminal_keys"; fi

record_capability() {
  local arm="$1" key="$2" effective="$3" state="unknown"
  [ "$arm" = "pack" ] && [ "$effective" = "prompt" ] && state="supported"
  event="$PRIVATE_ROOT/capability-event.json"
  OBSERVED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" ARM="$arm" CELL_KEY="$key" STATE="$state" \
    ENGINE="$ENGINE" EFFORT="$EFFORT" node -e '
const e=process.env; const o={schema_version:1,observed_at:e.OBSERVED_AT,runner:"codex",model:e.ENGINE,
role:"implementer",effort:e.EFFORT,endpoint:null,runner_version:null,capability:{quota:{status:"unknown",
reset_at:null,confidence:"low",evidence:`skill-transport ${e.ARM} cell; quota not measured`,ttl_seconds:0},
skill_transport:{native:"unknown",prompt_pack:e.STATE,last_bench_id:e.CELL_KEY}}};
require("fs").writeFileSync(process.argv[1],JSON.stringify(o)+"\n");' "$event"
  args=(record --file "$event")
  [ -z "$CAPABILITY_STORE" ] || args+=(--store "$CAPABILITY_STORE")
  node "$REPO_ROOT/scripts/engine-capability-state.js" "${args[@]}" >/dev/null \
    || die "capability record failed for $key"
}

append_row() {
  local row_status="$1" infra="$2" task="$3" arm="$4" key="$5" position="$6" base_sha="$7" \
    prompt_sha="$8" oracle_rc="$9" dispatch_file="${10}" review_norm="${11}"
  ROW_STATUS="$row_status" INFRA="$infra" TASK="$task" ARM="$arm" CELL_KEY="$key" POSITION="$position" \
  BASE_SHA="$base_sha" PROMPT_SHA="$prompt_sha" ORACLE_RC="$oracle_rc" ENGINE="$ENGINE" EFFORT="$EFFORT" \
  REVIEWER_RUNNER="$REVIEWER_RUNNER" REVIEWER_MODEL="$REVIEWER_MODEL" REVIEWER_EFFORT="$REVIEWER_EFFORT" \
  SEED="$SEED" PACK_SHA="$(sha256 "$PACK")" DISPATCH_SHA="$(sha256 "$canonical_dispatch")" \
  node - "$OUT" "$dispatch_file" "$review_norm" <<'NODE'
const fs=require('fs'),crypto=require('crypto'),e=process.env;
let d={}; try{d=JSON.parse(fs.readFileSync(process.argv[3],'utf8'))}catch(error){d={parse_error:true}}
let rv={valid:false,status:null,verdict:null,fingerprints:[]};
try{rv=JSON.parse(fs.readFileSync(process.argv[4],'utf8'))}catch(error){rv={valid:false,status:null,verdict:null,fingerprints:[],reason:'normalized_review_unparseable'}}
const oracleExit=Number(e.ORACLE_RC); const defects=new Set(rv.fingerprints||[]);
if(e.ROW_STATUS==='completed' && oracleExit!==0) defects.add(`oracle:${e.TASK}`);
const row={schema_version:1,cell_key:e.CELL_KEY,schedule_position:Number(e.POSITION),seed:Number(e.SEED),
task:e.TASK,arm:e.ARM,transport_treatment:e.ARM==='pack'?'prompt_pack':'off',runner:'codex',engine:e.ENGINE,
effort:e.EFFORT,reviewer_runner:e.REVIEWER_RUNNER,reviewer_model:e.REVIEWER_MODEL,reviewer_effort:e.REVIEWER_EFFORT,
status:e.ROW_STATUS,infrastructure_classification:e.INFRA||null,dispatch_status:d.status||null,
dispatcher_called:typeof d.dispatcher_called==='boolean'?d.dispatcher_called:null,
model_calls:Number.isInteger(d.model_calls)?d.model_calls:null,committed:d.status==='committed',commit:d.commit||null,
base_sha:e.BASE_SHA,skill_mode_effective:d.skill_mode_effective||'off',skills_injected:Array.isArray(d.skills_injected)?d.skills_injected:[],
oracle_pass:e.ROW_STATUS==='completed'?oracleExit===0:null,oracle_exit:Number.isFinite(oracleExit)?oracleExit:null,
reviewer_status:rv.status||null,reviewer_verdict:rv.verdict||null,
reviewer_defect_fingerprints:Array.isArray(rv.fingerprints)?rv.fingerprints:[],
defect_fingerprints:[...defects].sort(),usage:d.usage&&typeof d.usage==='object'?d.usage:null,
wall_secs:Number.isFinite(Number(d.wall_secs))?Number(d.wall_secs):null,prompt_sha256:e.PROMPT_SHA,
pack_sha256:e.PACK_SHA,dispatch_rail_sha256:e.DISPATCH_SHA,recorded_at:new Date().toISOString()};
fs.appendFileSync(process.argv[2],JSON.stringify(row)+'\n',{encoding:'utf8',mode:0o600});
NODE
}

normalize_review() {
  local response="$1" out="$2"
  node - "$response" "$out" <<'NODE'
const fs=require('fs'),crypto=require('crypto'); let result={valid:false,status:null,verdict:null,fingerprints:[],reason:'unparseable'};
try{
  const o=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const status=String(o.status||''); const verdict=o.verdict==null?null:String(o.verdict);
  const lines=String(o.findings||'').split(/\r?\n/).map(x=>x.trim().replace(/\s+/g,' ')).filter(x=>/MUST-FIX/i.test(x));
  const fps=[...new Set(lines.map(x=>'review:'+crypto.createHash('sha256').update(x.toLowerCase()).digest('hex')))];
  const protocolOk=status==='reviewed' && (verdict==='SHIP-AS-IS'||verdict==='FIX-THEN-SHIP') && (verdict!=='FIX-THEN-SHIP'||fps.length>0);
  result={valid:protocolOk,status,verdict,fingerprints:fps,reason:protocolOk?null:(status==='no_verdict'||status==='precondition_failed'?'reviewer_unavailable':'reviewer_protocol')};
}catch(error){result={valid:false,status:null,verdict:null,fingerprints:[],reason:'unparseable'}}
fs.writeFileSync(process.argv[3],JSON.stringify(result)+'\n',{mode:0o600});
NODE
}

ran=0
while IFS=$'\t' read -r task arm key position; do
  grep -Fqx "$key" "$terminal_keys" && continue
  [ "$LIMIT" -eq 0 ] || [ "$ran" -lt "$LIMIT" ] || break
  validate_inputs

  path="$(awk -F '\t' -v id="$task" '$1==id{print $2}' "$MANIFEST_TSV")"
  cell_slug="$(printf '%02d-%s-%s' "$position" "$task" "$arm" | tr -c 'A-Za-z0-9._-' '-')"
  cell="$PRIVATE_ROOT/cells/$cell_slug"
  repo="$cell/repo"
  if [ -e "$cell" ]; then
    mv "$cell" "$cell.interrupted-$(date -u +%Y%m%dT%H%M%SZ)-$$" \
      || die "cannot preserve interrupted cell: $cell"
  fi
  mkdir -p "$repo"
  cp -a "$TASKS_ROOT/$path/repo/." "$repo/"
  git -C "$repo" init -q
  git -C "$repo" config user.name "Autopilot Eval"
  git -C "$repo" config user.email "eval@example.com"
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -q --no-verify -m "frozen base"
  base_sha="$(git -C "$repo" rev-parse HEAD)"
  prompt="$cell/prompt.md"
  TASK_FILE="$TASKS_ROOT/$path/task.md" TASK_ID="$task" node -e '
const fs=require("fs"),e=process.env; const task=fs.readFileSync(e.TASK_FILE,"utf8");
const p=["=== FROZEN SEVEN-ELEMENT IMPLEMENTATION WRAPPER ===",
`1. Goal — complete the exact ${e.TASK_ID} task correctly.`,
"2. Scope — modify only this disposable micro-repository and only files needed by the task.",
"3. Input — the exact frozen task specification follows:","--- BEGIN FROZEN TASK ---",task,"--- END FROZEN TASK ---",
"4. Output — leave the complete implementation and any task-required tests/artifacts in the repository.",
"5. Acceptance — satisfy the task specification; an independent frozen oracle will judge the resulting commit.",
"6. Boundaries — do not replace or weaken an oracle, do not access another cell, do not expose credentials, and do not change public contracts unless the task requires it.",
"7. Execution — inspect first, implement the whole task, run relevant local checks, commit nothing manually, and finish without asking the dispatcher questions.",""];
fs.writeFileSync(process.argv[1],p.join("\n"));' "$prompt"
  prompt_sha="$(sha256 "$prompt")"

  dispatch_json="$cell/dispatch.json"
  dispatch_err="$cell/dispatch.stderr"
  branch="bench/$cell_slug"
  dispatch_args=(--branch "$branch" --prompt-file "$prompt" --runner codex --model "$ENGINE" --effort "$EFFORT" \
    --base "$base_sha" --timeout "$TIMEOUT" --codex-bin "$CODEX_BIN" --context-window block)
  if [ "$arm" = "pack" ]; then dispatch_args+=(--skill-mode prompt --skill implementer-pack); else dispatch_args+=(--skill-mode off); fi
  set +e
  (cd "$repo" && DISPATCH_DETACH=0 AUTOPILOT_PARENT_RUN_ID="$ROOT_RUN_ID" AUTOPILOT_ROOT_RUN_ID="$ROOT_RUN_ID" \
    AUTOPILOT_DISPATCH_DEPTH=1 "$DISPATCH_CMD" "${dispatch_args[@]}" < /dev/null) > "$dispatch_json" 2> "$dispatch_err"
  dispatch_rc=$?
  set -e

  dispatch_valid=0; dispatch_status=""; commit=""; effective="off"; model_calls=0; returned_wt=""
  set +e
  parsed="$(node - "$dispatch_json" 2> "$cell/dispatch-parse.stderr" <<'NODE'
const fs=require('fs');const o=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!o||typeof o!=='object'||typeof o.status!=='string')process.exit(2);
const b=x=>Buffer.from(String(x==null?'':x)).toString('base64');
console.log([b(o.status),b(o.commit),b(o.skill_mode_effective),Number.isInteger(o.model_calls)?o.model_calls:0,b(o.worktree)].join('\t'));
NODE
)"
  dispatch_parse_rc=$?
  set -e
  if [ "$dispatch_parse_rc" -eq 0 ] && [ -n "$parsed" ]; then
    dispatch_valid=1
    dispatch_status="$(printf '%s' "$parsed" | cut -f1 | base64 -d)"
    commit="$(printf '%s' "$parsed" | cut -f2 | base64 -d)"
    effective="$(printf '%s' "$parsed" | cut -f3 | base64 -d)"
    model_calls="$(printf '%s' "$parsed" | cut -f4)"
    returned_wt="$(printf '%s' "$parsed" | cut -f5 | base64 -d)"
  fi

  row_status="completed"; infra=""; oracle_rc=255
  review_norm="$cell/review.normalized.json"
  printf '{"valid":false,"status":null,"verdict":null,"fingerprints":[],"reason":"not_run"}\n' > "$review_norm"
  candidate_commit="$base_sha"
  if [ "$dispatch_valid" -ne 1 ]; then
    row_status="invalid"; infra="dispatcher_unparseable"
  elif [ "$model_calls" -lt 1 ]; then
    row_status="infra_failed"; infra="model_not_called"
  elif [ "$dispatch_status" = "committed" ]; then
    if [ -z "$commit" ] || ! git -C "$repo" cat-file -e "$commit^{commit}" 2>/dev/null; then
      row_status="invalid"; infra="missing_commit_witness"
    else candidate_commit="$commit"; fi
  elif [ "$dispatch_status" = "no_op" ]; then
    candidate_commit="$base_sha"
  else
    row_status="infra_failed"; infra="dispatch_${dispatch_status:-unknown}_rc_${dispatch_rc}"
  fi

  candidate="$cell/candidate"
  if [ "$row_status" = "completed" ]; then
    if ! git -C "$repo" worktree add --quiet --detach "$candidate" "$candidate_commit"; then
      row_status="invalid"; infra="candidate_materialization_failed"
    else
      set +e
      (cd "$candidate" && bash "$TASKS_ROOT/$path/oracle.sh") > "$cell/oracle.log" 2>&1
      oracle_rc=$?
      set -e
      if [ "$oracle_rc" -eq 126 ] || [ "$oracle_rc" -eq 127 ]; then
        row_status="invalid"; infra="oracle_execution_error"
      else
        git -C "$repo" diff --binary "$base_sha..$candidate_commit" > "$cell/candidate.diff"
        set +e
        (DISPATCH_DETACH=0 AUTOPILOT_PARENT_RUN_ID="$ROOT_RUN_ID" AUTOPILOT_ROOT_RUN_ID="$ROOT_RUN_ID" \
          AUTOPILOT_DISPATCH_DEPTH=1 "$REVIEWER_CMD" --runner "$REVIEWER_RUNNER" --model "$REVIEWER_MODEL" \
          --effort "$REVIEWER_EFFORT" --timeout "$TIMEOUT" --diff-file "$cell/candidate.diff" \
          --spec-file "$TASKS_ROOT/$path/task.md" --context-window block < /dev/null) > "$cell/review.json" 2> "$cell/review.stderr"
        review_rc=$?
        set -e
        normalize_review "$cell/review.json" "$review_norm"
        review_valid="$(node -e 'const o=require(process.argv[1]);process.stdout.write(String(o.valid))' "$review_norm")"
        review_reason="$(node -e 'const o=require(process.argv[1]);process.stdout.write(String(o.reason||""))' "$review_norm")"
        if [ "$review_valid" != "true" ]; then
          case "$review_reason" in reviewer_unavailable) row_status="infra_failed" ;; *) row_status="invalid" ;; esac
          infra="${review_reason:-reviewer_invalid}_rc_${review_rc}"
        fi
      fi
    fi
  fi

  append_row "$row_status" "$infra" "$task" "$arm" "$key" "$position" "$base_sha" "$prompt_sha" "$oracle_rc" "$dispatch_json" "$review_norm"
  printf '%s\n' "$key" >> "$terminal_keys"
  record_capability "$arm" "$key" "$effective"
  if [ -d "$candidate" ] && ! git -C "$repo" worktree remove --force "$candidate" >/dev/null 2>&1; then
    printf 'run-implementer-matrix: WARN: candidate worktree cleanup failed: %s\n' "$candidate" >&2
  fi
  if [ -n "$returned_wt" ] && [ -d "$returned_wt" ] \
    && ! git -C "$repo" worktree remove --force "$returned_wt" >/dev/null 2>&1; then
    printf 'run-implementer-matrix: WARN: dispatcher worktree cleanup failed: %s\n' "$returned_wt" >&2
  fi
  printf 'run-implementer-matrix: %s -> %s%s\n' "$key" "$row_status" "${infra:+ ($infra)}" >&2
  ran=$((ran + 1))
done < <(node -e 'const s=require(process.argv[1]);for(const c of s.cells)console.log([c.task,c.arm,c.cell_key,c.schedule_position].join("\t"))' "$SCHEDULE")

printf 'run-implementer-matrix: ran=%s seed=%s out=%s private=%s\n' "$ran" "$SEED" "$OUT" "$PRIVATE_ROOT" >&2
