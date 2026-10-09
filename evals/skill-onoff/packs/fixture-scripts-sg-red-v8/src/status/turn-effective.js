'use strict';

// src/status/turn-effective.js — the effective turn state of sessions whose turn the hook left `active` (mods P1W GATEFIX2).
//
// Why: an Escape interrupt fires neither Stop nor an idle_prompt Notification, so `<live>/turn/<sid>.json` (written by
// hooks/live-session-lib.js recordTurn, the ONLY writer of that file) stays `active` and the band keeps saying 進行中.
// Claude Code does record the interrupt in the session transcript as a JSONL row
//   {"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user…]"}]},"interruptedMessageId":"msg_…","timestamp":"…"}
// The watcher reads the tail of that transcript each tick and, when the last conversational row is such a row and is newer
// than the turn's `since`, publishes the turn as ended.
//
// Where: `<live>/turn-effective/<same file name as the turn file>.json` (autopilot.session-turn-effective/1), a watcher-owned
// file. Chosen over `sessions[sid].turn_effective` in a scope envelope because (a) the single-writer rule keeps the hook's
// file untouched either way, (b) readers already key turn state by session id, while an envelope is per root scope and a
// reader would first have to work out which scope a session's turn belongs to (project_key is null on a repo's first prompt),
// and (c) a per-session file leaves the envelope schema alone. The file is a claim about ONE turn: it carries `turn_since`
// and a reader applies it only while the turn file's `since` is that same value, so a later UserPromptSubmit (new `since`)
// wins at once, before the watcher has cleaned up.
//
// Fail-safe toward 進行中: no transcript_path, unreadable / malformed transcript, no conversational row in the tail, a last
// row that is anything but the interrupt row -> nothing is published. Only the last TAIL_BYTES of the transcript are read.

const fs = require('fs');
const path = require('path');

const TURN_SCHEMA = 'autopilot.session-turn/1';
const EFFECTIVE_SCHEMA = 'autopilot.session-turn-effective/1';
const TAIL_BYTES = 8192;
const INTERRUPT_TEXT = '[Request interrupted by user';

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return null; } }
const ms = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };

// The last TAIL_BYTES of a file as text, plus whether the read started at offset 0. null when unreadable.
function readTail(file, size = TAIL_BYTES) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const st = fs.fstatSync(fd);
    const len = Math.min(size, st.size);
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) {
      const n = fs.readSync(fd, buf, got, len - got, st.size - len + got);
      if (n <= 0) break;
      got += n;
    }
    return { text: buf.subarray(0, got).toString('utf8'), whole: st.size <= size };
  } catch (_e) {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (_e) { /* ignore */ }
  }
}

const isInterruptRow = (row) => {
  if (!row || row.type !== 'user') return false;
  if (typeof row.interruptedMessageId === 'string' && row.interruptedMessageId) return true;
  const c = row.message && row.message.content;
  const texts = Array.isArray(c) ? c.map((b) => (b && typeof b.text === 'string' ? b.text : '')) : [typeof c === 'string' ? c : ''];
  return texts.some((t) => t.startsWith(INTERRUPT_TEXT));
};

// -> { interrupted_at_ms } when the last conversational (user / assistant) row of the transcript tail is an interrupt row
// newer than sinceMs; otherwise null. Bookkeeping rows (file-history-snapshot, attachment, system, ...) are skipped: Claude
// Code appends them after the interrupt row.
function interruptAfter(transcriptPath, sinceMs, tailBytes = TAIL_BYTES) {
  const tail = readTail(transcriptPath, tailBytes);
  if (!tail || !tail.text) return null;
  const lines = tail.text.split('\n');
  const endsComplete = tail.text.endsWith('\n');
  if (!endsComplete) {
    const last = lines[lines.length - 1];
    if (last.trim()) { try { JSON.parse(last); } catch (_e) { return null; } } // a row still being written: not "last"
  }
  if (!tail.whole) lines.shift(); // the first line of a tail read starts mid-row
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch (_e) { return null; }
    if (!row || (row.type !== 'user' && row.type !== 'assistant')) continue;
    if (!isInterruptRow(row)) return null;
    const at = ms(row.timestamp);
    return at !== null && at > sinceMs ? { interrupted_at_ms: at } : null;
  }
  return null;
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* ignore */ }
    throw error;
  }
}

// One watcher tick. Active turns of this project (or with no project yet) whose transcript ends in an interrupt get an
// effective-ended file; effective files whose turn is gone, ended or replaced are removed. Never writes `<live>/turn/`.
function publishTurnEffective({ liveBase, key, nowMs, log = () => {}, tailBytes = TAIL_BYTES }) {
  const turnDir = path.join(liveBase, 'turn');
  const outDir = path.join(liveBase, 'turn-effective');
  let names = [];
  try { names = fs.readdirSync(turnDir).filter((n) => n.endsWith('.json')); } catch (_e) { names = []; }
  const wanted = new Map();
  for (const n of names) {
    const turn = readJson(path.join(turnDir, n));
    if (!turn || turn.schema !== TURN_SCHEMA || turn.state !== 'active') continue;
    if (turn.project_key != null && turn.project_key !== key) continue;
    const since = ms(turn.since);
    if (since === null || typeof turn.transcript_path !== 'string' || !path.isAbsolute(turn.transcript_path) || !turn.transcript_path.endsWith('.jsonl')) continue;
    const hit = interruptAfter(turn.transcript_path, since, tailBytes);
    if (hit) wanted.set(n, { turn, hit });
  }
  for (const [n, { turn, hit }] of wanted) {
    const file = path.join(outDir, n);
    const cur = readJson(file);
    if (cur && cur.schema === EFFECTIVE_SCHEMA && cur.turn_since === turn.since && cur.state === 'ended') continue;
    try {
      writeAtomic(file, `${JSON.stringify({
        schema: EFFECTIVE_SCHEMA, session_id: turn.session_id, state: 'ended', reason: 'interrupted',
        turn_since: turn.since, ended_at: new Date(hit.interrupted_at_ms).toISOString(), published_at: new Date(nowMs).toISOString(),
      })}\n`);
      log(`turn ${n}: interrupted -> effective ended`);
    } catch (error) { log(`turn-effective write failed: ${error.message}`); }
  }
  let have = [];
  try { have = fs.readdirSync(outDir).filter((n) => n.endsWith('.json')); } catch (_e) { have = []; }
  for (const n of have) {
    if (wanted.has(n)) continue;
    const turn = readJson(path.join(turnDir, n));
    const cur = readJson(path.join(outDir, n));
    // Another project's watcher owns a file for its own turn: keep it while that turn is still the one it describes.
    // Our own (or project-less) claim that this tick's tail read no longer confirms is removed.
    const foreign = turn && turn.state === 'active' && turn.project_key != null && turn.project_key !== key && cur && cur.turn_since === turn.since;
    if (foreign) continue;
    try { fs.unlinkSync(path.join(outDir, n)); } catch (_e) { /* gone */ }
  }
}

module.exports = { publishTurnEffective, interruptAfter, readTail, EFFECTIVE_SCHEMA, TAIL_BYTES };
