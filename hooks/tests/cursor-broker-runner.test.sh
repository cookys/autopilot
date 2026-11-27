#!/usr/bin/env bash
# suite-timeout-secs: 240
# Hermetic broker transport + dispatch commit + observed-quota integration.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH
export HOME="$TEST_TMP/home" AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session"
export AUTOPILOT_PACE_FILE="$TEST_TMP/pace.json" AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_CURSOR_WORK_ROOT="$TEST_TMP/shared" AUTOPILOT_CURSOR_BROKER_SOCK="$TEST_SHORT_TMP/broker.sock" AUTOPILOT_CURSOR_BROKER_AUDIT="$TEST_TMP/missing-audit.tsv"
export AUTOPILOT_CURSOR_GROUP_WRAPPER="$TEST_TMP/group-wrapper" DISPATCH_DETACH=0
export AUTOPILOT_TMP_LOG_RETENTION_DAYS=0
mkdir -p "$HOME" "$AUTOPILOT_CURSOR_WORK_ROOT" "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$TEST_TMP/repo/.claude"
printf '#!/usr/bin/env bash\n[ "$1" = lanegit ] && [ "$2" = -c ] || exit 99\nprintf "group\\n" >> "$AUTOPILOT_CURSOR_WORK_ROOT/../group-calls"\nexec bash -c "$3"\n' > "$AUTOPILOT_CURSOR_GROUP_WRAPPER"
# A reverted local rail cannot touch a real CLI or login.
printf '#!/usr/bin/env bash\nexit 99\n' > "$TEST_TMP/bin/cursor-agent"
chmod +x "$AUTOPILOT_CURSOR_GROUP_WRAPPER" "$TEST_TMP/bin/cursor-agent"
export PATH="$TEST_TMP/bin:$PATH"
SBX="$TEST_TMP/repo"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.name=test -c user.email=t@t commit -q --allow-empty -m base
printf 'scaffold_tiers: off\n' > "$SBX/.claude/dispatch-config.md"
printf 'Create broker-created.txt.\n' > "$TEST_TMP/prompt"
printf 'done' > "$TEST_TMP/verdict"
cat > "$TEST_TMP/server.js" <<'NODE'
const fs = require('fs'), net = require('net'), path = require('path'), cp = require('child_process');
const root = process.argv[2];
const diff = 'diff --git a/broker-created.txt b/broker-created.txt\nnew file mode 100644\nindex 0000000..ce01362\n--- /dev/null\n+++ b/broker-created.txt\n@@ -0,0 +1 @@\n+hello\n';
fs.writeFileSync(path.join(root, 'diff'), diff);
const server = net.createServer(socket => {
  fs.appendFileSync(path.join(root, 'connections'), 'connected\n');
  let text = '';
  socket.on('data', chunk => {
    text += chunk;
    if (!text.includes('\n')) return;
    const req = JSON.parse(text.slice(0, text.indexOf('\n')));
    const keys = Object.keys(req).sort().join(',');
    if (keys !== 'model,prompt,timeout_s,worktree') throw Error('unexpected request keys: ' + keys);
    fs.appendFileSync(path.join(root, 'requests'), JSON.stringify(req) + '\n');
    const stat = fs.statSync(req.worktree);
    const meta = { standalone: fs.statSync(path.join(req.worktree, '.git')).isDirectory(), mode: stat.mode & 0o777,
      shared: cp.execFileSync('git', ['-C', req.worktree, 'config', 'core.sharedRepository'], {encoding:'utf8'}).trim(),
      index_mode: fs.statSync(path.join(req.worktree, '.git/index')).mode & 0o777 };
    fs.writeFileSync(path.join(root, 'clone-meta'), JSON.stringify(meta));
    const verdict = fs.readFileSync(path.join(root, 'verdict'), 'utf8');
    const response = {ok: verdict === 'done', verdict, reason: 'fixture ' + verdict, rc: verdict === 'done' ? 0 : 9,
      diff, log:'fixture broker log\n', redactions: 71234, run_id: 'broker-fixture-' + verdict};
    if (verdict === 'stopped_billing') { response.billing_confirmed = true; response.billing_line = 'masked-fixture'; }
    socket.end(JSON.stringify(response) + '\n');
  });
});
server.listen(process.env.AUTOPILOT_CURSOR_BROKER_SOCK, () => fs.writeFileSync(path.join(root, 'ready'), 'ready'));
NODE
node "$TEST_TMP/server.js" "$TEST_TMP" > "$TEST_TMP/server.log" 2>&1 &
BROKER_PID=$!
trap 'kill "$BROKER_PID" 2>/dev/null || true; wait "$BROKER_PID" 2>/dev/null || true; cleanup_test_tmp' EXIT
for ((i=0;i<100;i++)); do [ ! -f "$TEST_TMP/ready" ] || break; sleep 0.02; done
assert_file_exists "$TEST_TMP/ready" 'stub broker listening'
SCRIPT="${CURSOR_BROKER_DISPATCH_SCRIPT:-$REPO_ROOT/scripts/dispatch-hetero.sh}"
run_dispatch() {
  local label="$1"; shift
  (cd "$SBX" && bash "$SCRIPT" --no-campaign --no-verify-tip --context-window off \
    --branch "broker-$label" --base develop --timeout 60s --prompt-file "$TEST_TMP/prompt" "$@") \
    > "$TEST_TMP/$label.json" 2> "$TEST_TMP/$label.stderr"
  DISPATCH_RC=$?
}
case_enabled() { [ "${CURSOR_BROKER_TEST_CASE:-all}" = all ] || [ "$CURSOR_BROKER_TEST_CASE" = "$1" ]; }
if case_enabled a; then
  run_dispatch a --runner cursor
  assert_eq "$DISPATCH_RC" 0 '(a) cursor broker dispatch exits 0'
  if [ "$DISPATCH_RC" -ne 0 ]; then cat "$TEST_TMP/a.stderr" "$TEST_TMP/a.json"; fi
  node - "$TEST_TMP" <<'NODE'
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),cp=require('child_process');
const root=process.argv[2], result=JSON.parse(fs.readFileSync(path.join(root,'a.json'),'utf8'));
assert.equal(result.status,'committed'); assert.equal(result.model,'composer-2.5');
const req=JSON.parse(fs.readFileSync(path.join(root,'requests'),'utf8').trim().split('\n')[0]);
assert.deepEqual(Object.keys(req).sort(),['model','prompt','timeout_s','worktree']);
assert.equal(req.model,'composer-2.5'); assert.equal(req.timeout_s,60);
assert.equal(req.worktree,path.join(root,'shared',result.run_id));
assert.match(req.prompt,/^=== HARNESS DIRECTIVE/); assert.match(req.prompt,/Do NOT\ngit commit/);
assert.equal(result.broker_run_id,'broker-fixture-done');
assert.equal(result.broker_diff_sha16,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'diff'))).digest('hex').slice(0,16));
assert.equal(fs.existsSync(req.worktree),false);
const meta=JSON.parse(fs.readFileSync(path.join(root,'clone-meta')));
assert.equal(meta.standalone,true); assert.equal(meta.shared,'group'); assert.equal(meta.mode & 0o020,0o020); assert.equal(meta.index_mode & 0o020,0o020);
const git=(...args)=>cp.execFileSync('git',['-C',path.join(root,'repo'),...args],{encoding:'utf8'}).trim();
assert.equal(git('show','broker-a:broker-created.txt'),'hello');
assert.match(git('log','-1','--format=%s','broker-a'),/dispatch-hetero\(cursor\)/);
const response=JSON.parse(fs.readFileSync(result.agent_log+'.cursor-broker.json'));
assert.deepEqual(Object.keys(response).sort(),['billing_confirmed','billing_line','diff','log','reason','run_id','verdict']);
assert.match(fs.readFileSync(path.join(root,'group-calls'),'utf8'),/group/);
console.log('PASS (a) request, shared standalone clone, patch commit, broker metadata, cleanup');
NODE
  assert_eq "$?" 0 '(a) broker artifacts verified'
