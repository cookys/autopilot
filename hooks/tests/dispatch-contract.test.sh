#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

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
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
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
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
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
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
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
{"schema_version":1,"observed_at":"$(utc_now)","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"$quota_status","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
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

echo "--- Case 2.2b: Four-space indented ATX is not a heading ---"
# CommonMark: 0..3 leading spaces only. Four spaces is code, so section is missing.
cp specs/feat/core.md "$TEST_TMP/core-atx.md.bak"
# Rewrite the API heading under four-space indent only.
python3 - <<'PY'
from pathlib import Path
p = Path('specs/feat/core.md')
text = p.read_text()
# Ensure a bare API heading exists, then indent it four spaces.
lines = []
for line in text.splitlines(True):
    if line.lstrip().startswith('#') and 'API' in line and not line.startswith('    #'):
        lines.append('    ' + line.lstrip())
    else:
        lines.append(line)
p.write_text(''.join(lines))
PY
git add specs/feat/core.md
git commit -qm "indent API heading as code" >/dev/null 2>&1 || true
# Point contract base to HEAD so the indented blob is authoritative.
HEAD_SHA=$(git rev-parse HEAD)
python3 - <<PY
import json
from pathlib import Path
contract = json.loads(Path("$CONTRACT_DIR/valid.json").read_text())
contract["base_sha"] = "$HEAD_SHA"
Path("$CONTRACT_DIR/indented_section.json").write_text(json.dumps(contract, indent=2) + "\n")
PY
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/indented_section.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "section"
# restore
cp "$TEST_TMP/core-atx.md.bak" specs/feat/core.md
git add specs/feat/core.md
git commit -qm "restore API heading" >/dev/null 2>&1 || true
# also restore valid contract base if needed via later tests using valid.json's original base

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
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
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
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0,"reset_at":null,"evidence":"none"}}}
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
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"exhausted","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"limit"}}}
EOF
env ENGINE_CAPABILITY_DIR="$STORE_BASE/exhausted" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$CAP_EXH" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (exhausted)"; exit 1
}
out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/exhausted" ENGINE_CAPABILITY_DIR="$STORE_BASE/exhausted" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "quota"
assert_not_contains "$out" "fallback"

