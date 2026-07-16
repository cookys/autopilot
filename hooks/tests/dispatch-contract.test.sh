#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Infrastructure helpers
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

invoke_checker() {
  local contract="$1"
  local repo="$2"
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$contract" --repo "$repo" --json 2>&1
  return $?
}

json_get() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const p=process.argv[1].split(".");let v=j;for(const k of p){v=v?.[k];}if(v===undefined){process.exit(3);}console.log(typeof v==="object"?JSON.stringify(v):String(v));}catch(e){process.exit(4);}})' "$2"
}

json_keys() {
  printf '%s' "$1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const j=JSON.parse(d);const keys=Object.keys(j).sort();console.log(keys.join(","));}catch(e){process.exit(4);}})'
}

assert_no_secret() {
  local out="$1"
  if printf '%s' "$out" | grep -q 'SECRET_FIXTURE'; then
    fail "Fixture secret leaked into checker output"
  fi
}

assert_red_green_clean() {
  local repo="$1"
  assert_file_absent "$repo/red.marker"
  assert_file_absent "$repo/sync.marker"
  assert_file_absent "$repo/run.marker"
}

assert_nogo_json() {
  local out="$1"
  local category="$2"
  assert_contains "$out" "$category"
  assert_contains "$out" "NO-GO"
  local keys
  keys=$(json_keys "$out" 2>/dev/null) || fail "NO-GO output is not valid JSON"
  assert_eq "$keys" "contract_sha256,reasons,resolved_engine,spec_sha256,unit_id,verdict"
  local verdict
  verdict=$(json_get "$out" "verdict") || fail "verdict extraction failed"
  assert_eq "$verdict" "NO-GO"
  local reasons
  reasons=$(json_get "$out" "reasons") || fail "reasons extraction failed"
  if [ "$reasons" = "[]" ] || [ -z "$reasons" ]; then
    fail "NO-GO reasons array must be nonempty"
  fi
}

# === SETUP MINI REPO ===
MINI_REPO="$TEST_TMP/mini_repo"
mkdir -p "$MINI_REPO"
mkdir -p "$MINI_REPO/specs/feat"
mkdir -p "$MINI_REPO/src"
mkdir -p "$MINI_REPO/.claude"
mkdir -p "$MINI_REPO/.codex/mirror"
mkdir -p "$MINI_REPO/tools"
mkdir -p "$MINI_REPO/scripts"

cd "$MINI_REPO" || { echo "FATAL: cd mini_repo failed"; exit 1; }

git init -q
git config user.name "Test Bot"
git config user.email "bot@test.local"

mkdir -p initial
cat > initial/A.txt <<'EOF'
A
EOF
git add .
git commit -q -m "Commit A"
DEP_SHA=$(git rev-parse HEAD)

# Add Commit B (BASE_SHA)
cat > specs/feat/core.md <<'EOF'
## Overview
This is the core spec.

## API
- funcA()
- funcB()
EOF

cat > src/main.go <<'EOF'
package main

func main() {}
EOF

cat > src/util.go <<'EOF'
package main

func Util() bool {
    return true
}
EOF

cat > .claude/review-loop-config.md <<'EOF'
# Review Loop Config
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
SECRET_FIXTURE_DO_NOT_LEAK
EOF

cat > .codex/mirror/copy.md <<'EOF'
Mirror copy 1
EOF

cat > .codex/copy.md <<'EOF'
Mirror copy 2
EOF

cat > tools/red.sh <<'EOF'
touch red.marker
EOF

cat > tools/sync.sh <<'EOF'
touch sync.marker
EOF

cat > tools/runner.sh <<'EOF'
touch run.marker
EOF

cat > scripts/dispatch-contract.js <<'EOF'
module.exports = () => console.error("Decoy checker executed!");
EOF

git add .
git commit -q -m "Commit B"
BASE_SHA=$(git rev-parse HEAD)

# Restore pristine state (decoy checker should not be modified by tests but just to be safe)
git checkout -q .

# Compute SHAs
SPEC_SHA=$(sha256_hex "specs/feat/core.md")

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
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF

