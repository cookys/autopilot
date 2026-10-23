#!/usr/bin/env node
'use strict';
// seed-claude-config.js — build a throwaway CLAUDE_CONFIG_DIR for a claude child.
//
//   node scripts/lib/seed-claude-config.js [--parent DIR] [--check]
//
// Creates a fresh mode-0700 directory under --parent (default os.tmpdir()) holding ONLY a
// mode-0600 copy of `.credentials.json` from the real claude config dir (CLAUDE_CONFIG_DIR, else
// ~/.claude), and prints its absolute path on stdout. The child therefore gets native auth but
// never the operator's settings.json, projects/, hooks, plugins or history. The caller owns
// removal of the directory.
//
// --check validates that the source credentials file is readable and creates nothing.
// Fails closed: exit 2 with a one-line stderr message when the source credentials are missing
// or the directory cannot be built (a half-built directory is removed). Node built-ins only.
const fs = require('fs');
const os = require('os');
const path = require('path');

function fail(msg) {
  process.stderr.write(`seed-claude-config: ${msg}\n`);
  process.exit(2);
}

let parent = os.tmpdir();
let check = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--check') check = true;
  else if (argv[i] === '--parent' && argv[i + 1]) { parent = argv[i + 1]; i += 1; }
  else fail(`unknown or incomplete argument "${argv[i]}"`);
}

const realDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const src = path.join(realDir, '.credentials.json');
try {
  if (!fs.statSync(src).isFile()) throw new Error('not a regular file');
  fs.accessSync(src, fs.constants.R_OK);
} catch (e) {
  fail(`source credentials missing or unreadable: ${src} (${e.message})`);
}
if (check) process.exit(0);

let dir = '';
try {
  fs.mkdirSync(parent, { recursive: true });
  dir = fs.mkdtempSync(path.join(parent, 'claude-config-'));
  fs.chmodSync(dir, 0o700);
  const dst = path.join(dir, '.credentials.json');
  fs.writeFileSync(dst, fs.readFileSync(src), { mode: 0o600 });
  fs.chmodSync(dst, 0o600);
} catch (e) {
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
  fail(`could not seed config dir: ${e.message}`);
}
process.stdout.write(`${dir}\n`);