echo "--- Case 3.5: FINDING 5 fix (2026-08-22 review repair) — operator override MUST NOT bypass a strike block ---"
# Board ruling: the evidence-free per-invocation --qualification-override is
# NOT a valid exit from admission_status: 'requalify_required'. The only exit
# from a strike block is a fresh PASSING administration (strike-decay.md);
# an override bypassing it would be exactly the rerun-until-green /
# talk-your-way-out escape the design forbids. Named regression (panel,
# mandatory): override file present + a requalify_required row => NO-GO.
mkdir -p "$STORE_BASE/strike_override"
env ENGINE_SCORECARD_DIR="$STORE_BASE/strike_override" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/valid/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (strike_override)"; exit 1
}
env ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_override" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/valid/cap.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (strike_override, quota)"; exit 1
}
# A single critical_reexam_trigger strike is enough — it ENFORCES regardless
# of AUTOPILOT_STRIKE_ENFORCEMENT (shadow is the ambient default here), unlike
# ordinary_strike which needs 3 + --enforce. Registered predicate, allowlisted
# writer, well-formed artifact hash — a countable strike per §2.7.
env ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_override" node "$REPO_ROOT/scripts/engine-capability-state.js" strike-seat \
  --engine gpt-5.3-codex-spark --runner codex --role implementer \
  --class critical_reexam_trigger --predicate-id security_canary_disclosure \
  --cause-class engine_output --writer fuse --dedup-key "f5-inc-1:det-1" \
  --detector-id det-1 --detector-version v1 \
  --artifact-sha256 "$(printf 'a%.0s' $(seq 1 64))" --receipt-ref "rcpt-f5-1" \
  --now "2026-07-01T00:00:00Z" \
  > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js strike-seat failed setup (strike_override)"; exit 1
}
cat > "$TEST_TMP/override-f5.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"gpt-5.3-codex-spark","runner":"codex","role":"implementer","reason":"operator accepts risk","operator":"cookys","expires":"2099-01-01"}]}
JSON
out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/strike_override" ENGINE_CAPABILITY_DIR="$STORE_BASE/strike_override" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --qualification-override "$TEST_TMP/override-f5.json" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "requalification"
assert_not_contains "$out" "operator-override"
assert_contains "$out" "critical_reexam_trigger" "the NO-GO reason names the strike cause, distinguishing it from a plain no-record NO-GO"

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
  "output": {"kind": "commit", "paths": ["src/"]},
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
sed 's/"wall_seconds": 60/"wall_seconds": 15000/' "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/bad_budget.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/bad_budget.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "2"
# Message assertion so the next ceiling change fails loudly instead of rotting
# the way 5000 did when the cap moved 3600 -> 14400 (2026-08-31).
assert_contains "$out" "wall_seconds"

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
  out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/va_unqual" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_unqual" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?

  assert_eq "$rc" "3"
  assert_nogo_json "$out" "engine"

  # Model must still be glm-5.2 (proves no silent substitution of implementer tuple)
  field=$(json_get "$out" "resolved_engine.model") || fail "resolved_engine.model extraction failed (va unqual)"
  assert_eq "$field" "glm-5.2"

  assert_not_contains "$out" "SECRET_FIXTURE"
  assert_red_green_clean "$MINI_REPO"

  echo "--- Case 7.3: VA-3 Quota exhausted ---"
  git checkout -- . 2>/dev/null
  out=$(env ENGINE_SCORECARD_DIR="$STORE_BASE/va_exhausted" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_exhausted" node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?

  assert_eq "$rc" "3"
  assert_nogo_json "$out" "quota"

  assert_not_contains "$out" "SECRET_FIXTURE"
  assert_red_green_clean "$MINI_REPO"
fi

# === CASE 9: output.paths that can never be satisfied (pre-spend catch) ===
#
# For output.kind=commit, dispatch-hetero's boundary check matches output.paths
# EXACTLY against `git diff --name-only` (scripts/dispatch-hetero.sh, "output.paths
# must be a subset of changed files"). A directory therefore can never appear, so the
# unit is guaranteed boundary_rejected AFTER the runner has already been paid for.
# The checker can prove that before any spend.
echo "--- Case 9.1: directory in output.paths (kind=commit) is NO-GO ---"
sed 's|"output": {"kind": "diff", "paths": \["src/"\]}|"output": {"kind": "commit", "paths": ["src"]}|' \
  "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/outdir.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/outdir.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "output"

echo "--- Case 9.2: trailing-slash directory (kind=commit) is NO-GO ---"
sed 's|"output": {"kind": "diff", "paths": \["src/"\]}|"output": {"kind": "commit", "paths": ["src/"]}|' \
  "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/outslash.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/outslash.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "output"

echo "--- Case 9.3: negative control — file paths (kind=commit) still GO ---"
sed 's|"output": {"kind": "diff", "paths": \["src/"\]}|"output": {"kind": "commit", "paths": ["src/main.go"]}|' \
  "$CONTRACT_DIR/valid.json" > "$CONTRACT_DIR/outfile.json"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/outfile.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "0"

echo "--- Case 9.4: negative control — kind=diff keeps accepting directories ---"
out=$(with_valid_stores node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "0"

assert_red_green_clean "$MINI_REPO"

# === CASE 10: Provisional implementer admission (no legacy projection) ===
# Disk-backed scorecard projects evidence-backed qualified rows as provisional.
# Implementer may GO with assurance=provisional; other roles stay fail-closed.

echo "--- Case 10.1: provisional implementer GO (native projection) ---"
setup_qualified_store "$STORE_BASE/provisional_impl"
# Force clean Node options so the legacy test preload does not rewrite provisional→qualified.
out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/provisional_impl" ENGINE_CAPABILITY_DIR="$STORE_BASE/provisional_impl" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "0"
keys=$(json_keys "$out" 2>/dev/null) || keys=""
assert_eq "$keys" "assurance,contract_sha256,reasons,resolved_engine,spec_sha256,unit_id,verdict"
field=$(json_get "$out" "verdict") || fail "provisional implementer verdict extraction failed"
assert_eq "$field" "GO"
field=$(json_get "$out" "assurance") || fail "provisional implementer assurance extraction failed"
assert_eq "$field" "provisional"
field=$(json_get "$out" "resolved_engine.model") || fail "provisional implementer model extraction failed"
assert_eq "$field" "gpt-5.3-codex-spark"
field=$(json_get "$out" "resolved_engine.runner") || fail "provisional implementer runner extraction failed"
assert_eq "$field" "codex"
# Must not claim full qualification.
assert_not_contains "$out" '"assurance":"qualified"'
assert_not_contains "$out" '"status":"qualified"'

echo "--- Case 10.1b: provisional row without observed_status=qualified is NO-GO ---"
# Disk projects provisional+observed_status=qualified. Force a non-qualified
# observed_status through a one-shot preload so missing/unknown/provisional
# observations stay fail-closed and never promote telemetry.
setup_qualified_store "$STORE_BASE/provisional_no_observed"
PRELOAD_OBS="$TEST_TMP/provisional-observed-rewrite.cjs"
cat > "$PRELOAD_OBS" <<'NODE'
'use strict';
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;
const rewriteTo = process.env.AUTOPILOT_TEST_REWRITE_OBSERVED_STATUS || '';
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
      if (rewriteTo === '__delete__') {
        const next = { ...row };
        delete next.observed_status;
        return next;
      }
      return { ...row, observed_status: rewriteTo };
    });
    return { ...result, stdout: `${JSON.stringify(projected)}\n` };
  } catch {
    return result;
  }
};
NODE
for obs_case in missing provisional unknown; do
  if [ "$obs_case" = "missing" ]; then
    rewrite='__delete__'
  else
    rewrite="$obs_case"
  fi
  out=$(env NODE_OPTIONS="--require=$PRELOAD_OBS" \
    AUTOPILOT_TEST_REWRITE_OBSERVED_STATUS="$rewrite" \
    ENGINE_SCORECARD_DIR="$STORE_BASE/provisional_no_observed" \
    ENGINE_CAPABILITY_DIR="$STORE_BASE/provisional_no_observed" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3" "observed_status=$obs_case must NO-GO"
  assert_nogo_json "$out" "qualified"
done

echo "--- Case 10.2: failed implementer remains NO-GO under native projection ---"
setup_qualified_store "$STORE_BASE/failed_impl"
cat > "$STORE_BASE/failed_impl/score.json" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"2/10","false_pass_critical":3,"specificity":"1/3"},"capability_score":0.1,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"failed","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
env ENGINE_SCORECARD_DIR="$STORE_BASE/failed_impl" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/failed_impl/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (failed_impl)"; exit 1
}
out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/failed_impl" ENGINE_CAPABILITY_DIR="$STORE_BASE/failed_impl" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "qualified"

