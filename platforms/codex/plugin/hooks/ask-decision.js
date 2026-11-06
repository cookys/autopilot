#!/usr/bin/env node
/**
 * ask-decision — PreToolUse AskUserQuestion | (hosted) PostToolUse | SessionEnd. Default-on (mods P1W HOOKQ,
 * plan R5.8). Depth-0 asking the owner a question adds an entry to the scope's `decision/2` file (the open-questions block of
 * the job page / live pane reads it); the answer — or the session ending — closes it. A mechanism, not skill text: the
 * skill-text version scored 0/10 ON and OFF (eval report).
 *
 * Open (PreToolUse, matcher EXACTLY `AskUserQuestion`, so no other tool pays for it): payload WITHOUT `agent_id`
 * (a subagent never opens one). question = the first question's text (`（共 N 題）` appended when several),
 * options = its option labels + descriptions (>= 2, else null), source = "depth-0 AskUserQuestion", root = this session's
 * marker root (plain-inclusive record, unexpired), opened_by_session = the normalised session id, `origin: "ask_user_question"`.
 * `turn_tracked: true` is added when this session's `<live>/turn/<sid>.json` exists at open time (the watcher then reads a later missing file as "session ended").
 * Written through scripts/open-decision.js openDecision() (library call, same lock + atomic rename). It APPENDS an entry: no
 * other entry of the scope (hand-opened or another session's) is ever overwritten. Only this session's own earlier, still
 * unanswered entry (the pointer below) is superseded by the new question.
 *
 * Close: PostToolUse AskUserQuestion (hosted in hooks/audit-log.js's process — no new spawn) and SessionEnd
 * (hosted in awaiting-owner.js) call onPostToolUse / onSessionEnd. A pointer `<live>/ask-decision/<sid>.json`
 * names the file and entry id this session opened; that entry is removed only when `opened_by_session` matches and
 * `origin` is ours, so session A never closes session B's entry or a hand-opened one. An unanswered question stays (age never hides a
 * question; only an answer or the session end closes it).
 *
 * Opt-out: AUTOPILOT_ASK_DECISION=off. Fail-open: any error -> one stderr line, exit 0. Never blocks the tool,
 * never prints a permission decision.
 */
'use strict';

const L = require('./live-session-lib.js');

const SOURCE = 'ask_user_question'; // the entry's `origin`
const SOURCE_TEXT = 'depth-0 AskUserQuestion'; // the entry's `source` (who asked), shown to the owner
const KNOB = 'AUTOPILOT_ASK_DECISION';

// The writer/reader contract for live-file names (per code point, first 64): the same function names the turn file the watcher looks for.
const { sanitizeSessionId: normSession } = require('../scripts/lib/live-state-dir.js');

// This session's unexpired marker record (orchestrator OR plain), read through the shared reader
// scripts/session-mode.js readSessionRecord(sessionId): the hook payload carries the session id, so the env-keyed
// form is not used. Returns root_run_id or null.
function markerRoot(sessionId) {
  try {
    // shared judgement (session-mode.js readSessionRoot): an expired marker of a still-working session keeps its root
    const root = require('../scripts/session-mode.js').readSessionRoot(String(sessionId || ''), { liveBase: L.liveBase() }).root;
    return typeof root === 'string' && /^[A-Za-z0-9._-]+$/.test(root) && root !== '.' && root !== '..' ? root : null;
  } catch {
    return null;
  }
}

function questionFrom(input) {
  const qs = input && Array.isArray(input.questions) ? input.questions : [];
  const first = qs[0] && typeof qs[0] === 'object' ? qs[0] : null;
  const text = first && typeof first.question === 'string' ? first.question.trim() : '';
  if (!text) return null;
  const labels = Array.isArray(first.options)
    ? first.options.map((o) => (typeof o === 'string' ? { label: o, description: '' }
      : { label: o && typeof o.label === 'string' ? o.label : '', description: o && typeof o.description === 'string' ? o.description : '' }))
      .map((o) => ({ label: o.label.trim(), description: o.description.trim() })).filter((o) => o.label)
    : [];
  return {
    question: qs.length > 1 ? `${text}（共 ${qs.length} 題）` : text,
    options: labels.length >= 2 ? labels : null,
  };
}

function applies(p) {
  return p && typeof p === 'object' && p.tool_name === 'AskUserQuestion' && !p.agent_id
    && typeof p.session_id === 'string' && p.session_id && !L.knobOff(KNOB);
}

function onPreToolUse(p) {
  if (!applies(p) || typeof p.cwd !== 'string' || !p.cwd) return;
  const q = questionFrom(p.tool_input);
  if (!q) return;
  const session = normSession(p.session_id);
  closeOwn(p); // this session's earlier unanswered question is superseded; nobody else's entry is touched
  const { openDecision } = require('../scripts/open-decision.js');
  // turn tracking is a separate hook (awaiting-owner, own knob): record whether this session's turn file exists NOW, so a later
  // missing file only counts as "session ended" for an entry that saw it present (src/status/decision-input.js sessionGone)
  let turnTracked = false;
  try { const tf = L.sessionFile(p, 'turn'); turnTracked = !!tf && require('fs').existsSync(tf); } catch { /* unknown: not tracked */ }
  const r = openDecision({
    cwd: p.cwd, root: markerRoot(p.session_id), session, question: q.question, options: q.options,
    source: SOURCE_TEXT, origin: SOURCE, turn_tracked: turnTracked,
  });
  if (r.status !== 'ok') { L.failOpen('ask-decision', new Error(r.message)); return; }
  L.atomicWriteJson(L.sessionFile(p, 'ask-decision'), { schema: 'autopilot.ask-decision/2', decision_file: r.file, decision_id: r.id, opened_by_session: session });
}

function closeOwn(p) {
  if (!p || typeof p.session_id !== 'string' || !p.session_id) return;
  const ptr = L.sessionFile(p, 'ask-decision');
  if (!ptr) return;
  const rec = L.readJsonFile(ptr);
  if (!rec || typeof rec.decision_file !== 'string' || typeof rec.decision_id !== 'string') { L.removeFile(ptr); return; }
  const session = normSession(p.session_id);
  const { closeDecisionById } = require('../scripts/open-decision.js');
  closeDecisionById(rec.decision_file, rec.decision_id, (v) => v.origin === SOURCE && v.opened_by_session === session);
  L.removeFile(ptr);
}

// Hosted in audit-log.js (PostToolUse): the answer arrived. Only depth-0's own AskUserQuestion closes.
function onPostToolUse(p) {
  if (!applies(p)) return;
  closeOwn(p);
}

// Hosted in awaiting-owner.js (SessionEnd). No tool gate; knob still honoured.
function onSessionEnd(p) {
  if (L.knobOff(KNOB)) return;
  closeOwn(p);
}

module.exports = { onPreToolUse, onPostToolUse, onSessionEnd, questionFrom, markerRoot, SOURCE };

if (require.main === module) {
  try { onPreToolUse(L.readStdinJson()); } catch (e) { L.failOpen('ask-decision', e); }
  process.exit(0);
}
