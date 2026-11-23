#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readGatewayFill, allocate, auditLine } = require('./lib/gateway-fill');

function laneNameFromBacklog(filePath) {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  if (path.basename(dir) === 'docs') {
    return path.basename(path.dirname(dir));
  }
  return path.basename(dir);
}

function parseArgs(argv) {
  const backlogs = [];
  let fill = null;
  let maxPerRound;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--backlog' && i + 1 < argv.length) {
      backlogs.push(argv[++i]);
    } else if (arg === '--fill' && i + 1 < argv.length) {
      fill = argv[++i];
    } else if (arg === '--max' && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid --max value: ${argv[i]}`);
      }
      maxPerRound = n;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/gateway-fill-dry-run.js --backlog <file> [--backlog <file> ...] [--fill <file>] [--max <n>]');
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (backlogs.length === 0) {
    throw new Error('At least one --backlog <file> is required');
  }

  return { backlogs, fill, maxPerRound };
}

function parseReadyOutput(stdout, lane) {
  const items = [];
  let current = null;

  for (const rawLine of String(stdout || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.startsWith('ready.')) {
      continue;
    }
    const match = line.match(/^ready\.([A-Za-z0-9-]+)(?:\s+(.*))?$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = (match[2] || '').trim();

    if (key === 'Id') {
      if (current) {
        items.push(current);
      }
      current = {
        id: `${lane}/${value}`,
        lane,
        priority: 'P3',
        due: null,
        engineClass: '',
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (key === 'Priority' && value) {
      current.priority = value;
    } else if (key === 'Engine-Class') {
      current.engineClass = value;
    }
  }

  if (current) {
    items.push(current);
  }

  return items;
}

function collectReadyFromBacklog(backlogPath) {
  const lane = laneNameFromBacklog(backlogPath);
  const checker = path.join(__dirname, 'check-backlog-entries.js');
  const res = spawnSync(
    process.execPath,
    [checker, '--backlog', backlogPath, '--ready', '--mode', 'warn'],
    { encoding: 'utf8' }
  );

  if (res.error) {
    throw res.error;
  }

  return parseReadyOutput(res.stdout, lane);
}

function main() {
  const { backlogs, fill, maxPerRound } = parseArgs(process.argv.slice(2));
  const env = fill ? { ...process.env, AUTOPILOT_GATEWAY_FILL: fill } : process.env;

  const fillRes = readGatewayFill({ env });
  if (!fillRes.ok) {
    console.log(`gateway-fill unavailable: ${fillRes.reason}`);
    return;
  }

  const ready = [];
  for (const backlogPath of backlogs) {
    ready.push(...collectReadyFromBacklog(backlogPath));
  }

  const { assignments, skipped } = allocate({
    fill: fillRes.data,
    ready,
    maxPerRound,
  });

  for (const a of assignments) {
    console.log(`DRY-RUN ${auditLine(a)} review=回 ${a.lane} 審查`);
  }
  for (const s of skipped) {
    console.log(`skip ${s.id} ${s.reason}`);
  }
  console.log(`dry-run: ${assignments.length} assigned, ${skipped.length} skipped`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
}

module.exports = {
  laneNameFromBacklog,
  parseArgs,
  parseReadyOutput,
  collectReadyFromBacklog,
};