echo "--- Case 10.3: past-expires implementer GOes under native projection (calendar tooth pulled 2026-08-22) ---"
# KR2 at the dispatch-contract layer: expires is advisory-only and never
# blocks admission. Pre-cut this row NO-GOed as "expired"; now it GOes with
# assurance=provisional exactly like Case 10.1 (observed_status=qualified).
setup_qualified_store "$STORE_BASE/expired_impl"
cat > "$STORE_BASE/expired_impl/score.json" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2020-01-01","expires":"2020-01-02"}
EOF
env ENGINE_SCORECARD_DIR="$STORE_BASE/expired_impl" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/expired_impl/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (expired_impl)"; exit 1
}
out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/expired_impl" ENGINE_CAPABILITY_DIR="$STORE_BASE/expired_impl" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "0" "past-expires implementer row GOes (rc=0)"
field=$(json_get "$out" "verdict") || fail "past-expires implementer verdict extraction failed"
assert_eq "$field" "GO"
field=$(json_get "$out" "assurance") || fail "past-expires implementer assurance extraction failed"
assert_eq "$field" "provisional"

echo "--- Case 10.4: identity-mismatched implementer remains NO-GO ---"
# Capability for the resolved engine only — scorecard row intentionally wrong model.
rm -rf "$STORE_BASE/mismatch_impl"
mkdir -p "$STORE_BASE/mismatch_impl"
cat > "$STORE_BASE/mismatch_impl/score.json" <<'EOF'
{"engine":"wrong-model","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
env ENGINE_SCORECARD_DIR="$STORE_BASE/mismatch_impl" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/mismatch_impl/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (mismatch_impl)"; exit 1
}
cat > "$STORE_BASE/mismatch_impl/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
env ENGINE_CAPABILITY_DIR="$STORE_BASE/mismatch_impl" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/mismatch_impl/cap.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (mismatch_impl)"; exit 1
}
out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/mismatch_impl" ENGINE_CAPABILITY_DIR="$STORE_BASE/mismatch_impl" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "qualified"

