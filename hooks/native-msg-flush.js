#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveStateDir, status } = require('../scripts/native-msg-outbox');
const { mkdirp } = require('../scripts/lib/safe-mkdirp');

function main() {
  try {
    const stateDir = resolveStateDir();
    const st = status(stateDir);
    if (!st || st.pending <= 0) return;

    mkdirp(stateDir);
    const stampPath = path.join(stateDir, 'native-msg-flush.stamp');
    try {
      const stat = fs.statSync(stampPath);
      if (Date.now() - stat.mtimeMs < 60000) {
        return;
      }
    } catch {
      // stamp does not exist yet
    }

    fs.writeFileSync(stampPath, String(Date.now()), 'utf8');

    const outboxScript = path.resolve(__dirname, '../scripts/native-msg-outbox.js');
    const child = spawn(process.execPath, [outboxScript, 'flush'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch {
    // fail-open
  }
}

main();
process.exit(0);