cat > "$CONTRACT_DIR/va_valid.json" <<EOF
{
  "schema": 1,
  "unit_id": "feat-core-va",
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
    "required_paths": ["oracle.test.sh"],
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
  "output": {"kind": "raw-artifact", "paths": ["oracle.test.sh"]},
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF

CONTRACT_SHA=$(sha256_hex "$CONTRACT_DIR/valid.json")

# === ENGINE STORE SETUP ===
STORE_BASE="$TEST_TMP/stores"
mkdir -p "$STORE_BASE"

setup_qualified_store() {
  local store_dir="$1"
  rm -rf "$store_dir"
  mkdir -p "$store_dir"
  
  local scorecard_row="$store_dir/score.json"
  cat > "$scorecard_row" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  
  env ENGINE_SCORECARD_DIR="$store_dir" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$scorecard_row" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup"; exit 1
  }

  local cap_event="$store_dir/cap.json"
  cat > "$cap_event" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  
  env ENGINE_CAPABILITY_DIR="$store_dir" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$cap_event" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup"; exit 1
  }
}

setup_qualified_store "$STORE_BASE/valid"

VA_SEEDING_FAILED=0

setup_va_qualified_store() {
  local store_dir="$1"
  local va_status="$2"
  local quota_status="$3"
  rm -rf "$store_dir"
  mkdir -p "$store_dir"

  local impl_scorecard_row="$store_dir/impl_score.json"
  cat > "$impl_scorecard_row" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$store_dir" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$impl_scorecard_row" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (va impl)"; exit 1
  }

  local impl_cap_event="$store_dir/impl_cap.json"
  cat > "$impl_cap_event" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$store_dir" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$impl_cap_event" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (va impl)"; exit 1
  }

  local va_scorecard_row="$store_dir/va_score.json"
  cat > "$va_scorecard_row" <<EOF
{"engine":"glm-5.2","runner":"anthropic-compatible","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"$va_status","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$store_dir" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$va_scorecard_row" > /dev/null 2>&1
  if [ $? -ne 0 ]; then
    if [ "$VA_SEEDING_FAILED" -eq 0 ]; then
      VA_SEEDING_FAILED=1
      fail "VA role seeding rejected (role-aware gate not yet implemented)"
    fi
    return 1
  fi

  local va_cap_event="$store_dir/va_cap.json"
  cat > "$va_cap_event" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","runner_version":"v1.0.0","capability":{"quota":{"status":"$quota_status","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$store_dir" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$va_cap_event" > /dev/null 2>&1
  if [ $? -ne 0 ]; then
    if [ "$VA_SEEDING_FAILED" -eq 0 ]; then
      VA_SEEDING_FAILED=1
      fail "VA role seeding rejected (role-aware gate not yet implemented)"
    fi
    return 1
  fi
}

setup_va_qualified_store "$STORE_BASE/va_valid" "qualified" "available"
setup_va_qualified_store "$STORE_BASE/va_unqual" "failed" "available"
setup_va_qualified_store "$STORE_BASE/va_exhausted" "qualified" "exhausted"

with_valid_stores() {
  local cmd=("$@")
  env ENGINE_SCORECARD_DIR="$STORE_BASE/valid" ENGINE_CAPABILITY_DIR="$STORE_BASE/valid" "${cmd[@]}"
}

# === CASE 1: Exit 2 - Schema/Usage Rejections ===

echo "--- Case 1.1: Absent contract ---"
out=$(invoke_checker "$TEST_TMP/nonexistent.json" "$MINI_REPO" 2>&1); rc=$?
assert_eq "$rc" "2"
assert_contains "$out" "contract"

echo "--- Case 1.2: Malformed JSON ---"
printf '{ "schema": 1, ' > "$CONTRACT_DIR/malformed.json"
out=$(invoke_checker "$CONTRACT_DIR/malformed.json" "$MINI_REPO" 2>&1); rc=$?
assert_eq "$rc" "2"

echo "--- Case 1.3: Unknown top-level key ---"
sed 's/"goal": "Implement core API",/"goal": "Implement core API", "unknown_key": true,/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/unknown_key.json"
out=$(invoke_checker "$CONTRACT_DIR/unknown_key.json" "$MINI_REPO" 2>&1); rc=$?
assert_eq "$rc" "2"

