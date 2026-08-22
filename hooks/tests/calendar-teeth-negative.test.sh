#!/usr/bin/env bash
# Planted negative controls for the 2026-08-22 no-confidence-decay cut
# (docs/plans/2026-08-22-no-confidence-decay.md §4 P1/P2/P3).
#
# Three calendar teeth were pulled from the admission path:
#   (a) engine-scorecard.js deriveStatus no longer emits `expired` for a
#       past-`expires` qualified row (or a `stale` evidence receipt).
#   (b) resolve-review-loop.sh's density-scaling tier keys on the
#       strike-decay projection's admission_status, never on a date.
#   (c) dispatch-contract.js's isAdmissibleScorecardRow admits a
#       past-expires row and only refuses on admission_status ===
#       'requalify_required'.
#
# Each assertion below fails if its tooth is re-introduced (evidence-discipline
# §2: a suite that passes when you delete the gate it tests has not tested
# it). The P3 contract test (last section) is a grep-able negative on the
# admission source itself; its not-vacuous demonstration (tooth reintroduced
# => red, reverted => green) is pasted in the dispatching session's report,
# not re-run automatically here (mutating shipped source mid-suite is unsafe).
set -uo pipefail

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
trap 'rm -rf "$TESTDIR"' EXIT

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
{"engine":"$engine","runner":"$runner","family":"f","role":"$role","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"sha256:x","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0,"usd_per_mtok_output":0,"sample_tokens":0},"latency":{"sample_wall_time_s":0},"status":"$status","qualified_at":"$qat","expires":"$exp"}
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
# (a) past-expires qualified row projects qualified + expiry_warning,
#     admission_status qualified, store unmutated.
# =============================================================================
reset_stores
echo "$(score_row A codex reviewer 2026-01-01 2026-01-02)" | node "$ESC" record >/dev/null 2>&1
OUT_A=$(node "$ESC" current --role reviewer --now 2026-06-30)
obs=$(echo "$OUT_A" | jq_get 0.observed_status)
st=$(echo "$OUT_A" | jq_get 0.status)
adm=$(echo "$OUT_A" | jq_get 0.admission_status)
ew=$(echo "$OUT_A" | jq_get 0.expiry_warning)
stored=$(grep -o '"status":"[a-z]*"' "$SCORECARD_DIR/scorecard.jsonl" | head -1)
[ "$obs" = "qualified" ] && [ "$st" = "provisional" ] && [ "$adm" = "qualified" ] && [ "$ew" = "true" ] \
  && [ "$stored" = '"status":"qualified"' ] \
  && ok "a1: past-expires row => observed_status/admission_status qualified, expiry_warning true, store unmutated" \
  || bad "a1: obs=$obs st=$st adm=$adm ew=$ew stored=$stored"

