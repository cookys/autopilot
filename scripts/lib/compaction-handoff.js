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
 *   2. budgetWarning() — SessionStart (any source): t2 + gap must fit under window - AUTOCOMPACT_BUFFER
 *      (scripts/lib/autocompact-window.js), else Claude
 *      Code compacts before T2 can remind (with auto-compact set, T2 is only a handoff reminder). One line, nothing is changed.
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
const runtimePaths = require('./runtime-paths');

// Claude Code reserves a fixed buffer under the auto-compact window: /context prints
// "Autocompact buffer: 33k" (measured on CC 2.1.30x). Compaction fires at window - this.
// The value is AUTOCOMPACT_BUFFER from scripts/lib/autocompact-window.js (no second copy).
const { AUTOCOMPACT_BUFFER: AUTOCOMPACT_BUFFER_TOKENS } = require('./autocompact-window.js');
// Defaults live in config-path.js readContextBudget (t2 150k absolute, gap 50k between T2 - the "prepare, write the
// handoff, keep working" point - and the compaction point); these mirror them for callers that import the numbers.
const DEFAULT_GAP_TOKENS = 50_000;
const DEFAULT_T2_TOKENS = 150_000;

// Body budget (bytes) for the sections below plus the tail. SessionStart injects at most 10000
// characters in total (base context + wrapper ~1.9k), so this stays well inside it.
// At most 40% of BODY_CAP (2760 B) is reserved for inbound + Fleet State, leaving about 4.1 KB for git, dispatch, marker,
// the model note and transcript tail. The model's own handoff note is the most valuable part after a compaction, the transcript tail is auxiliary: the model
// section gets at least MODEL_MIN bytes (SECTION_CAPS.model) and takes whatever git / dispatch / marker leave unused;
// when it needs more than is left, those three shrink (never below SECTION_FLOOR) instead. The tail gets the remainder.
// 6900 + the checkpoint wrapper (~2.9k) stays under SessionStart's 10000-character injection limit.
const BODY_CAP = 6900;
const SECTION_CAPS = { git: 1700, dispatch: 1100, marker: 1500, model: 4000 };
const SECTION_FLOOR = 300;
const MODEL_ROOM_MIN = 1800; // below this much room for the model note the fleet block shrinks (buildHandoff)
// Unanswered fleet messages (opts.inbound): a reserved section the size cap never cuts. Its bytes come off the top of
// BODY_CAP before any other section is sized. When more are unanswered than fit, the newest are kept and the count of
// older ones is written. Bodies are data: every field is escaped (the restore block is wrapped in a tag).
const RESERVED_CAP = Math.floor(BODY_CAP * 0.4);
// The inbound section is bounded by RESERVED_CAP (the combined inbound + Fleet State allocation); FLEET_FLOOR of it stays for Fleet State.
const FLEET_FLOOR = 1500;
const INBOUND_BUDGET = RESERVED_CAP - FLEET_FLOOR;
const INBOUND_REREAD_PLACEHOLDER = 'compaction 前可能有 fleet 訊息沒讀到：呼叫 `recent` 並設 `unseen_only=true`，或執行 `fleet recent --unseen`（待上線）';
// A note written within this long ago, or whose size/mtime moves while it is read, may be mid-write (the model writes
// it with the Write tool; atomicity is not under our control, so the reader guards).
const STABLE_AGE_MS = 2000;
const STABLE_WAIT_MS = 300;
const STABLE_TRIES = 3;
const UNSTABLE_MARK = '\n[possibly incomplete: the handoff file was still being written when read]';
const TAIL_MIN_BYTES = 400;
const GIT_TIMEOUT_MS = 3000;
const DISPATCH_TIMEOUT_MS = 4000;
const PROBE_TIMEOUT_MS = 2000;
// One wall-clock bound for the whole handoff. Every spawn below also has its own timeout, but they add up (6 git
// calls + the dispatch list + a liveness probe per running row); each one is cut to what is left of this, and a
// section that finds nothing left says "unavailable: handoff deadline reached".
const HANDOFF_DEADLINE_MS = 8000;
const DEADLINE_REASON = 'handoff deadline reached';
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

// ms left before the absolute deadline (Infinity when there is none); a spawn timeout is the smaller of its own
// limit and this.
function msLeft(deadlineAt) { return Number.isFinite(deadlineAt) ? deadlineAt - Date.now() : Infinity; }
function boundedTimeout(own, deadlineAt) { return Math.max(1, Math.min(own, Math.floor(msLeft(deadlineAt)))); }

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

function defaultGit(cwd, args, deadlineAt) {
  const r = spawnSync('git', ['-C', cwd, ...args], { timeout: boundedTimeout(GIT_TIMEOUT_MS, deadlineAt), encoding: 'utf8' });
  if (r.error) return { ok: false, reason: r.error.code === 'ETIMEDOUT' ? 'git timed out' : r.error.message };
  if (r.status !== 0) return { ok: false, reason: clip((r.stderr || '').split('\n')[0] || `git exit ${r.status}`, 100) };
  return { ok: true, out: r.stdout.replace(/\s+$/, '') };
}

