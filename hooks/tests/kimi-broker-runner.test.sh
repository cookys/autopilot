#!/usr/bin/env bash
# suite-timeout-secs: 240
# Hermetic broker transport + dispatch commit + observed-quota integration.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH
export HOME="$TEST_TMP/home" AUTOPILOT_LIVE_DIR="$TEST_TMP/live"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session"
export AUTOPILOT_PACE_FILE="$TEST_TMP/pace.json" AUTOPILOT_QUALIFIED_FILE="$TEST_TMP/missing-qualified.json"
export AUTOPILOT_KIMI_BROKER_WORK_ROOT="$TEST_TMP/shared" AUTOPILOT_KIMI_BROKER_SOCK="$TEST_SHORT_TMP/broker.sock"
export AUTOPILOT_KIMI_GROUP_WRAPPER="$TEST_TMP/group-wrapper" DISPATCH_DETACH=0
export AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 AUTOPILOT_TASK_SIZE=S AUTOPILOT_TASK_SCOPE=docs/example.md
mkdir -p "$HOME" "$AUTOPILOT_KIMI_BROKER_WORK_ROOT" "$AUTOPILOT_SESSION_MODE_DIR" "$TEST_TMP/bin" "$TEST_TMP/repo/.claude"
printf '#!/usr/bin/env bash\n[ "$1" = lanegit ] && [ "$2" = -c ] || exit 99\nprintf "group\\n" >> "$AUTOPILOT_KIMI_BROKER_WORK_ROOT/../group-calls"\nexec bash -c "$3"\n' > "$AUTOPILOT_KIMI_GROUP_WRAPPER"
# A reverted local rail cannot touch a real CLI or login.
printf '#!/usr/bin/env bash\nexit 99\n' > "$TEST_TMP/bin/kimi"
chmod +x "$AUTOPILOT_KIMI_GROUP_WRAPPER" "$TEST_TMP/bin/kimi"
export PATH="$TEST_TMP/bin:$PATH"
SBX="$TEST_TMP/repo"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.name=test -c user.email=t@t commit -q --allow-empty -m base
printf 'scaffold_tiers: off\n' > "$SBX/.claude/dispatch-config.md"
printf 'Create broker-created.txt.\n' > "$TEST_TMP/prompt"
printf 'done' > "$TEST_TMP/verdict"
: > "$TEST_TMP/connections"
export AUTOPILOT_TEST_CN_GATE_OFF=0
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
    socket.end(JSON.stringify(response) + '\n');
  });
});
server.listen(process.env.AUTOPILOT_KIMI_BROKER_SOCK, () => fs.writeFileSync(path.join(root, 'ready'), 'ready'));
NODE
node "$TEST_TMP/server.js" "$TEST_TMP" > "$TEST_TMP/server.log" 2>&1 &
BROKER_PID=$!
trap 'kill "$BROKER_PID" 2>/dev/null || true; wait "$BROKER_PID" 2>/dev/null || true; cleanup_test_tmp' EXIT
for ((i=0;i<100;i++)); do [ ! -f "$TEST_TMP/ready" ] || break; sleep 0.02; done
assert_file_exists "$TEST_TMP/ready" 'stub broker listening'
SCRIPT="${KIMI_BROKER_DISPATCH_SCRIPT:-$REPO_ROOT/scripts/dispatch-hetero.sh}"
run_dispatch() {
  local label="$1"; shift
  (cd "$SBX" && bash "$SCRIPT" --no-campaign --no-verify-tip --context-window off \
    --branch "broker-$label" --base develop --timeout 60s --prompt-file "$TEST_TMP/prompt" "$@") \
    > "$TEST_TMP/$label.json" 2> "$TEST_TMP/$label.stderr"
  DISPATCH_RC=$?
}
case_enabled() { [ "${KIMI_BROKER_TEST_CASE:-all}" = all ] || [ "$KIMI_BROKER_TEST_CASE" = "$1" ]; }
if case_enabled a; then
  run_dispatch a --runner kimi
  assert_eq "$DISPATCH_RC" 0 '(a) kimi broker dispatch exits 0'
  if [ "$DISPATCH_RC" -ne 0 ]; then cat "$TEST_TMP/a.stderr" "$TEST_TMP/a.json"; fi
  node - "$TEST_TMP" <<'NODE'
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto'),cp=require('child_process');
const root=process.argv[2], result=JSON.parse(fs.readFileSync(path.join(root,'a.json'),'utf8'));
assert.equal(result.status,'committed'); assert.equal(result.model,'kimi-code/kimi-for-coding');
const req=JSON.parse(fs.readFileSync(path.join(root,'requests'),'utf8').trim().split('\n')[0]);
assert.deepEqual(Object.keys(req).sort(),['model','prompt','timeout_s','worktree']);
assert.equal(req.model,'kimi-code/kimi-for-coding'); assert.equal(req.timeout_s,60);
assert.equal(req.worktree,path.join(root,'shared',result.run_id));
assert.match(req.prompt,/^=== HARNESS DIRECTIVE/); assert.match(req.prompt,/Do NOT\ngit commit/);
assert.equal(result.broker_run_id,'broker-fixture-done');
assert.equal(result.broker_diff_sha16,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'diff'))).digest('hex').slice(0,16));
assert.equal(fs.existsSync(req.worktree),false);
const meta=JSON.parse(fs.readFileSync(path.join(root,'clone-meta')));
assert.equal(meta.standalone,true); assert.equal(meta.shared,'group'); assert.equal(meta.mode & 0o020,0o020); assert.equal(meta.index_mode & 0o020,0o020);
const git=(...args)=>cp.execFileSync('git',['-C',path.join(root,'repo'),...args],{encoding:'utf8'}).trim();
assert.equal(git('show','broker-a:broker-created.txt'),'hello');
assert.match(git('log','-1','--format=%s','broker-a'),/dispatch-hetero\(kimi\)/);
const response=JSON.parse(fs.readFileSync(result.agent_log+'.kimi-broker.json'));
assert.deepEqual(Object.keys(response).sort(),['diff','log','reason','run_id','verdict']);
assert.match(fs.readFileSync(path.join(root,'group-calls'),'utf8'),/group/);
console.log('PASS (a) request, shared standalone clone, patch commit, broker metadata, cleanup');
NODE
  assert_eq "$?" 0 '(a) broker artifacts verified'
