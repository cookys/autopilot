. "$(dirname "$0")/lib.sh"
# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
RH="$REPO_ROOT/scripts/compaction-rehydrate.js"
DH="$REPO_ROOT/scripts/dispatch-hetero.sh"
assert_file_exists "$RH" "compaction-rehydrate production CLI exists"
assert_file_exists "$REPO_ROOT/src/engine/continuation-admission.js" "continuation-admission exists"
assert_file_exists "$REPO_ROOT/src/engine/work-order.js" "work-order v2 exists"
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t
echo baseline > "$SBX/README.md"
git -C "$SBX" add README.md && git -C "$SBX" commit -q -m baseline
BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"
echo 'phase-16 work' > "$SBX/lsm-p1.txt"
git -C "$SBX" add lsm-p1.txt && git -C "$SBX" commit -q -m 'accept: portfolio phase 16 of 34'
ACCEPTED="$(git -C "$SBX" rev-parse HEAD)"
git -C "$SBX" branch -M develop
git -C "$SBX" branch feat/runtime-convergence "$ACCEPTED"
COMMON="$(git -C "$SBX" rev-parse --path-format=absolute --git-common-dir)"
DURABLE="$TEST_TMP/durable-16-34.json"
CK="$TEST_TMP/continuation-16-34.json"
MANIFEST_DIR="$TEST_TMP/dispatch-runs"
mkdir -p "$MANIFEST_DIR"
LEDGER="$TEST_TMP/ledger.jsonl"
printf '%s\n' '{"event":"heartbeat","root_run_id":"root-mission-16-34","ts":"2026-07-29T00:00:00Z"}' > "$LEDGER"
OWNER_PID="$$"
OWNER_JSON="$(node -e '
const wo=require(process.argv[1]);
process.stdout.write(JSON.stringify(wo.captureProcessIdentity(Number(process.argv[2]))));
' "$REPO_ROOT/src/engine/work-order.js" "$OWNER_PID")"
OWNER_START="$(jq -r .process_start_time <<<"$OWNER_JSON")"
OWNER_PGID="$(jq -r .pgid <<<"$OWNER_JSON")"
OWNER_SID="$(jq -r .sid <<<"$OWNER_JSON")"
LIVE_ID_PROOF="$(node -e '
const fs=require("fs"),{spawn,spawnSync}=require("child_process"),wo=require(process.argv[1]);
const child=spawn("sleep",["30"],{detached:true,stdio:"ignore"}),pid=child.pid;
const deadline=Date.now()+2000; while(Date.now()<deadline){try{fs.accessSync("/proc/"+pid+"/stat");break;}catch(_e){}}
try{
  const parsed=wo.readPgidSid(pid),cap=wo.captureProcessIdentity(pid);
  const ps=String(spawnSync("ps",["-o","pgid=,sid=","-p",String(pid)],{encoding:"utf8"}).stdout||"").trim().split(/\s+/).filter(Boolean);
  const fields=fs.readFileSync("/proc/"+pid+"/stat","utf8").slice(fs.readFileSync("/proc/"+pid+"/stat","utf8").lastIndexOf(")")+2).trim().split(/\s+/);
  const psPgid=Number(ps[0]),psSid=Number(ps[1]),buggy=Number(fields[1])!==psPgid||Number(fields[2])!==psSid;
  process.stdout.write(JSON.stringify({ok:parsed.pgid===psPgid&&parsed.sid===psSid&&cap.pgid===psPgid&&cap.sid===psSid
    &&Number(fields[1])!==Number(fields[2])&&buggy&&wo.isProcessLive({pid,process_start_time:cap.process_start_time,pgid:cap.pgid,sid:cap.sid})
    &&parsed.pgid===Number(fields[2])&&parsed.sid===Number(fields[3])}));
} finally { try{process.kill(-pid,"SIGKILL");}catch(_e){try{process.kill(pid,"SIGKILL");}catch(_e2){}} try{child.unref();}catch(_e){} }
' "$REPO_ROOT/src/engine/work-order.js")"
assert_eq "$(jq -r .ok <<<"$LIVE_ID_PROOF")" "true" "readPgidSid/pgid/sid fields[2]/[3] + live identity"
write_id() {
  local out="$1" as_dur="${2:-0}" root="$3" phase="$4" next="$5"
  shift 5 || true
  local durable_flag=()
  [ "$as_dur" = "1" ] && durable_flag=(--as-durable)
  node "$RH" write --out "$out" "${durable_flag[@]}" \
    --root-run-id "$root" --phase-cursor "$phase" --accepted-commit "$ACCEPTED" \
    --next-action "$next" --branch feat/runtime-convergence --stage implement \
    --base-sha "$BASE_SHA" --project mission-convergence-portfolio \
    --idempotency-key compact-16-34 "$@"
}
admit_root() {
  node "$RH" admit --durable "$DURABLE" --checkpoint "$CK" \
    --root-run-id "$1" --branch feat/runtime-convergence --stage implement \
    --base-sha "$BASE_SHA" --manifest-dir "$MANIFEST_DIR" --git-cwd "$SBX" "${@:2}"
}
wo_write() {
  local root="$1" next="$2"; shift 2
  node "$RH" work-order --git-cwd "$SBX" --root-run-id "$root" --graph-node implement \
    --attempt 1 --role implementer --branch feat/runtime-convergence --base-sha "$BASE_SHA" \
    --phase-cursor "16/34" --accepted-commit "$ACCEPTED" --next-action "$next" \
    --durable "$DURABLE" --bind-artifacts "$@"
}
WRITE_D="$(write_id "$DURABLE" 1 root-mission-16-34 16/34 \
  'continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)')"
assert_eq "$(jq -r .status <<<"$WRITE_D")" "written" "durable tracker write ok"
assert_eq "$(jq -r .phase_cursor "$DURABLE")" "16/34" "durable phase 16/34"
WRITE_C="$(write_id "$CK" 0 root-mission-16-34 16/34 \
  'continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)')"
assert_eq "$(jq -r .status <<<"$WRITE_C")" "written" "checkpoint write ok"
MISLEADING_NARRATIVE="$(jq -nc --arg r root-mission-16-34 \
  '{root_run_id:$r,phase_cursor:"8/34",next_action:"start WLB P0 RED lifecycle oracle",accepted_commit:"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}')"
REHYDRATE="$(node "$RH" rehydrate --durable "$DURABLE" --checkpoint "$CK" --narrative "$MISLEADING_NARRATIVE")"
assert_eq "$(jq -r .status <<<"$REHYDRATE")" "rehydrated" "rehydrate status"
assert_eq "$(jq -r .root_run_id <<<"$REHYDRATE")" "root-mission-16-34" "root run rehydrated"
assert_eq "$(jq -r .phase_cursor <<<"$REHYDRATE")" "16/34" "phase cursor stays 16/34 (not WLB P0 8/34)"
assert_eq "$(jq -r .accepted_commit <<<"$REHYDRATE")" "$ACCEPTED" "accepted commit from durable/git"
assert_eq "$(jq -r .next_action <<<"$REHYDRATE")" \
  "continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)" "next action from durable"
assert_eq "$(jq -r .narrative_ignored <<<"$REHYDRATE")" "true" "misleading narrative ignored"
assert_eq "$(jq -r .duplicate_dispatch <<<"$REHYDRATE")" "0" "rehydrate zero duplicate"
WO_WRITE="$(wo_write root-mission-16-34 \
  'continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)' \
  --ledger "$LEDGER" --manifest "$MANIFEST_DIR/run-16-34.manifest.json" --owner-pid "$OWNER_PID")"
assert_eq "$(jq -r .status <<<"$WO_WRITE")" "written" "work order v2 written"
WO_PATH="$(jq -r .path <<<"$WO_WRITE")"
assert_file_exists "$WO_PATH" "work order lives under git-common-dir"
assert_contains "$WO_PATH" "$COMMON" "work order path is git-common-dir durable"
assert_eq "$(jq -r .schema_version "$WO_PATH")" "2" "work order schema v2"
assert_eq "$(jq -r .owner.pid "$WO_PATH")" "$OWNER_PID" "owner pid bound to controller shell"
assert_eq "$(jq -r .phase_cursor "$WO_PATH")" "16/34" "WO phase 16/34"
cat > "$MANIFEST_DIR/run-16-34.manifest.json" <<EOF
{"schema":1,"run_id":"run-16-34-active","root_run_id":"root-mission-16-34","role":"implementer",
"branch":"feat/runtime-convergence","base":"$BASE_SHA","base_sha":"$BASE_SHA","stage":"implement",
"final_status":null,"ended_at":null,"pid":$OWNER_PID,"process_start_time":$OWNER_START,
"pgid":$OWNER_PGID,"sid":$OWNER_SID,"authority":"schema1_manifest"}
EOF
RECONCILE="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-mission-16-34 \
  --durable "$DURABLE" --ttl-ms 600000)"
assert_eq "$(jq -r .status <<<"$RECONCILE")" "reconciled" "postcompact reconcile ok"
assert_eq "$(jq -r .classifications[0].classification <<<"$RECONCILE")" "attach_active" "classify attach_active"
assert_eq "$(jq -r .identity.phase_cursor <<<"$RECONCILE")" "16/34" "reconcile identity 16/34"
RECEIPT_PATH="$(jq -r .receipt_path <<<"$RECONCILE")"
assert_file_exists "$RECEIPT_PATH" "reconcile receipt persisted"
assert_eq "$(jq -r .artifact_type "$RECEIPT_PATH")" "postcompact_reconcile_receipt" "receipt artifact type"
ADMIT1="$(admit_root root-mission-16-34 --reconcile-receipt "$RECEIPT_PATH" --narrative "$MISLEADING_NARRATIVE")"
assert_eq "$(jq -r .status <<<"$ADMIT1")" "attach" "first admit attaches existing attempt"
assert_eq "$(jq -r .action <<<"$ADMIT1")" "attach_active" "action is attach_active"
assert_eq "$(jq -r .phase_cursor <<<"$ADMIT1")" "16/34" "attach still at 16/34"
assert_eq "$(jq -r .accepted_commit <<<"$ADMIT1")" "$ACCEPTED" "attach preserves accepted commit"
assert_eq "$(jq -r .next_action <<<"$ADMIT1")" \
  "continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)" "attach preserves next action"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ADMIT1")" "0" "first attach duplicate_dispatch=0"
assert_eq "$(jq -r .narrative_ignored <<<"$ADMIT1")" "true" "admit ignores misleading narrative"
ADMIT2="$(admit_root root-mission-16-34 --reconcile-receipt "$RECEIPT_PATH")"
assert_eq "$(jq -r .status <<<"$ADMIT2")" "attach" "second admit still attaches"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ADMIT2")" "0" "second attach zero duplicate"
assert_eq "$(jq -r .action <<<"$ADMIT2")" "attach_active" "second action still attach_active"
PROMPT="$TEST_TMP/prompt.md"; echo 'implement phase 16' > "$PROMPT"
STUB_RUNNER="$TEST_TMP/agy-must-not-run"
cat > "$STUB_RUNNER" <<'EOF'
if [ "${1:-}" = "models" ]; then
  printf '%s\n' 'Gemini 3.5 Flash (High)'
  exit 0
