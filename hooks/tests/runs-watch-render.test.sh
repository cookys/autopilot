#!/usr/bin/env bash
# hooks/tests/runs-watch-render.test.sh — mods plan P1b row B3: `status runs --watch --render` republishes job pages
# on the four events (new manifest, .exit landing, receipt-<phase>.json appearing / mtime change, task_status_receipt
# change), debounced 5 s, plus the two B1b review folds in scripts/render-review-page.js.
# RED at fdb070b5 (unmodified base: createWatcher has no render option, cli rejects --render, session-mode set
# passes no --render, renderer prints "current unchanged" after the switch and copies assets non-atomically): 19 passed, 29 failed, e.g.
#   FAIL S0 6 s later: exactly one publish: expected '1', got '0'
#   FAIL S2 new manifest: exactly one more publish: expected '2', got '0'
#   FAIL S5 task_status_receipt change: exactly one more publish: expected '6', got '0'
#   FAIL S6 the burst yields exactly one publish: expected '1', got '0'
#   FAIL S7 render error: one 'render failed' log line: expected 'yes', got 'no'
#   FAIL S8 unbound run gets its own unbound job: expected '1', got '0'
#   FAIL CLI --render <out-root>: a job page appears under the explicit root within 30 s (stderr: unknown status argument: --render)
#   FAIL session-mode set: the launched watcher's argv carries --render: expected 'yes', got 'no'
#   FAIL failure after the switch: a warning names the failed index step: expected 'yes', got 'no'
#   FAIL copyAssets renames a temp copy into place: expected 'yes', got 'no'
# Isolation: fake HOME / CLAUDE_CONFIG_DIR / XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR (a /dev/shm mktemp dir),
# AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_COSTS_FILE and the manifest dir all under a mktemp dir; no port is bound
# (AUTOPILOT_REVIEW_SERVER_AUTOSTART=0 from lib.sh); every background process is killed BY PID in the cleanup trap.
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; } # eq <expected> <actual> <msg>
CLI="$REPO_ROOT/bin/autopilot.js"
SM="$REPO_ROOT/scripts/session-mode.js"
RRP="$REPO_ROOT/scripts/render-review-page.js"
NODE="$(command -v node)"
SB="$TEST_TMP/rwr"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"; D="$SB/world"
AH="$FAKE_HOME/.autopilot"
mkdir -p "$AH" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO" "$D"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rwr-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_rwr() {
  local p
  for p in $KILL_PIDS; do kill -9 "$p" 2> /dev/null; done
  rm -rf "$LIVE"
}
trap 'cleanup_rwr; cleanup_test_tmp' EXIT
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
IDENT="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).repo_identity)' "$REPO_ROOT/src/status/project-key.js")"
REAL_AH_BEFORE="$(stat -c '%Y %n' "$HOME/.autopilot/live-pointer.json" "$HOME/.autopilot/session-mode" 2> /dev/null | tr '\n' ';')"

wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AH/session-mode" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" "$@"
}

# fake `autopilot status task` (the same injectable the renderer uses): prints $D/task.json
cat > "$SB/task-bin.sh" <<SH
#!/bin/sh
cat "$D/task.json"
SH
chmod +x "$SB/task-bin.sh"

