#!/usr/bin/env bash
# Negative controls for "a qualification has no calendar".
#
# 2026-08-22 pulled the calendar teeth out of admission (a past-expires row no longer
# derived `expired`, the density tier and dispatch-contract keyed on the strike-decay
# projection). 2026-10-26 (owner, third time of asking) removed the calendar itself: no
# `expires` on a scorecard row, no `expires_at` inside capability evidence, no
# `--expires-days`, no `expired`/`stale` state, no expiry_warning, no expiry in the shipped
# official defaults or in any adopt / scorecard output. A seat now loses standing ONLY through
# strikes (references/strike-decay.md). Sections below:
#   fields   no expiry field in rows, evidence, schemas, the shipped defaults, any output
#   scan     no admission or sampling source reads a qualification date
#   cli      engine-qualify refuses --expires-days
#   migrate  a store written by the old code reads with a message naming the one-line
#            migration, and migrates without moving any seat's admission
#   strikes  the withdrawal path that replaced the calendar still works end to end
#
# Each assertion fails if its tooth is re-introduced (evidence-discipline §2: a suite that
# passes when you delete the gate it tests has not tested it).
set -uo pipefail
. "$(dirname "$0")/lib.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESC="$ROOT/scripts/engine-scorecard.js"
RRL="$ROOT/scripts/resolve-review-loop.sh"
DC="$ROOT/scripts/dispatch-contract.js"
# BLOCKER 2 (2026-08-22 review repair): the fourth calendar tooth — resolve-scaffold-
# tier.js's isFresh() used to compare `now` against the row's own `expires` on this
# SAME scorecard.jsonl store. Added to the P3 admission-source scan set below.
RST="$ROOT/scripts/resolve-scaffold-tier.js"

PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
SCORECARD_DIR="$TESTDIR/scorecard"
CAPABILITY_DIR="$TESTDIR/capability"
mkdir -p "$SCORECARD_DIR" "$CAPABILITY_DIR"
export ENGINE_SCORECARD_DIR="$SCORECARD_DIR"
export ENGINE_CAPABILITY_DIR="$CAPABILITY_DIR"
trap 'rm -rf "$TESTDIR"; cleanup_test_tmp' EXIT

# Snapshot the operator's REAL stores (if any) BEFORE this suite touches
# anything, so the landing assertion at the bottom is a real before/after
# comparison, not a tautology (evidence-discipline §9).
REAL_SCORECARD="$HOME/.autopilot/engine-scorecard/scorecard.jsonl"
REAL_CAPABILITY="$HOME/.autopilot/engine-capability/strikes.jsonl"
REAL_SCORECARD_SIZE_BEFORE=$( [ -f "$REAL_SCORECARD" ] && stat -c%s "$REAL_SCORECARD" 2>/dev/null || echo 0 )
REAL_CAPABILITY_SIZE_BEFORE=$( [ -f "$REAL_CAPABILITY" ] && stat -c%s "$REAL_CAPABILITY" 2>/dev/null || echo 0 )

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

reset_stores() {
  rm -rf "$SCORECARD_DIR" "$CAPABILITY_DIR"
  mkdir -p "$SCORECARD_DIR" "$CAPABILITY_DIR"
}

jq_get() { node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));let v=d;for(const k of '$1'.split('.'))v=Array.isArray(v)?v[Number(k)]:v[k];process.stdout.write(String(v))"; }
arrlen() { node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).length))"; }

# A fixed well-formed 64-hex digest for artifact_sha256/proof_artifact_sha256 fixtures.
HEX64=$(node -e "process.stdout.write('a'.repeat(64))")

# seat_hash computed via the IDENTICAL primitives engine-scorecard.js uses
# (src/engine/owner-kernel/canonical.js canonicalJson+sha256) — never by
# shelling out to engine-scorecard.js itself, so this is an independent
# re-derivation, not a mirror of the code under test.
seat_hash() { # engine runner role
  node -e '
const { canonicalJson, sha256 } = require(process.argv[4]);
process.stdout.write(sha256(canonicalJson({ engine: process.argv[1], runner: process.argv[2], role: process.argv[3] })));
' "$1" "$2" "$3" "$ROOT/src/engine/owner-kernel/canonical.js"
}

