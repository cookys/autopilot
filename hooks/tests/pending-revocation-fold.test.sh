#!/usr/bin/env bash
# pending-revocation-fold.test.sh — P3 / KR3 + KR4 + KR7 + negative controls
# (plan 2026-09-11-operator-pin-supersedes-qualification).
#
# pending_revocation MUST be a projection of the SAME fold admission uses
# (engine-scorecard.js foldSeatStrikes). resolve-dispatch-topology.js must never
# open strikes.jsonl. Baselines are derived in-run from the immutable campaign
# base_sha — never committed under hooks/tests/fixtures/.
. "$(dirname "$0")/lib.sh"

PRE_SHA="62a580713c13ee35b0cce009e06c5441f52c790a"
# Must live under scripts/ so __dirname-relative requires (../src, ../hooks) resolve.
PRE_CONTRACT="$REPO_ROOT/scripts/dispatch-contract.pre.js"
PRE_RESOLVE="$REPO_ROOT/scripts/resolve-dispatch-topology.pre.js"
git -C "$REPO_ROOT" show "${PRE_SHA}:scripts/dispatch-contract.js" >"$PRE_CONTRACT"
git -C "$REPO_ROOT" show "${PRE_SHA}:scripts/resolve-dispatch-topology.js" >"$PRE_RESOLVE"
trap 'rm -f "$PRE_CONTRACT" "$PRE_RESOLVE"; cleanup_test_tmp' EXIT

ENGINE="gpt-5.3-codex-spark"
RUNNER="codex"
ROLE="implementer"
EFFORT="high"
HEX64=$(node -e "process.stdout.write('a'.repeat(64))")
REFUSAL_ORDINARY='engine: seat requires requalification (3 ordinary strikes since last pass)'
REFUSAL_CRITICAL='engine: seat requires requalification (critical_reexam_trigger)'

CAP_CLI="$REPO_ROOT/scripts/engine-capability-state.js"
SCORE_CLI="$REPO_ROOT/scripts/engine-scorecard.js"
RESOLVE_CLI="$REPO_ROOT/scripts/resolve-dispatch-topology.js"
CONTRACT_CLI="$REPO_ROOT/scripts/dispatch-contract.js"

json_get() {
  node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const p=process.argv[2].split(".");let v=j;for(const k of p){v=v?.[k];}if(v===undefined)process.exit(3);process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v));' "$1" "$2"
}

utc_now() {
  node -e 'const d=new Date();const p=n=>String(n).padStart(2,"0");process.stdout.write(d.getUTCFullYear()+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate())+"T"+p(d.getUTCHours())+":"+p(d.getUTCMinutes())+":"+p(d.getUTCSeconds())+"Z");'
}

# === 0: mechanical KR7 — resolver must not open strikes.jsonl ===
echo "--- 0: resolve-dispatch-topology.js must not mention strikes.jsonl ---"
STRIKE_GREP_OUT="$TEST_TMP/strike-grep.txt"
grep -c "strikes.jsonl" "$RESOLVE_CLI" >"$STRIKE_GREP_OUT" 2>"$TEST_TMP/strike-grep.err" || true
STRIKE_GREP_COUNT=$(tr -d '[:space:]' <"$STRIKE_GREP_OUT")
assert_eq "$STRIKE_GREP_COUNT" "0" "resolve-dispatch-topology.js must not contain strikes.jsonl"

# === mini repo (contract check needs a real git tree) ===
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
cat > .claude/review-loop-config.md <<EOF
# Review Loop Config
- implementer_engine: $ENGINE
- implementer_runner: $RUNNER
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

CONTRACT="$TEST_TMP/contract.json"
cat > "$CONTRACT" <<EOF
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