function gitSection(cwd, runner, deadlineAt) {
  const run = runner || ((c, a) => defaultGit(c, a, deadlineAt));
  if (!cwd) return unavailable('no cwd');
  const lines = [];
  const piece = (label, args, fmt) => {
    let r;
    if (msLeft(deadlineAt) <= 0) { lines.push(`${label}: ${unavailable(DEADLINE_REASON)}`); return; }
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
  return dirs.dispatchRuns || runtimePaths.runsDir(process.env);
}

// Reuses `dispatch-status.js --list` (the manifest reader) rather than parsing manifests again.
function dispatchSection({ sessionId, roots, now, dirs, statusScript, deadlineAt }) {
  const script = statusScript || path.join(__dirname, '..', 'dispatch-status.js');
  const dir = dispatchRunsDir(dirs);
  if (!dirs.dispatchRuns) {
    const ens = runtimePaths.ensureRunsDir(process.env);
    if (!ens.ok) return unavailable(`runs directory unusable: ${ens.reason}`);
  }
  if (msLeft(deadlineAt) <= 0) return unavailable(DEADLINE_REASON);
  const r = spawnSync(process.execPath, [script, '--list', '--dir', dir], { timeout: boundedTimeout(DISPATCH_TIMEOUT_MS, deadlineAt), encoding: 'utf8' });
  if (r.error) return unavailable(`dispatch-status failed: ${r.error.code || r.error.message}`);
  if (r.status !== 0) return unavailable(`dispatch-status exit ${r.status}${r.stderr ? `: ${String(r.stderr).trim().split('\n').pop().slice(0, 200)}` : ''}`);
  let rows;
  try { rows = JSON.parse(r.stdout); } catch { return unavailable('dispatch-status output is not JSON'); }
  if (!Array.isArray(rows)) return unavailable('dispatch-status output is not a list');
  // Ownership: this session's own runs, plus every run under them. The roots start as the marker's roots and
  // the run ids of rows whose session_id is this session; a row belongs when it names one of the roots as its
  // root_run_id or parent_run_id. A child's own session_id differs, so a session with no marker would otherwise
  // lose the hands its foreman launched. Descendants join the roots until nothing new matches (multi-level).
  const all = rows.filter(Boolean);
  const owned = new Set(roots);
  for (const m of all) if (sessionId && m.session_id === sessionId && m.run_id) owned.add(m.run_id);
  const mineSet = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const m of all) {
      if (mineSet.has(m)) continue;
      const own = sessionId && m.session_id === sessionId;
      const byRoot = m.root_run_id && owned.has(m.root_run_id);
      const byParent = m.parent_run_id && owned.has(m.parent_run_id);
      if (own || byRoot || byParent) {
        mineSet.add(m); grew = true;
        if (m.run_id) owned.add(m.run_id);
      }
    }
  }
  const mine = all.filter((m) => mineSet.has(m));
  if (!mine.length) return `no dispatch manifest belongs to this session (${rows.length} in the runs directory)`;
  // "No ended_at" is not "running": a crashed run never writes it. Each shown row is asked to dispatch-status
  // (`--run`: lock, manifest pid, scope unit) and the answer is true / false / null. null (no lock, no pid) and a
  // probe that cannot finish in time stay UNKNOWN, never RUNNING.
  const probe = (m) => {
    if (msLeft(deadlineAt) <= 0) return null;
    const pr = spawnSync(process.execPath, [script, '--run', String(m.run_id), '--dir', dir], { timeout: boundedTimeout(PROBE_TIMEOUT_MS, deadlineAt), encoding: 'utf8' });
    if (pr.error || pr.status !== 0) return null;
    try { const o = JSON.parse(pr.stdout); return o && typeof o.alive === 'boolean' ? o.alive : null; } catch { return null; }
  };
  const openRows = mine.filter((m) => !m.ended_at).reverse();
  const stateOf = new Map();
  for (const m of openRows.slice(0, RUNNING_CAP)) { const a = probe(m); stateOf.set(m, a === true ? 'RUNNING' : (a === false ? 'GONE' : 'UNKNOWN')); }
  const rank = { RUNNING: 0, UNKNOWN: 1, GONE: 2 };
  const running = openRows.slice(0, RUNNING_CAP).sort((a, b) => rank[stateOf.get(a)] - rank[stateOf.get(b)]);
  const ended = mine.filter((m) => m.ended_at).reverse().slice(0, RECENT_ENDED_CAP);
  const fmt = (m, state) => `  - ${clip(m.run_id, 40)} ${state} ${clip(m.role, 14)} ${clip(m.runner, 12)}/${clip(m.model, 22)} started ${ageText(m.started_at, now)}`
    + `\n    re-attach: node ${script} --run ${clip(m.run_id, 60)}`;
  const count = (s) => running.filter((m) => stateOf.get(m) === s).length;
  const lines = [`dispatches: ${openRows.length} without ended_at (${count('RUNNING')} running, ${count('UNKNOWN')} state unknown, ${count('GONE')} process gone), ${ended.length} most recent ended`];
  for (const m of running) lines.push(fmt(m, stateOf.get(m)));
  if (openRows.length > RUNNING_CAP) lines.push(`  ... ${openRows.length - RUNNING_CAP} more without ended_at (not probed)`);
  for (const m of ended) lines.push(fmt(m, 'ended'));
  lines.push('(RUNNING = lock held or pid alive; GONE = lock free or pid dead, no ended_at written; UNKNOWN = no lock or pid to probe, or the probe failed or ran out of time)');
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

// The whole section, header and cut marker included, stays within SECTION_CAPS.model bytes whatever the path
// length: a long path is shown by its tail only.
function modelNoteSection({ sessionId, now, dirs, cap: capOpt, sleepMs, deadlineAt }) {
  if (!sessionId) return unavailable('no session id, so no handoff file path');
  let file;
  try { file = modelNotePath(sessionId, dirs); } catch (e) { return unavailable(`live-state directory: ${clip(e && e.message, 100)}`); }
  const shown = file.length > 80 ? `…${file.slice(-79)}` : file;
  const cap = Number.isFinite(capOpt) ? capOpt : SECTION_CAPS.model;
  const wait = Number.isFinite(sleepMs) ? sleepMs : STABLE_WAIT_MS;
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  // O_NONBLOCK: opening a FIFO with no writer would block forever (and hang PreCompact); with it open() returns
  // at once and the fstat().isFile() check below refuses the FIFO.
  const nonBlock = fs.constants.O_NONBLOCK || 0;
  let fd;
  try {
    if (!noFollow) { // no O_NOFOLLOW on this platform: fall back to an lstat check
      if (!fs.lstatSync(file).isFile()) return unavailable(`${shown} is not a regular file (symlinks and special files are refused)`);
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch (e) {
    if (e && e.code === 'ENOENT') return `the model left no handoff file (expected path: ${shown})`;
    if (e && e.code === 'ELOOP') return unavailable(`${shown} is not a regular file (symlinks are refused)`);
    return unavailable(`cannot open ${shown}: ${e && e.code}`);
  }
  try {
    let st = fs.fstatSync(fd);
    if (!st.isFile()) return unavailable(`${shown} is not a regular file`);
    // Settle: a note touched in the last 2 s is re-stat'ed after a short wait; size or mtime moving means a writer is
    // still active, so wait and look again (STABLE_TRIES times).
    let unstable = false;
    for (let i = 0; i < STABLE_TRIES; i++) {
      if (now - st.mtimeMs >= STABLE_AGE_MS && i === 0) break;
      if (Number.isFinite(deadlineAt) && deadlineAt - Date.now() < wait * 2) break; // out of time: read what is there
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait); } catch { /* ignore */ }
      const st2 = fs.fstatSync(fd);
      const moved = st2.size !== st.size || st2.mtimeMs !== st.mtimeMs;
      st = st2;
      unstable = moved;
      if (!moved) break;
    }
    const mins = Math.max(0, Math.round((now - st.mtimeMs) / 60000));
    const header = `written ${mins} minute${mins === 1 ? '' : 's'} ago (${shown})\n`;
    const marker = `\n[...handoff file cut; full file: ${shown}]`;
    const room = Math.max(0, cap - Buffer.byteLength(header));
    const want = Math.min(st.size, room + 1);
    const buf = Buffer.alloc(want);
    const got = want > 0 ? fs.readSync(fd, buf, 0, want, 0) : 0;
    const st3 = fs.fstatSync(fd);
    if (st3.size !== st.size || st3.mtimeMs !== st.mtimeMs) unstable = true;
    const tag = unstable ? UNSTABLE_MARK : '';
    const roomT = Math.max(0, room - Buffer.byteLength(tag));
    const cut = st.size > roomT || got > roomT;
    const avail = cut ? Math.max(0, roomT - Buffer.byteLength(marker)) : roomT;
    const text = buf.subarray(0, Math.min(got, avail)).toString('utf8').replace(/\uFFFD+$/, '');
    return `${header}${text.replace(/\s+$/, '')}${cut ? marker : ''}${tag}`;
  } catch (e) {
    return unavailable(`cannot read ${shown}: ${e && e.code}`);
  } finally { try { fs.closeSync(fd); } catch { /* ignore */ } }
}
// --- inbound fleet messages ---------------------------------------------------------------