echo "--- Case 1.4: Wrong schema value ---"
sed 's/"schema": 1,/"schema": 2,/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/wrong_schema.json"
out=$(invoke_checker "$CONTRACT_DIR/wrong_schema.json" "$MINI_REPO" 2>&1); rc=$?
assert_eq "$rc" "2"

echo "--- Case 1.5: Short base SHA ---"
sed "s/\"$BASE_SHA\"/\"abcdef1234567890\"/" "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/short_base.json"
out=$(invoke_checker "$CONTRACT_DIR/short_base.json" "$MINI_REPO" 2>&1); rc=$?
assert_eq "$rc" "2"

assert_red_green_clean "$MINI_REPO"

# === CASE 2: Exit 3 - Repo State & Contract Policy Rejections ===

echo "--- Case 2.1: Spec file missing ---"
sed 's/"specs\/feat\/core.md"/"specs\/feat\/missing.md"/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/missing_spec.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/missing_spec.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "reasons"

echo "--- Case 2.2: Named section missing ---"
sed 's/"section": "API"/"section": "NONEXISTENT"/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/missing_section.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/missing_section.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "section"

echo "--- Case 2.3: Hidden clean spec drift ---"
# use assume-unchanged, then unset and restore
cp specs/feat/core.md "$TEST_TMP/core.md.bak"
git update-index --assume-unchanged specs/feat/core.md
echo "DRIFT" >> specs/feat/core.md
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "drift"
# restore
git update-index --no-assume-unchanged specs/feat/core.md
cp "$TEST_TMP/core.md.bak" specs/feat/core.md
git checkout -- specs/feat/core.md

echo "--- Case 2.4: Unresolvable full-hex base ---"
BAD_BASE_SHA=$(printf '%040d' 1)
sed "s/\"$BASE_SHA\"/\"$BAD_BASE_SHA\"/" "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/bad_base.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/bad_base.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "base"

echo "--- Case 2.5: Dirty tree ---"
echo "dirty" > specs/feat/core.md
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "dirty"
git checkout -- specs/feat/core.md

echo "--- Case 2.6: Missing dependency ---"
BAD_DEP_SHA=$(printf '%040d' 2)
sed "s/\"$DEP_SHA\"/\"$BAD_DEP_SHA\"/" "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/missing_dep.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/missing_dep.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "dependency"

echo "--- Case 2.7: Non-ancestor dependency ---"
# Create a genuine side commit
git checkout -q -b sidebranch
cat > src/side.txt <<'EOF'
side
EOF
git add .
git commit -q -m "Commit C side"
SIDE_SHA=$(git rev-parse HEAD)
git checkout -q master
sed "s/\"$DEP_SHA\"/\"$SIDE_SHA\"/" "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/nonancestor_dep.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/nonancestor_dep.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "ancestor"

echo "--- Case 2.8: Missing required path ---"
sed 's/"src\/main.go", "src\/util.go"/"src\/main.go", "src\/fake.go"/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/missing_path.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/missing_path.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "path"

assert_red_green_clean "$MINI_REPO"

# === CASE 3: Engine Gates (Exit 3) ===

echo "--- Case 3.1: Engine absent from store ---"
rm -rf "$STORE_BASE/empty"
mkdir -p "$STORE_BASE/empty"
out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "engine"
assert_not_contains "$out" "fallback"

echo "--- Case 3.2: Present but unqualified ---"
mkdir -p "$STORE_BASE/unqual"
SCORE_UNQUAL="$STORE_BASE/unqual/s.json"
cat > "$SCORE_UNQUAL" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"2/10","false_pass_critical":3,"specificity":"1/3"},"capability_score":0.1,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"failed","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
env ENGINE_SCORECARD_DIR="$STORE_BASE/unqual" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$SCORE_UNQUAL" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (unqual)"; exit 1
}
CAP_UNQUAL="$STORE_BASE/unqual/c.json"
cat > "$CAP_UNQUAL" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
env ENGINE_CAPABILITY_DIR="$STORE_BASE/unqual" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$CAP_UNQUAL" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (unqual)"; exit 1
}
out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/unqual" ENGINE_CAPABILITY_DIR="$STORE_BASE/unqual" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "qualified"
assert_not_contains "$out" "fallback"