# ---- 1. fake-clock driver: createWatcher + real publish() ------------------------------------------------
cat > "$SB/driver.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, key, ident, D, outRoot] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
let T = Date.parse('2026-10-04T03:00:00.000Z');
const world = { rows: [] };
const W = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); };
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
const mkRow = (id, root, extra = {}) => {
  const mf = path.join(D, 'manifests', `${id}.manifest.json`);
  W(mf, { run_id: id, root_run_id: root, ledger: path.join(D, 'led1', 'ledger.jsonl'), branch: 'p1b/x' });
  const exitFile = path.join(D, 'exits', `${id}.exit`);
  return { run_id: id, role: 'hand', runner: 'claude', model: 'sonnet', started_at: '2026-10-04T01:00:00.000Z', ended_at: null, parent_run_id: null, root_run_id: root, depth: 1, manifest: mf,
    project: ident, source: { manifest: mf, status_probe: null, exit_file: exitFile }, fact_at: '2026-10-04T01:00:00.000Z', observed_at: '2026-10-04T01:00:00.000Z', probe_age_s: null, rc: null, final_status: null, elapsed_s: 5, alive: null, ...extra };
};
// the fake collector derives phase from the exit file, like the real one
const collect = () => world.rows.map((r) => {
  const ex = fs.existsSync(r.source.exit_file);
  return { ...r, phase: ex ? 'exited' : 'running', rc: ex ? 0 : null, ended_at: ex ? '2026-10-04T01:09:00.000Z' : null, final_status: ex ? 'ok' : null };
});
fs.mkdirSync(path.join(D, 'led1'), { recursive: true }); W(path.join(D, 'led1', 'ledger.jsonl'), '');
W(path.join(D, 'task.json'), '{}');
const watcher = createWatcher({ key, env: process.env, cwd: path.join(D, '..', 'repo'), collect, now: () => T, interval: 10, enrichCap: 8, render: { outRoot } });
const tick = (dt) => { T += dt * 1000; try { watcher.tick(); return true; } catch (e) { out('tick_threw', e.message); return false; } };
const jobDir = (job) => path.join(outRoot, '2026-10-04', job);
const versions = (job) => { try { return fs.readdirSync(jobDir(job)).filter((n) => /^v-\d{8}T\d{6}\.\d{3}Z$/.test(n)).length; } catch (_e) { return 0; } };
const cur = (job) => { try { return fs.readlinkSync(path.join(jobDir(job), 'current')); } catch (_e) { return ''; } };
const page = (job) => { try { return fs.readFileSync(path.join(jobDir(job), 'current', 'index.html'), 'utf8'); } catch (_e) { return ''; } };
const has = (job, s) => (page(job).includes(s) ? 'yes' : 'no');
const task = (verdict, digest) => W(path.join(D, 'task.json'), { schema_version: 1, artifact_type: 'task_status_receipt', issued_at: '2026-10-04T01:20:00.000Z', repo_identity: ident, root_run_id: 'R1', goal: 'g', phase: 'p', candidate_commit: 'c'.repeat(40), candidate_tree_sha: 'c'.repeat(40), acceptance_verdict: verdict, accepted_blockers: [], deferred_count: 0, can_merge: true, can_close: true, failed_predicates: [], receipt_digest: digest });
const receipt = (verdict) => W(path.join(D, 'led1', 'receipt-plan.json'), { kind: 'review', phase: 'plan', branch: 'p1b/x', phase_base_sha: 'a'.repeat(40), chain: [{ generation: 1, base: 'a'.repeat(40), head: 'b'.repeat(40), status: 'finalized' }], verdict, open_findings: [], written_at: '2026-10-04T01:15:00.000Z' });