function escapeText(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// items: oldest first, {message_id, from, kind, disposition, reply_to, first_line}. Returns '' for none, else the
// section text (header, newest items that fit INBOUND_BUDGET in arrival order, omitted count, re-read placeholder).
function inboundSection(items, budget = INBOUND_BUDGET, writeList = null) {
  if (!Array.isArray(items) || !items.length) return '';
  const e = (v, n = 80) => escapeText(String(v == null ? '' : v).slice(0, n));
  const lines = (it, firstMax) => {
    const meta = [`kind=${e(it.kind)}`];
    if (it.disposition) meta.push(`disposition=${e(it.disposition)}`);
    if (it.reply_to) meta.push(`reply_to=${e(it.reply_to)}`);
    let t = `- ${e(it.message_id)} from=${e(it.from)} ${meta.join(' ')}${firstMax > 0 ? ` | ${e(it.first_line, firstMax)}` : ''}\n`;
    if (it.kind === 'dispatch') t += `  fleet task show ${e(it.message_id)}\n`;
    return t;
  };
  const isPatrol = (it) => it.kind === 'wake' && /(?:^|\/)courier(?:\/|$)/.test(String(it.from || ''));
  const chats = items.filter((it) => !isPatrol(it));
  const wakes = items.filter(isPatrol);
  const wakeLine = wakes.length ? `${wakes.length} patrol wakes (oldest ${e(wakes[0].message_id)}, newest ${e(wakes[wakes.length - 1].message_id)})\n` : '';
  const head = (n) => `## Unanswered Fleet Messages (reserved, never cut)\n這 ${n + wakes.length} 則在壓縮前到達，請重讀：\n`;
  const tail = (omitted) => wakeLine + (omitted ? `${omitted} 則已省略\n` : '') + `${INBOUND_REREAD_PLACEHOLDER}\n\n`;
  const render = (kept, omitted, firstMax) => head(kept.length) + kept.map((it) => lines(it, firstMax)).join('') + tail(omitted);
  const fits = (t) => Buffer.byteLength(t) <= budget;
  // Over budget, the message text goes first (first_line cut shorter, then dropped); id + from of every message stay.
  for (const firstMax of [200, 100, 40, 0]) {
    const t = render(chats, 0, firstMax);
    if (fits(t)) return t;
  }
  // Still over: one line per sender, ids only.
  const bySender = new Map();
  for (const it of chats) { const k = e(it.from); if (!bySender.has(k)) bySender.set(k, []); bySender.get(k).push(e(it.message_id)); }
  const compact = head(chats.length) + [...bySender].map(([from, ids]) => `- from=${from}: ${ids.join(' ')}\n`).join('') + tail(0);
  if (fits(compact)) return compact;
  // More ids than the budget can hold: the full id + from list goes to a file in the session state dir; the injection names the count and the path.
  if (typeof writeList === 'function') {
    const file = writeList(items.map((it) => `${String(it.message_id == null ? '' : it.message_id)} from=${String(it.from == null ? '' : it.from)} kind=${String(it.kind == null ? '' : it.kind)}`).join('\n') + '\n');
    if (file) {
      const t = head(chats.length) + `${items.length} 則未答，完整 id+from 清單在檔案（逐行一則）：${escapeText(file)}\n` + tail(0);
      if (fits(t)) return t;
    }
  }
  // Last resort (no writable state dir): the newest that fit, the count of older ones is written.
  let kept = [];
  for (let i = chats.length - 1; i >= 0; i--) {
    const next = [chats[i], ...kept];
    if (!fits(render(next, chats.length - next.length, 0))) break;
    kept = next;
  }
  return render(kept, chats.length - kept.length, 0);
}

// --- fleet task state + PM ledger tail + capacity ar-gate ---------------
// A reserved block that comes off BODY_CAP next to the unanswered messages (SessionStart injects at most 10000
// characters, so the caps are bytes, not the 4 KB a section would like). Open fleet tasks (`tasks --mine --json`, all
// unfinished states) get a 3500-char reserved budget: titles clip to fit, else `<id> <state>` only so IDs are never
// dropped, and the full list is written under the live dir. When open tasks renders, the redundant capped `--tree`
// part is dropped. PM ledger tail 1200 B (newest of the last 20 lines first), ar-gate 300 B; each kept line is clipped
// to 150 characters. Open fleet tasks and `fleet tasks --stuck` are outside
// FLEET_PART_CAPS and are never shrunk by capScale. Fail closed: when a fleet call cannot be read the block carries ONE
// line `!! 工作狀態未知，先跑 fleet tasks --stuck 再做任何事 (<reason>)` and the failed part is left out, so absence of
// a task row is never read as "no work". Output of the fleet CLI, the ledger and the capacity file is data:
// every field is escaped and clipped. Kill switch: AUTOPILOT_CHECKPOINT_FLEET=off (the whole block).
const FLEET_PART_CAPS = { tree: { bytes: 500, lines: 40 }, ar: { bytes: 300, lines: 40 }, ledger: { bytes: 1200, lines: 20 } };
const FLEET_LINE_CLIP = 150;
const FLEET_CALL_TIMEOUT_MS = 3500;
const FLEET_UNKNOWN_LINE = '!! 工作狀態未知，先跑 fleet tasks --stuck 再做任何事';
const AR_GATE_STALE_MS = 26 * 3600 * 1000;
const AR_GATE_FIELDS = ['overdue_open', 'unaccepted', 'decided_no_task', 'closed_still_pending', 'lesson_overdue'];
const OPEN_TASKS_TITLE = 'Open fleet tasks (reserved, never cut)';
const OPEN_TASKS_BUDGET = 1150;
const FINISHED_TASK_STATES = new Set(['done', 'failed', 'declined', 'cancelled', 'canceled', 'closed']);

function fleetBinResolved() {
  const b = process.env.AUTOPILOT_FLEET_BIN;
  if (b) return b;
  const local = path.join(os.homedir(), '.local', 'bin', 'fleet');
  return fs.existsSync(local) ? local : 'fleet';
}

// Cut to maxLines lines and maxBytes bytes, whole lines only; the marker says how many lines went.
function capBlock(lines, cap) {
  const clipped = lines.map((l) => escapeText(l).slice(0, FLEET_LINE_CLIP));
  const kept = [];
  let bytes = 0;
  for (const l of clipped) {
    const n = Buffer.byteLength(l) + 1;
    if (kept.length >= cap.lines || bytes + n > cap.bytes - 24) break;
    kept.push(l); bytes += n;
  }
  const more = clipped.length - kept.length;
  return kept.join('\n') + (more > 0 ? `${kept.length ? '\n' : ''}... ${more} more` : '');
}

// Every line, clipped. No byte cap and no line cap (stuck tasks).
function clipLines(lines) {
  return lines.map((l) => escapeText(l).slice(0, FLEET_LINE_CLIP)).join('\n');
}

// The last cap.lines lines, newest kept when the byte budget is short; the marker counts the older ones left out.
function tailBlock(lines, cap) {
  const last = lines.slice(-cap.lines).map((l) => escapeText(l).slice(0, FLEET_LINE_CLIP));
  const kept = [];
  let bytes = 0;
  for (let i = last.length - 1; i >= 0; i -= 1) {
    const n = Buffer.byteLength(last[i]) + 1;
    if (bytes + n > cap.bytes - 24) break;
    kept.unshift(last[i]); bytes += n;
  }
  const older = lines.length - kept.length;
  return (older > 0 ? `... ${older} older\n` : '') + kept.join('\n');
}

function fleetCall(args, deadlineAt) {
  const r = spawnSync(fleetBinResolved(), args, { encoding: 'utf8', timeout: boundedTimeout(FLEET_CALL_TIMEOUT_MS, deadlineAt), stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 20 });
  if (r.error) return { err: r.error.code === 'ETIMEDOUT' ? 'timeout' : String((r.error && r.error.code) || r.error.message).slice(0, 60) };
  if (r.status !== 0) return { err: `exit ${r.status}` };
  return { lines: String(r.stdout || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter(Boolean), text: String(r.stdout || '') };
}

// -> { title, body } | { err }. An unreadable call is the caller's fail-closed line, never an empty part.
// cap null: per-line clip only (stuck). A cap object: byte and line cap (tree).
function fleetTasksPart(title, args, cap, deadlineAt) {
  try {
    const r = fleetCall(args, deadlineAt);
    if (r.err) return { err: `${args.slice(0, 2).join(' ')}: ${r.err}` };
    return { title, body: r.lines.length ? (cap ? capBlock(r.lines, cap) : clipLines(r.lines)) : 'none' };
  } catch (e) { return { err: `${args.slice(0, 2).join(' ')}: ${String(e && e.message).slice(0, 60)}` }; }
}

function renderPart(p) { return `### ${p.title}\n${p.body}\n`; }

// PM go ledger (newest *-go-ledger.md in AUTOPILOT_PM_LEDGER_DIR, default ~/projects/pm/log). A lane without a PM
// ledger has no such directory: nothing is emitted, and that is not an error.
function pmLedgerPart(cap) {
  const dir = process.env.AUTOPILOT_PM_LEDGER_DIR || path.join(os.homedir(), 'projects', 'pm', 'log');
  let newest = null;
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!/-go-ledger\.md$/.test(n)) continue;
      const m = fs.statSync(path.join(dir, n)).mtimeMs;
      if (!newest || m > newest.m) newest = { n, m };
    }
    if (!newest) return '';
    const lines = fs.readFileSync(path.join(dir, newest.n), 'utf8').split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) return '';
    return renderPart({ title: `PM ledger tail (${newest.n})`, body: tailBlock(lines, cap) });
  } catch { return ''; }
}