fi
echo STUB_RAN >> "$(dirname "$0")/runner-calls"; exit 99
EOF
chmod +x "$STUB_RUNNER"; : > "$TEST_TMP/runner-calls"
BEFORE_BRANCHES="$(git -C "$SBX" for-each-ref --format='%(refname)' refs/heads | sort | tr '\n' ' ')"
BEFORE_WTS="$(git -C "$SBX" worktree list --porcelain | wc -l | tr -d ' ')"
BEFORE_MANIFESTS="$(find "$MANIFEST_DIR" -maxdepth 1 -name '*.manifest.json' -type f | wc -l | tr -d ' ')"
BEFORE_WOS="$(find "$COMMON/autopilot/work-orders" -type f -name '*.json' ! -name 'reconcile-receipt.json' 2>/dev/null | wc -l | tr -d ' ')"
dispatch_attach() {
  cd "$SBX" || exit 1
  AUTOPILOT_DISPATCH_RUNS_DIR="$MANIFEST_DIR" \
  AUTOPILOT_ROOT_RUN_ID=root-mission-16-34 \
  AUTOPILOT_RECONCILE_RECEIPT="$RECEIPT_PATH" \
  AUTOPILOT_CONTINUATION_NARRATIVE="${1:-}" \
  bash "$DH" --branch feat/runtime-convergence --base develop --prompt-file "$PROMPT" \
    --agy-bin "$STUB_RUNNER" --continuation-durable "$DURABLE" --continuation-checkpoint "$CK" \
    --run-id root-mission-16-34 --stage implement
}
DISPATCH1="$(dispatch_attach "$MISLEADING_NARRATIVE")"
assert_eq "$(jq -r .status <<<"$DISPATCH1")" "attached" "dispatch-hetero attaches existing attempt"
assert_eq "$(jq -r .phase_cursor <<<"$DISPATCH1")" "16/34" "dispatch resumes phase 16/34"
assert_eq "$(jq -r .root_run_id <<<"$DISPATCH1")" "root-mission-16-34" "dispatch keeps root"
assert_eq "$(jq -r .duplicate_dispatch <<<"$DISPATCH1")" "0" "dispatch zero duplicate"
assert_eq "$(jq -r .next_action <<<"$DISPATCH1")" \
  "continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)" "dispatch next_action from durable"
assert_eq "0" "$(wc -l < "$TEST_TMP/runner-calls" | tr -d ' ')" "runner never invoked on attach"
DISPATCH2="$(dispatch_attach "")"
assert_eq "$(jq -r .status <<<"$DISPATCH2")" "attached" "second dispatch attaches"
assert_eq "$(jq -r .duplicate_dispatch <<<"$DISPATCH2")" "0" "second dispatch zero duplicate"
assert_eq "0" "$(wc -l < "$TEST_TMP/runner-calls" | tr -d ' ')" "runner still never invoked"
AFTER_BRANCHES="$(git -C "$SBX" for-each-ref --format='%(refname)' refs/heads | sort | tr '\n' ' ')"
AFTER_WTS="$(git -C "$SBX" worktree list --porcelain | wc -l | tr -d ' ')"
AFTER_MANIFESTS="$(find "$MANIFEST_DIR" -maxdepth 1 -name '*.manifest.json' -type f | wc -l | tr -d ' ')"
AFTER_WOS="$(find "$COMMON/autopilot/work-orders" -type f -name '*.json' ! -name 'reconcile-receipt.json' 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "$BEFORE_BRANCHES" "$AFTER_BRANCHES" "no second branch created"
assert_eq "$BEFORE_WTS" "$AFTER_WTS" "no second worktree created"
assert_eq "$BEFORE_MANIFESTS" "$AFTER_MANIFESTS" "no second manifest created"
assert_eq "$BEFORE_WOS" "$AFTER_WOS" "no second work order created on resume"
ENGINE_OUT="$(node - "$REPO_ROOT" "$DURABLE" "$CK" "$SBX" "$ACCEPTED" "$BASE_SHA" "$RECEIPT_PATH" <<'NODE'
'use strict';
const path=require('path');
const {AutopilotEngine}=require(path.join(process.argv[2],'src/engine/autopilot-engine'));
const {captureProcessIdentity}=require(path.join(process.argv[2],'src/engine/work-order'));
const owner=captureProcessIdentity(process.pid);
const engine=new AutopilotEngine({
  cwd:process.argv[5],
  implementationDispatcher:()=>{throw new Error('dispatcher must not run when attach is selected');},
});
const result=engine.implementTask({
  promptFile:path.join(process.argv[2],'scripts/compaction-rehydrate.js'),
  branch:'feat/runtime-convergence', base:process.argv[7], cwd:process.argv[5],
  roster:{implementer_runner:'fixture',implementer_engine:'fixture',implementer_effort:'low'},
  continuationDurablePath:process.argv[3], continuationCheckpointPath:process.argv[4],
  reconcileReceiptPath:process.argv[8],
  continuationNarrative:{root_run_id:'root-mission-16-34',phase_cursor:'8/34',next_action:'start WLB P0 RED lifecycle oracle'},
  continuationMatchingRuns:[{
    run_id:'engine-attach-run',root_run_id:'root-mission-16-34',branch:'feat/runtime-convergence',
    base_sha:process.argv[7],stage:'implement',final_status:null,
    pid:owner.pid,process_start_time:owner.process_start_time,pgid:owner.pgid,sid:owner.sid,
  }],
  env:{AUTOPILOT_ROOT_RUN_ID:'root-mission-16-34'},
  implementationOptions:{env:{AUTOPILOT_ROOT_RUN_ID:'root-mission-16-34'}},
});
process.stdout.write(JSON.stringify({
  status:result.status,phase:result.phase,phase_cursor:result.phase_cursor,
  duplicate_dispatch:result.duplicate_dispatch,attached_run_id:result.attached_run_id,
  accepted_commit:result.accepted_commit,next_action:result.next_action,root_run_id:result.root_run_id,
}));
NODE
)"
assert_eq "$(jq -r .status <<<"$ENGINE_OUT")" "attached" "engine attaches instead of dispatching"
assert_eq "$(jq -r .phase_cursor <<<"$ENGINE_OUT")" "16/34" "engine resumes phase 16/34"
assert_eq "$(jq -r .duplicate_dispatch <<<"$ENGINE_OUT")" "0" "engine zero duplicate dispatch"
assert_eq "$(jq -r .accepted_commit <<<"$ENGINE_OUT")" "$ACCEPTED" "engine accepted commit"
assert_eq "$(jq -r .next_action <<<"$ENGINE_OUT")" \
  "continue portfolio phase 16 of 34 (LSM P1 task-status aggregation)" "engine next action"
# ========== Negative gates (six depth-0 findings) ==========
WO_OTHER="$(wo_write root-need-receipt 'must reconcile first')"
assert_eq "$(jq -r .status <<<"$WO_OTHER")" "written" "other WO written for omit-receipt test"
set +e
OMIT_OUT="$(node "$RH" admit --root-run-id root-need-receipt --git-cwd "$SBX" \
  --require-reconcile --mission-active 2>/dev/null)"; OMIT_RC=$?
