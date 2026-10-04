#!/usr/bin/env bash
# Mods P1W W1h — decision ledger writer side (mechanism).
# Proves: (1) default ledger <git-common-dir>/autopilot/ledger/decisions.jsonl shared by every
# worktree; (2) append stamps repo_identity + root_run_id (null, never invented); (3) the engine's
# adjudicate path appends exactly one `decision` row per adjudicated finding (idempotent on replay);
# (4) explicit --ledger callers keep working and never touch the default location.
# RED (before implementation): 4 passed, 15 failed (run-w/w1h/red.txt) — missing default / stamping / recorder.
. "$(dirname "$0")/lib.sh"

LEDGER_SCRIPT="$REPO_ROOT/scripts/decision-ledger.js"
export AUTOPILOT_HOME="$TEST_TMP/home"; mkdir -p "$AUTOPILOT_HOME"
export AUTOPILOT_SESSION_ID="w1h-$$-$RANDOM"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_PROXY_DECISION_LEDGER

R="$TEST_TMP/repo"; git init -q "$R"; git -C "$R" config user.email t@t; git -C "$R" config user.name t
git -C "$R" commit -q --allow-empty -m base
git -C "$R" worktree add -q "$TEST_TMP/wt" -b side
COMMON="$(cd "$R/.git" && pwd -P)"
DEFAULT="$COMMON/autopilot/ledger/decisions.jsonl"
ROW='{"decision_id":"d-1","round":1,"class":"tactical","rationale":"picked zstd","reversibility":"two-way"}'

# ── (1) default location, shared across worktrees, nothing in the work tree ──
( cd "$R" && node "$LEDGER_SCRIPT" append --kind decision --json "$ROW" >/dev/null 2>&1 )
assert_file_exists "$DEFAULT" "append without --ledger writes <git-common-dir>/autopilot/ledger/decisions.jsonl"
( cd "$TEST_TMP/wt" && node "$LEDGER_SCRIPT" append --kind decision --json '{"decision_id":"d-2","round":1,"class":"tactical","rationale":"from worktree"}' >/dev/null 2>&1 )
assert_eq "$(wc -l < "$DEFAULT" | tr -d ' ')" "2" "linked worktree appends to the same ledger"
assert_eq "$(git -C "$R" status --porcelain | wc -l | tr -d ' ')" "0" "default ledger never pollutes the work tree"
OUT="$(cd "$TEST_TMP/wt" && node "$LEDGER_SCRIPT" query --kind decision --json)"
assert_contains "$OUT" '"d-1"' "query without --ledger reads the default ledger from another worktree"

# ── (2) stamping ──
FIRST="$(sed -n 1p "$DEFAULT")"
assert_contains "$FIRST" "\"repo_identity\":\"git-common-dir:$COMMON\"" "append stamps repo_identity"
assert_contains "$FIRST" '"root_run_id":null' "root_run_id is null when no root is known (never invented)"
( cd "$R" && AUTOPILOT_ROOT_RUN_ID=root-abc node "$LEDGER_SCRIPT" append --kind decision --json '{"decision_id":"d-3","round":1,"class":"tactical","rationale":"with root"}' >/dev/null 2>&1 )
assert_contains "$(sed -n 3p "$DEFAULT")" '"root_run_id":"root-abc"' "root_run_id stamped from AUTOPILOT_ROOT_RUN_ID"
( cd "$R" && AUTOPILOT_ROOT_RUN_ID=root-abc node "$LEDGER_SCRIPT" append --kind decision --json '{"decision_id":"d-4","round":1,"class":"t","rationale":"explicit","root_run_id":"caller-root"}' >/dev/null 2>&1 )
assert_contains "$(sed -n 4p "$DEFAULT")" '"root_run_id":"caller-root"' "a caller-supplied root_run_id is not overwritten"
( cd "$R" && node "$LEDGER_SCRIPT" veto --id d-1 --reason no >/dev/null 2>&1 )
assert_contains "$(sed -n 5p "$DEFAULT")" '"kind":"veto"' "veto without --ledger lands in the default ledger"

