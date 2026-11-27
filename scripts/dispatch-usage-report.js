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
const { stateDir } = require('./lib/state-dir');

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

const SUCCESS_STATUSES = ['committed', 'no_op', 'reviewed', 'success', 'authored'];
const USAGE_TOKEN_KEYS = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'reasoning_tokens'];

function reportByRole(dir, now, days) {
  const cutoff = now - days * 86400000;
  const out = {
    schema: 'dispatch-usage-role-report/1',
    generated_at: new Date(now).toISOString(),
    since: new Date(cutoff).toISOString(),
    host: os.hostname(),
    totals: { runs: 0, succeeded: 0, failed: 0, tokens: 0, usd: 0, usd_unknown: 0, model_unknown: 0 },
    by_role: Object.create(null),
    skipped: 0,
  };
  let files;
  try {
    files = fs.readdirSync(dir).filter((n) => /^dispatch-usage-\d{6}\.jsonl$/.test(n)).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  const byRun = new Map();
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try { row = JSON.parse(trimmed); } catch { out.skipped++; continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.run_id !== 'string' || !row.run_id) {
        out.skipped++;
        continue;
      }
      byRun.set(row.run_id, row);
    }
  }
  for (const row of byRun.values()) {
    const epoch = typeof row.started_at === 'number' ? row.started_at : row.ended_at;
    const timestamp = typeof epoch === 'number' && Number.isFinite(epoch) ? epoch * 1000 : NaN;
    if (!Number.isFinite(timestamp)) { out.skipped++; continue; }
    if (timestamp < cutoff || timestamp > now) continue;

    const role = typeof row.role === 'string' && row.role ? row.role : 'unknown';
    const model = typeof row.model === 'string' && row.model ? row.model : 'unknown';
    const status = typeof row.status === 'string' && row.status ? row.status : 'running';

    const g = out.by_role[role] ||= { runs: 0, succeeded: 0, failed: 0, tokens: 0, usd: 0, usd_unknown: 0, model_unknown: 0 };
    out.totals.runs++;
    g.runs++;

    if (model === 'unknown') {
      out.totals.model_unknown++;
      g.model_unknown++;
    }

    if (SUCCESS_STATUSES.includes(status)) {
      out.totals.succeeded++;
      g.succeeded++;
    } else if (status !== 'running') {
      out.totals.failed++;
      g.failed++;
    }

    const usage = row.usage && typeof row.usage === 'object' ? row.usage : {};
    for (const k of USAGE_TOKEN_KEYS) {
      const v = usage[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out.totals.tokens += v;
        g.tokens += v;
      }
    }

    if (typeof row.usd === 'number' && Number.isFinite(row.usd) && row.usd >= 0) {
      out.totals.usd += row.usd;
      g.usd += row.usd;
    } else {
      out.totals.usd_unknown++;
      g.usd_unknown++;
    }
  }
  return out;
}

function main(argv) {
  let days = 7, dir = null, dest = 'dispatch-usage-report.json', json = false, byRole = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { json = true; continue; }
    if (a === '--by-role') { byRole = true; continue; }
    if (!['--since', '--runs-dir', '--out'].includes(a) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new RangeError('invalid arguments');
    const value = argv[++i];
    if (a === '--since') { if (!/^[1-9]\d*d$/.test(value)) throw new RangeError('--since must be positive days, e.g. 7d'); days = Number(value.slice(0, -1)); if (!Number.isSafeInteger(days) || days > 1000000) throw new RangeError('invalid duration'); }
    else if (a === '--runs-dir') dir = value;
    else dest = value;
  }
  const targetDir = dir || (byRole ? stateDir(process.env) : manifestDir());
  const data = byRole ? reportByRole(targetDir, Date.now(), days) : report(targetDir, Date.now(), days);
  fs.writeFileSync(dest, JSON.stringify(data, null, 2) + '\n');
  process.stdout.write(json ? JSON.stringify(data) + '\n' : `dispatch usage: ${data.totals.runs} runs, ${data.skipped} skipped; snapshot ${dest}\n`);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { process.stderr.write(`dispatch-usage-report: ${e instanceof RangeError ? e.message : e.code || 'I/O error'}\n`); process.exitCode = e instanceof RangeError ? 2 : 1; }
}
module.exports = { report, reportByRole };
