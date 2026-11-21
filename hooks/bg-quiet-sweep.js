#!/usr/bin/env node
'use strict';

/**
 * hooks/bg-quiet-sweep.js — Sweep bg-quiet receipts on Stop and UserPromptSubmit.
 *
 * - For each <id>.ok: cancel its fleet watch (FLEET_BIN honoured, 1500ms timeout,
 *   failures ignored) and rename to <id>.ok.swept.
 * - For each <id>.fail: rename to <id>.fail.swept (never cancel).
 * - On UserPromptSubmit only: emit additionalContext listing swept receipts.
 * - On Stop: emit nothing.
 * - Fail-open on any error; fast exit 0 when queue dir does not exist.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const raw = readStdin();
  let payload = {};
  if (raw && raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  const eventName = payload.hook_event_name || payload.event || '';
  const sessionId =
    process.env.CLAUDE_CODE_SESSION_ID || payload.session_id || 'default';
  const runtimeDir = process.env.XDG_RUNTIME_DIR || '/dev/shm';
  const queueDir = path.join(runtimeDir, 'autopilot', 'bg-quiet', sessionId);

  if (!fs.existsSync(queueDir)) {
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(queueDir);
  } catch {
    return;
  }

  const fleetBin = process.env.FLEET_BIN || 'fleet';
  const sweptLines = [];

  for (const name of entries.sort()) {
    if (name.endsWith('.tmp')) continue;
    const isOk = name.endsWith('.ok');
    const isFail = name.endsWith('.fail');
    if (!isOk && !isFail) continue;

    const id = name.slice(0, isOk ? -3 : -5);
    const fullPath = path.join(queueDir, name);
    const sweptPath = `${fullPath}.swept`;
    const metaPath = path.join(queueDir, `${id}.json`);

    let receipt = {};
    try {
      receipt = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    } catch {}

    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {}

    if (isOk && meta.watch_id) {
      try {
        execFileSync(fleetBin, ['watch', '--cancel', String(meta.watch_id)], {
          timeout: 1500,
          stdio: 'ignore',
        });
      } catch {
        // Fail-open: ignore cancel errors
      }
    }

    try {
      fs.renameSync(fullPath, sweptPath);
    } catch {
      continue;
    }

    const label = receipt.label || meta.label || id;
    const status = isOk ? 'ok' : 'fail';
    const rc = receipt.rc !== undefined ? receipt.rc : isOk ? 0 : 1;
    const logPath = meta.log || path.join(queueDir, `${id}.log`);
    sweptLines.push(`${label} ${status} rc=${rc} log=${logPath}`);
  }

  if (eventName === 'UserPromptSubmit' && sweptLines.length > 0) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `bg-quiet receipts:\n${sweptLines.join('\n')}`,
      },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
  }
}

try {
  main();
} catch {
  // Fail-open
}
process.exit(0);
