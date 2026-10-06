#!/usr/bin/env bash
# Mods P1W W1b — the `autopilot status task` input bundle has a producer.
#
# Before: nothing in the repo wrote ${AUTOPILOT_TASK_STATUS_DIR:-$TMPDIR/autopilot-task-status}/<root>.json,
# so `status task --root-run-id` always failed TASK_STATUS_INPUT_UNAVAILABLE and finish-flow's merge row /
# `session-mode.js clear` had no receipt to consume.
#
# RED (base 39cc491c with producer + engine hook removed, first full run of 37 assertions):
# 8 passed, 29 failed. The 8 passes are the INPUT_UNAVAILABLE step and guard exits that also hold
# without a producer; every producer / GREEN / engine assertion failed. Assertions added later
# (R8 forgery 7b, same-contract-two-routes 7c, race 9b) are validated by their own mutations
# instead: forgery -> reader refusal, dedupe removed -> 3 red, lock removed -> red.
# The fixture is a campaign that really reached TERMINAL_READY through the shipped writers
# (hooks/tests/lib/task-status-input-fixture.js) plus a COMPLETE Mission bound to its contract.
# Every test points AUTOPILOT_TASK_STATUS_DIR at a temp dir; the real /tmp/autopilot-task-status is never touched.
. "$(dirname "$0")/lib.sh"
trap cleanup_test_tmp EXIT

OUT="$TEST_TMP/out"
export AUTOPILOT_TASK_STATUS_DIR="$OUT"
export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 700 "$AUTOPILOT_LIVE_DIR"
ROOT_RUN_ID="tsi-root-1"
PRODUCER="$REPO_ROOT/scripts/write-task-status-input.js"
CLI="$REPO_ROOT/bin/autopilot.js"

FX="$TEST_TMP/fx.json"
node - "$REPO_ROOT" "$TEST_TMP/fx" "$ROOT_RUN_ID" "$FX" <<'NODE' || fail "fixture build failed"
'use strict';
const fs = require('fs');
const path = require('path');
const [root, scratch, rootRunId, out] = process.argv.slice(2);
fs.mkdirSync(scratch, { recursive: true });
const { buildFixture } = require(path.join(root, 'hooks/tests/lib/task-status-input-fixture'));
const f = buildFixture({ root, scratch, rootRunId });
const terminalFile = path.join(scratch, 'terminal-receipt.json');
fs.writeFileSync(terminalFile, JSON.stringify(f.terminal));
// One byte of body changed, digest untouched: the ledger-pinned digest no longer binds it.
// Self-consistent but NOT the one the ledger pins: re-digested, so only the pin check can refuse it.
const { canonicalDigest } = require(path.join(root, 'src/engine/implementation-campaign'));
const { receipt_digest: ignored, ...body } = f.terminal;
const forgedBody = { ...body, repair_generations: body.repair_generations + 1 };
const tampered = { ...forgedBody, receipt_digest: canonicalDigest(forgedBody) };
const tamperedFile = path.join(scratch, 'terminal-receipt-tampered.json');
fs.writeFileSync(tamperedFile, JSON.stringify(tampered));
fs.writeFileSync(out, JSON.stringify({
  repo: f.repo, campaignId: f.campaignId, terminalFile, tamperedFile,
  terminalDigest: f.terminal.receipt_digest, candidate: f.candidate,
}));
NODE
fx() { node -e 'const f=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(f[process.argv[2]]))' "$FX" "$1"; }
REPO="$(fx repo)"
TERMINAL_FILE="$(fx terminalFile)"
TAMPERED_FILE="$(fx tamperedFile)"
TERMINAL_DIGEST="$(fx terminalDigest)"
CANDIDATE="$(fx candidate)"

status_task() { # <root> -> sets __OUT __ERR __RC ; runs inside the fixture repo like a real caller
  __OUT="$(cd "$REPO" && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$CLI" status task --root-run-id "$1" --json 2>"$TEST_TMP/err")"
  __RC=$?
  __ERR="$(cat "$TEST_TMP/err")"
}
field() { # <json> <js expr over r>
  printf '%s' "$1" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));const v=('"$2"');process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v))'
}

# 1. before any producer: today's failure mode
status_task "$ROOT_RUN_ID"
assert_eq "1" "$__RC" "no bundle: status task fails"
assert_contains "$__ERR" "TASK_STATUS_INPUT_UNAVAILABLE" "no bundle: the documented error"

