#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [action, ...args] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < args.length; i += 2) opts[args[i]] = args[i + 1];
const card = opts['--card'];
if (!/^d-[0-9a-f]{8}$/.test(card || '') || !['grant', 'revoke'].includes(action)) {
  console.error('Invalid action or card'); process.exit(2);
}
const dir = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), 'autopilot', 'card-exceptions');
const file = path.join(dir, `${card}.json`);
if (action === 'revoke') {
  try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
} else {
  const answer = opts['--answer']; const sha = opts['--content-sha256']; const mode = opts['--mode'];
  if (mode !== 'usage' || !answer || !/^[0-9a-f]{64}$/.test(sha || '')) {
    console.error('Invalid mode, answer or content SHA-256'); process.exit(2);
  }
  const result = spawnSync(process.env.AUTOPILOT_FLEET_BIN || 'fleet', ['decision', 'verify', card, answer, '--content-sha256', sha], { encoding: 'utf8', timeout: 3000 });
  if (result.status !== 0) {
    console.error(`Decision verification failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`); process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  fs.writeFileSync(file, JSON.stringify({ card, answer, content_sha256: sha, mode, verified_at: new Date().toISOString() }), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
