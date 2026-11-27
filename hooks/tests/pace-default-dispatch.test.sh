#!/usr/bin/env bash
# Real rails with sentinel PATH: quota selection, caller pins and manifest evidence.
. "$(dirname "$0")/lib.sh"
install_cli_sentinels
# Drop inherited quota/token-seat selectors so the fixture exercises defaults.
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_ENDPOINT_GLM_TRANSPORT \
  AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN \
  AUTOPILOT_ENDPOINT_GLM_LOCAL_URL AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN
export AUTOPILOT_ENDPOINTS_ENV=/nonexistent
export AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_PACE_FILE="$REPO_ROOT/scripts/fixtures/pace-select/quota-default.json"
export AUTOPILOT_GROK_PROBE=off
# Preflight skips codex when ~/.codex/auth.json is missing. The test HOME is empty, so plant a fixture auth or the quota winner never runs.
mkdir -p "$HOME/.codex"
printf '{}\n' > "$HOME/.codex/auth.json"
export AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session"
export DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 DISPATCH_QUIET=1
export PACE_SENTINEL_LOG="$TEST_TMP/sentinel.log"
mkdir -p "$TEST_TMP/bin" "$AUTOPILOT_DISPATCH_RUNS_DIR"
for runner in codex grok; do
  cp "$REPO_ROOT/scripts/fixtures/pace-select/runner.sh" "$TEST_TMP/bin/$runner"
  chmod +x "$TEST_TMP/bin/$runner"
done
export PATH="$TEST_TMP/bin:$PATH"
printf 'Size: M\nRole: author\nScope: scripts/example.js\nWrite a short result.\n' > "$TEST_TMP/brief"
printf 'diff --git a/example.js b/example.js\n--- a/example.js\n+++ b/example.js\n@@ -1 +1 @@\n-old\n+new\n' > "$TEST_TMP/diff"
for rail in author review; do
  args=(--prompt-file "$TEST_TMP/brief")
  [ "$rail" != review ] || args=(--diff-file "$TEST_TMP/diff" --spec-file "$TEST_TMP/brief")
  bash "$REPO_ROOT/scripts/dispatch-$rail.sh" "${args[@]}" --timeout 10s --run-id "pace-$rail" > "$TEST_TMP/$rail.out" 2> "$TEST_TMP/$rail.err"
  assert_eq 0 "$?" "$rail automatic selection exits 0"
  assert_contains "$(cat "$TEST_TMP/$rail.err")" 'pace: chose codex' "$rail chooses codex by default"
  assert_contains "$(cat "$TEST_TMP/$rail.err")" 'grok: over_ceiling' "$rail names over-ceiling grok"
  mf="$AUTOPILOT_DISPATCH_RUNS_DIR/pace-$rail.manifest.json"
  result="$(node -e 'const m=require(process.argv[1]); const p=m.pace_choice; console.log(p && p.engine === "codex" && p.used_pct === 13 && !!p.reset_at && p.runner_up === "agy" && !!p.reason ? "ok" : JSON.stringify(m))' "$mf" 2>/dev/null)"
  assert_eq ok "$result" "$rail manifest records pace_choice"
  bash "$REPO_ROOT/scripts/dispatch-$rail.sh" "${args[@]}" --runner grok --model grok-4.7 --effort high --timeout 10s > "$TEST_TMP/$rail-named.out" 2> "$TEST_TMP/$rail-named.err"
  assert_eq 0 "$?" "$rail named grok dispatch succeeds"
  assert_contains "$(cat "$TEST_TMP/$rail-named.err")" 'grok is at 93% of its 7-day window' "$rail warning includes quota"
  assert_contains "$(cat "$TEST_TMP/$rail-named.err")" 'named by caller, dispatching anyway — codex has 87% left' "$rail named warning suggests codex"
