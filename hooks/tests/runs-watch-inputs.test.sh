#!/usr/bin/env bash
# hooks/tests/runs-watch-inputs.test.sh — mods P1W WATCH-A: the watcher's own inputs reach the published model.json
# (planned W1g, decision W2a-m, compare W2e-m, sources manifest W1i, marker stage (P2b read side)) plus the
# scripts/open-decision.js helper (decision/1) and the pure modules behind them.
# Each item drives the real createWatcher (fake clock, real publish()) and asserts the published model.json field,
# the sources row, and one negative control (stale file, file of another root, file of another repo, file left after the end signal).
# RED at 8666aba4 (base: runs-watch.js passes decision/planned/compare = null/null/[]; no open-decision.js, no src/status/watch-inputs.js):
#   23 passed, 73 failed (e.g. FAIL planned (campaign): ...: expected '[{"id":"d1",...}]', got 'nomodel'/'null'; FAIL open writes a decision; FAIL manifest ... Cannot find module src/status/sources-manifest.js)
# PHASE-TASK addition (item 7 + units) RED at 15966420 (src/render without the task fallback): 118 passed, 24 failed (e.g. FAIL phase task: the task in progress reaches model.json: expected '{"code":"2",...}', got 'null'; units crash on taskPhase). GREEN: 142 assertions.
# Mutation controls (outputs in the run evidence dir, mut-*.txt): each guard below turns the suite red when broken.
# REPAIR-2 addition (host spellings) RED at b8d83789: 144 passed, 3 failed (extensionless require single+double quote not hosts; commented-out require counted as host).
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
NODE="$(command -v node)"
OD="$REPO_ROOT/scripts/open-decision.js"
SB="$TEST_TMP/rwi"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"; D="$SB/world"; REPO2="$SB/repo2"
AH="$FAKE_HOME/.autopilot"
mkdir -p "$AH/session-mode" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO" "$REPO2" "$D"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rwi-XXXXXX)"; chmod 700 "$LIVE"
cleanup_rwi() { rm -rf "$LIVE"; }
trap 'cleanup_rwi; [ -n "${KEEP:-}" ] || cleanup_test_tmp' EXIT
for r in "$REPO" "$REPO2"; do
  git -C "$r" init -q
  git -C "$r" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
done
sk() { (cd "$1" && node -e 'const s=require(process.argv[1]).scopeFromCwd(process.cwd());process.stdout.write(s[process.argv[2]])' "$REPO_ROOT/src/status/project-key.js" "$2"); }
KEY="$(sk "$REPO" project_key)"; IDENT="$(sk "$REPO" repo_identity)"; IDENT2="$(sk "$REPO2" repo_identity)"

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u AUTOPILOT_ROOT_RUN_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AH/session-mode" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" "$@"
}
cat > "$SB/task-bin.sh" <<SH
#!/bin/sh
cat "$D/task.json"
SH
chmod +x "$SB/task-bin.sh"
export AUTOPILOT_RENDER_TASK_STATUS_BIN="$SB/task-bin.sh"
export AUTOPILOT_REVIEW_RETAIN_MS=999999999

# ---- A. open-decision.js helper (decision/1) --------------------------------------------------------------
odo() { (cd "$REPO" && wenv "$NODE" "$OD" "$@" 2> "$SB/od.err" < /dev/null); }
COMMON="$REPO/.git"
odo open --question 'Q one?' --option 'A' --option 'B' --not-authorized 'DOA boundary' --context 'ctx' --root-run-id R1 > "$SB/od.out"; eq 0 "$?" "open writes a decision (stderr: $(head -c 200 "$SB/od.err"))"
F1="$COMMON/autopilot/decisions/${KEY}--R1.json"
assert_file_exists "$F1" "decision file at <git-common-dir>/autopilot/decisions/<project_key>--<root>.json"
eq 'autopilot.decision/1|Q one?|A,B|DOA boundary|R1|ctx' "$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write([v.schema,v.question,(v.options||[]).join(","),v.not_authorized,v.root_run_id,v.context].join("|"))' "$F1")" "decision/1 fields (question, options, not_authorized, root_run_id, context)"
eq "$IDENT|$KEY" "$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(v.repo_identity+"|"+v.project_key)' "$F1")" "decision carries repo_identity and project_key"
odo open --question 'Q two?' --root-run-id R1 > /dev/null; eq 3 "$?" "open refuses to overwrite an open question (exit 3)"
eq 'Q one?' "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).question)' "$F1")" "refused open left the file untouched"
odo open --question 'Q two?' --root-run-id R1 --replace > /dev/null; eq 0 "$?" "open --replace overwrites"
eq 'Q two?|null|null' "$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write([v.question,JSON.stringify(v.options),JSON.stringify(v.not_authorized)].join("|"))' "$F1")" "no --option -> options null; no --not-authorized -> null"
odo open --question 'Q3' --option only-one --root-run-id R1 --replace > /dev/null; eq 2 "$?" "a single --option is a usage error (exit 2)"
eq 'Q two?' "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).question)' "$F1")" "usage error left the file untouched"
odo open --root-run-id R1 --replace > /dev/null; eq 2 "$?" "open without --question is a usage error"
odo show --root-run-id R1 --json > "$SB/show.out"; eq 0 "$?" "show --json exits 0 when a question is open"
eq 'Q two?' "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).question)' "$SB/show.out")" "show --json prints the open file"
odo show --root-run-id R-none --json > "$SB/show2.out"; eq 1 "$?" "show --json exits 1 when none is open (other root)"
odo close --root-run-id R1 > /dev/null; eq 0 "$?" "close removes the file"
assert_file_absent "$F1" "closed decision file is gone"
odo close --root-run-id R1 > /dev/null; eq 0 "$?" "close is idempotent"
odo show --root-run-id R1 --json > /dev/null; eq 1 "$?" "show exits 1 after close"
# six concurrent opens: exactly one wins, the rest are refused, the file is intact JSON
rm -f "$SB"/c*.rc
for i in 1 2 3 4 5 6; do ( odo open --question "P$i" --root-run-id RC > /dev/null; echo $? > "$SB/c$i.rc" ) & done; wait
eq '0 3 3 3 3 3' "$(cat "$SB"/c?.rc | sort | tr '\n' ' ' | sed 's/ $//')" "concurrent open x6: one wins (0), five are refused (3)"
eq yes "$(node -e 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write("yes")}catch(e){process.stdout.write("no")}' "$COMMON/autopilot/decisions/${KEY}--RC.json")" "concurrent open leaves one intact file"
odo close --root-run-id RC > /dev/null
# unbound scope file name = project_key
odo open --question 'unbound?' > /dev/null; eq 0 "$?" "open without a root targets the unbound scope"
assert_file_exists "$COMMON/autopilot/decisions/${KEY}.json" "unbound decision file is <project_key>.json"
odo close > /dev/null
# schema file validates a written file
odo open --question 'S?' --option a --option b --not-authorized x --root-run-id RS > /dev/null
eq yes "$(node -e 'const {validateJsonSchema}=require(process.argv[1]+"/scripts/validate-json-schema.js");const s=JSON.parse(require("fs").readFileSync(process.argv[1]+"/schemas/decision.schema.json","utf8"));const v=JSON.parse(require("fs").readFileSync(process.argv[2],"utf8"));process.stdout.write(validateJsonSchema(s,v).valid?"yes":"no")' "$REPO_ROOT" "$COMMON/autopilot/decisions/${KEY}--RS.json" 2>&1 | tail -1)" "schemas/decision.schema.json validates the helper's output"
eq no "$(node -e 'const {validateJsonSchema}=require(process.argv[1]+"/scripts/validate-json-schema.js");const s=JSON.parse(require("fs").readFileSync(process.argv[1]+"/schemas/decision.schema.json","utf8"));process.stdout.write(validateJsonSchema(s,{schema:"autopilot.decision/1",question:5}).valid?"yes":"no")' "$REPO_ROOT" 2>&1 | tail -1)" "schema rejects a non-string question"
rm -f "$COMMON/autopilot/decisions/${KEY}--RS.json"
node -e 'const fs=require("fs");const v={schema:"autopilot.decision/1",question:"Q",options:null,context:null,root_run_id:"RS",repo_identity:"x",project_key:"y",opened_at:"2026-10-05T00:00:00.000Z",opened_by_session:null};fs.writeFileSync(process.argv[1],JSON.stringify(v))' "$SB/no-na.json"
eq yes "$(node -e 'const {validateJsonSchema}=require(process.argv[1]+"/scripts/validate-json-schema.js");const s=JSON.parse(require("fs").readFileSync(process.argv[1]+"/schemas/decision.schema.json","utf8"));process.stdout.write(validateJsonSchema(s,JSON.parse(require("fs").readFileSync(process.argv[2],"utf8"))).valid?"yes":"no")' "$REPO_ROOT" "$SB/no-na.json" 2>&1 | tail -1)" "schema: a brief-shape file WITHOUT not_authorized validates"

