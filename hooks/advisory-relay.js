#!/usr/bin/env node
/**
 * advisory-relay — UserPromptSubmit (default-on)
 * Drains this session's group-S advisory queue (written by cost-tracker,
 * check-console, batch-format at Stop) into one additionalContext blob.
 * Opt-out: AUTOPILOT_ADVISORY_RELAY=off (no file access).
 * Inert when the queue file is absent or empty.
 *
 * Never emits permissionDecision. Fail-open: any error → exit 0, no stdout.
 *
 * Also the UserPromptSubmit HOST (mods P1W PERF): awaiting-owner's end-of-wait work and the
 * runs-watch-autostart ensure run in THIS process (hooks/awaiting-owner.js onUserPromptSubmit), so a
 * prompt costs no extra node spawn for them. They run before, and independent of, the relay's own knob;
 * their opt-outs are AUTOPILOT_AWAITING_OWNER / AUTOPILOT_RUNS_WATCH_AUTOSTART=0. Their failures never
 * change this hook's output. A live-panel answer whose first line is [待決回覆] closes the named
 * decision cards here too (opt-out AUTOPILOT_DECIDE_REPLY_CLOSE=off); that step is also fail-open.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DECIDE_REPLY_HEAD = '[待決回覆]';
const DECIDE_ID = /^d-[0-9a-f]{8}(?![0-9a-f])/;

function closeDecideReply(payload) {
  if (process.env.AUTOPILOT_DECIDE_REPLY_CLOSE === 'off') return;
  const prompt = payload && payload.prompt;
  if (typeof prompt !== 'string') return;
  const lines = prompt.split(/\r?\n/);
  if (lines[0] !== DECIDE_REPLY_HEAD) return;
  const ids = [];
  const seen = new Set();
  for (const line of lines.slice(1)) {
    const m = DECIDE_ID.exec(line);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    ids.push(m[0]);
  }
  if (ids.length === 0) return;
  let closeDecisionById;
  let projectScopeFiles;
  try {
    ({ closeDecisionById, projectScopeFiles } = require('../scripts/open-decision.js'));
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
    return;
  }
  let files;
  try {
    files = projectScopeFiles(payload.cwd);
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
    return;
  }
  for (const id of ids) {
    // closeDecisionById locks before it looks up the id, so a locked scope file
    // returns status error even when this card is not in it. Keep every error
    // and keep walking; a later scope file may still hold the card. One line is
    // written only when the card was not closed in any scope file and at least
    // one error was collected. Each error is prefixed with that file's basename.
    const failures = [];
    let closed = false;
    for (const file of files) {
      let r;
      const note = (msg) => { failures.push(`${path.basename(file)}: ${msg}`); };
      try {
        r = closeDecisionById(file, id);
      } catch (e) {
        note(e && e.message ? e.message : String(e));
        continue;
      }
      if (r && r.status === 'error') {
        note(r.message || 'close failed');
        continue;
      }
      if (r && r.status !== 'absent') {
        closed = true;
        break;
      }
    }
    if (!closed && failures.length > 0) {
      process.stderr.write(`advisory-relay: decide-reply close fail-open: ${id}: ${failures.join('; ')}\n`);
    }
  }
}

// BL-0336: the autostart's failure sentence (watcher could not start / live dir unusable) is the only thing this host adds to
// stdout besides the advisory blob; it travels as a systemMessage, in the same JSON object when both exist.
let sysMsg = null;
function bye() {
  try { if (sysMsg) fs.writeSync(1, JSON.stringify({ systemMessage: sysMsg })); } catch { /* fail-open */ }
  process.exit(0);
}

try {
  let raw;
  try { raw = fs.readFileSync(0, 'utf8'); }
  catch { try { raw = fs.readFileSync('/dev/stdin', 'utf8'); } catch { raw = ''; } }
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  try {
    if (payload && typeof payload === 'object') sysMsg = require('./awaiting-owner.js').onUserPromptSubmit(payload) || null;
  } catch (e) {
    process.stderr.write(`advisory-relay: live-state hosting fail-open: ${e && e.message ? e.message : e}\n`);
  }
  try {
    if (payload && typeof payload === 'object') closeDecideReply(payload);
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
  }
  if (process.env.AUTOPILOT_ADVISORY_RELAY === 'off') bye();
  const sid = payload && payload.session_id;
  if (typeof sid !== 'string' || sid.length === 0) {
    process.stderr.write('advisory-relay: debug missing/empty session_id; queue not drained\n');
    bye();
  }

  const { resolveLiveDir, sanitizeSessionId } = require('../scripts/lib/live-state-dir.js');
  const qfile = path.join(resolveLiveDir().base, 'advisory-queue', `${sanitizeSessionId(sid)}.jsonl`);

  let st;
  try { st = fs.lstatSync(qfile); } catch { bye(); }
  if (!st.isFile() || st.size === 0) bye();

  const tmp = `${qfile}.drain.${process.pid}.${Date.now()}`;
  try { fs.renameSync(qfile, tmp); } catch (e) {
    if (e && e.code === 'ENOENT') bye();
    bye();
  }

  let body = '';
  try { body = fs.readFileSync(tmp, 'utf8'); } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    bye();
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const texts = [];
  let expiredOrMalformed = 0;
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch {
      expiredOrMalformed += 1;
      continue;
    }
    if (!obj || typeof obj.text !== 'string') {
      expiredOrMalformed += 1;
      continue;
    }
    const ts = typeof obj.ts === 'string' ? Date.parse(obj.ts) : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) {
      expiredOrMalformed += 1;
      continue;
    }
    texts.push(obj.text);
  }
  if (expiredOrMalformed > 0) {
    process.stderr.write(`advisory-relay: debug dropped ${expiredOrMalformed} expired/malformed entries\n`);
  }

  if (texts.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: texts.join('\n'),
      },
      ...(sysMsg ? { systemMessage: sysMsg } : {}),
    }));
    sysMsg = null;
  }

  try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  bye();
} catch {
  bye();
}