set -e
assert_eq "$OMIT_RC" "1" "omitted reconcile exits 1"
assert_eq "$(jq -r .status <<<"$OMIT_OUT")" "reject" "omitted reconcile rejects"
assert_contains "$(jq -r .reason_code <<<"$OMIT_OUT")" "reconcile_receipt" "omitted reconcile reason mentions receipt"
FORGED="$TEST_TMP/forged-receipt.json"
jq '.digest="0"*64' "$RECEIPT_PATH" > "$FORGED"
set +e
FORGE_OUT="$(admit_root root-mission-16-34 --reconcile-receipt "$FORGED" --require-reconcile 2>/dev/null)"
FORGE_RC=$?; set -e
assert_eq "$FORGE_RC" "1" "forged receipt exits 1"
assert_eq "$(jq -r .reason_code <<<"$FORGE_OUT")" "reconcile_receipt_forged" "forged reason"
STALE="$TEST_TMP/stale-receipt.json"
jq --arg past 2000-01-01T00:00:00.000Z '.fresh_until=$past | del(.digest)' "$RECEIPT_PATH" > "$TEST_TMP/stale-body.json"
node -e '
const fs=require("fs"); const {reconcileReceiptDigest}=require(process.argv[1]);
const r=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); r.digest=reconcileReceiptDigest(r);
fs.writeFileSync(process.argv[3], JSON.stringify(r,null,2)+"\n");
' "$REPO_ROOT/src/engine/work-order.js" "$TEST_TMP/stale-body.json" "$STALE"
set +e
STALE_OUT="$(admit_root root-mission-16-34 --reconcile-receipt "$STALE" --require-reconcile 2>/dev/null)"
STALE_RC=$?; set -e
assert_eq "$STALE_RC" "1" "stale receipt exits 1"
assert_eq "$(jq -r .reason_code <<<"$STALE_OUT")" "reconcile_receipt_stale" "stale reason"
cat > "$MANIFEST_DIR/dead-stale.manifest.json" <<EOF
{"schema":1,"run_id":"run-dead-stale","root_run_id":"root-dead-stale","branch":"feat/runtime-convergence",
"base_sha":"$BASE_SHA","stage":"implement","final_status":null,"pid":999999,"process_start_time":1,
"pgid":999999,"sid":999999,"authority":"schema1_manifest"}
EOF
DEAD_CLASS="$(node - "$REPO_ROOT" "$MANIFEST_DIR/dead-stale.manifest.json" <<'NODE'
const fs=require('fs'),path=require('path');
const {normalizeRunRecord}=require(path.join(process.argv[2],'src/engine/continuation-admission'));
const r=normalizeRunRecord(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
process.stdout.write(JSON.stringify({active:r.active,terminal:r.terminal}));
NODE
)"
assert_eq "$(jq -r .active <<<"$DEAD_CLASS")" "false" "dead PID schema-1 is not active"
kill_owner(){ node -e 'const fs=require("fs"),{execFileSync}=require("child_process"),{workOrderDigest}=require(process.argv[2]);
const wo=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
wo.owner={pid:999999,process_start_time:1,pgid:999999,sid:999999,kind:"controller"};
wo.runner={pid:null,process_start_time:null,pgid:null,sid:null};
wo.worktree=process.argv[3]||null;
// For clean stale proof: align base_sha to worktree HEAD so no unique mutation / head-ahead.
if(wo.worktree){try{wo.base_sha=execFileSync("git",["-C",wo.worktree,"rev-parse","HEAD"],{encoding:"utf8"}).trim();}catch(_e){}}
wo.digest=workOrderDigest(wo);fs.writeFileSync(process.argv[1],JSON.stringify(wo,null,2)+"\n");
' "$1" "$REPO_ROOT/src/engine/work-order.js" "${2:-}"; }
WO_UNK="$(wo_write root-unk-wo 'unknown wt')"; UNK_PATH="$(jq -r .path <<<"$WO_UNK")"
kill_owner "$UNK_PATH"
set +e; UNK_REC="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-unk-wo --durable "$DURABLE" 2>/dev/null)"; set -e
assert_eq "$(jq -r .classifications[0].classification <<<"$UNK_REC")" "orphan_blocked" "unknown worktree orphan_blocks"
assert_eq "$(jq -r .classifications[0].reason_code <<<"$UNK_REC")" "worktree_unknown" "worktree_unknown reason"
DIRTY_WT="$TEST_TMP/dirty-wt"; git -C "$SBX" worktree add --detach "$DIRTY_WT" HEAD -q; echo dirt > "$DIRTY_WT/dirt.txt"
WO_DIRTY="$(wo_write root-dirty-wo 'dirty wt')"; DIRTY_PATH="$(jq -r .path <<<"$WO_DIRTY")"
kill_owner "$DIRTY_PATH" "$DIRTY_WT"
set +e; DIRTY_REC="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-dirty-wo --durable "$DURABLE" 2>/dev/null)"; set -e
assert_eq "$(jq -r .classifications[0].classification <<<"$DIRTY_REC")" "orphan_blocked" "dirty worktree orphan_blocks"
assert_eq "$(jq -r .classifications[0].reason_code <<<"$DIRTY_REC")" "worktree_dirty" "worktree_dirty reason"
CLEAN_WT="$TEST_TMP/clean-wt"; git -C "$SBX" worktree add --detach "$CLEAN_WT" HEAD -q
WO_STALE="$(wo_write root-stale-wo 'orphaned work')"; STALE_WO_PATH="$(jq -r .path <<<"$WO_STALE")"
kill_owner "$STALE_WO_PATH" "$CLEAN_WT"
STALE_REC="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-stale-wo --durable "$DURABLE")"
assert_eq "$(jq -r .classifications[0].classification <<<"$STALE_REC")" "stale_dispositioned" "dead+clean WO is stale_dispositioned"
assert_eq "$(jq -r .disposition "$STALE_WO_PATH")" "stale_dispositioned" "stale disposition persisted on WO"
STALE_REC2="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-stale-wo --durable "$DURABLE")"
assert_eq "$(jq -r .classifications[0].classification <<<"$STALE_REC2")" "stale_dispositioned" "stale_dispositioned is idempotent"
assert_eq "$(jq -r .classifications[0].idempotent <<<"$STALE_REC2")" "true" "second reconcile idempotent flag"
AHEAD_WT="$TEST_TMP/ahead-wt"; git -C "$SBX" worktree add -b feat/ahead-mut "$AHEAD_WT" "$BASE_SHA" -q
echo unique-mutation > "$AHEAD_WT/unique.txt"
git -C "$AHEAD_WT" add unique.txt && git -C "$AHEAD_WT" commit -q -m 'unique committed mutation'
WO_AHEAD="$(wo_write root-ahead-wo 'ahead mut')"; AHEAD_PATH="$(jq -r .path <<<"$WO_AHEAD")"
node -e 'const fs=require("fs"),{workOrderDigest}=require(process.argv[2]);const wo=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
wo.owner={pid:999999,process_start_time:1,pgid:999999,sid:999999,kind:"controller"};
wo.runner={pid:null,process_start_time:null,pgid:null,sid:null};wo.worktree=process.argv[3];
wo.base_sha=process.argv[4];wo.digest=workOrderDigest(wo);fs.writeFileSync(process.argv[1],JSON.stringify(wo,null,2)+"\n");
' "$AHEAD_PATH" "$REPO_ROOT/src/engine/work-order.js" "$AHEAD_WT" "$BASE_SHA"
set +e; AHEAD_REC="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-ahead-wo --durable "$DURABLE" 2>/dev/null)"; set -e
assert_eq "$(jq -r .classifications[0].classification <<<"$AHEAD_REC")" "orphan_blocked" "head-ahead orphan_blocks"
assert_eq "$(jq -r .classifications[0].reason_code <<<"$AHEAD_REC")" "head_ahead" "head_ahead reason"
TERM_RCPT="$TEST_TMP/term-fail-receipt.json"
node -e '
const fs=require("fs"),wo=require(process.argv[1]);
const body={schema_version:1,artifact_type:"l6_engine_result_receipt",root_run_id:"root-term-fail",
  work_order_id:"wo-root-term-fail-implement-a1",terminal_status:"failed",recorded_at:"2026-07-29T00:00:00Z"};
const dig=wo.sha256Json(body); body.digest=dig;
fs.writeFileSync(process.argv[2], JSON.stringify(body)+"\n");
fs.writeFileSync(process.argv[3], dig);
' "$REPO_ROOT/src/engine/work-order.js" "$TERM_RCPT" "$TEST_TMP/term-fail.dig"
TERM_DIG="$(cat "$TEST_TMP/term-fail.dig")"
WO_TERM="$(wo_write root-term-fail done --receipt "$TERM_RCPT")"
node -e '
const wo=require(process.argv[1]);
const r=wo.updateWorkOrderLifecycle(process.argv[2],{root_run_id:"root-term-fail",graph_node:"implement",attempt:1},{
  terminal_status:"failed", disposition:"consumed",
  expected_receipt:{path:process.argv[3],digest:process.argv[5]},
  paths:{receipt:process.argv[3],durable:process.argv[4]}
},{bindArtifacts:false});
if(r.status!=="written"){console.error(JSON.stringify(r)); process.exit(1);}
' "$REPO_ROOT/src/engine/work-order.js" "$COMMON" "$TERM_RCPT" "$DURABLE" "$TERM_DIG"
TERM_REC="$(node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-term-fail --durable "$DURABLE")"
assert_eq "$(jq -r .classifications[0].classification <<<"$TERM_REC")" "consume_terminal" "terminal WO classifies consume_terminal"
TERM_RPATH="$(jq -r .receipt_path <<<"$TERM_REC")"
assert_eq "$(jq -r .root_run_id "$TERM_RPATH")" "root-term-fail" "term receipt root matches"
TERM_ADMIT="$(node "$RH" admit --root-run-id root-term-fail --git-cwd "$SBX" \
  --reconcile-receipt "$TERM_RPATH" --terminal-receipt "$TERM_RCPT" --require-reconcile 2>/dev/null || true)"
assert_eq "$(jq -r .status <<<"$TERM_ADMIT")" "reject" "terminal failure is not soft-attached"
assert_eq "$(jq -r .reason_code <<<"$TERM_ADMIT")" "terminal_failure" "terminal_failure reason"
assert_eq "$(jq -r .action <<<"$TERM_ADMIT")" "consume_terminal" "action remains consume_terminal"
assert_eq "$(jq -r .classification <<<"$TERM_ADMIT")" "consume_terminal" "classification consume_terminal"
TERM_ADMIT2="$(node "$RH" admit --root-run-id root-term-fail --git-cwd "$SBX" \
  --reconcile-receipt "$TERM_RPATH" --require-reconcile 2>/dev/null || true)"
assert_eq "$(jq -r .status <<<"$TERM_ADMIT2")" "reject" "same-root terminal re-admit still rejects"
assert_eq "$(jq -r .reason_code <<<"$TERM_ADMIT2")" "terminal_failure" "same-root keeps terminal_failure"
assert_eq "$(jq -r .action <<<"$TERM_ADMIT2")" "consume_terminal" "same-root keeps consume_terminal action"
CROSS_ROOT="root-cross-forged"
WO_CROSS="$(wo_write "$CROSS_ROOT" 'must not attach via foreign receipt')"
assert_eq "$(jq -r .status <<<"$WO_CROSS")" "written" "cross-root victim WO written"
CROSS_BEFORE_WOS="$(find "$COMMON/autopilot/work-orders/$(node -e 'process.stdout.write(String(process.argv[1]).replace(/[^A-Za-z0-9._:-]/g,"_"))' "$CROSS_ROOT")" -type f -name '*.json' ! -name 'reconcile-receipt.json' 2>/dev/null | wc -l | tr -d ' ')"
set +e
CROSS_ADMIT="$(node "$RH" admit --root-run-id "$CROSS_ROOT" --git-cwd "$SBX" \
  --reconcile-receipt "$RECEIPT_PATH" --require-reconcile 2>/dev/null)"
CROSS_ADMIT_RC=$?; set -e
assert_eq "$CROSS_ADMIT_RC" "1" "cross-root foreign receipt exits 1"
assert_eq "$(jq -r .status <<<"$CROSS_ADMIT")" "reject" "cross-root foreign receipt rejects"
assert_eq "$(jq -r .reason_code <<<"$CROSS_ADMIT")" "reconcile_receipt_mismatch" "cross-root reason is root mismatch"
assert_eq "$(jq -r .duplicate_dispatch <<<"$CROSS_ADMIT")" "0" "cross-root admit zero dispatch"
assert_neq "$(jq -r .action <<<"$CROSS_ADMIT")" "attach_active" "cross-root never attach_active"
assert_neq "$(jq -r .action <<<"$CROSS_ADMIT")" "dispatch_new" "cross-root never dispatch_new"
assert_neq "$(jq -r .status <<<"$CROSS_ADMIT")" "attach" "cross-root never soft-attaches"
CROSS_FORGED="$TEST_TMP/cross-root-forged-receipt.json"
node -e '
const fs=require("fs"),wo=require(process.argv[1]);
const r=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
r.root_run_id=process.argv[3];
if(r.identity) r.identity.root_run_id=process.argv[3];
if(Array.isArray(r.classifications)) for(const c of r.classifications) c.root_run_id=process.argv[3];
r.digest=wo.reconcileReceiptDigest(r);
fs.writeFileSync(process.argv[4], JSON.stringify(r,null,2)+"\n");
' "$REPO_ROOT/src/engine/work-order.js" "$RECEIPT_PATH" "$CROSS_ROOT" "$CROSS_FORGED"
CROSS_NEG="$(node -e '
const wo=require(process.argv[1]),fs=require("fs");
const cd=process.argv[2], foreignRoot=process.argv[3], forgedPath=process.argv[4];
const forged=JSON.parse(fs.readFileSync(forgedPath,"utf8"));
const v=wo.validateReconcileReceipt(forged,{root_run_id:foreignRoot,commonDir:cd});
const claim=wo.claimDispatchCas(cd,{root_run_id:foreignRoot,graph_node:"implement",attempt:99,
  role:"implementer",next_action:"should-not-dispatch",phase_cursor:"16/34",accepted_commit:"none",paths:{}},
  {bindArtifacts:false,reconcileReceipt:forged,lockTimeoutMs:3000});
const {admitContinuation}=require(process.argv[1].replace(/work-order\.js$/,"continuation-admission.js"));
const admit=admitContinuation({identity:{root_run_id:foreignRoot},gitCwd:process.argv[5],
  reconcileReceipt:forged,requireReconcile:true,missionActive:true,claimWorkOrder:false,matchingRuns:[]});
process.stdout.write(JSON.stringify({
  v_ok:v.ok, v_rc:v.reason_code,
  claim_status:claim.status, claim_action:claim.action||null, claim_rc:claim.reason_code||null,
  admit_status:admit.status, admit_action:admit.action||null, admit_rc:admit.reason_code||null,
  admit_dup:admit.duplicate_dispatch}));
' "$REPO_ROOT/src/engine/work-order.js" "$COMMON" "$CROSS_ROOT" "$CROSS_FORGED" "$SBX")"
assert_eq "$(jq -r .v_ok <<<"$CROSS_NEG")" "false" "rewritten-root receipt validation fails closed"
assert_contains "$(jq -r .v_rc <<<"$CROSS_NEG")" "reconcile_receipt" "rewritten-root reason is receipt gate"
assert_neq "$(jq -r .claim_action <<<"$CROSS_NEG")" "dispatch_new" "cross-root forged CAS never dispatch_new"
assert_eq "$(jq -r .claim_status <<<"$CROSS_NEG")" "reject" "cross-root forged CAS rejects"
assert_eq "$(jq -r .admit_status <<<"$CROSS_NEG")" "reject" "cross-root forged admit rejects"
assert_neq "$(jq -r .admit_action <<<"$CROSS_NEG")" "attach_active" "cross-root forged never attach"
assert_eq "$(jq -r .admit_dup <<<"$CROSS_NEG")" "0" "cross-root forged zero duplicate_dispatch"
set +e
CROSS_DISP="$(
  cd "$SBX" || exit 1
  AUTOPILOT_ROOT_RUN_ID="$CROSS_ROOT" \
  AUTOPILOT_RECONCILE_RECEIPT="$RECEIPT_PATH" \
  bash "$DH" --branch feat/cross-root-must-not-create --base develop --prompt-file "$PROMPT" \
    --agy-bin "$STUB_RUNNER" --run-id "$CROSS_ROOT" --stage implement 2>/dev/null
)"; CROSS_DISP_RC=$?; set -e
assert_neq "0" "$CROSS_DISP_RC" "dispatch fails closed on cross-root receipt"
assert_contains "$CROSS_DISP" "precondition_failed" "cross-root dispatch precondition_failed"
assert_eq "0" "$(wc -l < "$TEST_TMP/runner-calls" | tr -d ' ')" "cross-root never invokes runner"
assert_eq "no" "$(
  git -C "$SBX" rev-parse --verify --quiet refs/heads/feat/cross-root-must-not-create >/dev/null && echo yes || echo no
)" "cross-root dispatch creates no branch"
CROSS_AFTER_WOS="$(find "$COMMON/autopilot/work-orders/$(node -e 'process.stdout.write(String(process.argv[1]).replace(/[^A-Za-z0-9._:-]/g,"_"))' "$CROSS_ROOT")" -type f -name '*.json' ! -name 'reconcile-receipt.json' 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "$CROSS_BEFORE_WOS" "$CROSS_AFTER_WOS" "cross-root forged creates no extra WO"
UNAUTH="$TEST_TMP/unauth-ck.json"
write_id "$UNAUTH" 0 root-unauth 16/34 spoof >/dev/null
UNAUTH_OUT="$(node - "$REPO_ROOT" "$UNAUTH" <<'NODE'
const fs=require('fs'),path=require('path');
const {admitContinuation}=require(path.join(process.argv[2],'src/engine/continuation-admission'));
const r=admitContinuation({
  identity:{root_run_id:'root-unauth'},
  checkpoint:JSON.parse(fs.readFileSync(process.argv[3],'utf8')),
  requireBoundEvidence:true, matchingRuns:[], claimWorkOrder:false,
});
process.stdout.write(JSON.stringify(r));
NODE
)"
assert_eq "$(jq -r .status <<<"$UNAUTH_OUT")" "reject" "unauthenticated checkpoint rejects"
assert_eq "$(jq -r .reason_code <<<"$UNAUTH_OUT")" "unauthenticated_evidence" "unauthenticated_evidence reason"
CAS1="$(wo_write root-cas 'claim me')"
assert_eq "$(jq -r .status <<<"$CAS1")" "written" "cas first write"
CAS_GEN="$(jq -r .work_order.generation <<<"$CAS1")"
CAS_PATH="$(jq -r .path <<<"$CAS1")"
node -e '
const fs=require("fs"); const p=process.argv[1];
const wo=JSON.parse(fs.readFileSync(p,"utf8")); wo.generation=Number(wo.generation)+1;
const {workOrderDigest}=require(process.argv[2]); wo.digest=workOrderDigest(wo);
fs.writeFileSync(p, JSON.stringify(wo,null,2)+"\n");
' "$CAS_PATH" "$REPO_ROOT/src/engine/work-order.js"
set +e
CAS2="$(wo_write root-cas 'claim me again' --expected-generation "$CAS_GEN" 2>/dev/null)"; CAS2_RC=$?
set -e
assert_eq "$CAS2_RC" "1" "stale CAS generation exits 1"
assert_eq "$(jq -r .reason_code <<<"$CAS2")" "cas_conflict" "cas_conflict reason"
CAS_GO="$TEST_TMP/cas.go"; CAS_A="$TEST_TMP/cas.a"; CAS_B="$TEST_TMP/cas.b"; rm -f "$CAS_GO" "$CAS_A" "$CAS_B"
cas_claim() { # $1 out
  node -e 'const fs=require("fs"),wo=require(process.argv[1]);
const go=process.argv[3],out=process.argv[4],cd=process.argv[2];
while(!fs.existsSync(go)){}
const r=wo.claimDispatchCas(cd,{root_run_id:"root-cas-race",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"race",phase_cursor:"16/34",accepted_commit:"none",paths:{}},{bindArtifacts:false,lockTimeoutMs:8000});
fs.writeFileSync(out,JSON.stringify(r));
' "$REPO_ROOT/src/engine/work-order.js" "$COMMON" "$CAS_GO" "$1" &
}
cas_claim "$CAS_A"; cas_claim "$CAS_B"; sleep 0.1; : > "$CAS_GO"; wait || true
A_ACT="$(jq -r .action "$CAS_A" 2>/dev/null || echo missing)"
B_ACT="$(jq -r .action "$CAS_B" 2>/dev/null || echo missing)"
WINNERS="$(printf '%s\n%s\n' "$A_ACT" "$B_ACT" | grep -c '^dispatch_new$' || true)"
assert_eq "$WINNERS" "1" "two-process CAS has exactly one dispatch_new winner"
assert_neq "${A_ACT}${B_ACT}" "dispatch_newdispatch_new" "exact order never two dispatch_new"
NEGS="$(node -e '
const fs=require("fs"),path=require("path"),wo=require(process.argv[1]);
const cd=process.argv[2], receiptPath=process.argv[3], ledger=process.argv[4];
const bare=wo.validateTerminalReceipt({status:"success"},{root_run_id:"r",work_order_id:"w",terminal_status:"success",
  expected_receipt:{path:"/tmp/x",digest:"0".repeat(64)}});
