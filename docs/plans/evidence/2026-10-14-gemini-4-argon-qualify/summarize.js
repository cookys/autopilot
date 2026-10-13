#!/usr/bin/env node
'use strict';
// Prints a one-line summary per broker cell + implementer cells (read-only).
const fs = require('fs'), path = require('path');
const H = __dirname;
const rj = (p) => { try { return JSON.parse(fs.readFileSync(path.join(H, p), 'utf8')); } catch { return null; } };
for (const d of fs.readdirSync(path.join(H, 'out')).sort()) {
  const so = rj(`out/${d}/stdout.json`) || {};
  const em = rj(`out/${d}/emit-row.json`);
  const rec = fs.existsSync(path.join(H, `out/${d}/record-out.json`)) ? fs.readFileSync(path.join(H, `out/${d}/record-out.json`), 'utf8').match(/"event_id":(\d+)/g) : null;
  const log = fs.readFileSync(path.join(H, `out/${d}/run.log`), 'utf8').trim().split('\n');
  const t = (s) => new Date(s.split(' ')[0]).getTime();
  const wall = Math.round((t(log[1]) - t(log[0])) / 1000);
  console.log(d, JSON.stringify({ status: em && em.status, quality: em && em.quality, subjects: so.subjects, pair_delta: so.pair_delta_count, spend: so.spend_tokens, store_event: so.evidence_store_event_id, scorecard: rec, cell_wall_s: wall, reason: so.reason }));
}
for (const s of ['low', 'high']) {
  const q = rj(`argon-${s}-qualify/qualify-out.json`);
  const r = fs.existsSync(path.join(H, `argon-${s}-qualify/record-out.json`)) ? fs.readFileSync(path.join(H, `argon-${s}-qualify/record-out.json`), 'utf8').match(/"event_id":(\d+)/g) : null;
  console.log('implementer-' + s, JSON.stringify({ quality: q.quality, wall: q.latency, store_event: q.evidence_store && q.evidence_store.event_id, scorecard: r, expires: q.expires }));
}
