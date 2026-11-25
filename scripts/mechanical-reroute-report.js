#!/usr/bin/env node
'use strict';

// scripts/mechanical-reroute-report.js — summarize mechanical-reroute-shadow.jsonl
// Usage: node scripts/mechanical-reroute-report.js [--since 2h] [--json]

const fs = require('fs');
const path = require('path');
const { userRuntimeBase } = require('./lib/runtime-paths.js');
const { stateDir } = require('./lib/state-dir.js');

function parseSinceMs(spec) {
  const m = String(spec || '2h').trim().match(/^(\d+(?:\.\d+)?)([smhd])$/i);
  if (!m) {
    process.stderr.write(`invalid --since value: ${spec} (expected e.g. 30m, 2h, 1d)\n`);
    process.exit(2);
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return n * mult;
}

const args = process.argv.slice(2);
let sinceSpec = '2h';
let jsonOut = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since' && args[i + 1]) {
    sinceSpec = args[++i];
  } else if (args[i] === '--json') {
    jsonOut = true;
  } else if (args[i] === '-h' || args[i] === '--help') {
    process.stdout.write('Usage: node scripts/mechanical-reroute-report.js [--since 2h] [--json]\n');
    process.exit(0);
  }
}

const cutoff = Date.now() - parseSinceMs(sinceSpec);
// The log lives in the state dir; fall back once to the old tmpfs location (pre-N4 rows).
const stateLog = path.join(stateDir(process.env), 'mechanical-reroute-shadow.jsonl');
const logFile = fs.existsSync(stateLog) ? stateLog : path.join(userRuntimeBase(process.env), 'mechanical-reroute-shadow.jsonl');

const bySeat = {};
const byRole = {};
const bySubagentType = {};
let total = 0;

if (fs.existsSync(logFile)) {
  const lines = fs.readFileSync(logFile, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(row.ts || '');
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    total += 1;
    const seat = row.seat || '(none)';
    const role = row.role || '(none)';
    const st = row.subagent_type || '(empty)';
    bySeat[seat] = (bySeat[seat] || 0) + 1;
    byRole[role] = (byRole[role] || 0) + 1;
    bySubagentType[st] = (bySubagentType[st] || 0) + 1;
  }
}

if (jsonOut) {
  process.stdout.write(`${JSON.stringify({ since: sinceSpec, total, by_seat: bySeat, by_role: byRole, by_subagent_type: bySubagentType }, null, 2)}\n`);
} else {
  process.stdout.write(`Mechanical reroute shadow report (since ${sinceSpec}): total=${total}\n`);
  process.stdout.write(`  by seat: ${JSON.stringify(bySeat)}\n`);
  process.stdout.write(`  by role: ${JSON.stringify(byRole)}\n`);
  process.stdout.write(`  by subagent_type: ${JSON.stringify(bySubagentType)}\n`);
}