const alias=wo.validateTerminalReceipt({schema_version:1,artifact_type:"l6_engine_result_receipt",root_run_id:"r",
  work_order_id:"w",status:"success",digest:"x"},{root_run_id:"r",work_order_id:"w",terminal_status:"success",
  expected_receipt:{path:"/tmp/x",digest:"0".repeat(64)}});
const written=wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-lock-only",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"x",phase_cursor:"1/1",accepted_commit:"none",
  owner:{pid:999998,process_start_time:1,pgid:999998,sid:999998,kind:"controller"},paths:{ledger:null}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
const lock=wo.acquireWorkOrderLock(written.path,wo.captureProcessIdentity(process.pid),500);
const lockClass=wo.classifyWorkOrder(written.work_order,{workOrderPath:written.path,skipBindCheck:true}).classification;
wo.releaseWorkOrderLock(written.path,lock.lock);
const liveId=wo.captureProcessIdentity(process.pid);
const liveWO=wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-live-nolease",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"x",phase_cursor:"1/1",accepted_commit:"none",owner:liveId,paths:{ledger}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
wo.releaseOwnedLease(liveWO.path);
const noLease=wo.classifyWorkOrder(liveWO.work_order,{workOrderPath:liveWO.path,skipBindCheck:true});
const cdir=path.join(cd,"autopilot/work-orders/root-corrupt"); fs.mkdirSync(cdir,{recursive:true});
fs.writeFileSync(path.join(cdir,"implement-a1.json"),"{not-json");
const list=wo.listWorkOrders(cd,"root-corrupt"), nt=wo.listNonterminalWorkOrders(cd,"root-corrupt");
const collDir=path.join(cd,"autopilot/work-orders",wo.workOrderPath(cd,"rootA/B","g",1).split("/").slice(-2,-1)[0]||"rootA_B");
const diglessDir=path.join(cd,"autopilot/work-orders/root-digless"); fs.mkdirSync(diglessDir,{recursive:true});
fs.writeFileSync(path.join(diglessDir,"implement-a1.json"),JSON.stringify({schema_version:2,artifact_type:"work_order",
  work_order_id:"x",root_run_id:"root-digless",graph_node:"implement",attempt:1,role:"implementer",
  owner:{pid:1,process_start_time:1,pgid:1,sid:1},paths:{},next_action:"x",heartbeat_at:"t",generation:1})+"\n");
const digless=wo.listWorkOrders(cd,"root-digless");
const tampDir=path.join(cd,"autopilot/work-orders/root-tamp"); fs.mkdirSync(tampDir,{recursive:true});
fs.writeFileSync(path.join(tampDir,"implement-a1.json"),JSON.stringify({schema_version:2,artifact_type:"not_work_order",
  work_order_id:"x",root_run_id:"root-tamp",digest:"abc"})+"\n");
const tamp=wo.listWorkOrders(cd,"root-tamp");
const collRoot="root-coll/x"; const collSafe=path.join(cd,"autopilot/work-orders",String(collRoot).replace(/[^A-Za-z0-9._:-]/g,"_"));
fs.mkdirSync(collSafe,{recursive:true});
const foreign={schema_version:2,artifact_type:"work_order",work_order_id:"f",root_run_id:"root-coll_x",graph_node:"implement",
  attempt:1,role:"implementer",owner:{pid:1,process_start_time:1,pgid:1,sid:1},paths:{},next_action:"x",
  heartbeat_at:"t",generation:1,runner:{pid:null,process_start_time:null,pgid:null,sid:null},branch:null,base_sha:null,
  worktree:null,artifact_digests:{},phase_cursor:null,accepted_commit:null,terminal_status:null,disposition:null,
  expected_receipt:null,cas_token:"c"};
foreign.digest=wo.workOrderDigest(foreign);
fs.writeFileSync(path.join(collSafe,"implement-a1.json"),JSON.stringify(foreign)+"\n");
const coll=wo.listWorkOrders(cd,collRoot);
// Isolated root for receipt/CAS negatives — never mutate the 16/34 acceptance WO.
const isoOwner=wo.captureProcessIdentity(process.pid);
wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-receipt-neg",graph_node:"implement",attempt:1,
  role:"implementer",next_action:"neg",phase_cursor:"16/34",accepted_commit:"none",owner:isoOwner,paths:{ledger}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
const e0=wo.listWorkOrders(cd,"root-receipt-neg").filter(x=>x.work_order&&!x.error)[0];
const w0=e0.work_order;
const receipt={schema_version:1,artifact_type:"postcompact_reconcile_receipt",issued_at:new Date().toISOString(),
  fresh_until:new Date(Date.now()+600000).toISOString(),git_common_dir:cd,root_run_id:"root-receipt-neg",
  classifications:[{classification:"attach_active",path:e0.path,work_order_id:w0.work_order_id,root_run_id:w0.root_run_id,
    generation:w0.generation,work_order_digest:w0.digest,reason:"fixture"}],
  identity:{root_run_id:"root-receipt-neg"},authority:["work_order"]};
receipt.digest=wo.reconcileReceiptDigest(receipt);
wo.writeAtomicJson(wo.reconcileReceiptPath(cd,"root-receipt-neg"),receipt);
const entries=wo.listWorkOrders(cd,"root-receipt-neg").filter(e=>e.work_order&&!e.error);
if(entries[0]){const live=JSON.parse(fs.readFileSync(entries[0].path,"utf8")); live.generation=(live.generation||1)+10;
  live.digest=wo.workOrderDigest(live); wo.writeAtomicJson(entries[0].path,live);}
const v=wo.validateReconcileReceipt(receipt,{root_run_id:"root-receipt-neg",commonDir:cd});
const omit=JSON.parse(JSON.stringify(receipt));
if(omit.classifications[0]){delete omit.classifications[0].generation; delete omit.classifications[0].work_order_digest;}
omit.digest=wo.reconcileReceiptDigest(omit);
const vomit=wo.validateReconcileReceipt(omit,{root_run_id:receipt.root_run_id,commonDir:cd});
const redig=JSON.parse(JSON.stringify(receipt));
if(entries[0]&&redig.classifications[0]){
  redig.classifications[0].work_order_digest=wo.workOrderDigest(JSON.parse(fs.readFileSync(entries[0].path,"utf8")));
  redig.digest=wo.reconcileReceiptDigest(redig);
}
const vredig=wo.validateReconcileReceipt(redig,{root_run_id:"root-receipt-neg",commonDir:cd});
// wrong artifact_type (non-empty but not exact expected)
const wrongArt=wo.validateTerminalReceipt({schema_version:1,artifact_type:"wrong_artifact",root_run_id:"r",
  work_order_id:"w",terminal_status:"success",digest:"x"},{root_run_id:"r",work_order_id:"w",terminal_status:"success",
  expected_receipt:{path:"/tmp/x",digest:"0".repeat(64)}});