// This session's full fleet address (namespace/courier/member), which is what capacity writes in `lane`.
// 1. $AUTOPILOT_FLEET_ADDRESS when set. 2. Otherwise the `address:` line of `fleet whoami`. null when neither gives one.
// The shell CLI answers with its own identity (member `fleet-cli`, never a lane), which is treated as unknown.
// A `@<session>` suffix is not part of a lane address: laneKey strips it on both sides of the comparison.
function fleetSelfAddress(deadlineAt) {
  const env = String(process.env.AUTOPILOT_FLEET_ADDRESS || '').trim();
  if (env) return env;
  try {
    const w = fleetCall(['whoami'], deadlineAt);
    const addr = w.err ? null : (/^address:\s*(\S+)/m.exec(w.text) || [])[1];
    return addr && !/\/fleet-cli$/.test(addr) ? addr : null;
  } catch { return null; }
}
function laneKey(a) { return String(a).replace(/@.*$/, ''); }

function taipeiTime(ms) { return `${new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')} 台北`; }

// capacity's ar-gate interface (capacity task 01M7DMV1, 2026-11-15) — contract pinned here:
//   file ~/projects/capacity/out/ar-gate.v1.json, `schema` = "capacity.ar-gate/1", `generated_at_ms`, refreshed daily 08:55.
//   five fields overdue_open (lane = assignee), unaccepted (lane = requester), decided_no_task, closed_still_pending,
//   lesson_overdue: an array of {task_id, lane, days} (lane = full address, compared by exact equality) or the string
//   "無資料" = no source for that class, which is NOT zero. Fields are only ever added; a breaking change moves to /2,
//   which this reader reports as unavailable. generated_at_ms older than 26 h = stale, no rows injected. File absent =
//   the job never ran.
function capacityArGatePart(deadlineAt, cap) {
  const f = process.env.AUTOPILOT_CAPACITY_AR_GATE_FILE || path.join(os.homedir(), 'projects', 'capacity', 'out', 'ar-gate.v1.json');
  const title = 'Capacity ar-gate differences';
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (e) {
    return renderPart({ title, body: e && e.code === 'ENOENT' ? 'ar-gate: not run yet' : `ar-gate: unavailable (${String((e && e.code) || e).slice(0, 60)})` });
  }
  let d;
  try { d = JSON.parse(raw); } catch { return renderPart({ title, body: 'ar-gate: unavailable (unparsable)' }); }
  if (!d || d.schema !== 'capacity.ar-gate/1') return renderPart({ title, body: `ar-gate: unavailable (schema ${escapeText(String(d && d.schema)).slice(0, 40)})` });
  if (!Number.isFinite(d.generated_at_ms) || Date.now() - d.generated_at_ms > AR_GATE_STALE_MS) {
    return renderPart({ title, body: `ar-gate: stale (generated ${Number.isFinite(d.generated_at_ms) ? taipeiTime(d.generated_at_ms) : 'unknown'})` });
  }
  const out = [];
  let lane = null;
  let laneTried = false;
  for (const field of AR_GATE_FIELDS) {
    const v = d[field];
    if (typeof v === 'string') { out.push(`${field}: 無來源`); continue; }
    if (!Array.isArray(v)) continue;
    if (!laneTried) { lane = fleetSelfAddress(deadlineAt); laneTried = true; }
    if (!lane) { out.push(`${field}: lane address unknown (set AUTOPILOT_FLEET_ADDRESS)`); continue; }
    for (const r of v) if (r && typeof r.lane === 'string' && laneKey(r.lane) === laneKey(lane)) out.push(`${field}: ${r.task_id} (days ${r.days})`);
  }
  if (!out.length) out.push('no differences for this lane');
  return renderPart({ title, body: capBlock(out, cap) });
}

