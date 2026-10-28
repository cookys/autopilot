#!/usr/bin/env bash
# hooks/tests/runs-watch-git-stable.test.sh — BL-0329 C2: the watcher's git calls run in the MAIN checkout, not in the cwd it was started in.
# Reproduction (red before the fix): a watcher started from a LINKED worktree outlives it; once the worktree is removed, `git worktree list`
# (paths file) and the residue scan fail forever (spawn ENOENT / rc 128). Cases:
#   1. watcher with cwd = linked worktree, worktree removed -> the paths file is still rewritten, the residue file appears, nothing logged as failed;
#   2. negative control: the stable root (main checkout) itself vanishes -> the failure is real, logged ONCE with its reason;
#   3. negative control: GIT_DIR=/nonexistent in the watcher's environment -> still works (repo-selecting variables are dropped for its git children);
#      without the variable the behaviour is unchanged (case 1 is that run);
#   4. hooks/runs-watch-autostart.js started from a linked worktree launches the watcher with the MAIN checkout as its cwd.
# Isolation: HOME / live dir (/dev/shm) / AUTOPILOT_HOME under mktemp; real watchers are killed BY PID in the trap.
. "$(dirname "$0")/lib.sh"

eq() { assert_eq "$2" "$1" "$3"; }
NODE="$(command -v node)"
SB="$TEST_TMP/rwgs"
FAKE_HOME="$SB/home"; FAKE_CLAUDE="$SB/claude"; FAKE_XDG="$SB/xdg"; RUNS="$SB/runs"
mkdir -p "$FAKE_HOME/.autopilot" "$FAKE_CLAUDE/metrics" "$FAKE_XDG" "$RUNS"
LIVE="$(mktemp -d -p /dev/shm autopilot-test-rwgs-XXXXXX)"; chmod 700 "$LIVE"
KILL_PIDS=""
cleanup_rwgs() { local p; for p in $KILL_PIDS; do kill -9 "$p" 2> /dev/null; done; rm -rf "$LIVE"; }
trap 'cleanup_rwgs; [ -n "${KEEP:-}" ] || cleanup_test_tmp' EXIT
wenv() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$FAKE_HOME" CLAUDE_CONFIG_DIR="$FAKE_CLAUDE" XDG_RUNTIME_DIR="$FAKE_XDG" \
    AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_SESSION_MODE_DIR="$FAKE_HOME/.autopilot/session-mode" AUTOPILOT_COSTS_FILE="$SB/costs.jsonl" \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" ENGINE_CAPABILITY_DIR="$SB/cap" AUTOPILOT_REVIEW_SERVER_AUTOSTART=0 "$@"
}
mkrepo() { # <dir>: a repo with one commit
  mkdir -p "$1"; git -C "$1" init -q; git -C "$1" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init
}

