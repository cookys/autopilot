#!/usr/bin/env bash
# dispatch-contract-pin.test.sh — P2b / KR1 + KR2 + KR11
# (plan 2026-09-11-operator-pin-supersedes-qualification).
#
# Architectural constraint: the contract never reads pins.jsonl. Pin knowledge
# enters only via --resolved-live (the resolver's JSON). isAdmissibleScorecardRow
# stays pin-unaware.
#
# KR2: every false-return in isAdmissibleScorecardRow and every !matched refusal
# branch is enumerated below from the pre-change source; each case's stdout from
# the immutable pre-change build is captured under
# hooks/tests/fixtures/zero-pin-baseline/ (and TEST_TMP mirror) then asserted
# byte-identical against the current build with --resolved-live omitted.
. "$(dirname "$0")/lib.sh"

# Immutable pre-change commit (campaign base_sha). Do not use HEAD — the harness
# may have already committed this deliverable onto the branch.
PRE_SHA="4aa1325bca17a0db68b5f69292bd601ba7ff58e1"
PRE_JS="$REPO_ROOT/scripts/dispatch-contract.pre.js"
git -C "$REPO_ROOT" show "${PRE_SHA}:scripts/dispatch-contract.js" >"$PRE_JS"
trap 'rm -f "$PRE_JS"; cleanup_test_tmp' EXIT

# Baselines are captured fresh every run, from the immutable PRE_SHA build
# (git show, never a committed snapshot — see the comment on assert_zero_pin_case).
# Nothing under this test writes into the repo working tree.
BASELINE_TMP="$TEST_TMP/zero-pin-baseline"
mkdir -p "$BASELINE_TMP"

sha256_hex() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    node -e 'const c=require("crypto");const f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"));' "$file"
  fi
}

utc_now() {
  node -e 'const d=new Date();const p=n=>String(n).padStart(2,"0");process.stdout.write(d.getUTCFullYear()+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+"T"+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+":"+p(d.getUTCSeconds())+"Z");'
}

json_get() {
  # Redirect-to-file discipline: never pipe the checker into grep/json_get.
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const p=process.argv[2].split(".");let v=j;for(const k of p){v=v?.[k];}if(v===undefined)process.exit(3);process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v));' "$1" "$2"
}

# === 0: contract must not know the pin store exists ===
echo "--- 0: no pins.jsonl / pin-seat knowledge in dispatch-contract.js ---"
PIN_GREP_OUT="$TEST_TMP/pin-grep.txt"
# Intentionally not a pipeline on the checker — grep the source file only.
grep -n "pins.jsonl\|pin-seat" "$REPO_ROOT/scripts/dispatch-contract.js" >"$PIN_GREP_OUT" 2>"$TEST_TMP/pin-grep.err" || true
PIN_GREP_SIZE=$(wc -c <"$PIN_GREP_OUT" | tr -d ' ')
assert_eq "$PIN_GREP_SIZE" "0" "dispatch-contract.js must not mention pins.jsonl or pin-seat"

# === mini repo (same shape as dispatch-contract.test.sh) ===
MINI_REPO="$TEST_TMP/mini_repo"
mkdir -p "$MINI_REPO"/{specs/feat,src,.claude,.codex/mirror,tools,scripts,initial}
cd "$MINI_REPO" || fail "cd mini_repo"
git init -q
git config user.name "Test Bot"
git config user.email "bot@test.local"
echo A > initial/A.txt
git add . && git commit -q -m "Commit A"
DEP_SHA=$(git rev-parse HEAD)

cat > specs/feat/core.md <<'EOF'
## Overview
core
## API
- funcA()
EOF
cat > src/main.go <<'EOF'
package main
func main() {}
EOF
cat > src/util.go <<'EOF'
package main
func Util() bool { return true }
EOF
cat > .claude/review-loop-config.md <<'EOF'
# Review Loop Config
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
- plan_review: off
- hetero_review: off
- consult_dispatch: off
- discuss_dispatch: off
EOF
echo Mirror > .codex/mirror/copy.md
echo Mirror2 > .codex/copy.md
printf '#!/bin/sh\ntouch red.marker\n' > tools/red.sh
printf '#!/bin/sh\ntouch run.marker\n' > tools/runner.sh
chmod +x tools/red.sh tools/runner.sh
cat > scripts/dispatch-contract.js <<'EOF'
module.exports = () => console.error("Decoy checker executed!");
EOF
git add . && git commit -q -m "Commit B"
BASE_SHA=$(git rev-parse HEAD)
git checkout -q .