QUAL_ROW=$(cat <<EOF
{"engine":"$ENGINE","runner":"$RUNNER","family":"openai","role":"$ROLE","effort":"$EFFORT","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
EOF
)

fresh_stores() {
  local tag="$1"
  export ENGINE_CAPABILITY_DIR="$TEST_TMP/cap-$tag"
  export ENGINE_SCORECARD_DIR="$TEST_TMP/sc-$tag"
  mkdir -p "$ENGINE_CAPABILITY_DIR" "$ENGINE_SCORECARD_DIR"
  TOPO="$TEST_TMP/topo-$tag.json"
  cat > "$TOPO" <<EOF
{
  "schema_version": 1,
  "generated_at": "2026-09-11T00:00:00.000Z",
  "implementer_ladder": [
    {"rung":"$ENGINE/$EFFORT@$RUNNER","engine":"$ENGINE","effort":"$EFFORT","runner":"$RUNNER","family":"openai","endpoint":""}
  ]
}
EOF
}

seed_score() {
  printf '%s\n' "$QUAL_ROW" > "$ENGINE_SCORECARD_DIR/score.json"
  env ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" node "$SCORE_CLI" record --file "$ENGINE_SCORECARD_DIR/score.json" >/dev/null \
    || fail "scorecard seed failed"
}

seed_cap() {
  local model="${1:-$ENGINE}" runner="${2:-$RUNNER}" role="${3:-$ROLE}"
  cat > "$ENGINE_CAPABILITY_DIR/cap.json" <<EOF
{"schema_version":1,"observed_at":"$(utc_now)","runner":"$runner","model":"$model","role":"$role","effort":"$EFFORT","endpoint":null,"runner_version":"v1.0.0","capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
  env ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" node "$CAP_CLI" record --file "$ENGINE_CAPABILITY_DIR/cap.json" >/dev/null \
    || fail "capability seed failed"
}

pin_seat() {
  # endpoint must be a bounded name or @none (null). Use a concrete name so
  # resolve-live emits a string endpoint that loadResolvedLive accepts.
  node "$CAP_CLI" pin-seat \
    --engine "$ENGINE" --runner "$RUNNER" --role "$ROLE" \
    --effort "$EFFORT" --endpoint local \
    --reason "p3 fold test" --operator cookys \
    --store "$ENGINE_CAPABILITY_DIR" >/dev/null \
    || fail "pin-seat failed"
}

unpin_seat() {
  node "$CAP_CLI" unpin-seat --role "$ROLE" --store "$ENGINE_CAPABILITY_DIR" >/dev/null \
    || fail "unpin-seat failed"
}

strike_seat() {
  # Usage: strike_seat <class> <dedup> [predicate] [now] [effort]
  local class="$1" dedup="$2" predicate="${3:-}" now="${4:-2026-07-01T12:00:00Z}" effort="${5:-$EFFORT}"
  local args=(
    --engine "$ENGINE" --runner "$RUNNER" --role "$ROLE" --effort "$effort"
    --class "$class" --cause-class engine_output --writer fuse
    --dedup-key "$dedup" --detector-id det-1 --detector-version v1
    --artifact-sha256 "$HEX64" --receipt-ref "rcpt-$dedup" --now "$now"
    --store "$ENGINE_CAPABILITY_DIR"
  )
  if [ -n "$predicate" ]; then args+=(--predicate-id "$predicate"); fi
  node "$CAP_CLI" strike-seat "${args[@]}" >/dev/null || fail "strike-seat $dedup failed"
}

run_resolve_live() {
  local out_file="$1"
  node "$RESOLVE_CLI" --resolve-live --role "$ROLE" \
    --store "$ENGINE_CAPABILITY_DIR" --out "$TOPO" \
    >"$out_file" 2>"${out_file}.err"
  local ec=$?
  node -e '
const fs=require("fs");
const raw=fs.readFileSync(process.argv[1],"utf8").trim();
const obj=JSON.parse(raw);
fs.writeFileSync(process.argv[1], JSON.stringify(obj)+"\n");
' "$out_file" || fail "resolve-live stdout not JSON ($(cat "${out_file}.err" | head -5))"
  return "$ec"
}

run_check() {
  local out_file="$1"
  shift
  "$@" >"$out_file" 2>"${out_file}.err"
  local ec=$?
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

NINE_KEYS='cause_class,class,engine,observed_at,predicate_id,receipt_ref,role,runner,seat_hash'

# ---------------------------------------------------------------------------
# KR3 positive: pin + 3 ordinary strikes → GO, pending_revocation has 3 rows
# ---------------------------------------------------------------------------
echo "--- KR3 positive: pinned ordinary strikes admit with pending_revocation ---"
fresh_stores "kr3"
seed_score
seed_cap
strike_seat ordinary_strike "kr3-ord:1" "" "2026-07-01T12:00:00Z"
strike_seat ordinary_strike "kr3-ord:2" "" "2026-07-02T12:00:00Z"
strike_seat ordinary_strike "kr3-ord:3" "" "2026-07-03T12:00:00Z"
pin_seat

LIVE_KR3="$TEST_TMP/live-kr3.json"
run_resolve_live "$LIVE_KR3"
assert_eq "$?" "0" "KR3 resolve-live exits 0"
assert_eq "$(json_get "$LIVE_KR3" substitution_reason)" "null" "KR3 ordinary: substitution_reason null"
PENDING_LEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.pending_revocation.length));' "$LIVE_KR3")
assert_eq "$PENDING_LEN" "3" "KR3 resolve-live pending_revocation length 3"

KR3_OUT="$TEST_TMP/kr3-out.json"
run_check "$KR3_OUT" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_KR3" --json
kr3_ec=$?
assert_eq "$kr3_ec" "0" "KR3 pinned ordinary must GO"
assert_eq "$(json_get "$KR3_OUT" verdict)" "GO"
assert_eq "$(json_get "$KR3_OUT" assurance)" "operator-pin"
assert_not_contains "$(cat "$KR3_OUT")" "$REFUSAL_ORDINARY" "KR3 pinned: refusal string ABSENT"

node - "$KR3_OUT" "$NINE_KEYS" <<'NODE'
const fs = require('fs');
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const wantKeys = process.argv[3].split(',');
const rows = out.pending_revocation;
if (!Array.isArray(rows) || rows.length !== 3) {
  console.error(`expected 3 pending_revocation rows, got ${rows && rows.length}`);
  process.exit(1);
}
for (const row of rows) {
  const keys = Object.keys(row).sort().join(',');
  if (keys !== wantKeys.join(',')) {
    console.error(`row keys=${keys} want=${wantKeys.join(',')}`);
    process.exit(1);
  }
  if (row.receipt_ref == null || row.receipt_ref === '') {
    console.error(`receipt_ref missing on ${JSON.stringify(row)}`);
    process.exit(1);
  }
  if (row.class !== 'ordinary_strike') {
    console.error(`class=${row.class}`);
    process.exit(1);
  }
  if (row.predicate_id !== null) {
    console.error(`ordinary predicate_id must be null, got ${row.predicate_id}`);
    process.exit(1);
  }
}
process.exit(0);
NODE
assert_eq "$?" "0" "KR3 GO pending_revocation: 3 rows, nine keys, non-null receipt_ref"

# ---------------------------------------------------------------------------
# KR3 red: same store, pin removed, enforce → refusal bytes == pre-change
# ---------------------------------------------------------------------------
echo "--- KR3 red: unpinned ordinary strikes refuse (byte-identical to pre-change) ---"
unpin_seat
KR3_RED_PRE="$TEST_TMP/kr3-red-pre.json"
KR3_RED_CUR="$TEST_TMP/kr3-red-cur.json"
run_check "$KR3_RED_PRE" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$PRE_CONTRACT" check --contract "$CONTRACT" --repo "$MINI_REPO" --json
run_check "$KR3_RED_CUR" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" --json
assert_eq "$?" "3" "KR3 red current exits 3"
assert_contains "$(cat "$KR3_RED_CUR")" "$REFUSAL_ORDINARY" "KR3 unpinned: refusal string PRESENT"
# Two empty files also compare equal, so byte-identity is only meaningful once
# both sides are known to carry the refusal they are being compared for.
assert_contains "$(cat "$KR3_RED_PRE")" "$REFUSAL_ORDINARY" "KR3 red pre-change stdout carries the refusal"
if [ -s "$KR3_RED_PRE" ] && [ -s "$KR3_RED_CUR" ] && cmp -s "$KR3_RED_PRE" "$KR3_RED_CUR"; then
  assert_eq "$(wc -c < "$KR3_RED_PRE")" "$(wc -c < "$KR3_RED_CUR")" "KR3 red stdout byte-identical to pre-change"
else
  fail "KR3 red stdout diverged from pre-change"
  diff -u "$KR3_RED_PRE" "$KR3_RED_CUR" >&2 || true
fi

# ---------------------------------------------------------------------------
# KR4: critical on pinned seat → substitution_reason critical_strike + predicate
# ---------------------------------------------------------------------------
echo "--- KR4: pinned critical_reexam_trigger → critical_strike + predicate_id ---"
fresh_stores "kr4"
seed_score
seed_cap
strike_seat critical_reexam_trigger "kr4-crit:1" "security_canary_disclosure" "2026-07-01T12:00:00Z"
pin_seat

LIVE_KR4="$TEST_TMP/live-kr4.json"
run_resolve_live "$LIVE_KR4"
assert_eq "$?" "0" "KR4 resolve-live exits 0"
assert_eq "$(json_get "$LIVE_KR4" substitution_reason)" "critical_strike" "KR4 substitution_reason"
PREF=$(json_get "$LIVE_KR4" preferred_tuple)
EFF=$(json_get "$LIVE_KR4" effective_tuple)
assert_eq "$PREF" "$EFF" "KR4 P3: effective_tuple still equals preferred_tuple"
assert_contains "$(cat "$LIVE_KR4")" "security_canary_disclosure" "KR4 pending_revocation names predicate_id"

KR4_OUT="$TEST_TMP/kr4-out.json"
run_check "$KR4_OUT" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_KR4" --json
kr4_ec=$?
assert_eq "$kr4_ec" "0" "KR4 pinned critical must GO (not refused)"
assert_eq "$(json_get "$KR4_OUT" verdict)" "GO"
assert_eq "$(json_get "$KR4_OUT" substitution_reason)" "critical_strike"
assert_contains "$(cat "$KR4_OUT")" "security_canary_disclosure" "KR4 GO pending_revocation names predicate_id"
assert_not_contains "$(cat "$KR4_OUT")" "$REFUSAL_CRITICAL" "KR4 pinned: refusal string ABSENT"

echo "--- KR4 red: unpinned critical refuses (byte-identical to pre-change) ---"
unpin_seat
KR4_RED_PRE="$TEST_TMP/kr4-red-pre.json"
KR4_RED_CUR="$TEST_TMP/kr4-red-cur.json"
run_check "$KR4_RED_PRE" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$PRE_CONTRACT" check --contract "$CONTRACT" --repo "$MINI_REPO" --json
run_check "$KR4_RED_CUR" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" --json
assert_contains "$(cat "$KR4_RED_CUR")" "$REFUSAL_CRITICAL" "KR4 unpinned: refusal string PRESENT"
# Two empty files also compare equal, so byte-identity is only meaningful once
# both sides are known to carry the refusal they are being compared for.
assert_contains "$(cat "$KR4_RED_PRE")" "$REFUSAL_CRITICAL" "KR4 red pre-change stdout carries the refusal"
if [ -s "$KR4_RED_PRE" ] && [ -s "$KR4_RED_CUR" ] && cmp -s "$KR4_RED_PRE" "$KR4_RED_CUR"; then
  assert_eq "$(wc -c < "$KR4_RED_PRE")" "$(wc -c < "$KR4_RED_CUR")" "KR4 red stdout byte-identical to pre-change"
else
  fail "KR4 red stdout diverged from pre-change"
  diff -u "$KR4_RED_PRE" "$KR4_RED_CUR" >&2 || true
fi

# ---------------------------------------------------------------------------
# Negative controls — each named planted row appears in NEITHER admission nor
# pending_revocation. Shared fixture: pin + one countable ordinary (so admission
# still has a fold) plus the negative row under test.
# ---------------------------------------------------------------------------
assert_absent_from_fold_and_admission() {
  local case_name="$1"
  local planted_receipt="$2"
  local live_file="$3"
  local check_file="$4"

  # A bare "grep did not match" is NOT evidence of absence: grep also exits
  # non-zero on a missing or empty file, so the else branch would score a pass
  # for a payload that was never produced. Prove the payload exists and is the
  # right document FIRST; only then is a non-match informative.
  assert_file_exists "$live_file" "$case_name: resolve-live payload was written"
  assert_file_exists "$check_file" "$case_name: contract check payload was written"
  assert_contains "$(cat "$live_file")" '"pending_revocation"' \
    "$case_name: resolve-live payload carries pending_revocation (grep target is real)"
  assert_contains "$(cat "$check_file")" '"verdict"' \
    "$case_name: contract check payload carries a verdict (grep target is real)"
  assert_not_contains "$(cat "$live_file")" "$planted_receipt" \
    "$case_name: planted row absent from pending_revocation"
  assert_not_contains "$(cat "$check_file")" "$planted_receipt" \
    "$case_name: planted row absent from admission/check output"
}

# --- neg-invalidated: row invalidated by invalidates_event_id ---
echo "--- neg: invalidated row (invalidates_event_id) ---"
fresh_stores "neg-inv"
seed_score
seed_cap
strike_seat ordinary_strike "neg-inv:keep" "" "2026-07-01T12:00:00Z"
strike_seat ordinary_strike "neg-inv:target" "" "2026-07-02T12:00:00Z"
# Capture event_id of the target row, then invalidate it.
TARGET_EID=$(node -e '
const fs=require("fs");
const lines=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/);
for (const line of lines) {
  const r=JSON.parse(line);
  if (r.kind==="strike" && r.dedup_key==="neg-inv:target") { process.stdout.write(String(r.event_id)); process.exit(0); }
}
process.exit(1);
' "$ENGINE_CAPABILITY_DIR/strikes.jsonl") || fail "neg-inv: could not find target event_id"
node "$CAP_CLI" invalidate-strike \
  --engine "$ENGINE" --runner "$RUNNER" --role "$ROLE" --effort "$EFFORT" \
  --invalidates-event-id "$TARGET_EID" \
  --proof-artifact-sha256 "$HEX64" --proof-detector-id proof-det \
  --writer fuse --dedup-key "neg-inv:inval" \
  --detector-id det-1 --detector-version v1 \
  --artifact-sha256 "$HEX64" --receipt-ref "rcpt-neg-inv:inval" \
  --now "2026-07-03T12:00:00Z" --store "$ENGINE_CAPABILITY_DIR" >/dev/null \
  || fail "invalidate-strike failed"
# One more ordinary so pinned path still has countable evidence (keep + filler).
strike_seat ordinary_strike "neg-inv:filler1" "" "2026-07-04T12:00:00Z"
strike_seat ordinary_strike "neg-inv:filler2" "" "2026-07-05T12:00:00Z"
pin_seat
LIVE_NEG="$TEST_TMP/live-neg-inv.json"
run_resolve_live "$LIVE_NEG"
CHK_NEG="$TEST_TMP/chk-neg-inv.json"
run_check "$CHK_NEG" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_NEG" --json
assert_absent_from_fold_and_admission "neg-invalidated (planted rcpt-neg-inv:target)" \
  "rcpt-neg-inv:target" "$LIVE_NEG" "$CHK_NEG"
# The invalidated target must not be among the 3 survivors (keep+filler1+filler2).
PENDING_LEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.pending_revocation.length));' "$LIVE_NEG")
assert_eq "$PENDING_LEN" "3" "neg-invalidated: fold keeps 3 survivors, not the invalidated target"

