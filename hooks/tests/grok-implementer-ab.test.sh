#!/usr/bin/env bash
# Deterministic D8 harness regression: cap/open semantics, provenance, and acceptance.
. "$(dirname "$0")/lib.sh"

RUNNER="$REPO_ROOT/scripts/run-grok-implementer-ab.sh"
BASE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD^)"
CANDIDATE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
FAKE_BIN="$TEST_TMP/fake-bin"
DISPATCH_STUB="$TEST_TMP/fake-dispatch.sh"
COUNTER="$TEST_TMP/attempts.txt"
VIOLATION="$TEST_TMP/over-budget"
mkdir -p "$FAKE_BIN"
printf '0\n' > "$COUNTER"

cat > "$FAKE_BIN/grok" <<'EOF_GROK'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf 'grok-test 0.0.1\n'
  exit 0
fi
exit 1
EOF_GROK
chmod +x "$FAKE_BIN/grok"

cat > "$DISPATCH_STUB" <<'EOF_DISPATCH'
#!/usr/bin/env bash
counter_file="${GROK_AB_TEST_COUNTER:?}"
violation_file="${GROK_AB_TEST_VIOLATION:?}"
n="$(cat "$counter_file")"
n=$((n + 1))
printf '%s\n' "$n" > "$counter_file"
if [ "$n" -gt 120 ]; then
  : > "$violation_file"
fi
model=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--model' ]; then model="$2"; shift 2; continue; fi
  shift
done
runner='grok'
provider="provider-$n"
mode="${GROK_AB_TEST_MODE:-failure}"
case "$mode" in
  success|bad-acceptance|bad-whitespace)
    mkdir -p docs
    if [ "$mode" = bad-whitespace ]; then
      printf 'fixture %s  \n' "$n" > "docs/grok-ab-$n.md"
    else
      printf 'fixture %s\n' "$n" > "docs/grok-ab-$n.md"
    fi
    git add "docs/grok-ab-$n.md"
    git -c user.email=grok-ab-test@example.invalid \
      -c user.name='Grok AB Test' commit -qm "fixture attempt $n"
    printf '{"status":"committed","runner":"%s","model":"%s","provider_session_id":"%s","commit":"%s","files_changed":1,"model_calls":1,"error":null}\n' \
      "$runner" "$model" "$provider" "$(git rev-parse HEAD)"
    ;;
  bad-provenance)
    mkdir -p docs
    printf 'fixture %s\n' "$n" > "docs/grok-ab-$n.md"
    git add "docs/grok-ab-$n.md"
    git -c user.email=grok-ab-test@example.invalid \
      -c user.name='Grok AB Test' commit -qm "fixture attempt $n"
    printf '{"status":"committed","runner":"wrong-runner","model":"wrong-model","provider_session_id":null,"commit":"%s","files_changed":1,"model_calls":1,"error":null}\n' \
      "$(git rev-parse HEAD)"
    ;;
  *)
    printf '{"status":"failure","runner":"%s","model":"%s","provider_session_id":"%s","commit":null,"files_changed":0,"model_calls":1,"error":"simulated failure"}\n' \
      "$runner" "$model" "$provider"
    ;;
esac
EOF_DISPATCH
chmod +x "$DISPATCH_STUB"

