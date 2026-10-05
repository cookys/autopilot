/**
 * live-session-lib — shared helpers for the two per-session live-state writers
 * (session-tasks.js -> <live>/tasks/<sid>.json, awaiting-owner.js -> <live>/attention/<sid>.json).
 *
 * Not a hook (excluded from the hook inventory by the `-lib.js` suffix). Built-ins only.
 *
 * Contract: nothing here throws on expected-bad input; callers wrap main() in try/catch and
 * exit 0 (fail-open). The file base is scripts/lib/live-state-dir.js resolveLiveDir() — tests
 * point AUTOPILOT_LIVE_DIR at a /dev/shm temp dir, never the operator's real one.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// A knob is OFF for the literal values `off`, `false`, `0`, `no` (case-insensitive).
function knobOff(envName) {
  const v = process.env[envName];
  if (typeof v !== 'string') return false;
  return ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

// Hook payloads always carry session_id. Without one there is nothing to key a file by, so the
// writers do nothing (no cwd/pid fallback: a wrong-keyed file is worse than no file).
function sessionFile(payload, purpose) {
  const raw = payload && typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!raw) return null;
  return path.join(liveBase(), purpose, `${sanitizeSessionId(raw)}.json`);
}

// Live base WITHOUT the `findmnt` fork (~4 ms per call, paid on every tool call). resolveLiveDir()'s own
// documented fallback for "findmnt not on PATH" is the /proc/mounts longest-prefix match; injecting an
// execFile that reports ENOENT selects exactly that branch through the public API, so the candidate order,
// ownership/mode checks and the SSD fallback are unchanged. Memoised per process. Parity with the findmnt
// answer is asserted in hook-hosting.test.js.
function noFindmnt() {
  const e = new Error('findmnt skipped (hot path uses /proc/mounts)');
  e.code = 'ENOENT';
  throw e;
}
let baseMemo = null;
function liveBase() {
  if (baseMemo === null) baseMemo = resolveLiveDir({ execFile: noFindmnt }).base;
  return baseMemo;
}

function readJsonFile(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// Per-file writer serialisation with the repo's lock primitive (scripts/lib/jsonl-store.js:
// PID lock file + stale-holder breaker). Concurrent hook processes (parallel TaskCreate calls
// arrive ~0.1 s apart) must not lose each other's read-modify-write. A lock timeout throws; the
// caller's fail-open catch turns that into one stderr line + exit 0.
function withLock(file, fn) {
  const { withWriteLock } = require('../scripts/lib/jsonl-store.js'); // lazy: only the locked (rare) paths
  const dir = path.dirname(file);
  return withWriteLock({ storeDir: dir, lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 3000 }, fn);
}

function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function removeFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
  }
}

// project_key via the CLI-side derivation only (mods plan §2.8); null outside a git repo.
// Lazy-required: loading task-runtime costs ~40 ms and most events never need it.
function projectKeyFor(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  try {
    const { scopeFromCwd } = require('../src/status/project-key.js');
    return scopeFromCwd(cwd).project_key || null;
  } catch {
    return null;
  }
}

// Subagent liveness stamp (mods P1W STAMP): a tool call that carries `agent_id` rewrites
// <live>/agents/<sid>/<agent_id>.json (tmp + rename, no lock, last writer wins). Liveness only — tool-call
// age, never a stage. Knob AUTOPILOT_AGENT_ACTIVITY=off. No write without agent_id or session_id.
function stampAgentActivity(p) {
  if (knobOff('AUTOPILOT_AGENT_ACTIVITY')) return false;
  if (!p || typeof p.agent_id !== 'string' || !p.agent_id) return false;
  if (typeof p.session_id !== 'string' || !p.session_id) return false;
  const dir = path.join(liveBase(), 'agents', sanitizeSessionId(p.session_id));
  const file = path.join(dir, `${sanitizeSessionId(p.agent_id)}.json`);
  const body = `${JSON.stringify({
    schema: 'autopilot.agent-activity/1',
    session_id: p.session_id,
    agent_id: p.agent_id,
    agent_type: typeof p.agent_type === 'string' && p.agent_type ? p.agent_type : null,
    last_tool_at: new Date().toISOString(),
    last_tool_name: typeof p.tool_name === 'string' && p.tool_name ? p.tool_name : null,
  })}\n`;
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600 });
  } catch (e) {
    if (!e || e.code !== 'ENOENT') throw e;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, body, { mode: 0o600 });
  }
  fs.renameSync(tmp, file);
  return true;
}

function removeAgentActivity(p) {
  if (!p || typeof p.session_id !== 'string' || !p.session_id) return;
  fs.rmSync(path.join(liveBase(), 'agents', sanitizeSessionId(p.session_id)), { recursive: true, force: true });
}

// Turn state (mods P1W TURN): <live>/turn/<sid>.json {schema:"autopilot.session-turn/1", session_id, state:"active"|"ended",
// since, project_key|null, root_run_id|null}. UserPromptSubmit -> active, Stop -> ended (scope kept), SessionEnd -> removed.
// A payload with agent_id is a subagent's and never touches it. No lock (one writer per session, tmp + rename). No git:
// project_key comes from the per-cwd autostart cache (null when absent), root_run_id from this session's own marker.
function turnScope(p) {
  let projectKey = null;
  let rootRunId = null;
  try {
    if (typeof p.cwd === 'string' && p.cwd) {
      const cwd = path.resolve(p.cwd);
      const h = require('crypto').createHash('sha1').update(cwd).digest('hex').slice(0, 16);
      const c = JSON.parse(fs.readFileSync(path.join(liveBase(), 'autostart', `${h}.json`), 'utf8'));
      if (c && c.cwd === cwd && /^[0-9a-f]{16}$/.test(c.project_key)) projectKey = c.project_key;
    }
  } catch { /* no cache: null */ }
  try {
    const dir = process.env.AUTOPILOT_SESSION_MODE_DIR || path.join(require('os').homedir(), '.autopilot', 'session-mode');
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${sanitizeSessionId(p.session_id)}.json`), 'utf8'));
    if (m && typeof m.root_run_id === 'string' && m.root_run_id && Date.parse(m.expires_at) > Date.now()) rootRunId = m.root_run_id;
  } catch { /* no marker: null */ }
  return { projectKey, rootRunId };
}

function recordTurn(p) {
  const ev = p && p.hook_event_name;
  if (ev !== 'UserPromptSubmit' && ev !== 'Stop' && ev !== 'SessionEnd') return;
  if (typeof p.agent_id === 'string' && p.agent_id) return;
  const file = sessionFile(p, 'turn');
  if (!file) return;
  if (ev === 'SessionEnd') { removeFile(file); return; }
  const now = new Date().toISOString();
  let projectKey = null;
  let rootRunId = null;
  let transcriptPath = typeof p.transcript_path === 'string' && p.transcript_path ? p.transcript_path : null;
  if (ev === 'UserPromptSubmit') {
    ({ projectKey, rootRunId } = turnScope(p));
  } else {
    const cur = readJsonFile(file);
    if (cur && cur.schema === 'autopilot.session-turn/1') {
      projectKey = typeof cur.project_key === 'string' ? cur.project_key : null;
      rootRunId = typeof cur.root_run_id === 'string' ? cur.root_run_id : null;
      if (transcriptPath === null && typeof cur.transcript_path === 'string') transcriptPath = cur.transcript_path;
    }
  }
  // transcript_path (GATEFIX2): lets the watcher notice an Escape interrupt (no Stop fires) from the transcript tail.
  atomicWriteJson(file, {
    schema: 'autopilot.session-turn/1',
    session_id: p.session_id,
    state: ev === 'Stop' ? 'ended' : 'active',
    since: now,
    project_key: projectKey,
    root_run_id: rootRunId,
    ...(transcriptPath === null ? {} : { transcript_path: transcriptPath }),
  });
}

function failOpen(name, e) {
  try { process.stderr.write(`${name}: fail-open: ${e && e.message ? e.message : e}\n`); } catch { /* ignore */ }
}

module.exports = {
  readStdinJson,
  knobOff,
  sessionFile,
  liveBase,
  stampAgentActivity,
  removeAgentActivity,
  recordTurn,
  readJsonFile,
  withLock,
  atomicWriteJson,
  removeFile,
  projectKeyFor,
  failOpen,
};
