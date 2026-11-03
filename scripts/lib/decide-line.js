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
 * answer (only outer blanks removed): no substring, no prefix, no separator folding. The note is free text and never takes part in the comparison.
 */
const ARROW = ' → ';
const NONE = '都不選';
const NOTE_MARK = '補充：';
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
  return answer === NONE ? { ok: true } : { ok: false, reason: 'answer' };
}

module.exports = { parseDecideLine, lineSaysAnswer, excerptOf, wire };