fi
if case_enabled b; then
  printf stopped_billing > "$TEST_TMP/verdict"
  run_dispatch b --runner kimi
  assert_eq "$DISPATCH_RC" 1 '(b) billing stop exits 1'
  node - "$TEST_TMP/b.json" "$REPO_ROOT" <<'NODE'
const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(r.status,'failed'); assert.equal(r.reason,'kimi_stopped_billing'); assert.equal(r.error,'kimi_stopped_billing');
assert.equal(r.commit,null);
const q=require(path.join(process.argv[3],'scripts/lib/kimi-quota-observe'));
assert.equal(q.exhaustedKimi(), true);
assert.equal(fs.existsSync(path.join(process.env.AUTOPILOT_KIMI_BROKER_WORK_ROOT,r.run_id)),false);
console.log('PASS (b) billing stop marks Kimi exhausted');
NODE
  assert_eq "$?" 0 '(b) billing quota observation verified'
  printf done > "$TEST_TMP/verdict"
fi
if case_enabled c; then
  BEFORE="$(wc -l < "$TEST_TMP/connections" 2>/dev/null || echo 0)"
  run_dispatch c --runner kimi --model gpt-5.5
  assert_eq "$DISPATCH_RC" 2 '(c) non-composer is precondition failure'
  assert_contains "$(cat "$TEST_TMP/c.json")" precondition_failed '(c) result status'
  assert_contains "$(cat "$TEST_TMP/c.json")" 'requires a matching model' '(c) clear model error'
  AFTER="$(wc -l < "$TEST_TMP/connections" 2>/dev/null || echo 0)"
  assert_eq "$BEFORE" "$AFTER" '(c) no socket connection'
  AUTOPILOT_KIMI_BROKER_MODEL_PATTERN='[' run_dispatch c-invalid --runner kimi
  assert_eq "$DISPATCH_RC" 2 '(c) invalid configured model pattern is a precondition failure'
  assert_eq "$BEFORE" "$(wc -l < "$TEST_TMP/connections")" '(c) invalid pattern makes no connection'
  AUTOPILOT_KIMI_BROKER_MODEL_PATTERN='^deployment-model$' node -e 'require(process.argv[1]).validateModel("deployment-model", "kimi")' "$REPO_ROOT/scripts/lib/cursor-broker-client.js"
  assert_eq "$?" 0 '(c) configured model pattern replaces deployment grammar'
