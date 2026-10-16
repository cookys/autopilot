'use strict';
// Scores the cell records of the BL-0146 D5 experiment. Definitions are the pre-registered ones (PREREG.md).
//   node score.js <cells-dir> [--json]
const fs = require('fs');
const path = require('path');

const WINDOW = 3; // a finding matches a planted defect when it cites the file within +-3 lines

function findingLines(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { lines: [], resolutions: [] };
  let text = raw; let resolutions = [];
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      text = typeof j.findings === 'string' ? j.findings : JSON.stringify(j.findings || '');
      resolutions = Array.isArray(j.resolutions) ? j.resolutions : [];
    } else if (Array.isArray(j)) {
      text = j.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
    }
  } catch (_e) { /* plain text findings */ }
  const lines = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !/^none$/i.test(l));
  return { lines, resolutions };
}
const cites = (line) => [...line.matchAll(/([A-Za-z0-9_./-]+\.js):(\d+)/g)].map((m) => ({ path: m[1].replace(/^\.\//, ''), line: Number(m[2]) }));

function matches(t, line) {
  const targets = [{ path: t.path, line: t.line }, ...(t.alt_paths || [])];
  for (const c of cites(line)) {
    for (const x of targets) if (c.path.endsWith(x.path) && Math.abs(c.line - x.line) <= WINDOW) return true;
  }
  const kw = t.keyword ? new RegExp(t.keyword, 'i') : null;
  if (kw) {
    for (const x of targets) {
      const base = path.basename(x.path);
      if (line.includes(base) && kw.test(line)) return true;
    }
  }
  return false;
}

function returnBatches(cell) {
  return cell.arm === 'inc' ? cell.batches.filter((b) => b.round === 'return') : cell.batches.filter((b) => b.round === 'r1');
}

function scoreCell(cell) {
  const batches = returnBatches(cell);
  const seats = batches.flatMap((b) => b.seats);
  const out = {
    tag: cell.tag, scenario: cell.scenario, arm: cell.arm,
    calls: seats.length, bytes: seats.reduce((a, s) => a + s.packet_bytes, 0), cost_usd: seats.reduce((a, s) => a + s.cost_usd, 0),
    input_tokens: seats.reduce((a, s) => a + ((s.usage && s.usage.input_tokens) || 0), 0),
    usage_reported: seats.filter((s) => s.usage).length,
    reviewed: seats.filter((s) => s.status === 'reviewed').length,
    wall_ms: batches.reduce((a, b) => a + b.wall_ms, 0),
    status: cell.arm === 'inc' ? (cell.return && cell.return.status) : cell.round1.status,
    review_scope: cell.arm === 'inc' ? (cell.return && cell.return.disclosure && cell.return.disclosure.review_scope) : 'full',
    fallback_reason: cell.arm === 'inc' ? (cell.return && cell.return.disclosure && cell.return.disclosure.incremental_fallback_reason) || null : null,
    error: cell.error || cell.round1.thrown || (cell.return && cell.return.thrown) || null,
  };
  const truth = cell.truth.h1;
  const mustSurface = truth.filter((t) => ['old_unfixed', 'regression', 'new_next_to_old'].includes(t.kind));
  const perSeat = seats.map((s) => {
    const { lines, resolutions } = findingLines(s.findings);
    return { model: s.model, status: s.status, lines, resolutions, addendum_rows: s.addendum ? s.addendum.rows.length : 0 };
  });
  out.surfaced = {};
  for (const t of mustSurface) {
    const bySeat = perSeat.map((p) => {
      const viaFinding = p.lines.some((l) => matches(t, l));
      const viaStill = p.resolutions.some((r) => r.status === 'still_present' && cites(`${r.evidence || ''}`).some((c) => c.path.endsWith(t.path) && Math.abs(c.line - t.line) <= WINDOW));
      return viaFinding || viaStill;
    });
    out.surfaced[t.id] = { kind: t.kind, seats: bySeat.map((b, i) => (b ? perSeat[i].model : null)).filter(Boolean), panel: bySeat.some(Boolean) };
  }
  // false positives: findings that match an already-fixed old defect (reported as still present)
  const fixed = truth.filter((t) => t.kind === 'old_fixed');
  out.fixed_reported = fixed.map((t) => ({ id: t.id, seats: perSeat.filter((p) => p.lines.some((l) => matches(t, l))).map((p) => p.model) })).filter((x) => x.seats.length);
  // findings that match nothing planted (noise)
  const all = truth;
  out.unmatched_findings = perSeat.reduce((a, p) => a + p.lines.filter((l) => !all.some((t) => matches(t, l))).length, 0);
  // closure answers (incremental only): the addendum rows and what each seat answered
  if (cell.arm === 'inc') {
    out.addendum_rows_total = perSeat.reduce((a, p) => a + p.addendum_rows, 0);
    out.addendum_bytes = seats.reduce((a, s) => a + (s.addendum ? s.addendum.bytes : 0), 0);
    out.closure = [];
    for (const s of seats) {
      if (!s.addendum) continue;
      const answers = findingLines(s.findings).resolutions;
      for (const row of s.addendum.rows) {
        const m = /^- \[([^\]]+)\] \| ([^|]*) \| ([^|]*) \|/.exec(row);
        if (!m) continue;
        const id = m[1]; const loc = cites(m[3])[0];
        const tr = loc ? cell.truth.h0.concat(truth).find((t) => t.path === loc.path && Math.abs(t.line - loc.line) <= WINDOW) : null;
        const fixedNow = tr ? truth.find((t) => t.id === tr.id) : null;
        const ans = answers.find((a) => a.finding_id === id);
        out.closure.push({ seat: s.model, id, loc: m[3].trim(), truth: tr ? tr.id : null, expect: fixedNow ? (fixedNow.kind === 'old_fixed' ? 'closed' : 'open') : 'unknown', answer: ans ? ans.status : 'silent', evidence: ans ? ans.evidence : null });
      }
    }
    out.wrong_closures = out.closure.filter((c) => c.expect === 'open' && ['resolved', 'invalid'].includes(c.answer)).length;
    out.benign_open = out.closure.filter((c) => c.expect === 'closed' && !['resolved', 'invalid'].includes(c.answer)).length;
  }
  return out;
}

function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

function main() {
  const dir = process.argv[2];
  const cells = fs.readdirSync(dir).filter((n) => /^s\d-(inc|full)-r\d\.json$/.test(n)).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
  const rows = cells.map(scoreCell);
  const pairs = [];
  for (const sc of ['s1', 's2', 's3', 's4', 's5']) {
    for (const rep of [1, 2]) {
      const inc = rows.find((r) => r.scenario === sc && r.arm === 'inc' && r.tag.endsWith(`r${rep}`));
      const full = rows.find((r) => r.scenario === sc && r.arm === 'full' && r.tag.endsWith(`r${rep}`));
      if (inc || full) pairs.push({ scenario: sc, rep, inc, full });
    }
  }
  const incOnlyMiss = [];
  for (const p of pairs) {
    if (!p.inc || !p.full) continue;
    for (const id of Object.keys(p.full.surfaced)) {
      if (p.full.surfaced[id].panel && p.inc.surfaced[id] && !p.inc.surfaced[id].panel) incOnlyMiss.push({ scenario: p.scenario, rep: p.rep, id, kind: p.full.surfaced[id].kind, inc_scope: p.inc.review_scope });
    }
  }
  const savings = pairs.filter((p) => p.inc && p.full && p.inc.review_scope === 'incremental' && p.full.cost_usd > 0).map((p) => ({
    scenario: p.scenario, rep: p.rep,
    calls: p.inc.calls / p.full.calls, bytes: p.inc.bytes / p.full.bytes, cost: p.inc.cost_usd / p.full.cost_usd,
  }));
  const summary = {
    rows, pairs: pairs.map((p) => ({ scenario: p.scenario, rep: p.rep, inc: p.inc && p.inc.tag, full: p.full && p.full.tag })),
    incremental_only_misses: incOnlyMiss,
    saved_median: savings.length ? { bytes: 1 - median(savings.map((x) => x.bytes)), cost: 1 - median(savings.map((x) => x.cost)), n: savings.length } : null,
    fallbacks: rows.filter((r) => r.arm === 'inc').map((r) => ({ tag: r.tag, scope: r.review_scope, reason: r.fallback_reason })),
  };
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
}
if (require.main === module) main();
module.exports = { scoreCell, findingLines, matches, cites };
