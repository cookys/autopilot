#!/usr/bin/env node
'use strict';
// dispatch-usage-report/1: local, read-only manifest aggregation; no prompts or logs are read.
// node scripts/dispatch-usage-report.js [--since 7d] [--runs-dir DIR] [--out FILE] [--json]
// Writes FILE (default ./dispatch-usage-report.json); stdout is a summary, or one-line JSON with --json.
// Snapshot: schema, generated_at (UTC), since (inclusive UTC cutoff), host, totals {runs, by_status},
// by_runner {runner: {runs, by_model: {model: {runs, committed, failed, no_op, tokens_in?, tokens_out?}}}}, skipped.
// Window uses started_at, falling back to ended_at; future and invalid timestamps are excluded (invalid is skipped).
// Missing runner/model/status use "unknown"/"unknown"/"running". Failed means terminal statuses other than
// committed, no_op, reviewed, or success. Tokens are summed only when numeric and present in manifest usage/tokens.
// Missing input directory is an empty report; other directory or output errors exit 1; bad arguments exit 2.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { manifestDir } = require('./dispatch-status');

function report(dir, now, days) {
  const cutoff = now - days * 86400000;
  const out = { schema: 'dispatch-usage-report/1', generated_at: new Date(now).toISOString(), since: new Date(cutoff).toISOString(), host: os.hostname(), totals: { runs: 0, by_status: Object.create(null) }, by_runner: Object.create(null), skipped: 0 };
  let files;
  try { files = fs.readdirSync(dir).filter(n => n.endsWith('.manifest.json')).sort(); }
  catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const file of files) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { out.skipped++; continue; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) { out.skipped++; continue; }
    const timestamp = Date.parse(m.started_at || m.ended_at);
    if (!Number.isFinite(timestamp)) { out.skipped++; continue; }
    if (timestamp < cutoff || timestamp > now) continue;
    const runner = typeof m.runner === 'string' && m.runner ? m.runner : 'unknown';
    const model = typeof m.model === 'string' && m.model ? m.model : 'unknown';
    const status = typeof m.final_status === 'string' && m.final_status ? m.final_status : typeof m.status === 'string' && m.status ? m.status : 'running';
    out.totals.runs++;
    out.totals.by_status[status] = (out.totals.by_status[status] || 0) + 1;
    const r = out.by_runner[runner] ||= { runs: 0, by_model: Object.create(null) };
    r.runs++;
    const group = r.by_model[model] ||= { runs: 0, committed: 0, failed: 0, no_op: 0 };
    group.runs++;
    if (status === 'committed') group.committed++;
    else if (status === 'no_op') group.no_op++;
    else if (!['running', 'reviewed', 'success', 'authored'].includes(status)) group.failed++;
    const usage = m.usage || m.tokens || {};
    for (const [key, value] of [['tokens_in', usage.input_tokens ?? m.tokens_in], ['tokens_out', usage.output_tokens ?? m.tokens_out]]) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) group[key] = (group[key] || 0) + value;
    }
  }
  return out;
}

function main(argv) {
  let days = 7, dir = manifestDir(), dest = 'dispatch-usage-report.json', json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { json = true; continue; }
    if (!['--since', '--runs-dir', '--out'].includes(a) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new RangeError('invalid arguments');
    const value = argv[++i];
    if (a === '--since') { if (!/^[1-9]\d*d$/.test(value)) throw new RangeError('--since must be positive days, e.g. 7d'); days = Number(value.slice(0, -1)); if (!Number.isSafeInteger(days) || days > 1000000) throw new RangeError('invalid duration'); }
    else if (a === '--runs-dir') dir = value;
    else dest = value;
  }
  const data = report(dir, Date.now(), days);
  fs.writeFileSync(dest, JSON.stringify(data, null, 2) + '\n');
  process.stdout.write(json ? JSON.stringify(data) + '\n' : `dispatch usage: ${data.totals.runs} runs, ${data.skipped} skipped; snapshot ${dest}\n`);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`dispatch-usage-report: ${e instanceof RangeError ? e.message : e.code || 'I/O error'}\n`); process.exitCode = e instanceof RangeError ? 2 : 1; }
}
module.exports = { report };
