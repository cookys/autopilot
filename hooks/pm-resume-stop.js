#!/usr/bin/env node
/**
 * pm-resume-stop - Stop (Claude Code). Default-on, warn only (never a Stop decision).
 *
 * Why: the SessionStart hook injects `fleet pm resume`, but a seat can still go on without reading it, or the injection
 * can have failed. After a restart, clear or compaction the first turn must start from the in-flight work.
 * What: at the first Stop of a fleet seat's session, reminds once when (a) no resume injection was recorded or it failed,
 * or (b) it succeeded but no tool call in this session mentions any of the 26-char task ids it listed.
 * Output: the alert goes to the session's advisory queue (hooks/advisory-relay.js hands it to the model on the next
 * prompt) plus stderr. Once per session: the marker file records `reminded`.
 * Opt-out: AUTOPILOT_PM_RESUME_STOP=false (or 0/off/no). Fail-open: any error -> exit 0, no output.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readMarker, writeMarker, resolveSeat, ID_RE } = require('./lib/pm-resume.js');

const QUEUE_MAX_ENTRIES = 20;
const QUEUE_MAX_BYTES = 8192;

function readPayload() {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = fs.readFileSync('/dev/stdin', 'utf8'); }
  const input = JSON.parse(raw);
  if (!input || typeof input !== 'object') throw new Error('payload is not an object');
  return input;
}

function optedOut(env) {
  const v = env.AUTOPILOT_PM_RESUME_STOP;
  return typeof v === 'string' && ['false', '0', 'off', 'no'].includes(v.trim().toLowerCase());
}

// True when some tool call (not the injected context) in the transcript names one of the ids,
// or runs `fleet pm resume` by hand (the seat already read its in-flight work itself).
function touchedAny(transcriptPath, ids) {
  if (!transcriptPath) return false;
  let text;
  try { text = fs.readFileSync(transcriptPath, 'utf8'); } catch { return true; } // cannot read: do not nag
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    if (/fleet\s+pm\s+resume/.test(line)) return true;
    const found = line.match(ID_RE);
    if (found && found.some((id) => ids.includes(id))) return true;
  }
  return false;
}

function enqueue(sessionId, text) {
  const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const qdir = path.join(resolveLiveDir({ warn: () => {} }).base, 'advisory-queue');
  fs.mkdirSync(qdir, { recursive: true });
  const qfile = path.join(qdir, `${sanitizeSessionId(sessionId)}.jsonl`);
  let entries = [];
  try {
    entries = fs.readFileSync(qfile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { entries = []; }
  entries.push({ ts: new Date().toISOString(), source: 'pm-resume-stop', text });
  while (entries.length > QUEUE_MAX_ENTRIES) entries.shift();
  const dump = () => entries.map((e) => `${JSON.stringify(e)}\n`).join('');
  while (entries.length > 1 && Buffer.byteLength(dump(), 'utf8') > QUEUE_MAX_BYTES) entries.shift();
  const tmp = `${qfile}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, dump());
  fs.renameSync(tmp, qfile);
}

function decide(input, env) {
  const sessionId = String(input.session_id || env.CLAUDE_CODE_SESSION_ID || '');
  if (!sessionId) return null;
  const marker = readMarker(sessionId, env);
  if (marker && marker.reminded) return null;
  if (!marker) {
    if (!resolveSeat(input, env)) return null; // not a fleet seat: nothing to resume
    if (touchedAny(input.transcript_path, [])) return null; // no injection record, but the seat ran resume itself
    return { sessionId, marker: {}, text: '[pm-resume] 這個 session 開始後沒有記錄到 fleet pm resume 的注入（可能是舊版 plugin 或 hook 沒跑）。第一步先跑 `fleet pm resume --seat <你的席位> --role <pm|lead|member>`，從 IN_FLIGHT 的單開始。' };
  }
  if (!marker.ok) return { sessionId, marker, text: '[pm-resume] 開機時 resume 沒讀到。第一步先自己跑 `fleet pm resume --seat <你的席位> --role <pm|lead|member>`，從 IN_FLIGHT 的單開始。' };
  if (!touchedAny(input.transcript_path, marker.ids || [])) {
    return { sessionId, marker, text: '[pm-resume] 注入的在途單，到現在一張都沒碰過。先處理 IN_FLIGHT 的單（讀、回報或結掉），再做別的；若都已不需要，在單上寫一行原因。' };
  }
  return null;
}

function main() {
  const env = process.env;
  if (optedOut(env)) return;
  const input = readPayload();
  const d = decide(input, env);
  if (!d) return;
  writeMarker(d.sessionId, { ...d.marker, reminded: true }, env);
  process.stderr.write(`${d.text}\n`);
  try { enqueue(d.sessionId, d.text); } catch { /* queue is best-effort */ }
}

try {
  main();
} catch (e) {
  try { process.stderr.write(`pm-resume-stop: fail-open: ${e && e.message ? e.message : e}\n`); } catch { /* ignore */ }
}
process.exit(0);
