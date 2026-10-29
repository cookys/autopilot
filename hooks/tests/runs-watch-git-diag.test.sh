#!/usr/bin/env bash
# hooks/tests/runs-watch-git-diag.test.sh — BL-0329 C1: the watcher's two git failures say WHY they failed, once per change of reason.
#   - src/status/residue.js: "cannot resolve the main worktree" carries the exit code / timeout / spawn error and the first stderr line
#     (a timeout and a non-zero exit used to share one sentence), and is logged again only when the reason changes;
#   - src/status/runs-watch.js worktreePaths: the same for "git worktree list failed" (rc, ENOENT for a vanished cwd, stderr line);
#     writePaths logs once per reason instead of once per tick.
# Negative control inside: the SAME reason on the next publish/tick adds no line; a different reason adds one.
# Isolation: everything under a mktemp dir; no real HOME / live dir is touched.
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; }
NODE="$(command -v node)"
SB="$TEST_TMP/rwgd"
mkdir -p "$SB/home" "$SB/bin" "$SB/notarepo"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rwgd-XXXXXX)"; chmod 700 "$LIVE"
trap 'rm -rf "$LIVE"; [ -n "${KEEP:-}" ] || cleanup_test_tmp' EXIT
REPO="$SB/repo"; mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init

cat > "$SB/drv.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, sb, repo] = process.argv;
const { createResiduePublisher, failureWhy } = require(path.join(repoRoot, 'src/status/residue.js'));
const { worktreePaths } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
const writeAtomic = (f, t) => fs.writeFileSync(f, t);
// 1. failureWhy: a timeout, an exit code and a spawn error read differently
out('why_timeout', failureWhy({ error: new Error('timeout') }));
out('why_rc', failureWhy({ code: 3, err: 'boom\nsecond line' }));
out('why_spawn', failureWhy({ error: Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }) }));
// 2. residue publisher on a directory that is not a repo: rc + stderr in the log, once for the same reason, again for a new one
const logs = [];
const runsDir = path.join(process.env.LIVE_FOR_TEST || sb, 'runs'); fs.mkdirSync(runsDir, { recursive: true });
const mk = (repoDir) => createResiduePublisher({ runsDir, key: 'k', repo: repoDir, writeAtomic, log: (m) => logs.push(m), now: () => 0, throttleS: 0 });
(async () => {
  const pub = mk(path.join(sb, 'notarepo'));
  await pub.publish({ nowMs: 1 }); await pub.publish({ nowMs: 2 }); await pub.publish({ nowMs: 3 });
  out('res_lines_same_reason', logs.length);
  out('res_has_rc_and_stderr', /rc=128: fatal: not a git repository/.test(logs[0] || '') ? 'yes' : 'no');
  out('res_names_repo', (logs[0] || '').includes(path.join(sb, 'notarepo')) ? 'yes' : 'no');
  // a different reason (the directory is gone: spawn ENOENT does not apply to `git -C`; git reports rc=128 "cannot change to")
  const gone = mk(path.join(sb, 'gone'));
  const before = logs.length;
  await gone.publish({ nowMs: 4 });
  out('res_new_publisher_logs_once', logs.length - before);
  // 3. worktreePaths: reasons for a vanished cwd and a non-repo cwd
  const why = [];
  const scope = { repo_identity: 'git-common-dir:/x', project_key: 'k' };
  const r1 = worktreePaths({ cwd: path.join(sb, 'vanished'), scope, onFail: (w) => why.push(w) });
  const r2 = worktreePaths({ cwd: path.join(sb, 'notarepo'), scope, onFail: (w) => why.push(w) });
  const r3 = worktreePaths({ cwd: repo, scope, onFail: (w) => why.push(w) });
  out('wp_null_on_fail', r1 === null && r2 === null ? 'yes' : 'no');
  out('wp_ok_has_no_reason', r3 !== null && why.length === 2 ? 'yes' : `no(${why.length})`);
  out('wp_vanished', /^error ENOENT/.test(why[0] || '') ? 'yes' : `no(${why[0]})`);
  out('wp_notrepo', /^rc=128: fatal: not a git repository/.test(why[1] || '') ? 'yes' : `no(${why[1]})`);
})();
JS
OUT="$(HOME="$SB/home" LIVE_FOR_TEST="$LIVE" "$NODE" "$SB/drv.js" "$REPO_ROOT" "$SB" "$REPO" 2> "$SB/drv.err" < /dev/null)"; RC=$?
eq 0 "$RC" "driver exits 0 (stderr: $(head -c 300 "$SB/drv.err"))"
dv() { printf '%s\n' "$OUT" | sed -n "s/^$1=//p" | head -1; }
eq timeout "$(dv why_timeout)" "a timeout reads 'timeout'"
eq "rc=3: boom" "$(dv why_rc)" "a non-zero exit reads 'rc=N: <first stderr line>'"
eq yes "$([ "$(dv why_spawn)" = 'error ENOENT' ] && echo yes || echo no)" "a spawn error reads 'error <code>'"
eq 1 "$(dv res_lines_same_reason)" "residue: three publishes failing the same way log one line"
eq yes "$(dv res_has_rc_and_stderr)" "residue: the line carries rc=128 and git's stderr"
eq yes "$(dv res_names_repo)" "residue: the line names the directory"
eq 1 "$(dv res_new_publisher_logs_once)" "residue: a different failing directory logs again (negative control: dedup keeps real changes)"
eq yes "$(dv wp_null_on_fail)" "worktreePaths: a failing listing still returns null (caller keeps the previous map)"
eq yes "$(dv wp_ok_has_no_reason)" "worktreePaths: a good repo reports no reason (two failures, one success)"
eq yes "$(dv wp_vanished)" "worktreePaths: a vanished cwd reads 'error ENOENT'"
eq yes "$(dv wp_notrepo)" "worktreePaths: a non-repo cwd reads 'rc=128: fatal: not a git repository'"

