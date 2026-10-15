'use strict';

/**
 * compaction-handoff.js — the deterministic handoff a session needs across an auto-compaction.
 * Mechanism only: it reads state that is already on disk and records numbers; it never tells the
 * model what to do (the T1/T2 wording and skill text are guidance and live elsewhere).
 *
 * Three jobs, one module (all fail-open, Node >= 20.10, built-ins only):
 *   1. buildHandoff()  — PreCompact (hooks/state-checkpoint.js): the sections written into the
 *      compaction-state file, in injection order: project/git -> dispatches -> marker and decision
 *      ledger -> model handoff note -> (caller's machine state) -> transcript tail. Every section
 *      that cannot be read says "unavailable: <reason>" instead of failing the hook. The size is
 *      bounded: each section has its own cap and the tail gets what is left.
 *   2. budgetWarning() — SessionStart (any source): t2 + gap must fit under window - 33000, else T2
 *      can never be reached before Claude Code compacts. One line, nothing is changed.
 *   3. recordCompactionPoint() — SessionStart(compact): append the last compact_boundary's
 *      preTokens plus the resolved window and CC version to a calibration jsonl, so the real
 *      compaction point can be compared with the buffer constant below.
 *
 * The workflow-snapshot collector (scripts/lib/workflow-snapshot.js) is reused for the session
 * marker, stage, task card and decision ledger lines; this module does not re-read them.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Claude Code reserves a fixed buffer under the auto-compact window: /context prints
// "Autocompact buffer: 33k" (measured on CC 2.1.30x). Compaction fires at window - this.
const AUTOCOMPACT_BUFFER_TOKENS = 33_000;
// Default distance between T2 (the "prepare, write the handoff, keep working" point) and the
// compaction point. Overridden by config context_budget.gap / env AUTOPILOT_CONTEXT_BUDGET_GAP.
const DEFAULT_GAP_TOKENS = 50_000;
// Same default as hooks/context-budget.js loadConfig (t2 150k, absolute).
const DEFAULT_T2_TOKENS = 150_000;

// Body budget (bytes) for the sections below plus the tail. SessionStart injects at most 10000
// characters in total (base context + wrapper ~1.9k), so this stays well inside it.
const BODY_CAP = 6000;
const SECTION_CAPS = { git: 1700, dispatch: 1100, marker: 1500, model: 2200 };
const TAIL_MIN_BYTES = 400;
const GIT_TIMEOUT_MS = 3000;
const DISPATCH_TIMEOUT_MS = 4000;
const DIRTY_FILE_CAP = 15;
const WORKTREE_CAP = 6;
const RUNNING_CAP = 5;
const RECENT_ENDED_CAP = 3;
const TRANSCRIPT_SCAN_BYTES = 8 * 1024 * 1024;

function norm(raw) { return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); }

function clip(v, n) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function unavailable(reason) { return `unavailable: ${clip(reason, 160)}`; }

// Cut whole lines to a byte cap; says how many lines went. Never splits a multi-byte character.
function capLines(text, maxBytes) {
  const lines = String(text).split('\n');
  const out = [];
  let used = 0;
  let i = 0;
  const reserve = 36;
  for (; i < lines.length; i++) {
    const b = Buffer.byteLength(lines[i]) + 1;
    if (used + b + reserve > maxBytes && i > 0) break;
    out.push(lines[i]);
    used += b;
  }
  if (i < lines.length) out.push(`... ${lines.length - i} more lines cut`);
  return out.join('\n');
}

// --- git ------------------------------------------------------------------------------------

function defaultGit(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { timeout: GIT_TIMEOUT_MS, encoding: 'utf8' });
  if (r.error) return { ok: false, reason: r.error.code === 'ETIMEDOUT' ? 'git timed out' : r.error.message };
  if (r.status !== 0) return { ok: false, reason: clip((r.stderr || '').split('\n')[0] || `git exit ${r.status}`, 100) };
  return { ok: true, out: r.stdout.replace(/\s+$/, '') };
}

function gitSection(cwd, runner) {
  const run = runner || defaultGit;
  if (!cwd) return unavailable('no cwd');
  const lines = [];
  const piece = (label, args, fmt) => {
    let r;
    try { r = run(cwd, args); } catch (e) { r = { ok: false, reason: e && e.message }; }
    if (!r || !r.ok) { lines.push(`${label}: ${unavailable(r && r.reason)}`); return; }
    try { lines.push(...fmt(r.out)); } catch (e) { lines.push(`${label}: ${unavailable(e && e.message)}`); }
  };
  // --show-current works on an unborn branch (rev-parse HEAD does not) and prints nothing when detached.
  piece('branch', ['branch', '--show-current'], (o) => [`branch: ${o || '(detached HEAD)'}`]);
  piece('head', ['log', '-1', '--format=%h %s'], (o) => [`HEAD: ${clip(o, 140)}`]);
  piece('uncommitted', ['status', '--porcelain'], (o) => {
    const rows = o ? o.split('\n') : [];
    if (!rows.length) return ['uncommitted: none'];
    const shown = rows.slice(0, DIRTY_FILE_CAP).map((r) => `  ${r.slice(0, 120)}`); // keep the XY status columns
    const more = rows.length > DIRTY_FILE_CAP ? [`  ... ${rows.length - DIRTY_FILE_CAP} more`] : [];
    return [`uncommitted: ${rows.length} path${rows.length === 1 ? '' : 's'}`, ...shown, ...more];
  });
  piece('upstream', ['rev-list', '--left-right', '--count', '@{u}...HEAD'], (o) => {
    const m = /^(\d+)\s+(\d+)$/.exec(o.trim());
    if (!m) throw new Error('unexpected rev-list output');
    return [`upstream: ahead ${m[2]}, behind ${m[1]}`];
  });
  piece('worktrees', ['worktree', 'list'], (o) => {
    const rows = o ? o.split('\n') : [];
    const shown = rows.slice(0, WORKTREE_CAP).map((r) => `  ${clip(r, 140)}`);
    const more = rows.length > WORKTREE_CAP ? [`  ... ${rows.length - WORKTREE_CAP} more`] : [];
    return [`worktrees: ${rows.length}`, ...shown, ...more];
  });
  piece('recent commits', ['log', '-5', '--format=%h %s'], (o) => ['recent commits:', ...o.split('\n').filter(Boolean).map((r) => `  ${clip(r, 120)}`)]);
  return lines.join('\n');
}

// --- dispatches -----------------------------------------------------------------------------

function ageText(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '?';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function dispatchRunsDir(dirs) {
  return dirs.dispatchRuns || process.env.AUTOPILOT_DISPATCH_RUNS_DIR
    || path.join(process.env.TMPDIR || '/tmp', 'autopilot-dispatch-runs');
}

// Reuses `dispatch-status.js --list` (the manifest reader) rather than parsing manifests again.
function dispatchSection({ sessionId, roots, now, dirs, statusScript }) {
  const script = statusScript || path.join(__dirname, '..', 'dispatch-status.js');
  const dir = dispatchRunsDir(dirs);
  const r = spawnSync(process.execPath, [script, '--list', '--dir', dir], { timeout: DISPATCH_TIMEOUT_MS, encoding: 'utf8' });
  if (r.error) return unavailable(`dispatch-status failed: ${r.error.code || r.error.message}`);
  if (r.status !== 0) return unavailable(`dispatch-status exit ${r.status}`);
  let rows;
  try { rows = JSON.parse(r.stdout); } catch { return unavailable('dispatch-status output is not JSON'); }
  if (!Array.isArray(rows)) return unavailable('dispatch-status output is not a list');
  const mine = rows.filter((m) => m && ((sessionId && m.session_id === sessionId) || (m.root_run_id && roots.has(m.root_run_id))));
  if (!mine.length) return `no dispatch manifest belongs to this session (${rows.length} in the runs directory)`;
  const running = mine.filter((m) => !m.ended_at).reverse();
  const ended = mine.filter((m) => m.ended_at).reverse().slice(0, RECENT_ENDED_CAP);
  const fmt = (m, state) => `  - ${clip(m.run_id, 40)} ${state} ${clip(m.role, 14)} ${clip(m.runner, 12)}/${clip(m.model, 22)} started ${ageText(m.started_at, now)}`
    + `\n    re-attach: node ${script} --run ${clip(m.run_id, 60)}`;
  const lines = [`dispatches: ${running.length} running (no ended_at), ${ended.length} most recent ended`];
  for (const m of running.slice(0, RUNNING_CAP)) lines.push(fmt(m, 'RUNNING'));
  if (running.length > RUNNING_CAP) lines.push(`  ... ${running.length - RUNNING_CAP} more running`);
  for (const m of ended) lines.push(fmt(m, 'ended'));
  lines.push('(running = the manifest has no ended_at; the status command also probes liveness)');
  return lines.join('\n');
}

// --- marker / ledger ------------------------------------------------------------------------

function markerLedgerSection(snapshotResult) {
  if (!snapshotResult || snapshotResult.error !== undefined) {
    return unavailable(`workflow collector failed: ${clip(snapshotResult && snapshotResult.error, 100)}`);
  }
  const by = snapshotResult.snapshot && snapshotResult.snapshot.bySource;
  if (!by) return unavailable('collector returned no per-source lines');
  const lines = [];
  for (const [name, ls] of Object.entries(by)) {
    if (name === 'git' || name === 'dispatches') continue; // own sections above
    lines.push(...ls);
  }
  return lines.length ? lines.join('\n') : unavailable('no marker or ledger source produced a line');
}

// --- model handoff note ---------------------------------------------------------------------

function modelNotePath(sessionId, dirs) {
  let base = dirs.handoff || process.env.AUTOPILOT_MODEL_HANDOFF_DIR;
  if (!base) {
    const { resolveLiveDir } = require('./live-state-dir.js');
    base = path.join(resolveLiveDir({ warn: () => {} }).base, 'handoff');
  }
  return path.join(base, `${norm(sessionId)}.md`);
}

function modelNoteSection({ sessionId, now, dirs }) {
  if (!sessionId) return unavailable('no session id, so no handoff file path');
  let file;
  try { file = modelNotePath(sessionId, dirs); } catch (e) { return unavailable(`live-state directory: ${clip(e && e.message, 100)}`); }
  let st;
  try { st = fs.lstatSync(file); } catch (e) {
    if (e && e.code === 'ENOENT') return `the model left no handoff file (expected path: ${file})`;
    return unavailable(`cannot stat ${file}: ${e && e.code}`);
  }
  if (!st.isFile()) return unavailable(`${file} is not a regular file (symlinks are refused)`);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return unavailable(`cannot read ${file}: ${e && e.code}`); }
  const mins = Math.max(0, Math.round((now - st.mtimeMs) / 60000));
  const body = Buffer.byteLength(text) > SECTION_CAPS.model - 200
    ? `${Buffer.from(text).subarray(0, SECTION_CAPS.model - 240).toString('utf8').replace(/�+$/, '')}\n[...handoff file cut at ${SECTION_CAPS.model - 240} bytes; full file: ${file}]`
    : text;
  return `written ${mins} minute${mins === 1 ? '' : 's'} ago (${file})\n${body.replace(/\s+$/, '')}`;
}

// --- assemble -------------------------------------------------------------------------------

/**
 * buildHandoff({sessionId, cwd, now?, dirs?, gitRunner?, statusScript?, snapshot, machineState, tail})
 *   snapshot: {snapshot}|{error} from the caller's single workflow-snapshot collect()
 *   machineState: ready-made text; tail: {body, header} ready-made transcript-tail text or null
 * Returns the markdown for the file. Section order is the contract.
 */
