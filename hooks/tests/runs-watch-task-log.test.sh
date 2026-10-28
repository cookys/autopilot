#!/usr/bin/env bash
# hooks/tests/runs-watch-task-log.test.sh — BL-0328: a root whose `status task` call fails must not flood watcher.log.
# Root cause: pollTask returned the cached digest on failure without refreshing cache.at, so a settled root re-polled (15 s rule) and re-wrote
# a stderr line on EVERY tick, and callTaskStatus wrote that line straight to the watcher's stderr (no timestamp, outside log()).
# Cases: (1) always-failing task bin, 10 settled ticks -> one timestamped log line, no stderr, polls obey the 15 s interval;
# (2) negative control: success -> fail -> success -> fail logs each transition, dedup must not swallow real changes;
# (3) rotation: above the cap -> watcher.log.1, below -> untouched, and startWatcherDetached rotates before it opens its fd;
# (4) the CLI renderer keeps its stderr line.
# Isolation: fake HOME / CLAUDE_CONFIG_DIR / XDG_RUNTIME_DIR, AUTOPILOT_LIVE_DIR (/dev/shm mktemp), everything else under a mktemp dir.
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; }
NODE="$(command -v node)"
SB="$TEST_TMP/rwtl"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"; REPO="$SB/repo"; D="$SB/world"
AH="$FAKE_HOME/.autopilot"
mkdir -p "$AH" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS" "$REPO" "$D"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rwtl-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_rwtl() { local p; for p in $KILL_PIDS; do kill -9 "$p" 2> /dev/null; done; rm -rf "$LIVE"; }
trap 'cleanup_rwtl; cleanup_test_tmp' EXIT
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
KEY="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
IDENT="$(cd "$REPO" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).repo_identity)' "$REPO_ROOT/src/status/project-key.js")"
wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$AH/session-mode" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" "$@"
}
DIGEST="$(printf 'a%.0s' $(seq 1 64))"
# fake `status task`: counts calls; exits per $D/mode (fail -> rc 1 with a stderr line, ok -> a minimal receipt)
cat > "$SB/task-bin.sh" <<SH
#!/bin/sh
echo x >> "$D/calls"
if [ "\$(cat "$D/mode")" = fail ]; then echo "TASK_STATUS_INPUT_UNAVAILABLE: no input" >&2; exit 1; fi
echo '{"schema_version":1,"artifact_type":"task_status_receipt","receipt_digest":"$DIGEST","acceptance_verdict":"unknown","goal":"g","phase":"p","candidate_commit":"c","can_merge":true,"can_close":true,"failed_predicates":[],"accepted_blockers":[],"deferred_count":0}'
SH
chmod +x "$SB/task-bin.sh"
LOGF="$AH/review/$KEY/live/watcher.log"

cat > "$SB/driver.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, key, ident, D, outRoot, logFile] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
let T = Date.parse('2026-10-04T03:00:00.000Z');
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
const W = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, v); };
const mf = path.join(D, 'manifests', 'r1.manifest.json');
W(mf, JSON.stringify({ run_id: 'r1', root_run_id: 'RX', ledger: path.join(D, 'ledger.jsonl'), branch: 'x' })); W(path.join(D, 'ledger.jsonl'), '');
// a SETTLED root (the exited row): the 15 s re-poll rule applies
const row = { run_id: 'r1', role: 'hand', runner: 'claude', model: 'sonnet', started_at: '2026-10-04T01:00:00.000Z', ended_at: '2026-10-04T01:09:00.000Z', parent_run_id: null, root_run_id: 'RX', depth: 1, manifest: mf,
  project: ident, source: { manifest: mf, status_probe: null, exit_file: path.join(D, 'r1.exit') }, fact_at: '2026-10-04T01:00:00.000Z', observed_at: '2026-10-04T01:00:00.000Z', probe_age_s: null, rc: 0, final_status: 'ok', elapsed_s: 5, alive: null, phase: 'exited' };
const rows = [row];
const w = createWatcher({ key, env: process.env, cwd: path.join(D, '..', 'repo'), collect: () => rows, now: () => T, interval: 10, enrichCap: 8, render: { outRoot } });
w.start();
const tick = (dt) => { T += dt * 1000; try { w.tick(); } catch (e) { out('tick_threw', e.message); } };
const calls = () => { try { return fs.readFileSync(path.join(D, 'calls'), 'utf8').split('\n').filter(Boolean).length; } catch (_e) { return 0; } };
const logLines = () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /status task unavailable/.test(l)); } catch (_e) { return []; } };
const mode = (m) => W(path.join(D, 'mode'), m);