# 2. producer writes the bundle from real state
P_OUT="$(env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$PRODUCER" --repo "$REPO" --root-run-id "$ROOT_RUN_ID" --terminal-receipt "$TERMINAL_FILE" 2>"$TEST_TMP/perr")"
assert_eq "0" "$?" "producer exits 0"
assert_eq "$OUT/$ROOT_RUN_ID.json" "$P_OUT" "producer prints the canonical path the reader uses"
assert_file_exists "$OUT/$ROOT_RUN_ID.json" "bundle written"
assert_eq "600" "$(stat -c %a "$OUT/$ROOT_RUN_ID.json")" "bundle is private (0600)"
assert_eq "0" "$(find "$OUT" -name '*.tmp' | wc -l | tr -d ' ')" "atomic write leaves no tmp file"
KEYS="$(node -e 'process.stdout.write(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))).join(","))' "$OUT/$ROOT_RUN_ID.json")"
assert_eq "repo,root_run_id,observed_at,goal,phase,mission,campaigns,lifecycle_receipt_path,integration,merge_preflight,merge_execution,merge_provenance" "$KEYS" "bundle carries exactly the reader's 12 input keys (no verdict fields)"

# 3. GREEN end to end
status_task "$ROOT_RUN_ID"
assert_eq "0" "$__RC" "status task now returns a receipt ($__ERR)"
assert_eq "task_status_receipt" "$(field "$__OUT" 'r.artifact_type')" "receipt artifact type"
assert_eq "accepted" "$(field "$__OUT" 'r.acceptance_verdict')" "acceptance verdict is derived: accepted"
assert_eq "true" "$(field "$__OUT" 'r.mission_terminal')" "mission terminal derived"
assert_eq "true" "$(field "$__OUT" 'r.campaigns_terminal')" "campaigns terminal derived"
assert_eq "valid" "$(field "$__OUT" 'r.evidence.campaigns.status')" "campaign evidence valid"
assert_eq "$TERMINAL_DIGEST" "$(field "$__OUT" 'r.evidence.campaigns.campaigns[0].terminal_receipt_digest')" "the receipt the ledger pins is the one replayed"
assert_eq "true" "$(field "$__OUT" 'r.zero_residue')" "zero residue re-derived from the repo"
assert_eq "false" "$(field "$__OUT" 'r.product_merged')" "candidate is not on main yet: product_merged re-derived false"
assert_eq "false" "$(field "$__OUT" 'r.can_close')" "not closable before merge (out of W1b scope to fake it)"
assert_eq "$CANDIDATE" "$(field "$__OUT" 'r.candidate_commit')" "candidate commit comes from the ledger"

# 4. refresh without the in-memory receipt: the prior bundle supplies it, the ledger still vouches for it
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$PRODUCER" --repo "$REPO" --root-run-id "$ROOT_RUN_ID" >/dev/null 2>&1
assert_eq "0" "$?" "refresh exits 0"
status_task "$ROOT_RUN_ID"
assert_eq "valid" "$(field "$__OUT" 'r.evidence.campaigns.status')" "refresh keeps the ledger-bound receipt"

# 5. after the merge, a refresh re-derives product_merged from git (nothing is asserted by the caller)
git -C "$REPO" merge -q --ff-only feat/tsi || fail "fixture merge"
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$PRODUCER" --repo "$REPO" --root-run-id "$ROOT_RUN_ID" >/dev/null 2>&1
status_task "$ROOT_RUN_ID"
assert_eq "true" "$(field "$__OUT" 'r.product_merged')" "post-merge refresh: product_merged true from git"
git -C "$REPO" reset -q --hard "$(git -C "$REPO" rev-parse HEAD~1)" || fail "fixture reset"