function buildHandoff(opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const dirs = opts.dirs || {};
  const sessionId = opts.sessionId || '';
  const safe = (fn) => { try { return fn(); } catch (e) { return unavailable(`error: ${e && e.message}`); } };

  const roots = new Set();
  const by = opts.snapshot && opts.snapshot.snapshot && opts.snapshot.snapshot.marker;
  if (by && by.root_run_id) roots.add(by.root_run_id);
  if (by && Array.isArray(by.campaign_roots)) for (const x of by.campaign_roots) roots.add(x);

  const parts = [
    ['Project and Git State', capLines(safe(() => gitSection(opts.cwd, opts.gitRunner)), SECTION_CAPS.git)],
    ['Dispatches', capLines(safe(() => dispatchSection({ sessionId, roots, now, dirs, statusScript: opts.statusScript })), SECTION_CAPS.dispatch)],
    ['Session Marker and Decision Ledger', capLines(safe(() => markerLedgerSection(opts.snapshot)), SECTION_CAPS.marker)],
    ['Model Handoff Note', safe(() => modelNoteSection({ sessionId, now, dirs }))],
  ];
  let out = '';
  for (const [title, body] of parts) out += `## ${title}\n${body}\n\n`;
  if (opts.machineState) out += `${opts.machineState.replace(/\s+$/, '')}\n\n`;
  const used = Buffer.byteLength(out);
  const room = BODY_CAP - used;
  if (opts.tail) {
    if (room >= TAIL_MIN_BYTES) {
      const tail = `${opts.tail.header}${opts.tail.body}`;
      out += Buffer.byteLength(tail) <= room ? tail : `${Buffer.from(tail).subarray(0, room - 40).toString('utf8').replace(/�+$/, '')}\n[...transcript tail cut to fit the handoff cap]\n`;
    } else {
      out += '## Transcript Tail (auxiliary reference)\nomitted: the sections above used the handoff size cap\n';
    }
  }
  return out;
}