# score_row engine runner role qualified_at expires [status=qualified]
score_row() {
  local engine="$1" runner="$2" role="$3" qat="$4" exp="$5" status="${6:-qualified}"
  cat <<JSON
{"engine":"$engine","runner":"$runner","family":"f","role":"$role","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"$status","qualified_at":"$qat"}
JSON
}

# strike_line seat_hash engine runner role class predicate_id writer receipt_ref dedup_key observed_at event_id
strike_line() {
  local sh="$1" engine="$2" runner="$3" role="$4" class="$5" predicate="$6" writer="$7" receipt="$8" dedup="$9" observed="${10}" eid="${11}"
  local predicate_json="null"
  [ "$predicate" != "null" ] && predicate_json="\"$predicate\""
  cat <<JSON
{"schema_version":2,"event_id":$eid,"kind":"strike","seat_hash":"$sh","engine":"$engine","runner":"$runner","role":"$role","class":"$class","predicate_id":$predicate_json,"cause_class":"engine_output","writer":"$writer","dedup_key":"$dedup","detector_id":"det-1","detector_version":"v1","artifact_sha256":"$HEX64","receipt_ref":"$receipt","observed_at":"$observed","invalidates_event_id":null,"proof_artifact_sha256":null,"proof_detector_id":null}
JSON
}

# invalidation_line seat_hash writer target_event_id observed_at event_id
invalidation_line() {
  local sh="$1" writer="$2" target="$3" observed="$4" eid="$5"
  cat <<JSON
{"schema_version":2,"event_id":$eid,"kind":"strike_invalidated","seat_hash":"$sh","engine":"e","runner":"codex","role":"reviewer","class":"ordinary_strike","predicate_id":null,"cause_class":"engine_output","writer":"$writer","dedup_key":"invalidation-$eid","detector_id":"det-1","detector_version":"v1","artifact_sha256":"$HEX64","receipt_ref":"inv-$eid","observed_at":"$observed","invalidates_event_id":$target,"proof_artifact_sha256":"$HEX64","proof_detector_id":"det-1"}
JSON
}

STRIKES_FILE="$CAPABILITY_DIR/strikes.jsonl"

# =============================================================================
# (a) an old qualified row stays qualified and nothing in the projection mentions a date
#     that could expire; the store is not mutated by a read.
# =============================================================================
reset_stores
echo "$(score_row A codex reviewer 2026-01-01 2026-01-02)" | node "$ESC" record >/dev/null 2>&1
OUT_A=$(node "$ESC" current --role reviewer --now 2099-06-30)
obs=$(echo "$OUT_A" | jq_get 0.observed_status)
st=$(echo "$OUT_A" | jq_get 0.status)
adm=$(echo "$OUT_A" | jq_get 0.admission_status)
stored=$(grep -o '"status":"[a-z]*"' "$SCORECARD_DIR/scorecard.jsonl" | head -1)
[ "$obs" = "qualified" ] && [ "$st" = "provisional" ] && [ "$adm" = "qualified" ] \
  && [ "$stored" = '"status":"qualified"' ] && ! echo "$OUT_A" | grep -q -i 'expir' \
  && ok "a1: row qualified in 2026, read in 2099 => observed/admission qualified, no expiry field in the projection, store unmutated" \
  || bad "a1: obs=$obs st=$st adm=$adm stored=$stored out=$OUT_A"

# =============================================================================
# (b) the same OLD row does NOT get tier 'low' from resolve-review-loop.sh
# =============================================================================
IMPL_CFG="$TESTDIR/impl-cfg.md"
printf -- '- implementer_engine: A\n- implementer_runner: codex\n- reviewer_engine: claude-opus\n- reviewer_runner: claude-native\n' > "$IMPL_CFG"
reset_stores
echo "$(score_row A codex implementer 2026-01-01 2026-01-02)" | node "$ESC" record >/dev/null 2>&1
RRL_OUT=$(REVIEW_LOOP_CONFIG_OVERRIDE="$IMPL_CFG" bash "$RRL" --scale-by-capability 2>/dev/null || true)
TIER=$(printf '%s' "$RRL_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(String(d.capability_tier||""))}catch{process.stdout.write("")}})' 2>/dev/null || true)
[ "$TIER" != "low" ] && ok "b1: old implementer row does not tier 'low' (got '$TIER')" \
  || bad "b1: past-expires implementer row tiered 'low' — a date decides the tier again"

# =============================================================================
# (c) the same OLD row gets a GO from dispatch-contract.js
# =============================================================================
# build_contract_fixture engine runner unit_id
# Builds a minimal real git repo + a schema-valid dispatch contract for it
# (mirrors hooks/tests/dispatch-contract.test.sh's setup_qualified_store /
# valid.json shape) and a matching .claude/review-loop-config.md so
# resolve-review-loop.sh (which dispatch-contract.js shells out to for engine
# resolution) resolves engine/runner to the given tuple. Prints
# "<repo_path>|<contract_path>" on success.
build_contract_fixture() {
  local engine="$1" runner="$2" unit_id="$3"
  local repo="$TESTDIR/repo-$unit_id"
  rm -rf "$repo"
  mkdir -p "$repo/src" "$repo/specs" "$repo/tools" "$repo/.claude"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email test@test.local
    git config user.name test
    echo "# API" > specs/api.md
    printf 'package main\nfunc main() {}\n' > src/main.go
    printf '#!/usr/bin/env bash\nexit 0\n' > tools/red.sh
    printf '#!/usr/bin/env bash\nexit 0\n' > tools/runner.sh
    chmod +x tools/red.sh tools/runner.sh
    printf -- '- implementer_engine: %s\n- implementer_runner: %s\n- reviewer_engine: claude-opus\n- reviewer_runner: claude-native\n' "$engine" "$runner" > .claude/review-loop-config.md
    git add -A
    git commit -qm init
  ) >/dev/null
  local base_sha
  base_sha=$(git -C "$repo" rev-parse HEAD)
  local contract="$TESTDIR/contract-$unit_id.json"
  cat > "$contract" <<EOF
{
  "schema": 1,
  "unit_id": "$unit_id",
  "role": "implementer",
  "goal": "calendar-teeth-negative fixture",
  "spec": {"path": "specs/api.md", "section": "API"},
  "base_sha": "$base_sha",
  "depends_on": [],
  "scope": {
    "allow_paths": ["src/"],
    "deny_paths": [],
    "max_files": 10,
    "max_diff_lines": 100
  },
  "go": {
    "required_paths": ["src/main.go"],
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
  printf '%s|%s' "$repo" "$contract"
}

FIXTURE_A=$(build_contract_fixture A codex u-a)
REPO_A="${FIXTURE_A%%|*}"
CONTRACT_A="${FIXTURE_A##*|}"
CAP_EVENT="$TESTDIR/cap-event.json"
cat > "$CAP_EVENT" <<EOF
{"schema_version":1,"observed_at":"$(node -e 'process.stdout.write(new Date().toISOString())')","runner":"codex","model":"A","role":"implementer","effort":"high","endpoint":null,"capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
node "$ROOT/scripts/engine-capability-state.js" record --file "$CAP_EVENT" >/dev/null 2>&1 || true
DC_OUT=$(node "$DC" check --contract "$CONTRACT_A" --repo "$REPO_A" --json 2>&1); DC_RC=$?
if [ "$DC_RC" = "0" ]; then
  VERDICT=$(printf '%s' "$DC_OUT" | jq_get verdict 2>/dev/null || true)
else
  VERDICT="NO-GO(rc=$DC_RC)"
fi
[ "$VERDICT" = "GO" ] && ok "c1: old implementer row GOes under dispatch-contract.js" \
  || bad "c1: dispatch-contract verdict=$VERDICT out=$DC_OUT"

# =============================================================================
# Strike accumulation — ENFORCED BY DEFAULT (owner, 2026-10-26: standing is lost by
# accumulated strikes). 2 ordinary strikes keep the seat qualified; the 3rd makes it
# requalify_required with the variable UNSET; AUTOPILOT_STRIKE_ENFORCEMENT=shadow is the
# explicit opt-out that records and projects would_requalify without gating.
# =============================================================================
reset_stores
echo "$(score_row B codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_B=$(seat_hash B codex reviewer)
{
  strike_line "$SH_B" B codex reviewer ordinary_strike null fuse "rcpt-1" "inc-1:det-1" "2026-06-02T00:00:00Z" 1
  strike_line "$SH_B" B codex reviewer ordinary_strike null fuse "rcpt-2" "inc-2:det-1" "2026-06-03T00:00:00Z" 2
} > "$STRIKES_FILE"
unset AUTOPILOT_STRIKE_ENFORCEMENT
SS_B2=$(node "$ESC" seat-status --engine B --runner codex --role reviewer --now 2026-06-30)
adm2=$(echo "$SS_B2" | jq_get admission_status); sp2=$(echo "$SS_B2" | jq_get strikes_since_pass); wr2=$(echo "$SS_B2" | jq_get would_requalify)
[ "$adm2" = "qualified" ] && [ "$sp2" = "2" ] && [ "$wr2" = "false" ] \
  && ok "strike0: 2 ordinary strikes (threshold is 3) => still qualified, enforcement unset" \
  || bad "strike0: admission_status=$adm2 strikes_since_pass=$sp2 would_requalify=$wr2"
strike_line "$SH_B" B codex reviewer ordinary_strike null fuse "rcpt-3" "inc-3:det-1" "2026-06-04T00:00:00Z" 3 >> "$STRIKES_FILE"
SS_B=$(node "$ESC" seat-status --engine B --runner codex --role reviewer --now 2026-06-30)
wr=$(echo "$SS_B" | jq_get would_requalify)
adm=$(echo "$SS_B" | jq_get admission_status)
sp=$(echo "$SS_B" | jq_get strikes_since_pass)
[ "$wr" = "true" ] && [ "$sp" = "3" ] && [ "$adm" = "requalify_required" ] \
  && ok "strike1: 3 ordinary strikes, enforcement UNSET (the default) => requalify_required" \
  || bad "strike1: would_requalify=$wr strikes_since_pass=$sp admission_status=$adm (want requalify_required by default)"

SS_B_SHADOW=$(AUTOPILOT_STRIKE_ENFORCEMENT=shadow node "$ESC" seat-status --engine B --runner codex --role reviewer --now 2026-06-30)
adm_sh=$(echo "$SS_B_SHADOW" | jq_get admission_status); wr_sh=$(echo "$SS_B_SHADOW" | jq_get would_requalify)
[ "$adm_sh" = "qualified" ] && [ "$wr_sh" = "true" ] \
  && ok "strike2: AUTOPILOT_STRIKE_ENFORCEMENT=shadow (the explicit opt-out) => stays qualified and projects would_requalify" \
  || bad "strike2: admission_status=$adm_sh would_requalify=$wr_sh under shadow"

IMPL_CFG_B="$TESTDIR/impl-cfg-b.md"
printf -- '- implementer_engine: B\n- implementer_runner: codex\n- reviewer_engine: claude-opus\n- reviewer_runner: claude-native\n' > "$IMPL_CFG_B"
echo "$(score_row B codex implementer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_B_IMPL=$(seat_hash B codex implementer)
{
  cat "$STRIKES_FILE"
  strike_line "$SH_B_IMPL" B codex implementer ordinary_strike null fuse "rcpt-4" "inc-4:det-1" "2026-06-02T00:00:00Z" 4
  strike_line "$SH_B_IMPL" B codex implementer ordinary_strike null fuse "rcpt-5" "inc-5:det-1" "2026-06-03T00:00:00Z" 5
  strike_line "$SH_B_IMPL" B codex implementer ordinary_strike null fuse "rcpt-6" "inc-6:det-1" "2026-06-04T00:00:00Z" 6
} > "$STRIKES_FILE.tmp" && mv "$STRIKES_FILE.tmp" "$STRIKES_FILE"
RRL_OUT_B=$(REVIEW_LOOP_CONFIG_OVERRIDE="$IMPL_CFG_B" bash "$RRL" --scale-by-capability 2>/dev/null || true)
TIER_B=$(printf '%s' "$RRL_OUT_B" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(String(d.capability_tier||""))}catch{process.stdout.write("")}})' 2>/dev/null || true)
[ "$TIER_B" = "low" ] && ok "strike3: requalify_required seat tiers 'low' by default (no env var)" \
  || bad "strike3: capability_tier=$TIER_B (want low)"

CAP_EVENT_B="$TESTDIR/cap-event-b.json"
cat > "$CAP_EVENT_B" <<EOF
{"schema_version":1,"observed_at":"$(node -e 'process.stdout.write(new Date().toISOString())')","runner":"codex","model":"B","role":"implementer","effort":"high","endpoint":null,"capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
node "$ROOT/scripts/engine-capability-state.js" record --file "$CAP_EVENT_B" >/dev/null 2>&1 || true
FIXTURE_B=$(build_contract_fixture B codex u-b)
REPO_B="${FIXTURE_B%%|*}"
CONTRACT_B="${FIXTURE_B##*|}"
DC_OUT_B=$(node "$DC" check --contract "$CONTRACT_B" --repo "$REPO_B" --json 2>&1); DC_RC_B=$?
REASONS_B=$(printf '%s' "$DC_OUT_B" | jq_get reasons.0 2>/dev/null || true)
if [ "$DC_RC_B" != "0" ] && grep -q "requalification" < <(printf '%s' "$REASONS_B"); then
  ok "strike4: requalify_required seat NO-GOes from dispatch-contract.js naming the strike cause ($REASONS_B)"
else
  bad "strike4: rc=$DC_RC_B reasons=$REASONS_B out=$DC_OUT_B"
fi

# =============================================================================
# One critical_reexam_trigger => requalify_required immediately, under the
# default and under shadow (critical always enforces).
# =============================================================================
reset_stores
echo "$(score_row C codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_C=$(seat_hash C codex reviewer)
strike_line "$SH_C" C codex reviewer critical_reexam_trigger security_canary_disclosure fuse "rcpt-crit" "inc-crit:det-1" "2026-06-02T00:00:00Z" 1 > "$STRIKES_FILE"
unset AUTOPILOT_STRIKE_ENFORCEMENT
SS_C=$(node "$ESC" seat-status --engine C --runner codex --role reviewer --now 2026-06-30)
adm_c=$(echo "$SS_C" | jq_get admission_status)
ct_c=$(echo "$SS_C" | jq_get critical_trigger)
[ "$adm_c" = "requalify_required" ] && [ "$ct_c" = "true" ] \
  && ok "critical1: one critical_reexam_trigger => requalify_required with enforcement unset" \
  || bad "critical1: admission_status=$adm_c critical_trigger=$ct_c"

# =============================================================================
# Epoch semantics: a fresh qualified administration after 3 strikes rebaselines
# (strikes_since_pass: 0); strike rows remain byte-identical on disk.
# =============================================================================
reset_stores
echo "$(score_row D codex reviewer 2026-01-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_D=$(seat_hash D codex reviewer)
{
  strike_line "$SH_D" D codex reviewer ordinary_strike null fuse "rcpt-1" "inc-1:det-1" "2026-01-02T00:00:00Z" 1
  strike_line "$SH_D" D codex reviewer ordinary_strike null fuse "rcpt-2" "inc-2:det-1" "2026-01-03T00:00:00Z" 2
  strike_line "$SH_D" D codex reviewer ordinary_strike null fuse "rcpt-3" "inc-3:det-1" "2026-01-04T00:00:00Z" 3
} > "$STRIKES_FILE"
BEFORE_SHA=$(sha256sum "$STRIKES_FILE" | awk '{print $1}')
# A fresh passing administration for the SAME seat, dated after the strikes.
echo "$(score_row D codex reviewer 2026-02-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SS_D=$(node "$ESC" seat-status --engine D --runner codex --role reviewer --now 2026-06-30)
sp_d=$(echo "$SS_D" | jq_get strikes_since_pass)
AFTER_SHA=$(sha256sum "$STRIKES_FILE" | awk '{print $1}')
[ "$sp_d" = "0" ] && [ "$BEFORE_SHA" = "$AFTER_SHA" ] \
  && ok "epoch1: fresh pass after 3 strikes rebaselines (strikes_since_pass=0), strike rows byte-identical" \
  || bad "epoch1: strikes_since_pass=$sp_d before_sha=$BEFORE_SHA after_sha=$AFTER_SHA"

# =============================================================================
# PINNED tiebreak: a strike stamped at EXACTLY qualified_at does NOT count.
# =============================================================================
reset_stores
echo "$(score_row E codex reviewer 2026-06-01T00:00:00.000Z 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_E=$(seat_hash E codex reviewer)
strike_line "$SH_E" E codex reviewer ordinary_strike null fuse "rcpt-tie" "inc-tie:det-1" "2026-06-01T00:00:00.000Z" 1 > "$STRIKES_FILE"
SS_E=$(node "$ESC" seat-status --engine E --runner codex --role reviewer --now 2026-06-30)
sp_e=$(echo "$SS_E" | jq_get strikes_since_pass)
[ "$sp_e" = "0" ] && ok "tie1: strike stamped exactly at qualified_at does not count" \
  || bad "tie1: strikes_since_pass=$sp_e (want 0)"

# =============================================================================
# BLOCKER 5 fix (2026-08-22 review repair): epoch re-baselining is INSTANT-
# granular, not date-granular. `qualified_at` is pinned DATE-ONLY, but the fold
# used to compare a strike's full-timestamp `observed_at` against that
# date-only baseline at START of day — so a critical_reexam_trigger stamped
# LATER THE SAME DAY as a passing administration still counted against it,
# leaving `admission_status: requalify_required` with no remedy (strike-decay.md
# ll.99-103: a fresh passing administration re-baselines and clears prior
# strikes). Reproduced against git HEAD's scripts/engine-scorecard.js before
# this fix landed:
#   record BLK5/codex/reviewer qualified_at=2026-08-20
#   strike observed_at=2026-08-20T09:00:00Z (critical_reexam_trigger, same day)
#   seat-status --now 2026-08-22
#   => {"admission_status":"requalify_required", ..., "critical_trigger":true}
# (pasted verbatim in the repair session's report). BLOCKER 5's own fix then
# fell back to END of the pass date for a legacy date-only `qualified_at` —
# which made the SAME-day-after-pass strike above (and the fixture below) fall
# INSIDE the baseline window and be treated as pre-pass and cleared. That is
# fail-OPEN on the one class that enforces regardless of the shadow flag:
# record a same-day pass, then let a critical strike land later that day, and
# the seat comes back "qualified" with the critical trigger silently gone.
#
# FINDING 2 fix (2026-08-22 second review repair): the legacy date-only
# fallback must fail CLOSED — START of day, not END — so a same-day-after-pass
# strike counts. Every modern administration carries `evidence.issued_at` (an
# exact instant, preferred first and unaffected by this fallback); only a
# legacy date-only row with no `issued_at` reaches this fallback, and for
# those rows the safe direction is to keep the strike, not clear it. This
# fixture (score_row has no `evidence` field, so it always takes the
# fallback) now expects the strike to COUNT: admission_status
# 'requalify_required', critical_trigger true. The PINNED pass-instant
# tiebreak (a strike stamped at EXACTLY the baseline instant does not count)
# is unaffected and still covered by "tie1" above.
# =============================================================================
reset_stores
echo "$(score_row H codex reviewer 2026-08-20 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_H=$(seat_hash H codex reviewer)
strike_line "$SH_H" H codex reviewer critical_reexam_trigger security_canary_disclosure fuse "rcpt-blk5" "inc-blk5:det-1" "2026-08-20T09:00:00Z" 1 > "$STRIKES_FILE"
SS_H=$(node "$ESC" seat-status --engine H --runner codex --role reviewer --now 2026-08-22)
adm_h=$(echo "$SS_H" | jq_get admission_status)
ct_h=$(echo "$SS_H" | jq_get critical_trigger)
[ "$adm_h" = "requalify_required" ] && [ "$ct_h" = "true" ] \
  && ok "epoch2: a critical strike stamped LATER THE SAME DAY as the pass COUNTS (fail-closed legacy date-only fallback, admission_status=requalify_required)" \
  || bad "epoch2: admission_status=$adm_h critical_trigger=$ct_h (want requalify_required/true — same-day-after-pass must count, fail-closed)"

# =============================================================================
# Writer allowlist: a hand-written row with writer "operator" is excluded and
# tallied into rejected_strikes.
# =============================================================================
reset_stores
echo "$(score_row F codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_F=$(seat_hash F codex reviewer)
strike_line "$SH_F" F codex reviewer ordinary_strike null operator "rcpt-op" "inc-op:det-1" "2026-06-02T00:00:00Z" 1 > "$STRIKES_FILE"
SS_F=$(node "$ESC" seat-status --engine F --runner codex --role reviewer --now 2026-06-30)
sp_f=$(echo "$SS_F" | jq_get strikes_since_pass)
rej_f=$(echo "$SS_F" | jq_get rejected_strikes)
[ "$sp_f" = "0" ] && [ "$rej_f" = "1" ] \
  && ok "writer1: writer=operator row excluded from count, shows in rejected_strikes" \
  || bad "writer1: strikes_since_pass=$sp_f rejected_strikes=$rej_f"

# =============================================================================
# Invalidation: a strike_invalidated with full proof removes exactly one strike.
# =============================================================================
reset_stores
echo "$(score_row G codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_G=$(seat_hash G codex reviewer)
{
  strike_line "$SH_G" G codex reviewer ordinary_strike null fuse "rcpt-1" "inc-1:det-1" "2026-06-02T00:00:00Z" 1
  strike_line "$SH_G" G codex reviewer ordinary_strike null fuse "rcpt-2" "inc-2:det-1" "2026-06-03T00:00:00Z" 2
  invalidation_line "$SH_G" fuse 1 "2026-06-04T00:00:00Z" 3
} > "$STRIKES_FILE"
SS_G=$(node "$ESC" seat-status --engine G --runner codex --role reviewer --now 2026-06-30)
sp_g=$(echo "$SS_G" | jq_get strikes_since_pass)
[ "$sp_g" = "1" ] && ok "invalidate1: strike_invalidated with full proof removes exactly one strike (2 -> 1)" \
  || bad "invalidate1: strikes_since_pass=$sp_g (want 1)"

# =============================================================================
# FINDING 1 fix (2026-08-22 review repair): the PROJECTION's dedup must be
# CLASS-AWARE, matching the write side (engine-capability-state.js
# `appendStrike`, "BLOCKER 4 fix": dedup key is (seat_hash, dedup_key, class)).
# Deduping on dedup_key ALONE at read time was class-blind: an ordinary_strike
# sharing a dedup_key with a LATER critical_reexam_trigger hid the critical
# row behind the lower event_id — silently disappearing the one class that
# ENFORCES regardless of the shadow flag. Named regression (panel, mandatory):
# an ordinary_strike at event_id N and a critical_reexam_trigger at event_id
# N+1 sharing one dedup_key => critical_trigger true and admission_status
# 'requalify_required' under the DEFAULT (shadow) flag — no --enforce needed,
# because critical_reexam_trigger enforces unconditionally.
# =============================================================================
unset AUTOPILOT_STRIKE_ENFORCEMENT
reset_stores
echo "$(score_row I codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_I=$(seat_hash I codex reviewer)
{
  strike_line "$SH_I" I codex reviewer ordinary_strike null fuse "rcpt-f1-1" "shared-dedup-1" "2026-06-02T00:00:00Z" 1
  strike_line "$SH_I" I codex reviewer critical_reexam_trigger security_canary_disclosure fuse "rcpt-f1-2" "shared-dedup-1" "2026-06-03T00:00:00Z" 2
} > "$STRIKES_FILE"
SS_I=$(node "$ESC" seat-status --engine I --runner codex --role reviewer --now 2026-06-30)
adm_i=$(echo "$SS_I" | jq_get admission_status)
ct_i=$(echo "$SS_I" | jq_get critical_trigger)
sp_i=$(echo "$SS_I" | jq_get strikes_since_pass)
[ "$adm_i" = "requalify_required" ] && [ "$ct_i" = "true" ] \
  && ok "dedup1: ordinary_strike(N) + critical_reexam_trigger(N+1) sharing one dedup_key => critical NOT hidden, admission_status=requalify_required under default shadow" \
  || bad "dedup1: admission_status=$adm_i critical_trigger=$ct_i strikes_since_pass=$sp_i (want requalify_required/true)"

# =============================================================================
# FINDING 3 fix (2026-08-22 review repair): invalidation read-validation gains
# two more conditions before an invalidation is honoured — (1) observed_at
# well-formed AND within (baseline, now], (2) invalidates_event_id strictly
# less than the invalidation row's OWN event_id (cannot invalidate a strike
# that does not exist yet). Cross-seat deletion is already impossible via
# countable's seat_hash-scoped parsedRows filter — deliberately untouched.
# =============================================================================
reset_stores
echo "$(score_row J codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_J=$(seat_hash J codex reviewer)
{
  strike_line "$SH_J" J codex reviewer ordinary_strike null fuse "rcpt-f3a-1" "inc-f3a-1:det-1" "2026-06-02T00:00:00Z" 1
  strike_line "$SH_J" J codex reviewer ordinary_strike null fuse "rcpt-f3a-2" "inc-f3a-2:det-1" "2026-06-03T00:00:00Z" 2
  # observed_at is BEFORE the seat's baseline (2026-05-01 < 2026-06-01) — out
  # of the (baseline, now] window — so this invalidation must be refused.
  invalidation_line "$SH_J" fuse 1 "2026-05-01T00:00:00Z" 3
} > "$STRIKES_FILE"
SS_J=$(node "$ESC" seat-status --engine J --runner codex --role reviewer --now 2026-06-30)
sp_j=$(echo "$SS_J" | jq_get strikes_since_pass)
rej_j=$(echo "$SS_J" | jq_get rejected_strikes)
[ "$sp_j" = "2" ] && [ "$rej_j" = "1" ] \
  && ok "invalidate2: invalidation with out-of-window observed_at is refused (both strikes still count, invalidation tallied into rejected_strikes)" \
  || bad "invalidate2: strikes_since_pass=$sp_j rejected_strikes=$rej_j (want 2/1)"

reset_stores
echo "$(score_row K codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_K=$(seat_hash K codex reviewer)
{
  strike_line "$SH_K" K codex reviewer ordinary_strike null fuse "rcpt-f3b-1" "inc-f3b-1:det-1" "2026-06-02T00:00:00Z" 1
  # invalidates_event_id (2) is NOT strictly less than this invalidation row's
  # own event_id (2, self-reference) — a strike cannot be invalidated before
  # it exists — so this invalidation must be refused.
  invalidation_line "$SH_K" fuse 2 "2026-06-03T00:00:00Z" 2
} > "$STRIKES_FILE"
SS_K=$(node "$ESC" seat-status --engine K --runner codex --role reviewer --now 2026-06-30)
sp_k=$(echo "$SS_K" | jq_get strikes_since_pass)
rej_k=$(echo "$SS_K" | jq_get rejected_strikes)
[ "$sp_k" = "1" ] && [ "$rej_k" = "1" ] \
  && ok "invalidate3: invalidation with invalidates_event_id >= its own event_id is refused (strike still counts, invalidation tallied into rejected_strikes)" \
  || bad "invalidate3: strikes_since_pass=$sp_k rejected_strikes=$rej_k (want 1/1)"

# =============================================================================
# fields: no expiry field anywhere a qualification is stored, shipped or displayed
# =============================================================================
DEFAULTS="$ROOT/references/official-qualification-defaults.json"
DEF_HITS=$(grep -c -E '"expires(_at)?"' "$DEFAULTS" || true)
[ "$DEF_HITS" = "0" ] && ok "fields1: the shipped official defaults carry no expires / expires_at key" \
  || bad "fields1: $DEF_HITS expiry key(s) in references/official-qualification-defaults.json"

SCHEMA_HITS=$(grep -l -E '"expires(_at)?"' "$ROOT/schemas/capability-evidence.schema.json" "$ROOT/schemas/official-qualification-defaults.schema.json" 2>/dev/null || true)
[ -z "$SCHEMA_HITS" ] && ok "fields2: the evidence and defaults schemas have no expiry property" \
  || bad "fields2: expiry property in: $SCHEMA_HITS"

reset_stores
ROW_EXP=$(score_row P codex reviewer 2026-06-01 2099-01-01 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);r.expires="2099-01-01";process.stdout.write(JSON.stringify(r))})')
echo "$ROW_EXP" | node "$ESC" record >"$TESTDIR/rec-exp.out" 2>&1; RC_EXP=$?
[ "$RC_EXP" != "0" ] && grep -q -i "no expir" "$TESTDIR/rec-exp.out" && [ ! -s "$SCORECARD_DIR/scorecard.jsonl" ] \
  && ok "fields3: record refuses a row that carries an expires field, and writes nothing" \
  || bad "fields3: rc=$RC_EXP out=$(cat "$TESTDIR/rec-exp.out")"

reset_stores
echo "$(score_row Q codex reviewer 2026-06-01 x)" | node "$ESC" record >/dev/null 2>&1
if ! grep -q -E '"expires' "$SCORECARD_DIR/scorecard.jsonl"; then ok "fields4: a recorded row has no expires key on disk"; else bad "fields4: expiry key written: $(cat "$SCORECARD_DIR/scorecard.jsonl")"; fi

DISPLAY_OUT=""
for cmd in "current --role reviewer" "report --role reviewer" "ladder --role reviewer" "seat-status --engine Q --runner codex --role reviewer"; do
  DISPLAY_OUT="$DISPLAY_OUT$(node "$ESC" $cmd --now 2099-01-01 2>&1)"
done
echo "$DISPLAY_OUT" | grep -q -i -E 'expir|calendar'; DISPLAY_RC=$?
[ "$DISPLAY_RC" != "0" ] && ok "fields5: scorecard current / report / ladder / seat-status output mentions no expiry" \
  || bad "fields5: an expiry word appears in scorecard output: $(echo "$DISPLAY_OUT" | grep -i -E 'expir|calendar' | head -3)"

ADOPT_OUT=$(node "$ROOT/scripts/adopt-qualification-defaults.js" list 2>&1 | head -400)
echo "$ADOPT_OUT" | grep -q -i -E 'expir' ; ADOPT_RC=$?
[ "$ADOPT_RC" != "0" ] && [ -n "$ADOPT_OUT" ] && ok "fields6: adopt-qualification-defaults list output mentions no expiry" \
  || bad "fields6: adopt list rc=$ADOPT_RC (0 = an expiry word was found, or output empty): $(echo "$ADOPT_OUT" | grep -i expir | head -3)"

# =============================================================================
# scan: no admission / sampling source reads a qualification date
# =============================================================================
# strip comment lines, then require zero `expires` / `expires_at` / expiry_warning tokens.
# engine-scorecard.js keeps the strip-expiry migration (it must name the legacy field to remove
# it), so that block is cut out of the scan; capability-evidence.js keeps one line that REFUSES
# a legacy expires_at.
scan_tokens() { # file [exclude-regex-for-lines]
  grep -v -E '^[[:space:]]*(//|\*|/\*|#)' "$1" | grep -n -E 'expires(_at)?\b|expiry_warning|computeExpiryWarning|MAX_QUALIFIED_TTL_DAYS|ttl_days' | grep -v -E 'strip-expiry|--expires-days|no expiry' || true
}
SCAN_HITS=""
ESC_NOMIG="$TESTDIR/esc-without-migration.js"
awk '/^\/\/ strip-expiry: one-time migration/{skip=1} /^function main\(\)/{skip=0} !skip' "$ESC" > "$ESC_NOMIG"
CE_NOLEGACY="$TESTDIR/ce-without-legacy-line.js"
grep -v -E "value\.expires_at !== undefined|capability evidence has no expires_at" "$ROOT/src/engine/capability-evidence.js" > "$CE_NOLEGACY"
# isLegacyExpiryRow in engine-scorecard.js is the reader's legacy detector: also a named exception
grep -v -E "isLegacyExpiryRow|row\.expires !== undefined|row\.evidence\.expires_at !== undefined|a scorecard row has no expires field" "$ESC_NOMIG" > "$ESC_NOMIG.2"
for pair in "$ESC_NOMIG.2" "$CE_NOLEGACY" "$RST" "$ROOT/scripts/lib/qualification-record-v2.js" "$ROOT/scripts/build-qualification-defaults.js" "$ROOT/scripts/adopt-qualification-defaults.js" "$ROOT/scripts/engine-qualify.js"; do
  h=$(scan_tokens "$pair")
  [ -n "$h" ] && SCAN_HITS="$SCAN_HITS
$pair:
$h"
done
# engine-qualify.js names --expires-days exactly once, in the line that REFUSES it
EQ_HITS=$(grep -v -E "expires-days|no expiry" "$ROOT/scripts/engine-qualify.js" | grep -c -E 'expiresDays|expires_at|expiresAt' || true)
[ "$EQ_HITS" = "0" ] || SCAN_HITS="$SCAN_HITS
engine-qualify.js still computes an expiry ($EQ_HITS lines)"
[ -z "$SCAN_HITS" ] && ok "scan1: no scorecard / evidence / tier / build / adopt / qualify source reads or writes a qualification date" \
  || bad "scan1: expiry token(s) in an admission or writer source:$SCAN_HITS"

# the dispatch contract and the review-loop resolver keep ONE date contract: the operator
# override file's own `expires` (a separate, explicitly operator-written waiver). Neither may
# know about expiry_warning, nor read a date off a scorecard ROW.
ROWDATE_HITS=$(grep -v -E '^[[:space:]]*(//|#)' "$DC" "$RRL" | grep -E 'expiry_warning|row\.expires|r\.expires|\.expires_at' | grep -v -i 'override\|retention\|marker\|isCalendarDate' || true)
[ -z "$ROWDATE_HITS" ] && ok "scan2: dispatch-contract.js and resolve-review-loop.sh read no date off a scorecard row" \
  || bad "scan2: a row date is read: $ROWDATE_HITS"

# the literal `expired` status must not be produced or compared in any admission branch
P3_HITS=""
for fx in "$ESC_NOMIG.2" "$RRL" "$DC" "$RST"; do
  h=$(grep -v -E '^[[:space:]]*(//|#)' "$fx" | grep -nE "===[[:space:]]*['\"]expired['\"]|['\"]expired['\"][[:space:]]*===|\?[[:space:]]*['\"]expired['\"]|:[[:space:]]*['\"]expired['\"]|return[[:space:]]+['\"]expired['\"]" || true)
  [ -n "$h" ] && P3_HITS="$P3_HITS
$fx:
$h"
done
[ -z "$P3_HITS" ] && ok "scan3: no admission path produces or compares an 'expired' status literal" \
  || bad "scan3: found expired-literal branch(es):$P3_HITS"

# =============================================================================
# cli: --expires-days is refused
# =============================================================================
EQ_OUT=$(node "$ROOT/scripts/engine-qualify.js" reviewer --expires-days 30 2>&1); EQ_RC=$?
[ "$EQ_RC" = "2" ] && echo "$EQ_OUT" | grep -q -i "no expiry" \
  && ok "cli1: engine-qualify --expires-days 30 exits 2 saying qualification has no expiry" \
  || bad "cli1: rc=$EQ_RC out=$EQ_OUT"

# =============================================================================
# migrate: a store written by the OLD code (committed fixture: real rows, a row whose date
# had passed, evidence sealed with expires_at, a pin carrying expires:null, three strikes)
# =============================================================================
LEG_FIX="$ROOT/hooks/tests/fixtures/legacy-expiry-store"
mk_legacy() { # dest
  rm -rf "$1"; mkdir -p "$1/sc" "$1/cap"
  cp "$LEG_FIX/scorecard.jsonl" "$1/sc/"
  cp "$LEG_FIX/qualification-evidence.jsonl" "$LEG_FIX/pins.jsonl" "$LEG_FIX/strikes.jsonl" "$1/cap/"
}
LEG="$TESTDIR/legacy"; mk_legacy "$LEG"
LEG_SC_SHA=$(sha256sum "$LEG/sc/scorecard.jsonl" | awk '{print $1}')
LEG_ENV=(env ENGINE_SCORECARD_DIR="$LEG/sc" ENGINE_CAPABILITY_DIR="$LEG/cap")

"${LEG_ENV[@]}" node "$ESC" current --role reviewer >"$TESTDIR/leg-read.out" 2>&1; LEG_READ_RC=$?
[ "$LEG_READ_RC" != "0" ] && grep -q "strip-expiry" "$TESTDIR/leg-read.out" \
  && ok "migrate1: reading an old-format store fails with a message naming the one-line migration (node scripts/engine-scorecard.js strip-expiry)" \
  || bad "migrate1: rc=$LEG_READ_RC out=$(head -c 300 "$TESTDIR/leg-read.out")"

"${LEG_ENV[@]}" node "$ESC" strip-expiry --dry-run >"$TESTDIR/leg-dry.out" 2>&1
[ "$(sha256sum "$LEG/sc/scorecard.jsonl" | awk '{print $1}')" = "$LEG_SC_SHA" ] && grep -q '"dry_run":true' "$TESTDIR/leg-dry.out" \
  && ok "migrate2: --dry-run plans and writes nothing" || bad "migrate2: $(cat "$TESTDIR/leg-dry.out")"

"${LEG_ENV[@]}" node "$ESC" strip-expiry >"$TESTDIR/leg-run.out" 2>&1; LEG_RUN_RC=$?
BAK_COUNT=$(find "$LEG" -name '*.bak-strip-expiry-*' | wc -l)
LEFT=$(grep -c -E '"expires' "$LEG/sc/scorecard.jsonl" "$LEG/cap/qualification-evidence.jsonl" "$LEG/cap/pins.jsonl" | grep -v ':0$' || true)
[ "$LEG_RUN_RC" = "0" ] && [ "$BAK_COUNT" = "3" ] && [ -z "$LEFT" ] \
  && ok "migrate3: strip-expiry backs up the three stores it rewrites and leaves no expiry key in any of them" \
  || bad "migrate3: rc=$LEG_RUN_RC backups=$BAK_COUNT left=[$LEFT] out=$(cat "$TESTDIR/leg-run.out")"
BAK_SC=$(find "$LEG" -name 'scorecard.jsonl.bak-strip-expiry-*' | head -1)
[ -n "$BAK_SC" ] && [ "$(sha256sum "$BAK_SC" | awk '{print $1}')" = "$LEG_SC_SHA" ] \
  && ok "migrate4: the scorecard backup is the original bytes" || bad "migrate4: backup missing or altered"

"${LEG_ENV[@]}" node "$ESC" strip-expiry >"$TESTDIR/leg-run2.out" 2>&1
grep -q '"already_migrated":true' "$TESTDIR/leg-run2.out" && ! find "$LEG" -name '*.bak-strip-expiry-*' | wc -l | grep -q '^[4-9]' \
  && ok "migrate5: a second run is a no-op (already_migrated, no new backup)" || bad "migrate5: $(cat "$TESTDIR/leg-run2.out")"

# admission of every seat in the fixture, read at a date long after every old `expires`:
# the claude-haiku reviewer row had a past date (2026-10-14) and three strikes; gpt-5.6-sol
# reviewer (past date) is qualified; GLM-5.3 reviewer failed; kimi consult (past date) qualified.
# Pinned from the OLD code's own output on this fixture (base 2ff568412, same --now).
proj() { # role -> "engine:status:admission:strikes" lines
  "${LEG_ENV[@]}" node "$ESC" current --role "$1" --now 2026-10-26T00:00:00Z \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const r of JSON.parse(s))console.log([r.engine,r.status,r.observed_status,r.admission_status,r.strikes_since_pass].join(":"))})' | sort | tr '\n' ' '
}
PROJ_REV=$(proj reviewer); PROJ_CON=$(proj consult)
case "$PROJ_REV" in
  *"gpt-5.6-sol:provisional:qualified:qualified:0"*"GLM-5.3:failed:failed:no_record:0"*|*"GLM-5.3:failed:failed:no_record:0"*"gpt-5.6-sol:provisional:qualified:qualified:0"*) REV_OK=1 ;;
  *) REV_OK=0 ;;
