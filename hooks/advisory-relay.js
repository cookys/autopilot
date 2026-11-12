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
 * prompt costs no extra node spawn for them. Opt-in askpm-log's UserPromptSubmit half also runs
 * here, and only when hooks.askpm-log / AUTOPILOT_HOOK_ASKPM_LOG is on (hooks/_shared/opt-in.js);
 * disabled, it starts no child. They run before, and independent of, the relay's own knob;
 * their opt-outs are AUTOPILOT_AWAITING_OWNER / AUTOPILOT_RUNS_WATCH_AUTOSTART=0. Their failures never
 * change this hook's output. A live-panel answer whose first line is [待決回覆] closes the named
 * decision cards here too (opt-out AUTOPILOT_DECIDE_REPLY_CLOSE=off); that step is also fail-open.
 * A card with operator_steps and a non-decline answer becomes awaiting_operator_action instead of closed; a decline stays open with reask_at and is not sent.
 * A one-line `[待決回覆·更正]` prompt (the pane's 改答案) closes nothing: it appends the new answer to the card's answer_corrections and says it was not courier-verified.
 * An id found in no scope file of the project is reported (systemMessage + stderr), never skipped silently.
 *
 * hooks.json timeout (70 s) is the worst case of the [待決回覆] path, from scripts/lib/fleet-decision.js: probe() 5 s, then per card
 * verify() = two `fleet decision verify` calls of up to 15 s each = 30 s; 5 + 2 cards x 30 + 5 s margin for awaiting-owner = 70 s.
 * The send step is bounded separately: every answered card is verified and parked first, then sent in order under one deadline (AUTOPILOT_RELAY_SEND_BUDGET_MS,
 * default 45 s from the hook's start; per send min(20 s, remaining)); cards not sent in time stay pending_dispatch with dispatch_error hook_budget.
 * The old 10 s killed the hook, silently, after a single slow verify. Typical cost is milliseconds.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DECIDE_REPLY_HEAD = '[待決回覆]';
const DECIDE_ID = /^d-[0-9a-f]{8}(?![0-9a-f])/;

const storedText = (a) => (a && typeof a === 'object' ? JSON.stringify(a.option !== null && a.option !== undefined ? { option: a.option } : { free_text: a.free_text === undefined ? null : a.free_text }) : 'nothing');

function closeDecideReply(payload) {
  if (process.env.AUTOPILOT_DECIDE_REPLY_CLOSE === 'off') return;
  const prompt = payload && payload.prompt;
  if (typeof prompt !== 'string') return;
  const lines = prompt.split(/\r?\n/);
  if (lines[0] !== DECIDE_REPLY_HEAD) return;
  const hookStart = Date.now();
  const ids = [];
  const seen = new Set();
  const idLine = new Map();
  for (const line of lines.slice(1)) {
    const m = DECIDE_ID.exec(line);
    if (!m || seen.has(m[0])) continue;
    seen.add(m[0]);
    ids.push(m[0]);
    idLine.set(m[0], line);
  }
  if (ids.length === 0) return;
  let closePanelAnswer;
  let projectScopeFiles;
  let readEntries;
  let parkAnswer;
  let sendParked;
  let parkUndelivered;
  let receiptLine;
  try {
    ({ closePanelAnswer, projectScopeFiles, readEntries, parkAnswer, sendParked, receiptLine, parkUndelivered } = require('../scripts/open-decision.js'));
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
    return;
  }
  let files;
  try {
    files = projectScopeFiles(payload.cwd, { all: true }); // all: a card parked in pending_dispatch takes a later answer too
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
    return;
  }
  // F4 verify-before-act: on a host whose courier speaks `fleet decision`, a line is acted on (its card closed) only after
  // `fleet decision verify` accepts its answer_id (the last ｜ field). One call per card, never a retry or a sleep here.
  // No courier on this host: today's behaviour.
  let fd = null;
  let probeState = 'unsupported';
  try { const m = require('../scripts/lib/fleet-decision.js'); probeState = m.probe(); if (probeState === 'supported') fd = m; } catch (_e) { probeState = 'probe_error'; }
  const toSend = []; // parked answers, sent in order after every card is verified and parked
  const unverified = [];
  const notFound = [];
  const delivery = new Map(); // id -> the verified answer of a card that has an executor: the program delivers it (PM 01M6ZXJYTQ), nothing closes it directly
  // A card with an executor never closes unless its answer was delivered: when the answer cannot be delivered it is parked in pending_dispatch with dispatch_error = reason.
  const parkExecutorCard = (id, reason) => {
    for (const file of files) {
      let r;
      try { r = parkUndelivered(file, id, reason); } catch (_e) { continue; }
      if (r.status === 'parked' || r.status === 'error') {
        const line = `[答覆未送達] ${id} → ${r.executor}: ${r.status === 'parked' ? reason : r.error}（卡片留在 pending_dispatch，沒有關閉）`;
        ctxLines.push(line); process.stderr.write(`advisory-relay: ${line}\n`);
        return true;
      }
      if (r.status === 'no_executor') return false;
    }
    return false;
  };
  for (const id of ids) {
    if (probeState === 'probe_error') { if (!parkExecutorCard(id, 'probe_error')) unverified.push(`${id} (probe_error)`); continue; } // not "no courier": nothing is acted on
    if (fd) {
      const line = idLine.get(id);
      const aid = line.split('｜').pop().trim();
      const v = /^[0-9A-Za-z]{20,40}$/.test(aid) ? fd.verify(id, aid, line) : { ok: false, outcome: 'unverified' };
      if (!v.ok) { if (!parkExecutorCard(id, `verify_failed (${v.outcome})`)) unverified.push(`${id} (${v.outcome})`); continue; }
      // the verified STORED answer is the only authority: the line's own text must say that same answer
      // strict, field-wise (scripts/lib/decide-line.js): the question comes from the ledger card, the answer must EQUAL the stored one
      let question = null;
      try { for (const f of files) { const e = readEntries(f, { all: true }).find((x) => x.id === id); if (e) { question = e.question; break; } } } catch (_e) { question = null; }
      const bound = require('../scripts/lib/decide-line.js').lineSaysAnswer(line, v.answer, question);
      if (!bound.ok) { if (parkExecutorCard(id, 'content_mismatch')) continue; unverified.push(`${id} (content_mismatch; the courier stored ${storedText(v.answer)})`); continue; }
      delivery.set(id, { answer: v.answer, answer_id: aid });
    }
    if (delivery.has(id)) {
      // a card with an executor: park the verified answer now (every answered card first), send later in order under one deadline
      let handled = false;
      for (const file of files) {
        let hit;
        try { hit = readEntries(file, { all: true }).find((e) => e.id === id); } catch (_e) { hit = null; }
        if (!hit || !hit.executor) continue;
        const r = parkAnswer(file, id, delivery.get(id));
        if (r.status === 'absent' || r.status === 'not_parked') continue;
        handled = true;
        if (r.status === 'error') { const line = receiptLine({ status: 'failed', id, executor: r.executor, error: r.error, attempts: 1 }); ctxLines.push(line); process.stderr.write(`advisory-relay: ${line}\n`); break; }
        if (r.status === 'reask') {
          const line = `[稍後再問] ${id} reask_at=${r.reask_at}（卡片仍開著）`;
          ctxLines.push(line); process.stderr.write(`advisory-relay: ${line}\n`);
          break;
        }
        toSend.push({ file, id });
        break;
      }
      if (handled) continue;
    }
    if (!fd && parkExecutorCard(id, 'no_courier')) continue;
    // closePanelAnswer (and the closeDecisionById it calls for a normal answer) locks before it looks up the id, so a locked scope file
    // returns status error even when this card is not in it. Keep every error
    // and keep walking; a later scope file may still hold the card. One line is
    // written only when the card was not handled in any scope file and at least
    // one error was collected. Each error is prefixed with that file's basename.
    // `closed` here means handled: a decline (reask) or an operator-step card (awaiting) is not closed, and is not reported missing.
    const failures = [];
    let closed = false;
    for (const file of files) {
      let r;
      const note = (msg) => { failures.push(`${path.basename(file)}: ${msg}`); };
      try {
        r = closePanelAnswer(file, id, idLine.get(id));
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
    if (!closed && failures.length === 0) notFound.push(id);
  }
  // Send phase: one absolute deadline for the whole hook (hooks.json allows 70 s; the default budget is 45 s, measured from the hook's start), passed to every sendParked:
  // each send gets min(20 s, remaining), and a send needs 5 s left, else the card stays pending_dispatch with dispatch_error hook_budget for `redeliver`.
  const budget = Number(process.env.AUTOPILOT_RELAY_SEND_BUDGET_MS) > 0 ? Number(process.env.AUTOPILOT_RELAY_SEND_BUDGET_MS) : 45000;
  const deadline = hookStart + budget;
  for (const { file, id } of toSend) {
    const r = sendParked(file, id, undefined, { deadline });
    const ok = r.status === 'sent' || r.status === 'already' || r.status === 'in_flight';
    const line = receiptLine(ok ? r : { ...r, status: 'failed', error: r.error || r.status, attempts: r.attempts || 1 });
    ctxLines.push(line);
    if (!ok) process.stderr.write(`advisory-relay: ${line}\n`);
  }
  if (notFound.length > 0) {
    const where = files.length === 0
      ? `no decision scope file exists for cwd ${payload.cwd || process.cwd()} (not inside a git repo, or no card was ever opened in this project)`
      : `${files.length} scope file(s) of this project were searched`;
    const note = `[待決回覆] no open card ${notFound.join(', ')} in this session's project: ${where}. Nothing was closed; the card may belong to another project or already be closed. Tell the owner.`;
    process.stderr.write(`advisory-relay: ${note}\n`);
    sysMsg = sysMsg ? `${sysMsg}\n${note}` : note;
  }
  if (unverified.length > 0) {
    const note = `unverified [待決回覆]: ${unverified.join(', ')}; the courier did not confirm these answers, so they are NOT acted on and their cards stay open. Tell the owner.`;
    process.stderr.write(`advisory-relay: ${note}\n`);
    sysMsg = sysMsg ? `${sysMsg}\n${note}` : note;
  }
}

// A correction of an answer the pane already sent: the whole prompt is ONE `[待決回覆·更正] <id> → <answer>[｜補充：<note>]` line (scripts/lib/decide-line.js parseCorrectionLine).
// The card was closed by the first answer, so this never closes or reopens anything: it only appends {at, answer, note, verified:false} to the card's `answer_corrections`
// and says so in a systemMessage. It is NOT verified: `fleet decision claim` takes one claim per card (a second answers "already answered"), so the line carries no answer id and the
// courier cannot confirm it; the message says that. Opt-out: AUTOPILOT_DECIDE_REPLY_CLOSE=off (the same knob as the first-answer close).
function recordCorrection(payload) {
  if (process.env.AUTOPILOT_DECIDE_REPLY_CLOSE === 'off') return;
  const prompt = payload && payload.prompt;
  if (typeof prompt !== 'string') return;
  const c = require('../scripts/lib/decide-line.js').parseCorrectionLine(prompt);
  if (!c) return;
  let recorded = false;
  try {
    const { projectScopeFiles, recordCorrection: record } = require('../scripts/open-decision.js');
    for (const file of projectScopeFiles(payload.cwd, { all: true })) { // all: the card is normally closed already
      const r = record(file, c.id, { at: new Date().toISOString(), answer: c.answer, note: c.note, verified: false });
      if (r && r.status === 'updated') { recorded = true; break; }
    }
  } catch (e) {
    process.stderr.write(`advisory-relay: correction record fail-open: ${e && e.message ? e.message : e}\n`);
  }
  const note = `更正：${c.id} 新答案 ${c.answer}${c.note ? `（補充：${c.note}）` : ''}；已在執行的 lane 需停下或改做。未經 courier 核實${recorded ? '' : '；找不到這張卡，沒有記到卡上'}。`;
  sysMsg = sysMsg ? `${sysMsg}\n${note}` : note;
}

// BL-0336: the autostart's failure sentence (watcher could not start / live dir unusable) is the only thing this host adds to
// stdout besides the advisory blob; it travels as a systemMessage, in the same JSON object when both exist.
let sysMsg = null;
const ctxLines = []; // receipt lines of delivered panel answers: the model of this (PM) session reads them
function bye() {
  try {
    if (ctxLines.length) fs.writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctxLines.join('\n') }, ...(sysMsg ? { systemMessage: sysMsg } : {}) }));
    else if (sysMsg) fs.writeSync(1, JSON.stringify({ systemMessage: sysMsg }));
  } catch { /* fail-open */ }
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
    if (payload && typeof payload === 'object' && require('./_shared/opt-in').isEnabled('askpm-log')) {
      require('./askpm-log').handle(payload, { AUTOPILOT_STATE_DIR: process.env.AUTOPILOT_STATE_DIR, XDG_STATE_HOME: process.env.XDG_STATE_HOME, HOME: process.env.HOME });
    }
  } catch (e) {
    process.stderr.write(`advisory-relay: askpm-log hosting fail-open: ${e && e.message ? e.message : e}\n`);
  }
  try {
    if (payload && typeof payload === 'object') closeDecideReply(payload);
  } catch (e) {
    process.stderr.write(`advisory-relay: decide-reply close fail-open: ${e && e.message ? e.message : e}\n`);
  }
  try {
    if (payload && typeof payload === 'object') recordCorrection(payload);
  } catch (e) {
    process.stderr.write(`advisory-relay: correction record fail-open: ${e && e.message ? e.message : e}\n`);
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
        additionalContext: [...ctxLines.splice(0), ...texts].join('\n'),
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
