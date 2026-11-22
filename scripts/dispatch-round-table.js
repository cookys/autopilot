#!/usr/bin/env node
'use strict';
// AUTOPILOT_DISPATCH_RUNS_DIR overrides the host dispatch manifest directory.
// Render dispatch manifests; token counts come only from each manifest's log_path.
const fs = require('fs');
const path = require('path');


function main(args) {
  let since = new Date();
  since.setHours(0, 0, 0, 0);
  let branch, task, json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (['--since', '--branch', '--task'].includes(arg) && args[i + 1]) {
      const value = args[++i];
      if (arg === '--since') since = new Date(value);
      if (arg === '--branch') branch = value;
      if (arg === '--task') task = value;
    } else throw new Error(`Invalid argument: ${arg}`);
  }
  if (Number.isNaN(since.getTime())) throw new Error('Invalid --since');
  if (task && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(task)) throw new Error('Invalid --task');
  const dir = process.env.AUTOPILOT_DISPATCH_RUNS_DIR || `/tmp/autopilot-${process.getuid()}/autopilot-dispatch-runs`;
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') files = []; else throw e; }
  const rows = [];
  for (const file of files.filter(f => /^hetero-.*\.manifest\.json$/.test(f))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!m.started_at || !(new Date(m.started_at) >= since)) continue;
    if (branch && !(m.branch || '').includes(branch)) continue;
    if (task && m.fleet_task !== task) continue;
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
  rows.sort((a, b) => a.started_at.localeCompare(b.started_at) || a.run_id.localeCompare(b.run_id));
  if (json) console.log(JSON.stringify(rows, null, 2));
  else for (const row of rows) console.log(Object.values(row).join(' | '));
}
try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