# ── (4) explicit --ledger unchanged ──
EX="$TEST_TMP/explicit.jsonl"
( cd "$R" && node "$LEDGER_SCRIPT" append --ledger "$EX" --kind decision --json "$ROW" >/dev/null 2>&1 )
assert_exit_code "$?" "0" "explicit --ledger append still works"
assert_eq "$(wc -l < "$DEFAULT" | tr -d ' ')" "5" "explicit --ledger does not touch the default ledger"
assert_contains "$(cat "$EX")" '"decision_id":"d-1"' "explicit ledger got the row"
# outside any git repo and no --ledger → refused, nothing created
NG="$TEST_TMP/nogit"; mkdir -p "$NG"
( cd "$NG" && node "$LEDGER_SCRIPT" append --kind decision --json "$ROW" >/dev/null 2>&1 )
assert_exit_code "$?" "2" "no --ledger and no git repo is a usage error"

# ── (3) engine adjudicate path: exactly one row per adjudicated finding ──
cat > "$TEST_TMP/driver.js" <<'NODE'
const path = require('path');
const eng = require(path.join(process.argv[2], 'src/engine/autopilot-engine.js'));
const repo = process.argv[3];
const rec = eng.recordAdjudicationProxyDecisions;
if (typeof rec !== 'function') { console.log('recorder_missing'); process.exit(0); }
const mk = (id, disp) => ({
  id, claim: `claim ${id}`, severity: '🟠', source: 'reviewer',
  evidence: { classification: 'actionable', digest: 'e'.repeat(64) },
  adjudication_authority: { authority: 'depth-0', actor_id: 'brain', review_digest: 'a'.repeat(64) },
  ...(disp ? { disposition: disp } : {}),
});
const adjudication = {
  registry_complete: true, repair_gate_passed: true, registry_digest: 'b'.repeat(64),
  must_fix_now: [mk('F1', { disposition: 'must-fix-now', rubric_id: 'R1', deferral_harm: 'ships a bug' })],
  follow_up: [mk('F2', { disposition: 'follow-up', context: 'later', trigger: 'next', proposed_backlog_title: 't' })],
  rejected: [mk('F3', { disposition: 'reject-out-of-scope', rationale: 'not in scope' })],
};
const n1 = rec({ adjudication, repairGeneration: 1, cwd: repo, env: { ...process.env, AUTOPILOT_ROOT_RUN_ID: 'root-eng' } });
const n2 = rec({ adjudication, repairGeneration: 1, cwd: repo, env: { ...process.env, AUTOPILOT_ROOT_RUN_ID: 'root-eng' } });
const bad = rec({ adjudication: { registry_complete: false, must_fix_now: [], follow_up: [], rejected: [] }, repairGeneration: 1, cwd: repo, env: process.env });
const off = rec({ adjudication: { ...adjudication, registry_digest: 'c'.repeat(64) }, repairGeneration: 2, cwd: repo, env: { ...process.env, AUTOPILOT_PROXY_DECISION_LEDGER: '0' } });
console.log(`first=${n1} replay=${n2} incomplete=${bad} optout=${off}`);
NODE
E_LEDGER="$TEST_TMP/eng-repo"; git init -q "$E_LEDGER"; git -C "$E_LEDGER" config user.email t@t; git -C "$E_LEDGER" config user.name t
OUT="$(node "$TEST_TMP/driver.js" "$REPO_ROOT" "$E_LEDGER" 2>&1 < /dev/null)"
assert_contains "$OUT" "first=3 replay=0 incomplete=0 optout=0" "recorder: 3 findings -> 3 rows, replay adds none, incomplete/opt-out add none"
EL="$E_LEDGER/.git/autopilot/ledger/decisions.jsonl"
assert_eq "$(wc -l < "$EL" 2>/dev/null | tr -d ' ')" "3" "engine ledger holds exactly one row per decision"
assert_contains "$(cat "$EL" 2>/dev/null)" '"root_run_id":"root-eng"' "engine rows carry the root run"
assert_contains "$(cat "$EL" 2>/dev/null)" '"class":"adjudication"' "engine rows are class adjudication"
assert_contains "$(cat "$EL" 2>/dev/null)" '"reversibility":"two-way"' "engine rows state reversibility"
# (5) --dedupe is atomic: 12 concurrent appends of one decision_id leave exactly one row
CC="$TEST_TMP/concurrent.jsonl"
for i in $(seq 1 12); do
  node "$LEDGER_SCRIPT" append --dedupe --ledger "$CC" --kind decision --json '{"decision_id":"same","round":1,"class":"t","rationale":"race"}' >/dev/null 2>&1 &
done
wait
assert_eq "$(wc -l < "$CC" | tr -d ' ')" "1" "concurrent --dedupe appends of one decision_id leave exactly one row"
# the real engine adjudicate closure is driven in decision-ledger-engine-adjudicate.test.sh

finalize_test
