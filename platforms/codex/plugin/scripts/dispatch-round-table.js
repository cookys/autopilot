#!/usr/bin/env node
'use strict';
// AUTOPILOT_DISPATCH_RUNS_DIR overrides the host dispatch manifest directory.
// Render dispatch manifests; token counts come only from each manifest's log_path.
const fs = require('fs');
const path = require('path');
const { runsDir } = require('./lib/runtime-paths');

function pinReport(manifests) {
  const groups = new Map();
  const makeGroup = () => ({ total: 0, pinned: 0, pool: 0, unknown: 0, pinned_with_reason: 0, pinned_without_reason: 0, reasons: new Map(), runners: new Set() });
  const totals = makeGroup();
  function add(group, m) {
    group.total++;
    if (m.pinned === true) {
      group.pinned++;
      if (typeof m.pin_reason === 'string' && m.pin_reason.trim()) {
        group.pinned_with_reason++;
        group.reasons.set(m.pin_reason, (group.reasons.get(m.pin_reason) || 0) + 1);
      } else group.pinned_without_reason++;
      if (typeof m.runner === 'string' && m.runner) group.runners.add(m.runner);
    } else if (m.pinned === false) group.pool++;
    else group.unknown++;
  }
  for (const m of manifests) {
    const day = new Date(new Date(m.started_at).getTime() + 8 * 3600000).toISOString().slice(0, 10);
    if (!groups.has(day)) groups.set(day, makeGroup());
    add(groups.get(day), m);
    add(totals, m);
  }
  function finish(group) {
    const { reasons, runners, ...counts } = group;
    return { ...counts, top_reasons: [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([reason, count]) => ({ reason, count })), runners: [...runners].sort() };
  }
  const result = { days: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([day, group]) => ({ day, ...finish(group) })), totals: finish(totals) };
  const denominator = totals.pinned + totals.pool;
  result.pool_share = { pool: totals.pool, denominator, percent: denominator ? Number((100 * totals.pool / denominator).toFixed(2)) : 0, unknown: totals.unknown };
  return result;
}

function printPins(report) {
  console.log('day | total | pinned | pool | unknown | with reason | without reason | top reasons | runners');
  for (const row of [...report.days, { day: 'TOTAL', ...report.totals }]) {
    console.log(`${row.day} | ${row.total} | ${row.pinned} | ${row.pool} | ${row.unknown} | ${row.pinned_with_reason} | ${row.pinned_without_reason} | ${JSON.stringify(row.top_reasons)} | ${JSON.stringify(row.runners)}`);
  }
  const share = report.pool_share;
  console.log(`pool share: ${share.pool}/${share.denominator} = ${share.percent.toFixed(2)}% (unknown: ${share.unknown})`);
}

function main(args) {
  let since = new Date();
  since.setHours(0, 0, 0, 0);
  let branch, task, json = false, pins = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--pins') pins = true;
    else if (['--since', '--branch', '--task'].includes(arg) && args[i + 1]) {
      const value = args[++i];
      if (arg === '--since') since = new Date(value);
      if (arg === '--branch') branch = value;
      if (arg === '--task') task = value;
    } else throw new Error(`Invalid argument: ${arg}`);
  }
  if (Number.isNaN(since.getTime())) throw new Error('Invalid --since');
  if (task && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(task)) throw new Error('Invalid --task');
  const dir = runsDir();
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') files = []; else throw e; }
  const rows = [];
  const manifests = [];
  for (const file of files.filter(f => /^hetero-.*\.manifest\.json$/.test(f))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!m.started_at || !(new Date(m.started_at) >= since)) continue;
    if (branch && !(m.branch || '').includes(branch)) continue;
    if (task && m.fleet_task !== task) continue;
    if (pins) { manifests.push(m); continue; }
    let tokens = '-';
    if (m.log_path) {
      try {
        const log = fs.readFileSync(m.log_path, 'utf8');
        const matches = [...log.matchAll(/tokens used\s*\r?\n\s*([\d,]+)\b/gi)];
        if (matches.length) tokens = matches[matches.length - 1][1];
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const val = x => x == null || x === '' ? '-' : x;
    rows.push({ run_id: val(m.run_id), runner: val(m.runner), model: val(m.model), branch: val(m.branch), commit: m.commit ? m.commit.slice(0, 9) : '-', started_at: val(m.started_at), ended_at: val(m.ended_at), status: val(m.final_status), tokens });
  }
  if (pins) {
    const report = pinReport(manifests);
    if (json) console.log(JSON.stringify(report, null, 2));
    else printPins(report);
    return;
  }
  rows.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.run_id.localeCompare(b.run_id));
  if (json) console.log(JSON.stringify(rows, null, 2));
  else for (const row of rows) console.log(Object.values(row).join(' | '));
}
try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