# 6. a receipt the ledger does not pin never binds (tampered body, intact digest)
BAD="$TEST_TMP/bad"; mkdir -p "$BAD"
(
  export AUTOPILOT_TASK_STATUS_DIR="$BAD"
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$PRODUCER" --repo "$REPO" --root-run-id "$ROOT_RUN_ID" --terminal-receipt "$TAMPERED_FILE" >/dev/null 2>&1
  echo "producer_rc=$?" > "$TEST_TMP/bad.rc"
  cd "$REPO" && env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$CLI" status task --root-run-id "$ROOT_RUN_ID" --json > "$TEST_TMP/bad.json" 2>/dev/null
)
BADJ="$(cat "$TEST_TMP/bad.json")"
assert_eq "0" "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).campaigns.length))' "$BAD/$ROOT_RUN_ID.json")" "tampered receipt: no campaign entry is produced"
assert_neq "accepted" "$(field "$BADJ" 'r.acceptance_verdict')" "tampered receipt: never accepted"
assert_neq "true" "$(field "$BADJ" 'r.campaigns_terminal')" "tampered receipt: campaigns not terminal"

# 7. reader-side guards still hold on producer output
EDIT="$TEST_TMP/edit"; mkdir -p "$EDIT"
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));b.root_run_id="another-root";fs.writeFileSync(process.argv[2],JSON.stringify(b))' "$OUT/$ROOT_RUN_ID.json" "$EDIT/$ROOT_RUN_ID.json"
( export AUTOPILOT_TASK_STATUS_DIR="$EDIT"; status_task "$ROOT_RUN_ID"; echo "$__RC|$__ERR" > "$TEST_TMP/mismatch.out" )
assert_contains "$(cat "$TEST_TMP/mismatch.out")" "TASK_STATUS_ROOT_RUN_ID_MISMATCH" "edited root_run_id is rejected by the reader"

# 7b. R8 negative control: the bundle is evidence, never a second verdict source. A forged
#     verdict-like field (top level or smuggled into the Mission receipt) must not change the verdict.
FORGE="$TEST_TMP/forge"; mkdir -p "$FORGE"
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));b.can_close=true;b.acceptance_verdict="accepted";fs.writeFileSync(process.argv[2],JSON.stringify(b))' "$OUT/$ROOT_RUN_ID.json" "$FORGE/$ROOT_RUN_ID.json"
( export AUTOPILOT_TASK_STATUS_DIR="$FORGE"; status_task "$ROOT_RUN_ID"; echo "$__RC|$__ERR" > "$TEST_TMP/forge1.out"; printf '%s' "$__OUT" > "$TEST_TMP/forge1.json" )
assert_contains "$(cat "$TEST_TMP/forge1.out")" "TASK_STATUS_UNKNOWN_FIELD" "forged top-level can_close/acceptance_verdict: reader refuses, no verdict issued"
assert_eq "" "$(cat "$TEST_TMP/forge1.json")" "forged top-level: no receipt emitted"
FORGE2="$TEST_TMP/forge2"; mkdir -p "$FORGE2"
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));b.mission.terminal_receipt.can_close=true;fs.writeFileSync(process.argv[2],JSON.stringify(b))' "$OUT/$ROOT_RUN_ID.json" "$FORGE2/$ROOT_RUN_ID.json"
( export AUTOPILOT_TASK_STATUS_DIR="$FORGE2"; status_task "$ROOT_RUN_ID"; printf '%s' "$__OUT" > "$TEST_TMP/forge2.json" )
assert_neq "accepted" "$(field "$(cat "$TEST_TMP/forge2.json")" 'r.acceptance_verdict')" "forged can_close inside the Mission receipt: verdict not accepted"
assert_eq "false" "$(field "$(cat "$TEST_TMP/forge2.json")" 'r.can_close')" "forged can_close inside the Mission receipt: can_close stays false"

# 7c. the same contract reached by two routes (mission artifacts walk AND an explicit --contract
#     file, which is how the engine passes campaignControl.contract_path) yields ONE campaign entry;
#     the reader rejects duplicate campaign bindings.
DUP="$TEST_TMP/dup"; mkdir -p "$DUP"
CONTRACT_FILE="$(find "$REPO/.git/autopilot/mission/artifacts" -name campaign.json | head -1)"
( export AUTOPILOT_TASK_STATUS_DIR="$DUP"
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$PRODUCER" --repo "$REPO" --root-run-id "$ROOT_RUN_ID" --terminal-receipt "$TERMINAL_FILE" --contract "$CONTRACT_FILE" >/dev/null 2>&1
  status_task "$ROOT_RUN_ID"; printf '%s' "$__OUT" > "$TEST_TMP/dup.json" )