esac
echo "$PROJ_REV" | grep -q "claude-haiku:provisional:qualified:requalify_required:3" || REV_OK=0
echo "$PROJ_CON" | grep -q "kimi-code-k3:provisional:qualified:qualified:0" || REV_OK=0
[ "$REV_OK" = "1" ] \
  && ok "migrate6: seats whose old date had long passed are still qualified after migration, the failed seat is still failed, and the planted 3 strikes survived and now enforce (requalify_required by default)" \
  || bad "migrate6: reviewer=[$PROJ_REV] consult=[$PROJ_CON]"

# an old `expired` status (the only status the old code ever wrote for a past date) maps to qualified
LEG2="$TESTDIR/legacy2"; mk_legacy "$LEG2"
node -e '
const fs=require("fs");const p=process.argv[1];
const rows=fs.readFileSync(p,"utf8").trim().split("\n").map(JSON.parse);
for(const r of rows) if(r.event_id===5) r.status="expired";
fs.writeFileSync(p,rows.map(r=>JSON.stringify(r)).join("\n")+"\n")' "$LEG2/sc/scorecard.jsonl"
env ENGINE_SCORECARD_DIR="$LEG2/sc" ENGINE_CAPABILITY_DIR="$LEG2/cap" node "$ESC" strip-expiry >"$TESTDIR/leg2.out" 2>&1
grep -q '"expired_status_mapped":1' "$TESTDIR/leg2.out" \
  && env ENGINE_SCORECARD_DIR="$LEG2/sc" ENGINE_CAPABILITY_DIR="$LEG2/cap" node "$ESC" current --role reviewer --now 2026-10-26T00:00:00Z | grep -q '"engine":"claude-haiku".*"observed_status":"qualified"' \
  && ok "migrate7: an old status 'expired' row becomes qualified (it had qualified, then only its date passed)" \
  || bad "migrate7: $(cat "$TESTDIR/leg2.out")"