// 1. always failing: ten settled ticks, 10 s apart
mode('fail'); W(path.join(D, 'calls'), '');
for (let i = 0; i < 10; i += 1) tick(i === 0 ? 0 : 10);
out('c1_log_lines', logLines().length);
out('c1_log_timestamped', logLines().every((l) => /^\d{4}-\d\d-\d\dT/.test(l)) && logLines().length > 0 ? 'yes' : 'no');
out('c1_log_has_reason', logLines().some((l) => /rc 1/.test(l) && /TASK_STATUS_INPUT_UNAVAILABLE/.test(l)) ? 'yes' : 'no');
out('c1_polls_le_6', calls() <= 6 ? 'yes' : `no(${calls()})`);
// 2. transitions: success, fail, success, fail -> the log gains exactly one line per transition into failing
const before = logLines().length;
mode('ok'); tick(20); tick(20);
out('c2_ok_adds_none', logLines().length - before);
mode('fail'); tick(20); tick(20); tick(20);
out('c2_fail_again_adds_one', logLines().length - before);
mode('ok'); tick(20);
mode('fail'); tick(20); tick(20);
out('c2_third_fail_adds_one_more', logLines().length - before);
w.finalPublish('stopped');
JS
export AUTOPILOT_RENDER_TASK_STATUS_BIN="$SB/task-bin.sh"
export AUTOPILOT_REVIEW_RETAIN_MS=999999999
DRV="$(wenv "$NODE" "$SB/driver.js" "$REPO_ROOT" "$KEY" "$IDENT" "$D" "$AH/review/$KEY" "$LOGF" 2> "$SB/driver.err" < /dev/null)"; DRC=$?
eq 0 "$DRC" "driver exits 0 (stderr: $(head -c 300 "$SB/driver.err"))"
dv() { printf '%s\n' "$DRV" | sed -n "s/^$1=//p" | head -1; }
eq 1 "$(dv c1_log_lines)" "failing root: exactly one 'status task unavailable' line in watcher.log over ten ticks"
eq yes "$(dv c1_log_timestamped)" "the line is timestamped (it goes through the watcher log, not raw stderr)"
eq yes "$(dv c1_log_has_reason)" "the line names the rc and the first stderr line"
eq yes "$(dv c1_polls_le_6)" "polls obey the 15 s re-poll interval (at most 6 calls in ten 10 s ticks)"
eq 0 "$(grep -c 'status task unavailable' "$SB/driver.err")" "nothing is written to the watcher's stderr"
eq 0 "$(dv c2_ok_adds_none)" "recovery adds no failure line"
eq 1 "$(dv c2_fail_again_adds_one)" "negative control: the next failure after a success IS logged (dedup keeps real transitions)"
eq 2 "$(dv c2_third_fail_adds_one_more)" "negative control: and the one after that"

# ---- 3. rotation helper + log() ---------------------------------------------------------------------------
cat > "$SB/rot.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, dir] = process.argv;
const { rotateWatcherLog, WATCHER_LOG_MAX_BYTES } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
out('cap', WATCHER_LOG_MAX_BYTES);
const f = path.join(dir, 'watcher.log');
fs.writeFileSync(f, Buffer.alloc(1024));
out('small_rotated', rotateWatcherLog(f, 2048) ? 'yes' : 'no'); out('small_no_dot1', fs.existsSync(f + '.1') ? 'yes' : 'no');
fs.writeFileSync(f, Buffer.alloc(4096)); fs.writeFileSync(f + '.1', 'old');
out('big_rotated', rotateWatcherLog(f, 2048) ? 'yes' : 'no'); out('big_dot1_size', fs.statSync(f + '.1').size); out('big_orig_gone', fs.existsSync(f) ? 'no' : 'yes');
out('missing_ok', rotateWatcherLog(path.join(dir, 'nope.log'), 1) ? 'yes' : 'no');
JS
mkdir -p "$SB/rotdir"
ROT="$(wenv "$NODE" "$SB/rot.js" "$REPO_ROOT" "$SB/rotdir" 2> "$SB/rot.err" < /dev/null)"
rv() { printf '%s\n' "$ROT" | sed -n "s/^$1=//p" | head -1; }
eq 5242880 "$(rv cap)" "cap is 5 MiB"
eq no "$(rv small_rotated)" "below the cap: not rotated"
eq no "$(rv small_no_dot1)" "below the cap: no .1 created"
eq yes "$(rv big_rotated)" "above the cap: rotated"
eq 4096 "$(rv big_dot1_size)" "above the cap: .1 holds the big file (the older .1 is replaced, one generation)"
eq yes "$(rv big_orig_gone)" "above the cap: the live name is free for a fresh file"
eq no "$(rv missing_ok)" "a missing log is fail-open (no throw, no rotation)"

