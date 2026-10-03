'use strict';
// src/status/runs-watch.js — the per-project runs watcher (mods plan P1a R4a).
//
//   autopilot status runs --watch --project <key> [--interval 10] [--idle-exit 3600]
//   autopilot status runs --stop  --project <key>
//
// One watcher process per project is the ONLY writer of the live projection:
//   <live>/runs/<project_key>.json                    every run of the project
//   <live>/runs/<project_key>--<root_run_id>.json     one per observed execution root
//   <autopilot_home>/review/<project_key>/live/runs.<scope_key>.json   SSD fallback copies
//   <live>/runs/paths/<project_key>.json              worktree realpath -> project (own project only)
// Every file is written tmp + rename. A reader MUST check envelope.scope against the scope it
// wants (readEnvelope does) — a mismatch is treated as a missing file.
//
// Lock form (plan P1a option ii): the writer is started as
//   sh -c 'exec 9>"$LOCK"; flock -n 9 || exit 75; exec node <autopilot bin> status runs --watch …'
// so the node process itself holds the locked open file description (fd 9) and its pid is the
// envelope's writer.pid. Node has no flock; flock(1) is mandatory and there is NO lockfile
// fallback (a plain lockfile survives a crash and would break recovery). Probe children are
// spawned by Node, which only hands stdio 0-2 to them, so they never inherit fd 9.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveLiveDir } = require('../../scripts/lib/live-state-dir');
const { projectKey, scopeFromCwd } = require('./project-key');
const { pointerPath, writeLivePointer } = require('./live-pointer');
const { applySelectors } = require('./runs-fields');

const SCHEMA = 'autopilot.runs-live/1';
const VALID_FOR_S = 180;
const HEARTBEAT_S = 60;
const DEFAULT_INTERVAL_S = 10;
const DEFAULT_IDLE_EXIT_S = 3600;
const RECENT_SESSION_MS = 24 * 3600 * 1000;
const LOCK_BUSY_RC = 75;
const LOCKED_ENV = 'AUTOPILOT_RUNS_WATCH_LOCKED';
// Fields that change on every observation even when nothing happened; they do not make a payload "changed".
const VOLATILE_ROW_FIELDS = ['observed_at', 'probe_age_s', 'elapsed_s', 'last_event_age_s'];

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_cleanup) { /* best effort */ }
    throw error;
  }
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96) || '_';
}

function autopilotHomeOf(env) {
  return path.dirname(pointerPath(env));
}

function liveBaseOf(env) {
  return resolveLiveDir({ env, warn: () => {} }).base;
}

function lockPathOf(env, key) {
  return path.join(liveBaseOf(env), 'runs', `${key}.lock`);
}

function manifestDirOf(env) {
  return env.AUTOPILOT_DISPATCH_RUNS_DIR
    || path.join(env.TMPDIR || '/tmp', 'autopilot-dispatch-runs');
}

// --- reader (the contract every consumer follows) --------------------------------------
// -> { status: 'fresh'|'stale'|'missing', envelope|null }. A scope mismatch is 'missing'.
function readEnvelope({ file, scope, nowMs = Date.now() }) {
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return { status: 'missing', envelope: null };
  }
  if (!envelope || envelope.schema !== SCHEMA || !envelope.scope) return { status: 'missing', envelope: null };
  if (scope) {
    const same = envelope.scope.project_key === scope.project_key
      && (envelope.scope.root_run_id || null) === (scope.root_run_id || null);
    if (!same) return { status: 'missing', envelope: null };
  }
  const publishedMs = Date.parse(envelope.published_at);
  const validFor = Number.isFinite(envelope.valid_for_s) ? envelope.valid_for_s : VALID_FOR_S;
  if (!Number.isFinite(publishedMs) || nowMs - publishedMs > validFor * 1000) return { status: 'stale', envelope };
  return { status: 'fresh', envelope };
}