# a legacy evidence record stored in the retired `stale` state migrates (never an error): base only
# DERIVED stale from the date at query time (capability-evidence.js:1966) and read a stored one as
# not qualified (engine-scorecard.js:1709-1711), so it maps to degraded and its row to failed.
LEG4="$TESTDIR/legacy4"; mk_legacy "$LEG4"
node -e '
const fs=require("fs");
const sp=process.argv[1]+"/sc/scorecard.jsonl", ep=process.argv[1]+"/cap/qualification-evidence.jsonl";
const rows=fs.readFileSync(sp,"utf8").trim().split("\n").map(JSON.parse);
const ws=fs.readFileSync(ep,"utf8").trim().split("\n").map(JSON.parse);
for(const id of [141,157]){ // two qualified rows, each anchored to an evidence wrapper
  const row=rows.find(r=>r.event_id===id); row.evidence.state="stale";
  if(row.evidence_store) for(const w of ws) if(w.event_id===row.evidence_store.event_id) w.evidence.state="stale";
}
fs.writeFileSync(sp,rows.map(r=>JSON.stringify(r)).join("\n")+"\n");
fs.writeFileSync(ep,ws.map(r=>JSON.stringify(r)).join("\n")+"\n")' "$LEG4"
L4=(env ENGINE_SCORECARD_DIR="$LEG4/sc" ENGINE_CAPABILITY_DIR="$LEG4/cap")
"${L4[@]}" node "$ESC" strip-expiry --dry-run >"$TESTDIR/leg4-dry.out" 2>&1; L4_DRY_RC=$?
"${L4[@]}" node "$ESC" strip-expiry >"$TESTDIR/leg4.out" 2>&1; L4_RC=$?
L4_STATE=$(node -e 'const fs=require("fs");const rs=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);console.log([141,157].map(i=>{const r=rs.find(x=>x.event_id===i);return r.status+":"+r.evidence.state}).join(" "))' "$LEG4/sc/scorecard.jsonl")
L4_PROJ=$("${L4[@]}" node "$ESC" current --role reviewer --now 2026-10-26T00:00:00Z | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).find(x=>x.engine==="gpt-5.6-sol");console.log(r.observed_status+":"+r.admission_status)})')
[ "$L4_DRY_RC" = "0" ] && grep -q '"stale_state_mapped":2' "$TESTDIR/leg4-dry.out" && [ "$L4_RC" = "0" ] \
  && [ "$L4_STATE" = "failed:degraded failed:degraded" ] && [ "${L4_PROJ%%:*}" = "failed" ] \
  && ok "migrate10: an old store holding a stale-state evidence record migrates (stale_state_mapped=2): evidence degraded, row failed, seat not admitted as qualified" \
  || bad "migrate10: dry_rc=$L4_DRY_RC rc=$L4_RC state=$L4_STATE proj=$L4_PROJ out=$(cat "$TESTDIR/leg4.out") dry=$(cat "$TESTDIR/leg4-dry.out")"