# ---- B. watcher driver ------------------------------------------------------------------------------------
cat > "$SB/driver.js" <<'JS'
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const [, , repoRoot, key, ident, ident2, D, outRoot, repo, repo2, sessDir, live, home] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
let T = Date.parse('2026-10-04T03:00:00.000Z');
const world = { rows: [] };
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
const W = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); };
const common = path.join(repo, '.git');
const mkRow = (id, root) => {
  const mf = path.join(D, 'manifests', `${id}.manifest.json`);
  W(mf, { run_id: id, root_run_id: root, ledger: path.join(D, 'led', 'ledger.jsonl'), branch: 'w/x' });
  return { run_id: id, role: 'hand', runner: 'claude', model: 'sonnet', started_at: '2026-10-04T01:00:00.000Z', ended_at: null, parent_run_id: null, root_run_id: root, depth: 1, manifest: mf,
    project: ident, source: { manifest: mf, status_probe: null, exit_file: path.join(D, 'exits', `${id}.exit`) }, fact_at: '2026-10-04T01:00:00.000Z', observed_at: '2026-10-04T01:00:00.000Z', probe_age_s: null, rc: null, final_status: null, elapsed_s: 5, alive: null };
};
const collect = () => world.rows.map((r) => ({ ...r, phase: 'running' }));
fs.mkdirSync(path.join(D, 'led'), { recursive: true }); W(path.join(D, 'led', 'ledger.jsonl'), ''); W(path.join(D, 'task.json'), '{}');
const watcher = createWatcher({ key, env: process.env, cwd: repo, collect, now: () => T, interval: 10, enrichCap: 8, render: { outRoot } });
const tick = (dt) => { T += dt * 1000; try { watcher.tick(); } catch (e) { out('tick_threw', e.message); } };
const settle = () => { tick(10); tick(6); tick(10); };
const jobDir = (job) => path.join(outRoot, '2026-10-04', job);
const versions = (job) => { try { return fs.readdirSync(jobDir(job)).filter((n) => /^v-/.test(n) && !n.includes('.cand-')).length; } catch (_e) { return 0; } };
const model = (job) => { try { return JSON.parse(fs.readFileSync(path.join(jobDir(job), 'current', 'model.json'), 'utf8')); } catch (_e) { return null; } };
const html = (job) => { try { return fs.readFileSync(path.join(jobDir(job), 'current', 'index.html'), 'utf8'); } catch (_e) { return ''; } };
const J = (v) => JSON.stringify(v);
const iso = (ms) => new Date(ms).toISOString();
const scopeKey = (root) => (root ? `${key}--${root}` : key);
const sidecar = (root) => { try { return JSON.parse(fs.readFileSync(path.join(live, 'runs', 'sources', `${scopeKey(root)}.json`), 'utf8')); } catch (_e) { return null; } };
const srcRoles = (m) => (m ? m.sources.map((s) => s.role).join(',') : 'nomodel');
const tasksFile = (sid, o) => W(path.join(live, 'tasks', `${sid}.json`), { schema: 'autopilot.session-tasks/1', session_id: sid, cwd: repo, project_key: key, updated_at: iso(T), first_created_at: iso(T), tasks: [], counts: { total: 0, completed: 0, in_progress: 0 }, current: null, ...o });
const marker = (sid, o) => W(path.join(sessDir, `${sid}.json`), { session_id: sid, level: 'l3', repo_root: repo, started_at: iso(T), expires_at: iso(T + 3600e3), repo_identity: ident, project_key: key, root_run_id: null, ...o });
const wrec = (extra = {}) => ({ schema_version: 1, artifact_type: 'controller_progress_receipt', project_id: 'm', deliverable_id: 'n', generation: 0, active_process: null, completed_deliverables: ['d1'], remaining_deliverables: ['d2'], deliverable_count: 2, frozen_denominator_digest: 'f'.repeat(64), blocked_reason: null, eta_basis: 'x', gate_state: { entries: [] }, resource_debt_state: { open: [], released: [] }, phase: 'IMPLEMENTING', work_order_id: 'wo', root_run_id: 'R1', issued_at: '2026-10-04T02:00:00.000Z', digest: 'e'.repeat(64), deliverable_titles: { d1: 'First deliverable' }, ...extra });
const decisionFile = (root, o) => W(path.join(common, 'autopilot', 'decisions', `${scopeKey(root)}.json`), { schema: 'autopilot.decision/1', question: 'DQ?', options: ['yes', 'no'], context: null, not_authorized: 'NA-reason', root_run_id: root, repo_identity: ident, project_key: key, opened_at: iso(T - 60e3), opened_by_session: null, ...o });
const cmpDir = (root) => path.join(common, 'autopilot', 'compare', root);
const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const cmpRec = (id) => ({ schema: 'compare-record/1', id, scene: 'SCENE-1', viewport: '390x844', browser: 'chromium', fixture: 'fx', capture_method: 'page.screenshot',
  before: { commit: 'a'.repeat(40), dirty: false, path: 'before.png', sha256: sha(png), taken_at: '2026-10-04T01:00:00.000Z' },
  after: { commit: 'b'.repeat(40), dirty: false, path: 'after.png', sha256: sha(png), taken_at: '2026-10-04T01:05:00.000Z' },
  metrics: [], images: { before: 'before.png', after: 'after.png' } });

