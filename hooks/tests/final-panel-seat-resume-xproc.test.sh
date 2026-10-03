#!/usr/bin/env bash
# Final-panel per-seat reuse is proven ACROSS PROCESSES. Run 1 and the real `--resume` run 2 are
# separate OS processes over a real ledger / real intake; the review batch dispatcher is the real
# one (real packet build + fanout, so the live packet hash and the stored one are production
# values) with dispatch-review.sh pointed at a stub. Run 1: seats 1 and 3 return valid verdicts,
# seat 2 fails its transport, the campaign parks (durable_wait). Run 2 must dispatch ONLY seat 2.
#
# Evidence note: at dffca782 this behaviour was already correct. The live packet hash IS stable
# between two separate processes (stored packet_hash == live packet_hash, so reuse fires), so no
# binding change was needed; case B (a tampered stored packet_hash is never reused) proves the
# stored-vs-live comparison is exercised rather than skipped, and case C is the changed-input control.
. "$(dirname "$0")/lib.sh"
TEST_NAME="final-panel-seat-resume-xproc"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID 2>/dev/null || true
DRIVER="$REPO_ROOT/hooks/tests/lib/final-panel-seat-xproc-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/final-panel-seat-xproc-stub-review.sh"
M1=claude-opus-4-6; M2=gpt-5.4; M3=glm-4.7

mk_ctx() { # $1 name, $2 failModel
  local d="$TEST_TMP/$1"; mkdir -p "$d/repo"
  cat > "$d/ctx.json" <<J
{"root":"$REPO_ROOT","tmp":"$d","sbx":"$d/repo","tag":"xp-$1","stub":"$STUB","log":"$d/log","failModel":"$2",
"seats":[{"role":"qc","runner":"cc-shim","model":"$M1","effort":"high","endpoint":null,"family":"anthropic"},
{"role":"qc","runner":"cc-shim","model":"$M2","effort":"high","endpoint":null,"family":"openai"},
{"role":"qc","runner":"cc-shim","model":"$M3","effort":"high","endpoint":null,"family":"zai"}]}
J
  echo "$d"
}
# node's own exit code (not tail's): run to a file first, then take the last line.
drive() {
  node "$DRIVER" "$1" "$2/ctx.json" < /dev/null >"$2/$1.out" 2>"$2/$1.err"
  local rc=$?
  tail -1 "$2/$1.out" > "$2/$1.json"
  echo "$rc"
}
field() { node -e "const j=JSON.parse(require('fs').readFileSync('$1','utf8'));process.stdout.write(String(j['$2']))"; }
setfield() { node -e "const f='$1/ctx.json';const j=JSON.parse(require('fs').readFileSync(f,'utf8'));j['$2']=$3;require('fs').writeFileSync(f,JSON.stringify(j))"; }
models() { sort "$1/log" | tr '\n' ','; }  # sorted: the fanout dispatches seats concurrently
seat1() { find "$1/repo/.git/autopilot/final-panel-seats" -name seat-1.json | head -1; }

# --- A. reuse fires across a real --resume --------------------------------------------------
A=$(mk_ctx a "$M2")
assert_eq "0" "$(drive run1 "$A")" "A run1 process exits 0"
assert_eq "blocked" "$(field "$A/run1.json" status)" "A run1 ends blocked"
assert_eq "final_panel_seat_transport_failed" "$(field "$A/run1.json" reason)" "A run1 reason is the seat transport failure"
assert_eq "true" "$(field "$A/run1.json" durable_wait)" "A run1 parks (durable wait) for a resume"
assert_eq "$M1,$M3,$M2," "$(models "$A")" "A run1 dispatched all three seats"
S1="$(seat1 "$A")"
assert_contains "$(cat "$S1")" '"packet_hash":"' "A run1 stored the live packet hash with the seat verdict"
: > "$A/log"; setfield "$A" failModel '""'
assert_eq "0" "$(drive run2 "$A")" "A run2 (--resume) process exits 0"
assert_eq "$M2," "$(models "$A")" "A run2 dispatches ONLY the failed seat"
assert_eq "0" "$(field "$A/run2.json" impl)" "A run2 never re-dispatches the implementer"
assert_eq "converged" "$(field "$A/run2.json" status)" "A run2 final resumed status is converged (no post-review block)"
assert_eq "null" "$(field "$A/run2.json" reason)" "A run2 has no block reason"

# --- B. packet-hash binding is exercised: a tampered stored packet_hash is never reused ---------
B=$(mk_ctx b "$M2")
drive run1 "$B" > /dev/null
S1="$(seat1 "$B")"
node -e "const f='$S1';const j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.result.packet_hash='f'.repeat(64);require('fs').writeFileSync(f,JSON.stringify(j))"
: > "$B/log"; setfield "$B" failModel '""'
drive run2 "$B" > /dev/null
assert_eq "$M1,$M2," "$(models "$B")" "B a seat whose stored packet_hash differs from the live one is re-dispatched (seat 3 still reused)"

# --- C. negative control: the spec changes between the runs -> every seat re-dispatches ---------
C=$(mk_ctx c "$M2")
drive run1 "$C" > /dev/null
: > "$C/log"; setfield "$C" failModel '""'; setfield "$C" promptSalt '"the spec changed between runs"'
drive run2 "$C" > /dev/null
assert_eq "$M1,$M3,$M2," "$(models "$C")" "C changed review input re-dispatches all seats"
finalize_test
