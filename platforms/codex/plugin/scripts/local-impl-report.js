#!/usr/bin/env node
'use strict';
// local-impl-report.js — counts for the local implementer default (operator via PM 01M7XHF4).
// Reads dispatch run manifests from the same directory dispatch-status.js resolves.
//   node scripts/local-impl-report.js [--since ISO] [--dir DIR] [--text]
// Default window: the last 24 hours.

const fs = require('fs');
const path = require('path');
const { manifestDir } = require('./dispatch-status');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function isLocal(m) {
  if (!m || typeof m !== 'object') return false;
  if (m.runner === 'local') return true;
  const ep = String(m.endpoint || '');
  if (ep === 'qwen_local') return true;
  return m.resolved_runner === 'cc-shim' && ep === 'qwen_local';
}

function startedMs(m) {
  const raw = m.started_at || m.ended_at || '';
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function reviewPass(m) {
  const r = m.review_receipt || m.review || null;
  if (r && typeof r === 'object') {
    if (typeof r.first_pass === 'boolean') return r.first_pass;
    if (typeof r.pass === 'boolean') return r.pass;
    if (typeof r.first_review_pass === 'boolean') return r.first_review_pass;
  }
  if (typeof m.first_review_pass === 'boolean') return m.first_review_pass;
  return null;
}

function reworked(m) {
  if (typeof m.reworked === 'boolean') return m.reworked;
  const r = m.review_receipt || m.review || null;
  if (r && typeof r === 'object' && typeof r.reworked === 'boolean') return r.reworked;
  if (Number.isFinite(Number(m.rework_count)) && Number(m.rework_count) > 0) return true;
  return null;
}

function queueWait(m) {
  if (Number.isFinite(Number(m.queue_wait_s))) return Number(m.queue_wait_s);
  if (Number.isFinite(Number(m.queue_wait_ms))) return Number(m.queue_wait_ms) / 1000;
  return null;
}

function ratio(n, d) {
  if (!d) return null;
  return n / d;
}

function report(dir, sinceMs) {
  const out = {
    local_runs: 0,
    local_first_review_pass: { count: null, ratio: null },
    local_reworked: { count: null, ratio: null },
    mean_queue_wait_s: null,
    fallbacks: 0,
    fallback_reasons: {},
  };
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  let passKnown = 0;
  let passYes = 0;
  let reworkKnown = 0;
  let reworkYes = 0;
  let waits = [];
  for (const name of names) {
    if (!name.endsWith('.manifest.json')) continue;
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    const t = startedMs(m);
    if (t === null || t < sinceMs) continue;
    const fb = m.local_fallback;
    if (fb && typeof fb === 'object' && fb.reason) {
      out.fallbacks += 1;
      const reason = String(fb.reason);
      out.fallback_reasons[reason] = (out.fallback_reasons[reason] || 0) + 1;
    }
    if (!isLocal(m)) continue;
    out.local_runs += 1;
    const pass = reviewPass(m);
    if (pass !== null) { passKnown += 1; if (pass) passYes += 1; }
    const rw = reworked(m);
    if (rw !== null) { reworkKnown += 1; if (rw) reworkYes += 1; }
    const w = queueWait(m);
    if (w !== null) waits.push(w);
  }
  if (passKnown) out.local_first_review_pass = { count: passYes, ratio: ratio(passYes, passKnown) };
  if (reworkKnown) out.local_reworked = { count: reworkYes, ratio: ratio(reworkYes, reworkKnown) };
  if (waits.length) out.mean_queue_wait_s = waits.reduce((a, b) => a + b, 0) / waits.length;
  return out;
}

function textOf(o) {
  const pass = o.local_first_review_pass;
  const rw = o.local_reworked;
  const reasons = Object.entries(o.fallback_reasons).map(([k, v]) => `${k} ${v}`).join('，') || '無';
  return [
    `本機派工 ${o.local_runs} 次`,
    `初次審查通過 ${pass.count === null ? '未知' : pass.count}（比例 ${pass.ratio === null ? '未知' : pass.ratio}）`,
    `返工 ${rw.count === null ? '未知' : rw.count}（比例 ${rw.ratio === null ? '未知' : rw.ratio}）`,
    `平均排隊 ${o.mean_queue_wait_s === null ? '未知' : o.mean_queue_wait_s} 秒`,
    `改走雲端 ${o.fallbacks} 次（${reasons}）`,
  ].join('\n') + '\n';
}

function main() {
  const sinceArg = arg('since');
  const sinceMs = sinceArg ? Date.parse(sinceArg) : Date.now() - 24 * 60 * 60 * 1000;
  if (!Number.isFinite(sinceMs)) {
    process.stderr.write('local-impl-report: --since is not a time\n');
    process.exit(2);
  }
  const dir = arg('dir') || manifestDir();
  const body = report(dir, sinceMs);
  if (process.argv.includes('--text')) process.stdout.write(textOf(body));
  else process.stdout.write(`${JSON.stringify(body)}\n`);
}

if (require.main === module) main();

module.exports = { report, textOf, isLocal };