// --- budget warning -------------------------------------------------------------------------

function readBudget(opts = {}) {
  const env = opts.env || process.env;
  let t2 = DEFAULT_T2_TOKENS;
  let gap = DEFAULT_GAP_TOKENS;
  try {
    const { configPath } = require('./config-path.js');
    const user = JSON.parse(fs.readFileSync(configPath({ env, home: opts.home }), 'utf8'));
    const cb = user && user.context_budget;
    if (cb && typeof cb === 'object') {
      if (Number.isFinite(cb.t2) && cb.t2 > 0) t2 = cb.t2;
      if (Number.isFinite(cb.gap) && cb.gap >= 0) gap = cb.gap;
    }
  } catch { /* absent or corrupt config: defaults */ }
  const envT2 = Number(env.AUTOPILOT_CONTEXT_BUDGET_T2);
  if (Number.isFinite(envT2) && envT2 > 0) t2 = envT2;
  const rawGap = env.AUTOPILOT_CONTEXT_BUDGET_GAP;
  const envGap = rawGap === undefined || rawGap === '' ? NaN : Number(rawGap);
  if (Number.isFinite(envGap) && envGap >= 0) gap = envGap;
  return { t2, gap };
}

/**
 * budgetWarning({projectDir?, model?, env?, home?, resolve?}) -> string|null
 * null when the window cannot be resolved, compaction is off, or t2 + gap fits.
 */