# evidence ids are content hashes with expires_at inside them: they changed, and nothing dangles
NEW_EV_IDS=$(node -e 'const fs=require("fs");console.log(fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l).evidence.evidence_id).join(" "))' "$LEG/cap/qualification-evidence.jsonl")
OLD_EV_IDS=$(node -e 'const fs=require("fs");console.log(fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l).evidence.evidence_id).join(" "))' "$LEG_FIX/qualification-evidence.jsonl")
DANGLING=0
for id in $OLD_EV_IDS; do grep -q "$id" "$LEG/sc/scorecard.jsonl" "$LEG/cap/qualification-evidence.jsonl" && DANGLING=1; done
[ "$NEW_EV_IDS" != "$OLD_EV_IDS" ] && [ "$DANGLING" = "0" ] \
  && ok "migrate8: every evidence record was re-sealed and no old evidence id is left in the scorecard or the evidence store" \
  || bad "migrate8: dangling=$DANGLING new=[$NEW_EV_IDS] old=[$OLD_EV_IDS]"

# the same store with a pin carrying expires:null is refused by the pin reader with the migration named
LEG3="$TESTDIR/legacy3"; mk_legacy "$LEG3"
env ENGINE_SCORECARD_DIR="$LEG3/sc" ENGINE_CAPABILITY_DIR="$LEG3/cap" node "$ROOT/scripts/engine-capability-state.js" pins --role implementer --store "$LEG3/cap" >"$TESTDIR/leg3.out" 2>&1; LEG3_RC=$?
[ "$LEG3_RC" != "0" ] && grep -q "strip-expiry" "$TESTDIR/leg3.out" \
  && ok "migrate9: a pre-migration pin row (expires:null) is refused naming strip-expiry, not silently dropped" \
  || bad "migrate9: rc=$LEG3_RC out=$(cat "$TESTDIR/leg3.out")"