// empty redigested receipt while live WOs exist must not permit dispatch_new
const emptyRcpt={schema_version:1,artifact_type:"postcompact_reconcile_receipt",issued_at:new Date().toISOString(),
  fresh_until:new Date(Date.now()+600000).toISOString(),git_common_dir:cd,root_run_id:"root-receipt-neg",
  classifications:[],identity:{root_run_id:"root-receipt-neg"},authority:["work_order"]};
emptyRcpt.digest=wo.reconcileReceiptDigest(emptyRcpt);
const vempty=wo.validateReconcileReceipt(emptyRcpt,{root_run_id:"root-receipt-neg",commonDir:cd});
const claimEmpty=wo.claimDispatchCas(cd,{root_run_id:"root-receipt-neg",graph_node:"implement",attempt:1,
  role:"implementer",next_action:"dup",phase_cursor:"16/34",accepted_commit:"none",paths:{}},
  {bindArtifacts:false,reconcileReceipt:emptyRcpt,lockTimeoutMs:3000});
// omitted classification (strip all classes for a root that still has WOs) duplicate-CAS
const omitClass=JSON.parse(JSON.stringify(receipt));
omitClass.classifications=[]; omitClass.digest=wo.reconcileReceiptDigest(omitClass);
const vomitClass=wo.validateReconcileReceipt(omitClass,{root_run_id:"root-receipt-neg",commonDir:cd});
const claimOmit=wo.claimDispatchCas(cd,{root_run_id:"root-receipt-neg",graph_node:"implement",attempt:99,
  role:"implementer",next_action:"dup2",phase_cursor:"16/34",accepted_commit:"none",paths:{}},
  {bindArtifacts:false,reconcileReceipt:omitClass,lockTimeoutMs:3000});
process.stdout.write(JSON.stringify({bare_ok:bare.ok,bare_rc:bare.reason_code,alias_ok:alias.ok,
  lock_class:lockClass,nolease:noLease.classification,nolease_rc:noLease.reason_code,
  corrupt_n:list.length,corrupt_nt:nt.length,corrupt_err:list[0]&&list[0].error&&list[0].error.reason_code,
  gen_ok:v.ok,gen_rc:v.reason_code,unrel:wo.hasNonterminalWorkOrders(cd,"root-no-such")?1:0,
  digless_err:digless[0]&&digless[0].error&&digless[0].error.reason_code,
  tamp_err:tamp[0]&&tamp[0].error&&tamp[0].error.reason_code,
  coll_err:coll[0]&&coll[0].error&&coll[0].error.reason_code,
  omit_ok:vomit.ok,omit_rc:vomit.reason_code,redig_ok:vredig.ok,redig_rc:vredig.reason_code,
  wrong_art_ok:wrongArt.ok,wrong_art_rc:wrongArt.reason_code,
  empty_ok:vempty.ok,empty_rc:vempty.reason_code,claim_empty_action:claimEmpty.action||claimEmpty.status,
  omit_class_ok:vomitClass.ok,omit_class_rc:vomitClass.reason_code,
  claim_omit_action:claimOmit.action||claimOmit.status}));
' "$REPO_ROOT/src/engine/work-order.js" "$COMMON" "$RECEIPT_PATH" "$LEDGER")"
assert_eq "$(jq -r .bare_ok <<<"$NEGS")" "false" "bare {status:success} fails terminal validation"
assert_contains "$(jq -r .bare_rc <<<"$NEGS")" "terminal_receipt" "bare receipt reason"
assert_eq "$(jq -r .alias_ok <<<"$NEGS")" "false" "status alias rejected for terminal receipt"
assert_eq "$(jq -r .lock_class <<<"$NEGS")" "orphan_blocked" "lock alone cannot attach_active"
assert_eq "$(jq -r .nolease <<<"$NEGS")" "orphan_blocked" "live identity+ledger without lease orphan_blocks"
assert_eq "$(jq -r .nolease_rc <<<"$NEGS")" "lock_not_owned" "no-lease reason lock_not_owned"
assert_eq "$(jq -r .corrupt_n <<<"$NEGS")" "1" "corrupt WO listed fail-closed"
assert_eq "$(jq -r .corrupt_nt <<<"$NEGS")" "1" "corrupt WO in nonterminal list"
assert_eq "$(jq -r .corrupt_err <<<"$NEGS")" "work_order_unreadable" "unreadable reason"
assert_eq "$(jq -r .gen_ok <<<"$NEGS")" "false" "receipt stale after WO generation change"
assert_eq "$(jq -r .gen_rc <<<"$NEGS")" "reconcile_receipt_stale" "fresh-but-stale after WO change"
assert_eq "$(jq -r .unrel <<<"$NEGS")" "0" "unrelated root has no nonterminal WOs"
assert_eq "$(jq -r .digless_err <<<"$NEGS")" "work_order_digest_missing" "digestless WO is error"
assert_eq "$(jq -r .tamp_err <<<"$NEGS")" "work_order_artifact_type" "tampered artifact_type is error"
assert_eq "$(jq -r .coll_err <<<"$NEGS")" "work_order_root_mismatch" "safeId collision fails closed"
assert_eq "$(jq -r .omit_ok <<<"$NEGS")" "false" "omitted generation/digest rejected"
assert_contains "$(jq -r .omit_rc <<<"$NEGS")" "reconcile_receipt" "omitted field reason"
assert_eq "$(jq -r .redig_ok <<<"$NEGS")" "false" "stale-but-redigested receipt rejected"
assert_eq "$(jq -r .redig_rc <<<"$NEGS")" "reconcile_receipt_stale" "stale-but-redigested reason"
assert_eq "$(jq -r .wrong_art_ok <<<"$NEGS")" "false" "wrong terminal artifact_type rejected"
assert_contains "$(jq -r .wrong_art_rc <<<"$NEGS")" "terminal_receipt" "wrong artifact reason"
assert_eq "$(jq -r .empty_ok <<<"$NEGS")" "false" "empty redigested receipt rejected while WOs exist"
assert_eq "$(jq -r .empty_rc <<<"$NEGS")" "reconcile_receipt_mismatch" "empty classification reason"
assert_neq "$(jq -r .claim_empty_action <<<"$NEGS")" "dispatch_new" "empty receipt cannot CAS dispatch_new"
assert_eq "$(jq -r .omit_class_ok <<<"$NEGS")" "false" "omitted classifications rejected"
assert_eq "$(jq -r .omit_class_rc <<<"$NEGS")" "reconcile_receipt_mismatch" "omitted classification reason"
assert_neq "$(jq -r .claim_omit_action <<<"$NEGS")" "dispatch_new" "omitted-classification CAS never dispatch_new"
# ========== Sol High adversarial negatives (every bypass) ==========
ADV="$(node -e '
const fs=require("fs"),path=require("path"),wo=require(process.argv[1]);
const cd=process.argv[2], ledger=process.argv[3], durablePath=process.argv[4];
const {admitContinuation,rehydrateCheckpoint,checkpointDigest,buildCheckpoint,normalizeRunRecord}=require(process.argv[1].replace(/work-order\.js$/,"continuation-admission.js"));
const out={};
// 1) relabelled classify on receipt (attach→stale) rejected even with matching digests
const own=wo.captureProcessIdentity(process.pid);
const wRel=wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-relabel",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"x",phase_cursor:"16/34",accepted_commit:"none",owner:own,paths:{ledger}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
const eRel=wo.listWorkOrders(cd,"root-relabel").filter(x=>x.work_order&&!x.error)[0];
const live=eRel.work_order;
const relabel={schema_version:1,artifact_type:"postcompact_reconcile_receipt",issued_at:new Date().toISOString(),
  fresh_until:new Date(Date.now()+600000).toISOString(),git_common_dir:cd,root_run_id:"root-relabel",
  classifications:[{classification:"stale_dispositioned",path:eRel.path,work_order_id:live.work_order_id,root_run_id:live.root_run_id,
    generation:live.generation,work_order_digest:live.digest,reason:"relabel attack"}],
  identity:{root_run_id:"root-relabel"},authority:["work_order"]};
relabel.digest=wo.reconcileReceiptDigest(relabel);
const vRel=wo.validateReconcileReceipt(relabel,{root_run_id:"root-relabel",commonDir:cd});
out.relabel_ok=vRel.ok; out.relabel_rc=vRel.reason_code;
// 2) consumed without validated terminal receipt orphan_blocks (no disposition-only trust)
const wCons=wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-cons-bare",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"x",phase_cursor:"1/1",accepted_commit:"none",owner:own,paths:{ledger}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
const consBare={...wCons.work_order,terminal_status:"success",disposition:"consumed"};
consBare.digest=wo.workOrderDigest(consBare); wo.writeAtomicJson(wCons.path,consBare);
const cBare=wo.classifyWorkOrder(consBare,{workOrderPath:wCons.path,skipBindCheck:true});
out.cons_bare=cBare.classification; out.cons_bare_rc=cBare.reason_code;
// 3) tombstone blocks dispatch_new overwrite
const claimTomb=wo.claimDispatchCas(cd,{root_run_id:"root-cons-bare",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"overwrite",phase_cursor:"1/1",accepted_commit:"none",paths:{}},{bindArtifacts:false,lockTimeoutMs:3000});
out.tomb_status=claimTomb.status; out.tomb_action=claimTomb.action||null; out.tomb_rc=claimTomb.reason_code||null;
// 4) durable 16/34 → 99/99 tamper without redigest rejected
const dur=JSON.parse(fs.readFileSync(durablePath,"utf8"));
const tampered={...dur,phase_cursor:"99/99"}; // keep old digest
const hyd=rehydrateCheckpoint(tampered);
out.tamp_status=hyd.status; out.tamp_rc=hyd.reason_code;
const admitT=admitContinuation({identity:{root_run_id:dur.root_run_id},durable:tampered,matchingRuns:[],claimWorkOrder:false});
out.admit_tamp=admitT.status; out.admit_tamp_rc=admitT.reason_code; out.admit_tamp_phase=admitT.phase_cursor||null;
// redigested tamper still fails bound evidence under mission/reconcile gate
const redigBody={...dur,phase_cursor:"99/99"}; delete redigBody.digest;
redigBody.digest=checkpointDigest(redigBody);
const admitR=admitContinuation({identity:{root_run_id:dur.root_run_id},durable:redigBody,matchingRuns:[],
  claimWorkOrder:false,requireBoundEvidence:true,missionActive:true,requireReconcile:true});
out.redig_status=admitR.status; out.redig_rc=admitR.reason_code;
// 5) incomplete lease (missing pgid/sid) cannot attach_active
const liveId=wo.captureProcessIdentity(process.pid);
const wInc=wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-incompleas",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"x",phase_cursor:"1/1",accepted_commit:"none",owner:liveId,paths:{ledger}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
const leasePath=wo.leasePathFor(wInc.path);
const incomplete={schema_version:1,pid:liveId.pid,process_start_time:liveId.process_start_time,pgid:null,sid:null,nonce:"n",created_at:new Date().toISOString()};
wo.writeAtomicJson(leasePath,incomplete);
// also drop lock ownership completeness
const lockPath=wInc.path+".lock";
try{fs.unlinkSync(lockPath);}catch(_e){}
const cInc=wo.classifyWorkOrder(wInc.work_order,{workOrderPath:wInc.path,skipBindCheck:true});
out.inc_class=cInc.classification; out.inc_rc=cInc.reason_code;
// 6) null root enumeration returns empty (no global scan)
out.null_list=wo.listWorkOrders(cd,null).length;
out.null_nt=wo.listNonterminalWorkOrders(cd,null).length;
out.null_has=wo.hasNonterminalWorkOrders(cd,null)?1:0;
// 7) WO cannot override terminal artifact_type
const wrongOverride=wo.validateTerminalReceipt(
  {schema_version:1,artifact_type:"soft_receipt",root_run_id:"r",work_order_id:"w",terminal_status:"success",digest:"x"},
  {root_run_id:"r",work_order_id:"w",terminal_status:"success",
    expected_receipt:{path:"/tmp/x",digest:"0".repeat(64),artifact_type:"soft_receipt"}});
