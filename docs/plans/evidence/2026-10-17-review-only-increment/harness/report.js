'use strict';
// Builds the markdown tables of the README from cells/*.json (all numbers come from here).
//   node report.js <cells-dir>
const fs = require('fs');
const path = require('path');
const { scoreCell, findingLines, cites } = require('./score');

const dir = process.argv[2];
const cells = fs.readdirSync(dir).filter((n) => /^s\d-(inc|full|incraw|fullraw|incj)-r\d\.json$/.test(n)).sort()
  .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
const rows = cells.map((c) => ({ c, s: scoreCell(c) }));
const by = (re) => rows.filter((r) => re.test(r.c.tag));
const med = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const f2 = (x) => (x == null ? '-' : x.toFixed(2));
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const out = [];
const packetIncremental = (c) => { const b = c.batches.find((x) => x.round === 'return'); return Boolean(b && b.shared_packet && b.shared_packet.files && b.shared_packet.files['delta.diff']); };

const P = (s = '') => out.push(s);

// ---- T1 per cell
P('### T1. Per cell (return round only)\n');
P('| cell | arm / condition | engine status | scope (fallback) | seat calls | input bytes | est. cost USD | addendum rows | addendum bytes | wall s |');
P('|---|---|---|---|---|---|---|---|---|---|');
for (const { c, s } of rows) {
  const cond = /raw-r/.test(c.tag) ? `${c.arm} raw spec` : (/incj/.test(c.tag) ? 'inc, spec wording' : c.arm);
  P(`| ${c.tag} | ${cond} | ${s.status || (s.error || '-')} | ${s.review_scope || '-'}${s.fallback_reason ? ` (${s.fallback_reason})` : ''} | ${s.calls} | ${s.bytes} | ${f2(s.cost_usd)} | ${s.addendum_rows_total == null ? '-' : s.addendum_rows_total} | ${s.addendum_bytes == null ? '-' : s.addendum_bytes} | ${Math.round(s.wall_ms / 1000)} |`);
}

// ---- T2 savings (main grid inc loc vs full loc, cells where the incremental packet was sent)
function savings(title, suffix) {
P(`\n### ${title}\n`);
P('| scenario | rep | full bytes | inc bytes | bytes saved | full est. USD | inc est. USD | cost saved | calls full / inc | inc scope |');
P('|---|---|---|---|---|---|---|---|---|---|');
const sav = [];
for (const sc of ['s1', 's2', 's3', 's4', 's5', 's6']) {
  for (const rep of [1, 2]) {
    const i = rows.find((r) => r.c.tag === `${sc}-${suffix}-r${rep}`);
    const f = rows.find((r) => r.c.tag === `${sc}-full-r${rep}`);
    if (!i || !f) continue;
    const engaged = packetIncremental(i.c);
    const bs = 1 - i.s.bytes / f.s.bytes; const cs = 1 - i.s.cost_usd / f.s.cost_usd;
    if (engaged) sav.push({ bs, cs });
    P(`| ${sc} | ${rep} | ${f.s.bytes} | ${i.s.bytes} | ${pct(bs)} | ${f2(f.s.cost_usd)} | ${f2(i.s.cost_usd)} | ${pct(cs)} | ${f.s.calls} / ${i.s.calls} | ${engaged ? 'incremental' : `full (${i.s.fallback_reason})`} |`);
  }
}
P(`\nMedian saved over the ${sav.length} cells where the incremental packet was sent: bytes ${pct(med(sav.map((x) => x.bs)))}, estimated cost ${pct(med(sav.map((x) => x.cs)))}. Seat calls: identical (every seat is dispatched in both modes).`);
}
savings('T2. Incremental versus full on the same returned head (main grid; packet level, whether or not the engine could consume the answers)', 'inc');
savings('T2b. Same, spec-wording condition (A2)', 'incj');

// ---- T3 surfaced
function surfaceTable(title, re) {
  P(`\n### ${title}\n`);
  P('| cell | defect (kind) | seats that located it (pre-registered rule) | seats that located AND described it (A3) | panel (A3) |');
  P('|---|---|---|---|---|');
  for (const { c, s } of by(re)) {
    const ret = c.arm === 'inc' ? c.batches.find((b) => b.round === 'return') : c.batches.find((b) => b.round === 'r1');
    const n = ret ? ret.seats.filter((x) => x.status === 'reviewed').length : 0;
    for (const [id, v] of Object.entries(s.surfaced)) P(`| ${c.tag} | ${id} (${v.kind}) | ${v.seats.length} of ${n} | ${v.described_seats.length} of ${n} | ${v.described_panel ? 'surfaced' : '**MISSED**'} |`);
  }
}
surfaceTable('T3. Must-surface defects, main grid (full arm and inc arm)', /^s\d-(inc|full)-r\d$/);
surfaceTable('T3b. Must-surface defects, spec-wording condition (A2)', /^s\d-incj-r\d$/);
surfaceTable('T3c. Must-surface defects, raw-spec cells (they fell back to full)', /^s\d-(incraw|fullraw)-r\d$/);

