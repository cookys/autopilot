#!/usr/bin/env bash
# BL-0170: strike accrual and pending_revocation are keyed per seat KIND (brain vs foreman), not
# just engine+runner+role. Brain and foreman exams share role `owner`; a brain-seat strike must
# not count against the foreman seat (nor the reverse). Fixture stores only; never ~/.autopilot.
set -uo pipefail
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SC="$ROOT/scripts/engine-scorecard.js"
CAP="$ROOT/scripts/engine-capability-state.js"
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"' EXIT
export ENGINE_SCORECARD_DIR="$TESTDIR/sc" ENGINE_CAPABILITY_DIR="$TESTDIR/cap"
export AUTOPILOT_STRIKE_ENFORCEMENT=enforce
mkdir -p "$ENGINE_SCORECARD_DIR" "$ENGINE_CAPABILITY_DIR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
field() { node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=process.argv[1].split('.').reduce((o,k)=>o==null?o:o[k],d);process.stdout.write(String(v))" "$1"; }
sha_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
NOW="2026-10-15T00:00:00Z"

# Same engine, both a brain row and a foreman row, both qualified, role owner.
node -e '
const mk = (id, brain) => { const r = { event_id: id, engine: "dual", runner: "claude", role: "owner",
  status: "qualified", qualified_at: "2026-10-01", date: "2026-10-01",
  capability_score: 1, family: "x", cost: { source: "unknown" }, model_version: "v1",
  corpus_version: "c1", harness_version: "h1", runner_version: "r1", prompt_config_hash: "p1" };
  if (brain) r.methodology_kind = "owner_brain_seat"; return JSON.stringify(r) + "\n"; };
process.stdout.write(mk(1, true) + mk(2, false));' > "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

# strike <brain|foreman> <klass> <pred> <dedup>
strike() {
  local kind="$1" klass="$2" pred="$3" dedup="$4" args=()
  if [ "$kind" = brain ]; then args+=(--seat-kind brain); fi
  if [ -n "$pred" ]; then args+=(--predicate-id "$pred"); fi
  node "$CAP" strike-seat --engine dual --runner claude --role owner --class "$klass" \
    --cause-class engine_output --writer fuse --dedup-key "$dedup" --detector-id det --detector-version 1 \
    --artifact-sha256 "$(sha_of "$dedup")" --receipt-ref "r-$dedup" --now "$NOW" "${args[@]}" >>"$TESTDIR/strike.log" 2>&1
}
status_of() {  # <brain|default> <field>
  local args=()
  if [ "$1" = brain ]; then args+=(--seat-kind brain); fi
  node "$SC" seat-status --engine dual --runner claude --role owner --now "$NOW" "${args[@]}" | field "$2"
}
rows_of() {  # <brain|default> -> number of active_strike_rows (pending_revocation source)
  node -e '
const sc = require(process.argv[1]);
const r = sc.computeSeatProjection("dual", "claude", "owner", Date.parse(process.argv[3]), undefined, process.env.ENGINE_CAPABILITY_DIR, process.argv[2]);
process.stdout.write(String(r.active_strike_rows.length));' "$SC" "$1" "$NOW"
}

# A: three ordinary strikes on the BRAIN seat
strike brain ordinary_strike "" b1; strike brain ordinary_strike "" b2; strike brain ordinary_strike "" b3
[ "$(status_of brain strikes_since_pass)" = 3 ] && ok "A1 brain seat counts its 3 strikes" || bad "A1 brain strikes=$(status_of brain strikes_since_pass)"
[ "$(status_of brain admission_status)" = requalify_required ] && ok "A2 brain seat requalify_required" || bad "A2 brain=$(status_of brain admission_status)"
[ "$(status_of default strikes_since_pass)" = 0 ] && ok "A3 foreman seat strikes unaffected (0)" || bad "A3 foreman strikes=$(status_of default strikes_since_pass)"
[ "$(status_of default admission_status)" = qualified ] && ok "A4 foreman seat stays qualified" || bad "A4 foreman=$(status_of default admission_status)"
[ "$(rows_of default)" = 0 ] && ok "A5 foreman pending_revocation rows unaffected (0)" || bad "A5 foreman rows=$(rows_of default)"
[ "$(rows_of brain)" = 3 ] && ok "A6 brain pending_revocation rows = 3" || bad "A6 brain rows=$(rows_of brain)"

# B: reverse direction -- foreman strikes must not touch the brain count
strike foreman ordinary_strike "" f1
[ "$(status_of default strikes_since_pass)" = 1 ] && ok "B1 foreman counts its own strike" || bad "B1 foreman=$(status_of default strikes_since_pass)"
[ "$(status_of brain strikes_since_pass)" = 3 ] && ok "B2 brain count unchanged by foreman strike" || bad "B2 brain=$(status_of brain strikes_since_pass)"
strike foreman critical_reexam_trigger security_canary_disclosure f2
[ "$(status_of default critical_trigger)" = true ] && ok "B3 foreman critical enforces on foreman" || bad "B3 foreman crit=$(status_of default critical_trigger)"
[ "$(status_of brain critical_trigger)" = false ] && ok "B4 foreman critical does not enforce on brain" || bad "B4 brain crit=$(status_of brain critical_trigger)"
if [ "$(rows_of brain)" = 3 ] && [ "$(rows_of default)" = 2 ]; then ok "B5 pending_revocation rows split 3/2"; else bad "B5 rows brain=$(rows_of brain) foreman=$(rows_of default)"; fi

# C: default seat_hash is byte-stable (no orphaned strikes); brain differs and both sides agree
H_DEF="$(node "$CAP" seat-hash --engine dual --runner claude --role owner | field seat_hash)"
H_BR="$(node "$CAP" seat-hash --engine dual --runner claude --role owner --seat-kind brain | field seat_hash)"
H_LEG="$(node -e 'const c=require("crypto");process.stdout.write(c.createHash("sha256").update(JSON.stringify({engine:"dual",role:"owner",runner:"claude"})).digest("hex"))')"
[ "$H_DEF" = "$H_LEG" ] && ok "C1 default seat_hash unchanged" || bad "C1 default hash drifted"
[ "$H_BR" != "$H_DEF" ] && ok "C2 brain seat_hash differs" || bad "C2 brain hash == default"
[ -n "$H_BR" ] && [ "$(node "$SC" seat-status --engine dual --runner claude --role owner --seat-kind brain | field seat_hash)" = "$H_BR" ] \
  && ok "C3 scorecard and capability-state agree on the brain hash" || bad "C3 hash mirror diverged"

# D: seatKindOf scope-only brain branch (no methodology_kind, only evidence.scope brain-seat)
D_OUT="$(node -e '
const k = require(process.argv[1]).seatKindOf;
const bad = [];
if (k({ evidence: { scope: { task_classes: ["brain-seat"] } } }) !== "brain") bad.push("scope-only");
if (k({ methodology_kind: "owner_brain_seat" }) !== "brain") bad.push("methodology");
if (k({ evidence: { scope: { task_classes: ["code"] } } }) !== "default" || k({}) !== "default" || k(null) !== "default") bad.push("default");
process.stdout.write(bad.length ? bad.join(",") : "ok");' "$SC" 2>&1)"
[ "$D_OUT" = ok ] && ok "D1 seatKindOf: scope-only brain row classified brain" || bad "D1 seatKindOf wrong: $D_OUT"

# E: invalidate-strike honours --seat-kind brain (BL-0178). Without it the invalidation hashes the
# DEFAULT seat, finds no target, and the brain strike can never be rescinded.
BR_BEFORE="$(status_of brain strikes_since_pass)"; DEF_BEFORE="$(status_of default strikes_since_pass)"
DEF_ROWS_BEFORE="$(rows_of default)"
PROOF="$(sha_of proof-e)"
if node "$CAP" invalidate-strike --engine dual --runner claude --role owner --seat-kind brain \
  --invalidates-event-id 1 --proof-artifact-sha256 "$PROOF" --proof-detector-id pdet --writer fuse \
  --dedup-key inv-e1 --detector-id det --detector-version 1 --artifact-sha256 "$(sha_of inv-e1)" \
  --receipt-ref r-inv-e1 --now "$NOW" >"$TESTDIR/inv.log" 2>&1; then ok "E1 brain invalidate-strike accepted"; else bad "E1 invalidate rejected: $(head -c 200 "$TESTDIR/inv.log")"; fi
[ "$(status_of brain strikes_since_pass)" = "$((BR_BEFORE-1))" ] && ok "E2 brain seat recovers one strike ($BR_BEFORE -> $((BR_BEFORE-1)))" || bad "E2 brain strikes=$(status_of brain strikes_since_pass) (was $BR_BEFORE)"
[ "$(status_of default strikes_since_pass)" = "$DEF_BEFORE" ] && [ "$(rows_of default)" = "$DEF_ROWS_BEFORE" ] && ok "E3 foreman seat untouched by brain invalidation" || bad "E3 foreman changed"
# the same invalidation aimed at the default seat must NOT find the brain strike (event 2)
if node "$CAP" invalidate-strike --engine dual --runner claude --role owner \
  --invalidates-event-id 2 --proof-artifact-sha256 "$PROOF" --proof-detector-id pdet --writer fuse \
  --dedup-key inv-e2 --detector-id det --detector-version 1 --artifact-sha256 "$(sha_of inv-e2)" \
  --receipt-ref r-inv-e2 --now "$NOW" >/dev/null 2>&1; then bad "E4 default-seat invalidation hit a brain strike"; else ok "E4 default-seat invalidation cannot reach a brain strike"; fi

# F: an unknown --seat-kind is an error on every seat-kind command, never a silent default.
for cmd in seat-hash strike-seat invalidate-strike; do
  for v in foo Brain ""; do
    node "$CAP" "$cmd" --engine dual --runner claude --role owner --seat-kind "$v" >"$TESTDIR/f.out" 2>&1; rc=$?
    if [ "$rc" -ne 0 ] && grep -q "seat-kind" "$TESTDIR/f.out" 2>/dev/null; then ok "F $cmd --seat-kind '$v' rejected (rc=$rc)"; else bad "F $cmd --seat-kind '$v' rc=$rc"; fi
  done
done

# G: --help advertises --seat-kind on the strike commands
HELP="$(node "$CAP" --help 2>&1)"
for cmd in strike-seat invalidate-strike; do
  printf '%s\n' "$HELP" | grep -E "capability-state.js $cmd " | grep -q -- '--seat-kind' && ok "G $cmd usage line lists --seat-kind" || bad "G $cmd usage line omits --seat-kind"
done
printf '%s\n' "$HELP" | grep -E '^\s+--seat-kind ' >/dev/null && ok "G3 options section documents --seat-kind" || bad "G3 options section omits --seat-kind"

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