# ---- watcher level: writePaths logs once per reason across ticks ---------------------------------------------------
cat > "$SB/w.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, sb, repo] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const { scopeFromCwd } = require(path.join(repoRoot, 'src/status/project-key.js'));
const key = scopeFromCwd(repo).project_key;
let T = Date.parse('2026-10-04T03:00:00.000Z');
const gone = path.join(sb, 'wt-gone');
fs.mkdirSync(gone, { recursive: true });
// the watcher thinks it runs in `gone` (a scope for the repo) and then the directory vanishes
const w = createWatcher({ key, env: process.env, cwd: repo, collect: () => [], now: () => T, interval: 10 });
w.start();
const logFile = path.join(path.dirname(require(path.join(repoRoot, 'src/status/live-pointer.js')).pointerPath(process.env)), 'review', key, 'live', 'watcher.log');
const lines = () => { try { return fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /git worktree list failed/.test(l)); } catch (_e) { return []; } };
// make the repo vanish under the running watcher: point its git at nothing by renaming the repo away
fs.renameSync(repo, repo + '.moved');
for (let i = 0; i < 4; i += 1) { T += 11000; w.tick(); }
process.stdout.write(`lines=${lines().length}\nfirst=${(lines()[0] || '').replace(/^\S+ /, '')}\n`);
fs.renameSync(repo + '.moved', repo);
JS
WOUT="$(HOME="$SB/home" AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_REVIEW_SERVER_AUTOSTART=0 "$NODE" "$SB/w.js" "$REPO_ROOT" "$SB" "$REPO" 2> "$SB/w.err" < /dev/null)"
eq 1 "$(printf '%s\n' "$WOUT" | sed -n 's/^lines=//p')" "watcher: four ticks failing the same way log 'git worktree list failed' once"
eq yes "$(printf '%s\n' "$WOUT" | sed -n 's/^first=//p' | grep -q 'error ENOENT' && echo yes || echo no)" "watcher: the line says why (error ENOENT: the cwd is gone)"

# ---- residue SCAN failures: one line per reason, again when the reason changes, reset by a success (same publisher instance) --------------
cat > "$SB/sweep.js" <<'JS'
const fs = require('fs');
const mode = fs.readFileSync(process.argv[1] + '.mode', 'utf8').trim();
if (mode === 'ok') { process.stdout.write(JSON.stringify({ worktrees: [] })); process.exit(0); }
process.stderr.write(`sweep ${mode}\n`); process.exit(mode === 'f1' ? 2 : 3);
JS
cat > "$SB/scan.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, sb, repo, live] = process.argv;
const { createResiduePublisher } = require(path.join(repoRoot, 'src/status/residue.js'));
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
const sweep = path.join(sb, 'sweep.js');
const logs = [];
const runsDir = path.join(live, 'runs2'); fs.mkdirSync(runsDir, { recursive: true });
const pub = createResiduePublisher({ runsDir, key: 'k2', repo, writeAtomic: (f, t) => fs.writeFileSync(f, t), log: (m) => logs.push(m), now: () => 0, throttleS: 0, sweep });
let n = 0;
const step = async (mode) => { fs.writeFileSync(sweep + '.mode', mode); n += 1; await pub.publish({ nowMs: n }); return logs.filter((l) => /residue scan failed/.test(l)).length; };
(async () => {
  out('s1', await step('f1')); out('s2_same', await step('f1')); out('s3_same', await step('f1'));
  out('s4_changed', await step('f2'));
  out('s5_ok_adds_none', await step('ok')); out('file_written', fs.existsSync(pub.file) ? 'yes' : 'no');
  out('s6_after_reset', await step('f2'));
})();
JS
SCAN="$(HOME="$SB/home" "$NODE" "$SB/scan.js" "$REPO_ROOT" "$SB" "$REPO" "$LIVE" 2> "$SB/scan.err" < /dev/null)"
sv() { printf '%s\n' "$SCAN" | sed -n "s/^$1=//p" | head -1; }
eq 1 "$(sv s1)" "scan failure: first failure logs one line"
eq 1 "$(sv s2_same)" "scan failure: the same reason again adds nothing"
eq 1 "$(sv s3_same)" "scan failure: and again"
eq 2 "$(sv s4_changed)" "scan failure: a changed reason (rc 3) logs once more"
eq 2 "$(sv s5_ok_adds_none)" "scan success adds no failure line"
eq yes "$(sv file_written)" "scan success writes the residue file"
eq 3 "$(sv s6_after_reset)" "scan failure after a success logs again (the success reset the memory)"

finalize_test