# --- neg-writer: non-allowlisted writer ---
echo "--- neg: non-allowlisted writer row ---"
fresh_stores "neg-writer"
seed_score
seed_cap
strike_seat ordinary_strike "neg-w:1" "" "2026-07-01T12:00:00Z"
strike_seat ordinary_strike "neg-w:2" "" "2026-07-02T12:00:00Z"
strike_seat ordinary_strike "neg-w:3" "" "2026-07-03T12:00:00Z"
# Plant a hand-authored row with writer not on STRIKE_WRITER_ALLOWLIST.
SEAT_HASH=$(node -e '
const {seatIdentityHash}=require(process.argv[1]);
process.stdout.write(seatIdentityHash(process.argv[2],process.argv[3],process.argv[4],process.argv[5]));
' "$SCORE_CLI" "$ENGINE" "$RUNNER" "$ROLE" "$EFFORT")
node - "$ENGINE_CAPABILITY_DIR/strikes.jsonl" "$SEAT_HASH" "$ENGINE" "$RUNNER" "$ROLE" <<'NODE'
const fs = require('fs');
const [file, seatHash, engine, runner, role] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').trim().split(/\n/).filter(Boolean);
let maxEid = 0;
for (const line of lines) {
  const r = JSON.parse(line);
  if (typeof r.event_id === 'number' && r.event_id > maxEid) maxEid = r.event_id;
}
const row = {
  schema_version: 2,
  event_id: maxEid + 1,
  kind: 'strike',
  seat_hash: seatHash,
  engine, runner, role,
  class: 'ordinary_strike',
  predicate_id: null,
  cause_class: 'engine_output',
  writer: 'not_on_allowlist',
  dedup_key: 'neg-w:bad-writer',
  detector_id: 'det-1',
  detector_version: 'v1',
  artifact_sha256: 'a'.repeat(64),
  receipt_ref: 'rcpt-neg-w:bad-writer',
  observed_at: '2026-07-04T12:00:00Z',
  invalidates_event_id: null,
  proof_artifact_sha256: null,
  proof_detector_id: null,
};
fs.appendFileSync(file, JSON.stringify(row) + '\n');
NODE
pin_seat
LIVE_NEG="$TEST_TMP/live-neg-writer.json"
run_resolve_live "$LIVE_NEG"
CHK_NEG="$TEST_TMP/chk-neg-writer.json"
run_check "$CHK_NEG" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_NEG" --json
assert_absent_from_fold_and_admission "neg-writer (planted rcpt-neg-w:bad-writer)" \
  "rcpt-neg-w:bad-writer" "$LIVE_NEG" "$CHK_NEG"
PENDING_LEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.pending_revocation.length));' "$LIVE_NEG")
assert_eq "$PENDING_LEN" "3" "neg-writer: only the 3 allowlisted ordinary rows survive"