make_seed() {
  local target="$1" initial="$2" max_pairs="$3" max_sessions="$4" max_retries="$5"
  node - "$target" "$initial" "$max_pairs" "$max_sessions" "$max_retries" <<'NODE'
const fs = require('fs');
const [target, initialRaw, maxPairsRaw, maxSessionsRaw, maxRetriesRaw] = process.argv.slice(2);
const initial = Number(initialRaw);
const maxPairs = Number(maxPairsRaw);
const maxSessions = Number(maxSessionsRaw);
const maxRetries = Number(maxRetriesRaw);
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  seed: 20260806,
  bootstrap_resamples: 64,
  initial_pairs: initial,
  max_pairs: maxPairs,
  max_provider_sessions: maxSessions,
  max_retries_per_arm: maxRetries,
  arms: { A: { effort: 'medium' }, B: { effort: 'high' } },
  actor: { runner: 'grok', model: 'Grok-4.5', family: 'xai' },
  primary_endpoint: 'usable_session_rate_diff',
  material_effect_pp: 10,
  quality_non_inferiority_pp: 5,
  arm_order: 'ABBA',
}, null, 2)}\n`);
NODE
}

make_tasks() {
  local target="$1" count="$2" acceptance="$3"
  node - "$target" "$count" "$acceptance" <<'NODE'
const fs = require('fs');
const [target, count, acceptance] = process.argv.slice(2);
const command = acceptance === 'pass' ? 'git diff --check' : 'false';
const tasks = Array.from({ length: Number(count) }, (_, i) => ({
  id: `t${String(i + 1).padStart(2, '0')}`,
  prompt: `deterministic D8 fixture task ${i + 1}`,
  acceptance: [command],
  max_files: 2,
}));
fs.writeFileSync(target, `${JSON.stringify({ schema_version: 1, tasks }, null, 2)}\n`);
NODE
}

run_case() {
  local name="$1" seed="$2" tasks="$3" mode="$4"
  local report="$TEST_TMP/$name.json" rc
  GROK_AB_TEST_COUNTER="$COUNTER" GROK_AB_TEST_VIOLATION="$VIOLATION" \
    GROK_AB_TEST_MODE="$mode" PATH="$FAKE_BIN:$PATH" \
    AUTOPILOT_GROK_AB_DISPATCH_BIN="$DISPATCH_STUB" \
    AUTOPILOT_GROK_AB_SCRATCH="$TEST_TMP/scratch-$name" \
    bash "$RUNNER" --tasks "$tasks" --seed "$seed" --report "$report" \
      --base-sha "$BASE_SHA" --candidate-sha "$CANDIDATE_SHA" --timeout 1s \
      >"$TEST_TMP/$name.out" 2>"$TEST_TMP/$name.err"
  rc=$?
  printf '%s\n' "$rc" > "$TEST_TMP/$name.rc"
}

# Max-pairs indeterminate must escalate (and validator must reject the report).
SEED_MAX="$TEST_TMP/seed-max.json"; TASKS_MAX="$TEST_TMP/tasks-max.json"
REPORT_MAX="$TEST_TMP/max.json"
make_seed "$SEED_MAX" 1 2 4 0
make_tasks "$TASKS_MAX" 2 pass
run_case max "$SEED_MAX" "$TASKS_MAX" failure
assert_eq "1" "$(cat "$TEST_TMP/max.rc")" "max-pairs indeterminate exits nonzero"
assert_eq "indeterminate" "$(jq -r '.decision' "$REPORT_MAX" 2>/dev/null)" \
  "max-pairs report remains indeterminate"
assert_eq "4" "$(jq -r '.provider_sessions' "$REPORT_MAX" 2>/dev/null)" \
  "max-pairs consumes exactly its reserved attempts"
set +e
node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" --report "$REPORT_MAX" \
  --seed "$SEED_MAX" --tasks "$TASKS_MAX" >"$TEST_TMP/max.validate.out" 2>&1
VALIDATE_MAX_RC=$?
assert_neq "0" "$VALIDATE_MAX_RC" "validator rejects max-pairs indeterminate report"
assert_contains "$(cat "$TEST_TMP/max.validate.out")" "indeterminate result remains open" \
  "validator names open indeterminate state"

# A failing provider with six retries may approach the global ceiling, but never
# starts attempt 121. Missing arms and retry-cap exhaustion stay open.
SEED_CAP="$TEST_TMP/seed-cap.json"; TASKS_CAP="$TEST_TMP/tasks-cap.json"
REPORT_CAP="$TEST_TMP/cap.json"
make_seed "$SEED_CAP" 60 60 120 6
make_tasks "$TASKS_CAP" 60 pass
printf '0\n' > "$COUNTER"
run_case cap "$SEED_CAP" "$TASKS_CAP" failure
assert_eq "1" "$(cat "$TEST_TMP/cap.rc")" "global ceiling failure remains non-success"
assert_eq "120" "$(cat "$COUNTER")" "global ceiling starts no more than 120 attempts"
assert_file_absent "$VIOLATION" "global ceiling never starts attempt 121"
assert_eq "120" "$(jq -r '.session_attempts_started' "$REPORT_CAP" 2>/dev/null)" \
  "report records the global attempt counter"
assert_contains "$(jq -c '.open_reasons' "$REPORT_CAP" 2>/dev/null)" "retry_cap_exhausted" \
  "retry-cap exhaustion remains open"

# A committed arm with a failing declared acceptance command is unusable and
# cannot contribute to quality acceptance.
SEED_ACCEPT="$TEST_TMP/seed-accept.json"; TASKS_ACCEPT="$TEST_TMP/tasks-accept.json"
REPORT_ACCEPT="$TEST_TMP/accept.json"
make_seed "$SEED_ACCEPT" 1 1 2 0
make_tasks "$TASKS_ACCEPT" 1 fail
printf '0\n' > "$COUNTER"
run_case accept "$SEED_ACCEPT" "$TASKS_ACCEPT" bad-acceptance
assert_eq "1" "$(cat "$TEST_TMP/accept.rc")" "failing acceptance leaves run open"
assert_eq "false" "$(jq -r '.pair_results[0].arms.A.acceptance_ok' "$REPORT_ACCEPT" 2>/dev/null)" \
  "failing acceptance is recorded"
assert_eq "false" "$(jq -r '.pair_results[0].arms.A.quality_accepted' "$REPORT_ACCEPT" 2>/dev/null)" \
  "failing acceptance cannot be quality accepted"

# A real committed trailing-whitespace patch must fail the bound acceptance.
# A clean checkout of the produced commit would make plain `git diff --check`
# pass; the runner must check the task-base..commit patch instead.
SEED_WS="$TEST_TMP/seed-whitespace.json"; TASKS_WS="$TEST_TMP/tasks-whitespace.json"
REPORT_WS="$TEST_TMP/whitespace.json"
make_seed "$SEED_WS" 1 1 2 0
make_tasks "$TASKS_WS" 1 pass
printf '0\n' > "$COUNTER"
run_case whitespace "$SEED_WS" "$TASKS_WS" bad-whitespace
assert_eq "1" "$(cat "$TEST_TMP/whitespace.rc")" "bound whitespace acceptance leaves run open"
assert_eq "false" "$(jq -r '.pair_results[0].arms.A.acceptance_ok' "$REPORT_WS" 2>/dev/null)" \
  "bound acceptance rejects committed trailing whitespace"
assert_eq "true" "$(jq -r '.pair_results[0].arms.A.acceptance_bound' "$REPORT_WS" 2>/dev/null)" \
  "acceptance records a task-base..commit binding"
assert_contains "$(jq -c '.pair_results[0].arms.A.acceptance_results[0].bound_command' "$REPORT_WS" 2>/dev/null)" \
  "git" "acceptance records the bound Git command"

# Missing/fabricated dispatch provenance is rejected even when the wrapper commits.
SEED_PROV="$TEST_TMP/seed-prov.json"; TASKS_PROV="$TEST_TMP/tasks-prov.json"
REPORT_PROV="$TEST_TMP/prov.json"
make_seed "$SEED_PROV" 1 1 2 0
make_tasks "$TASKS_PROV" 1 pass
printf '0\n' > "$COUNTER"
run_case prov "$SEED_PROV" "$TASKS_PROV" bad-provenance
assert_eq "1" "$(cat "$TEST_TMP/prov.rc")" "bad provenance leaves run open"
assert_eq "false" "$(jq -r '.pair_results[0].arms.A.provenance_ok' "$REPORT_PROV" 2>/dev/null)" \
  "bad provenance is recorded"
set +e
node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" --report "$REPORT_PROV" \
  --seed "$SEED_PROV" --tasks "$TASKS_PROV" >"$TEST_TMP/prov.validate.out" 2>&1
VALIDATE_PROV_RC=$?
assert_neq "0" "$VALIDATE_PROV_RC" "validator rejects bad provenance"
assert_contains "$(cat "$TEST_TMP/prov.validate.out")" "dispatch provenance" \
  "validator names provenance failure"

# Positive deterministic control proves the resolved provenance and acceptance
# path can produce a valid terminal report.
SEED_OK="$TEST_TMP/seed-ok.json"; TASKS_OK="$TEST_TMP/tasks-ok.json"
REPORT_OK="$TEST_TMP/ok.json"
make_seed "$SEED_OK" 1 1 2 0
make_tasks "$TASKS_OK" 1 pass
printf '0\n' > "$COUNTER"
run_case ok "$SEED_OK" "$TASKS_OK" success
assert_eq "0" "$(cat "$TEST_TMP/ok.rc")" "valid provenance and acceptance close run"
VALIDATE_OK_OUT="$(node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" \
  --report "$REPORT_OK" --seed "$SEED_OK" --tasks "$TASKS_OK" 2>&1)"
assert_contains "$VALIDATE_OK_OUT" "ok decision=no-change" "validator accepts valid terminal report"

# Frozen digests are mandatory, not optional report decoration.
node - "$REPORT_OK" <<'NODE'
const fs = require('fs');
const [target] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
delete report.seed_digest;
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
DIGEST_OUT="$(node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" \
  --report "$REPORT_OK" --seed "$SEED_OK" --tasks "$TASKS_OK" 2>&1)"
DIGEST_RC=$?
assert_neq "0" "$DIGEST_RC" "validator rejects missing frozen digest"
assert_contains "$DIGEST_OUT" "seed_digest is required" "validator names the required seed digest"

# Exclusions are pre-run schema records only; post-hoc/arbitrary reasons fail.
node - "$REPORT_OK" <<'NODE'
const fs = require('fs');
const [target] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
report.seed_digest = require('crypto').createHash('sha256')
  .update(fs.readFileSync(process.argv[3] || 'evals/grok-implementer-ab/seed.json')).digest('hex');
report.exclusions = [{ task_id: 't01', reason: 'post_hoc', phase: 'runtime', schema_valid: true }];
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
EXCLUSION_OUT="$(node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" \
  --report "$REPORT_OK" --seed "$SEED_OK" --tasks "$TASKS_OK" 2>&1)"
EXCLUSION_RC=$?
assert_neq "0" "$EXCLUSION_RC" "validator rejects arbitrary exclusions"
assert_contains "$EXCLUSION_OUT" "pre-run invalid-task/infra reasons" \
  "validator names the exclusion schema"

# Build a structurally valid 60-pair report, then mutate the extension order;
# this exercises the frozen initial+extension sequence without live providers.
FABRICATED="$TEST_TMP/fabricated-60.json"
node - "$FABRICATED" "$REPO_ROOT" "$BASE_SHA" "$CANDIDATE_SHA" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const [target, repo, baseSha, candidateSha] = process.argv.slice(2);
const seedPath = `${repo}/evals/grok-implementer-ab/seed.json`;
const tasksPath = `${repo}/evals/grok-implementer-ab/tasks.json`;
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8')).tasks;
const ids = tasks.filter((task) => !task.extension).slice(0, seed.initial_pairs)
  .concat(tasks.filter((task) => task.extension === true).slice(0, seed.max_pairs - seed.initial_pairs))
  .map((task) => task.id);
const commitSha = baseSha;
const arm = (index, side) => ({
  effort: side === 'A' ? 'medium' : 'high', status: 'committed', commit: commitSha,
  files_changed: 1, wrapper_commit: true, toolFailure: 0, usable_session: true,
  quality_accepted: true, acceptance_ok: true, acceptance_bound: true,
  acceptance_base_sha: candidateSha, acceptance_commit_sha: commitSha,
  acceptance_results: [{ command: 'git diff --check', bound_command: ['git', 'diff', '--check', `${candidateSha}..${commitSha}`], base_sha: candidateSha, commit_sha: commitSha, exit: 0 }],
  acceptance_error: null, provenance_ok: true, runner: 'grok', model: 'grok-4.5',
  provider_session_id: `fabricated-${index}-${side}`, runner_version: 'grok-test',
  provider_version: 'grok-test', retries: 0, retry_exhausted: false,
});
const pairs = ids.map((id, index) => ({ task_id: id, arms: { A: arm(index, 'A'), B: arm(index, 'B') }, order: ['A', 'B'], sessions: 2 }));
const report = {
  schema_version: 1, mode: 'live', base_ref: baseSha, candidate_ref: candidateSha,
  base_sha: baseSha, candidate_sha: candidateSha, seed: seed.seed,
  seed_digest: crypto.createHash('sha256').update(fs.readFileSync(seedPath)).digest('hex'),
  tasks_digest: crypto.createHash('sha256').update(fs.readFileSync(tasksPath)).digest('hex'),
  actor: seed.actor, runner: 'grok', model: 'grok-4.5', runner_version: 'grok-test', provider_version: 'grok-test',
  arms: seed.arms, pairs: 60, provider_sessions: 120, session_attempts_started: 120,
  exclusions: [], retries_per_arm: { A: 0, B: 0 }, max_provider_sessions: 120,
  endpoint_pp: { low: 0, high: 0, mean: 0 }, quality_pp: { low: 0, high: 0, mean: 0 },
  decision: 'no-change', open_reasons: [], material_effect_pp: 10, quality_non_inferiority_pp: 5,
  bootstrap_resamples: 64, pair_results: pairs,
};
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
SIXTY_VALID_OUT="$(node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" \
  --report "$FABRICATED" 2>&1)"
SIXTY_VALID_RC=$?
assert_eq "0" "$SIXTY_VALID_RC" "validator accepts exact frozen 60-pair sequence"
node - "$FABRICATED" <<'NODE'
const fs = require('fs');
const [target] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
report.pair_results[30].task_id = 't30';
report.pair_results[31].task_id = 't60';
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
SEQUENCE_OUT="$(node "$REPO_ROOT/scripts/validate-grok-implementer-ab.js" \
  --report "$FABRICATED" 2>&1)"
SEQUENCE_RC=$?
assert_neq "0" "$SEQUENCE_RC" "validator rejects duplicate or reordered extension tasks"
assert_contains "$SEQUENCE_OUT" "frozen initial/extension sequence" \
  "validator names the frozen task sequence"

finalize_test