// Full unanswered-message list (id + from) when the injected section cannot hold it; lives beside the open-tasks file in the live state dir.
function inboundListWriter(sessionId, dirs) {
  return (text) => {
    try {
      const { resolveLiveDir, sanitizeSessionId } = require('./live-state-dir');
      const base = dirs && dirs.live ? dirs.live : resolveLiveDir({ warn: () => {} }).base;
      const file = path.join(base, 'unanswered-inbound', `${sanitizeSessionId(sessionId)}.txt`);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, file);
      return file;
    } catch { return null; }
  };
}

function openFleetTasksFile(sessionId, dirs) {
  const { resolveLiveDir, sanitizeSessionId } = require('./live-state-dir');
  const base = dirs && dirs.live ? dirs.live : resolveLiveDir({ warn: () => {} }).base;
  return path.join(base, 'open-fleet-tasks', `${sanitizeSessionId(sessionId)}.txt`);
}

function writeOpenTasksFile(tasks, sessionId, dirs) {
  try {
    const file = openFleetTasksFile(sessionId, dirs);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const body = tasks.length
      ? `${tasks.map((t) => `${t.id} ${t.state}${t.rawTitle ? ` ${t.rawTitle}` : ''}`).join('\n')}\n`
      : 'none\n';
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 80) };
  }
}

// Fit open tasks by reducing the number of rows. A shown title remains readable; full task data is in the pointer file.
function fitOpenTaskLines(tasks, avail) {
  if (!tasks.length) return 'none';
  const all = tasks.map((t) => `${t.id} ${t.state}${t.rawTitle ? ` ${escapeText(t.rawTitle)}` : ''}`);
  if (Buffer.byteLength(all.join('\n')) <= avail) return all.join('\n');
  const kept = [];
  let used = 0;
  for (const t of tasks) {
    const line = `${t.id} ${t.state}${t.rawTitle ? ` ${escapeText(t.rawTitle)}` : ''}`;
    const cost = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (used + cost > avail) break;
    kept.push(line); used += cost;
  }
  const omitted = tasks.length - kept.length;
  if (omitted) kept.push(`... ${omitted} more (full list above)`);
  return kept.length ? kept.join('\n') : `... ${tasks.length} more (full list above)`;
}

function openTasksPart({ sessionId, dirs, deadlineAt } = {}) {
  try {
    const r = fleetCall(['tasks', '--mine', '--json'], deadlineAt);
    if (r.err) return { err: `tasks --mine: ${r.err}`, rendered: false };
    const trimmed = r.text.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return { rendered: false };
    let rows;
    try { rows = JSON.parse(trimmed); } catch { return { err: 'tasks --mine: unparsable json', rendered: false }; }
    if (!Array.isArray(rows)) return { err: 'tasks --mine: unparsable json', rendered: false };
    const tasks = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || row.kind === 'observed_run') continue;
      const rawId = typeof row.task_id === 'string' && row.task_id ? row.task_id : (typeof row.id === 'string' ? row.id : '');
      const id = escapeText(rawId.replace(/\s+/g, ' ').trim());
      if (!id) continue;
      const rawState = typeof row.state === 'string' ? row.state : (typeof row.status === 'string' ? row.status : '');
      const stateNorm = rawState.replace(/\s+/g, ' ').trim().toLowerCase() || 'unknown';
      if (FINISHED_TASK_STATES.has(stateNorm)) continue;
      const state = escapeText(stateNorm);
      const raw = typeof row.title === 'string' && row.title.trim() ? row.title : (typeof row.progress === 'string' ? row.progress : '');
      const rawTitle = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
      const evidenceRaw = row.next_evidence_due || row.evidence_at || row.evidence_due_at;
      const evidence = typeof evidenceRaw === 'string' ? Date.parse(evidenceRaw) : NaN;
      const createdRaw = row.created_at || row.created || row.updated_at;
      const created = typeof createdRaw === 'string' ? Date.parse(createdRaw) : NaN;
      tasks.push({ id, state, rawTitle, evidence, created, order: tasks.length });
    }
    tasks.sort((a, b) => {
      const nonRunning = (t) => t.state === 'running' ? 1 : 0;
      const ar = nonRunning(a) - nonRunning(b);
      if (ar) return ar;
      const overdue = (t) => Number.isFinite(t.evidence) && t.evidence < Date.now();
      const ao = Number(overdue(a)); const bo = Number(overdue(b));
      if (ao !== bo) return bo - ao;
      const newest = (t) => Number.isFinite(t.created) ? t.created : -t.order;
      return newest(b) - newest(a);
    });
    const fileRes = writeOpenTasksFile(tasks, sessionId, dirs);
    const pathLine = fileRes.ok
      ? `full list (${tasks.length}): ${escapeText(fileRes.file)}`
      : `full list (${tasks.length}): unavailable (${escapeText(fileRes.error)})`;
    const overhead = Buffer.byteLength(`### ${OPEN_TASKS_TITLE}\n${pathLine}\n`) + 1;
    const avail = Math.max(0, OPEN_TASKS_BUDGET - overhead);
    const taskBody = fitOpenTaskLines(tasks, avail);
    return { rendered: true, title: OPEN_TASKS_TITLE, body: `${pathLine}\n${taskBody}` };
  } catch (e) {
    return { err: `tasks --mine: ${String(e && e.message).slice(0, 60)}`, rendered: false };
  }
}