echo "--- Case 10.5: runner-mismatched implementer remains NO-GO ---"
rm -rf "$STORE_BASE/runner_mismatch"
mkdir -p "$STORE_BASE/runner_mismatch"
cat > "$STORE_BASE/runner_mismatch/score.json" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"claude","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
env ENGINE_SCORECARD_DIR="$STORE_BASE/runner_mismatch" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/runner_mismatch/score.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-scorecard.js failed setup (runner_mismatch)"; exit 1
}
cat > "$STORE_BASE/runner_mismatch/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
env ENGINE_CAPABILITY_DIR="$STORE_BASE/runner_mismatch" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/runner_mismatch/cap.json" > /dev/null 2>&1 || {
  echo "FATAL: engine-capability-state.js failed setup (runner_mismatch)"; exit 1
}
out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/runner_mismatch" ENGINE_CAPABILITY_DIR="$STORE_BASE/runner_mismatch" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "qualified"

echo "--- Case 10.6: missing implementer scorecard remains NO-GO ---"
out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/empty" ENGINE_CAPABILITY_DIR="$STORE_BASE/empty" \
  node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
assert_eq "$rc" "3"
assert_nogo_json "$out" "qualified"

if [ "$VA_SEEDING_FAILED" -eq 0 ]; then
  echo "--- Case 10.7: provisional verification-author GO for raw-artifact only ---"
  # Seed VA as qualified so disk projects provisional; without legacy rewrite it stays provisional.
  # raw-artifact authoring labor may GO with assurance=provisional; no review/merge authority.
  setup_va_qualified_store "$STORE_BASE/va_provisional" "qualified" "available"
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/va_provisional" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_provisional" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "0"
  keys=$(json_keys "$out" 2>/dev/null) || keys=""
  assert_eq "$keys" "assurance,contract_sha256,reasons,resolved_engine,spec_sha256,unit_id,verdict"
  field=$(json_get "$out" "verdict") || fail "provisional VA verdict extraction failed"
  assert_eq "$field" "GO"
  field=$(json_get "$out" "assurance") || fail "provisional VA assurance extraction failed"
  assert_eq "$field" "provisional"
  field=$(json_get "$out" "resolved_engine.model") || fail "provisional VA model extraction failed"
  assert_eq "$field" "glm-5.2"
  field=$(json_get "$out" "resolved_engine.runner") || fail "provisional VA runner extraction failed"
  assert_eq "$field" "anthropic-compatible"
  field=$(json_get "$out" "resolved_engine.family") || fail "provisional VA family extraction failed"
  assert_eq "$field" "zhipu"
  assert_not_contains "$out" '"assurance":"qualified"'
  assert_not_contains "$out" '"status":"qualified"'

  echo "--- Case 10.7b: provisional VA without observed_status=qualified is NO-GO ---"
  PRELOAD_VA_OBS="$TEST_TMP/provisional-va-observed-rewrite.cjs"
  cat > "$PRELOAD_VA_OBS" <<'NODE'