done
assert_contains "$(cat "$PACE_SENTINEL_LOG" 2>/dev/null)" 'grok ' 'named grok actually reaches sentinel'
# Strict contracts pin the tuple too, but still report fresh over-ceiling usage.
node - "$REPO_ROOT/scripts/dispatch-hetero.sh" "$TEST_TMP/strict-pace.sh" <<'NODE_STRICT'
const fs=require('node:fs'); const s=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync(process.argv[3], s.slice(s.indexOf('# Pace is the default only'), s.indexOf('# Saved before skill-pack')));
NODE_STRICT
(
  STRICT_CONTRACT=1 RUNNER_SUPPLIED=0 MODEL_SUPPLIED=0 ENDPOINT_SUPPLIED=0
  RUNNER=grok MODEL=grok-4.7 ENDPOINT='' PACE_ROLE=implementer
  PROMPT_FILE="$TEST_TMP/brief" SELF_DIR="$REPO_ROOT/scripts"
  die_precondition() { echo "$*" >&2; exit 2; }
  . "$TEST_TMP/strict-pace.sh"
  printf '%s|%s\n' "$RUNNER" "$MODEL"
) > "$TEST_TMP/strict.out" 2> "$TEST_TMP/strict.err"
assert_eq "$(cat "$TEST_TMP/strict.out")" 'grok|grok-4.7' 'strict contract keeps its runner and model'
assert_contains "$(cat "$TEST_TMP/strict.err")" 'named by caller, dispatching anyway' 'strict contract emits named quota warning'
# Exercise the actual reviewer retreat function without starting a review worker.
node - "$REPO_ROOT/scripts/dispatch-review.sh" "$TEST_TMP/picker.sh" <<'NODE_PICKER'
const fs=require('node:fs'); const s=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync(process.argv[3], s.slice(s.indexOf('family_guard_select() {'), s.indexOf('\n\ndie_precondition() {')));
NODE_PICKER
(
  . "$TEST_TMP/picker.sh"
  family_guard_bind() { :; }
  _REVIEW_SELF_DIR="$REPO_ROOT/scripts"
  IMPLEMENTER_FAMILY=google RUNNER=grok MODEL=grok-4.7 SPEC_FILE="$TEST_TMP/brief" DIFF_FILE="$TEST_TMP/diff"
  family_guard_select '' '' '' '{}'
  printf '%s|%s|%s\n' "$_FG_RUNNER" "$_FG_ENGINE" "$_FG_PACE_CHOICE_JSON"
) > "$TEST_TMP/pick.out" 2> "$TEST_TMP/pick.err"
assert_eq "$?" 0 'reviewer default retreat selects by pace'
assert_contains "$(cat "$TEST_TMP/pick.out")" 'codex|gpt-6.1-terra|' 'reviewer retreat uses a different family and excludes failed seat'

# Hetero uses a fixture repo; the real rail commits the sentinel edit and verifies it.
repo="$TEST_TMP/repo"
mkdir -p "$repo"
git -C "$repo" init -q -b develop
git -C "$repo" -c user.name=test -c user.email=test@example.com commit -qm base --allow-empty
cat >> "$TEST_TMP/brief" <<'BRIEF'

## Acceptance
```bash
test -f quota-sentinel.txt
```
BRIEF
cat > "$TEST_TMP/bin/codex-impl" <<'SENTINEL'
#!/usr/bin/env bash
case "$*" in
  *'exec --help'*) printf '%s\n' '--dangerously-bypass-approvals-and-sandbox' '--dangerously-bypass-hook-trust'; exit 0 ;;
  *'--version'*) echo 'codex-cli 9.9.9 (test stub)'; exit 0 ;;
esac
printf codex >> "${PACE_SENTINEL_LOG:?}"
printf 'quota selected\n' > quota-sentinel.txt
SENTINEL
chmod +x "$TEST_TMP/bin/codex-impl"
(cd "$repo" && bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch feat/pace --prompt-file "$TEST_TMP/brief" --codex-bin "$TEST_TMP/bin/codex-impl" --run-id pace-hetero) > "$TEST_TMP/hetero.out" 2> "$TEST_TMP/hetero.err"
assert_eq "$?" 0 'hetero automatic choice runs acceptance and commits'
assert_contains "$(cat "$TEST_TMP/hetero.err")" 'pace: chose codex' 'hetero is default on'
result="$(node -e 'const m=require(process.argv[1]); console.log(m.pace_choice?.engine)' "$AUTOPILOT_DISPATCH_RUNS_DIR/pace-hetero.manifest.json" 2>/dev/null)"
assert_eq "$result" codex 'hetero manifest records pace_choice'

# Missing telemetry leaves the unpinned cheap default (grok-4.7, low) intact and returns success.
cat > "$TEST_TMP/grok-default" <<'SENTINEL'
#!/usr/bin/env bash
case " $* " in
  *" __autopilot_probe__ "*)
    echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: xhigh, high, medium, low" >&2
    exit 2 ;;