watcher.start();
// ---- item 1: planned ---------------------------------------------------------------------------------------
world.rows = [mkRow('r-c', 'R1')];
const woDir = path.join(common, 'autopilot', 'work-orders', 'R1');
W(path.join(woDir, 'n-a1.json'), { artifact_type: 'work_order', root_run_id: 'R1', attempt: 1, controller: { progress_receipts: [wrec()] } });
settle();
let m = model('R1');
out('p1_campaign_planned', m ? J(m.planned) : 'nomodel');
out('p1_campaign_wired', m ? m.wired.planned : 'nomodel');
out('p1_campaign_source', srcRoles(m).includes('planned') ? 'yes' : 'no');
// unbound / non-campaign scope: tasks files of this project, no marker -> unbound
world.rows = [mkRow('r-u', null)];
const t0 = T;
tasksFile('s-a', { first_created_at: iso(t0 - 20e3), tasks: [{ id: '1', subject: 'alpha', status: 'pending', started_seq: null }, { id: '2', subject: 'gone', status: 'deleted', started_seq: null }] });
tasksFile('s-b', { project_key: 'otherproject0000', first_created_at: iso(t0 - 30e3), tasks: [{ id: '1', subject: 'FOREIGN-PROJECT', status: 'pending', started_seq: null }] });
tasksFile('s-c', { updated_at: iso(t0 - 3 * 86400e3), first_created_at: iso(t0 - 3 * 86400e3), tasks: [{ id: '1', subject: 'STALE-FILE', status: 'pending', started_seq: null }] });
tasksFile('s-d', { first_created_at: iso(t0 - 10e3), tasks: [{ id: '1', subject: 'OTHER-ROOT', status: 'pending', started_seq: null }] });
marker('s-d', { root_run_id: 'R9' });
tasksFile('s-e', { first_created_at: iso(t0 - 5e3), tasks: [{ id: '1', subject: 'beta', status: 'in_progress', started_seq: 1 }] });
settle();
m = model('unbound');
out('p1_unbound_planned', m ? m.planned.map((p) => p.title).join('|') : 'nomodel');
out('p1_unbound_has_foreign', m && J(m.planned).includes('FOREIGN') ? 'yes' : 'no');
out('p1_unbound_has_stale', m && J(m.planned).includes('STALE') ? 'yes' : 'no');
out('p1_unbound_has_otherroot', m && J(m.planned).includes('OTHER-ROOT') ? 'yes' : 'no');
const v1 = versions('unbound');
tasksFile('s-e', { first_created_at: iso(t0 - 5e3), tasks: [{ id: '1', subject: 'beta', status: 'in_progress', started_seq: 1 }, { id: '2', subject: 'gamma', status: 'pending', started_seq: null }] });
settle();
out('p1_signature_republish', versions('unbound') - v1);
out('p1_signature_new_item', model('unbound') && J(model('unbound').planned).includes('gamma') ? 'yes' : 'no');
// bound non-campaign scope: tasks of the session whose marker root = R2; expired marker (end signal) drops it
world.rows = [mkRow('r-u', null), mkRow('r-2', 'R2')];
tasksFile('s-f', { first_created_at: iso(t0 - 1e3), tasks: [{ id: '1', subject: 'bound-task', status: 'pending', started_seq: null }] });
marker('s-f', { root_run_id: 'R2' });
settle();
out('p1_bound_planned', model('R2') ? model('R2').planned.map((p) => p.title).join('|') : 'nomodel');
marker('s-f', { root_run_id: 'R2', expires_at: iso(T - 1000) });
settle();
out('p1_after_end_signal', model('R2') ? model('R2').planned.length : 'nomodel');
out('p1_after_end_signal_not_unbound', model('unbound') && J(model('unbound').planned).includes('bound-task') ? 'yes' : 'no');

// ---- item 2: decision --------------------------------------------------------------------------------------
world.rows = [mkRow('r-c', 'R1')];
settle();
out('d_before_needs', model('R1').needs_decision);
decisionFile('R1', {});
const vd = versions('R1'); settle();
m = model('R1');
out('d_needs', m.needs_decision); out('d_question', m.decision && m.decision.question);
out('d_options', m.decision ? m.decision.options.map((o) => o.label).join(',') : '-');
out('d_not_authorized', m.decision && m.decision.not_authorized);
out('d_source', srcRoles(m).includes('decision') ? 'yes' : 'no');
out('d_republish', versions('R1') - vd);
decisionFile('R1', { root_run_id: 'R9' }); settle(); out('d_other_root', model('R1').needs_decision);
decisionFile('R1', { repo_identity: ident2 }); settle(); out('d_other_repo', model('R1').needs_decision);
decisionFile('R1', { opened_at: iso(T - 30 * 86400e3) }); settle(); out('d_stale', model('R1').needs_decision); out('d_stale_flag', model('R1').decision && `${model('R1').decision.stale}:${model('R1').decision.age_s >= 30 * 86400}`); out('d_stale_text', html('R1').includes('（已等 30 天）') ? 'yes' : 'no');
decisionFile('R1', { opened_at: iso(T + 3600e3) }); settle(); out('d_future', model('R1').needs_decision);
decisionFile('R1', {}); settle(); out('d_fresh_flag', model('R1').decision && String(model('R1').decision.stale));
W(path.join(common, 'autopilot', 'decisions', `${scopeKey('R1')}.json`), '{ nope'); settle(); out('d_corrupt', model('R1').needs_decision);
decisionFile('R1', {}); settle(); out('d_back', model('R1').needs_decision);
fs.unlinkSync(path.join(common, 'autopilot', 'decisions', `${scopeKey('R1')}.json`)); settle(); out('d_after_close', model('R1').needs_decision);