out.override_ok=wrongOverride.ok; out.override_rc=wrongOverride.reason_code;
// 8) final9: pid-only / complete-without-lease matching runs never attach_active
const pidOnly={run_id:"r-pid",root_run_id:"root-pid-only",final_status:null,pid:process.pid};
const nPid=normalizeRunRecord(pidOnly);
const aPid=admitContinuation({identity:{root_run_id:"root-pid-only"},matchingRuns:[pidOnly],claimWorkOrder:false});
const fullNo={run_id:"r-full",root_run_id:"root-full-nolease",final_status:null,owner:liveId};
const aFull=admitContinuation({identity:{root_run_id:"root-full-nolease"},matchingRuns:[fullNo],claimWorkOrder:false});
out.pid_active=nPid.active?1:0; out.pid_inc=nPid.incomplete_identity?1:0;
out.pid_st=aPid.status; out.pid_act=aPid.action; out.pid_cls=aPid.classification||aPid.reason_code;
out.full_act=aFull.action; out.full_rc=aFull.reason_code; out.full_cls=aFull.classification||null;
// 9) final10: omit stage/branch/base never attaches; bound terminal consumes; forged/missing fail-closed
const led10=path.join(cd,"autopilot","f10-ledger.jsonl"); fs.mkdirSync(path.dirname(led10),{recursive:true});
fs.writeFileSync(led10,JSON.stringify({e:"f10"})+"\n");
const w10=wo.createOrUpdateWorkOrder(cd,{root_run_id:"root-f10-bind",graph_node:"implement",attempt:1,role:"implementer",
  next_action:"x",phase_cursor:"1/1",accepted_commit:"none",owner:liveId,paths:{ledger:led10}},
  {bindArtifacts:false,preserveOwner:true,updateLifecycle:false});
const baseBind={run_id:"r-omit",root_run_id:"root-f10-bind",final_status:null,owner:liveId,work_order_path:w10.path,
  lease_path:wo.leasePathFor(w10.path),ledger_path:led10};
const idB={root_run_id:"root-f10-bind",stage:"verify",branch:"feat/x",base_sha:"a".repeat(40)};
const aOmit=admitContinuation({identity:idB,matchingRuns:[baseBind],claimWorkOrder:false});
const aEx=admitContinuation({identity:idB,matchingRuns:[{...baseBind,run_id:"r-ex",stage:"verify",branch:"feat/x",
  base_sha:idB.base_sha,base:idB.base_sha}],claimWorkOrder:false});
const trP=path.join(cd,"autopilot","f10-term.json");
const tBody={schema_version:1,artifact_type:wo.TERMINAL_RECEIPT_ARTIFACT,root_run_id:"root-f10-term",
  work_order_id:"r-term",terminal_status:"success",recorded_at:new Date().toISOString()};
const tDig=wo.sha256Json(tBody); tBody.digest=tDig; wo.writeAtomicJson(trP,tBody);
const termRun={run_id:"r-term",root_run_id:"root-f10-term",final_status:"success",
  expected_receipt:{path:trP,digest:tDig},terminal_receipt_path:trP};
const aTok=admitContinuation({identity:{root_run_id:"root-f10-term"},matchingRuns:[termRun],claimWorkOrder:false});
const aForg=admitContinuation({identity:{root_run_id:"root-f10-term"},matchingRuns:[{...termRun,
  expected_receipt:{path:trP,digest:"0".repeat(64)}}],terminalReceipt:{...tBody,digest:"0".repeat(64)},claimWorkOrder:false});
const aMiss=admitContinuation({identity:{root_run_id:"root-f10-miss"},
  matchingRuns:[{run_id:"r-miss",root_run_id:"root-f10-miss",final_status:"success"}],claimWorkOrder:false});
Object.assign(out,{omit_st:aOmit.status,omit_act:aOmit.action,omit_cls:aOmit.classification||aOmit.reason_code,
  ex_act:aEx.action,ex_cls:aEx.classification||null,tok_st:aTok.status,tok_act:aTok.action,tok_cls:aTok.classification||null,
  forg_st:aForg.status,forg_rc:aForg.reason_code,miss_st:aMiss.status,miss_rc:aMiss.reason_code});
process.stdout.write(JSON.stringify(out));
' "$REPO_ROOT/src/engine/work-order.js" "$COMMON" "$LEDGER" "$DURABLE")"
assert_eq "$(jq -r '[.relabel_ok,.cons_bare,.cons_bare_rc,.tomb_status,.tamp_status,.tamp_rc,.admit_tamp,.redig_status,.inc_class,.null_list,.null_nt,.null_has,.override_ok,.pid_active,.pid_inc,.pid_st,.pid_act,.pid_cls,.full_act,.full_rc,.full_cls]|@tsv' <<<"$ADV")" \
  $'false\torphan_blocked\tterminal_receipt_missing\treject\treject\tcheckpoint_digest_mismatch\treject\treject\torphan_blocked\t0\t0\t0\tfalse\t0\t1\treject\tfail_closed\torphan_blocked\tfail_closed\tlock_not_owned\torphan_blocked' \
  "adversarial: relabel/consumed/tomb/tamper/null-root/override/pid-only/no-lease"
assert_contains "$(jq -r .relabel_rc <<<"$ADV")" "reconcile_receipt" "relabel reason is receipt gate"
assert_neq "$(jq -r .tomb_action <<<"$ADV")" "dispatch_new" "tombstone never dispatch_new overwrite"
assert_neq "$(jq -r .admit_tamp_phase <<<"$ADV")" "99/99" "admit never adopts 99/99"
assert_contains "$(jq -r .override_rc <<<"$ADV")" "terminal_receipt" "override reason terminal_receipt"
assert_eq "$(jq -r '[.omit_st,.omit_act,.omit_cls,.ex_act,.ex_cls,.tok_st,.tok_act,.tok_cls,.forg_st,.forg_rc,.miss_st,.miss_rc]|@tsv' <<<"$ADV")" \
  $'reject\tfail_closed\torphan_blocked\tattach_active\tattach_active\tconsume\tconsume_terminal\tconsume_terminal\treject\tterminal_receipt_digest_mismatch\treject\tterminal_receipt_missing' \
  "final10: omit bind orphan; exact attaches; bound terminal consumes; forged/missing fail-closed"
# Active Mission without durable input still requires reconcile + can claim WO
set +e
MISS_OUT="$(node "$RH" admit --root-run-id root-mission-only --git-cwd "$SBX" \
  --mission-active --require-reconcile --create-work-order 2>/dev/null)"; MISS_RC=$?; set -e
assert_eq "$MISS_RC" "1" "active Mission without durable still requires reconcile"
assert_eq "$(jq -r .status <<<"$MISS_OUT")" "reject" "mission-active omit receipt rejects"
assert_contains "$(jq -r .reason_code <<<"$MISS_OUT")" "reconcile_receipt" "mission-active reason is receipt"
node "$RH" reconcile --git-cwd "$SBX" --root-run-id root-mission-16-34 --durable "$DURABLE" >/dev/null
RECEIPT_PATH="$(node -e 'const wo=require(process.argv[1]);process.stdout.write(wo.reconcileReceiptPath(process.argv[2],"root-mission-16-34"));' "$REPO_ROOT/src/engine/work-order.js" "$COMMON")"
BEFORE_HB="$(jq -r .heartbeat_at "$WO_PATH")"
sleep 1
HB="$(node "$RH" heartbeat --git-cwd "$SBX" --root-run-id root-mission-16-34 \
  --graph-node implement --attempt 1 --runner self)"
assert_eq "$(jq -r .status <<<"$HB")" "written" "heartbeat updates WO"
assert_neq "$BEFORE_HB" "$(jq -r .heartbeat_at "$WO_PATH")" "heartbeat_at advanced automatically"
assert_neq "$(jq -r .owner.pid "$WO_PATH")" "null" "lifecycle owner pid auto-updated"
assert_neq "$(jq -r .owner.process_start_time "$WO_PATH")" "null" "lifecycle start time auto-updated"
assert_neq "$(jq -r .runner.pid "$WO_PATH")" "null" "runner pid auto-updated"
assert_file_absent "$TEST_TMP/not-a-product-acceptance" "no manual resume file used as acceptance"
INCOMPLETE="$TEST_TMP/incomplete.json"
printf '%s\n' '{"schema_version":1,"artifact_type":"continuation_checkpoint","root_run_id":"x"}' > "$INCOMPLETE"
set +e; INC_OUT="$(node "$RH" rehydrate --checkpoint "$INCOMPLETE" 2>/dev/null)"; INC_RC=$?; set -e
assert_eq "$INC_RC" "1" "incomplete rehydrate exits 1"
assert_eq "$(jq -r .status <<<"$INC_OUT")" "reject" "incomplete rejects"
assert_eq "$(jq -r .reason_code <<<"$INC_OUT")" "incomplete_checkpoint" "incomplete reason_code"
assert_eq "$(jq -r .duplicate_dispatch <<<"$INC_OUT")" "0" "incomplete still zero dispatch"
set +e
NF_OUT="$(node "$RH" admit --root-run-id no-such-root --strict-match --manifest-dir "$MANIFEST_DIR" 2>/dev/null)"
NF_RC=$?; set -e
assert_eq "$NF_RC" "1" "absent id exits 1"
assert_eq "$(jq -r .status <<<"$NF_OUT")" "not_found" "absent id is not_found"
assert_eq "$(jq -r .reason_code <<<"$NF_OUT")" "not_found" "not_found reason_code"
TERM_D="$TEST_TMP/terminal-durable.json"
write_id "$TERM_D" 1 root-terminal 34/34 'archive project' --campaign-phase terminal_ready >/dev/null
set +e
TERM_OUT="$(node "$RH" admit --durable "$TERM_D" --root-run-id root-terminal --git-cwd "$SBX" 2>/dev/null)"
TERM_RC=$?; set -e
assert_eq "$TERM_RC" "1" "terminal campaign exits 1"
assert_eq "$(jq -r .status <<<"$TERM_OUT")" "reject" "terminal rejects"
assert_eq "$(jq -r .reason_code <<<"$TERM_OUT")" "terminal_state" "terminal reason_code"
AMB1="$TEST_TMP/amb1.json"; AMB2="$TEST_TMP/amb2.json"
write_id "$AMB1" 1 root-amb 16/34 'do A' >/dev/null
write_id "$AMB2" 1 root-amb 17/34 'do B' >/dev/null
AMB_OUT="$(node - "$REPO_ROOT" "$AMB1" "$AMB2" <<'NODE'
const path=require('path'),fs=require('fs');
const {admitContinuation}=require(path.join(process.argv[2],'src/engine/continuation-admission'));
const r=admitContinuation({
  identity:{root_run_id:'root-amb'},
  durableSources:[JSON.parse(fs.readFileSync(process.argv[3],'utf8')),JSON.parse(fs.readFileSync(process.argv[4],'utf8'))],
  matchingRuns:[], claimWorkOrder:false,
});
process.stdout.write(JSON.stringify(r));
NODE
)"
assert_eq "$(jq -r .status <<<"$AMB_OUT")" "reject" "ambiguous tracker rejects"
assert_eq "$(jq -r .reason_code <<<"$AMB_OUT")" "ambiguous_tracker" "ambiguous reason_code"
assert_eq "$(jq -r .duplicate_dispatch <<<"$AMB_OUT")" "0" "ambiguous zero dispatch"
DRIFT="$TEST_TMP/drift.json"
node "$RH" write --out "$DRIFT" --as-durable --root-run-id root-drift --phase-cursor 16/34 \
  --accepted-commit ffffffffffffffffffffffffffffffffffffffff --next-action continue >/dev/null