echo "--- Case 3.3: Quota unknown ---"
mkdir -p "$STORE_BASE/noquota"
env ENGINE_SCORECARD_DIR="$STORE_BASE/noquota" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/valid/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (noquota)"; exit 1
}
CAP_NOQUOTA="$STORE_BASE/noquota/c.json"
cat > "$CAP_NOQUOTA" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0,"reset_at":null,"evidence":"none"}}}
EOF
env ENGINE_CAPABILITY_DIR="$STORE_BASE/noquota" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$CAP_NOQUOTA" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (noquota)"; exit 1
}
out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/noquota" ENGINE_CAPABILITY_DIR="$STORE_BASE/noquota" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "quota"
assert_not_contains "$out" "fallback"

echo "--- Case 3.4: Quota exhausted ---"
mkdir -p "$STORE_BASE/exhausted"
env ENGINE_SCORECARD_DIR="$STORE_BASE/exhausted" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/valid/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (exhausted)"; exit 1
}
CAP_EXH="$STORE_BASE/exhausted/c.json"
cat > "$CAP_EXH" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"exhausted","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"limit"}}}
EOF
env ENGINE_CAPABILITY_DIR="$STORE_BASE/exhausted" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$CAP_EXH" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (exhausted)"; exit 1
}
out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/exhausted" ENGINE_CAPABILITY_DIR="$STORE_BASE/exhausted" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "quota"
assert_not_contains "$out" "fallback"

assert_red_green_clean "$MINI_REPO"

# === CASE 4: Correct Rejection Class (Exit 2 for schema, 3 for policy) ===

echo "--- Case 4.1: Allow/deny overlap ---"
sed 's/"deny_paths": \["vendor\/"\]/"deny_paths": ["src\/"]/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/overlap.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/overlap.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "2"
assert_contains "$out" "overlap"

echo "--- Case 4.2: Omitted mandatory mirror ---"
# remove the .codex/mirror/copy.md path from allowlist to simulate mismatch, but easier: just make generated_mirrors empty and remove canonical declaration
cat > "$CONTRACT_DIR/no_mirror.json" <<EOF
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
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/no_mirror.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "2"
assert_contains "$out" "mirror"

echo "--- Case 4.3: Out-of-range budget ---"
sed 's/"wall_seconds": 60/"wall_seconds": 5000/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/bad_budget.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/bad_budget.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "2"