// --- counts (plan P1a: computed ONCE here; band, --idle-exit and idle.state only read them) -----------
// exited        = phase 'exited', or ended_at / final_status non-null
// confirmed_live = of the rest, alive === true AND probe_age_s <= fresh_bound_s
// unknown       = everything else (an unprobed row is unknown, never confirmed)
// fresh_bound_s = 2 x interval x ceil(live_candidates / enrich_cap); live candidates = rows with no
//                 manifest end state (the rows the bounded rotation has to cover).
function freshBoundOf(rows, interval, enrichCap) {
  const candidates = rows.filter((r) => !(r.ended_at || r.final_status)).length;
  return 2 * interval * Math.ceil(candidates / Math.max(1, enrichCap));
}
// bound: the rotation covers the WHOLE project's candidate set, so every scope file shares the
// project-wide bound (computed once per tick); it defaults to this row set's own bound.
function computeCounts(rows, interval, enrichCap, bound = null) {
  const freshBound = bound === null ? freshBoundOf(rows, interval, enrichCap) : bound;
  const counts = { confirmed_live: 0, exited: 0, unknown: 0, fresh_bound_s: freshBound };
  for (const r of rows) {
    if (r.phase === 'exited' || r.ended_at || r.final_status) counts.exited += 1;
    else if (r.alive === true && Number.isFinite(r.probe_age_s) && r.probe_age_s <= freshBound) counts.confirmed_live += 1;
    else counts.unknown += 1;
  }
  return counts;
}

// --- session-mode markers (dir resolution identical to scripts/session-mode.js markerDir) -----------
function markerDirOf(env) {
  return env.AUTOPILOT_SESSION_MODE_DIR || path.join(os.homedir(), '.autopilot', 'session-mode');
}

// Unexpired = file exists, parses, expires_at > now. Only markers of this project_key count.
function unexpiredMarkers(env, key, nowMs) {
  const dir = markerDirOf(env);
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_error) { return out; }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (m && m.project_key === key && Date.parse(m.expires_at) > nowMs) out.push(m);
    } catch (_error) { /* unreadable marker: not unexpired */ }
  }
  return out;
}

// --- cost aggregation from costs.jsonl (same path resolution as hooks/cost-tracker.js, which writes it, and hooks/cost-fuse.js) -------------------
// Incremental: costs.jsonl is append-only, so only bytes past the last complete line are parsed.
function createCostReader(env) {
  const file = env.AUTOPILOT_COSTS_FILE || path.join(env.HOME || os.homedir(), '.claude', 'metrics', 'costs.jsonl');
  const st = { offset: 0, sessions: new Map(), byDay: new Map() };
  const round = (n) => Math.round(n * 1e6) / 1e6;
  function refresh() {
    let size;
    try { size = fs.statSync(file).size; } catch (_error) { return false; }
    if (size < st.offset) { st.offset = 0; st.sessions.clear(); st.byDay.clear(); }
    if (size === st.offset) return true;
    let text;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(size - st.offset);
        fs.readSync(fd, buf, 0, buf.length, st.offset);
        text = buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (_error) { return false; }
    const end = text.lastIndexOf('\n');
    if (end === -1) return true; // no complete line yet
    st.offset += Buffer.byteLength(text.slice(0, end + 1));
    for (const line of text.slice(0, end).split('\n')) {
      let row;
      try { row = JSON.parse(line); } catch (_error) { continue; }
      if (!row || typeof row.session !== 'string') continue;
      const usd = Number.isFinite(Number(row.cost_usd)) ? Number(row.cost_usd) : 0;
      const tsMs = Date.parse(row.ts);
      const cur = st.sessions.get(row.session) || { usd: 0, lastMs: null };
      cur.usd += usd;
      if (Number.isFinite(tsMs) && (cur.lastMs === null || tsMs > cur.lastMs)) cur.lastMs = tsMs;
      st.sessions.set(row.session, cur);
      if (Number.isFinite(tsMs)) {
        const day = new Date(tsMs).toISOString().slice(0, 10);
        st.byDay.set(day, (st.byDay.get(day) || 0) + usd);
      }
    }
    return true;
  }
  // -> { sessions, host_today_usd, host_today_as_of }; host_today_* null when the file is unreadable.
  // sessions lists the ones active in the last 24 h plus those holding an unexpired marker of this project.
  function summary(nowMs, markerSessionIds) {
    if (!refresh()) return { sessions: {}, host_today_usd: null, host_today_as_of: null };
    const asOf = new Date(nowMs).toISOString();
    const sessions = {};
    for (const [sid, v] of st.sessions) {
      const recent = v.lastMs !== null && nowMs - v.lastMs <= RECENT_SESSION_MS;
      if (recent || markerSessionIds.includes(sid)) sessions[sid] = { session_usd: round(v.usd), as_of: asOf };
    }
    return {
      sessions,
      host_today_usd: round(st.byDay.get(asOf.slice(0, 10)) || 0),
      host_today_as_of: asOf,
    };
  }
  return { summary, file };
}