# =============================================================================
# (b) the same past-expires row does NOT get tier 'low' from resolve-review-loop.sh
# =============================================================================
IMPL_CFG="$TESTDIR/impl-cfg.md"
printf -- '- implementer_engine: A\n- implementer_runner: codex\n' > "$IMPL_CFG"
reset_stores
echo "$(score_row A codex implementer 2026-01-01 2026-01-02)" | node "$ESC" record >/dev/null 2>&1
RRL_OUT=$(REVIEW_LOOP_CONFIG_OVERRIDE="$IMPL_CFG" bash "$RRL" --scale-by-capability 2>/dev/null || true)
TIER=$(printf '%s' "$RRL_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(String(d.capability_tier||""))}catch{process.stdout.write("")}})' 2>/dev/null || true)
[ "$TIER" != "low" ] && ok "b1: past-expires implementer row does not tier 'low' (got '$TIER')" \
  || bad "b1: past-expires implementer row tiered 'low' — calendar tooth (b) reintroduced"

# =============================================================================
# (c) the same past-expires row gets a GO from dispatch-contract.js
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
    printf -- '- implementer_engine: %s\n- implementer_runner: %s\n' "$engine" "$runner" > .claude/review-loop-config.md
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
[ "$VERDICT" = "GO" ] && ok "c1: past-expires implementer row GOes under dispatch-contract.js (calendar tooth c pulled)" \
  || bad "c1: dispatch-contract verdict=$VERDICT out=$DC_OUT"

# =============================================================================
# Strike accumulation — shadow-first (KR6): 3 ordinary strikes => would_requalify
# true but admission_status stays qualified under the DEFAULT shadow flag.
# =============================================================================
reset_stores
echo "$(score_row B codex reviewer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_B=$(seat_hash B codex reviewer)
{
  strike_line "$SH_B" B codex reviewer ordinary_strike null fuse "rcpt-1" "inc-1:det-1" "2026-06-02T00:00:00Z" 1
  strike_line "$SH_B" B codex reviewer ordinary_strike null fuse "rcpt-2" "inc-2:det-1" "2026-06-03T00:00:00Z" 2
  strike_line "$SH_B" B codex reviewer ordinary_strike null fuse "rcpt-3" "inc-3:det-1" "2026-06-04T00:00:00Z" 3
} > "$STRIKES_FILE"
unset AUTOPILOT_STRIKE_ENFORCEMENT
SS_B=$(node "$ESC" seat-status --engine B --runner codex --role reviewer --now 2026-06-30)
wr=$(echo "$SS_B" | jq_get would_requalify)
adm=$(echo "$SS_B" | jq_get admission_status)
sp=$(echo "$SS_B" | jq_get strikes_since_pass)
[ "$wr" = "true" ] && [ "$sp" = "3" ] && [ "$adm" = "qualified" ] \
  && ok "strike1: 3 ordinary strikes => would_requalify true, admission_status qualified under shadow (default)" \
  || bad "strike1: would_requalify=$wr strikes_since_pass=$sp admission_status=$adm"

# Same fixture with AUTOPILOT_STRIKE_ENFORCEMENT=enforce => requalify_required,
# tier 'low', and dispatch-contract.js NO-GO naming the strike cause.
SS_B_ENF=$(AUTOPILOT_STRIKE_ENFORCEMENT=enforce node "$ESC" seat-status --engine B --runner codex --role reviewer --now 2026-06-30)
adm_enf=$(echo "$SS_B_ENF" | jq_get admission_status)
[ "$adm_enf" = "requalify_required" ] && ok "strike2: same fixture under --enforce => requalify_required" \
  || bad "strike2: admission_status=$adm_enf under enforce"

IMPL_CFG_B="$TESTDIR/impl-cfg-b.md"
printf -- '- implementer_engine: B\n- implementer_runner: codex\n' > "$IMPL_CFG_B"
echo "$(score_row B codex implementer 2026-06-01 2099-01-01)" | node "$ESC" record >/dev/null 2>&1
SH_B_IMPL=$(seat_hash B codex implementer)
{
  cat "$STRIKES_FILE"
  strike_line "$SH_B_IMPL" B codex implementer ordinary_strike null fuse "rcpt-4" "inc-4:det-1" "2026-06-02T00:00:00Z" 4
  strike_line "$SH_B_IMPL" B codex implementer ordinary_strike null fuse "rcpt-5" "inc-5:det-1" "2026-06-03T00:00:00Z" 5
  strike_line "$SH_B_IMPL" B codex implementer ordinary_strike null fuse "rcpt-6" "inc-6:det-1" "2026-06-04T00:00:00Z" 6
} > "$STRIKES_FILE.tmp" && mv "$STRIKES_FILE.tmp" "$STRIKES_FILE"
RRL_OUT_B=$(REVIEW_LOOP_CONFIG_OVERRIDE="$IMPL_CFG_B" AUTOPILOT_STRIKE_ENFORCEMENT=enforce bash "$RRL" --scale-by-capability 2>/dev/null || true)
TIER_B=$(printf '%s' "$RRL_OUT_B" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(String(d.capability_tier||""))}catch{process.stdout.write("")}})' 2>/dev/null || true)
[ "$TIER_B" = "low" ] && ok "strike3: requalify_required seat tiers 'low' under --enforce" \
  || bad "strike3: capability_tier=$TIER_B (want low)"