assert_eq "1" "$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).campaigns.length))' "$DUP/$ROOT_RUN_ID.json")" "same contract via two routes: one campaign entry"
assert_eq "valid" "$(field "$(cat "$TEST_TMP/dup.json")" 'r.evidence.campaigns.status')" "same contract via two routes: reader sees no duplicate binding"

# 8. unsafe / missing / non-repo inputs
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node "$PRODUCER" --repo "$REPO" --root-run-id '../evil' >/dev/null 2>"$TEST_TMP/e1"
assert_eq "2" "$?" "unsafe root id: producer exits 2"
assert_contains "$(cat "$TEST_TMP/e1")" "TASK_STATUS_ROOT_RUN_ID" "unsafe root id: reader's error code reused"
assert_file_absent "$TEST_TMP/evil.json" "unsafe root id: nothing written outside the status dir"
node "$PRODUCER" --repo "$REPO" >/dev/null 2>&1; assert_eq "2" "$?" "missing --root-run-id: exit 2"
mkdir -p "$TEST_TMP/not-a-repo"
node "$PRODUCER" --repo "$TEST_TMP/not-a-repo" --root-run-id "$ROOT_RUN_ID" >/dev/null 2>"$TEST_TMP/e2"; assert_eq "2" "$?" "non-repo: exit 2"

# 9. atomic write: a failing rename leaves neither a torn target nor a tmp file
ATOM="$TEST_TMP/atom"; mkdir -p "$ATOM/$ROOT_RUN_ID.json"
( export AUTOPILOT_TASK_STATUS_DIR="$ATOM"; node "$PRODUCER" --repo "$REPO" --root-run-id "$ROOT_RUN_ID" >/dev/null 2>&1; echo $? > "$TEST_TMP/atom.rc" )
assert_eq "2" "$(cat "$TEST_TMP/atom.rc")" "unwritable target: exit 2"
assert_eq "0" "$(find "$ATOM" -name '*.tmp' | wc -l | tr -d ' ')" "failed write leaves no tmp file"

# 9b. concurrent producers: engine-terminal write (carries the terminal receipt) and CLI refresh
#     (relies on the prior bundle) race on one bundle. The receipt exists nowhere else, so it must
#     survive whichever side is slow. Barrier = a sleep right after read-previous.
cat > "$TEST_TMP/racer.js" <<'NODE'
const [root, repo, rootRunId, role, delay, terminalFile, campaignId] = process.argv.slice(2);
const { refreshTaskStatusInput } = require(root + '/src/status/task-status-input');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const opts = { repo, rootRunId, afterReadPrevious: () => sleep(Number(delay)) };
if (role === 'scanhold') {
  // in-flight lifecycle issuance: announce, then hold so the caller can look at the canonical names
  opts.afterScanWrite = () => { require('fs').writeFileSync(delay + '.held', 'x'); sleep(3000); };
  opts.afterReadPrevious = () => {};
}
if (role === 'engine') opts.terminalReceipts = { [campaignId]: JSON.parse(require('fs').readFileSync(terminalFile, 'utf8')) };
refreshTaskStatusInput(opts);
NODE
CAMPAIGN_ID="$(fx campaignId)"
for slow in engine cli; do
  RACE="$TEST_TMP/race-$slow"; rm -rf "$RACE"; mkdir -p "$RACE"
  ed=0; cd_=0; [ "$slow" = engine ] && ed=1500 || cd_=1500
  ( export AUTOPILOT_TASK_STATUS_DIR="$RACE"
    node "$TEST_TMP/racer.js" "$REPO_ROOT" "$REPO" "$ROOT_RUN_ID" engine $ed "$TERMINAL_FILE" "$CAMPAIGN_ID" & p1=$!
    sleep 0.4
    node "$TEST_TMP/racer.js" "$REPO_ROOT" "$REPO" "$ROOT_RUN_ID" cli $cd_ "" "" & p2=$!
    wait $p1; r1=$?; wait $p2; r2=$?; echo "$r1 $r2" > "$TEST_TMP/race-$slow.rc" )
  assert_eq "0 0" "$(cat "$TEST_TMP/race-$slow.rc")" "race ($slow slow): both producers succeed"
  assert_eq "1" "$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(b.campaigns.length))' "$RACE/$ROOT_RUN_ID.json")" "race ($slow slow): the terminal receipt survives in the final bundle"
  assert_eq "0" "$(find "$RACE" -name '*.lock*' | wc -l | tr -d ' ')" "race ($slow slow): lock released"
  assert_eq "COMPLETE true" "$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=b.mission.terminal_receipt;process.stdout.write(b.mission.state.state+" "+(!!r&&r.mission_terminal===true))' "$RACE/$ROOT_RUN_ID.json")" "race ($slow slow): Mission terminal receipt present"
  assert_eq "true" "$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const l=JSON.parse(fs.readFileSync(b.lifecycle_receipt_path,"utf8"));process.stdout.write(String(l.zero_residue===true&&l.root_run_id===b.root_run_id))' "$RACE/$ROOT_RUN_ID.json")" "race ($slow slow): lifecycle receipt complete and zero-residue derivable"
  assert_eq "0" "$(find "$REPO/.git/autopilot/task-status-lifecycle" -name '*.tmp' | wc -l | tr -d ' ')" "race ($slow slow): no lifecycle temp files left"