// --- worktree -> project map -------------------------------------------------------------
function worktreePaths({ cwd, scope }) {
  const out = {};
  if (!scope.repo_identity) return out;
  const r = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) return out;
  for (const line of String(r.stdout).split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    try {
      const real = fs.realpathSync(line.slice('worktree '.length));
      out[real] = { project_key: scope.project_key, repo_identity: scope.repo_identity };
    } catch (_error) { /* a pruned worktree has no realpath: skip it */ }
  }
  return out;
}

function signatureOf(runs) {
  return JSON.stringify(runs.map((row) => {
    const copy = { ...row };
    for (const f of VOLATILE_ROW_FIELDS) delete copy[f];
    return copy;
  }));
}

/**
 * The watcher core. Pure of timers and process signals so tests drive it with a fake clock.
 *   collect({enrichCap}) -> enriched run rows (injected; cli.js passes collectRuns)
 *   now() -> epoch ms
 */
function createWatcher({
  key, env = process.env, cwd = process.cwd(), collect, now = Date.now,
  interval = DEFAULT_INTERVAL_S, enrichCap = 8, pid = process.pid, idleExitS = null,
}) {
  const live = liveBaseOf(env);
  const runsDir = path.join(live, 'runs');
  const autopilotHome = autopilotHomeOf(env);
  const sessionId = env.CLAUDE_CODE_SESSION_ID || env.AUTOPILOT_SESSION_ID || null;
  const startedAt = new Date(now()).toISOString();
  const logFile = path.join(autopilotHome, 'review', key, 'live', 'watcher.log');

  let scope = scopeFromCwd(cwd);
  if (scope.project_key !== key) scope = { repo_identity: null, project_key: key };
  let identity = scope.repo_identity;

  const costs = createCostReader(env);
  const state = {
    lastSignature: null, lastPublishMs: null, lastRuns: null, lastObservedAt: null, lastPaths: null,
    roots: new Set(), lastCounts: new Map(), lastCost: { sessions: {}, host_today_usd: null, host_today_as_of: null },
    idleSince: null,
  };

  function log(message) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
      fs.appendFileSync(logFile, `${new Date(now()).toISOString()} ${message}\n`);
    } catch (_error) { /* logging must never stop the watcher */ }
  }

  function envelopeFor(rootRunId, runs, publishedAtMs, extra) {
    return {
      schema: SCHEMA,
      scope: { project_key: key, repo_identity: identity, root_run_id: rootRunId },
      published_at: new Date(publishedAtMs).toISOString(),
      observed_at: state.lastObservedAt,
      valid_for_s: VALID_FOR_S,
      writer: extra.writer,
      ...(extra.exit_reason ? { exit_reason: extra.exit_reason } : {}),
      runs,
      counts: state.lastCounts.get(rootRunId) || computeCounts(runs, interval, enrichCap, freshBoundOf(state.lastRuns || runs, interval, enrichCap)),
      sessions: state.lastCost.sessions,
      host_today_usd: state.lastCost.host_today_usd,
      host_today_as_of: state.lastCost.host_today_as_of,
    };
  }

  function writeScopeFiles(runs, publishedAtMs, extra) {
    const scopes = [{ root: null, rows: runs }];
    for (const root of state.roots) scopes.push({ root, rows: runs.filter((r) => r.root_run_id === root) });
    for (const { root, rows } of scopes) {
      const scopeKey = root === null ? key : `${key}--${safeSegment(root)}`;
      const text = `${JSON.stringify(envelopeFor(root, rows, publishedAtMs, extra), null, 2)}\n`;
      writeAtomic(path.join(runsDir, `${scopeKey}.json`), text);
      try {
        writeAtomic(path.join(autopilotHome, 'review', key, 'live', `runs.${scopeKey}.json`), text);
      } catch (error) { log(`ssd fallback write failed: ${error.message}`); }
    }
  }

  function writePaths(force) {
    const map = worktreePaths({ cwd, scope });
    const text = `${JSON.stringify(map, null, 2)}\n`;
    if (!force && text === state.lastPaths) return;
    writeAtomic(path.join(runsDir, 'paths', `${key}.json`), text);
    state.lastPaths = text;
  }

  const writerInfo = () => ({ pid, session_id: sessionId, started_at: startedAt });

  function scopeRows(runs, root) {
    return root === null ? runs : runs.filter((r) => r.root_run_id === root);
  }

  // One observation. Publishes on change; otherwise a 60 s heartbeat that moves only published_at.
  // Returns { exit: 'idle_exit' } when the idle-exit condition holds (the caller does the final publish).
  function tick() {
    const nowMs = now();
    let rows;
    try {
      const all = collect({ enrichCap });
      const selected = applySelectors(all, { project: key });
      rows = Array.isArray(selected) ? selected : selected.runs;
    } catch (error) {
      log(`collect failed: ${error.message}`);
      return { published: false, error: error.message };
    }
    if (!identity) {
      const known = rows.find((r) => typeof r.project === 'string' && r.project && projectKey(r.project) === key);
      if (known) identity = known.project;
    }
    const markers = unexpiredMarkers(env, key, nowMs);
    const cost = costs.summary(nowMs, markers.map((m) => m.session_id).filter(Boolean));
    const roots = new Set(state.roots);
    for (const r of rows) if (r.root_run_id) roots.add(r.root_run_id);
    const bound = freshBoundOf(rows, interval, enrichCap);
    const counts = new Map([[null, computeCounts(rows, interval, enrichCap, bound)]]);
    for (const root of roots) counts.set(root, computeCounts(scopeRows(rows, root), interval, enrichCap, bound));
    const costSignature = JSON.stringify({ s: Object.entries(cost.sessions).map(([k, v]) => [k, v.session_usd]), t: cost.host_today_usd });
    const signature = `${signatureOf(rows)}|${JSON.stringify([...counts])}|${costSignature}`;
    const changed = signature !== state.lastSignature;
    const due = state.lastPublishMs === null || nowMs - state.lastPublishMs >= HEARTBEAT_S * 1000;
    let published = false;
    if (changed || due) {
      if (changed) {
        state.lastRuns = rows;
        state.lastSignature = signature;
        state.lastObservedAt = new Date(nowMs).toISOString();
        state.roots = roots;
        state.lastCounts = counts;
        state.lastCost = cost;
      }
      // Heartbeat path: lastRuns/lastCounts/lastCost/lastObservedAt are untouched, so only published_at moves.
      writeScopeFiles(state.lastRuns, nowMs, { writer: writerInfo() });
      writePaths(true);
      state.lastPublishMs = nowMs;
      published = true;
    }
    // Idle exit: N consecutive seconds with nothing confirmed live and nothing unknown, and no
    // unexpired session-mode marker of this project (a live session keeps the watcher up).
    const total = counts.get(null);
    if (markers.length > 0) {
      state.idleSince = null; // a live session holds the watcher open; the clock restarts when it ends
    } else if (total.confirmed_live === 0 && total.unknown === 0) {
      if (state.idleSince === null) state.idleSince = nowMs;
    } else {
      state.idleSince = null;
    }
    if (idleExitS && state.idleSince !== null && nowMs - state.idleSince >= idleExitS * 1000 && markers.length === 0) {
      return { published, changed, exit: 'idle_exit' };
    }
    return { published, changed, heartbeat: published && !changed };
  }

  function finalPublish(reason) {
    const nowMs = now();
    const runs = state.lastRuns || [];
    try {
      writeScopeFiles(runs, nowMs, { writer: null, exit_reason: reason });
    } catch (error) { log(`final publish failed: ${error.message}`); }
    log(`exit ${reason}`);
  }

  function start() {
    writeLivePointer({ env, now: now() });
    log(`start pid=${pid} project=${key} interval=${interval}s`);
  }

  return { tick, start, finalPublish, log, state, get scope() { return { ...scope, repo_identity: identity }; } };
}