CAP_EVENT_B="$TESTDIR/cap-event-b.json"
cat > "$CAP_EVENT_B" <<EOF
{"schema_version":1,"observed_at":"$(node -e 'process.stdout.write(new Date().toISOString())')","runner":"codex","model":"B","role":"implementer","effort":"high","endpoint":null,"capability":{"quota":{"status":"available","confidence":"high","ttl_seconds":3600,"reset_at":null,"evidence":"test"}}}
EOF
node "$ROOT/scripts/engine-capability-state.js" record --file "$CAP_EVENT_B" >/dev/null 2>&1 || true
FIXTURE_B=$(build_contract_fixture B codex u-b)
REPO_B="${FIXTURE_B%%|*}"
CONTRACT_B="${FIXTURE_B##*|}"
DC_OUT_B=$(AUTOPILOT_STRIKE_ENFORCEMENT=enforce node "$DC" check --contract "$CONTRACT_B" --repo "$REPO_B" --json 2>&1); DC_RC_B=$?
REASONS_B=$(printf '%s' "$DC_OUT_B" | jq_get reasons.0 2>/dev/null || true)
if [ "$DC_RC_B" != "0" ] && printf '%s' "$REASONS_B" | grep -q "requalification"; then
  ok "strike4: requalify_required seat NO-GOes from dispatch-contract.js naming the strike cause ($REASONS_B)"
else
  bad "strike4: rc=$DC_RC_B reasons=$REASONS_B out=$DC_OUT_B"
fi

# =============================================================================
# One critical_reexam_trigger => requalify_required immediately, under the
# DEFAULT shadow flag (critical always enforces).
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
  && ok "critical1: one critical_reexam_trigger => requalify_required under shadow (default)" \
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
# P3: no admission path compares `now` against `expires`. Grep-able negative
# on the three admission source files. Precise enough that re-introducing
# `expiresMs < nowMs => 'expired'` (or an equivalent) turns this red, loose
# enough that the legitimate expiry_warning computation does not trip it: the
# only permitted `now`-vs-expiry comparison must assign into a
# variable/field whose name contains "warning", and the literal token
# `expired` (case-insensitive `"expired"`) must never appear inside an
# admission branch (an `if`/ternary that can influence admission_status,
# rowStatus, or a NO-GO/tier decision).
# =============================================================================
# engine-scorecard.js's admission/projection region starts at deriveStatus
# (everything before it — REQUIRED_FIELDS validation, record-time evidence
# checks — is the WRITE path, where the frozen contract explicitly allows a
# legacy `status: "expired"` literal to be accepted ON INPUT for replay
# idempotency; it is never produced going forward). Scoping the scan to the
# admission region is what keeps this test from tripping on that legitimate
# input-acceptance line while still catching a reintroduced tooth anywhere
# admission decisions are actually made (deriveStatus, the current-row
# projection, computeSeatProjection, and everything below them, incl.
# cmdSeatStatus/cmdCurrent/cmdReport/cmdLadder).
ESC_ADMISSION_START=$(grep -n '^function deriveStatus' "$ESC" | head -1 | cut -d: -f1)
ESC_ADMISSION_REGION="$TESTDIR/esc-admission-region.js"
tail -n "+$ESC_ADMISSION_START" "$ESC" > "$ESC_ADMISSION_REGION"
[ -n "$ESC_ADMISSION_START" ] && [ -s "$ESC_ADMISSION_REGION" ] \
  || bad "p3_setup: could not locate engine-scorecard.js admission region (deriveStatus)"

# resolve-review-loop.sh and dispatch-contract.js have no legitimate
# "expired accepted on input" carve-out anywhere — their entire files are
# fair game for the literal-token scan.
p3_no_expired_literal_in_admission_branch() {
  # A live `'expired'`/`"expired"` token used as a comparison target or
  # return/assignment value (=== 'expired', 'expired' ===, ? 'expired' :,
  # : 'expired', return 'expired') is presumed to be an admission-branch
  # literal — the projection is documented to never PRODUCE that string, so
  # it may only appear in a prose comment explaining the pulled tooth. Full
  # comment lines (// ... for .js, # ... for .sh) are stripped first.
  local file="$1"
  grep -vE '^[[:space:]]*(//|#)' "$file" \
    | grep -nE "===[[:space:]]*['\"]expired['\"]|['\"]expired['\"][[:space:]]*===|\\?[[:space:]]*['\"]expired['\"]|:[[:space:]]*['\"]expired['\"]|return[[:space:]]+['\"]expired['\"]" \
    || true
}