fi
if case_enabled b; then
  printf stopped_billing > "$TEST_TMP/verdict"
  run_dispatch b --runner cursor
  assert_eq "$DISPATCH_RC" 1 '(b) billing stop exits 1'
  node - "$TEST_TMP/b.json" "$REPO_ROOT" <<'NODE'
const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(r.status,'failed'); assert.equal(r.reason,'cursor_stopped_billing'); assert.equal(r.error,'cursor_stopped_billing');
assert.equal(r.commit,null);
const q=require(path.join(process.argv[3],'scripts/lib/cursor-quota-observe'));
assert.equal(q.cursorState(), 'exhausted');
assert.equal(fs.existsSync(path.join(process.env.AUTOPILOT_CURSOR_WORK_ROOT,r.run_id)),false);
console.log('PASS (b) billing stop marks Cursor exhausted');
NODE
  assert_eq "$?" 0 '(b) billing quota observation verified'
  printf done > "$TEST_TMP/verdict"
fi
if case_enabled c; then
  BEFORE="$(wc -l < "$TEST_TMP/connections" 2>/dev/null || echo 0)"
  run_dispatch c --runner cursor --model gpt-5.5
  assert_eq "$DISPATCH_RC" 2 '(c) non-composer is precondition failure'
  assert_contains "$(cat "$TEST_TMP/c.json")" precondition_failed '(c) result status'
  assert_contains "$(cat "$TEST_TMP/c.json")" 'requires a composer model' '(c) clear model error'
  AFTER="$(wc -l < "$TEST_TMP/connections" 2>/dev/null || echo 0)"
  assert_eq "$BEFORE" "$AFTER" '(c) no socket connection'