function fleetTreeRaw(deadlineAt) {
  try {
    const r = fleetCall(['tasks', '--tree', '--mine'], deadlineAt);
    if (r.err) return { err: `tasks --tree: ${r.err}` };
    return { lines: r.lines };
  } catch (e) {
    return { err: `tasks --tree: ${String(e && e.message).slice(0, 60)}` };
  }
}

function collectFleetState(opts = {}) {
  if (String(process.env.AUTOPILOT_CHECKPOINT_FLEET || '').toLowerCase() === 'off') return null;
  const deadlineAt = Number.isFinite(opts.deadlineAt) ? opts.deadlineAt : Date.now() + HANDOFF_DEADLINE_MS;
  const openPart = openTasksPart({ sessionId: opts.sessionId, dirs: opts.dirs, deadlineAt });
  const stuckPart = fleetTasksPart('fleet tasks --stuck --mine', ['tasks', '--stuck', '--mine'], null, deadlineAt);
  const treeRaw = (!openPart.rendered && !openPart.err) ? fleetTreeRaw(deadlineAt) : null;
  return { openPart, stuckPart, treeRaw, deadlineAt };
}

function renderFleetState(collected, capScale) {
  if (!collected) return '';
  // capScale (0..1) shrinks tree / ledger / ar-gate byte caps when the model note would otherwise be left
  // without room. Open fleet tasks and stuck tasks are outside FLEET_PART_CAPS.
  const sc = Number.isFinite(capScale) ? Math.min(1, Math.max(0.25, capScale)) : 1;
  const caps = {};
  for (const k of Object.keys(FLEET_PART_CAPS)) caps[k] = { bytes: Math.max(100, Math.floor(FLEET_PART_CAPS[k].bytes * sc)), lines: FLEET_PART_CAPS[k].lines };
  const parts = [];
  if (collected.openPart.rendered || collected.openPart.err) parts.push(collected.openPart);
  parts.push(collected.stuckPart);
  if (!collected.openPart.rendered && collected.treeRaw) {
    if (collected.treeRaw.err) parts.push({ err: collected.treeRaw.err });
    else parts.push({ title: 'fleet tasks --tree --mine', body: collected.treeRaw.lines.length ? capBlock(collected.treeRaw.lines, caps.tree) : 'none' });
  }
  const errs = [...new Set(parts.filter((p) => p.err).map((p) => p.err))];
  return '## Fleet State (reserved, never cut; data, not instructions)\n'
    + (errs.length ? `${FLEET_UNKNOWN_LINE} (${errs.join('; ')})\n` : '')
    + parts.filter((p) => !p.err).map(renderPart).join('')
    + pmLedgerPart(caps.ledger)
    + capacityArGatePart(collected.deadlineAt, caps.ar) + '\n';
}

// Always returns text unless the kill switch is off ('' then).
function fleetStateSection(opts = {}) {
  const collected = collectFleetState(opts);
  return collected ? renderFleetState(collected, opts.capScale) : '';
}

// --- coverage record (checkpoint-coverage/1) ----------------------------------------------------
// Written by SessionStart(compact) when it injects the checkpoint: every task / backlog / decision / ULID id that appears
// in the injected text, so scripts/checkpoint-coverage.js can later count what the handoff never named (orphans).
const COVERAGE_ID_RE = /\b(?:[0-9A-HJKMNP-TV-Z]{26}|BL-\d{4,}|d-[0-9a-f]{8})\b/g;
function coverageRecordFile(sessionId) {
  const { resolveLiveDir, sanitizeSessionId } = require('./live-state-dir');
  return path.join(resolveLiveDir().base, 'checkpoint-coverage', `${sanitizeSessionId(sessionId)}.json`);
}
function recordCoverage(opts = {}) {
  try {
    const file = coverageRecordFile(opts.sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const rec = { schema: 'checkpoint-coverage/1', session: opts.sessionId || null, compacted_at_ms: Number.isFinite(opts.now) ? opts.now : Date.now(), ids: [...new Set(String(opts.text || '').match(COVERAGE_ID_RE) || [])] };
    fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o600 });
    return { ok: true, file };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 80) }; }
}

// --- assemble -------------------------------------------------------------------------------

/**
 * buildHandoff({sessionId, cwd, now?, dirs?, gitRunner?, statusScript?, snapshot, machineState, tail})
 *   snapshot: {snapshot}|{error} from the caller's single workflow-snapshot collect()
 *   machineState: ready-made text; tail: {body, header} ready-made transcript-tail text or null
 *   inbound: unanswered fleet messages (hooks/state-checkpoint-lib.js extractUnansweredChannels), reserved section
 * Returns the markdown for the file. Section order is the contract.
 */