# --- neg-dedup: duplicate dedup_key (higher event_id loses) ---
echo "--- neg: duplicate dedup_key ---"
fresh_stores "neg-dedup"
seed_score
seed_cap
strike_seat ordinary_strike "neg-d:shared" "" "2026-07-01T12:00:00Z"
# Second append with same dedup_key is rejected by write-side dedup — plant by hand
# so the losing (higher event_id) duplicate exists on disk for the fold to drop.
node - "$ENGINE_CAPABILITY_DIR/strikes.jsonl" "$SEAT_HASH" "$ENGINE" "$RUNNER" "$ROLE" <<'NODE'
const fs = require('fs');
const [file, seatHash, engine, runner, role] = process.argv.slice(2);
// Recompute seat hash from the first row (effort-partitioned).
const first = JSON.parse(fs.readFileSync(file, 'utf8').trim().split(/\n/)[0]);
const lines = fs.readFileSync(file, 'utf8').trim().split(/\n/).filter(Boolean);
let maxEid = 0;
for (const line of lines) {
  const r = JSON.parse(line);
  if (typeof r.event_id === 'number' && r.event_id > maxEid) maxEid = r.event_id;
}
const row = {
  schema_version: 2,
  event_id: maxEid + 1,
  kind: 'strike',
  seat_hash: first.seat_hash,
  engine, runner, role,
  class: 'ordinary_strike',
  predicate_id: null,
  cause_class: 'engine_output',
  writer: 'fuse',
  dedup_key: 'neg-d:shared',
  detector_id: 'det-1',
  detector_version: 'v1',
  artifact_sha256: 'a'.repeat(64),
  receipt_ref: 'rcpt-neg-d:duplicate-loser',
  observed_at: '2026-07-02T12:00:00Z',
  invalidates_event_id: null,
  proof_artifact_sha256: null,
  proof_detector_id: null,
};
fs.appendFileSync(file, JSON.stringify(row) + '\n');
NODE
strike_seat ordinary_strike "neg-d:2" "" "2026-07-03T12:00:00Z"
strike_seat ordinary_strike "neg-d:3" "" "2026-07-04T12:00:00Z"
pin_seat
LIVE_NEG="$TEST_TMP/live-neg-dedup.json"
run_resolve_live "$LIVE_NEG"
CHK_NEG="$TEST_TMP/chk-neg-dedup.json"
run_check "$CHK_NEG" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_NEG" --json
assert_absent_from_fold_and_admission "neg-dedup (planted rcpt-neg-d:duplicate-loser)" \
  "rcpt-neg-d:duplicate-loser" "$LIVE_NEG" "$CHK_NEG"