watcher.start();
// S0: first observation = new manifest; nothing before the debounce, one publish after it
world.rows = [mkRow('run-one', 'R1')];
task('unknown', '1'.repeat(64));
tick(0); out('s0_at0', versions('R1'));
tick(4); out('s0_at4', versions('R1'));
tick(2); out('s0_at6', versions('R1')); out('s0_has_run_one', has('R1', 'run-one'));
const c0 = cur('R1');
// S1: no event across many heartbeats -> no publish
for (let i = 0; i < 12; i += 1) tick(10);
out('s1_versions', versions('R1')); out('s1_same_current', cur('R1') === c0 ? 'yes' : 'no');
// S2: (a) a new manifest
world.rows.push(mkRow('run-two', 'R1'));
tick(10); tick(6);
out('s2_versions', versions('R1')); out('s2_current_changed', cur('R1') !== c0 ? 'yes' : 'no'); out('s2_has_run_two', has('R1', 'run-two'));
let prev = cur('R1');
// S3: (b) an .exit landing
W(path.join(D, 'exits', 'run-one.exit'), '0');
tick(10); tick(6);
out('s3_versions', versions('R1')); out('s3_current_changed', cur('R1') !== prev ? 'yes' : 'no'); out('s3_has_exited', has('R1', 'EXITED'));
prev = cur('R1');
// S4: (c) a receipt appears, then its mtime changes
receipt('PASS');
tick(10); tick(6);
out('s4a_versions', versions('R1')); out('s4a_has_gate', has('R1', 'PASS'));
prev = cur('R1');
receipt('FAIL'); const later = new Date(T + 60000); fs.utimesSync(path.join(D, 'led1', 'receipt-plan.json'), later, later);
tick(10); tick(6);
out('s4b_versions', versions('R1')); out('s4b_current_changed', cur('R1') !== prev ? 'yes' : 'no'); out('s4b_has_fail', has('R1', 'FAIL'));
prev = cur('R1');
// S5: (d) task_status_receipt change
task('accepted', '2'.repeat(64));
tick(10); tick(6);
out('s5_versions', versions('R1')); out('s5_current_changed', cur('R1') !== prev ? 'yes' : 'no'); out('s5_has_accepted', has('R1', 'ACCEPTED'));
const before6 = versions('R1');
// S6: a burst inside 5 s -> one publish
world.rows.push(mkRow('run-three', 'R1')); tick(1);
receipt('PASS'); const l2 = new Date(T + 120000); fs.utimesSync(path.join(D, 'led1', 'receipt-plan.json'), l2, l2); tick(1);
task('rejected', '3'.repeat(64)); tick(1);
out('s6_during_burst', versions('R1') - before6);
tick(10);
out('s6_after_burst', versions('R1') - before6);
tick(10); tick(10);
out('s6_stays', versions('R1') - before6);
// S7: a render error keeps the old page and the watcher alive; it retries later
const before7 = versions('R1'); const prev7 = cur('R1'); const page7 = page('R1');
process.env.AUTOPILOT_REVIEW_FAIL_AT = 'before-switch';
world.rows.push(mkRow('run-four', 'R1'));
let alive = true;
alive = tick(10) && alive; alive = tick(6) && alive; alive = tick(10) && alive;
out('s7_alive', alive ? 'yes' : 'no'); out('s7_versions', versions('R1') - before7);
out('s7_current_kept', cur('R1') === prev7 ? 'yes' : 'no'); out('s7_page_kept', page('R1') === page7 ? 'yes' : 'no');
const logFile = path.join(path.dirname(path.dirname(outRoot)), 'review', key, 'live', 'watcher.log');
let logText = ''; try { logText = fs.readFileSync(logFile, 'utf8'); } catch (_e) { /* none */ }
out('s7_logged', /render failed/.test(logText) ? 'yes' : 'no');
delete process.env.AUTOPILOT_REVIEW_FAIL_AT;
tick(70);
out('s7_retried', versions('R1') - before7); out('s7_has_run_four', has('R1', 'run-four'));
// S8: a run with no execution root lands in the per-project unbound job; R1 is untouched
const r1v = versions('R1');
world.rows.push({ ...mkRow('run-loose', null), root_run_id: null });
tick(10); tick(6);
out('s8_unbound_versions', versions('unbound')); out('s8_unbound_has', has('unbound', 'run-loose'));
out('s8_unbound_lacks_rooted', page('unbound').includes('run-one') ? 'no' : 'yes');
out('s8_r1_untouched', versions('R1') === r1v ? 'yes' : 'no');
watcher.finalPublish('stopped');
JS
export AUTOPILOT_RENDER_TASK_STATUS_BIN="$SB/task-bin.sh"
export AUTOPILOT_REVIEW_RETAIN_MS=999999999
OUT_ROOT="$AH/review/$KEY"
DRV="$(wenv "$NODE" "$SB/driver.js" "$REPO_ROOT" "$KEY" "$IDENT" "$D" "$OUT_ROOT" 2> "$SB/driver.err" < /dev/null)"; DRC=$?
eq 0 "$DRC" "driver exits 0 (stderr: $(head -c 300 "$SB/driver.err"))"
dv() { printf '%s\n' "$DRV" | sed -n "s/^$1=//p" | head -1; }
eq 0 "$(dv s0_at0)" "S0 first observation: nothing published before the debounce"
eq 0 "$(dv s0_at4)" "S0 4 s later: still nothing (debounce is 5 s)"
eq 1 "$(dv s0_at6)" "S0 6 s later: exactly one publish"
eq yes "$(dv s0_has_run_one)" "S0 page shows the run"
eq 1 "$(dv s1_versions)" "S1 twelve heartbeats with no event: still one version"
eq yes "$(dv s1_same_current)" "S1 current unchanged across heartbeats"
eq 2 "$(dv s2_versions)" "S2 new manifest: exactly one more publish"
eq yes "$(dv s2_current_changed)" "S2 current symlink target changed"
eq yes "$(dv s2_has_run_two)" "S2 page shows the new run"
eq 3 "$(dv s3_versions)" "S3 .exit landing: exactly one more publish"
eq yes "$(dv s3_current_changed)" "S3 current symlink target changed"
eq yes "$(dv s3_has_exited)" "S3 page shows EXITED"
eq 4 "$(dv s4a_versions)" "S4 receipt appears: exactly one more publish"
eq yes "$(dv s4a_has_gate)" "S4 page shows the receipt verdict"
eq 5 "$(dv s4b_versions)" "S4 receipt mtime changes: exactly one more publish"
eq yes "$(dv s4b_current_changed)" "S4 current changed after mtime change"
eq yes "$(dv s4b_has_fail)" "S4 page shows the new verdict"
eq 6 "$(dv s5_versions)" "S5 task_status_receipt change: exactly one more publish"
eq yes "$(dv s5_current_changed)" "S5 current changed"
eq yes "$(dv s5_has_accepted)" "S5 page shows the acceptance verdict"
eq 0 "$(dv s6_during_burst)" "S6 three events inside 5 s: nothing published during the burst"
eq 1 "$(dv s6_after_burst)" "S6 the burst yields exactly one publish"
eq 1 "$(dv s6_stays)" "S6 no further publish afterwards"
eq yes "$(dv s7_alive)" "S7 render error: the watcher keeps ticking"
eq 0 "$(dv s7_versions)" "S7 render error: no new version"
eq yes "$(dv s7_current_kept)" "S7 render error: current symlink kept"
eq yes "$(dv s7_page_kept)" "S7 render error: previous page kept"
eq yes "$(dv s7_logged)" "S7 render error: one 'render failed' log line"
eq 1 "$(dv s7_retried)" "S7 once the fault is gone the page is republished"
eq yes "$(dv s7_has_run_four)" "S7 republished page shows the run held back"
eq 1 "$(dv s8_unbound_versions)" "S8 unbound run gets its own unbound job"
eq yes "$(dv s8_unbound_has)" "S8 unbound page shows the unbound run"
eq yes "$(dv s8_unbound_lacks_rooted)" "S8 unbound page lacks rooted runs"
eq yes "$(dv s8_r1_untouched)" "S8 the rooted job was not republished"

