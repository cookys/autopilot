#!/usr/bin/env node
/**
 * ask-decision — PreToolUse AskUserQuestion | (hosted) PostToolUse | SessionEnd. Default-on (mods P1W HOOKQ,
 * plan R5.8). Depth-0 asking the owner a question opens the scope's `decision/1` file (the open-question panel of
 * the job page / band reads it); the answer — or the session ending — closes it. A mechanism, not skill text: the
 * skill-text version scored 0/10 ON and OFF (eval report).
 *
 * Open (PreToolUse, matcher EXACTLY `AskUserQuestion`, so no other tool pays for it): payload WITHOUT `agent_id`
 * (a subagent never opens one). question = the first question's text (`（共 N 題）` appended when several),
 * options = its option labels (>= 2, else null), not_authorized = null, root = this session's marker root
 * (plain-inclusive record, unexpired), opened_by_session = the normalised session id, `source: "ask_user_question"`.
 * Written through scripts/open-decision.js openDecision() (library call, same lock + atomic rename).
 * Ownership: the hook replaces only a file it opened (`source` = ask_user_question); a hand-opened file (no `source`)
 * is never touched — the hook then does nothing.
 *
 * Close: PostToolUse AskUserQuestion (hosted in hooks/audit-log.js's process — no new spawn) and SessionEnd
 * (hosted in awaiting-owner.js) call onPostToolUse / onSessionEnd. A pointer `<live>/ask-decision/<sid>.json`
 * names the file this session opened; it is removed only when `opened_by_session` matches and `source` is ours,
 * so session A never closes session B's file or a hand-opened one. An unanswered question stays (age never hides a
 * question; only an answer or the session end closes it).
 *
 * Opt-out: AUTOPILOT_ASK_DECISION=off. Fail-open: any error -> one stderr line, exit 0. Never blocks the tool,
 * never prints a permission decision.
 */
'use strict';

const L = require('./live-session-lib.js');

const SOURCE = 'ask_user_question';
const KNOB = 'AUTOPILOT_ASK_DECISION';

function normSession(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

// This session's unexpired marker record (orchestrator OR plain; hook payload carries the session id, so the
// env-keyed readers in session-mode.js are not used). Returns root_run_id or null.
function markerRoot(sessionId) {
  try {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = process.env.AUTOPILOT_SESSION_MODE_DIR || path.join(os.homedir(), '.autopilot', 'session-mode');
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${normSession(sessionId)}.json`), 'utf8'));
    if (!m || typeof m !== 'object' || !(Date.parse(m.expires_at) > Date.now())) return null;
    const root = m.root_run_id;
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
    ? first.options.map((o) => (typeof o === 'string' ? o : (o && typeof o.label === 'string' ? o.label : ''))).map((s) => s.trim()).filter(Boolean)
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
  const { openDecision } = require('../scripts/open-decision.js');
  const r = openDecision({
    cwd: p.cwd, root: markerRoot(p.session_id), session, question: q.question, options: q.options,
    context: null, notAuthorized: null, source: SOURCE,
    // replace only what a hook opened; a hand-opened file (no source) is never overwritten
    mayReplace: (existing) => existing.source === SOURCE,
  });
  if (r.status === 'error') { L.failOpen('ask-decision', new Error(r.message)); return; }
  if (r.status !== 'ok') return; // declined: hand-opened file stays, and is not ours to close either
  L.atomicWriteJson(L.sessionFile(p, 'ask-decision'), { schema: 'autopilot.ask-decision/1', decision_file: r.file, opened_by_session: session });
}

function closeOwn(p) {
  if (!p || typeof p.session_id !== 'string' || !p.session_id) return;
  const ptr = L.sessionFile(p, 'ask-decision');
  if (!ptr) return;
  const rec = L.readJsonFile(ptr);
  if (!rec || typeof rec.decision_file !== 'string') return;
  const session = normSession(p.session_id);
  const { closeDecisionIf } = require('../scripts/open-decision.js');
  closeDecisionIf(rec.decision_file, (v) => v.source === SOURCE && v.opened_by_session === session);
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
