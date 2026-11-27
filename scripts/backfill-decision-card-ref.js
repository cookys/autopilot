#!/usr/bin/env node
'use strict';
// One-off backfill: give decision records that lack the ops tag `key:card:<card id>` that tag, so capacity ar_gate.py (--ops) counts
// them as card-tracked. scripts/open-decision.js writes the tag on every new card record and ruling receipt; this covers the older ones.
// Records are never edited as .md (the .hippo/records/*.md files are a view computed from .hippo/ops/*.jsonl); the tag goes through
// the hippo CLI via scripts/lib/hippo.js (`hippo set <id> tags --add key:card:<id>`, one op per record).
//
//   node scripts/backfill-decision-card-ref.js --repo <hippo repo> --cards <dir of card json> [--dry | --apply --backup-ack <sha16>]
//
//   --repo        a git repo holding .hippo/ (the CLI runs with -C <repo>)
//   --cards       the card store dir (*.json, each {decisions:[{id,question,answer|last_answer|answer_free_text,...}]})
//   --dry         default; writes nothing, prints what would be tagged
//   --apply       tags the matched records; REQUIRES --backup-ack <sha16>: first `tar -C <repo> -cf bak.tar .hippo`, read it back
//                 (`sha256sum bak.tar | cut -c1-16`) and pass that 16-hex value. Restore: stop writers, `rm -r <repo>/.hippo`,
//                 `tar -C <repo> -xf bak.tar`. (The script prints this reminder and never touches the tar itself.)
// Matching: a decision record without any `key:card:` tag is matched to a card by question + answer (whitespace-collapsed): the body
// shape is `<question>\n\nAnswer: <answer>` (card record) or `<ruling>\n\nOption: ..` (ruling receipt, matched on the ruling text).
// A record whose body already has a `Card: d-xxxxxxxx` line takes that id directly. A record matching zero or several distinct
// cards stays untouched. Re-runs are no-ops (tagged records are skipped). Actor: HIPPO_ACTOR if set, else seat/card-ref-backfill.
// Output: `matched N, unmatched M, already tagged K` and the unmatched record ids.
const fs = require('fs');
const path = require('path');

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const TAG = 'key:card:';

function loadCards(dir) {
  const byQA = new Map();
  const byAnswer = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_e) { continue; }
    for (const c of doc.decisions || []) {
      const ans = norm(c.answer || c.last_answer || c.answer_free_text);
      if (!c.id || !ans) continue;
      const add = (m, k) => { const l = m.get(k) || []; if (!l.includes(c.id)) l.push(c.id); m.set(k, l); };
      add(byQA, `${norm(c.question)}\u0000${ans}`);
      for (const a of [c.answer_free_text, c.answer, c.answer_option]) if (norm(a)) add(byAnswer, norm(a));
    }
  }
  return { byQA, byAnswer };
}

function findCard(body, cards) {
  const direct = body.match(/^Card: (d-[0-9a-f]{8})$/m);
  if (direct) return direct[1];
  const text = body.replace(/^(?:Card: d-[0-9a-f]{8}|task:[0-9A-HJKMNP-TV-Z]{26})$/gm, '').replace(/\s+$/, '');
  let hits = [];
  const m = text.match(/^([\s\S]*?)\n\nAnswer: ([\s\S]*)$/);
  if (m) hits = cards.byQA.get(`${norm(m[1])}\u0000${norm(m[2])}`) || [];
  else {
    const r = text.match(/^([\s\S]*?)\n\nOption: [^\n]*$/);
    if (r) hits = cards.byAnswer.get(norm(r[1])) || [];
  }
  return hits.length === 1 ? hits[0] : null;
}

function main(argv) {
  const a = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') a.apply = true;
    else if (argv[i] === '--dry') a.apply = false;
    else if (['--repo', '--cards', '--backup-ack'].includes(argv[i])) a[argv[i].slice(2)] = argv[++i];
    else { process.stderr.write(`unknown argument: ${argv[i]}\n`); return 2; }
  }
  if (!a.repo || !a.cards) { process.stderr.write('usage: backfill-decision-card-ref.js --repo <hippo repo> --cards <dir> [--dry | --apply --backup-ack <sha16>]\n'); return 2; }
  if (a.apply && !/^[0-9a-f]{16}$/.test(a['backup-ack'] || '')) {
    process.stderr.write('refused: --apply needs --backup-ack <sha16>: tar -C <repo> -cf bak.tar .hippo, read it back (sha256sum bak.tar | cut -c1-16), pass that value\n');
    return 2;
  }
  const hippo = require('./lib/hippo');
  if (!process.env.HIPPO_ACTOR) process.env.HIPPO_ACTOR = 'seat/card-ref-backfill';
  const cards = loadCards(a.cards);
  const listed = hippo.run(a.repo, ['list', '--history', '--limit', '100000']);
  if (listed.exit !== 0) { process.stderr.write(`hippo list failed: ${listed.error.message}\n`); return 1; }
  let matched = 0; let already = 0; let failed = 0; const unmatched = [];
  for (const rec of listed.data.records.filter((r) => r.kind === 'decision')) {
    if ((rec.tags || []).some((t) => t.startsWith(TAG))) { already++; continue; }
    const shown = hippo.run(a.repo, ['show', rec.id]);
    if (shown.exit !== 0) { failed++; process.stderr.write(`hippo show ${rec.id} failed: ${shown.error.message}\n`); continue; }
    const body = shown.data.record.body || '';
    if (!/\n\nAnswer: /.test(body) && !/\n\nOption: /.test(body)) continue; // not a card answer
    const card = findCard(body, cards);
    if (!card) { unmatched.push(rec.id); continue; }
    matched++;
    if (a.apply) {
      const r = hippo.execute(a.repo, { steps: [{ op: 'tag', id: rec.id, tag: `${TAG}${card}` }] }, { log: () => {} });
      if (!r.ok) { failed++; matched--; process.stderr.write(`tag ${rec.id} failed: ${JSON.stringify(r.error || r.reason)}\n`); }
    } else process.stdout.write(`would tag ${rec.id} ${TAG}${card}\n`);
  }
  process.stdout.write(`${a.apply ? 'applied' : 'dry run'}: matched ${matched}, unmatched ${unmatched.length}, already tagged ${already}${failed ? `, failed ${failed}` : ''}\n`);
  if (unmatched.length) process.stdout.write(`unmatched ids: ${unmatched.join(' ')}\n`);
  if (a.apply) process.stdout.write(`restore: rm -r ${a.repo}/.hippo && tar -C ${a.repo} -xf <bak.tar> (backup-ack ${a['backup-ack']})\n`);
  return failed ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