PENDING_LEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.pending_revocation.length));' "$LIVE_NEG")
assert_eq "$PENDING_LEN" "3" "neg-dedup: duplicate collapses; 3 survivors"

# --- neg-prebaseline: observed_at before seat baseline ---
echo "--- neg: pre-baseline observed_at ---"
fresh_stores "neg-pre"
seed_score
seed_cap
# Baseline qualified_at is 2026-06-30 (start-of-day without evidence.issued_at).
# A strike at 2026-06-29 is strictly before baseline and must be rejected.
strike_seat ordinary_strike "neg-pre:early" "" "2026-06-29T12:00:00Z"
strike_seat ordinary_strike "neg-pre:1" "" "2026-07-01T12:00:00Z"
strike_seat ordinary_strike "neg-pre:2" "" "2026-07-02T12:00:00Z"
strike_seat ordinary_strike "neg-pre:3" "" "2026-07-03T12:00:00Z"
pin_seat
LIVE_NEG="$TEST_TMP/live-neg-pre.json"
run_resolve_live "$LIVE_NEG"
CHK_NEG="$TEST_TMP/chk-neg-pre.json"
run_check "$CHK_NEG" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_NEG" --json
assert_absent_from_fold_and_admission "neg-prebaseline (planted rcpt-neg-pre:early)" \
  "rcpt-neg-pre:early" "$LIVE_NEG" "$CHK_NEG"