esac
if [ "${1:-}" = "--version" ]; then echo "grok-cli 0.2.111 (test stub)"; exit 0; fi
printf 'default grok\n' > quota-sentinel.txt
SENTINEL
chmod +x "$TEST_TMP/grok-default"
(cd "$repo" && AUTOPILOT_PACE_FILE="$TEST_TMP/missing-pace.json" bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch feat/no-pace --prompt-file "$TEST_TMP/brief" --grok-bin "$TEST_TMP/grok-default") > "$TEST_TMP/missing.out" 2> "$TEST_TMP/missing.err"
assert_eq "$?" 0 'missing pace dispatch exits 0 with the cheap default'
assert_contains "$(cat "$TEST_TMP/missing.err")" 'pace_unknown' 'missing telemetry fallback is visible'
assert_contains "$(cat "$TEST_TMP/missing.out")" '"runner": "grok"' 'missing telemetry lands on the grok default'
assert_contains "$(cat "$TEST_TMP/missing.out")" '"model": "grok-4.7"' 'missing telemetry default model is grok-4.7'
# The operator rule refuses GLM when the author dispatch works in this private repo.
printf 'Size: S\nScope: docs/example.md\nWrite a public documentation note.\n' > "$TEST_TMP/small-brief"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-fixture"
seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"
AUTOPILOT_ENDPOINT_GLM_URL=https://fixture.invalid/v1 AUTOPILOT_ENDPOINT_GLM_TOKEN=fixture-only \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --runner cc-shim --model glm-5.3 --endpoint glm \
    --prompt-file "$TEST_TMP/small-brief" --bin "$TEST_TMP/bin/grok" --timeout 10s \
    > "$TEST_TMP/author-role.out" 2> "$TEST_TMP/author-role.err"
AUTHOR_RC=$?
assert_eq "$AUTHOR_RC" 2 'restricted GLM author dispatch is refused in the private repo'
assert_contains "$(cat "$TEST_TMP/author-role.out")$(cat "$TEST_TMP/author-role.err")" 'restricted_operator_not_public_source' 'author result names the undeclared-tier refusal'
# Retry the actual agy retreat function with a sentinel child and fixture policy.
# Original argv intentionally has no runner/model: the automatic choice must be pinned on retry.
mkdir -p "$TEST_TMP/retry-tools/lib"
ln -s "$REPO_ROOT/scripts/lib/seat-fallback.js" "$TEST_TMP/retry-tools/lib/seat-fallback.js"
ln -s "$REPO_ROOT/scripts/pace-select.js" "$TEST_TMP/retry-tools/pace-select.js"
printf '#!/usr/bin/env bash\necho quota_exhausted\n' > "$TEST_TMP/retry-tools/engine-capability-state.js"
cat > "$TEST_TMP/retry-tools/resolve-review-loop.sh" <<'POLICY'
#!/usr/bin/env bash
printf '{"reviewer_runner":"agy","reviewer_engine":"gemini-4-carbon-high","reviewer_on_engine_unavailable":"cloud-fallback"}\n'
POLICY
chmod +x "$TEST_TMP/retry-tools/engine-capability-state.js" "$TEST_TMP/retry-tools/resolve-review-loop.sh"
node - "${PACE_RETRY_SOURCE:-$REPO_ROOT/scripts/dispatch-review.sh}" "$TEST_TMP/retreat.sh" <<'NODE_RETREAT'
const fs=require('node:fs'); const s=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync(process.argv[3], s.slice(s.indexOf('agy_post_failure_retreat() {'), s.indexOf('\nemit_no_verdict() {')));
NODE_RETREAT
cat > "$TEST_TMP/retry-child" <<'CHILD'
#!/usr/bin/env bash
node -e 'const fs=require("node:fs"); fs.writeFileSync(process.env.PACE_TEST_TMP+"/retry-args.json", JSON.stringify(process.argv.slice(1))); fs.writeFileSync(process.env.PACE_TEST_TMP+"/retry-log.json", process.env.AUTOPILOT_AGY_RETREAT_LOG_ROW); console.log(JSON.stringify({status:"reviewed", runner:"codex", model:"gpt-6.1-sol"}));' -- "$@"
CHILD
chmod +x "$TEST_TMP/retry-child"
PACE_TEST_TMP="$TEST_TMP" bash -c '
  . "$PACE_TEST_TMP/picker.sh"
  . "$PACE_TEST_TMP/retreat.sh"
  family_guard_bind() { :; }
  passive_capture() { :; }
  record_dispatch_usage() { :; }
  _REVIEW_SELF_DIR="$PACE_TEST_TMP/retry-tools"
  IMPLEMENTER_FAMILY=google RUNNER=agy MODEL=gemini-4-carbon-high ENDPOINT=""
  SPEC_FILE="$PACE_TEST_TMP/brief" DIFF_FILE="$PACE_TEST_TMP/diff" RAW_LOG="$PACE_TEST_TMP/brief"
  ORIG_ARGS=(--diff-file "$DIFF_FILE" --run-id pace-retreat)
  agy_post_failure_retreat
  exit 79