fi
if case_enabled d; then
  BEFORE="$(wc -l < "$TEST_TMP/connections")"
  for gate in transcript sensitive core novel review; do
    case "$gate" in
      transcript) AUTOPILOT_TASK_READS_TRANSCRIPT=1 run_dispatch "d-$gate" --runner kimi ;;
      sensitive) AUTOPILOT_TASK_SCOPE=secrets/example.txt run_dispatch "d-$gate" --runner kimi ;;
      core) AUTOPILOT_TASK_SIZE=L run_dispatch "d-$gate" --runner kimi ;;
      novel) AUTOPILOT_TASK_NOVEL=1 run_dispatch "d-$gate" --runner kimi ;;
      review) AUTOPILOT_TASK_ROLE=reviewer run_dispatch "d-$gate" --runner kimi ;;
    esac
    assert_eq "$DISPATCH_RC" 2 "(d) $gate gate refuses before dispatch"
    assert_contains "$(cat "$TEST_TMP/d-$gate.json")" cn_model_dispatch_barred "(d) $gate refusal reason"
  done
  AFTER="$(wc -l < "$TEST_TMP/connections")"
  assert_eq "$BEFORE" "$AFTER" '(d) gated prompts make no socket connection'
fi
if case_enabled e; then
  node - "$REPO_ROOT" "$TEST_TMP" <<'AVAIL'
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process'),Module=require('module');
const repo=process.argv[2],root=process.argv[3];
const broker=require(path.join(repo,'scripts/lib/cursor-broker-client'));
const q=require(path.join(repo,'scripts/lib/kimi-quota-observe'));
const pace=require(path.join(repo,'scripts/pace-select'));
const readiness=require(path.join(repo,'src/readiness/probe'));
// Exercise the real private admission functions, preserving their module-relative imports.
function admission(file, names) {
  const filename=path.join(repo,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod._compile(fs.readFileSync(filename,'utf8').replace(/\nmain\(\);\s*$/, '')+'\nmodule.exports={'+names.join(',')+'};',filename);
  return mod.exports;
}
const topology=admission('scripts/resolve-dispatch-topology.js',['getInstalledRunners']);
const jury=admission('scripts/review-jury.js',['runnerFound']);
const fake=path.join(process.env.HOME,'.kimi-code/bin/kimi');
fs.mkdirSync(path.dirname(fake),{recursive:true});fs.writeFileSync(fake,'#!/bin/sh\necho invoked >> "'+path.join(root,'local-kimi-invocations')+'"\nexit 99\n',{mode:0o755});
const now=new Date(),data={schema:'capacity.pace/1',generated_at:now.toISOString(),rows:[{
 pool:'kimi',class:'other',status:'ok',stale:false,used_pct:20,expected_pct:40,hours_to_reset:12,reset_at:new Date(+now+43200000).toISOString()
}]};
fs.writeFileSync(process.env.AUTOPILOT_PACE_FILE,JSON.stringify(data));
const select=()=>pace.selectEngine({pace:data,role:'implementer',checkEndpoint:()=>true,env:process.env});
const original=process.env.AUTOPILOT_KIMI_BROKER_SOCK;
function check(expected) {
 assert.equal(broker.brokerAvailable('kimi'),expected);
 assert.equal(jury.runnerFound({bin:'kimi'}),expected);
 assert.equal(Boolean(topology.getInstalledRunners(repo).kimi),expected);
 assert.equal(readiness.probeSafeSurface({tuple:{runner:'kimi',endpoint:null}}).status,expected?'ready':'blocked');
 assert.equal(select().engine==='kimi',expected);
 const out=cp.execFileSync('bash',[path.join(repo,'scripts/probe-engine-capability.sh'),'quota','--runner','kimi','--model','kimi-code/kimi-for-coding','--safe','--store',path.join(root,expected?'safe-ready':'safe-blocked')],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const event=JSON.parse(out);
 assert.equal(event.runner,'kimi');assert.equal(event.runner_version,null);
 assert.equal(event.capability.quota.status,'unknown');
 assert.equal(event.capability.quota.confidence,expected?'medium':'low');
 assert.equal(event.capability.quota.evidence.includes('Kimi broker socket present'),expected);
}
q.observe({verdict:'done'});
process.env.AUTOPILOT_KIMI_BROKER_SOCK=path.join(root,'missing.sock');check(false);
// A normal file at the socket path is unavailable too.
fs.writeFileSync(process.env.AUTOPILOT_KIMI_BROKER_SOCK,'fixture');check(false);
process.env.AUTOPILOT_KIMI_BROKER_SOCK=original;check(true);
process.env.AUTOPILOT_KIMI_BROKER_MODEL_PATTERN='[';check(false);
delete process.env.AUTOPILOT_KIMI_BROKER_MODEL_PATTERN;check(true);
q.observe({verdict:'stopped_billing'});check(false);
q.observe({verdict:'done',text:'old rate limit text'});check(true);
assert.equal(fs.existsSync(path.join(root,'local-kimi-invocations')),false);
console.log('PASS (e) socket/quota availability in pace, topology, jury, readiness and safe capacity probe; local fake login never executed');
AVAIL
  assert_eq "$?" 0 '(e) all automatic availability callers use broker'
  run_dispatch e --runner auto
  assert_eq "$DISPATCH_RC" 0 '(e) auto dispatch can select available Kimi broker'
  assert_contains "$(cat "$TEST_TMP/e.json")" '"runner": "kimi"' '(e) auto result uses kimi'
fi
if case_enabled f; then
  printf 'Create broker-created.txt.\n' > "$TEST_TMP/prompt"
  for verdict in rejected agent_failed timeout; do
    printf '%s' "$verdict" > "$TEST_TMP/verdict"
    run_dispatch "f-$verdict" --runner kimi
    assert_eq "$DISPATCH_RC" 1 "(f) $verdict exits 1"
    node - "$TEST_TMP/f-$verdict.json" "$verdict" <<'NODE'
const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const r=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),v=process.argv[3];
assert.equal(r.status,v==='timeout'?'failure':'failed');
assert.equal(r.reason,'fixture '+v); assert.equal(r.commit,null);
assert.equal(r.timed_out,v==='timeout');
assert.equal(fs.existsSync(path.join(process.env.AUTOPILOT_KIMI_BROKER_WORK_ROOT,r.run_id)),false);
NODE
    assert_eq "$?" 0 "(f) $verdict mapping and cleanup"
  done
fi
if case_enabled g; then
  BEFORE="$(wc -l < "$TEST_TMP/connections")"
  node - "$TEST_TMP/prompt" <<'LARGE'
require('fs').writeFileSync(process.argv[2], 'x'.repeat(65537));
LARGE
  run_dispatch g --runner kimi
  assert_eq "$DISPATCH_RC" 2 '(g) broker prompt over 64 KiB refused locally'
  assert_contains "$(cat "$TEST_TMP/g.json")" '64 KiB' '(g) broker byte ceiling'
  assert_eq "$BEFORE" "$(wc -l < "$TEST_TMP/connections")" '(g) oversized prompt makes no connection'
fi
finalize_test
