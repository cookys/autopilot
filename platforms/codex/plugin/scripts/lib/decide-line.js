'use strict';
/**
 * decide-line.js — strict parser for one answer line of a `[待決回覆]` reply, and the check that it says the SAME answer the fleet courier stored.
 *
 * The producer is the live pane: mods/live/model.ts `decideLine` (the `DECIDE_*` constants above it), which writes
 *   <id>｜<excerpt> → <answer>[｜補充：<note>]            and F4 appends  ｜<answer_id>
 * where excerpt = the card question flattened (runs of blanks -> one blank, trimmed), first 30 code points, plus `…` when longer, and every
 * `｜` inside the excerpt, the answer and the note was replaced by the half-width `|` (`wire`). So a full-width `｜` is ONLY ever a field
 * separator, and a line with any other number of fields did not come from the pane.
 *
 * Fields (split on `｜` only): id, body, [note], answer_id.  The body must be exactly `<excerpt of the card's question> → <answer>`; the excerpt is
 * recomputed from the ledger entry, so a ` → ` inside the question or the answer cannot move the boundary. The answer must EQUAL the stored
 * answer (only outer blanks removed): no substring, no prefix, no separator folding. The note takes part in exactly one case: a free-text answer
 * written as `都不選｜補充：<text>` (the panel's form for "picked none, typed a text"), where the note must equal the stored free text.
 */
const ARROW = ' → ';
const NONE = '都不選';
const NOTE_MARK = '補充：';
// A correction of an answer that was already sent (the pane's 改答案): ONE line, `[待決回覆·更正] <id> → <answer>[｜補充：<note>]`. The producer is mods/live/model.ts decideCorrectionLine.
// It has no excerpt and no answer id: the courier takes one claim per card, so a correction is never claimed or verified.
const CORRECTION_HEAD = '[待決回覆\u00b7更正]';
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
const wire = (s) => flat(s).replace(/｜/g, '|');
function excerptOf(q) { const cs = [...flat(q)]; return cs.length <= 30 ? cs.join('') : `${cs.slice(0, 30).join('')}…`; }

// -> { id, body, note (string|null), answerId } | null
function parseDecideLine(line) {
  const f = String(line).split('｜');
  if (f.length !== 3 && f.length !== 4) return null;
  const note = f.length === 4 ? f[2] : null;
  if (note !== null && !note.startsWith(NOTE_MARK)) return null;
  return { id: f[0].trim(), body: f[1].trim(), note, answerId: f[f.length - 1].trim() };
}

// stored = the answer `fleet decision verify` printed ({option, free_text}); question = the ledger card's question. -> { ok, reason }
function lineSaysAnswer(line, stored, question) {
  const p = parseDecideLine(line);
  if (!p) return { ok: false, reason: 'format' };
  if (!stored || typeof stored !== 'object' || typeof question !== 'string' || !question.trim()) return { ok: false, reason: 'no_reference' };
  const prefix = wire(excerptOf(question)) + ARROW;
  if (!p.body.startsWith(prefix)) return { ok: false, reason: 'question' };
  const answer = p.body.slice(prefix.length).trim();
  if (stored.option !== null && stored.option !== undefined) {
    return typeof stored.option === 'string' && stored.option !== '' && answer === wire(stored.option) ? { ok: true } : { ok: false, reason: 'answer' };
  }
  const ft = stored.free_text;
  if (typeof ft !== 'string' || ft === '') return { ok: false, reason: 'answer' };
  // a free-text card writes the typed text as the answer; an option card whose owner picked none writes `都不選` and the text in the note
  if (p.note === null) return answer === wire(ft) ? { ok: true } : { ok: false, reason: 'answer' };
  // the panel puts the typed text in the note here, so the note must EQUAL the stored text (outer blanks ignored)
  return answer === NONE && p.note.slice(NOTE_MARK.length).trim() === wire(ft) ? { ok: true } : { ok: false, reason: 'answer' };
}

// -> { id, answer, note (string|null) } | null. Strict: the whole prompt is this one line (a multi-line prompt is not a correction), the id is a ledger card id, the arrow is the first ` → `.
function parseCorrectionLine(prompt) {
  const text = String(prompt);
  if (text.includes('\n') || !text.startsWith(`${CORRECTION_HEAD} `)) return null;
  const rest = text.slice(CORRECTION_HEAD.length + 1);
  const m = /^(d-[0-9a-f]{8}) \u2192 (.+)$/.exec(rest);
  if (!m) return null;
  const f = m[2].split('｜');
  if (f.length > 2) return null;
  if (f.length === 2 && !f[1].startsWith(NOTE_MARK)) return null;
  const answer = f[0].trim();
  if (!answer) return null;
  return { id: m[1], answer, note: f.length === 2 ? f[1].slice(NOTE_MARK.length).trim() : null };
}

module.exports = { parseDecideLine, lineSaysAnswer, parseCorrectionLine, CORRECTION_HEAD, excerptOf, wire };