' "$TEST_TMP/retry-child" > "$TEST_TMP/retry.out" 2> "$TEST_TMP/retry.err"
retry_rc=$?
[ "$retry_rc" -eq 0 ] || cat "$TEST_TMP/retry.err" >&2
assert_eq "$retry_rc" 0 'automatic reviewer reaches the retry child'
result="$(node -e 'const a=require(process.argv[1]); console.log(a[a.indexOf("--runner")+1] === "codex" && a[a.indexOf("--model")+1] === "gpt-6.1-terra" ? "ok" : JSON.stringify(a));' "$TEST_TMP/retry-args.json")"
assert_eq "$result" ok 'retry pins the chosen runner and model when original flags were absent'
AUTOPILOT_AGY_REVIEW_RETREATED=1 AUTOPILOT_AGY_RETREAT_LOG_ROW="$(cat "$TEST_TMP/retry-log.json")" \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --runner codex --model gpt-6.1-sol --diff-file "$TEST_TMP/diff" \
    --run-id pace-retreat-child --bin "$TEST_TMP/bin/codex" --timeout 10s > "$TEST_TMP/retry-review.out" 2> "$TEST_TMP/retry-review.err"
assert_eq "$?" 0 'review retry completes through the real rail'
result="$(node -e 'const m=require(process.argv[1]); console.log(m.pace_choice?.engine);' "$AUTOPILOT_DISPATCH_RUNS_DIR/pace-retreat-child.manifest.json")"
assert_eq "$result" codex 'retry child retains pace_choice in its manifest'

# Empty IMPLEMENTER_FAMILY must not pass an empty --exclude-family to pace-select.
(
  . "$TEST_TMP/picker.sh"
  family_guard_bind() { :; }
  _REVIEW_SELF_DIR="$REPO_ROOT/scripts"
  IMPLEMENTER_FAMILY='' RUNNER=grok MODEL=grok-4.7 SPEC_FILE="$TEST_TMP/brief" DIFF_FILE="$TEST_TMP/diff"
  family_guard_select '' '' '' '{}'
  printf '%s|%s\n' "$_FG_RUNNER" "$_FG_ENGINE"
) > "$TEST_TMP/pick-empty.out" 2> "$TEST_TMP/pick-empty.err"
assert_eq "$?" 0 'reviewer retreat tolerates empty IMPLEMENTER_FAMILY'
assert_contains "$(cat "$TEST_TMP/pick-empty.out")" 'codex|gpt-6.1-terra' 'reviewer retreat with empty IMPLEMENTER_FAMILY picks codex'

node - "$REPO_ROOT/scripts/dispatch-review.sh" "$TEST_TMP/review-pace.sh" <<'NODE_REV_PACE'
const fs=require('node:fs'); const s=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync(process.argv[3], s.slice(s.indexOf('# Default quota choice'), s.indexOf('[[ -n "$RUNNER" ]] || die_precondition')));
NODE_REV_PACE
(
  RUNNER='' MODEL='' ENDPOINT='' SPEC_FILE="$TEST_TMP/brief" DIFF_FILE="$TEST_TMP/diff"
  IMPLEMENTER_FAMILY='' _REVIEW_SELF_DIR="$REPO_ROOT/scripts"
  family_guard_bind() { IMPLEMENTER_FAMILY=''; }
  die_precondition() { echo "$*" >&2; exit 2; }
  . "$TEST_TMP/review-pace.sh"
  printf '%s|%s|%s\n' "$RUNNER" "$MODEL" "$ENDPOINT"
) > "$TEST_TMP/rev-empty.out" 2> "$TEST_TMP/rev-empty.err"
assert_eq "$?" 0 'review default selection tolerates empty IMPLEMENTER_FAMILY'
assert_eq "$(cat "$TEST_TMP/rev-empty.out")" 'codex|gpt-6.1-terra|' 'review default selection chooses codex when IMPLEMENTER_FAMILY is empty'