function buildHandoff(opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const dirs = opts.dirs || {};
  const sessionId = opts.sessionId || '';
  const budgetMs = Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : HANDOFF_DEADLINE_MS;
  const deadlineAt = Date.now() + budgetMs;
  const safe = (fn) => { try { return fn(); } catch (e) { return unavailable(`error: ${e && e.message}`); } };

  const roots = new Set();
  const by = opts.snapshot && opts.snapshot.snapshot && opts.snapshot.snapshot.marker;
  if (by && by.root_run_id) roots.add(by.root_run_id);
  if (by && Array.isArray(by.campaign_roots)) for (const x of by.campaign_roots) roots.add(x);

  const raw = {
    git: safe(() => gitSection(opts.cwd, opts.gitRunner, deadlineAt)),
    dispatch: safe(() => dispatchSection({ sessionId, roots, now, dirs, statusScript: opts.statusScript, deadlineAt })),
    marker: safe(() => markerLedgerSection(opts.snapshot)),
  };
  const titles = { git: 'Project and Git State', dispatch: 'Dispatches', marker: 'Session Marker and Decision Ledger' };
  const caps = { git: SECTION_CAPS.git, dispatch: SECTION_CAPS.dispatch, marker: SECTION_CAPS.marker };
  const render = (k) => capLines(raw[k], caps[k]);
  const modelTitle = 'Model Handoff Note';
  const machine = opts.machineState ? `${opts.machineState.replace(/\s+$/, '')}\n\n` : '';
  const inboundText = inboundSection(opts.inbound, INBOUND_BUDGET, inboundListWriter(sessionId, dirs));
  const fleetRaw = safe(() => collectFleetState({ cwd: opts.cwd, sessionId, dirs, deadlineAt }));
  let fleetText = typeof fleetRaw === 'string' ? fleetRaw : renderFleetState(fleetRaw, 1);
  if (Buffer.byteLength(inboundText) + Buffer.byteLength(fleetText) > RESERVED_CAP && fleetRaw && typeof fleetRaw === 'object') {
    const allowance = RESERVED_CAP - Buffer.byteLength(inboundText);
    const p = fleetRaw.openPart;
    if (p && p.rendered) {
      const [pointer, ...bodyLines] = p.body.split('\n');
      const rows = bodyLines.filter((line) => /^\S+ \S+ /.test(line));
      p.body = pointer;
      const baseBytes = Buffer.byteLength(renderFleetState(fleetRaw, 1));
      let used = Math.max(0, allowance - baseBytes - 48);
      const keep = [];
      for (const line of rows) {
        if (Buffer.byteLength(line) + (keep.length ? 1 : 0) > used) break;
        keep.push(line); used += Buffer.byteLength(line) + 1;
      }
      const omitted = rows.length - keep.length;
      p.body = [pointer, ...keep, ...(omitted ? [`... ${omitted} more`] : [])].join('\n');
    }
    fleetText = safe(() => renderFleetState(fleetRaw, 1));
  }
  const frame = (t) => Buffer.byteLength(`## ${t}\n\n\n`);
  // the "tail omitted" line (~115 bytes) is reserved too, so a full body never overshoots BODY_CAP
  const fixed = (opts.tail ? 120 : 0) + Buffer.byteLength(machine) + frame(modelTitle) + frame(titles.git) + frame(titles.dispatch) + frame(titles.marker);
  // What the model section may take at most: git / dispatch / marker keep SECTION_FLOOR each, so the body can never pass
  // BODY_CAP. When that leaves the note under MODEL_ROOM_MIN, the fleet block is rebuilt with smaller caps first.
  const modelRoom = () => BODY_CAP - Buffer.byteLength(inboundText) - Buffer.byteLength(fleetText) - fixed - 3 * SECTION_FLOOR;
  if (fleetText && modelRoom() < MODEL_ROOM_MIN && fleetRaw && typeof fleetRaw === 'object') {
    const scale = Math.max(0.25, 1 - (MODEL_ROOM_MIN - modelRoom()) / Math.max(1, Buffer.byteLength(fleetText)));
    fleetText = safe(() => renderFleetState(fleetRaw, scale));
  }
  const bodyCap = BODY_CAP - Buffer.byteLength(inboundText) - Buffer.byteLength(fleetText); // reserved sections come off the top
  const othersLen = () => Object.keys(titles).reduce((n, k) => n + Buffer.byteLength(render(k)), 0);
  // The model section's budget: at least MODEL_MIN when the budget allows, more when the other sections leave room; never
  // more than the budget leaves after the three others' floors. It depends only on the sizes of the other sections, so
  // the note is read (and settled) exactly once.
  const modelCap = Math.max(0, Math.min(bodyCap - fixed - 3 * SECTION_FLOOR, Math.max(SECTION_CAPS.model, bodyCap - fixed - othersLen())));
  const model = safe(() => modelNoteSection({ sessionId, now, dirs, cap: modelCap, deadlineAt }));
  // Shrink git / dispatch / marker only as far as the model section needs, the shortfall shared in proportion to how
  // much each has above SECTION_FLOOR (so no single section is cut to its floor while another stays full).
  const deficit = fixed + othersLen() + Buffer.byteLength(model) - bodyCap;
  if (deficit > 0) {
    const have = {};
    let slack = 0;
    for (const k of Object.keys(titles)) { have[k] = Math.min(caps[k], Buffer.byteLength(render(k))); slack += Math.max(0, have[k] - SECTION_FLOOR); }
    for (const k of Object.keys(titles)) {
      const give = slack > 0 ? Math.ceil(deficit * Math.max(0, have[k] - SECTION_FLOOR) / slack) : 0;
      caps[k] = Math.max(SECTION_FLOOR, have[k] - give);
    }
  }
  const omitKeys = new Set();
  let finalModel = model;
  let omitModel = false;
  let finalMachine = machine;
  const optBytes = () => {
    let n = (opts.tail ? 120 : 0) + Buffer.byteLength(finalMachine);
    for (const k of Object.keys(titles)) {
      if (!omitKeys.has(k)) n += Buffer.byteLength(`## ${titles[k]}\n${render(k)}\n\n`);
    }
    if (!omitModel) n += Buffer.byteLength(`## ${modelTitle}\n${finalModel}\n\n`);
    return n;
  };
  if (optBytes() > bodyCap) {
    // Reserved sections leave less room than SECTION_FLOOR * 3: shrink optional sections below floor or omit them.
    const have = {};
    let slack = 0;
    const overFloor = optBytes() - bodyCap;
    for (const k of Object.keys(titles)) {
      have[k] = Math.min(caps[k], Buffer.byteLength(render(k)));
      slack += Math.max(0, have[k] - 60);
    }
    for (const k of Object.keys(titles)) {
      const give = slack > 0 ? Math.ceil(overFloor * Math.max(0, have[k] - 60) / slack) : 0;
      caps[k] = Math.max(60, have[k] - give);
    }
    for (const k of ['dispatch', 'marker', 'git']) {
      if (optBytes() <= bodyCap) break;
      omitKeys.add(k);
    }
    if (optBytes() > bodyCap) {
      const mRoom = bodyCap - (optBytes() - Buffer.byteLength(`## ${modelTitle}\n${finalModel}\n\n`));
      const mOverhead = frame(modelTitle) + 10;
      if (mRoom >= mOverhead + 30) {
        const keep = mRoom - mOverhead;
        finalModel = `${Buffer.from(finalModel).subarray(0, keep).toString('utf8').replace(/\uFFFD+$/, '')}\n[...cut]`;
      } else {
        omitModel = true;
      }
    }
    if (optBytes() > bodyCap) finalMachine = '';
  }
  let out = '';
  for (const k of Object.keys(titles)) {
    if (!omitKeys.has(k)) out += `## ${titles[k]}\n${render(k)}\n\n`;
  }
  if (!omitModel) out += `## ${modelTitle}\n${finalModel}\n\n`;
  out += finalMachine;
  out += inboundText;
  out += fleetText;
  const used = Buffer.byteLength(out);
  const room = BODY_CAP - used; // used already holds the reserved section
  if (opts.tail) {
    if (room >= TAIL_MIN_BYTES) {
      const tail = `${opts.tail.header}${opts.tail.body}`;
      out += Buffer.byteLength(tail) <= room ? tail : `${Buffer.from(tail).subarray(0, room - 60).toString('utf8').replace(/�+$/, '')}\n[...transcript tail cut to fit the handoff cap]\n`;
    } else if (room >= 98) {
      out += '## Transcript Tail (auxiliary reference)\nomitted: the sections above used the handoff size cap\n';
    }
  }
  return out;
}

