'use strict';
/**
 * decision-answer.js - the ONE function that answers a decision card from outside the live pane (`autopilot decision answer`; contract
 * docs/dev/decision-cli.md). Node built-ins plus scripts/open-decision.js and scripts/lib/fleet-decision.js only.
 *
 * The pane answers by typing a `[待決回覆]` prompt into the session; hooks/advisory-relay.js then claims (fleet decision), parks the answer on the card
 * and sends it to the card's executor with open-decision.js deliverAnswer (parkAnswer + sendParked, the `[操作員答覆]` message). This module calls the
 * same deliverAnswer, with the same claim step (claimBeforeClose's rules), so there is no second implementation of recording, delivery or closing.
 *
 *   listCards(cwd, { all }) -> card views (open + awaiting_operator_action; all = every state)       viewOf(entry) -> the public card shape
 *   answerCard({ cwd, id, option, freeText, note, source, device, sender }) -> { ok:true, ... } | { ok:false, code, exit, message }
 *
 * Nothing is written on a refusal. A failed delivery is rolled back: the card is restored to its stored state (open), no audit row, so a retry works.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const od = require('../open-decision.js');
const { pickCards, cardState, isOpenEntry, isAwaitingEntry } = require('../../src/status/scope-key');

const SCHEMA = 'autopilot.decision/1';
const MAX_FREE_TEXT = 4000;
const MAX_NOTE = 2000;
const DEVICE = /^[A-Za-z0-9._:@-]{1,128}$/;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;
const EXIT = { ok: 0, usage: 2, not_found: 4, closed: 5, bad_option: 6, too_long: 7, delivery_failed: 8 };

const fail = (code, message) => ({ ok: false, code, exit: EXIT[code], message });

function viewOf(e) {
  const answered = typeof e.answer === 'string' || typeof e.answer_option === 'string' || typeof e.answer_free_text === 'string';
  return {
    id: e.id,
    question: e.question,
    options: Array.isArray(e.options) ? e.options.map((o) => ({ label: o.label, desc: o.description || '' })) : [],
    recommendation: e.recommendation || null,
    why: e.why || null,
    executor: e.executor || null,
    opened_at: e.opened_at,
    state: cardState(e),
    free_text: !Array.isArray(e.options),
    background: e.background || null,
    answer: answered ? { text: e.answer === undefined ? null : e.answer, option: e.answer_option || null, free_text: e.answer_free_text || null, answer_id: e.answer_id || null, at: e.answered_at || e.closed_at || null } : null,
  };
}

function allCards(cwd) {
  return pickCards(od.projectScopeFiles(cwd, { all: true }).flatMap((file) => od.readEntries(file, { all: true }).map((e) => ({ file, e }))));
}

function listCards(cwd, { all = false } = {}) {
  return allCards(cwd).map((w) => w.e).filter((e) => all || isOpenEntry(e) || isAwaitingEntry(e))
    .sort((a, b) => (Date.parse(a.opened_at) || 0) - (Date.parse(b.opened_at) || 0)).map(viewOf);
}

const findCardView = (cwd, id) => { const hit = od.findCard(cwd, id, { all: true }); return hit ? { file: hit.file, entry: hit.entry } : null; };

function checkText(s, max, what) {
  if (CONTROL.test(s)) return fail('too_long', `${what} contains a control character (only \\n and \\t are allowed)`);
  if ([...s].length > max) return fail('too_long', `${what} is longer than ${max} characters`);
  return null;
}

// Roll the card back to the stored entry `before` (the answer was parked, the send failed). Keys the failed attempt added are removed.
function restore(file, id, before) {
  od.patchDecision(file, id, (cur) => {
    const patch = {};
    for (const k of Object.keys(cur)) if (!(k in before)) patch[k] = undefined;
    return { ...patch, ...before };
  }, { any: true });
}

function answerCard({ cwd, id, option, freeText, note, source, device, sender, now = () => new Date() }) {
  if (option !== undefined && freeText !== undefined) return fail('bad_option', 'give --option or --free-text, not both');
  if (option === undefined && freeText === undefined) return fail('bad_option', 'one of --option / --free-text is required');
  let bad = null;
  if (freeText !== undefined) bad = checkText(freeText, MAX_FREE_TEXT, 'free text');
  if (!bad && note !== undefined) bad = checkText(note, MAX_NOTE, 'note');
  if (!bad && option !== undefined) bad = checkText(option, 512, 'option');
  if (bad) return bad;
  const hit = findCardView(cwd, id);
  if (!hit) return fail('not_found', `no such decision: ${id}`);
  const before = JSON.parse(JSON.stringify(hit.entry));
  if (!isOpenEntry(before)) return fail('closed', `${id} is ${cardState(before)}, not open: already answered or closed`);
  const hasOptions = Array.isArray(before.options);
  if (option !== undefined) {
    if (!hasOptions) return fail('bad_option', `${id} is a free-text card: it takes --free-text`);
    if (!before.options.some((o) => o.label === option)) return fail('bad_option', `"${option}" is not one of the card's options`);
  } else {
    if (hasOptions) return fail('bad_option', `${id} has options: it takes --option (a note goes in --note)`);
    if (note !== undefined) return fail('bad_option', 'a free-text answer takes no --note');
  }
  // the courier claim, the rules of open-decision.js claimBeforeClose: no courier -> local answer id; a claim that is not clean holds the card open
  const fd = require('./fleet-decision.js');
  const pr = fd.probe();
  if (pr === 'probe_error') return fail('delivery_failed', 'could not tell whether this host has a fleet courier; the answer is held, nothing recorded');
  let answerId = `local${crypto.randomBytes(12).toString('hex')}`;
  if (pr === 'supported') {
    const c = fd.claim(id, option !== undefined ? { option, freeText: note } : { freeText });
    if (c.outcome === 'already_answered' || c.outcome === 'card_closed') return fail('closed', `${id} was already answered or closed on the courier`);
    if (c.outcome !== 'claimed') return fail('delivery_failed', `claim ${c.outcome}${c.detail ? ` (${c.detail})` : ''}; the answer is held, nothing recorded`);
    answerId = c.answer_id;
  }
  let state;
  let messageId = null;
  if (before.executor) {
    const v = { answer: { option: option !== undefined ? option : null, free_text: option !== undefined ? null : freeText }, answer_id: answerId, local_note: option !== undefined && note ? note : null };
    const r = od.deliverAnswer(hit.file, id, v, sender);
    if (r.status === 'in_flight') return fail('closed', `${id} is being delivered by another process`);
    if (r.status === 'reask' || r.status === 'sent' || r.status === 'already') { if (r.status !== 'reask') messageId = r.message_id || null; state = cardState(findCardView(cwd, id).entry); } else {
      if (r.status !== 'absent') restore(hit.file, id, before);
      return r.status === 'absent' ? fail('not_found', `no such decision: ${id}`) : fail('delivery_failed', `delivery to ${before.executor} failed (${r.error || r.status}); the card stays open, nothing recorded`);
    }
  } else {
    const r = od.closeDecisionById(hit.file, id, undefined, option !== undefined ? option : freeText);
    if (r.status !== 'closed') return fail('delivery_failed', `could not close the card: ${r.message || r.status}`);
    state = cardState(findCardView(cwd, id).entry);
  }
  const row = { at: now().toISOString(), card_id: id, ...(option !== undefined ? { option } : { free_text_len: [...freeText].length }), note_len: note === undefined ? 0 : [...note].length, source, device };
  fs.appendFileSync(path.join(path.dirname(hit.file), 'answers-audit.jsonl'), `${JSON.stringify(row)}\n`, { mode: 0o600 });
  return { ok: true, card_id: id, state, answer_id: answerId, message_id: messageId, executor: before.executor || null };
}

module.exports = { SCHEMA, EXIT, DEVICE, MAX_FREE_TEXT, MAX_NOTE, listCards, viewOf, findCardView, answerCard };