# --runner auto is unpinned and uses pace selection.
(cd "$repo" && bash "$REPO_ROOT/scripts/dispatch-hetero.sh" --branch feat/pace-auto --runner auto --prompt-file "$TEST_TMP/brief" --codex-bin "$TEST_TMP/bin/codex-impl" --run-id pace-hetero-auto) > "$TEST_TMP/hetero-auto.out" 2> "$TEST_TMP/hetero-auto.err"
assert_eq "$?" 0 'hetero --runner auto runs pace selection and commits'
assert_contains "$(cat "$TEST_TMP/hetero-auto.err")" 'pace: chose codex' 'hetero --runner auto chooses codex by pace'
result="$(node -e 'const m=require(process.argv[1]); console.log(m.pace_choice?.engine)' "$AUTOPILOT_DISPATCH_RUNS_DIR/pace-hetero-auto.manifest.json" 2>/dev/null)"
assert_eq "$result" codex 'hetero --runner auto manifest records pace_choice'

# ENDPOINT without MODEL passes --named-endpoint instead of empty/default --named-model, and matches glm over minimax 0%.
node - "$REPO_ROOT/scripts/fixtures/pace-select/quota-default.json" "$TEST_TMP/glm-over-minimax-zero.json" <<'NODE_GLM'
const fs=require('node:fs');
const p=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
p.rows.push(
  { pool:'glm', class:'other', used_pct:90, expected_pct:60, stale:false, hours_to_reset:12, reset_at:'2026-11-17T12:00:00.000Z', seen_at:'2026-11-16T23:00:00Z', status:'ok' },
  { pool:'minimax', class:'other', used_pct:0, expected_pct:60, stale:false, hours_to_reset:12, reset_at:'2026-11-17T12:00:00.000Z', seen_at:'2026-11-16T23:00:00Z', status:'ok' }
);
fs.writeFileSync(process.argv[3], JSON.stringify(p));
NODE_GLM
(
  export AUTOPILOT_PACE_FILE="$TEST_TMP/glm-over-minimax-zero.json"
  export AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example.invalid/v1 AUTOPILOT_ENDPOINT_GLM_TOKEN=test-glm-token
  STRICT_CONTRACT=0 RUNNER_SUPPLIED=1 MODEL_SUPPLIED=0
  RUNNER=cc-shim MODEL='' ENDPOINT=glm PACE_ROLE=implementer
  PROMPT_FILE="$TEST_TMP/brief" SELF_DIR="$REPO_ROOT/scripts"
  die_precondition() { echo "$*" >&2; exit 2; }
  . "$TEST_TMP/strict-pace.sh"
  printf '%s|%s|%s\n' "$RUNNER" "$MODEL" "$ENDPOINT"
) > "$TEST_TMP/ep-nomodel.out" 2> "$TEST_TMP/ep-nomodel.err"
assert_eq "$?" 0 'hetero ENDPOINT without MODEL does not fail pace-select'
assert_eq "$(cat "$TEST_TMP/ep-nomodel.out")" 'cc-shim||glm' 'hetero ENDPOINT without MODEL preserves runner and endpoint'
assert_contains "$(cat "$TEST_TMP/ep-nomodel.err")" 'glm is at 90% of its 7-day window' 'hetero ENDPOINT without MODEL warns about glm even when minimax is 0%'

(
  export AUTOPILOT_PACE_FILE="$TEST_TMP/glm-over-minimax-zero.json"
  export AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example.invalid/v1 AUTOPILOT_ENDPOINT_GLM_TOKEN=test-glm-token
  STRICT_CONTRACT=0 RUNNER_SUPPLIED=1 MODEL_SUPPLIED=0
  RUNNER=auto MODEL='gemini-4-carbon-low' ENDPOINT=glm PACE_ROLE=implementer
  PROMPT_FILE="$TEST_TMP/brief" SELF_DIR="$REPO_ROOT/scripts"
  die_precondition() { echo "$*" >&2; exit 2; }
  . "$TEST_TMP/strict-pace.sh"
  printf '%s|%s|%s\n' "$RUNNER" "$MODEL" "$ENDPOINT"
) > "$TEST_TMP/auto-ep.out" 2> "$TEST_TMP/auto-ep.err"
assert_eq "$?" 0 'hetero --runner auto with ENDPOINT and no MODEL exits 0'
assert_eq "$(cat "$TEST_TMP/auto-ep.out")" 'auto|gemini-4-carbon-low|glm' 'hetero --runner auto with ENDPOINT preserves endpoint'
assert_contains "$(cat "$TEST_TMP/auto-ep.err")" 'glm is at 90% of its 7-day window' 'hetero --runner auto with ENDPOINT warns about glm'