// --- budget warning -------------------------------------------------------------------------

// t2, gap and mode come from the same parse the context-budget hook uses (config-path.js readContextBudget): a
// second reader here would drift (it once ignored context_budget.mode=off).
function readBudget(opts = {}) {
  const { readContextBudget } = require('./config-path.js');
  // BL-0205: per_model tiers by the first known model id that matches a pattern (opts.models, in priority order, then opts.model).
  const { matchPerModel } = require('./config-path.js');
  let c = readContextBudget({ env: opts.env, home: opts.home });
  const ids = [...(Array.isArray(opts.models) ? opts.models : []), opts.model].filter((m) => typeof m === 'string' && m);
  const hit = ids.find((m) => matchPerModel(c.perModel, m));
  if (hit) c = readContextBudget({ env: opts.env, home: opts.home, model: hit });
  return { t2: c.t2, gap: c.gap, mode: c.mode };
}

/**
 * budgetWarning({projectDir?, model?, env?, home?, resolve?}) -> string|null
 * null when the budget hint is off (context_budget.mode / env), the window cannot be resolved, compaction is off, or t2 + gap fits.
 */
function budgetWarning(opts = {}) {
  let win;
  try { if (readBudget(opts).mode === 'off') return null; } catch { /* unreadable config: defaults apply */ }
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
    + `but T2 ${k(t2)} + gap ${k(gap)} = ${k(t2 + gap)} is above it, so T2 is never reached before Claude Code compacts (with auto-compact set T2 is only a handoff reminder, so this only means no handoff reminder comes first). `
    + `Window that fits: ${suggested} (t2 + gap + ${AUTOCOMPACT_BUFFER_TOKENS}); takes effect on a later startup. Nothing was changed.`;
}

// --- compaction point record ----------------------------------------------------------------

const FRESH_WINDOW_MS = 10 * 60 * 1000;
const DEDUPE_READ_BYTES = 256 * 1024;

function alreadyRecorded(file, sessionId, boundaryTs) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, DEDUPE_READ_BYTES);
    const fd = fs.openSync(file, 'r');
    let text;
    try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, st.size - len); text = b.toString('utf8'); } finally { fs.closeSync(fd); }
    for (const line of text.split('\n')) {
      if (!line.includes(boundaryTs)) continue;
      try { const o = JSON.parse(line); if (o.session_id === (sessionId || null) && o.boundary_timestamp === boundaryTs) return true; } catch { /* partial line */ }
    }
  } catch { /* no file yet */ }
  return false;
}

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
    let pre = meta && Number.isFinite(meta.preTokens) ? meta.preTokens : null;
    const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
    const bts = boundary && boundary.timestamp ? String(boundary.timestamp) : null;
    // Freshness: a boundary older than this compaction's PreCompact checkpoint (or, with no checkpoint time,
    // older than a fixed window) belongs to an earlier compaction: record no number rather than a wrong one.
    if (boundary && pre !== null) {
      const t = Date.parse(bts);
      const floor = Number.isFinite(opts.notBeforeMs) ? opts.notBeforeMs : nowMs - FRESH_WINDOW_MS;
      if (!Number.isFinite(t)) { pre = null; reason = 'compact_boundary has no usable timestamp, so it cannot be tied to this compaction'; }
      else if (t < floor) {
        pre = null;
        reason = `stale compact_boundary (${bts}) is older than this compaction's ${Number.isFinite(opts.notBeforeMs) ? 'PreCompact checkpoint' : '10 minute window'}; its preTokens belong to an earlier compaction`;
      }
    }
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
    if (bts && alreadyRecorded(file, opts.sessionId, bts)) return { skipped: 'this (session, boundary_timestamp) is already recorded' };
    const store = require('./jsonl-store.js');
    store.ensureDir(path.dirname(file));
    store.appendRow(file, row);
    return row;
  } catch (e) {
    return { skipped: `record failed: ${clip(e && e.message, 100)}` };
  }
}

module.exports = {
  buildHandoff, fleetStateSection, openTasksPart, openFleetTasksFile, OPEN_TASKS_BUDGET, fleetBinResolved, recordCoverage, coverageRecordFile, COVERAGE_ID_RE, gitSection, dispatchSection, markerLedgerSection, modelNoteSection, modelNotePath,
  budgetWarning, readBudget, recordCompactionPoint, lastCompactBoundary, compactionPointsFile,
  AUTOCOMPACT_BUFFER_TOKENS, DEFAULT_GAP_TOKENS, DEFAULT_T2_TOKENS, BODY_CAP, SECTION_CAPS, INBOUND_BUDGET, inboundSection, HANDOFF_DEADLINE_MS,
};