// --- start wrapper (lock form ii) ----------------------------------------------------------
const WRAPPER = 'exec 9>"$1" || exit 1; flock -n 9 || exit 75; shift; export '
  + `${LOCKED_ENV}=1; exec "$@"`;

// Probe by actually taking a lock: a flock(1) that answers --version but cannot lock is unusable.
function flockAvailable(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-watch-flock-'));
  const probe = path.join(dir, 'probe.lock');
  try {
    fs.writeFileSync(probe, '');
    const r = spawnSync('flock', ['-n', probe, 'true'], { encoding: 'utf8', timeout: 5000, env });
    return !r.error && r.status === 0;
  } catch (_error) {
    return false;
  } finally {
    try { fs.unlinkSync(probe); fs.rmdirSync(dir); } catch (_cleanup) { /* best effort */ }
  }
}

function holderFromEnvelope(env, key) {
  const { envelope } = readEnvelope({
    file: path.join(liveBaseOf(env), 'runs', `${key}.json`),
    scope: { project_key: key, root_run_id: null },
  });
  return envelope && envelope.writer && envelope.writer.pid ? envelope.writer.pid : null;
}

function cmdlineOf(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch (_error) { return null; }
}

function isWatcherFor(pid, key) {
  const argv = cmdlineOf(pid);
  if (!argv) return false;
  const joined = ` ${argv.join(' ')} `;
  const at = argv.indexOf('--project');
  return joined.includes(' status runs --watch ') && at !== -1 && argv[at + 1] === key;
}