fi
if case_enabled d; then
  node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const repo=process.argv[2],root=process.argv[3],q=require(path.join(repo,'scripts/lib/cursor-quota-observe'));
const pace=require(path.join(repo,'scripts/pace-select'));
const pools=pace.mergePools(pace.loadPools(),pace.loadRoles());
const now=new Date(), data={schema:'capacity.pace/1',generated_at:now.toISOString(),rows:Object.keys(pools).filter(p=>p!=='cursor').map(pool=>({
  pool,class:'other',status:'ok',stale:false,used_pct:99,expected_pct:40,hours_to_reset:12,reset_at:new Date(+now+43200000).toISOString()
}))};
fs.writeFileSync(process.env.AUTOPILOT_PACE_FILE,JSON.stringify(data));
const select=role=>pace.selectEngine({pace:data,role,checkEndpoint:()=>true,env:process.env});
q.observe({verdict:'done'});
assert.equal(q.cursorState(),'available'); assert.equal(select('implementer').engine,'cursor');
assert.notEqual(select('reviewer').engine,'cursor'); assert.notEqual(select('author').engine,'cursor');
q.observe({verdict:'stopped_billing', billing_confirmed:true});
assert.equal(q.cursorState(),'exhausted'); assert.notEqual(select('implementer').engine,'cursor');
assert.equal(q.cursorState({now:Date.now()+q.RECHECK_S*1000+2000}),'available');
q.observe({verdict:'done'});
const measured={...data,rows:[{pool:'grok-cli',class:'other',status:'ok',stale:false,used_pct:20,expected_pct:40,hours_to_reset:12}]};
assert.equal(pace.selectEngine({pace:measured,role:'implementer',checkEndpoint:()=>true}).engine,'grok');
console.log('PASS (d) observed Cursor fallback; exhaustion blocks; recheck expires; clean done clears; implementer only');
NODE
  assert_eq "$?" 0 '(d) pace availability and exhaustion verified'
  run_dispatch d --runner auto
  # PM ruling 2026-11-27: an unpinned auto dispatch picks only among the seats the documented policy lists; Cursor is pin-only.
  assert_not_contains "$(cat "$TEST_TMP/d.json" 2>/dev/null)" '"runner": "cursor"' '(d) auto dispatch never selects Cursor'
fi
if case_enabled e; then
  BEFORE="$(wc -l < "$TEST_TMP/connections" 2>/dev/null || echo 0)"
  node - "$TEST_TMP/prompt" <<'NODE'
require('fs').writeFileSync(process.argv[2],'x'.repeat(65537));
NODE
  run_dispatch e --runner cursor
  assert_eq "$DISPATCH_RC" 2 '(e) large dispatch prompt is precondition failure'
  assert_contains "$(cat "$TEST_TMP/e.json")" precondition_failed '(e) result status'
  assert_contains "$(cat "$TEST_TMP/e.json")" '64 KiB' '(e) clear byte limit error'
  node "$REPO_ROOT/scripts/lib/cursor-broker-client.js" --socket "$AUTOPILOT_CURSOR_BROKER_SOCK" \
    --worktree "$SBX" --prompt-file "$TEST_TMP/prompt" --model composer-2.5 --timeout-s 60 --out "$TEST_TMP/large-client.json" \
    > "$TEST_TMP/client.stdout" 2> "$TEST_TMP/client.stderr"
  assert_eq "$?" 2 '(e) client also refuses oversized prompt locally'
  AFTER="$(wc -l < "$TEST_TMP/connections" 2>/dev/null || echo 0)"
  assert_eq "$BEFORE" "$AFTER" '(e) no socket connection'
fi
if case_enabled f; then
  printf 'Create broker-created.txt.\n' > "$TEST_TMP/prompt"
  for verdict in rejected agent_failed timeout; do
    printf '%s' "$verdict" > "$TEST_TMP/verdict"
    run_dispatch "f-$verdict" --runner cursor
    assert_eq "$DISPATCH_RC" 1 "(f) $verdict exits 1"
    node - "$TEST_TMP/f-$verdict.json" "$verdict" <<'NODE'
const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),v=process.argv[3];
assert.equal(r.status,v==='timeout'?'failure':'failed');
assert.equal(r.reason,'fixture '+v); assert.equal(r.commit,null);
assert.equal(r.timed_out,v==='timeout');
assert.equal(fs.existsSync(path.join(process.env.AUTOPILOT_CURSOR_WORK_ROOT,r.run_id)),false);
NODE
    assert_eq "$?" 0 "(f) $verdict mapping and cleanup"
  done
fi
finalize_test