CONTRACT_DIR="$TEST_TMP/contracts"
mkdir -p "$CONTRACT_DIR"
cat > "$CONTRACT_DIR/valid.json" <<EOF
{
  "schema": 1,
  "unit_id": "feat-core-impl",
  "role": "implementer",
  "goal": "Implement core API",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$BASE_SHA",
  "depends_on": ["$DEP_SHA"],
  "scope": {
    "allow_paths": ["src/"],
    "deny_paths": ["vendor/"],
    "generated_mirrors": {"command": ["scripts/sync-codex-plugin-skills.sh"], "allow_paths": [".codex/mirror/"]},
    "max_files": 10,
    "max_diff_lines": 100
  },
  "go": {
    "required_paths": ["src/main.go", "src/util.go"],
    "required_engine_role": "implementer",
    "required_red_command": ["tools/red.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {"kind": "diff", "paths": ["src/"]},
  "acceptance": [{"argv": ["tools/runner.sh"], "exit": 0}],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF

cat > "$CONTRACT_DIR/va_verdict.json" <<EOF
{
  "schema": 1,
  "unit_id": "feat-core-va-verdict",
  "role": "verification-author",
  "goal": "Verify core API",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$BASE_SHA",
  "depends_on": ["$DEP_SHA"],
  "scope": {
    "allow_paths": ["oracle.test.sh"],
    "deny_paths": ["vendor/"],
    "max_files": 10,
    "max_diff_lines": 100
  },
  "go": {
    "required_paths": ["specs/feat/core.md"],
    "required_engine_role": "verification-author",
    "required_red_command": ["tools/red.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {"kind": "verdict", "paths": ["oracle.test.sh"]},
  "acceptance": [{"argv": ["tools/runner.sh"], "exit": 0}],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF

# Substitute-seat contract: review-loop-config points at stand-in engine B
cat > "$CONTRACT_DIR/substitute.json" <<EOF
{
  "schema": 1,
  "unit_id": "feat-core-sub",
  "role": "implementer",
  "goal": "Implement core API",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$BASE_SHA",
  "depends_on": ["$DEP_SHA"],
  "scope": {
    "allow_paths": ["src/"],
    "deny_paths": ["vendor/"],
    "generated_mirrors": {"command": ["scripts/sync-codex-plugin-skills.sh"], "allow_paths": [".codex/mirror/"]},
    "max_files": 10,
    "max_diff_lines": 100
  },
  "go": {
    "required_paths": ["src/main.go", "src/util.go"],
    "required_engine_role": "implementer",
    "required_red_command": ["tools/red.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {"kind": "diff", "paths": ["src/"]},
  "acceptance": [{"argv": ["tools/runner.sh"], "exit": 0}],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF

STORE_BASE="$TEST_TMP/stores"
mkdir -p "$STORE_BASE"
HEX64=$(node -e "process.stdout.write('a'.repeat(64))")

QUAL_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
FAILED_ROW='{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"2/10","false_pass_critical":3,"specificity":"1/3"},"capability_score":0.1,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"failed","qualified_at":"2026-06-30","expires":"2099-01-01"}'
MISMATCH_ROW='{"engine":"wrong-model","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
VA_QUAL='{"engine":"glm-5.2","runner":"anthropic-compatible","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'
SUB_QUAL='{"engine":"stand-in-engine-b","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}'

seed_cap() {
  local store="$1" model="$2" runner="$3" role="$4"
  mkdir -p "$store"
  cat > "$store/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"$runner","model":"$model","role":"$role","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$store" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$store/cap.json" > /dev/null 2>&1 \
    || fail "capability seed failed for $store"
}

seed_score() {
  local store="$1" json="$2"
  mkdir -p "$store"
  printf '%s\n' "$json" > "$store/score.json"
  env ENGINE_SCORECARD_DIR="$store" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$store/score.json" > /dev/null 2>&1 \
    || fail "scorecard seed failed for $store"
}

# Run checker; write stdout to file; return exit code. Never pipe the checker.
run_check() {
  local out_file="$1"
  shift
  "$@" >"$out_file" 2>"${out_file}.err"
  local ec=$?
  # Normalize to a single JSON line (ignore empty stderr noise).
  node -e '
const fs=require("fs");
const raw=fs.readFileSync(process.argv[1],"utf8").trim();
const lines=raw.split(/\n/).filter(Boolean);
let obj=null;
for (let i=lines.length-1;i>=0;i--) {
  try { obj=JSON.parse(lines[i]); break; } catch {}
}
if (!obj) { process.stderr.write("no JSON in checker stdout\n"+raw+"\n"); process.exit(1); }
fs.writeFileSync(process.argv[1], JSON.stringify(obj)+"\n");
' "$out_file" || fail "checker stdout was not JSON ($(cat "${out_file}.err" 2>/dev/null | head -5))"
  return "$ec"
}

# Capture pre-change baseline then assert current matches byte-for-byte.
#
# NOT circular: pre_out is generated by actually EXECUTING the immutable
# PRE_SHA build (git show'd to $PRE_JS at file top) against this run's mini
# repo, never read back from a static committed fixture. A committed fixture
# cannot serve as that static baseline here — the contract JSON embeds this
# run's fresh mini-repo commit sha (BASE_SHA), which is not reproducible
# byte-for-byte across separate `git commit` invocations, so contract_sha256
# (and therefore the whole stdout line) legitimately differs run to run.
# Comparing pre_out to cur_out within the SAME run is what makes the claim
# meaningful. This function intentionally writes only under $TEST_TMP — never
# into hooks/tests/fixtures/ — so the suite never dirties the repo working
# tree.
assert_zero_pin_case() {
  local name="$1"
  shift
  local pre_out="$BASELINE_TMP/${name}.json"
  local cur_out="$TEST_TMP/cur-${name}.json"
  local pre_ec=0 cur_ec=0

  echo "--- KR2 case: $name ---"
  # Rebuild argv with PRE_JS vs current script. Caller passes env + node + script placeholder.
  # Convention: args contain the token __CHECKER__ where the script path goes.
  local -a pre_cmd=() cur_cmd=()
  local a
  for a in "$@"; do
    if [ "$a" = "__CHECKER__" ]; then
      pre_cmd+=("$PRE_JS")
      cur_cmd+=("$REPO_ROOT/scripts/dispatch-contract.js")
    else
      pre_cmd+=("$a")
      cur_cmd+=("$a")
    fi
  done

  run_check "$pre_out" "${pre_cmd[@]}"; pre_ec=$?
  run_check "$cur_out" "${cur_cmd[@]}"; cur_ec=$?

  assert_eq "$cur_ec" "$pre_ec" "KR2 $name exit codes must match (pre=$pre_ec cur=$cur_ec)"
  if cmp -s "$pre_out" "$cur_out"; then
    assert_eq "1" "1" "KR2 $name byte-identical"
  else
    fail "KR2 $name stdout not byte-identical to pre-change baseline"
    diff -u "$pre_out" "$cur_out" >&2 || true
  fi
}

# ---------------------------------------------------------------------------
# KR2 enumeration (derived from pre-change source, not guessed):
#
# isAdmissibleScorecardRow false-returns:
#   F1 L115 !scorecardRowMatchesEngine
#   F2 L120 admission_status === 'requalify_required'  (exercised via R1-*)
#   F3 L122 status !== 'provisional' (after not qualified)  → failed
#   F4 L125 provisional && observed_status !== 'qualified'
#   F5 L131 provisional+observed qualified but role/output gate fails
#
# !matched refusal branches:
#   R1-critical  strikeRow → strikeReasonMessage (critical_trigger)
#   R1-ordinary  strikeRow → strikeReasonMessage (ordinary count)
#   R2           no strike, no override → no qualified scorecard row
#   R3           override unreadable → override reason + no-row
#   R4           override bad schema → schema reason + no-row
#   R5           override expired → no-row (override does not match)
# ---------------------------------------------------------------------------

# F1
rm -rf "$STORE_BASE/mismatch"; mkdir -p "$STORE_BASE/mismatch"
seed_score "$STORE_BASE/mismatch" "$MISMATCH_ROW"
seed_cap "$STORE_BASE/mismatch" "gpt-5.3-codex-spark" "codex" "implementer"
assert_zero_pin_case "f1-engine-mismatch" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/mismatch" ENGINE_CAPABILITY_DIR="$STORE_BASE/mismatch" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json

# F3
rm -rf "$STORE_BASE/failed"; mkdir -p "$STORE_BASE/failed"
seed_score "$STORE_BASE/failed" "$FAILED_ROW"
seed_cap "$STORE_BASE/failed" "gpt-5.3-codex-spark" "codex" "implementer"
assert_zero_pin_case "f3-failed-status" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/failed" ENGINE_CAPABILITY_DIR="$STORE_BASE/failed" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json

# F4
rm -rf "$STORE_BASE/prov_bad_obs"; mkdir -p "$STORE_BASE/prov_bad_obs"
seed_score "$STORE_BASE/prov_bad_obs" "$QUAL_ROW"
seed_cap "$STORE_BASE/prov_bad_obs" "gpt-5.3-codex-spark" "codex" "implementer"
PRELOAD_OBS="$TEST_TMP/obs-rewrite.cjs"
cat > "$PRELOAD_OBS" <<'NODE'
'use strict';
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function projectedSpawnSync(command, args, options) {
  const result = originalSpawnSync.call(this, command, args, options);
  if (!Array.isArray(args) || args.length < 2
      || path.basename(String(args[0])) !== 'engine-scorecard.js'
      || args[1] !== 'current' || result.status !== 0) {
    return result;
  }
  try {
    const rows = JSON.parse(String(result.stdout || ''));
    if (!Array.isArray(rows)) return result;
    const projected = rows.map((row) => {
      if (!row || row.status !== 'provisional') return row;
      return { ...row, observed_status: 'unknown' };
    });
    return { ...result, stdout: `${JSON.stringify(projected)}\n` };
  } catch {
    return result;
  }
};
NODE
assert_zero_pin_case "f4-provisional-bad-observed" \
  env NODE_OPTIONS="--require=$PRELOAD_OBS" \
  ENGINE_SCORECARD_DIR="$STORE_BASE/prov_bad_obs" ENGINE_CAPABILITY_DIR="$STORE_BASE/prov_bad_obs" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json

# F5 — VA provisional with verdict output (not raw-artifact)
rm -rf "$STORE_BASE/va_prov"; mkdir -p "$STORE_BASE/va_prov"
printf '%s\n' "$QUAL_ROW" > "$STORE_BASE/va_prov/impl.json"
printf '%s\n' "$VA_QUAL" > "$STORE_BASE/va_prov/va.json"
env ENGINE_SCORECARD_DIR="$STORE_BASE/va_prov" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/va_prov/impl.json" >/dev/null \
  || fail "va_prov impl seed"
env ENGINE_SCORECARD_DIR="$STORE_BASE/va_prov" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/va_prov/va.json" >/dev/null \
  || fail "va_prov va seed"
seed_cap "$STORE_BASE/va_prov" "glm-5.2" "anthropic-compatible" "verification_author"
assert_zero_pin_case "f5-provisional-wrong-output-kind" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/va_prov" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_prov" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/va_verdict.json" --repo "$MINI_REPO" --json

# R2 / no-row (also the empty-store face of F1)
rm -rf "$STORE_BASE/empty"; mkdir -p "$STORE_BASE/empty"
seed_cap "$STORE_BASE/empty" "gpt-5.3-codex-spark" "codex" "implementer"
assert_zero_pin_case "r2-no-row" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json

# R1-critical (F2 via critical_trigger)
rm -rf "$STORE_BASE/strike_crit"; mkdir -p "$STORE_BASE/strike_crit"
seed_score "$STORE_BASE/strike_crit" "$QUAL_ROW"
seed_cap "$STORE_BASE/strike_crit" "gpt-5.3-codex-spark" "codex" "implementer"
env ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_crit" node "$REPO_ROOT/scripts/engine-capability-state.js" strike-seat \
  --engine gpt-5.3-codex-spark --runner codex --role implementer \
  --class critical_reexam_trigger --predicate-id security_canary_disclosure \
  --cause-class engine_output --writer fuse --dedup-key "kr2-crit:1" \
  --detector-id det-1 --detector-version v1 \
  --artifact-sha256 "$HEX64" --receipt-ref "rcpt-crit" \
  --now "2026-07-01T00:00:00Z" >/dev/null \
  || fail "critical strike seed"
assert_zero_pin_case "r1-strike-critical" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/strike_crit" ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_crit" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json

# R1-ordinary (F2 via ordinary threshold + enforce)
rm -rf "$STORE_BASE/strike_ord"; mkdir -p "$STORE_BASE/strike_ord"
seed_score "$STORE_BASE/strike_ord" "$QUAL_ROW"
seed_cap "$STORE_BASE/strike_ord" "gpt-5.3-codex-spark" "codex" "implementer"
for i in 1 2 3; do
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_ord" node "$REPO_ROOT/scripts/engine-capability-state.js" strike-seat \
    --engine gpt-5.3-codex-spark --runner codex --role implementer \
    --class ordinary_strike \
    --cause-class engine_output --writer fuse --dedup-key "kr2-ord:$i" \
    --detector-id det-1 --detector-version v1 \
    --artifact-sha256 "$HEX64" --receipt-ref "rcpt-ord-$i" \
    --now "2026-07-0${i}T00:00:00Z" >/dev/null \
    || fail "ordinary strike seed $i"
done
assert_zero_pin_case "r1-strike-ordinary" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$STORE_BASE/strike_ord" ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_ord" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json

# R3 invalid override
printf '{not json\n' > "$TEST_TMP/override-bad.json"
assert_zero_pin_case "r3-override-unreadable" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --qualification-override "$TEST_TMP/override-bad.json" --json

# R4 bad schema
printf '{"schema":2,"overrides":[]}\n' > "$TEST_TMP/override-schema.json"
assert_zero_pin_case "r4-override-bad-schema" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --qualification-override "$TEST_TMP/override-schema.json" --json

# R5 expired override
printf '{"schema":1,"overrides":[{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer","reason":"stale","operator":"cookys","expires":"2020-01-01"}]}\n' \
  > "$TEST_TMP/override-expired.json"
assert_zero_pin_case "r5-override-expired" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node __CHECKER__ check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --qualification-override "$TEST_TMP/override-expired.json" --json

# === KR1: pinned seat, no scorecard row → GO operator-pin ===
echo "--- KR1: pinned seat no scorecard → GO operator-pin ---"
LIVE_PIN="$TEST_TMP/resolved-live-pin.json"
cat > "$LIVE_PIN" <<'JSON'
{
  "role": "implementer",
  "operator_pin": {
    "engine": "gpt-5.3-codex-spark",
    "runner": "codex",
    "role": "implementer",
    "effort": "high",
    "endpoint": "",
    "reason": "owner ruling 2026-09-11",
    "operator": "cookys",
    "expires": null
  },
  "preferred_tuple": {
    "engine": "gpt-5.3-codex-spark",
    "runner": "codex",
    "effort": "high",
    "endpoint": ""
  },
  "effective_tuple": {
    "engine": "gpt-5.3-codex-spark",
    "runner": "codex",
    "effort": "high",
    "endpoint": ""
  },
  "substitution_reason": null,
  "pending_revocation": []
}
JSON
KR1_OUT="$TEST_TMP/kr1-out.json"
run_check "$KR1_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_PIN" --json
kr1_ec=$?
assert_eq "$kr1_ec" "0" "KR1 must GO"
assert_eq "$(json_get "$KR1_OUT" verdict)" "GO"
assert_eq "$(json_get "$KR1_OUT" assurance)" "operator-pin"
assert_eq "$(json_get "$KR1_OUT" operator_pin.engine)" "gpt-5.3-codex-spark"
assert_eq "$(json_get "$KR1_OUT" operator_pin.runner)" "codex"
assert_eq "$(json_get "$KR1_OUT" operator_pin.role)" "implementer"

# Same fixture without --resolved-live → pre-change refusal bytes
echo "--- KR1 red: same fixture without --resolved-live → baseline refusal ---"
KR1_OMIT_PRE="$TEST_TMP/kr1-omit-pre.json"
KR1_OMIT_CUR="$TEST_TMP/kr1-omit-cur.json"
run_check "$KR1_OMIT_PRE" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$PRE_JS" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json
run_check "$KR1_OMIT_CUR" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json
if cmp -s "$KR1_OMIT_PRE" "$KR1_OMIT_CUR"; then
  assert_eq "1" "1" "KR1 omit --resolved-live matches pre-change refusal bytes"
else
  fail "KR1 omit --resolved-live diverged from pre-change"
  diff -u "$KR1_OMIT_PRE" "$KR1_OMIT_CUR" >&2 || true
fi
# And it must be the no-row refusal, not a GO
assert_eq "$(json_get "$KR1_OMIT_CUR" verdict)" "NO-GO"
assert_contains "$(cat "$KR1_OMIT_CUR")" "no qualified scorecard row"

# === KR1 red (v2.36.27): an UNPINNED live doc must not admit ===
# The gap that let a bypass ship in v2.36.26: every --resolved-live fixture above
# is hand-built for a PINNED seat, and every unpinned red case omits the flag
# entirely, so nothing ever handed the contract an unpinned resolver document --
# which is exactly what the GO path consumes. The guard read tuple equality as
# proof of a pin, but the resolver emits preferred_tuple whether or not one
# exists (unpinned it is the ladder's own choice), so an unpinned host reached
# GO with assurance operator-pin and a fabricated operator_pin record.
echo "--- KR1 red: unpinned live doc (operator_pin null) must refuse ---"
LIVE_NOPIN="$TEST_TMP/resolved-live-nopin.json"
printf '%s\n' '{
  "role": "implementer",
  "operator_pin": null,
  "preferred_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "effective_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "substitution_reason": null,
  "pending_revocation": []
}' > "$LIVE_NOPIN"
NOPIN_OUT="$TEST_TMP/nopin-out.json"
run_check "$NOPIN_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_NOPIN" --json
nopin_ec=$?
assert_eq "$nopin_ec" "3" "KR1 red: unpinned live doc must NO-GO"
assert_eq "$(json_get "$NOPIN_OUT" verdict)" "NO-GO" "KR1 red: verdict NO-GO"
assert_contains "$(cat "$NOPIN_OUT")" "no qualified scorecard row" \
  "KR1 red: refuses for the pre-change reason, not a pin reason"
assert_not_contains "$(cat "$NOPIN_OUT")" "operator-pin" \
  "KR1 red: no operator-pin assurance on an unpinned host"
assert_not_contains "$(cat "$NOPIN_OUT")" '"operator_pin"' \
  "KR1 red: no fabricated operator_pin record in the payload"
# Byte-identical to the same fixture with the flag omitted: an unpinned live doc
# must change nothing at all, which is the zero-pin equivalence KR2 asserts.
if [ -s "$KR1_OMIT_CUR" ] && [ -s "$NOPIN_OUT" ] && cmp -s "$KR1_OMIT_CUR" "$NOPIN_OUT"; then
  assert_eq "$(wc -c < "$KR1_OMIT_CUR")" "$(wc -c < "$NOPIN_OUT")" \
    "KR1 red: unpinned live doc decides byte-identically to omitting the flag"
else
  fail "KR1 red: unpinned live doc changed the decision bytes"
  diff -u "$KR1_OMIT_CUR" "$NOPIN_OUT" >&2 || true
fi

# === KR11: substitution — unqualified substitute is NO-GO naming it ===
echo "--- KR11: unqualified substitute → NO-GO naming substitute ---"
# Point mini-repo config at stand-in B and commit so the dirty-base gate stays green.
cat > "$MINI_REPO/.claude/review-loop-config.md" <<'EOF'
# Review Loop Config
- implementer_engine: stand-in-engine-b
- implementer_runner: codex
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
- plan_review: off
- hetero_review: off
- consult_dispatch: off
- discuss_dispatch: off
EOF
git -C "$MINI_REPO" add .claude/review-loop-config.md
git -C "$MINI_REPO" commit -q -m "point implementer at stand-in B for KR11"
# Contract base_sha must remain the pre-KR11 commit (Commit B); HEAD advancing is fine.

LIVE_SUB="$TEST_TMP/resolved-live-sub.json"
cat > "$LIVE_SUB" <<'JSON'
{
  "role": "implementer",
  "operator_pin": {
    "engine": "gpt-5.3-codex-spark",
    "runner": "codex",
    "role": "implementer",
    "effort": "high",
    "endpoint": "",
    "reason": "owner ruling 2026-09-11",
    "operator": "cookys",
    "expires": null
  },
  "preferred_tuple": {
    "engine": "gpt-5.3-codex-spark",
    "runner": "codex",
    "effort": "high",
    "endpoint": ""
  },
  "effective_tuple": {
    "engine": "stand-in-engine-b",
    "runner": "codex",
    "effort": "high",
    "endpoint": ""
  },
  "substitution_reason": "critical_strike",
  "pending_revocation": []
}
JSON

rm -rf "$STORE_BASE/sub_empty"; mkdir -p "$STORE_BASE/sub_empty"
seed_cap "$STORE_BASE/sub_empty" "stand-in-engine-b" "codex" "implementer"
KR11_BAD="$TEST_TMP/kr11-bad.json"
run_check "$KR11_BAD" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/sub_empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/sub_empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/substitute.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_SUB" --json
kr11_bad_ec=$?
KR11_BAD_BODY=$(cat "$KR11_BAD")
assert_eq "$kr11_bad_ec" "3" "KR11 unqualified substitute must NO-GO"
assert_eq "$(json_get "$KR11_BAD" verdict)" "NO-GO"
assert_contains "$KR11_BAD_BODY" "stand-in-engine-b"
assert_contains "$KR11_BAD_BODY" "substitute seat"
# A NO-GO payload structurally never carries "assurance" (exitNoGo's fixed
# shape), so a plain string-contains check for '"assurance":"operator-pin"'
# passes on every NO-GO regardless of correctness — vacuous. Assert the key's
# actual absence via json_get's own missing-key semantics (exit 3) instead,
# so this fails if a future change ever attaches an assurance field to NO-GO.
kr11_bad_assurance_ec=0
json_get "$KR11_BAD" assurance >/dev/null 2>&1 || kr11_bad_assurance_ec=$?
assert_neq "$kr11_bad_assurance_ec" "0" "KR11 NO-GO body must not carry an assurance key"

# KR11: qualified substitute → GO, assurance is NOT operator-pin
echo "--- KR11: qualified substitute → GO without operator-pin ---"
rm -rf "$STORE_BASE/sub_qual"; mkdir -p "$STORE_BASE/sub_qual"
seed_score "$STORE_BASE/sub_qual" "$SUB_QUAL"
seed_cap "$STORE_BASE/sub_qual" "stand-in-engine-b" "codex" "implementer"
KR11_OK="$TEST_TMP/kr11-ok.json"
run_check "$KR11_OK" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/sub_qual" ENGINE_CAPABILITY_DIR="$STORE_BASE/sub_qual" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/substitute.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_SUB" --json
kr11_ok_ec=$?
assert_eq "$kr11_ok_ec" "0" "KR11 qualified substitute must GO"
assert_eq "$(json_get "$KR11_OK" verdict)" "GO"
# provisional (disk projects qualified→provisional) or absent — never operator-pin
ASSURE=$(json_get "$KR11_OK" assurance 2>/dev/null || echo "")
assert_neq "$ASSURE" "operator-pin" "qualified substitute must not carry operator-pin assurance"

# === Defect 1 (MUST-FIX): substitution must be considered even when the
# PREFERRED seat already has a qualified scorecard row. Repro of the hole:
# isAdmissibleScorecardRow was only ever called against resolvedEngine (the
# preferred seat), so `matched` went true on the preferred seat's row while
# the resolver reports the run will actually dispatch the substitute. ===
echo "--- Defect1: qualified preferred + unqualified substitute → NO-GO naming substitute ---"
# Config must point at the PREFERRED seat (gpt-5.3-codex-spark), not the
# substitute — this is exactly the shape KR11's original fixtures never
# exercised (they pointed config straight at the substitute).
cat > "$MINI_REPO/.claude/review-loop-config.md" <<'EOF'
# Review Loop Config
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
- plan_review: off
- hetero_review: off
- consult_dispatch: off
- discuss_dispatch: off
EOF
git -C "$MINI_REPO" add .claude/review-loop-config.md
git -C "$MINI_REPO" commit -q -m "restore primary implementer for Defect1/Defect2"

# Preferred seat (gpt-5.3-codex-spark) IS qualified; substitute has no row at all.
rm -rf "$STORE_BASE/d1_sub_unqual"; mkdir -p "$STORE_BASE/d1_sub_unqual"
seed_score "$STORE_BASE/d1_sub_unqual" "$QUAL_ROW"
seed_cap "$STORE_BASE/d1_sub_unqual" "gpt-5.3-codex-spark" "codex" "implementer"
seed_cap "$STORE_BASE/d1_sub_unqual" "stand-in-engine-b" "codex" "implementer"

D1_BAD="$TEST_TMP/d1-bad.json"
run_check "$D1_BAD" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/d1_sub_unqual" ENGINE_CAPABILITY_DIR="$STORE_BASE/d1_sub_unqual" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_SUB" --json
d1_bad_ec=$?
D1_BAD_BODY=$(cat "$D1_BAD")
assert_eq "$d1_bad_ec" "3" "Defect1: qualified preferred + unqualified substitute must NO-GO"
assert_eq "$(json_get "$D1_BAD" verdict)" "NO-GO"
assert_contains "$D1_BAD_BODY" "stand-in-engine-b"
assert_contains "$D1_BAD_BODY" "substitute seat"

# Same shape, but the substitute IS qualified → GO, assurance never operator-pin
# (operator-pin admits preferred_tuple only, and the preferred seat wasn't
# actually dispatched).
rm -rf "$STORE_BASE/d1_sub_qual"; mkdir -p "$STORE_BASE/d1_sub_qual"
seed_score "$STORE_BASE/d1_sub_qual" "$QUAL_ROW"
seed_score "$STORE_BASE/d1_sub_qual" "$SUB_QUAL"
seed_cap "$STORE_BASE/d1_sub_qual" "gpt-5.3-codex-spark" "codex" "implementer"
seed_cap "$STORE_BASE/d1_sub_qual" "stand-in-engine-b" "codex" "implementer"

D1_OK="$TEST_TMP/d1-ok.json"
run_check "$D1_OK" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/d1_sub_qual" ENGINE_CAPABILITY_DIR="$STORE_BASE/d1_sub_qual" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_SUB" --json
d1_ok_ec=$?
assert_eq "$d1_ok_ec" "0" "Defect1: qualified preferred + qualified substitute must GO"
assert_eq "$(json_get "$D1_OK" verdict)" "GO"
D1_OK_ASSURE=$(json_get "$D1_OK" assurance 2>/dev/null || echo "")
assert_neq "$D1_OK_ASSURE" "operator-pin" "Defect1: substitute-qualified GO must not carry operator-pin assurance"

# === Defect 2 (MUST-FIX): a per-invocation override for the PREFERRED seat
# must never launder a substituted, unqualified seat through admission. ===
echo "--- Defect2: substitution + valid override for preferred → NO-GO ---"
printf '{"schema":1,"overrides":[{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer","reason":"defect2","operator":"cookys","expires":"2099-01-01"}]}\n' \
  > "$TEST_TMP/override-defect2.json"
rm -rf "$STORE_BASE/d2_override"; mkdir -p "$STORE_BASE/d2_override"
seed_score "$STORE_BASE/d2_override" "$QUAL_ROW"
seed_cap "$STORE_BASE/d2_override" "gpt-5.3-codex-spark" "codex" "implementer"
seed_cap "$STORE_BASE/d2_override" "stand-in-engine-b" "codex" "implementer"

D2_OUT="$TEST_TMP/d2-out.json"
run_check "$D2_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/d2_override" ENGINE_CAPABILITY_DIR="$STORE_BASE/d2_override" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_SUB" --qualification-override "$TEST_TMP/override-defect2.json" --json
d2_ec=$?
D2_OUT_BODY=$(cat "$D2_OUT")
assert_eq "$d2_ec" "3" "Defect2: override for preferred must not admit a substituted unqualified seat"
assert_eq "$(json_get "$D2_OUT" verdict)" "NO-GO"
assert_contains "$D2_OUT_BODY" "stand-in-engine-b"

# === malformed --resolved-live → NO-GO, never silent admit ===
echo "--- malformed --resolved-live → NO-GO ---"
# Config already restored to the primary implementer above (Defect1/Defect2
# block) — no further config churn needed here.

printf '{not-json\n' > "$TEST_TMP/live-bad.json"
MAL_OUT="$TEST_TMP/mal-out.json"
run_check "$MAL_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/live-bad.json" --json
mal_ec=$?
assert_eq "$mal_ec" "3" "malformed resolved-live must NO-GO"
assert_eq "$(json_get "$MAL_OUT" verdict)" "NO-GO"
assert_contains "$(cat "$MAL_OUT")" "resolved-live"

printf '{"role":"implementer"}\n' > "$TEST_TMP/live-incomplete.json"
INC_OUT="$TEST_TMP/inc-out.json"
run_check "$INC_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/live-incomplete.json" --json
inc_ec=$?
assert_eq "$inc_ec" "3" "incomplete resolved-live must NO-GO"
assert_contains "$(cat "$INC_OUT")" "resolved-live"

# Unreadable path
MISS_OUT="$TEST_TMP/miss-out.json"
run_check "$MISS_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/does-not-exist-resolved-live.json" --json
miss_ec=$?
assert_eq "$miss_ec" "3" "missing resolved-live must NO-GO"
assert_contains "$(cat "$MISS_OUT")" "resolved-live"

# === Defect 3 (MUST-FIX): --resolved-live validation must be total, not
# truthiness-based, and a missing option operand must be rejected loudly
# rather than silently collapsed to "flag absent". ===

# substitution_reason: false with equal tuples used to read as "no
# substitution" via bare truthiness (`if (live.substitution_reason) return
# true`), even though false is not a valid value at all (must be null or a
# non-empty string) — silently treating a malformed field as "no pin".
printf '%s\n' '{
  "role": "implementer",
  "operator_pin": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "role": "implementer", "effort": "high", "endpoint": "", "reason": "owner ruling 2026-09-11", "operator": "cookys", "expires": null},
  "preferred_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "effective_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "substitution_reason": false,
  "pending_revocation": []
}' > "$TEST_TMP/live-sub-reason-false.json"
SUBFALSE_OUT="$TEST_TMP/subfalse-out.json"
run_check "$SUBFALSE_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/live-sub-reason-false.json" --json
subfalse_ec=$?
assert_eq "$subfalse_ec" "3" "substitution_reason:false must NO-GO"
assert_eq "$(json_get "$SUBFALSE_OUT" verdict)" "NO-GO"
assert_contains "$(cat "$SUBFALSE_OUT")" "substitution_reason"

# Empty-string engine in preferred_tuple: was accepted before (typeof check
# only, no non-empty check) and would then fail admission for the wrong
# reason (no match) instead of being refused as malformed input up front.
printf '%s\n' '{
  "role": "implementer",
  "operator_pin": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "role": "implementer", "effort": "high", "endpoint": "", "reason": "owner ruling 2026-09-11", "operator": "cookys", "expires": null},
  "preferred_tuple": {"engine": "", "runner": "codex", "effort": "high", "endpoint": ""},
  "effective_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "substitution_reason": null,
  "pending_revocation": []
}' > "$TEST_TMP/live-empty-engine.json"
EMPTYENG_OUT="$TEST_TMP/emptyeng-out.json"
run_check "$EMPTYENG_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/live-empty-engine.json" --json
emptyeng_ec=$?
assert_eq "$emptyeng_ec" "3" "empty-string engine in preferred_tuple must NO-GO"
assert_eq "$(json_get "$EMPTYENG_OUT" verdict)" "NO-GO"
assert_contains "$(cat "$EMPTYENG_OUT")" "preferred_tuple"

# pending_revocation not an array
printf '%s\n' '{
  "role": "implementer",
  "operator_pin": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "role": "implementer", "effort": "high", "endpoint": "", "reason": "owner ruling 2026-09-11", "operator": "cookys", "expires": null},
  "preferred_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "effective_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "substitution_reason": null,
  "pending_revocation": "none"
}' > "$TEST_TMP/live-bad-pending.json"
PENDBAD_OUT="$TEST_TMP/pendbad-out.json"
run_check "$PENDBAD_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/live-bad-pending.json" --json
pendbad_ec=$?
assert_eq "$pendbad_ec" "3" "non-array pending_revocation must NO-GO"
assert_eq "$(json_get "$PENDBAD_OUT" verdict)" "NO-GO"
assert_contains "$(cat "$PENDBAD_OUT")" "pending_revocation"

# Missing substitution_reason key entirely (not merely falsy — absent).
printf '%s\n' '{
  "role": "implementer",
  "operator_pin": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "role": "implementer", "effort": "high", "endpoint": "", "reason": "owner ruling 2026-09-11", "operator": "cookys", "expires": null},
  "preferred_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "effective_tuple": {"engine": "gpt-5.3-codex-spark", "runner": "codex", "effort": "high", "endpoint": ""},
  "pending_revocation": []
}' > "$TEST_TMP/live-missing-subreason.json"
MISSSUB_OUT="$TEST_TMP/misssub-out.json"
run_check "$MISSSUB_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --resolved-live "$TEST_TMP/live-missing-subreason.json" --json
misssub_ec=$?
assert_eq "$misssub_ec" "3" "missing substitution_reason key must NO-GO"
assert_eq "$(json_get "$MISSSUB_OUT" verdict)" "NO-GO"
assert_contains "$(cat "$MISSSUB_OUT")" "substitution_reason"