# =============================================================================
# v2.34.37 — THE DEFAULT CLOCK IS AN INSTANT, NOT UTC MIDNIGHT.
#
# `nowArgToMs` used to default to the start of the current UTC day, and every
# instant comparison in the projection inherited that truncation. Both halves
# below are the BACKLOG row's own reproductions, run with NO `--now` — which is
# exactly how production reaches this code (`dispatch-contract.js` never passes
# one). Neither can be satisfied by a truncating clock, so re-introducing the
# truncation turns both red (evidence-discipline §2).
#
# Pre-fix output, verbatim, from this worktree before the change landed:
#   (b) default clock : {"admission_status":"qualified", ...,
#         "strikes_since_pass":0, "rejected_strikes":3, ...}
#       explicit --now 2026-09-01 : {..., "strikes_since_pass":3,
#         "would_requalify":true, "rejected_strikes":0, ...}
#   (a) default clock : {"admission_status":"no_record", ...,
#         "baseline_event_id":null, ...}
#       --now <next day> : {"admission_status":"qualified", ...,
#         "baseline_event_id":1, ...}
#
# Both fixtures stamp their instant at `max(UTC-midnight + 1 ms, now - 60 s)`, so
# they stay strictly inside "later today" at EVERY hour of the day — including a
# run that starts at 00:00:00Z, where a naive "now" would coincide with the
# truncated clock and the assertion would pass vacuously.
# =============================================================================
LATER_TODAY_TS=$(node -e '
  const now = Date.now();
  const midnight = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
  process.stdout.write(new Date(Math.max(midnight + 1, now - 60000)).toISOString());
')
TODAY_UTC=$(node -e 'process.stdout.write(new Date().toISOString().slice(0, 10))')

# (a) An evidence receipt issued later the SAME UTC day must read as qualified
# and supply a baseline. Under the truncated clock the receipt was not yet valid
# at evaluation_time, deriveStatus refused it, findSeatBaseline found nothing,
# and seat-status answered `no_record` for a seat with a QUALIFIED row on disk.
#
# The evidence blob is re-stamped from a REAL shipped administration
# (references/official-qualification-defaults.json) through
# capability-evidence.js's own compiler, and its qualifier-store anchor is
# rebuilt with capabilityEvidenceProducerHash — so `record` admits it by the
# same path a live `engine-qualify` administration takes, not a hand-waved one.
reset_stores
RECEIPT_OUT=$(node - "$ROOT" "$SCORECARD_DIR" "$CAPABILITY_DIR" "$LATER_TODAY_TS" "$TODAY_UTC" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, scDir, capDir, issued, today] = process.argv.slice(2);
const {
  compileCapabilityEvidence,
  capabilityEvidenceProducerHash,
} = require(path.join(root, 'src/engine/capability-evidence.js'));

const artifact = JSON.parse(fs.readFileSync(
  path.join(root, 'references/official-qualification-defaults.json'), 'utf8',
));
// Pinned seat (BL-0257 notes 7 and 8): select by engine, runner, role and effort, not "first qualified".
const PIN = { engine: 'claude-sonnet-5-5', runner: 'claude-native', role: 'consult', effort: 'high' };
const src = artifact.defaults.find((d) => d.row && d.row.evidence
  && d.row.status === 'qualified' && d.capability_evidence
  && Object.keys(PIN).every((k) => d.row[k] === PIN[k]));
if (!src) { process.stdout.write('NO_FIXTURE'); process.exit(0); }

const raw = JSON.parse(JSON.stringify(src.row.evidence));
for (const derived of ['evidence_id', 'evidence_hash', 'scope_hash', 'identity_hash',
  'grant_identity_hash', 'trial_set_hash']) delete raw[derived];
raw.issued_at = issued;
raw.observed_at = issued;
for (const trial of raw.trials || []) { if (trial.observed_at) trial.observed_at = issued; }
const evidence = compileCapabilityEvidence(raw);

const producer = src.capability_evidence.producer;
const transcriptHash = capabilityEvidenceProducerHash(evidence, producer);
fs.mkdirSync(capDir, { recursive: true });
fs.writeFileSync(path.join(capDir, 'qualification-evidence.jsonl'),
  `${JSON.stringify({ ...src.capability_evidence, event_id: 1, evidence, transcript_hash: transcriptHash })}\n`);

const row = JSON.parse(JSON.stringify(src.row));
row.date = today;
row.qualified_at = today;
row.evidence = evidence;
row.evidence_store = { event_id: 1, producer, transcript_hash: transcriptHash };
const rowFile = path.join(capDir, 'receipt-row.json');
fs.writeFileSync(rowFile, `${JSON.stringify(row)}\n`);

const env = { ...process.env, ENGINE_SCORECARD_DIR: scDir, ENGINE_CAPABILITY_DIR: capDir };
const ESC = path.join(root, 'scripts/engine-scorecard.js');
try {
  execFileSync('node', [ESC, 'record', '--file', rowFile], { env, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  process.stdout.write(`RECORD_FAILED:${String(err.stderr || err.stdout || err.message).trim()}`);
  process.exit(0);
}
// NO --now: this is the production default clock.
// The seat is (engine, runner, role, effort) since v2.35.9 — query the seat this fixture
// actually created. Omitting --effort would select the LEGACY partition, which is a different
// seat, and the row would correctly not be found.
const out = execFileSync('node', [ESC, 'seat-status',
  '--engine', row.engine, '--runner', row.runner, '--role', row.role,
  ...(row.effort === undefined ? [] : ['--effort', row.effort])], { env, encoding: 'utf8' });
const projection = JSON.parse(out);
process.stdout.write(`${projection.admission_status}:${projection.baseline_event_id}:`
  + `${row.engine}/${row.runner}/${row.role}/${row.effort}`);
NODE
)
[ "${RECEIPT_OUT%:*}" = "qualified:1" ] \
  && ok "instant2: an evidence receipt issued later TODAY reads qualified with a baseline under the DEFAULT clock (was no_record / baseline null)" \
  || bad "instant2: expected 'qualified:1:<seat>', got '$RECEIPT_OUT'"

# RED at 4a6d7eba7: FAIL instant2-seat: expected the fixture seat to be claude-sonnet-5-5/claude-native/consult/high, got 'qualified:1' (28 passed, 1 failed)
# instant2 seat pin (BL-0257 notes 7 and 8). The fixture used to take "the first qualified
# default" of the shipped artifact, so which engine/runner/role it exercised was whatever
# happened to sort first, and nothing checked it. It now names its seat and reports the seat
# it actually recorded and queried; both must equal the pinned seat.
INSTANT2_SEAT='claude-sonnet-5-5/claude-native/consult/high'
case "$RECEIPT_OUT" in
  *":$INSTANT2_SEAT") ok "instant2-seat: the receipt fixture exercised the pinned seat $INSTANT2_SEAT" ;;
  *) bad "instant2-seat: expected the fixture seat to be $INSTANT2_SEAT, got '$RECEIPT_OUT'" ;;