function budgetWarning(opts = {}) {
  let win;
  try {
    const resolve = opts.resolve || require('./autocompact-window.js').resolve;
    win = resolve({ projectDir: opts.projectDir, model: opts.model, env: opts.env, home: opts.home });
  } catch { return null; }
  if (!win || !Number.isFinite(win.configured) || win.configured <= 0 || win.enabled === false) return null;
  const { t2, gap } = readBudget(opts);
  const compactAt = win.configured - AUTOCOMPACT_BUFFER_TOKENS;
  if (t2 + gap <= compactAt) return null;
  const suggested = t2 + gap + AUTOCOMPACT_BUFFER_TOKENS;
  const k = (n) => `${Math.round(n / 1000)}k`;
  return `Context budget config: auto-compact window ${k(win.configured)} puts the compaction point at ${k(compactAt)} (window - ${k(AUTOCOMPACT_BUFFER_TOKENS)} buffer), `
    + `but T2 ${k(t2)} + gap ${k(gap)} = ${k(t2 + gap)} is above it, so T2 is never reached before Claude Code compacts. `
    + `Window that fits: ${suggested} (t2 + gap + ${AUTOCOMPACT_BUFFER_TOKENS}); takes effect on the next session start. Nothing was changed.`;
}

// --- compaction point record ----------------------------------------------------------------