# A missing option operand (e.g. --resolved-live as the last argv token, a
# plausible typo) must be a loud usage error, never silently collapsed to
# "flag absent" (which used to fall through to the zero-pin path). This is a
# CLI usage failure (exit 2, plain text on stdout/stderr), not the JSON NO-GO
# payload, so it is checked directly rather than via run_check.
MISSOPERAND_OUT="$TEST_TMP/missoperand-out.txt"
env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --json --resolved-live >"$MISSOPERAND_OUT" 2>&1
missoperand_ec=$?
assert_eq "$missoperand_ec" "2" "--resolved-live with a missing operand must be a usage error, not a silent absent-flag"
assert_contains "$(cat "$MISSOPERAND_OUT")" "--resolved-live requires a value"

# === override still works unchanged (different mechanism) ===
echo "--- qualification-override still admits without pin ---"
printf '{"schema":1,"overrides":[{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer","reason":"first-use","operator":"cookys","expires":"2099-01-01"}]}\n' \
  > "$TEST_TMP/override-ok.json"
OV_OUT="$TEST_TMP/ov-out.json"
run_check "$OV_OUT" \
  env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check \
  --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" \
  --qualification-override "$TEST_TMP/override-ok.json" --json
ov_ec=$?
assert_eq "$ov_ec" "0" "override must still GO"
assert_eq "$(json_get "$OV_OUT" assurance)" "operator-override"

finalize_test