esac

# (b) A strike written later the SAME UTC day as the read must COUNT. Under the
# truncated clock foldSeatStrikes' `observedMs <= nowMs` window ended at
# midnight, so it landed in `rejected_strikes` and enforcement was a silent
# no-op for up to 24h after every midnight.
reset_stores
echo "$(score_row SAMEDAY codex reviewer 2026-01-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_SD=$(seat_hash SAMEDAY codex reviewer)
{
  strike_line "$SH_SD" SAMEDAY codex reviewer ordinary_strike null fuse "rcpt-sd-1" "inc-sd-1:det-1" "$LATER_TODAY_TS" 1
  strike_line "$SH_SD" SAMEDAY codex reviewer ordinary_strike null fuse "rcpt-sd-2" "inc-sd-2:det-1" "$LATER_TODAY_TS" 2
  strike_line "$SH_SD" SAMEDAY codex reviewer ordinary_strike null fuse "rcpt-sd-3" "inc-sd-3:det-1" "$LATER_TODAY_TS" 3
} > "$STRIKES_FILE"
SS_SD=$(node "$ESC" seat-status --engine SAMEDAY --runner codex --role reviewer)
sp_sd=$(echo "$SS_SD" | jq_get strikes_since_pass)
rej_sd=$(echo "$SS_SD" | jq_get rejected_strikes)
wr_sd=$(echo "$SS_SD" | jq_get would_requalify)
[ "$sp_sd" = "3" ] && [ "$rej_sd" = "0" ] && [ "$wr_sd" = "true" ] \
  && ok "instant1: three strikes stamped later TODAY count under the DEFAULT clock (strikes_since_pass=3, rejected_strikes=0, would_requalify)" \
  || bad "instant1: strikes_since_pass=$sp_sd rejected_strikes=$rej_sd would_requalify=$wr_sd out=$SS_SD"

