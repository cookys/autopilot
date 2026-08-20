#!/usr/bin/env bash
# No-spend proof for input binding, base-red qualification, canonical prompt injection,
# exact-key resume, fail-closed terminal rows, and deterministic report arithmetic.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ST="$(cd "$HERE/.." && pwd)"
RUNNER="$ST/run-implementer-matrix.sh"
REPORT="$ST/implementer-report.js"
STUB="$HERE/stub-implementer-dispatch.sh"
PACK="$ST/packs/implementer-pack.md"
TMP="$(mktemp -d)"
cleanup() {
  if [ "${KEEP_MECHANICS_TMP:-0}" = "1" ]; then
    printf 'mechanics temp retained: %s\n' "$TMP" >&2
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT
PASS=0
FAILN=0
ok() { PASS=$((PASS + 1)); }
bad() { FAILN=$((FAILN + 1)); printf 'FAIL: %s\n' "$*" >&2; }
assert_eq() { [ "$1" = "$2" ] && ok || bad "$3 (expected=$2 actual=$1)"; }
sha() { sha256sum "$1" | awk '{print $1}'; }

TASKS="$TMP/tasks"
mkdir -p "$TASKS/synthetic/repo"
printf 'baseline\n' > "$TASKS/synthetic/repo/input.txt"
cat > "$TASKS/synthetic/task.md" <<'EOF'
# Synthetic task

Create `expected.txt` containing exactly `fixed` followed by a newline. Do not edit `input.txt`.
EOF
cat > "$TASKS/synthetic/oracle.sh" <<'EOF'
#!/usr/bin/env bash
set -u
if [ -f expected.txt ] && [ "$(cat expected.txt)" = "fixed" ] && [ "$(cat input.txt)" = "baseline" ]; then
  echo "STATUS: PASS"
  exit 0
fi
echo "STATUS: FAIL"
exit 1
EOF
chmod +x "$TASKS/synthetic/oracle.sh"

MANIFEST="$TMP/tasks.json"
TASK_SHA="$(sha "$TASKS/synthetic/task.md")"
ORACLE_SHA="$(sha "$TASKS/synthetic/oracle.sh")"
cat > "$MANIFEST" <<EOF
{"schema_version":1,"pack_sha256":"3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca","tasks":[{"id":"synthetic","path":"synthetic","task_sha256":"$TASK_SHA","oracle_sha256":"$ORACLE_SHA","verify_cmd":["bash","oracle.sh"]}]}
EOF

common=(--test-mode --manifest "$MANIFEST" --tasks-root "$TASKS" --pack "$PACK" \
  --engine test-engine --effort high --reviewer-runner claude-native --reviewer-model stub-reviewer \
  --reviewer-effort high --codex-bin "$STUB" --reviewer-cmd "$STUB" --seed 424242 \
  --capability-store "$TMP/capability" --root-run-id mechanics-root)

OUT="$TMP/matrix.jsonl"
SEED_FILE="$TMP/matrix.seed"
PRIVATE="$TMP/private"
CAPTURE="$TMP/capture"
mkdir -p "$CAPTURE"
: > "$CAPTURE/model-calls.log"
STUB_REQUIRE_EOF_STDIN=1 STUB_CAPTURE_DIR="$CAPTURE" bash "$RUNNER" "${common[@]}" --out "$OUT" --seed-file "$SEED_FILE" \
  --private-root "$PRIVATE" > "$TMP/run.stdout" 2> "$TMP/run.stderr"
rc=$?
assert_eq "$rc" "0" "happy matrix exits zero"
assert_eq "$(wc -l < "$OUT" | tr -d ' ')" "2" "paired matrix writes two terminal rows"
assert_eq "$(cat "$SEED_FILE")" "424242" "seed persisted exactly"
assert_eq "$(node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.stdout.write(String(r.every(x=>x.status==="completed"&&x.oracle_pass===true)))' "$OUT")" "true" "both cells independently pass frozen oracle"
assert_eq "$(node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.stdout.write(String(r.every(x=>x.dispatcher_called===true&&x.model_calls===1)))' "$OUT")" "true" "rows preserve canonical dispatch-effect metadata"
assert_eq "$(node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.stdout.write(String(new Set(r.map(x=>x.prompt_sha256)).size))' "$OUT")" "1" "both arms bind identical base prompt bytes"

BASE_PROMPT="$(find "$PRIVATE/cells" -name prompt.md | head -1)"
cmp -s "$CAPTURE/nopack.prompt" "$BASE_PROMPT" && ok || bad "nopack did not receive exact base prompt"
EXPECTED_PACK="$TMP/expected-pack.prompt"
{
  printf '%s\n' '=== SKILL: implementer-pack ==='
  cat "$PACK"
  printf '\n=== END SKILL ===\n\n'
  cat "$BASE_PROMPT"
} > "$EXPECTED_PACK"
cmp -s "$CAPTURE/pack.prompt" "$EXPECTED_PACK" && ok || bad "pack arm differs from canonical envelope + frozen pack + base prompt"
assert_eq "$(wc -l < "$CAPTURE/model-calls.log" | tr -d ' ')" "2" "canonical rail invoked fake model exactly twice"

REP="$TMP/report.json"
node "$REPORT" --in "$OUT" --expected-pairs 1 --json > "$REP"
assert_eq "$?" "0" "complete report exits zero"
assert_eq "$(node -e 'const r=require(process.argv[1]);process.stdout.write(r.decision)' "$REP")" "h1_confirmed_keep_off" "D=0 applies frozen H1 decision"
assert_eq "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.valid_pairs))' "$REP")" "1" "one valid pair reported"

# Direct decision-math fixture: two valid pairs, D=+2, comparable cost 1.2 => surprise rule.
MATH="$TMP/math.jsonl"
node - "$MATH" <<'NODE'
const fs=require('fs'); const rows=[];
for(const task of ['a','b']) for(const arm of ['nopack','pack']) rows.push({
  cell_key:`test-engine|${arm}|${task}`,engine:'test-engine',runner:'codex',effort:'high',task,arm,
  reviewer_runner:'claude-native',reviewer_model:'stub-reviewer',reviewer_effort:'high',seed:7,status:'completed',
  defect_fingerprints:arm==='nopack'?[`oracle:${task}`]:[],usage:{input_tokens:arm==='pack'?110:100,cache_read_input_tokens:0,output_tokens:arm==='pack'?10:0}
});
fs.writeFileSync(process.argv[2],rows.map(JSON.stringify).join('\n')+'\n');
NODE
node "$REPORT" --in "$MATH" --expected-pairs 2 --json > "$TMP/math.json"
assert_eq "$(node -e 'const r=require(process.argv[1]);process.stdout.write(r.decision)' "$TMP/math.json")" "h1_refuted_open_followup" "D=2 and cost=1.2 fires surprise rule"
node -e 'const fs=require("fs"),f=process.argv[1];const r=fs.readFileSync(f,"utf8").trim().split("\n").map(JSON.parse);r.find(x=>x.arm==="pack").usage=null;fs.writeFileSync(f,r.map(JSON.stringify).join("\n")+"\n")' "$MATH"
node "$REPORT" --in "$MATH" --expected-pairs 2 --json > "$TMP/math-missing.json"
assert_eq "$(node -e 'const r=require(process.argv[1]);process.stdout.write(String(r.comparable_cost_ratio_pack_over_nopack))' "$TMP/math-missing.json")" "null" "missing usage blocks comparable-cost claim"
assert_eq "$(node -e 'const r=require(process.argv[1]);process.stdout.write(r.decision)' "$TMP/math-missing.json")" "inconclusive_keep_off" "D=2 without comparable cost stays inconclusive"

# A4: terminal exact keys are never rerolled.
before_calls="$(wc -l < "$CAPTURE/model-calls.log" | tr -d ' ')"
STUB_CAPTURE_DIR="$CAPTURE" bash "$RUNNER" "${common[@]}" --out "$OUT" --seed-file "$SEED_FILE" \
  --private-root "$PRIVATE" > "$TMP/resume.stdout" 2> "$TMP/resume.stderr"
assert_eq "$?" "0" "resume exits zero"
assert_eq "$(wc -l < "$OUT" | tr -d ' ')" "2" "resume adds no rows"
assert_eq "$(wc -l < "$CAPTURE/model-calls.log" | tr -d ' ')" "$before_calls" "resume makes no model calls"

# A2/A5: perturb a bound task byte; rejection happens before any fake model invocation.
cp "$TASKS/synthetic/task.md" "$TMP/task.saved"
printf '\nperturbed\n' >> "$TASKS/synthetic/task.md"
set +e
STUB_CAPTURE_DIR="$CAPTURE" bash "$RUNNER" "${common[@]}" --out "$TMP/drift.jsonl" --seed-file "$TMP/drift.seed" \
  --private-root "$TMP/drift-private" > "$TMP/drift.stdout" 2> "$TMP/drift.stderr"
drift_rc=$?
set -e
[ "$drift_rc" -ne 0 ] && ok || bad "task-byte perturbation was accepted"
assert_eq "$(wc -l < "$CAPTURE/model-calls.log" | tr -d ' ')" "$before_calls" "task drift fails before model call"
cp "$TMP/task.saved" "$TASKS/synthetic/task.md"

# Pack drift is likewise rejected before any run directory or model effect.
BAD_PACK="$TMP/bad-pack.md"
cp "$PACK" "$BAD_PACK"
printf '\ndrift\n' >> "$BAD_PACK"
set +e
STUB_CAPTURE_DIR="$CAPTURE" bash "$RUNNER" "${common[@]}" --pack "$BAD_PACK" --out "$TMP/pack-drift.jsonl" \
  --seed-file "$TMP/pack-drift.seed" --private-root "$TMP/pack-drift-private" > /dev/null 2>&1
pack_rc=$?
set -e
[ "$pack_rc" -ne 0 ] && ok || bad "pack-byte perturbation was accepted"
assert_eq "$(wc -l < "$CAPTURE/model-calls.log" | tr -d ' ')" "$before_calls" "pack drift fails before model call"

# A7: an oracle that is green at pristine base invalidates the fixture before spend.
GREEN_TASKS="$TMP/green-tasks"
mkdir -p "$GREEN_TASKS/green/repo"
printf 'base\n' > "$GREEN_TASKS/green/repo/input.txt"
printf '# Green fixture\n' > "$GREEN_TASKS/green/task.md"
cat > "$GREEN_TASKS/green/oracle.sh" <<'EOF'
#!/usr/bin/env bash
echo "STATUS: PASS"
exit 0
EOF
chmod +x "$GREEN_TASKS/green/oracle.sh"
GREEN_MANIFEST="$TMP/green.json"
cat > "$GREEN_MANIFEST" <<EOF
{"schema_version":1,"pack_sha256":"3f29d5fd224d45ac96630e642fa9ada1f24446d538b6c2b2ed020ad3f8a7beca","tasks":[{"id":"green","path":"green","task_sha256":"$(sha "$GREEN_TASKS/green/task.md")","oracle_sha256":"$(sha "$GREEN_TASKS/green/oracle.sh")","verify_cmd":["bash","oracle.sh"]}]}
EOF
set +e
STUB_CAPTURE_DIR="$CAPTURE" bash "$RUNNER" --test-mode --manifest "$GREEN_MANIFEST" --tasks-root "$GREEN_TASKS" \
  --pack "$PACK" --engine test-engine --reviewer-runner claude-native --reviewer-model stub-reviewer \
  --reviewer-cmd "$STUB" --codex-bin "$STUB" --out "$TMP/green.jsonl" --seed-file "$TMP/green.seed" \
  --private-root "$TMP/green-private" --capability-store "$TMP/green-cap" > /dev/null 2>&1
green_rc=$?
set -e
[ "$green_rc" -ne 0 ] && ok || bad "base-green fixture was accepted"
assert_eq "$(wc -l < "$CAPTURE/model-calls.log" | tr -d ' ')" "$before_calls" "base-green fails before model call"

# Fail-closed: provider failures become terminal infra rows, and those rows are not rerolled.
FAIL_OUT="$TMP/fail.jsonl"
FAIL_CAPTURE="$TMP/fail-capture"
mkdir -p "$FAIL_CAPTURE"
: > "$FAIL_CAPTURE/model-calls.log"
STUB_IMPLEMENTER_SCENARIO=fail STUB_CAPTURE_DIR="$FAIL_CAPTURE" bash "$RUNNER" "${common[@]}" \
  --out "$FAIL_OUT" --seed-file "$TMP/fail.seed" --private-root "$TMP/fail-private" \
  --capability-store "$TMP/fail-cap" > /dev/null 2> "$TMP/fail.stderr"
assert_eq "$?" "0" "failed providers still produce resumable terminal matrix"
assert_eq "$(node -e 'const r=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);process.stdout.write(String(r.length===2&&r.every(x=>x.status==="infra_failed")))' "$FAIL_OUT")" "true" "provider failures are visible infra_failed rows"
fail_calls="$(wc -l < "$FAIL_CAPTURE/model-calls.log" | tr -d ' ')"
STUB_IMPLEMENTER_SCENARIO=success STUB_CAPTURE_DIR="$FAIL_CAPTURE" bash "$RUNNER" "${common[@]}" \
  --out "$FAIL_OUT" --seed-file "$TMP/fail.seed" --private-root "$TMP/fail-private" \
  --capability-store "$TMP/fail-cap" > /dev/null 2>&1
assert_eq "$(wc -l < "$FAIL_CAPTURE/model-calls.log" | tr -d ' ')" "$fail_calls" "infra terminal rows are not silently rerolled"
set +e
node "$REPORT" --in "$FAIL_OUT" --expected-pairs 1 --json > "$TMP/fail-report.json"
fail_report_rc=$?
set -e
assert_eq "$fail_report_rc" "0" "structurally complete infra report exits zero"
assert_eq "$(node -e 'const r=require(process.argv[1]);process.stdout.write(r.decision)' "$TMP/fail-report.json")" "no_capability_verdict" "infra pair yields no capability verdict"

printf 'implementer-matrix-mechanics: PASS=%s FAIL=%s\n' "$PASS" "$FAILN"
[ "$FAILN" -eq 0 ]