PENDING_LEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.pending_revocation.length));' "$LIVE_NEG")
assert_eq "$PENDING_LEN" "3" "neg-prebaseline: early row rejected; 3 post-baseline survive"

# --- neg-future: future-dated observed_at ---
echo "--- neg: future-dated observed_at ---"
fresh_stores "neg-future"
seed_score
seed_cap
strike_seat ordinary_strike "neg-f:1" "" "2026-07-01T12:00:00Z"
strike_seat ordinary_strike "neg-f:2" "" "2026-07-02T12:00:00Z"
strike_seat ordinary_strike "neg-f:3" "" "2026-07-03T12:00:00Z"
# Far-future stamp — fold window is observedMs <= nowMs.
strike_seat ordinary_strike "neg-f:future" "" "2099-01-01T00:00:00Z"
pin_seat
LIVE_NEG="$TEST_TMP/live-neg-future.json"
run_resolve_live "$LIVE_NEG"
CHK_NEG="$TEST_TMP/chk-neg-future.json"
run_check "$CHK_NEG" \
  env NODE_OPTIONS="" AUTOPILOT_STRIKE_ENFORCEMENT=enforce \
  ENGINE_SCORECARD_DIR="$ENGINE_SCORECARD_DIR" ENGINE_CAPABILITY_DIR="$ENGINE_CAPABILITY_DIR" \
  node "$CONTRACT_CLI" check --contract "$CONTRACT" --repo "$MINI_REPO" \
  --resolved-live "$LIVE_NEG" --json