cat > "$SB/w.js" <<'JS'
// usage: w.js <repoRoot> <mode> <main> <wt> <home> ; mode = wt | wt-gitdir | main-gone
const fs = require('fs'); const path = require('path');
const [, , repoRoot, mode, main, wt] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const { scopeFromCwd } = require(path.join(repoRoot, 'src/status/project-key.js'));
const key = scopeFromCwd(wt).project_key;
const out = (k, v) => process.stdout.write(`${k}=${v}\n`);
let T = Date.parse('2026-10-04T03:00:00.000Z');
const w = createWatcher({ key, env: process.env, cwd: wt, collect: () => [], now: () => T, interval: 10 });
w.start();
const live = process.env.AUTOPILOT_LIVE_DIR;
const pathsFile = path.join(live, 'runs', 'paths', `${key}.json`);
const residueFile = path.join(live, 'runs', `${key}.residue.json`);
const logFile = path.join(path.dirname(require(path.join(repoRoot, 'src/status/live-pointer.js')).pointerPath(process.env)), 'review', key, 'live', 'watcher.log');
const logText = () => { try { return fs.readFileSync(logFile, 'utf8'); } catch (_e) { return ''; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  w.tick(); // first publish with the worktree still there
  out('before_paths', fs.existsSync(pathsFile) ? 'yes' : 'no');
  for (let i = 0; i < 150 && !fs.existsSync(residueFile); i += 1) await wait(100); // let the first async scan finish so it cannot race the removal
  out('before_residue', fs.existsSync(residueFile) ? 'yes' : 'no');
  fs.rmSync(pathsFile, { force: true });
  if (mode === 'main-gone') fs.renameSync(main, `${main}.moved`);
  else fs.rmSync(wt, { recursive: true, force: true }); // the linked worktree is removed under the running watcher
  if (mode === 'wt-gitdir') process.env.GIT_DIR = '/nonexistent';
  fs.rmSync(residueFile, { force: true });
  for (let i = 0; i < 3; i += 1) { T += 61000; w.tick(); await wait(50); }
  for (let i = 0; i < 150 && !fs.existsSync(residueFile) && mode !== 'main-gone'; i += 1) await wait(100); // the async scan
  out('after_paths', fs.existsSync(pathsFile) ? 'yes' : 'no');
  out('after_residue', fs.existsSync(residueFile) ? 'yes' : 'no');
  const text = logText();
  out('log_paths_failed', (text.match(/git worktree list failed/g) || []).length);
  out('log_residue_failed', (text.match(/cannot resolve the main worktree/g) || []).length);
  out('log_reason', /error ENOENT|rc=128/.test(text) ? 'yes' : 'no');
  if (mode === 'main-gone') fs.renameSync(`${main}.moved`, main);
  w.finalPublish('stopped');
})();
JS
run_case() { # <mode> -> sets CASE_OUT
  local main="$SB/main-$1" wt="$SB/wt-$1"
  mkrepo "$main"; git -C "$main" worktree add -q "$wt" -b "b-$1" 2> /dev/null
  CASE_OUT="$(wenv "$NODE" "$SB/w.js" "$REPO_ROOT" "$1" "$main" "$wt" 2> "$SB/w-$1.err" < /dev/null)"
}
cv() { printf '%s\n' "$CASE_OUT" | sed -n "s/^$1=//p" | head -1; }

# ---- 1. worktree removed under a worktree-started watcher ----------------------------------------------------------
run_case wt
eq yes "$(cv before_paths)" "precondition: the first tick writes the paths file from the worktree cwd"
eq yes "$(cv before_residue)" "precondition: the first residue scan publishes its file"
eq yes "$(cv after_paths)" "REPRO: after the worktree is removed the paths file is still rewritten (git runs in the main checkout)"
eq yes "$(cv after_residue)" "REPRO: the residue file is still published after the worktree is removed"
eq 0 "$(cv log_paths_failed)" "no 'git worktree list failed' line"
eq 0 "$(cv log_residue_failed)" "no 'cannot resolve the main worktree' line"

# ---- 3. repo-selecting variables are dropped for the watcher's git children --------------------------------------------------
run_case wt-gitdir
eq yes "$(cv after_paths)" "GIT_DIR=/nonexistent in the watcher env: the paths file is still written (negative control for the env clean-up)"
eq yes "$(cv after_residue)" "GIT_DIR=/nonexistent: the residue file is still published"
eq 0 "$(cv log_paths_failed)" "GIT_DIR=/nonexistent: no worktree-list failure logged"

# ---- 2. the stable root really going away is a real failure, logged once with its reason ----------------------------------------
run_case main-gone
eq no "$(cv after_paths)" "negative control: the main checkout vanished: no paths file (the failure is real)"
eq 1 "$(cv log_paths_failed)" "negative control: the failure is logged once across three ticks"
eq yes "$(cv log_reason)" "negative control: the line carries its reason (ENOENT / rc=128)"