# ---- 2. the real CLI: --render [<out-root>] (explicit and default) -------------------------------------
NOW=$(date +%s)
mk_manifest() { # id root
  printf '{"schema":1,"run_id":"%s","role":"implementer","runner":"codex","model":"m","started_at":"%s","started_epoch":%s,"ended_at":null,"ended_epoch":null,"final_status":null,"log_path":"/nonexistent","lock_path":null,"pid":null,"scope_unit":null,"log_format":"plain","ledger":null,"stage":null,"repo_identity":"%s","root_run_id":"%s","parent_run_id":null,"depth":0}\n' \
    "$1" "$(date -u -d "@$((NOW - 60))" +%Y-%m-%dT%H:%M:%SZ)" "$((NOW - 60))" "$IDENT" "$2" > "$RUNS/$1.manifest.json"
}
mk_manifest cli-run-1 CLIROOT
printf '{"schema_version":1,"artifact_type":"task_status_receipt","root_run_id":"CLIROOT","acceptance_verdict":"unknown","receipt_digest":"%s","can_close":null}\n' "$(printf 'd%.0s' $(seq 1 64))" > "$D/task.json"
EXPLICIT="$SB/explicit-out"
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --watch --project "$KEY" --interval 1 --render "$EXPLICIT" \
  > "$SB/w1.out" 2> "$SB/w1.err" < /dev/null & echo $! > "$SB/w1.launcher")
KILL_PIDS="$KILL_PIDS $(cat "$SB/w1.launcher")"
waitcur() { # <out-root>: waits for <out-root>/<date>/CLIROOT/current
  local i d
  for i in $(seq 1 300); do
    d="$(find "$1" -maxdepth 3 -path '*/CLIROOT/current' 2> /dev/null | head -1)"
    [ -n "$d" ] && [ -L "$d" ] && { echo yes; return; }
    sleep 0.1
  done
  echo no
}
eq yes "$(waitcur "$EXPLICIT")" "CLI --render <out-root>: a job page appears under the explicit root within 30 s (stderr: $(head -c 200 "$SB/w1.err"))"
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --stop --project "$KEY" > /dev/null 2>&1 < /dev/null)
sleep 1
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --watch --project "$KEY" --interval 1 --render \
  > "$SB/w2.out" 2> "$SB/w2.err" < /dev/null & echo $! > "$SB/w2.launcher")
KILL_PIDS="$KILL_PIDS $(cat "$SB/w2.launcher")"
eq yes "$(waitcur "$AH/review/$KEY")" "CLI --render (no value): default root <autopilot_home>/review/<project_key> (stderr: $(head -c 200 "$SB/w2.err"))"
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --stop --project "$KEY" > /dev/null 2>&1 < /dev/null)
(cd "$REPO" && wenv "$NODE" "$CLI" status runs --render > /dev/null 2> "$SB/w3.err" < /dev/null); RC3=$?
eq 2 "$RC3" "--render without --watch is a usage error"
sleep 1