echo "--- Case 4.4: Shell-string acceptance entry ---"
cat > "$CONTRACT_DIR/shell_accept.json" <<EOF
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
  "acceptance": [
    {"argv": "tools/runner.sh", "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/shell_accept.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "2"

echo "--- Case 4.5: One required no_go key missing ---"
sed '/"on_clarification_needed": "stop",/d' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/missing_forbid.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/missing_forbid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "forbidden"

assert_red_green_clean "$MINI_REPO"

# === CASE 5 & 6: Valid Contract GO & Rerun ===

echo "--- Case 5: Valid contract GO ---"
git checkout -- . 2>/dev/null # restore pristine
setup_qualified_store "$STORE_BASE/valid"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?

assert_eq "$rc" "0"

# Assert exact keyset
keys=$(json_keys "$out" 2>/dev/null) || keys=""
assert_eq "$keys" "contract_sha256,reasons,resolved_engine,spec_sha256,unit_id,verdict"

# Extract and assert parsed JSON fields precisely
field=$(json_get "$out" "verdict") || fail "verdict extraction failed"
assert_eq "$field" "GO"

field=$(json_get "$out" "unit_id") || fail "unit_id extraction failed"
assert_eq "$field" "feat-core-impl"

field=$(json_get "$out" "contract_sha256") || fail "contract_sha256 extraction failed"
assert_eq "$field" "$CONTRACT_SHA"

field=$(json_get "$out" "spec_sha256") || fail "spec_sha256 extraction failed"
assert_eq "$field" "$SPEC_SHA"

# Assert nested fields independently
field=$(json_get "$out" "resolved_engine.runner") || fail "resolved_engine.runner extraction failed"
assert_eq "$field" "codex"

field=$(json_get "$out" "resolved_engine.model") || fail "resolved_engine.model extraction failed"
assert_eq "$field" "gpt-5.3-codex-spark"

field=$(json_get "$out" "resolved_engine.family") || fail "resolved_engine.family extraction failed"
assert_eq "$field" "openai"

field=$(json_get "$out" "reasons") || fail "reasons extraction failed"
assert_eq "$field" "[]"

assert_not_contains "$out" "SECRET_FIXTURE"
assert_red_green_clean "$MINI_REPO"

echo "--- Case 6: Immediate identical rerun ---"
out2=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc2=$?

assert_eq "$rc2" "0"

# Compare parsed values from Run 1 and Run 2
field=$(json_get "$out2" "verdict") || fail "verdict extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "verdict")"

field=$(json_get "$out2" "unit_id") || fail "unit_id extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "unit_id")"

field=$(json_get "$out2" "contract_sha256") || fail "contract_sha256 extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "contract_sha256")"

field=$(json_get "$out2" "spec_sha256") || fail "spec_sha256 extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "spec_sha256")"

# Compare nested keys for run 2
field=$(json_get "$out2" "resolved_engine.runner") || fail "resolved_engine.runner extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "resolved_engine.runner")"

field=$(json_get "$out2" "resolved_engine.model") || fail "resolved_engine.model extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "resolved_engine.model")"

field=$(json_get "$out2" "resolved_engine.family") || fail "resolved_engine.family extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "resolved_engine.family")"

field=$(json_get "$out2" "reasons") || fail "reasons extraction failed (run 2)"
assert_eq "$field" "$(json_get "$out" "reasons")"

assert_red_green_clean "$MINI_REPO"

# === CASE 7: Verification Author Role Cases ===

if [ "$VA_SEEDING_FAILED" -eq 0 ]; then
  echo "--- Case 7.1: VA-1 GO (Role-aware resolution) ---"
  git checkout -- . 2>/dev/null
  setup_va_qualified_store "$STORE_BASE/va_valid" "qualified" "available"
  out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/va_valid" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_valid" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?

  assert_eq "$rc" "0"

  # Assert exact keyset
  keys=$(json_keys "$out" 2>/dev/null) || keys=""
  assert_eq "$keys" "contract_sha256,reasons,resolved_engine,spec_sha256,unit_id,verdict"

  field=$(json_get "$out" "verdict") || fail "verdict extraction failed"
  assert_eq "$field" "GO"

  # Assert nested fields independently (proves we selected the VA tuple)
  field=$(json_get "$out" "resolved_engine.runner") || fail "resolved_engine.runner extraction failed"
  assert_eq "$field" "anthropic-compatible"

  field=$(json_get "$out" "resolved_engine.model") || fail "resolved_engine.model extraction failed"
  assert_eq "$field" "glm-5.2"

  field=$(json_get "$out" "resolved_engine.family") || fail "resolved_engine.family extraction failed"
  assert_eq "$field" "zhipu"

  field=$(json_get "$out" "reasons") || fail "reasons extraction failed"
  assert_eq "$field" "[]"

  assert_not_contains "$out" "SECRET_FIXTURE"
  assert_red_green_clean "$MINI_REPO"

  echo "--- Case 7.2: VA-2 Unqualified (VA status failed, implementer qualified) ---"
  git checkout -- . 2>/dev/null
  touch "$MINI_REPO/oracle.test.sh"
  out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/va_unqual" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_unqual" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?

  assert_eq "$rc" "3"
  assert_nogo_json "$out" "engine"

  # Model must still be glm-5.2 (proves no silent substitution of implementer tuple)
  field=$(json_get "$out" "resolved_engine.model") || fail "resolved_engine.model extraction failed (va unqual)"
  assert_eq "$field" "glm-5.2"

  assert_not_contains "$out" "SECRET_FIXTURE"
  assert_red_green_clean "$MINI_REPO"
  rm -f "$MINI_REPO/oracle.test.sh"

  echo "--- Case 7.3: VA-3 Quota exhausted ---"
  git checkout -- . 2>/dev/null
  touch "$MINI_REPO/oracle.test.sh"
  out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/va_exhausted" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_exhausted" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?

  assert_eq "$rc" "3"
  assert_nogo_json "$out" "quota"

  assert_not_contains "$out" "SECRET_FIXTURE"
  assert_red_green_clean "$MINI_REPO"
  rm -f "$MINI_REPO/oracle.test.sh"
fi

finalize_test