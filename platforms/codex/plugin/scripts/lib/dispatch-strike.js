#!/usr/bin/env node
'use strict';

// Count consecutive finished dispatch failures for one fleet task, ordered by start time.
const fs = require('fs');
const path = require('path');
const { runsDir } = require('./runtime-paths');

function strikes(manifestsDir, { since, fleetTask }) {
  const dir = manifestsDir || runsDir();
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') return { rounds: [], strikes: 0 }; throw e; }
  const cutoff = since == null ? -Infinity : new Date(since).getTime();
  if (Number.isNaN(cutoff)) throw new Error('invalid since date');
  const records = [];
  for (const name of names.filter(n => n.endsWith('.manifest.json')).sort()) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { if (e instanceof SyntaxError || e.code === 'ENOENT') continue; throw e; }
    if (m.fleet_task !== fleetTask || !m.final_status) continue;
    const time = Date.parse(m.started_at);
    if (!Number.isFinite(time) || time < cutoff) continue;
    records.push({ time, name, run_id: m.run_id, runner: m.runner, status: m.final_status, commit: m.commit ?? null });
  }
  records.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  const rounds = records.map(({ run_id, runner, status, commit }) => ({ run_id, runner, status, commit }));
  let count = 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    if (['no_op', 'failure', 'boundary_rejected'].includes(r.status) || (r.commit === null && r.status !== 'committed')) count++;
    else break;
  }
  return { rounds, strikes: count };
}

module.exports = { strikes };
if (require.main === module) {
  const args = process.argv.slice(2);
  if ((args.length !== 2 && args.length !== 3) || args[0] !== '--task' || !args[1] || (args.length === 3 && args[2] !== '--json')) {
    console.error('usage: dispatch-strike.js --task <id> [--json]'); process.exitCode = 1;
  } else {
    try {
      const result = strikes(undefined, { fleetTask: args[1] });
      console.log(args[2] === '--json' ? JSON.stringify(result) : `strikes=${result.strikes} rounds=${result.rounds.length}`);
      if (result.strikes >= 2) {
        if (args[2] !== '--json') console.log('two-strike: change approach or escalate to the lead (P1 01M81F6G5)');
        process.exitCode = 2;
      }
    } catch (e) { console.error(`dispatch-strike: ${e.message}`); process.exitCode = 1; }
  }
}
