#!/usr/bin/env bash
# A managed campaign that passed through BOUNDARY_REJECTED reaches terminal success. Run 1 and the
# real `--resume` run 2 are separate OS processes over a real ledger / real intake / real
# terminalize + controller transcript audit (nothing is stubbed around them; the audit is only
# observed). Run 1: the implementer returns boundary_rejected with a candidate; the campaign parks.
# Run 2 (--resume) must end converged.
#
# Mechanism change: the audit's requirements are unchanged. The producer now (a) gives the boundary
# dispatch record a canonical result_receipt_digest (the digest of the dispatcher outcome the
# rejection derives from, == the boundary receipt's dispatch_result_digest) and (b) writes the
# controller tuple into the boundary receipt body (the persisted row stays re-derivable from itself).
#
# RED at 8a338ccb (unmodified base; 12 passed, 7 failed):
#   FAIL A run2 final status is converged (no transcript_incomplete block): expected 'converged', got 'blocked'
#   FAIL A run2 transcript audit reports no problems: ["audit_event <d> has foreign or missing controller tuple undefined/undefined","dispatch <d> lacks exact run/provider/resource/result-receipt identity"]
#   FAIL A every audit_events row carries the controller tuple: expected 'true', got 'false'
#   FAIL A every dispatch carries a canonical result_receipt_digest: expected '0', got '1'
#   FAIL B the boundary dispatch result_receipt_digest equals the stored boundary receipt dispatch_result_digest: expected 'true', got 'false'
#   not ok - A run2 final status is converged (no transcript_incomplete block): expected 'converged', got 'blocked'
#   not ok - A run2 audit does not block terminal: expected 'false', got 'true'
#   audit problem: audit_event <digest> has foreign or missing controller tuple undefined/undefined
#   audit problem: dispatch <digest> lacks exact run/provider/resource/result-receipt identity
. "$(dirname "$0")/lib.sh"
TEST_NAME="boundary-resume-terminal"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID 2>/dev/null || true
DRIVER="$REPO_ROOT/hooks/tests/lib/boundary-resume-terminal-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/final-panel-seat-xproc-stub-review.sh"

mk_ctx() { # $1 name, $2 boundaryPhase ("" = none), $3 tamper ("" = none)
  local d="$TEST_TMP/$1"; mkdir -p "$d/repo"
  cat > "$d/ctx.json" <<J
{"root":"$REPO_ROOT","tmp":"$d","sbx":"$d/repo","tag":"bt-$1","stub":"$STUB","log":"$d/log","failModel":"","boundaryPhase":"$2","tamper":"$3",
"seats":[{"role":"qc","runner":"cc-shim","model":"claude-opus-4-6","effort":"high","endpoint":null,"family":"anthropic"},
{"role":"qc","runner":"cc-shim","model":"gpt-5.4","effort":"high","endpoint":null,"family":"openai"},
{"role":"qc","runner":"cc-shim","model":"glm-4.7","effort":"high","endpoint":null,"family":"zai"}]}
J
  echo "$d"
}
drive() {
  node "$DRIVER" "$1" "$2/ctx.json" < /dev/null >"$2/$1.out" 2>"$2/$1.err"
  local rc=$?
  tail -1 "$2/$1.out" > "$2/$1.json"
  echo "$rc"
}
field() { node -e "const j=JSON.parse(require('fs').readFileSync('$1','utf8'));let v=j;for(const k of '$2'.split('.'))v=v==null?v:v[k];process.stdout.write(typeof v==='object'?JSON.stringify(v):String(v))"; }
problems() { field "$1/run2.json" audit.problems; }

# --- A. boundary -> resume -> converged through the real terminalize + audit --------------------
A=$(mk_ctx a run1 "")
assert_eq "$(drive run1 "$A")" "0" "A run1 process exits 0"
assert_eq "$(field "$A/run1.json" status)" "blocked" "A run1 parks (blocked)"
assert_eq "$(field "$A/run1.json" durable_wait)" "true" "A run1 is a durable wait (BOUNDARY_REJECTED)"
assert_eq "$(drive run2 "$A")" "0" "A run2 (--resume) process exits 0"
assert_eq "$(field "$A/run2.json" impl)" "0" "A run2 never re-dispatches the implementer"
assert_eq "$(field "$A/run2.json" status)" "converged" "A run2 final status is converged (no transcript_incomplete block)"
assert_eq "$(field "$A/run2.json" audit.blocks_terminal)" "false" "A run2 transcript audit does not block terminal"
assert_eq "$(problems "$A")" "[]" "A run2 transcript audit reports no problems"
assert_eq "$(field "$A/run2.json" audit.tuples_ok)" "true" "A every audit_events row carries the controller tuple"
BD="$(field "$A/run2.json" audit.boundary_dispatches)"
assert_contains "$BD" '"' "A the run has dispatch records"
assert_eq "$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.filter(x=>!/^[0-9a-f]{64}\$/.test(String(x))).length))" "$BD")" "0" "A every dispatch carries a canonical result_receipt_digest"

# --- B. the boundary dispatch digest is the boundary receipt's dispatch_result_digest -----------
CP="$(find "$A/repo/.git/autopilot/controller-authority" -name controller-checkpoint.json | sort | tr '\n' ':')"
assert_eq "$(node -e "
const fs=require('fs');let rec,disp=[];
for(const f of '$CP'.split(':').filter(Boolean)){const c=JSON.parse(fs.readFileSync(f,'utf8'));const ctl=c.controller||c;
const r=(ctl.audit_events||[]).find(e=>e.artifact_type==='campaign_boundary_receipt');
if(r){rec=r;disp=(ctl.dispatch_records||[]).filter(d=>d.dispatch_id&&d.result_receipt_digest===r.dispatch_result_digest);}}
process.stdout.write(String(Boolean(rec)&&disp.length>=1&&/^[0-9a-f]{64}\$/.test(rec.dispatch_result_digest)&&Boolean(rec.root_run_id)&&Boolean(rec.work_order_id)));
")" "true" "B the boundary dispatch result_receipt_digest equals the stored boundary receipt dispatch_result_digest"

# --- C. control: no boundary -> converged --------------------------------------------------------
C=$(mk_ctx c "" "")
drive run1 "$C" > /dev/null  # no boundary: run1 itself reaches terminal success
assert_eq "$(field "$C/run1.json" status)" "converged" "C control (no boundary) converges"
assert_eq "$(field "$C/run1.json" audit.blocks_terminal)" "false" "C control audit does not block terminal"

# --- D/E. negative controls: the audit is unchanged and still blocks a tampered row ---------------
D=$(mk_ctx d run1 tuple)
drive run1 "$D" > /dev/null; drive run2 "$D" > /dev/null
assert_eq "$(field "$D/run2.json" status)" "blocked" "D a tampered boundary audit-row tuple still blocks"
assert_contains "$(problems "$D")" "foreign or missing controller tuple" "D the block names the tuple problem"
E=$(mk_ctx e run1 nulldigest)
drive run1 "$E" > /dev/null; drive run2 "$E" > /dev/null
assert_eq "$(field "$E/run2.json" status)" "blocked" "E a null dispatch receipt digest still blocks"
assert_contains "$(problems "$E")" "lacks exact run/provider/resource/result-receipt identity" "E the block names the receipt problem"
F=$(mk_ctx f run1 digest)
drive run1 "$F" > /dev/null; drive run2 "$F" > /dev/null
assert_eq "$(field "$F/run2.json" status)" "blocked" "F a malformed dispatch receipt digest still blocks"
finalize_test