# The default clock must not be re-truncated. `todayMsUtc` (the removed helper)
# is banned from the WHOLE file — it lived in the argument parsers (nowArgToMs
# and the three parse*Args sites), which sit ABOVE the deriveStatus admission
# region this suite otherwise scans, so the whole file is scanned. No start-of-day floor
# survives either: there is no date-vs-date comparison left in the projection.
TRUNC_HITS=$(awk '
  /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
  /todayMsUtc\(\)/ { print NR": "$0 }
' "$ESC")
[ -z "$TRUNC_HITS" ] \
  && ok "instant3: no call to the removed todayMsUtc() helper remains in engine-scorecard.js (a grep for that name only; the behaviour is instant1/instant2)" \
  || bad "instant3: the removed todayMsUtc() helper is called again: $TRUNC_HITS"

# ...and the same must hold for the shipped Codex mirror, which is a byte copy.
TRUNC_HITS_MIRROR=$(awk '
  /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
  /todayMsUtc\(\)/ { print NR": "$0 }
' "$ROOT/platforms/codex/plugin/scripts/engine-scorecard.js" 2>/dev/null)
[ -z "$TRUNC_HITS_MIRROR" ] \
  && ok "instant4: no call to the removed todayMsUtc() helper in the Codex mirror of engine-scorecard.js (a grep for that name only)" \
  || bad "instant4: the removed todayMsUtc() helper is called in the Codex mirror: $TRUNC_HITS_MIRROR"

# =============================================================================
# Landing assertion (evidence-discipline §9): rows landed in the isolated
# dirs, and the operator's real ~/.autopilot stores were never touched by
# this suite.
# =============================================================================
[ -f "$SCORECARD_DIR/scorecard.jsonl" ] && [ -s "$SCORECARD_DIR/scorecard.jsonl" ] \
  && ok "landing1: scorecard rows landed in the isolated ENGINE_SCORECARD_DIR" \
  || bad "landing1: no rows found in $SCORECARD_DIR/scorecard.jsonl"
[ -f "$STRIKES_FILE" ] && [ -s "$STRIKES_FILE" ] \
  && ok "landing2: strike rows landed in the isolated ENGINE_CAPABILITY_DIR" \
  || bad "landing2: no rows found in $STRIKES_FILE"

REAL_SCORECARD_SIZE_AFTER=$( [ -f "$REAL_SCORECARD" ] && stat -c%s "$REAL_SCORECARD" 2>/dev/null || echo 0 )
REAL_CAPABILITY_SIZE_AFTER=$( [ -f "$REAL_CAPABILITY" ] && stat -c%s "$REAL_CAPABILITY" 2>/dev/null || echo 0 )
[ "$REAL_SCORECARD_SIZE_AFTER" = "$REAL_SCORECARD_SIZE_BEFORE" ] \
  && ok "landing3: ~/.autopilot/engine-scorecard/ was NOT written by this suite" \
  || bad "landing3: real scorecard store size changed ($REAL_SCORECARD_SIZE_BEFORE -> $REAL_SCORECARD_SIZE_AFTER)"
[ "$REAL_CAPABILITY_SIZE_AFTER" = "$REAL_CAPABILITY_SIZE_BEFORE" ] \
  && ok "landing4: ~/.autopilot/engine-capability/ was NOT written by this suite" \
  || bad "landing4: real capability store size changed ($REAL_CAPABILITY_SIZE_BEFORE -> $REAL_CAPABILITY_SIZE_AFTER)"

echo "----"
echo "calendar-teeth-negative harness: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