# ---- 4. autostart launches the watcher in the main checkout ------------------------------------------------------------------
MAIN="$SB/main-auto"; WT="$SB/wt-auto"
mkrepo "$MAIN"; mkdir -p "$MAIN/.claude"; printf '# dispatch\n' > "$MAIN/.claude/dispatch-config.md"
git -C "$MAIN" worktree add -q "$WT" -b b-auto 2> /dev/null
KEY="$(cd "$MAIN" && node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.cwd()).project_key)' "$REPO_ROOT/src/status/project-key.js")"
ENV_FILE="$LIVE/runs/$KEY.json"
(cd "$SB" && printf '{"hook_event_name":"UserPromptSubmit","session_id":"auto-s","cwd":"%s"}' "$WT" | wenv AUTOPILOT_RUNS_WATCH_AUTOSTART=1 "$NODE" "$REPO_ROOT/hooks/runs-watch-autostart.js" > "$SB/h.out" 2> "$SB/h.err")
WPID=""
for i in $(seq 1 150); do
  WPID="$(node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(e.writer&&e.writer.pid)process.stdout.write(String(e.writer.pid))}catch(_){}' "$ENV_FILE")"
  [ -n "$WPID" ] && break; sleep 0.1
done
[ -n "$WPID" ] && KILL_PIDS="$KILL_PIDS $WPID"
eq yes "$([ -n "$WPID" ] && echo yes || echo no)" "autostart from a linked worktree starts a watcher"
REAL_MAIN="$(realpath "$MAIN")"
eq "$REAL_MAIN" "$(readlink "/proc/$WPID/cwd" 2> /dev/null)" "the watcher's cwd is the MAIN checkout, not the linked worktree"

# ---- 5. the task-status poll gets the cleaned environment too (GIT_DIR from the hook must not reach it) ---------------------------------
cat > "$SB/task-env-bin.sh" <<SH
#!/bin/sh
echo "\${GIT_DIR:-unset}" > "$SB/task-git-dir"
exit 1
SH
chmod +x "$SB/task-env-bin.sh"
cat > "$SB/tp.js" <<'JS'
const fs = require('fs'); const path = require('path');
const [, , repoRoot, main, sb] = process.argv;
const { createWatcher } = require(path.join(repoRoot, 'src/status/runs-watch.js'));
const { scopeFromCwd } = require(path.join(repoRoot, 'src/status/project-key.js'));
const key = scopeFromCwd(main).project_key;
const mf = path.join(sb, 'tp-manifest.json'); fs.writeFileSync(mf, JSON.stringify({ run_id: 'r1', root_run_id: 'RX', ledger: path.join(sb, 'tp-ledger.jsonl'), branch: 'x' })); fs.writeFileSync(path.join(sb, 'tp-ledger.jsonl'), '');
const row = { run_id: 'r1', role: 'hand', runner: 'claude', model: 'sonnet', started_at: '2026-10-04T01:00:00.000Z', ended_at: '2026-10-04T01:09:00.000Z', parent_run_id: null, root_run_id: 'RX', depth: 1, manifest: mf,
  project: scopeFromCwd(main).repo_identity, source: { manifest: mf, status_probe: null, exit_file: path.join(sb, 'tp.exit') }, fact_at: '2026-10-04T01:00:00.000Z', observed_at: '2026-10-04T01:00:00.000Z', probe_age_s: null, rc: 0, final_status: 'ok', elapsed_s: 5, alive: null, phase: 'exited' };
let T = Date.parse('2026-10-04T03:00:00.000Z');
const w = createWatcher({ key, env: process.env, cwd: main, collect: () => [row], now: () => T, interval: 10, render: { outRoot: path.join(sb, 'tp-out') } });
w.start();
process.env.GIT_DIR = '/nonexistent'; // set after construction, as an inherited hook environment would carry it
w.tick();
w.finalPublish('stopped');
JS
TPMAIN="$SB/main-tp"; mkrepo "$TPMAIN"
rm -f "$SB/task-git-dir"
wenv AUTOPILOT_RENDER_TASK_STATUS_BIN="$SB/task-env-bin.sh" "$NODE" "$SB/tp.js" "$REPO_ROOT" "$TPMAIN" "$SB" > /dev/null 2> "$SB/tp.err" < /dev/null
eq unset "$(cat "$SB/task-git-dir" 2> /dev/null)" "task poll with GIT_DIR=/nonexistent in the watcher env: the task-status child sees no GIT_DIR"

finalize_test