assert_absent_from_fold_and_admission "neg-future (planted rcpt-neg-f:future)" \
  "rcpt-neg-f:future" "$LIVE_NEG" "$CHK_NEG"
PENDING_LEN=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.pending_revocation.length));' "$LIVE_NEG")
assert_eq "$PENDING_LEN" "3" "neg-future: future row rejected; 3 current rows survive"

# ---------------------------------------------------------------------------
# Zero-pin resolve-live: pending_revocation still a fold projection (may be []),
# and pre-change resolve with empty pending must match when no strikes exist.
# ---------------------------------------------------------------------------
echo "--- zero-pin / zero-strike: resolve-live pending_revocation [] ---"
fresh_stores "zero"
seed_score
seed_cap
LIVE_ZERO="$TEST_TMP/live-zero.json"
run_resolve_live "$LIVE_ZERO"
assert_eq "$(json_get "$LIVE_ZERO" pending_revocation)" "[]" "zero-strike pending_revocation is []"
assert_eq "$(json_get "$LIVE_ZERO" substitution_reason)" "null" "zero-strike substitution_reason null"

# Pre-change resolve-live also emits [] — byte-compare the pending_revocation field
# (full doc may differ only if other fields drift; we pin the KR7 zero shape).
LIVE_ZERO_PRE="$TEST_TMP/live-zero-pre.json"
node "$PRE_RESOLVE" --resolve-live --role "$ROLE" \
  --store "$ENGINE_CAPABILITY_DIR" --out "$TOPO" \
  >"$LIVE_ZERO_PRE" 2>"$LIVE_ZERO_PRE.err" || fail "pre-change resolve-live failed"
PRE_PENDING=$(json_get "$LIVE_ZERO_PRE" pending_revocation)
CUR_PENDING=$(json_get "$LIVE_ZERO" pending_revocation)
assert_eq "$PRE_PENDING" "$CUR_PENDING" "zero-strike pending_revocation matches pre-change []"

finalize_test