set +e
DRIFT_OUT="$(node "$RH" admit --durable "$DRIFT" --root-run-id root-drift --git-cwd "$SBX" 2>/dev/null)"
DRIFT_RC=$?; set -e
assert_eq "$DRIFT_RC" "1" "commit drift exits 1"
assert_eq "$(jq -r .status <<<"$DRIFT_OUT")" "reject" "commit drift rejects"
assert_eq "$(jq -r .reason_code <<<"$DRIFT_OUT")" "accepted_commit_drift" "drift reason_code"
set +e
DISP_FAIL="$(
  cd "$SBX" || exit 1
  AUTOPILOT_ROOT_RUN_ID=root-drift bash "$DH" \
    --branch feat/should-not-create --base develop --prompt-file "$PROMPT" \
    --agy-bin "$STUB_RUNNER" --continuation-durable "$DRIFT" --run-id root-drift --stage implement 2>/dev/null
)"; DISP_FAIL_RC=$?; set -e
assert_neq "0" "$DISP_FAIL_RC" "dispatch fails closed on commit drift"
assert_contains "$DISP_FAIL" "precondition_failed" "dispatch emits precondition_failed"
assert_contains "$DISP_FAIL" "continuation admission" "dispatch names continuation admission"
assert_eq "no" "$(
  git -C "$SBX" rev-parse --verify --quiet refs/heads/feat/should-not-create >/dev/null && echo yes || echo no
)" "fail-closed dispatch creates no branch"
# final6–10 executable negatives
REDIG="$TEST_TMP/durable-redig-99.json"
node -e '
const fs=require("fs"),path=require("path");
const {checkpointDigest}=require(path.join(process.argv[1],"src/engine/continuation-admission"));
const d=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
d.phase_cursor="99/99"; delete d.digest; d.digest=checkpointDigest(d);
fs.writeFileSync(process.argv[3], JSON.stringify(d,null,2)+"\n");
' "$REPO_ROOT" "$DURABLE" "$REDIG"
assert_eq "$(jq -r .phase_cursor "$REDIG")" "99/99" "fixture redigested to 99/99"
assert_eq "$(jq -r .phase_cursor "$DURABLE")" "16/34" "canonical durable still 16/34"
set +e
REDIG_CLI="$(node "$RH" admit --durable "$REDIG" --root-run-id root-mission-16-34 \
  --git-cwd "$SBX" --mission-active --require-bound 2>/dev/null)"
REDIG_RC=$?; set -e
assert_eq "$REDIG_RC" "1" "production CLI redigested 99/99 exits nonzero"
assert_eq "$(jq -r .status <<<"$REDIG_CLI")" "reject" "production CLI redigested rejects"
assert_neq "$(jq -r .action <<<"$REDIG_CLI")" "dispatch_new" "redigested never dispatch_new"
assert_neq "$(jq -r .phase_cursor <<<"$REDIG_CLI")" "99/99" "CLI never adopts 99/99"
FREE_PASS="$(node -e '
const path=require("path");
const {authenticateCheckpointEvidence,buildCheckpoint}=require(path.join(process.argv[1],"src/engine/continuation-admission"));
const body=buildCheckpoint({root_run_id:"r",phase_cursor:"99/99",accepted_commit:"none",next_action:"x"},{durable:true});
const r=authenticateCheckpointEvidence(body,{requireBoundEvidence:true,durablePath:"/tmp/nonexistent-durable.json"});
process.stdout.write(JSON.stringify({ok:r.ok,rc:r.reason_code||null}));
' "$REPO_ROOT")"
assert_eq "$(jq -r .ok <<<"$FREE_PASS")" "false" "mere durablePath is not bound evidence"
assert_eq "$(jq -r .rc <<<"$FREE_PASS")" "unauthenticated_evidence" "free-pass reason unauthenticated_evidence"
LIFE_BLK="$(node -e '
const path=require("path");
const {implementationResultBlocked}=require(path.join(process.argv[1],"src/engine/autopilot-engine"));
const blocked=implementationResultBlocked({
  status:0, signal:null, stdout:"", stderr:"", parseError:null, error:null,
  lifecycle_error:"fault_inject_lifecycle_update",
  result:{status:"committed",commit:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runner:"t",model:"t",branch:"b",base:"develop",files_changed:1,insertions:1,deletions:0},
});
process.stdout.write(JSON.stringify({blocked:blocked!==null,msg:String(blocked||"")}));
' "$REPO_ROOT")"
assert_eq "$(jq -r .blocked <<<"$LIFE_BLK")" "true" "lifecycle_error blocks committed result"
assert_contains "$(jq -r .msg <<<"$LIFE_BLK")" "lifecycle" "blocked reason names lifecycle"
FAULT_OUT="$(node - "$REPO_ROOT" "$SBX" <<'NODE'
'use strict';
const path=require('path');
const {AutopilotEngine}=require(path.join(process.argv[2],'src/engine/autopilot-engine'));
process.env.AUTOPILOT_FAULT_INJECT_LIFECYCLE='1';
const engine=new AutopilotEngine({
  cwd:process.argv[3],
  implementationDispatcher:()=>({
    status:0, signal:null, stdout:'', stderr:'', parseError:null, error:null,
    result:{status:'committed',commit:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      runner:'fixture',model:'fixture',branch:'feat/x',base:'develop',
      files_changed:1,insertions:1,deletions:0,worktree:null,agent_log:null,error:null},
  }),
});
let result;
try {
  result=engine.implementTask({
    promptFile:path.join(process.argv[2],'scripts/compaction-rehydrate.js'),
    branch:'feat/fault-life', base:'develop', cwd:process.argv[3],
    roster:{implementer_runner:'fixture',implementer_engine:'fixture',implementer_effort:'low'},
  });
} catch (e) {
  result={status:'threw',reason:e.message};
}
process.stdout.write(JSON.stringify({
  status:result.status, phase:result.phase||null,
  impl_status:(result.implementation&&result.implementation.status)||null,
  has_life:Boolean(result.implementationResult&&result.implementationResult.lifecycle_error),
}));
NODE
)"
assert_neq "$(jq -r .status <<<"$FAULT_OUT")" "committed" "fault inject lifecycle never returns committed"
assert_neq "$(jq -r .impl_status <<<"$FAULT_OUT")" "committed" "fault inject impl never committed"
TERM_SRC="$(grep -nE '_cont_terminal_on_exit \|\| true|_cont_finalize_or_die|refusing success JSON with nonterminal|_CONT_WO_CLAIMED_ROOT|_CONT_WO_PARENT_TRANSFERRED|transfer-owner' "$DH" || true)"
assert_contains "$TERM_SRC" "_cont_finalize_or_die" "inline/detach uses _cont_finalize_or_die"
assert_contains "$TERM_SRC" "refusing success JSON with nonterminal" "finalizer refuses success with nonterminal WO"
assert_eq "0" "$(printf '%s\n' "$TERM_SRC" | grep -c '_cont_terminal_on_exit || true' || true)" "terminal finalizer not swallowed"
assert_contains "$TERM_SRC" "_CONT_WO_PARENT_TRANSFERRED=1" "parent marks WO claim transferred to child"
assert_contains "$TERM_SRC" "transfer-owner" "detached_main transfers WO lease"
assert_contains "$(grep -n '_CONT_WO_CLAIMED_ROOT=""' "$DH" || true)" '_CONT_WO_CLAIMED_ROOT=""' "parent clears WO claim after detach"
BIND_OK="$(node - "$RH" "$SBX" "$REPO_ROOT" <<'NODE'
const {spawnSync,spawn}=require('child_process'),fs=require('fs'),path=require('path');
const wo=require(path.join(process.argv[4],'src/engine/work-order.js'));
const rh=process.argv[2],cwd=process.argv[3],cd=wo.resolveGitCommonDir(cwd);
const mk=(root,extra,opts)=>wo.createOrUpdateWorkOrder(cd,{root_run_id:root,graph_node:'implement',attempt:1,role:'implementer',
  next_action:'x',phase_cursor:'16/34',accepted_commit:'none',...extra},{bindArtifacts:false,preserveOwner:true,updateLifecycle:false,...opts});
const hb=(root,args)=>spawnSync(process.execPath,[rh,'heartbeat','--git-cwd',cwd,'--root-run-id',root,'--graph-node','implement','--attempt','1',...args],{encoding:'utf8'});
function term(root,st){const owner=wo.captureProcessIdentity(process.pid); const w=mk(root,{owner,paths:{}});
  const o=JSON.parse(hb(root,['--owner-pid',String(process.pid),'--runner','self','--terminal-status',st,'--disposition','consumed']).stdout||'{}');
  const live=JSON.parse(fs.readFileSync(w.path,'utf8')); const er=live.expected_receipt||{};
  const c=wo.classifyWorkOrder(live,{workOrderPath:w.path,skipBindCheck:true});
  return {hb:o.status,path:er.path||null,dig:er.digest||null,cls:c.classification,ok:c.success===true,file_ok:Boolean(er.path&&fs.existsSync(er.path))};}
const long=spawn('sleep',['30'],{stdio:'ignore'}),child=spawn('sleep',['30'],{stdio:'ignore'});
const op=long.pid,cp=child.pid,ledger=path.join(cd,'autopilot','lease-hb-ledger.jsonl');
fs.mkdirSync(path.dirname(ledger),{recursive:true}); fs.writeFileSync(ledger,JSON.stringify({e:'hb',ts:new Date().toISOString()})+'\n');
const w0=mk('root-lease-owner',{owner:wo.captureProcessIdentity(op),paths:{ledger}});
const live0=(()=>{hb('root-lease-owner',['--owner-pid',String(op),'--runner','self']); return JSON.parse(fs.readFileSync(w0.path,'utf8'));})();
const lease0=JSON.parse(fs.readFileSync(w0.path+'.lease','utf8'));
const c0=wo.classifyWorkOrder(live0,{workOrderPath:w0.path,skipBindCheck:true});
const xfer=JSON.parse(hb('root-lease-owner',['--owner-pid',String(cp),'--runner','self','--transfer-owner']).stdout||'{}');
const live1=JSON.parse(fs.readFileSync(w0.path,'utf8')),lease1=JSON.parse(fs.readFileSync(w0.path+'.lease','utf8'));
try{process.kill(op,'SIGKILL');}catch(_e){}
const c1=wo.classifyWorkOrder(live1,{workOrderPath:w0.path,skipBindCheck:true});
try{process.kill(cp,'SIGKILL');long.kill();child.kill();}catch(_e){}
process.stdout.write(JSON.stringify({ok:term('root-shell-term-bind','success'),fail:term('root-shell-term-fail-bind','failed'),
  lease:{cls:c0.classification,ok:live0.runner.pid===op&&lease0.pid===op&&c0.classification==='attach_active'},
  xfer:{st:xfer.status,ok:live1.owner.pid===cp&&live1.runner.pid===cp&&lease1.pid===cp&&c1.classification==='attach_active'}}));
NODE
)"
assert_eq "$(jq -r '[.ok.hb,.ok.file_ok,.ok.cls,.ok.ok,.fail.hb,.fail.cls,.fail.ok,.ok.dig!=null,.lease.ok,.xfer.st,.xfer.ok]|@tsv' <<<"$BIND_OK")" \
  $'written\ttrue\tconsume_terminal\ttrue\twritten\tconsume_terminal\tfalse\ttrue\ttrue\twritten\ttrue' \
  "terminal bind+classify + lease owner-pid + transfer-owner"