// ---- item 3: compare ---------------------------------------------------------------------------------------
out('c_absent_wired', model('R1').wired.compare);
fs.mkdirSync(cmpDir('R1'), { recursive: true }); fs.writeFileSync(path.join(cmpDir('R1'), 'before.png'), png); fs.writeFileSync(path.join(cmpDir('R1'), 'after.png'), png);
W(path.join(cmpDir('R1'), 'rec.json'), cmpRec('cmp-r1'));
const vc = versions('R1'); settle();
m = model('R1');
out('c_present', m.compare.map((c) => c.id).join(',')); out('c_present_wired', m.wired.compare);
out('c_source', srcRoles(m).includes('compare_record') ? 'yes' : 'no'); out('c_republish', versions('R1') - vc);
const later = new Date(T + 90000); fs.utimesSync(path.join(cmpDir('R1'), 'rec.json'), later, later);
const vc2 = versions('R1'); settle(); out('c_mtime_republish', versions('R1') - vc2);
W(path.join(cmpDir('R9'), 'rec.json'), cmpRec('cmp-r9')); fs.mkdirSync(path.join(cmpDir('R9')), { recursive: true });
settle(); out('c_other_root_not_read', J(model('R1').compare).includes('cmp-r9') ? 'no' : 'yes');
W(path.join(common, 'autopilot', 'compare', 'rec-unbound.json'), cmpRec('cmp-unb'));
world.rows = [mkRow('r-u', null)]; settle();
out('c_unbound_reads_nothing', model('unbound').compare.length);
out('c_unbound_wired', model('unbound').wired.compare);

// ---- item 5: sources manifest ------------------------------------------------------------------------------
world.rows = [mkRow('r-c', 'R1')]; settle();
let sc = sidecar('R1');
out('s_schema', sc && sc.schema); out('s_scope', sc && `${sc.scope.project_key}|${sc.scope.root_run_id}`);
out('s_tasks', sc && J(sc.sources.tasks)); out('s_attention', sc && `${sc.sources.attention.installed}/${sc.sources.attention.enabled}`);
out('s_compare', sc && `${sc.sources.compare.installed}|${sc.sources.compare.how}`);
out('s_keys', sc && Object.keys(sc.sources).sort().join(','));
out('s_model_has_manifest', model('R1').sources_manifest ? 'yes' : 'no');
world.rows = [mkRow('r-c', 'R1'), mkRow('r-5', 'R5')]; settle();
out('s_compare_text_unwired', html('R5').includes('來源未接') ? 'yes' : 'no');
process.env.AUTOPILOT_SESSION_TASKS = 'off';
W(path.join(home, 'config.json'), { hooks: { 'awaiting-owner': false } });
tasksFile('s-g', { tasks: [{ id: '1', subject: 'x', status: 'pending', started_seq: null }] }); // force a republish
settle(); sc = sidecar('R1');
out('s_tasks_off', sc && `${sc.sources.tasks.installed}/${sc.sources.tasks.enabled}`);
out('s_attention_cfg_off', sc && `${sc.sources.attention.installed}/${sc.sources.attention.enabled}`);
delete process.env.AUTOPILOT_SESSION_TASKS; fs.unlinkSync(path.join(home, 'config.json'));

// ---- item 6: marker stage (read side; the §2.9 fields; the old marker phase fields are gone since P2b) ------------------------------------------------------------------------
world.rows = [mkRow('r-3', 'R3'), mkRow('r-4', 'R4'), mkRow('r-c', 'R1')];
settle();
out('ph_none', J(model('R3').phase));
marker('ph-a', { root_run_id: 'R3', size: 'M', stage: 'plan', stage_set_at: iso(T - 50e3) });
settle(); out('ph_single', J(model('R3').phase));
marker('ph-b', { root_run_id: 'R3', stage: 'implement', stage_set_at: iso(T - 10e3) });
settle(); out('ph_newest_wins', model('R3').phase && model('R3').phase.code);
marker('ph-c', { root_run_id: 'R3', stage: 'verify', stage_set_at: iso(T), project_key: 'other0000000000' });
marker('ph-d', { root_run_id: 'R4', stage: 'finish', stage_set_at: iso(T) });
settle(); out('ph_foreign_ignored', model('R3').phase && model('R3').phase.code);
out('ph_other_root_scope', model('R4').phase && model('R4').phase.code);
marker('ph-b', { root_run_id: 'R3', stage: 'implement', stage_set_at: iso(T - 10e3), expires_at: iso(T - 1000) });
settle(); out('ph_expired_falls_back', model('R3').phase && model('R3').phase.code);
marker('ph-e', { root_run_id: 'R1', stage: 'qc-gate', stage_set_at: iso(T) });
settle(); out('ph_campaign_beats_marker', model('R1').phase && `${model('R1').phase.source}:${model('R1').phase.code}`);
// ---- item 7: PHASE-TASK — the phase falls back to the session task in progress ----------------------------------
out('pt_unbound_scope', model('unbound') ? J(model('unbound').phase) : 'nomodel'); // s-e (unbound) has beta in progress
world.rows = [mkRow('r-7', 'R7'), mkRow('r-8', 'R8'), mkRow('r-9', 'R9'), mkRow('r-c', 'R1')];
const ip = (id, subject, seq) => ({ id, subject, status: 'in_progress', started_seq: seq });
tasksFile('pt-a', { first_created_at: iso(T - 90e3), tasks: [{ id: '1', subject: 'pending only', status: 'pending', started_seq: null }] });
marker('pt-a', { root_run_id: 'R8' });
settle(); out('pt_none_in_progress', model('R8') ? J(model('R8').phase) : 'nomodel');
tasksFile('pt-b', { first_created_at: iso(T - 80e3), tasks: [ip('2', 'Write the parser', 1)] });
marker('pt-b', { root_run_id: 'R7' });
settle(); out('pt_shown', J(model('R7').phase));
out('pt_source_row', srcRoles(model('R7')).includes('session_task_phase') ? 'yes' : 'no');
out('pt_other_scope_untouched', J(model('R8').phase));
// two in progress in one session: the highest started_seq
tasksFile('pt-b', { first_created_at: iso(T - 80e3), tasks: [ip('2', 'Write the parser', 1), ip('3', 'Wire the watcher', 2), ip('4', 'Older start', 0)] });
settle(); out('pt_two_same_session_newest', model('R7').phase.code);
// two sessions on one root: the newer session file wins
tasksFile('pt-c', { first_created_at: iso(T - 70e3), updated_at: iso(T + 50e3), tasks: [ip('9', 'Newer session task', 1)] });
marker('pt-c', { root_run_id: 'R7' });
settle(); out('pt_two_sessions_newest', model('R7').phase.label);
fs.unlinkSync(path.join(live, 'tasks', 'pt-c.json')); fs.unlinkSync(path.join(sessDir, 'pt-c.json'));
// another root's task and another project's task are never used
tasksFile('pt-d', { first_created_at: iso(T - 60e3), tasks: [ip('1', 'OTHER-ROOT-TASK', 9)] });
marker('pt-d', { root_run_id: 'R9' });
tasksFile('pt-e', { project_key: 'otherproject0000', first_created_at: iso(T - 50e3), tasks: [ip('1', 'FOREIGN-PROJECT-TASK', 9)] });
marker('pt-e', { root_run_id: 'R7' });
settle(); out('pt_foreign_ignored_R7', model('R7').phase.label);
out('pt_other_root_own_scope', model('R9').phase.label);
// marker stage beats the task; a campaign live phase beats both
marker('pt-b', { root_run_id: 'R7', stage: 'plan', stage_set_at: iso(T) });
settle(); out('pt_marker_beats_task', `${model('R7').phase.source}:${model('R7').phase.code}`);
tasksFile('pt-f', { first_created_at: iso(T - 40e3), tasks: [ip('1', 'TASK-UNDER-CAMPAIGN', 1)] });
marker('pt-f', { root_run_id: 'R1' });
settle(); out('pt_campaign_beats_all', `${model('R1').phase.source}:${model('R1').phase.code}`);
// tick-level: marking a task in_progress republishes with the new phase; completing it drops the phase
fs.unlinkSync(path.join(sessDir, 'pt-b.json')); // R7 now has no marker stage
tasksFile('pt-b', { first_created_at: iso(T - 80e3), tasks: [{ id: '2', subject: 'Flip me', status: 'pending', started_seq: null }] });
settle(); out('pt_flip_before', J(model('R7').phase));
marker('pt-b', { root_run_id: 'R7' });
settle(); const vf = versions('R7'); settle(); out('pt_flip_idle_no_republish', versions('R7') - vf);
tasksFile('pt-b', { first_created_at: iso(T - 80e3), tasks: [{ id: '2', subject: 'Flip me', status: 'in_progress', started_seq: 1 }] });
settle(); out('pt_flip_after', model('R7').phase.label); out('pt_flip_republish', versions('R7') - vf);
tasksFile('pt-b', { first_created_at: iso(T - 80e3), tasks: [{ id: '2', subject: 'Flip me', status: 'completed', started_seq: 1 }] });
settle(); out('pt_flip_done', J(model('R7').phase));
// long subject: cut at 40 chars with an ellipsis
tasksFile('pt-b', { first_created_at: iso(T - 80e3), tasks: [ip('2', 'abcdefghij'.repeat(6), 1)] });
settle(); out('pt_long_label', model('R7').phase.label); out('pt_long_len', model('R7').phase.label.length);

