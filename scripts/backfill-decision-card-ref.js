#!/usr/bin/env node
'use strict';
// One-off backfill: add the `Card: d-xxxxxxxx` (+ `task:<ULID>` per waiting task) marker that scripts/open-decision.js now writes
// to every card-answer decision record, onto the older records that lack it. capacity ar_gate.py then counts them as card-tracked.
//   node scripts/backfill-decision-card-ref.js --records <dir> --cards <dir> [--dry | --apply]
// Default is --dry (writes nothing). Matching: record question + answer == card question + answer (whitespace-collapsed); a record
// matching zero or several distinct cards stays untouched. Already-marked records (a `Card: d-` line) are skipped, so re-runs are no-ops.
// Output: `matched N, unmatched M` and the unmatched ids (ids only). Read the card store and records dir read-only unless --apply.
const fs = require('fs');
const path = require('path');

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function loadCards(dir) {
  const byQA = new Map();
  const byAnswer = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_e) { continue; }
    for (const c of doc.decisions || []) {
      const ans = norm(c.answer || c.last_answer || c.answer_free_text);
      if (!c.id || !ans) continue;
      const tasks = [...String(c.background || '').matchAll(/^waiting task: ([0-9A-HJKMNP-TV-Z]{26})$/gm)].map((m) => m[1]);
      const card = { id: c.id, tasks };
      const add = (m, k) => { const l = m.get(k) || []; if (!l.some((x) => x.id === card.id)) l.push(card); m.set(k, l); };
      add(byQA, `${norm(c.question)}\u0000${ans}`);
      for (const a of [c.answer_free_text, c.answer, c.answer_option]) if (norm(a)) add(byAnswer, norm(a));
    }
  }
  return { byQA, byAnswer };
}

function findCard(text, cards) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const m = body.match(/^([\s\S]*?)\n\nAnswer: ([\s\S]*)$/);
  let hits = [];
  if (m) hits = cards.byQA.get(`${norm(m[1])}\u0000${norm(m[2])}`) || [];
  else {
    const r = body.match(/^([\s\S]*?)\n\nOption: [^\n]*\s*$/);
    if (r) hits = cards.byAnswer.get(norm(r[1])) || [];
  }
  return hits.length === 1 ? hits[0] : null;
}

function main(argv) {
  const a = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--dry') a.apply = false;
    else if (argv[i] === '--records') a.records = argv[++i];
    else if (argv[i] === '--cards') a.cards = argv[++i];
    else { process.stderr.write(`unknown argument: ${argv[i]}\n`); return 2; }
  }
  if (!a.records || !a.cards) { process.stderr.write('usage: backfill-decision-card-ref.js --records <dir> --cards <dir> [--dry|--apply]\n'); return 2; }
  const cards = loadCards(a.cards);
  let matched = 0; let already = 0; const unmatched = [];
  for (const f of fs.readdirSync(a.records).filter((x) => x.endsWith('.md'))) {
    const file = path.join(a.records, f);
    const text = fs.readFileSync(file, 'utf8');
    if (!/^kind: decision$/m.test(text)) continue;
    if (/^Card: d-[0-9a-f]{8}$/m.test(text)) { already++; continue; }
    if (!/\n\nAnswer: /.test(text) && !/\n\nOption: /.test(text)) continue; // not a card answer
    const card = findCard(text, cards);
    if (!card) { unmatched.push(f.replace(/\.md$/, '')); continue; }
    matched++;
    if (a.apply) fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}\n${[`Card: ${card.id}`, ...card.tasks.map((t) => `task:${t}`)].join('\n')}\n`);
  }
  process.stdout.write(`${a.apply ? 'applied' : 'dry run'}: matched ${matched}, unmatched ${unmatched.length}, already marked ${already}\n`);
  if (unmatched.length) process.stdout.write(`unmatched ids: ${unmatched.join(' ')}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