# Controller recovery: resource debt, high-water, postcompact adapter, orphan adoption.
CTRL_RECOVERY="$(node - "$REPO_ROOT" "$SBX" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const [root, repo] = process.argv.slice(2);
const ctrl = require(path.join(root, 'src/engine/controller-execution'));
const rehydrate = path.join(root, 'scripts/compaction-rehydrate.js');
const run = (args) => {
  const r = require('child_process').spawnSync(process.execPath, [rehydrate, ...args], {
    encoding: 'utf8',
    cwd: repo,
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
};

// Resource disposition matrix.
const clean = ctrl.classifyResourceOutcome({ dirty: false, unique: false, identity_known: true, clean: true, terminal: true });
const dirty = ctrl.classifyResourceOutcome({ dirty: true, identity_known: true });
const unique = ctrl.classifyResourceOutcome({ unique: true, dirty: false, identity_known: true, terminal: false });
const unknown = ctrl.classifyResourceOutcome({ identity_known: false });
const inferred = ctrl.classifyResourceOutcome({ dirty: false, unique: false }); // missing clean/identity
assert.strictEqual(clean.release, true);
assert.strictEqual(dirty.blocks_dispatch, true);
assert.strictEqual(unique.blocks_dispatch, true);
assert.strictEqual(unknown.blocks_dispatch, true);
assert.strictEqual(inferred.blocks_dispatch, true);

const cleanItem = {
  resource_id: 'wt-clean',
  worktree: '/tmp/clean',
  path: '/tmp/clean',
  clean: true,
  terminal: true,
  identity_known: true,
};
// Caller terminalConsumed on a nonexistent path is not authority (must-fix red).
assert.throws(() => ctrl.buildRecoveryReceipt({
  resourceId: cleanItem.resource_id,
  path: cleanItem.path,
  outcome: { clean: true, terminal: true, identity_known: true },
  evidenceKind: 'clean_release',
  terminalConsumed: true,
}), /terminal|receipt|path|mechanical/i);
// Debt still blocks when dirty + malformed remain open without a valid release receipt.
const debt = ctrl.buildResourceDebtState([
  cleanItem,
  { resource_id: 'wt-dirty', worktree: '/tmp/dirty', dirty: true, identity_known: true },
  { resource_id: 'wt-malformed', worktree: '/tmp/m', clean: true, terminal: true, identity_known: true, recovery_bundle_digest: 'not-a-digest' },
]);
assert.strictEqual(debt.blocks_dispatch, true);
assert.strictEqual(debt.released.length, 0);
assert.ok(debt.open.length >= 2);

// High-water: projected == limit is admitted; projected > limit creates zero effects.
const hwEq = run(['high-water', '--current-owned', '4', '--high-water', '4']);
assert.strictEqual(hwEq.status, 0);
assert.strictEqual(JSON.parse(hwEq.out).allow_checkout, true);
const hw = run(['high-water', '--current-owned', '5', '--high-water', '4']);
assert.strictEqual(hw.status, 1);
const hwBody = JSON.parse(hw.out);
assert.strictEqual(hwBody.allow_checkout, false);
assert.strictEqual(hwBody.worktree_effects, 0);
assert.strictEqual(hwBody.runner_effects, 0);

const debtBlock = run(['high-water', '--current-owned', '0', '--high-water', '4', '--unresolved-debt']);
assert.strictEqual(debtBlock.status, 1);
assert.strictEqual(JSON.parse(debtBlock.out).code, 'RESOURCE_DEBT_BLOCKS_DISPATCH');

// Orphan adoption: boolean flags alone never authorize.
const adoptBoolOnly = run([
  'adopt-orphan',
  '--controller-dead',
  '--base-ancestry-ok',
  '--scope-ok',
  '--churn-ok',
  '--leaf-committed',
  '--leaf-commit', 'b'.repeat(40),
]);
assert.notStrictEqual(adoptBoolOnly.status, 0);
assert.ok(
  (JSON.parse(adoptBoolOnly.out || '{}').code || '').includes('BOOLEAN')
  || (JSON.parse(adoptBoolOnly.out || '{}').reason_code || '').includes('BOOLEAN')
  || (JSON.parse(adoptBoolOnly.out || '{}').reason_code || '').includes('AUTHORITY')
  || (JSON.parse(adoptBoolOnly.out || '{}').reason || '').includes('boolean'),
);

// Mechanical adoption: dead controller owner + exact leaf on same WO (CAS).
const woMod = require(path.join(root, 'src/engine/work-order'));
const adoptDir = path.join(repo, '.adopt-case');
fs.mkdirSync(adoptDir, { recursive: true });
// Capture the exact production parentage shape while the controller is live,
// then kill it so adoption proves death against the persisted identity.
const orphanController = spawn(
  process.execPath,
  ['-e', 'setInterval(() => {}, 1000)'],
  { stdio: 'ignore' },
);
const productionParentage = woMod.captureProcessParentage(orphanController.pid);
const deadOwner = productionParentage.owner;
assert.ok(woMod.isCompleteIdentity(deadOwner));
assert.ok(productionParentage.relationships.length > 0);
process.kill(orphanController.pid, 'SIGKILL');
orphanController.unref();
const deathWait = new Int32Array(new SharedArrayBuffer(4));
for (let attempt = 0; attempt < 100 && woMod.isProcessLive(deadOwner); attempt += 1) {
  Atomics.wait(deathWait, 0, 0, 10);
}
assert.strictEqual(woMod.isProcessLive(deadOwner), false);
const adoptFrozen = ctrl.buildFrozenDenominator({
  projectId: 'adopt-camp',
  graphDigest: 'a'.repeat(64),
  deliverableIds: ['n1'],
});
const ctrlState = ctrl.emptyControllerState({
  frozen_denominator: adoptFrozen,
  process_parentage: productionParentage,
});
const baseSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// Create a leaf commit on a branch.
execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'orphan-leaf']);
fs.writeFileSync(path.join(repo, 'orphan-leaf.txt'), 'leaf\n');
execFileSync('git', ['-C', repo, 'add', 'orphan-leaf.txt']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'orphan leaf']);
const leafTip = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const common = woMod.resolveGitCommonDir(repo);
const writtenWo = woMod.createOrUpdateWorkOrder(common, {
  root_run_id: 'adopt-root',
  graph_node: 'n1',
  attempt: 1,
  role: 'controller',
  next_action: 'continue',
  branch: 'orphan-leaf',
  base_sha: baseSha,
  worktree: repo,
  owner: deadOwner,
  paths: { checkpoint: path.join(adoptDir, 'cp.json') },
  sealed_scope: {
    allow_paths: ['orphan-leaf.txt'],
    max_files: 1,
    max_diff_lines: 2,
  },
  controller: ctrlState,
}, { bindArtifacts: false, updateLifecycle: false });
assert.strictEqual(writtenWo.status, 'written');
// Force dead owner onto the WO body (create may overwrite owner with live process).
{
  const live = JSON.parse(fs.readFileSync(writtenWo.path, 'utf8'));
  live.owner = deadOwner;
  live.digest = woMod.workOrderDigest(live);
  fs.writeFileSync(writtenWo.path, `${JSON.stringify(live, null, 2)}\n`);
}
const leafPath = path.join(adoptDir, 'leaf.json');
{
  // Mechanical adoption requires recomputeable leaf digest + real worktree path.
  const leafBody = {
    committed: true,
    commit: leafTip,
    worktree: repo,
  };
  const leafDigest = ctrl.sha256Json(leafBody);
  fs.writeFileSync(leafPath, JSON.stringify({ ...leafBody, digest: leafDigest }));
}
const adoptOk = run([
  'adopt-orphan',
  '--git-cwd', repo,
  '--work-order-path', writtenWo.path,
  '--leaf-result', leafPath,
  '--branch', 'orphan-leaf',
  '--base-sha', baseSha,
]);
assert.strictEqual(adoptOk.status, 0, adoptOk.err || adoptOk.out);
const adoptBody = JSON.parse(adoptOk.out);
assert.strictEqual(adoptBody.duplicate_mutation, 0);
assert.strictEqual(adoptBody.work_order_id, writtenWo.work_order.work_order_id
  || JSON.parse(fs.readFileSync(writtenWo.path, 'utf8')).work_order_id);
const genAfter = adoptBody.generation;
assert.ok(Number.isSafeInteger(genAfter) && genAfter >= 1);

// Second adoption of same WO is blocked (adoption_receipts already present).
const adoptDup = run([
  'adopt-orphan',
  '--git-cwd', repo,
  '--work-order-path', writtenWo.path,
  '--leaf-result', leafPath,
  '--branch', 'orphan-leaf',
  '--base-sha', baseSha,
]);
assert.strictEqual(adoptDup.status, 1);
assert.strictEqual(JSON.parse(adoptDup.out).code, 'ADOPTION_ALREADY_CONSUMED');

// Boolean flags alone still fail even with git-cwd if WO missing.
const adoptAmb = run([
  'adopt-orphan',
  '--controller-dead',
  '--base-ancestry-ok',
  '--git-cwd', repo,
]);
assert.strictEqual(adoptAmb.status, 1);

// PostCompact adapter is hook-ready but does not claim production wiring.
const rootRun = `root-ctrl-${Date.now()}`;
const invPath = path.join(repo, '.ctrl-inventory.json');
fs.writeFileSync(invPath, JSON.stringify([
  { resource_id: 'open-debt', dirty: true, worktree: '/tmp/open' },
]));
const adapter = run([
  'postcompact-adapter',
  '--git-cwd', repo,
  '--root-run-id', rootRun,
  '--graph-node', 'controller',
  '--attempt', '1',
  '--inventory', invPath,
]);
// No controller Work Order exists for this exact root tuple, so production
// recovery must reject before caller-supplied inventory can act as authority.
const adapterBody = JSON.parse(adapter.out || '{}');
assert.strictEqual(adapter.status, 1);
assert.strictEqual(adapterBody.production_hook_wired, false);
assert.strictEqual(adapterBody.status, 'reject');
assert.strictEqual(adapterBody.reason_code, 'controller_work_order_missing');
assert.strictEqual(adapterBody.receipt, undefined);

// Progress receipt replay: 16/34 remains 16/34.
const frozen = ctrl.buildFrozenDenominator({
  projectId: 'p',
  graphDigest: 'e'.repeat(64),
  deliverableIds: Array.from({ length: 34 }, (_, i) => `d${i}`),
});
const completed = Array.from({ length: 16 }, (_, i) => `d${i}`);
const receipt = ctrl.buildProgressReceipt({
  frozenDenominator: frozen,
  completedDeliverables: completed,
  generation: 2,
  activeProcess: { pid: 1 },
});
assert.strictEqual(receipt.completed_deliverables.length, 16);
assert.strictEqual(receipt.remaining_deliverables.length, 18);
const receipt2 = ctrl.buildProgressReceipt({
  frozenDenominator: frozen,
  completedDeliverables: completed,
  generation: 2,
  activeProcess: { pid: 1 },
});
assert.strictEqual(receipt.completed_deliverables.length, receipt2.completed_deliverables.length);

console.log(JSON.stringify({
  resource_disposition_matrix: true,
  high_water_zero_effects: true,
  orphan_adoption: true,
  postcompact_adapter_ready: true,
  progress_16_of_34: true,
}));
NODE
)"
assert_exit_code "$?" "0" "controller recovery matrix exits zero"
assert_contains "$CTRL_RECOVERY" '"resource_disposition_matrix":true' "resource dispositions"
assert_contains "$CTRL_RECOVERY" '"high_water_zero_effects":true' "high-water zero effects"
assert_contains "$CTRL_RECOVERY" '"orphan_adoption":true' "orphan adoption"
assert_contains "$CTRL_RECOVERY" '"postcompact_adapter_ready":true' "postcompact adapter"
assert_contains "$CTRL_RECOVERY" '"progress_16_of_34":true' "progress 16/34 stable"

finalize_test