// daily refresh: the whole-days age of an open decision is in the change signature
// isolate the decision age: nothing else may change with the day (tasks files and markers are time-windowed too)
fs.rmSync(path.join(live, 'tasks'), { recursive: true, force: true }); fs.rmSync(sessDir, { recursive: true, force: true }); fs.mkdirSync(sessDir, { recursive: true });
decisionFile('R1', { opened_at: iso(T - 60e3) }); settle(); settle();
const vday = versions('R1'); settle(); const vday2 = versions('R1');
tick(86400 + 10); settle();
out('sig_idle_no_republish', vday2 - vday); out('sig_day_republish', versions('R1') - vday2);
watcher.finalPublish('stopped');
JS
export AUTOPILOT_REVIEW_SERVER_AUTOSTART=0
OUT_ROOT="$AH/review/$KEY"
DRV="$(wenv "$NODE" "$SB/driver.js" "$REPO_ROOT" "$KEY" "$IDENT" "$IDENT2" "$D" "$OUT_ROOT" "$REPO" "$REPO2" "$AH/session-mode" "$LIVE" "$AH" 2> "$SB/driver.err" < /dev/null)"; DRC=$?
eq 0 "$DRC" "driver exits 0 (stderr: $(head -c 400 "$SB/driver.err"))"
dv() { printf '%s\n' "$DRV" | sed -n "s/^$1=//p" | head -1; }
eq '' "$(dv tick_threw)" "no tick threw"

# item 1
eq '[{"id":"d1","title":"First deliverable"},{"id":"d2","title":null}]' "$(dv p1_campaign_planned)" "planned (campaign): deliverable list from the controller receipt, id + title when present"
eq true "$(dv p1_campaign_wired)" "planned (campaign): wired"
eq yes "$(dv p1_campaign_source)" "planned (campaign): source role planned recorded"
eq 'alpha|beta' "$(dv p1_unbound_planned)" "planned (unbound): union of this project's unbound sessions' tasks, creation order, deleted dropped"
eq no "$(dv p1_unbound_has_foreign)" "planned negative: a tasks file of another project is ignored"
eq no "$(dv p1_unbound_has_stale)" "planned negative: a stale tasks file is ignored"
eq no "$(dv p1_unbound_has_otherroot)" "planned negative: a session bound to another root is not in the unbound scope"
eq 1 "$(dv p1_signature_republish)" "planned: a tasks change republishes exactly once (digest in the change signature)"
eq yes "$(dv p1_signature_new_item)" "planned: the new task is on the page"
eq 'bound-task' "$(dv p1_bound_planned)" "planned (bound non-campaign): tasks of the session whose marker root matches"
eq 0 "$(dv p1_after_end_signal)" "planned negative: after the marker expires (end signal) the session's tasks leave the bound scope"
eq yes "$(dv p1_after_end_signal_not_unbound)" "planned: a session whose marker ended is a plain session again (unbound scope), and only while its tasks file is recent"
# item 2
eq false "$(dv d_before_needs)" "decision: none before the file exists"
eq true "$(dv d_needs)" "decision: an open file makes needs_decision"
eq 'DQ?' "$(dv d_question)" "decision: question on the model"
eq 'yes,no' "$(dv d_options)" "decision: string options reach the renderer as labels"
eq 'NA-reason' "$(dv d_not_authorized)" "decision: not_authorized reaches the model"
eq yes "$(dv d_source)" "decision: source role decision recorded"
eq 1 "$(dv d_republish)" "decision: appearing republishes once"
eq false "$(dv d_other_root)" "decision negative: a file of another root is ignored"
eq false "$(dv d_other_repo)" "decision negative: a file of another repo is ignored"
eq true "$(dv d_stale)" "decision: a stale file (opened 30 days ago) is still shown (expiry warns, never hides)"
eq 'true:true' "$(dv d_stale_flag)" "decision: stale file carries stale:true and age_s"
eq yes "$(dv d_stale_text)" "decision: the page says （已等 30 天）"
eq false "$(dv d_future)" "decision negative: a file dated in the future is rejected"
eq false "$(dv d_fresh_flag)" "decision: a fresh file has stale:false"
eq false "$(dv d_corrupt)" "decision negative: a corrupt file is ignored"
eq true "$(dv d_back)" "decision: a valid file is honoured again"
eq false "$(dv d_after_close)" "decision: after close the page clears"
# item 3
eq false "$(dv c_absent_wired)" "compare: directory absent -> not provided, not wired (writer is a guidance row)"
eq 'cmp-r1' "$(dv c_present)" "compare: records of <common>/autopilot/compare/<root>/ reach the model"
eq true "$(dv c_present_wired)" "compare: provided -> wired"
eq yes "$(dv c_source)" "compare: compare_record source row"
eq 1 "$(dv c_republish)" "compare: appearing republishes once"
eq 1 "$(dv c_mtime_republish)" "compare: an mtime change republishes (file:mtime in the signature)"
eq yes "$(dv c_other_root_not_read)" "compare negative: another root's directory is not read"
eq 0 "$(dv c_unbound_reads_nothing)" "compare negative: the unbound scope reads nothing"
eq false "$(dv c_unbound_wired)" "compare: unbound scope stays unwired"
# item 5
eq 'autopilot.sources/1' "$(dv s_schema)" "sources: sidecar schema"
eq "$KEY|R1" "$(dv s_scope)" "sources: scope"
eq '{"installed":true,"enabled":true,"how":"hook hooks/session-tasks.js (knob AUTOPILOT_SESSION_TASKS)"}' "$(dv s_tasks)" "sources: tasks installed+enabled derived from hooks.json and knob"
eq 'true/true' "$(dv s_attention)" "sources: attention"
eq 'false|writer is a guidance row' "$(dv s_compare)" "sources: compare not installed, says why"
eq 'attention,compare,context,decision,ledger_depth0,ledger_engine,progress,stage,task_status_input,tasks,turn' "$(dv s_keys)" "sources: the eleven sources the band reads"
eq yes "$(dv s_model_has_manifest)" "sources: the model carries the manifest"
eq yes "$(dv s_compare_text_unwired)" "sources: the page says 來源未接 for the uninstalled compare writer"
eq 'true/false' "$(dv s_tasks_off)" "sources: env knob off -> installed but not enabled"
eq 'true/false' "$(dv s_attention_cfg_off)" "sources: config.json knob off -> installed but not enabled"
# item 6
eq null "$(dv ph_none)" "phase: no marker phase and no deliverable -> null"
eq '{"code":"plan","label":"M·l3 ▸ plan","source":"session"}' "$(dv ph_single)" "phase: marker stage reaches the model with source session"
eq implement "$(dv ph_newest_wins)" "phase: two markers on one scope -> newest stage_set_at"
eq implement "$(dv ph_foreign_ignored)" "phase negative: markers of another project / another root are ignored"
eq finish "$(dv ph_other_root_scope)" "phase: the other root's own scope reads its own marker"
eq plan "$(dv ph_expired_falls_back)" "phase negative: an expired marker (end signal) drops out"
eq 0 "$(dv sig_idle_no_republish)" "signature: no input change, no republish"
eq 1 "$(dv sig_day_republish)" "signature: a day passing refreshes the open decision's age (已等 N 天) once"
eq 'campaign:IMPLEMENTING' "$(dv ph_campaign_beats_marker)" "phase: campaign live phase beats the marker stage"