# a log() call while watcher.log is over the cap: .1 appears and the new log is small
mkdir -p "$(dirname "$LOGF")"; rm -f "$LOGF.1"
head -c 6291456 /dev/zero > "$LOGF"
cat > "$SB/rot2.js" <<'JS'
const path = require('path');
const [, , repoRoot, key, cwd] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const w = createWatcher({ key, env: process.env, cwd, collect: () => [], now: () => Date.now(), interval: 10 });
w.log('rotation probe');
JS
wenv "$NODE" "$SB/rot2.js" "$REPO_ROOT" "$KEY" "$REPO" < /dev/null 2> "$SB/rot2.err"
eq yes "$([ -f "$LOGF.1" ] && echo yes || echo no)" "log() over the cap: watcher.log.1 appears"
eq yes "$([ "$(stat -c %s "$LOGF")" -lt 1000 ] && echo yes || echo no)" "log() over the cap: the new watcher.log is small"
eq yes "$(grep -q 'rotation probe' "$LOGF" && echo yes || echo no)" "log() over the cap: the line is in the new file"
# negative control: under the cap nothing rotates
rm -f "$LOGF.1"; printf 'x\n' > "$LOGF"
wenv "$NODE" "$SB/rot2.js" "$REPO_ROOT" "$KEY" "$REPO" < /dev/null 2> "$SB/rot2.err"
eq no "$([ -f "$LOGF.1" ] && echo yes || echo no)" "negative control: a small log is not rotated"

# startWatcherDetached rotates before it opens the fd it hands the child (real watcher, idle-exits by itself; killed by pid in the trap anyway)
rm -f "$LOGF.1"; head -c 6291456 /dev/zero > "$LOGF"
cat > "$SB/sw.js" <<'JS'
const path = require('path');
const [, , repoRoot, key, cwd] = process.argv;
const { startWatcherDetached } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const r = startWatcherDetached({ key, cwd, env: process.env, idleExit: 2, interval: 1 });
process.stdout.write(`status=${r.status}\n`);
JS
SW="$(wenv "$NODE" "$SB/sw.js" "$REPO_ROOT" "$KEY" "$REPO" < /dev/null 2> "$SB/sw.err")"
for i in $(seq 1 100); do [ -f "$LOGF.1" ] && break; sleep 0.1; done
eq yes "$([ -f "$LOGF.1" ] && echo yes || echo no)" "startWatcherDetached over the cap: watcher.log.1 appears before the child's fd opens ($SW)"
for d in /proc/[0-9]*; do
  a="$(cat "$d/cmdline" 2> /dev/null | tr '\0' ' ')"
  case "$a" in *"status runs --watch --project $KEY"*) KILL_PIDS="$KILL_PIDS ${d#/proc/}";; esac
done

# ---- 4. the CLI renderer keeps its own stderr line -----------------------------------------------------------
cat > "$SB/cli.js" <<'JS'
const path = require('path');
const { callTaskStatus } = require(path.join(process.argv[2], 'scripts/render-review-page.js'));
const seen = [];
const r1 = callTaskStatus('RX', process.argv[3], process.env); // no onFail: stderr, as before
const r2 = callTaskStatus('RX', process.argv[3], process.env, { onFail: (m) => seen.push(m) });
process.stdout.write(`r1=${r1}\nr2=${r2}\nseen=${seen.length}\n`);
JS
printf fail > "$D/mode"
CLI_OUT="$(wenv "$NODE" "$SB/cli.js" "$REPO_ROOT" "$REPO" 2> "$SB/cli.err" < /dev/null)"
eq 1 "$(grep -c '^render-review-page: status task unavailable for RX (rc 1)$' "$SB/cli.err")" "CLI path (no onFail): the stderr line is unchanged"
eq 1 "$(printf '%s\n' "$CLI_OUT" | sed -n 's/^seen=//p')" "onFail path: the reason goes to the callback instead"

finalize_test