'use strict';
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;
const rewriteTo = process.env.AUTOPILOT_TEST_REWRITE_OBSERVED_STATUS || '';
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
      if (!row || row.status !== 'provisional' || row.role !== 'verification_author') return row;
      if (rewriteTo === '__delete__') {
        const next = { ...row };
        delete next.observed_status;
        return next;
      }
      return { ...row, observed_status: rewriteTo };
    });
    return { ...result, stdout: `${JSON.stringify(projected)}\n` };
  } catch {
    return result;
  }
};
NODE
  for obs_case in missing provisional unknown; do
    if [ "$obs_case" = "missing" ]; then
      rewrite='__delete__'
    else
      rewrite="$obs_case"
    fi
    out=$(env NODE_OPTIONS="--require=$PRELOAD_VA_OBS" \
      AUTOPILOT_TEST_REWRITE_OBSERVED_STATUS="$rewrite" \
      ENGINE_SCORECARD_DIR="$STORE_BASE/va_provisional" \
      ENGINE_CAPABILITY_DIR="$STORE_BASE/va_provisional" \
      node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
    assert_eq "$rc" "3" "VA observed_status=$obs_case must NO-GO"
    assert_nogo_json "$out" "qualified"
  done

  echo "--- Case 10.7c: provisional VA with non-raw-artifact output is NO-GO ---"
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
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/va_provisional" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_provisional" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_verdict.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "qualified"

  echo "--- Case 10.7d: failed VA remains NO-GO under native projection ---"
  setup_va_qualified_store "$STORE_BASE/va_failed" "failed" "available"
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/va_failed" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_failed" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "qualified"

  echo "--- Case 10.7e: identity-mismatched VA remains NO-GO ---"
  rm -rf "$STORE_BASE/va_mismatch"
  mkdir -p "$STORE_BASE/va_mismatch"
  cat > "$STORE_BASE/va_mismatch/score.json" <<'EOF'
{"engine":"wrong-va-model","runner":"anthropic-compatible","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$STORE_BASE/va_mismatch" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/va_mismatch/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (va_mismatch)"; exit 1
  }
  cat > "$STORE_BASE/va_mismatch/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/va_mismatch" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/va_mismatch/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (va_mismatch)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/va_mismatch" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_mismatch" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "qualified"

  # === CASE 11: Exact resolver-tuple quota admission (effort + endpoint partition) ===
  # Production bug: dispatch-contract omitted effort/endpoint and queried the legacy
  # ambiguous partition, rejecting campaigns whose exact high/@none wallet was available.

  echo "--- Case 11.1: exact high/@none available admits despite legacy ambiguous unknown (implementer) ---"
  rm -rf "$STORE_BASE/exact_impl_quota"
  mkdir -p "$STORE_BASE/exact_impl_quota"
  cat > "$STORE_BASE/exact_impl_quota/score.json" <<'EOF'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_impl_quota" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_impl_quota)"; exit 1
  }
  # Legacy ambiguous row: no effort/endpoint fields → unknown (must NOT authorize).
  cat > "$STORE_BASE/exact_impl_quota/cap_legacy.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","runner_version":"v1.0.0","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0,"reset_at":null,"evidence":"legacy-ambiguous"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_quota" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_impl_quota/cap_legacy.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_impl_quota legacy)"; exit 1
  }
  # Exact partition matching resolver default implementer_effort=high, endpoint="".
  cat > "$STORE_BASE/exact_impl_quota/cap_exact.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"exact-high-null"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_quota" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_impl_quota/cap_exact.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_impl_quota exact)"; exit 1
  }
  # Sanity: legacy-only query is unknown; exact query is available.
  leg=$(env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_quota" node "$REPO_ROOT/scripts/engine-capability-state.js" current --runner codex --model gpt-5.3-codex-spark --role implementer 2>/dev/null) || true
  assert_contains "$leg" '"status":"unknown"'
  ex=$(env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_quota" node "$REPO_ROOT/scripts/engine-capability-state.js" current --runner codex --model gpt-5.3-codex-spark --role implementer --effort high --endpoint @none 2>/dev/null) || true
  assert_contains "$ex" '"status":"available"'
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_impl_quota" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_quota" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "0"
  field=$(json_get "$out" "verdict") || fail "exact-impl quota verdict extraction failed"
  assert_eq "$field" "GO"
  # Public resolved_engine shape unchanged (no effort/endpoint leak).
  field=$(json_get "$out" "resolved_engine") || fail "exact-impl resolved_engine extraction failed"
  assert_eq "$field" '{"runner":"codex","model":"gpt-5.3-codex-spark","family":"openai"}'
  assert_no_secret "$out"

  echo "--- Case 11.2: competing effort cannot authorize configured implementer tuple ---"
  rm -rf "$STORE_BASE/exact_impl_competing_effort"
  mkdir -p "$STORE_BASE/exact_impl_competing_effort"
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_impl_competing_effort" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_impl_competing_effort)"; exit 1
  }
  cat > "$STORE_BASE/exact_impl_competing_effort/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"low","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"competing-low"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_competing_effort" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_impl_competing_effort/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_impl_competing_effort)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_impl_competing_effort" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_competing_effort" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "quota"

  echo "--- Case 11.3: competing endpoint cannot authorize configured implementer tuple ---"
  rm -rf "$STORE_BASE/exact_impl_competing_ep"
  mkdir -p "$STORE_BASE/exact_impl_competing_ep"
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_impl_competing_ep" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_impl_competing_ep)"; exit 1
  }
  cat > "$STORE_BASE/exact_impl_competing_ep/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":"wallet_a","runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"competing-endpoint"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_competing_ep" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_impl_competing_ep/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_impl_competing_ep)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_impl_competing_ep" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_impl_competing_ep" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "quota"

  echo "--- Case 11.4: exact high/@none available admits despite legacy unknown (verification-author) ---"
  rm -rf "$STORE_BASE/exact_va_quota"
  mkdir -p "$STORE_BASE/exact_va_quota"
  # Scorecard: implementer row not required for VA path; seed VA only.
  cat > "$STORE_BASE/exact_va_quota/va_score.json" <<'EOF'
{"engine":"glm-5.2","runner":"anthropic-compatible","family":"zhipu","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_va_quota" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_va_quota/va_score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_va_quota)"; exit 1
  }
  cat > "$STORE_BASE/exact_va_quota/cap_legacy.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","runner_version":"v1.0.0","capability":{"quota":{"status":"unknown","confidence":"low","ttl_seconds":0,"reset_at":null,"evidence":"legacy-ambiguous"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_va_quota" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_va_quota/cap_legacy.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_va_quota legacy)"; exit 1
  }
  cat > "$STORE_BASE/exact_va_quota/cap_exact.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"exact-high-null"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_va_quota" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_va_quota/cap_exact.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_va_quota exact)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_va_quota" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_va_quota" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "0"
  field=$(json_get "$out" "verdict") || fail "exact-va quota verdict extraction failed"
  assert_eq "$field" "GO"
  field=$(json_get "$out" "resolved_engine.runner") || fail "exact-va runner extraction failed"
  assert_eq "$field" "anthropic-compatible"
  field=$(json_get "$out" "resolved_engine.model") || fail "exact-va model extraction failed"
  assert_eq "$field" "glm-5.2"
  assert_no_secret "$out"

  echo "--- Case 11.5: competing effort cannot authorize configured verification-author tuple ---"
  rm -rf "$STORE_BASE/exact_va_competing_effort"
  mkdir -p "$STORE_BASE/exact_va_competing_effort"
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_va_competing_effort" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_va_quota/va_score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_va_competing_effort)"; exit 1
  }
  cat > "$STORE_BASE/exact_va_competing_effort/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"anthropic-compatible","model":"glm-5.2","role":"verification_author","effort":"xhigh","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"competing-xhigh"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_va_competing_effort" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_va_competing_effort/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_va_competing_effort)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_va_competing_effort" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_va_competing_effort" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "quota"

  echo "--- Case 11.6: implementer exact wallet does not authorize verification-author path ---"
  # Role-aware: implementer exact available on codex/gpt-5.3 must not GO a VA contract
  # whose resolver tuple is anthropic-compatible/glm-5.2 (scorecard also absent for VA).
  rm -rf "$STORE_BASE/exact_role_cross"
  mkdir -p "$STORE_BASE/exact_role_cross"
  # Only implementer scorecard + exact implementer cap.
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_role_cross" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_role_cross)"; exit 1
  }
  cat > "$STORE_BASE/exact_role_cross/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"impl-only"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_role_cross" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_role_cross/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_role_cross)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_role_cross" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_role_cross" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_valid.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  # Fail-closed on missing VA scorecard (role-aware), not a false implementer GO.
  assert_nogo_json "$out" "qualified"
  field=$(json_get "$out" "resolved_engine.model") || fail "role-cross VA model extraction failed"
  assert_eq "$field" "glm-5.2"

  echo "--- Case 11.7: named endpoint exact wallet admits; competing null wallet alone cannot ---"
  # Pin implementer_endpoint so the resolver emits a named wallet (not "").
  (
    cd "$MINI_REPO"
    cat > .claude/review-loop-config.md <<'EOF'
# Review Loop Config
- implementer_engine: gpt-5.3-codex-spark
- implementer_runner: codex
- reviewer_engine: claude-opus
- reviewer_runner: claude-native
- implementer_effort: high
- implementer_endpoint: wallet_a
- verification_author_present: true
- verification_author_engine: glm-5.2
- verification_author_runner: anthropic-compatible
- verification_author_effort: high
EOF
    git add .claude/review-loop-config.md >/dev/null 2>&1
    git commit -m "named endpoint fixture" >/dev/null 2>&1
  )
  NAMED_BASE=$(cd "$MINI_REPO" && git rev-parse HEAD)
  cat > "$CONTRACT_DIR/named_endpoint.json" <<EOF
{
  "schema": 1,
  "unit_id": "feat-named-ep",
  "role": "implementer",
  "goal": "Implement core API",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$NAMED_BASE",
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
  # Competing null wallet only — must not authorize named-endpoint tuple.
  rm -rf "$STORE_BASE/exact_named_null_only"
  mkdir -p "$STORE_BASE/exact_named_null_only"
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_named_null_only" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_named_null_only)"; exit 1
  }
  cat > "$STORE_BASE/exact_named_null_only/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"competing-null"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_named_null_only" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_named_null_only/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_named_null_only)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_named_null_only" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_named_null_only" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/named_endpoint.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "quota"

  # Exact named wallet available (plus competing null) → GO.
  rm -rf "$STORE_BASE/exact_named_ok"
  mkdir -p "$STORE_BASE/exact_named_ok"
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_named_ok" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_named_ok)"; exit 1
  }
  cat > "$STORE_BASE/exact_named_ok/cap_null.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"competing-null"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_named_ok" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_named_ok/cap_null.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_named_ok null)"; exit 1
  }
  cat > "$STORE_BASE/exact_named_ok/cap_named.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":"wallet_a","runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"exact-named"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_named_ok" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_named_ok/cap_named.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_named_ok named)"; exit 1
  }
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/exact_named_ok" ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_named_ok" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/named_endpoint.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "0"
  field=$(json_get "$out" "verdict") || fail "named-endpoint verdict extraction failed"
  assert_eq "$field" "GO"
  field=$(json_get "$out" "resolved_engine") || fail "named-endpoint resolved_engine extraction failed"
  assert_eq "$field" '{"runner":"codex","model":"gpt-5.3-codex-spark","family":"openai"}'
  assert_no_secret "$out"

  # Restore default empty-endpoint config for subsequent cases.
  (
    cd "$MINI_REPO"
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
SECRET_FIXTURE_DO_NOT_LEAK
EOF
    git add .claude/review-loop-config.md >/dev/null 2>&1
    git commit -m "restore default endpoint fixture" >/dev/null 2>&1
  )
  RESTORED_BASE=$(cd "$MINI_REPO" && git rev-parse HEAD)
  # Refresh contracts that pin base_sha for later cases that still use valid.json
  # with the original BASE_SHA (ancestor of restored HEAD) — dirty/base still ok
  # as long as base is an ancestor and tree is clean.

  echo "--- Case 11.8: resolver response missing endpoint property is NO-GO before quota ---"
  # Defense-in-depth: absent implementer_endpoint must not map to @none.
  rm -rf "$STORE_BASE/exact_missing_ep"
  mkdir -p "$STORE_BASE/exact_missing_ep"
  env ENGINE_SCORECARD_DIR="$STORE_BASE/exact_missing_ep" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/exact_impl_quota/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (exact_missing_ep)"; exit 1
  }
  # Seed exact high/@none available so a silent @none fallback would wrongly GO.
  cat > "$STORE_BASE/exact_missing_ep/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"codex","model":"gpt-5.3-codex-spark","role":"implementer","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"would-authorize-if-fallback"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_missing_ep" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/exact_missing_ep/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (exact_missing_ep)"; exit 1
  }
  PRELOAD_STRIP_EP="$TEST_TMP/strip-resolver-endpoint.cjs"
  cat > "$PRELOAD_STRIP_EP" <<'NODE'