P3_HITS=""
h=$(p3_no_expired_literal_in_admission_branch "$ESC_ADMISSION_REGION")
[ -n "$h" ] && P3_HITS="$P3_HITS
$ESC (admission region, from deriveStatus):
$h"
for f in "$RRL" "$DC" "$RST"; do
  h=$(p3_no_expired_literal_in_admission_branch "$f")
  [ -n "$h" ] && P3_HITS="$P3_HITS
$f:
$h"
done

if [ -z "$P3_HITS" ]; then
  ok "p3_1: no admission path compares an 'expired' literal inside a live admission branch"
else
  bad "p3_1: found expired-literal admission branch(es):$P3_HITS"
fi

# BLOCKER 2's actual bug never used the literal string 'expired' anywhere — isFresh()
# just returned `Date.parse(row.expires) > now` as a bare boolean, so p3_1's literal-
# token scan above would NOT have caught it. resolve-scaffold-tier.js has no legitimate
# now-vs-expiry carve-out at all (unlike engine-scorecard.js's computeExpiryWarning,
# which produces an advisory-only expiry_warning field) — it must have ZERO now-vs-
# expires comparisons anywhere in the file, full stop. A single-line awk scan (like
# p3_2's EW_HITS) is VACUOUS here: the real tooth reads
#   const t = Date.parse(row.expires || ''); return Number.isFinite(t) && t > now;
# — "now" and "expir" never share ONE line, so a per-line grep never sees them
# together. Comments are stripped, remaining lines joined with spaces, then scanned
# for "now"/"expir" co-occurring within 80 chars of a comparison operator — proven
# non-vacuous below by re-planting exactly this tooth (git-diff-and-revert, not left
# mutating the shipped file) and observing this assertion flip red, then green again.
p3_now_expiry_comparison_anywhere() {
  node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const stripped = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(" ");
    const flat = stripped.replace(/\s+/g, " ");
    const re = /now[\s\S]{0,80}?[<>][\s\S]{0,80}?expir|expir[\s\S]{0,80}?[<>][\s\S]{0,80}?now/i;
    const m = flat.match(re);
    process.stdout.write(m ? m[0] : "");
  ' "$1"
}
RST_HIT=$(p3_now_expiry_comparison_anywhere "$RST")
[ -z "$RST_HIT" ] && ok "p3_3: resolve-scaffold-tier.js has zero now-vs-expires comparisons anywhere (no expiry_warning carve-out exists here)" \
  || bad "p3_3: found a now-vs-expires comparison in resolve-scaffold-tier.js: $RST_HIT"

# The permitted now-vs-expires comparison must live ONLY inside
# computeExpiryWarning and assign only into a warning-named result — never
# feed admission_status, rowStatus, a tier, or a GO/NO-GO decision directly.
# Detected by: find every line in the admission region that compares a
# `nowMs`-named value against an expiry-derived value, then require ALL such
# lines to fall within computeExpiryWarning's own function body (found by its
# declaration line through the next line that is a bare closing brace).
CEW_START=$(grep -n '^function computeExpiryWarning' "$ESC_ADMISSION_REGION" | head -1 | cut -d: -f1)
CEW_END=$(awk -v s="$CEW_START" 'NR>s && /^}/ {print NR; exit}' "$ESC_ADMISSION_REGION")
[ -n "$CEW_START" ] && [ -n "$CEW_END" ] \
  || bad "p3_setup: could not locate computeExpiryWarning function boundaries"

EW_HITS=$(awk -v s="$CEW_START" -v e="$CEW_END" '
  /nowMs/ && (/</ || />/) && tolower($0) ~ /expir/ {
    if (NR < s || NR > e) print NR": "$0
  }
' "$ESC_ADMISSION_REGION")
[ -z "$EW_HITS" ] && ok "p3_2: the only now-vs-expires comparison in the admission region lives inside computeExpiryWarning" \
  || bad "p3_2: an expiry-vs-now comparison exists outside computeExpiryWarning: $EW_HITS"

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