// ---- T4 closure
P('\n### T4. Prior-finding answers by the seats (main grid, inc cells whose seats received the addendum)\n');
P('| cell | rows listed per packet | of which about a planted defect | distinct planted defects among them | answered closed where H1 fixed it | left open where H1 fixed it (benign) | silent | closed where H1 left the defect (DANGEROUS) |');
P('|---|---|---|---|---|---|---|---|');
let dangerous = 0;
for (const { c, s } of by(/^s\d-inc-r\d$|^s\d-incj-r\d$/)) {
  if (!s.closure || !s.closure.length) continue;
  const perPacket = s.closure.length / (c.batches.find((b) => b.round === 'return').seats.filter((x) => x.addendum).length || 1);
  const distinct = new Set(s.closure.map((x) => x.truth).filter(Boolean)).size || null;
  const matchedRows = s.closure.filter((x) => x.truth).length / (c.batches.find((b) => b.round === 'return').seats.filter((x) => x.addendum).length || 1);
  const closedOk = s.closure.filter((x) => x.expect === 'closed' && ['resolved', 'invalid'].includes(x.answer)).length;
  const benign = s.closure.filter((x) => x.expect === 'closed' && x.answer === 'still_present').length;
  const silent = s.closure.filter((x) => x.answer === 'silent').length;
  const danger = s.closure.filter((x) => x.expect === 'open' && ['resolved', 'invalid'].includes(x.answer)).length;
  dangerous += danger;
  P(`| ${c.tag} | ${perPacket} | ${matchedRows} | ${distinct == null ? 0 : distinct} | ${closedOk} | ${benign} | ${silent} | ${danger} |`);
}
P(`\nDangerous closures in all cells above: ${dangerous}.`);

// ---- T5 fallbacks
P('\n### T5. Fallback to full, by reason (every inc cell)\n');
const fb = {};
for (const { c, s } of rows.filter((r) => r.c.arm === 'inc')) { const k = packetIncremental(c) ? 'incremental packets sent' : `full: ${s.fallback_reason}`; (fb[k] = fb[k] || []).push(c.tag); }
for (const [k, v] of Object.entries(fb)) P(`- ${k}: ${v.length} (${v.join(', ')})`);

// ---- T6 engine outcome of the incremental cells
P('\n### T6. Engine outcome of the cells that stayed incremental\n');
const outc = {};
for (const { c, s } of rows.filter((r) => r.c.arm === 'inc' && packetIncremental(r.c))) {
  const seatShape = c.batches.find((b) => b.round === 'return').seats.map((x) => { try { const j = JSON.parse(x.findings); return j && typeof j === 'object' ? 'object' : 'other'; } catch (_e) { return x.status === 'reviewed' ? 'lines+object-or-lines' : x.status; } });
  const key = `${c.return.status}${c.return.reason ? ` / ${c.return.reason}` : ''}`;
  (outc[`${/incj/.test(c.tag) ? 'spec wording' : (/raw/.test(c.tag) ? 'raw' : 'main')}: ${key}`] = outc[`${/incj/.test(c.tag) ? 'spec wording' : (/raw/.test(c.tag) ? 'raw' : 'main')}: ${key}`] || []).push(`${c.tag} [${seatShape.join(',')}]`);
}
for (const [k, v] of Object.entries(outc)) P(`- ${k}: ${v.length} (${v.join('; ')})`);

// ---- T7 verdict-word filter over real round-1 claims
P('\n### T7. Verdict-word filter and claim length over the real round-1 claims\n');
const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'src', 'engine', 'review-resolution.js'), 'utf8');
const re = new RegExp(/const ADDENDUM_VERDICT_WORDS = \/(.*)\/i;/.exec(src)[1], 'i');
let claims = 0; let hit = 0; let long = 0; let nopath = 0;
const hitList = [];
for (const { c } of rows) {
  const r1 = c.batches.find((b) => b.round === 'r1');
  if (!r1) continue;
  for (const s of r1.seats) for (const l of findingLines(s.findings).lines) {
    claims += 1;
    if (re.test(l)) { hit += 1; hitList.push(`${c.tag}/${s.model}`); }
    if (l.length > 400) long += 1;
    if (!cites(l).length) nopath += 1;
  }
}
P(`Round-1 finding lines scanned: ${claims}. Matching the verdict-word filter (${re}): ${hit}${hitList.length ? ` (${hitList.join(', ')})` : ''}. Longer than the 400-character addendum cap: ${long}. Without any path:line: ${nopath}.`);
P('Cells whose fallback reason was the verdict-word filter (`addendum_malformed`): ' + rows.filter((r) => r.s.fallback_reason === 'addendum_malformed').length + '.');

// ---- T8 spend
let spend = null; try { spend = JSON.parse(fs.readFileSync(path.join(dir, 'spend.json'), 'utf8')); } catch (_e) { /* none */ }
if (spend) P(`\nTotal estimated spend: USD ${spend.usd.toFixed(2)} over ${spend.calls} seat calls (cap USD 40).`);
process.stdout.write(`${out.join('\n')}\n`);