# item 7 PHASE-TASK
eq '{"code":"1","label":"做：beta","source":"task"}' "$(dv pt_unbound_scope)" "phase task: the unbound scope shows its session's in-progress task"
eq null "$(dv pt_none_in_progress)" "phase task: nothing in progress -> phase stays null"
eq '{"code":"2","label":"做：Write the parser","source":"task"}' "$(dv pt_shown)" "phase task: the task in progress reaches model.json (source task, label 做：<subject>)"
eq yes "$(dv pt_source_row)" "phase task: a session_task_phase source row is recorded"
eq null "$(dv pt_other_scope_untouched)" "phase task: another root's scope does not borrow it"
eq 3 "$(dv pt_two_same_session_newest)" "phase task: two in progress in one session -> highest started_seq"
eq '做：Newer session task' "$(dv pt_two_sessions_newest)" "phase task: two sessions on one root -> the most recently updated session"
eq '做：Wire the watcher' "$(dv pt_foreign_ignored_R7)" "phase task negative: another project's in-progress task is never used"
eq '做：OTHER-ROOT-TASK' "$(dv pt_other_root_own_scope)" "phase task: the other root's task shows only in its own scope"
eq session:plan "$(dv pt_marker_beats_task)" "phase task: marker stage beats the task"
eq campaign:IMPLEMENTING "$(dv pt_campaign_beats_all)" "phase task: campaign live phase beats marker and task"
eq null "$(dv pt_flip_before)" "phase task tick: pending task -> no phase"
eq 0 "$(dv pt_flip_idle_no_republish)" "phase task tick: no change -> no republish"
eq '做：Flip me' "$(dv pt_flip_after)" "phase task tick: marking the task in_progress republishes model.json with the phase"
eq 1 "$(dv pt_flip_republish)" "phase task tick: exactly one republish for the status change (tasks digest in the signature)"
eq null "$(dv pt_flip_done)" "phase task tick: completing the task removes the phase"
eq '做：abcdefghijabcdefghijabcdefghijabcdefghi…' "$(dv pt_long_label)" "phase task: long subject cut to 40 chars with an ellipsis"
eq 42 "$(dv pt_long_len)" "phase task: label = 做： + 40 chars (39 + ellipsis)"