'use strict';
const path = require('path');
const childProcess = require('child_process');
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function strippedEndpointSpawn(command, args, options) {
  const result = originalSpawnSync.call(this, command, args, options);
  if (!Array.isArray(args) || result.status !== 0) return result;
  const joined = args.map(String).join(' ');
  if (!joined.includes('resolve-review-loop.sh')) return result;
  try {
    const parsed = JSON.parse(String(result.stdout || ''));
    delete parsed.implementer_endpoint;
    delete parsed.verification_author_endpoint;
    return { ...result, stdout: `${JSON.stringify(parsed)}\n` };
  } catch {
    return result;
  }
};
NODE
  # Use a contract whose base is the restored HEAD (clean tree).
  cat > "$CONTRACT_DIR/missing_ep.json" <<EOF
{
  "schema": 1,
  "unit_id": "feat-missing-ep",
  "role": "implementer",
  "goal": "Implement core API",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$RESTORED_BASE",
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
  out=$(env NODE_OPTIONS="--require=$PRELOAD_STRIP_EP" \
    ENGINE_SCORECARD_DIR="$STORE_BASE/exact_missing_ep" \
    ENGINE_CAPABILITY_DIR="$STORE_BASE/exact_missing_ep" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/missing_ep.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "3"
  assert_nogo_json "$out" "endpoint"
  assert_contains "$out" "missing endpoint"
  # Must not be a quota-only failure that would imply an @none query succeeded as "unavailable".
  # Engine resolution fails closed; quota reason may be absent.
  assert_not_contains "$out" "would-authorize-if-fallback"
  assert_no_secret "$out"

  echo "--- Case 10.8: /l6 config tuple VA family differs from Grok implementer ---"
  # Regression: project-pinned /l6 VA must not resolve to the same family as the
  # Grok implementer (xai). Mini-repo config is rewritten to the real /l6 pair.
  git checkout -- . 2>/dev/null || true
  cat > "$MINI_REPO/.claude/review-loop-config.md" <<'EOF'
# Review Loop Config (l6 family decorrelation regression)
- implementer_engine: grok-4.5
- implementer_runner: grok
- implementer_effort: high
- verification_author_present: true
- verification_author_engine: Gemini 3.5 Flash (High)
- verification_author_runner: agy
- verification_author_effort: high
EOF
  # Scorecard/capability for the Gemini VA tuple only (strict author path).
  rm -rf "$STORE_BASE/va_l6_family"
  mkdir -p "$STORE_BASE/va_l6_family"
  cat > "$STORE_BASE/va_l6_family/score.json" <<'EOF'
{"engine":"Gemini 3.5 Flash (High)","runner":"agy","family":"google","role":"verification_author","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
  env ENGINE_SCORECARD_DIR="$STORE_BASE/va_l6_family" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$STORE_BASE/va_l6_family/score.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-scorecard.js failed setup (va_l6_family)"; exit 1
  }
  cat > "$STORE_BASE/va_l6_family/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"agy","model":"Gemini 3.5 Flash (High)","role":"verification_author","effort":"high","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$STORE_BASE/va_l6_family" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$STORE_BASE/va_l6_family/cap.json" > /dev/null 2>&1 || {
    echo "FATAL: engine-capability-state.js failed setup (va_l6_family)"; exit 1
  }
  # Commit config so dirty-base does not NO-GO; recompute base for the contract.
  (
    cd "$MINI_REPO"
    git add .claude/review-loop-config.md >/dev/null 2>&1
    git commit -m "l6 family decorrelation fixture" >/dev/null 2>&1
  )
  L6_BASE=$(cd "$MINI_REPO" && git rev-parse HEAD)
  cat > "$CONTRACT_DIR/va_l6_family.json" <<EOF
{
  "schema": 1,
  "unit_id": "l6-family-va",
  "role": "verification-author",
  "goal": "Author harness",
  "spec": {"path": "specs/feat/core.md", "section": "API"},
  "base_sha": "$L6_BASE",
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
  "output": {"kind": "raw-artifact", "paths": ["oracle.test.sh"]},
  "acceptance": [
    {"argv": ["tools/runner.sh"], "exit": 0}
  ],
  "budget": {"wall_seconds": 60, "max_attempts": 1, "max_context_files": 5}
}
EOF
  out=$(env NODE_OPTIONS="" ENGINE_SCORECARD_DIR="$STORE_BASE/va_l6_family" ENGINE_CAPABILITY_DIR="$STORE_BASE/va_l6_family" \
    node "$REPO_ROOT/scripts/dispatch-contract.js" check --contract "$CONTRACT_DIR/va_l6_family.json" --repo "$MINI_REPO" --json 2>&1); rc=$?
  assert_eq "$rc" "0"
  field=$(json_get "$out" "verdict") || fail "l6 family VA verdict extraction failed"
  assert_eq "$field" "GO"
  field=$(json_get "$out" "assurance") || fail "l6 family VA assurance extraction failed"
  assert_eq "$field" "provisional"
  field=$(json_get "$out" "resolved_engine.family") || fail "l6 family VA family extraction failed"
  assert_eq "$field" "google"
  # Grok implementer is xai; VA must not collapse onto that family.
  assert_neq "$field" "xai"
  field=$(json_get "$out" "resolved_engine.runner") || fail "l6 family VA runner extraction failed"
  assert_eq "$field" "agy"
  field=$(json_get "$out" "resolved_engine.model") || fail "l6 family VA model extraction failed"
  assert_eq "$field" "Gemini 3.5 Flash (High)"
fi

assert_red_green_clean "$MINI_REPO"

finalize_test