# Caller-supplied --endpoint is preserved in dispatch-author and dispatch-review when --runner/--model are absent.
node - "$REPO_ROOT/scripts/dispatch-author.sh" "$TEST_TMP/author-pace.sh" <<'NODE_AUTH_PACE'
const fs=require('node:fs'); const s=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync(process.argv[3], s.slice(s.indexOf('# Default quota choice'), s.indexOf('[[ -n "$RUNNER" ]] || die_precondition')));
NODE_AUTH_PACE
for rail in review author; do
  (
    export AUTOPILOT_PACE_FILE="$TEST_TMP/glm-over-minimax-zero.json"
    export AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example.invalid/v1 AUTOPILOT_ENDPOINT_GLM_TOKEN=test-glm-token
    RUNNER='' MODEL='' ENDPOINT='glm' PROMPT_FILE="$TEST_TMP/brief" SPEC_FILE="$TEST_TMP/brief" DIFF_FILE="$TEST_TMP/diff"
    IMPLEMENTER_FAMILY=google _REVIEW_SELF_DIR="$REPO_ROOT/scripts" _AUTHOR_SELF_DIR="$REPO_ROOT/scripts"
    family_guard_bind() { :; }
    die_precondition() { echo "$*" >&2; exit 2; }
    . "$TEST_TMP/$rail-pace.sh"
    printf '%s|%s|%s\n' "$RUNNER" "$MODEL" "$ENDPOINT"
  ) > "$TEST_TMP/$rail-ep-only.out" 2> "$TEST_TMP/$rail-ep-only.err"
  assert_eq "$?" 0 "$rail pace block with caller --endpoint exits 0"
  assert_eq "$(cat "$TEST_TMP/$rail-ep-only.out")" '||glm' "$rail preserves caller --endpoint when --runner/--model absent"
  assert_contains "$(cat "$TEST_TMP/$rail-ep-only.err")" 'glm is at 90% of its 7-day window' "$rail warns on over-ceiling caller --endpoint"
done

: > "$PACE_SENTINEL_LOG"
AUTOPILOT_PACE_FILE="$TEST_TMP/glm-over-minimax-zero.json" \
AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example.invalid/v1 AUTOPILOT_ENDPOINT_GLM_TOKEN=test-glm-token \
  bash "$REPO_ROOT/scripts/dispatch-author.sh" --prompt-file "$TEST_TMP/brief" --endpoint glm --timeout 10s \
  > "$TEST_TMP/author-ep-real.out" 2> "$TEST_TMP/author-ep-real.err"
assert_eq "$?" 2 'real author rail with --endpoint only does not discard endpoint or pick codex'
assert_contains "$(cat "$TEST_TMP/author-ep-real.out")" '--runner is required' 'real author rail with --endpoint only refuses missing runner'
assert_contains "$(cat "$TEST_TMP/author-ep-real.err")" 'glm is at 90% of its 7-day window' 'real author rail with --endpoint only warns on glm quota'
AUTOPILOT_PACE_FILE="$TEST_TMP/glm-over-minimax-zero.json" \
AUTOPILOT_ENDPOINT_GLM_URL=https://glm.example.invalid/v1 AUTOPILOT_ENDPOINT_GLM_TOKEN=test-glm-token \
  bash "$REPO_ROOT/scripts/dispatch-review.sh" --diff-file "$TEST_TMP/diff" --spec-file "$TEST_TMP/brief" --endpoint glm --timeout 10s \
  > "$TEST_TMP/review-ep-real.out" 2> "$TEST_TMP/review-ep-real.err"
assert_eq "$?" 2 'real review rail with --endpoint only does not discard endpoint or pick codex'
assert_contains "$(cat "$TEST_TMP/review-ep-real.out")" '--runner is required' 'real review rail with --endpoint only refuses missing runner'
assert_contains "$(cat "$TEST_TMP/review-ep-real.err")" 'glm is at 90% of its 7-day window' 'real review rail with --endpoint only warns on glm quota'
assert_eq "" "$(cat "$PACE_SENTINEL_LOG" 2>/dev/null)" 'caller --endpoint without --runner/--model never spawns codex sentinel'
finalize_test