# ---- C. pure units ------------------------------------------------------------------------------------------
cat > "$SB/units.js" <<'JS'
const fs = require('fs'); const path = require('path'); const os = require('os');
const root = process.argv[2];
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
const { buildSourcesManifest } = require(path.join(root, 'src/status/sources-manifest.js'));
const R = require(path.join(root, 'scripts/render-review-page.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwi-units-'));
const plug = path.join(tmp, 'plugin'); fs.mkdirSync(path.join(plug, 'hooks'), { recursive: true }); fs.mkdirSync(path.join(plug, 'scripts'), { recursive: true });
fs.writeFileSync(path.join(plug, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }));
const m1 = buildSourcesManifest({ pluginRoot: plug, env: {}, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } });
out('u_empty_plugin_tasks', `${m1.sources.tasks.installed}/${m1.sources.tasks.enabled}`);
out('u_empty_plugin_decision', m1.sources.decision.installed);
fs.writeFileSync(path.join(plug, 'hooks', 'session-tasks.js'), '');
fs.writeFileSync(path.join(plug, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/session-tasks.js' }] }] } }));
fs.writeFileSync(path.join(plug, 'scripts', 'open-decision.js'), '');
const m2 = buildSourcesManifest({ pluginRoot: plug, env: {}, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } });
out('u_hook_present_tasks', `${m2.sources.tasks.installed}/${m2.sources.tasks.enabled}`);
out('u_script_present_decision', m2.sources.decision.installed);
const m3 = buildSourcesManifest({ pluginRoot: plug, env: { AUTOPILOT_SESSION_TASKS: 'off' }, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } });
out('u_knob_off', `${m3.sources.tasks.installed}/${m3.sources.tasks.enabled}`);
// INT2: attention/tasks/context installed derives from the REAL wiring (hooks.json on a temp copy of the real hooks dir)
const real = (extra) => { // copy of the real plugin hooks + hooks.json, hooks.json filtered by `drop(command)`
  const pl = fs.mkdtempSync(path.join(tmp, 'real-')); fs.mkdirSync(path.join(pl, 'hooks'), { recursive: true }); fs.mkdirSync(path.join(pl, 'scripts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(root, 'hooks'))) if (f.endsWith('.js') && !f.endsWith('.test.js')) fs.copyFileSync(path.join(root, 'hooks', f), path.join(pl, 'hooks', f));
  const hj = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'));
  for (const ev of Object.keys(hj.hooks)) hj.hooks[ev] = hj.hooks[ev].map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !extra(h.command)) })).filter((g) => g.hooks.length);
  fs.writeFileSync(path.join(pl, 'hooks', 'hooks.json'), JSON.stringify(hj));
  return buildSourcesManifest({ pluginRoot: pl, env: {}, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } }).sources;
};
const st = (m, k) => `${m[k].installed}/${m[k].enabled}`;
const OWN = (c) => /\/hooks\/awaiting-owner\.js/.test(c); const HOST = (c) => /\/hooks\/(audit-log|advisory-relay)\.js/.test(c);
let rm = real(() => false); out('i_real_attention', st(rm, 'attention')); out('i_real_tasks', st(rm, 'tasks')); out('i_real_context', st(rm, 'context'));
rm = real(HOST); out('i_no_hosts_attention', st(rm, 'attention'));
rm = real(OWN); out('i_no_own_attention', st(rm, 'attention'));
rm = real((c) => OWN(c) || HOST(c)); out('i_none_attention', st(rm, 'attention'));
rm = real((c) => /\/hooks\/session-tasks\.js/.test(c)); out('i_no_tasks_wiring', st(rm, 'tasks'));
rm = real((c) => /\/hooks\/context-budget\.js/.test(c)); out('i_no_context_wiring', st(rm, 'context'));
// a hook file that merely NAMES awaiting-owner (comment) is not a host
fs.writeFileSync(path.join(plug, 'hooks', 'awaiting-owner.js'), ''); fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), '// see awaiting-owner.js\n');
fs.writeFileSync(path.join(plug, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/chatty.js' }] }] } }));
out('i_comment_not_host', st(buildSourcesManifest({ pluginRoot: plug, env: {}, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } }).sources, 'attention'));
fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), "require('./awaiting-owner.js').handle({});\n");
out('i_require_is_host', st(buildSourcesManifest({ pluginRoot: plug, env: {}, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } }).sources, 'attention'));
// REPAIR-2 (hosts-regex-suffix): extensionless / double-quoted spellings are hosts too; a commented-out require is not
const attn = () => st(buildSourcesManifest({ pluginRoot: plug, env: {}, autopilotHome: tmp, scope: { project_key: 'k', root_run_id: null } }).sources, 'attention');
fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), "require('./awaiting-owner').handle({});\n"); out('i_require_noext_single', attn());
fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), 'require("./awaiting-owner").handle({});\n'); out('i_require_noext_double', attn());
fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), 'require("./awaiting-owner.js").handle({});\n'); out('i_require_ext_double', attn());
fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), "// require('./awaiting-owner')\n/* require('./awaiting-owner.js') */\n"); out('i_require_commented', attn());
fs.writeFileSync(path.join(plug, 'hooks', 'chatty.js'), "require('./awaiting-owner-extra');\n"); out('i_require_other_module', attn());
// item 3: decisions sidecar writers_wired on the integrated tree
out('i_ledger_depth0', buildSourcesManifest({ pluginRoot: root, env: {}, autopilotHome: tmp, scope: {} }).sources.ledger_depth0.installed);
// renderer: manifest drives wired
const base = { runs: { runs: [], scope: {} }, root: null, job: 'j', date: '2026-10-04', project: 'p', now: 0, reviewReceipts: [] };
const man = (o) => ({ schema: 'autopilot.sources/1', sources: o });
const on = { installed: true, enabled: true, how: 'x' }; const off = { installed: false, enabled: false, how: 'y' };
let model = R.buildJobModel({ ...base, sourcesManifest: man({ decision: on, tasks: on, progress: on, compare: on }) });
out('u_manifest_on_decision', model.wired.decision); out('u_manifest_on_planned', model.wired.planned); out('u_manifest_on_compare', model.wired.compare);
let page = R.renderJobHtml(model);
out('u_manifest_on_text', page.includes('本回合沒有待決事項') ? 'yes' : 'no');
model = R.buildJobModel({ ...base, sourcesManifest: man({ decision: off, tasks: off, progress: off, compare: off }) });
out('u_manifest_off_decision', model.wired.decision); out('u_manifest_off_planned', model.wired.planned);
out('u_manifest_off_text', R.renderJobHtml(model).includes('決定：來源未接') ? 'yes' : 'no');
model = R.buildJobModel({ ...base, decision: { question: 'q' }, sourcesManifest: man({ decision: off }) });
out('u_input_beats_manifest', model.wired.decision);
model = R.buildJobModel({ ...base });
model = R.buildJobModel({ ...base, sourcesManifest: man({ task_status_input: on }) });
out('u_task_manifest_on', model.wired.task); out('u_task_manifest_on_text', model.conclusion.includes('來源未接') ? 'no' : 'yes');
model = R.buildJobModel({ ...base, sourcesManifest: man({ task_status_input: off }) });
out('u_task_manifest_off', model.wired.task);
out('u_no_manifest_infers', `${model.wired.decision}/${model.wired.planned}/${model.wired.compare}`);
// buildPhase precedence: campaign valid receipt > marker > first open deliverable
const task = { artifact_type: 'task_status_receipt', root_run_id: 'R', evidence: { campaigns: [{ status: 'valid', phase: 'TERMINAL_READY' }] } };
const prog = { artifact_type: 'controller_progress_receipt', root_run_id: 'R', completed_deliverables: [], remaining_deliverables: ['d9'], deliverable_count: 1, frozen_denominator_digest: 'a' };
const mk = (o) => R.buildJobModel({ ...base, root: 'R', ...o }).phase;
out('u_phase_campaign_receipt_over_marker', JSON.stringify(mk({ taskReceipt: task, progressReceipt: prog, markerStage: { stage: 'verify', size: 'S', urgent: true, level: 'l3', unit: { index: 1, total: 2 } } })));
out('u_phase_marker_over_deliverable', JSON.stringify(mk({ progressReceipt: prog, markerStage: { stage: 'verify', size: 'S', urgent: true, level: 'l3', unit: { index: 1, total: 2 } } })));
out('u_phase_deliverable_when_no_marker', JSON.stringify(mk({ progressReceipt: prog })));
out('u_phase_invalid_marker_ignored', JSON.stringify(mk({ markerStage: { stage: 5 } })));
// PHASE-TASK precedence at the renderer: marker > task > deliverable
const tp = { id: '7', subject: 'Task subject' };
out('u_phase_task_over_deliverable', JSON.stringify(mk({ progressReceipt: prog, taskPhase: tp })));
out('u_phase_marker_over_task', JSON.stringify(mk({ progressReceipt: prog, markerStage: { stage: 'verify', size: 'S', urgent: true, level: 'l3', unit: { index: 1, total: 2 } }, taskPhase: tp })));
out('u_phase_campaign_over_task', JSON.stringify(mk({ taskReceipt: task, taskPhase: tp })));
out('u_phase_task_alone', JSON.stringify(mk({ taskPhase: tp })));
out('u_phase_task_blank_subject', JSON.stringify(mk({ progressReceipt: prog, taskPhase: { id: '7', subject: '   ' } })));
out('u_phase_task_trim_exact40', mk({ taskPhase: { id: '1', subject: 'x'.repeat(40) } }).label.length);
out('u_phase_task_trim_41', mk({ taskPhase: { id: '1', subject: 'x'.repeat(41) } }).label);
fs.rmSync(tmp, { recursive: true, force: true });
JS
UN="$(wenv "$NODE" "$SB/units.js" "$REPO_ROOT" 2> "$SB/units.err" < /dev/null)"
uv() { printf '%s\n' "$UN" | sed -n "s/^$1=//p" | head -1; }
eq 'false/false' "$(uv u_empty_plugin_tasks)" "manifest: a plugin without the hook entry reports tasks not installed"
eq false "$(uv u_empty_plugin_decision)" "manifest: no open-decision.js -> decision not installed"
eq 'true/true' "$(uv u_hook_present_tasks)" "manifest: hook entry present -> installed and enabled"
eq true "$(uv u_script_present_decision)" "manifest: script present -> decision installed"
eq 'true/false' "$(uv u_knob_off)" "manifest: knob off -> installed, not enabled"
eq true "$(uv u_manifest_on_decision)" "renderer: installed+enabled decision with no input -> wired (original empty text)"
eq true "$(uv u_manifest_on_planned)" "renderer: planned follows the tasks source"
eq true "$(uv u_manifest_on_compare)" "renderer: compare follows the manifest"
eq yes "$(uv u_manifest_on_text)" "renderer: wired + empty -> 本回合沒有待決事項"
eq false "$(uv u_manifest_off_decision)" "renderer: not installed -> not wired"
eq false "$(uv u_manifest_off_planned)" "renderer: planned not wired when tasks not installed"
eq yes "$(uv u_manifest_off_text)" "renderer: not installed -> 來源未接 text"
eq true "$(uv u_input_beats_manifest)" "renderer: an input that was provided is wired whatever the manifest says"
eq true "$(uv u_task_manifest_on)" "renderer: task_status_input writer installed+enabled -> task wired (original empty-state sentence, not 來源未接)"
eq yes "$(uv u_task_manifest_on_text)" "renderer: wired task with no receipt does not say 來源未接"
eq false "$(uv u_task_manifest_off)" "renderer: task_status_input not installed -> task not wired"
eq 'false/false/false' "$(uv u_no_manifest_infers)" "renderer: without a manifest the old inference holds"
eq '{"code":"TERMINAL_READY","label":"收尾","source":"campaign"}' "$(uv u_phase_campaign_receipt_over_marker)" "phase precedence: valid campaign receipt phase over marker"
eq '{"code":"verify","label":"S!·l3 ▸ verify unit 1/2","source":"session"}' "$(uv u_phase_marker_over_deliverable)" "phase precedence: marker over the first open deliverable"
eq '{"code":"d9","label":"做 d9","source":"deliverable"}' "$(uv u_phase_deliverable_when_no_marker)" "phase precedence: deliverable when no marker"
eq null "$(uv u_phase_invalid_marker_ignored)" "phase: a non-string marker phase is ignored"
eq '{"code":"7","label":"做：Task subject","source":"task"}' "$(uv u_phase_task_over_deliverable)" "phase precedence: task in progress over the first open deliverable"
eq '{"code":"verify","label":"S!·l3 ▸ verify unit 1/2","source":"session"}' "$(uv u_phase_marker_over_task)" "phase precedence: marker over the task"
eq '{"code":"TERMINAL_READY","label":"收尾","source":"campaign"}' "$(uv u_phase_campaign_over_task)" "phase precedence: campaign receipt over the task"
eq '{"code":"7","label":"做：Task subject","source":"task"}' "$(uv u_phase_task_alone)" "phase: task alone"
eq '{"code":"d9","label":"做 d9","source":"deliverable"}' "$(uv u_phase_task_blank_subject)" "phase: a blank task subject is ignored (falls to the deliverable)"
eq 42 "$(uv u_phase_task_trim_exact40)" "phase: a 40-char subject is not cut"
eq "做：$(printf 'x%.0s' $(seq 39))…" "$(uv u_phase_task_trim_41)" "phase: a 41-char subject is cut to 39 + ellipsis"
eq 'true/true' "$(uv i_real_attention)" "INT2 attention: real hooks.json wiring -> installed"
eq 'true/true' "$(uv i_no_hosts_attention)" "INT2 attention: host wiring removed, own entries remain -> still installed"
eq 'true/true' "$(uv i_no_own_attention)" "INT2 attention: own entries removed, hosts remain -> installed (the PERF layout)"
eq 'false/false' "$(uv i_none_attention)" "INT2 attention: hosts AND own entries removed -> not installed (mutation flips it)"
eq 'false/false' "$(uv i_comment_not_host)" "INT2 attention: a hook file that only names awaiting-owner in a comment is no host"
eq 'true/true' "$(uv i_require_is_host)" "INT2 attention: a wired hook that require()s awaiting-owner is a host"
eq 'true/true' "$(uv i_require_noext_single)" "REPAIR-2 attention: require('./awaiting-owner') without .js is a host"
eq 'true/true' "$(uv i_require_noext_double)" "REPAIR-2 attention: require(\"./awaiting-owner\") double quotes, no .js is a host"
eq 'true/true' "$(uv i_require_ext_double)" "REPAIR-2 attention: require(\"./awaiting-owner.js\") double quotes is a host"
eq 'false/false' "$(uv i_require_commented)" "REPAIR-2 attention: commented-out require lines are no host"
eq 'false/false' "$(uv i_require_other_module)" "REPAIR-2 attention: require of a longer module name is no host"
eq 'true/true' "$(uv i_real_tasks)" "INT2 tasks: real wiring -> installed"
eq 'false/false' "$(uv i_no_tasks_wiring)" "INT2 tasks: wiring removed -> not installed"
eq 'true/true' "$(uv i_real_context)" "INT2 context: real wiring -> installed"
eq 'false/false' "$(uv i_no_context_wiring)" "INT2 context: wiring removed -> not installed"
eq true "$(uv i_ledger_depth0)" "INT2 ledger_depth0: next-pick writer present on the integrated tree"
eq '' "$(head -c 200 "$SB/units.err")" "units: no stderr"

finalize_test