done

# 9c. in-flight lifecycle issuance never occupies the canonical names (readers see only complete files)
HOLD="$TEST_TMP/hold"; mkdir -p "$HOLD"; rm -rf "$REPO/.git/autopilot/task-status-lifecycle"
( export AUTOPILOT_TASK_STATUS_DIR="$HOLD"
  node "$TEST_TMP/racer.js" "$REPO_ROOT" "$REPO" "$ROOT_RUN_ID" scanhold "$TEST_TMP/hold" "" "" & hp=$!
  for _ in $(seq 1 100); do [ -e "$TEST_TMP/hold.held" ] && break; sleep 0.1; done
  LD="$REPO/.git/autopilot/task-status-lifecycle"
  echo "$([ -e "$TEST_TMP/hold.held" ] && echo held) $([ -e "$LD/$ROOT_RUN_ID.scan.json" ] && echo scan-visible || echo scan-absent) $([ -e "$LD/$ROOT_RUN_ID.json" ] && echo out-visible || echo out-absent)" > "$TEST_TMP/hold.state"
  wait $hp )
assert_eq "held scan-absent out-absent" "$(cat "$TEST_TMP/hold.state")" "in-flight issuance is invisible at the canonical lifecycle paths"
assert_file_exists "$REPO/.git/autopilot/task-status-lifecycle/$ROOT_RUN_ID.json" "issuance completes into the canonical path"

# 10. the ENGINE writes it with no skill step: a mission-backed managed campaign that reaches
#     terminal (the mission-runtime-v2 harness, real engine) produces the bundle; the knob turns it off.
ENG_ON="$TEST_TMP/eng-on"; ENG_OFF="$TEST_TMP/eng-off"; mkdir -p "$ENG_ON" "$ENG_OFF"
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID AUTOPILOT_TASK_STATUS_DIR="$ENG_ON" \
  bash "$REPO_ROOT/hooks/tests/mission-runtime-v2.test.sh" < /dev/null > "$TEST_TMP/eng-on.log" 2>&1
assert_eq "1" "$(find "$ENG_ON" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')" "engine terminal wrote one bundle"
ENG_JSON="$(find "$ENG_ON" -maxdepth 1 -name '*.json' | head -1)"
assert_eq "COMPLETE" "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).mission.state.state)' "$ENG_JSON")" "engine bundle carries the terminal Mission state"
assert_eq "TERMINAL_READY" "$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(b.campaigns.length?b.phase:"none")' "$ENG_JSON")" "engine bundle carries a ledger-bound terminal campaign"
assert_eq "0" "$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const ids=b.campaigns.map(c=>c.state.campaign_id);process.stdout.write(String(ids.length-new Set(ids).size))' "$ENG_JSON")" "engine bundle has no duplicate campaign ids"
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID AUTOPILOT_TASK_STATUS_DIR="$ENG_OFF" AUTOPILOT_TASK_STATUS_INPUT=0 \
  bash "$REPO_ROOT/hooks/tests/mission-runtime-v2.test.sh" < /dev/null > "$TEST_TMP/eng-off.log" 2>&1
assert_eq "0" "$(find "$ENG_OFF" -maxdepth 1 -name '*.json' | wc -l | tr -d ' ')" "AUTOPILOT_TASK_STATUS_INPUT=0 opts out"

finalize_test