# ---- 3. session-mode set launches the watcher with --render --------------------------------------------
export AUTOPILOT_RUNS_WATCH_AUTOSTART=1
rm -f "$LIVE/runs/$KEY.json"
(cd "$SB" && wenv CLAUDE_CODE_SESSION_ID=rwr-session-1 "$NODE" "$SM" set --level l3 --repo-root "$REPO" > "$SB/set.out" 2> "$SB/set.err" < /dev/null)
WP=""
for i in $(seq 1 150); do
  WP="$(node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$LIVE/runs/$KEY.json")"
  [ -n "$WP" ] && break
  sleep 0.1
done
[ -n "$WP" ] && KILL_PIDS="$KILL_PIDS $WP"
eq yes "$(tr '\0' ' ' < "/proc/${WP:-0}/cmdline" 2> /dev/null | grep -q -- '--render' && echo yes || echo no)" "session-mode set: the launched watcher's argv carries --render"
[ -n "$WP" ] && kill -9 "$WP" 2> /dev/null
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0

# ---- 4. B1b folds: failure after the switch is not "current unchanged"; assets are copied atomically ---
FX="$SB/fx"; mkdir -p "$FX/compare"
node -e '
const fs=require("fs"),path=require("path"),crypto=require("crypto");const F=process.argv[1];
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==","base64");
fs.writeFileSync(path.join(F,"compare","a.png"),png);
const sha=crypto.createHash("sha256").update(png).digest("hex");
const c="c".repeat(40);
fs.writeFileSync(path.join(F,"compare","r.json"),JSON.stringify({schema:"compare-record/1",id:"cmp",scene:"S",viewport:"390x844",browser:"chromium",fixture:"f",capture_method:"page.screenshot",before:{commit:c,dirty:false,path:"compare/a.png",sha256:sha,taken_at:"2026-10-04T01:00:00.000Z"},after:{commit:c,dirty:false,path:"compare/a.png",sha256:sha,taken_at:"2026-10-04T01:05:00.000Z"},metrics:[],images:{before:"a.png",after:"a.png"}}));
fs.writeFileSync(path.join(F,"runs.json"),JSON.stringify([]));
' "$FX"
OUT2="$SB/rrp-out"
rrp() { wenv "$NODE" "$RRP" --runs "$FX/runs.json" --task-receipt none --job J1 --date 2026-10-04 --project "$KEY" --now "$1" --compare "$FX/compare" --out-root "$OUT2" --repo "$REPO" "${@:2}"; }
AUTOPILOT_REVIEW_FAIL_AT=after-switch rrp 2026-10-04T02:00:00.000Z > "$SB/f1.out" 2> "$SB/f1.err" < /dev/null; RCF=$?
eq 0 "$RCF" "failure after the switch: rc 0 (the switch happened)"
eq published "$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status)}catch(_){}' "$SB/f1.out")" "failure after the switch: result status is published"
eq yes "$(grep -qi 'project index' "$SB/f1.out" "$SB/f1.err" && echo yes || echo no)" "failure after the switch: a warning names the failed index step"
eq no "$(grep -q 'current unchanged' "$SB/f1.err" "$SB/f1.out" && echo yes || echo no)" "failure after the switch: never says current unchanged"
eq yes "$([ -L "$OUT2/2026-10-04/J1/current" ] && echo yes || echo no)" "failure after the switch: current exists"
ASSET="$(find "$OUT2/2026-10-04/J1/assets" -type f -name '*.png' 2> /dev/null | head -1)"
eq yes "$([ -n "$ASSET" ] && cmp -s "$ASSET" "$FX/compare/a.png" && echo yes || echo no)" "asset copied intact"
eq 0 "$(find "$OUT2" -name '*.tmp-*' 2> /dev/null | wc -l | tr -d ' ')" "no .tmp-<pid> residue after publish"
# the copy is tmp + rename: a stale temp from a dead pid next to the destination neither breaks nor survives... and a truncated
# destination can only come from a non-atomic copy; prove the code path by checking the source of copyAssets uses rename.
eq yes "$(awk '/^function copyAssets/,/^}/' "$RRP" | grep -q 'renameSync' && echo yes || echo no)" "copyAssets renames a temp copy into place"

# ---- isolation proof ---------------------------------------------------------------------------------
eq "$REAL_AH_BEFORE" "$(stat -c '%Y %n' "$HOME/.autopilot/live-pointer.json" "$HOME/.autopilot/session-mode" 2> /dev/null | tr '\n' ';')" "real ~/.autopilot live-pointer + session-mode untouched"
finalize_test