function resolveKey(projectArg, cwd) {
  if (projectArg) return /^[0-9a-f]{16}$/.test(projectArg) ? projectArg : null;
  return scopeFromCwd(cwd).project_key;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * CLI entry for `status runs --watch|--stop`. Returns an exit code (the watch path may instead
 * keep the process alive and exit from its own signal handler).
 *   opts: { watch, stop, project, interval, enrichCap, extraArgs, binPath, collect, cwd, env, stdout, stderr }
 */
function runWatchCli(opts) {
  const {
    watch, stop, project, interval = DEFAULT_INTERVAL_S, idleExit = DEFAULT_IDLE_EXIT_S, enrichCap = null, binPath, collect,
    cwd = process.cwd(), env = process.env, stdout = process.stdout, stderr = process.stderr,
  } = opts;
  const key = resolveKey(project, cwd);
  if (!key) {
    stderr.write(project ? '--project must be a 16-hex project key\n' : 'status runs --watch|--stop requires --project <key> (or run inside a git repo)\n');
    return 2;
  }

  if (stop) {
    const pid = holderFromEnvelope(env, key);
    if (!pid) { stdout.write(`no watcher running for project ${key}\n`); return 0; }
    if (!cmdlineOf(pid)) { stdout.write(`watcher pid ${pid} for project ${key} is not running\n`); return 0; }
    if (!isWatcherFor(pid, key)) {
      stderr.write(`refusing to stop pid ${pid}: its command line is not 'status runs --watch --project ${key}'\n`);
      return 1;
    }
    try { process.kill(pid, 'SIGTERM'); } catch (error) {
      stderr.write(`could not signal pid ${pid}: ${error.message}\n`);
      return 1;
    }
    for (let i = 0; i < 50 && cmdlineOf(pid); i += 1) sleepMs(100);
    if (isWatcherFor(pid, key)) {
      stderr.write(`still running pid ${pid} after SIGTERM (watcher for project ${key})\n`);
      return 1;
    }
    stdout.write(`stopped watcher pid ${pid} for project ${key}\n`);
    return 0;
  }

  if (!flockAvailable(env)) {
    stderr.write('flock_unavailable: flock(1) (util-linux) is required on PATH; no lockfile fallback\n');
    return 2;
  }

  if (env[LOCKED_ENV] !== '1') return launchUnderLock({ key, interval, idleExit, enrichCap, binPath, cwd, env, stdout, stderr });
  return runWriter({ key, interval, idleExit, enrichCap, collect, cwd, env, stderr });
}

function launchUnderLock({ key, interval, idleExit, enrichCap, binPath, cwd, env, stdout, stderr }) {
  let lock;
  try {
    lock = lockPathOf(env, key);
    fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  } catch (error) {
    stderr.write(`watcher startup failed: live dir not writable: ${error.message}\n`);
    return 1;
  }
  const inner = [process.execPath, binPath, 'status', 'runs', '--watch', '--project', key, '--interval', String(interval), '--idle-exit', String(idleExit)];
  if (enrichCap !== null) inner.push('--enrich-cap', String(enrichCap));
  const r = spawnSync('sh', ['-c', WRAPPER, 'sh', lock, ...inner], { cwd, env, stdio: 'inherit' });
  if (r.error) {
    stderr.write(`watcher startup failed: ${r.error.message}\n`);
    return 1;
  }
  if (r.status === LOCK_BUSY_RC) {
    const holder = holderFromEnvelope(env, key);
    stdout.write(`writer_busy: project ${key} already has a watcher (pid ${holder === null ? 'unknown' : holder})\n`);
    return 0;
  }
  if (r.signal) return 1;
  return r.status === null ? 1 : r.status;
}

function runWriter({ key, interval, idleExit, enrichCap, collect, cwd, env, stderr }) {
  const fail = (message) => {
    stderr.write(`watcher startup failed: ${message}\n`);
    return 1;
  };
  const manifestDir = manifestDirOf(env);
  if (!fs.existsSync(manifestDir)) return fail(`manifest directory does not exist: ${manifestDir}`);
  let watcher;
  let firstExit = null;
  try {
    const runsDir = path.join(liveBaseOf(env), 'runs');
    fs.mkdirSync(path.join(runsDir, 'paths'), { recursive: true, mode: 0o700 });
    fs.accessSync(runsDir, fs.constants.W_OK);
    watcher = createWatcher({ key, env, cwd, collect, interval, enrichCap: enrichCap || 8, idleExitS: idleExit });
    watcher.start();
    const first = watcher.tick();
    if (first.error) return fail(first.error);
    firstExit = first.exit || null;
  } catch (error) {
    return fail(error.message);
  }

  let stopping = false;
  const stopWith = (reason) => {
    if (stopping) return;
    stopping = true;
    watcher.finalPublish(reason);
    process.exit(0);
  };
  process.on('SIGTERM', () => stopWith('stopped'));
  process.on('SIGINT', () => stopWith('stopped'));
  if (firstExit) stopWith(firstExit);
  const loop = () => {
    setTimeout(() => {
      try {
        const r = watcher.tick();
        if (r && r.exit) { stopWith(r.exit); return; }
      } catch (error) { watcher.log(`tick failed: ${error.message}`); }
      loop();
    }, interval * 1000);
  };
  loop();
  return null; // the process stays alive; it exits from stopWith
}

module.exports = {
  SCHEMA, VALID_FOR_S, HEARTBEAT_S, LOCK_BUSY_RC, DEFAULT_IDLE_EXIT_S, createWatcher, readEnvelope, runWatchCli,
  lockPathOf, isWatcherFor, worktreePaths, computeCounts, unexpiredMarkers, createCostReader,
};