function lastCompactBoundary(transcriptPath) {
  const st = fs.statSync(transcriptPath);
  const len = Math.min(st.size, TRANSCRIPT_SCAN_BYTES);
  const fd = fs.openSync(transcriptPath, 'r');
  let text;
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    text = buf.toString('utf8');
  } finally { fs.closeSync(fd); }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('compact_boundary')) continue;
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if (o && o.type === 'system' && o.subtype === 'compact_boundary') return o;
  }
  return null;
}

function compactionPointsFile(opts = {}) {
  const env = opts.env || process.env;
  if (env.AUTOPILOT_COMPACTION_POINTS_FILE) return env.AUTOPILOT_COMPACTION_POINTS_FILE;
  return path.join(opts.home || os.homedir(), '.autopilot', 'calibration', 'compaction-points.jsonl');
}

/**
 * recordCompactionPoint({sessionId, transcriptPath, projectDir?, model?, env?, home?, now?, resolve?})
 * Appends one row; returns the row, or {skipped: reason}. Never throws.
 * pre_tokens is null (with a reason) when the transcript has no compact_boundary yet.
 */
function recordCompactionPoint(opts = {}) {
  try {
    let boundary = null;
    let reason = null;
    if (!opts.transcriptPath) reason = 'no transcript_path in the payload';
    else {
      try { boundary = lastCompactBoundary(opts.transcriptPath); if (!boundary) reason = 'no compact_boundary in the transcript tail'; } catch (e) { reason = `transcript unreadable: ${e && e.code}`; }
    }
    let win = null;
    try { win = (opts.resolve || require('./autocompact-window.js').resolve)({ projectDir: opts.projectDir, model: opts.model, env: opts.env, home: opts.home }); } catch { win = null; }
    const meta = boundary && boundary.compactMetadata;
    const pre = meta && Number.isFinite(meta.preTokens) ? meta.preTokens : null;
    const row = {
      schema: 'autopilot.compaction-point/1',
      at: new Date(Number.isFinite(opts.now) ? opts.now : Date.now()).toISOString(),
      session_id: opts.sessionId || null,
      pre_tokens: pre,
      trigger: meta && meta.trigger ? String(meta.trigger) : null,
      boundary_timestamp: boundary && boundary.timestamp ? String(boundary.timestamp) : null,
      window: win && Number.isFinite(win.configured) ? win.configured : null,
      window_source: win ? win.source : null,
      buffer_assumed: AUTOCOMPACT_BUFFER_TOKENS,
      cc_version: boundary && typeof boundary.version === 'string' ? boundary.version : null,
      note: pre === null ? (reason || 'compact_boundary carries no compactMetadata.preTokens') : null,
    };
    const file = compactionPointsFile(opts);
    const store = require('./jsonl-store.js');
    store.ensureDir(path.dirname(file));
    store.appendRow(file, row);
    return row;
  } catch (e) {
    return { skipped: `record failed: ${clip(e && e.message, 100)}` };
  }
}

module.exports = {
  buildHandoff, gitSection, dispatchSection, markerLedgerSection, modelNoteSection, modelNotePath,
  budgetWarning, readBudget, recordCompactionPoint, lastCompactBoundary, compactionPointsFile,
  AUTOCOMPACT_BUFFER_TOKENS, DEFAULT_GAP_TOKENS, DEFAULT_T2_TOKENS, BODY_CAP,
};
