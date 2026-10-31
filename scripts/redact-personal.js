#!/usr/bin/env node
'use strict';
/*
 * redact-personal.js — replace personal data in files, in place.
 *
 *   node scripts/redact-personal.js [--check | --dry-run] [--json] FILE...
 *
 * Placeholders: $HOME  <user>  <host>  <private-ip>  <redacted-secret>.
 * --check    report only, write nothing, exit 1 when any file has a hit.
 * --dry-run  report what would change, write nothing, exit 0.
 * (default)  rewrite each file via tmp file + rename, exit 0.
 * Binary files (a NUL byte) are skipped. An env_file finding cannot be redacted: git rm it.
 * Exit: 0 ok | 1 --check found hits | 2 usage / unreadable file.
 * Output never echoes the original value.
 */
const { redactFile } = require('./lib/personal-data-redact');

const args = process.argv.slice(2);
let mode = 'write';
let json = false;
const files = [];
for (const a of args) {
  if (a === '--check') mode = 'check';
  else if (a === '--dry-run') mode = 'dry-run';
  else if (a === '--json') json = true;
  else if (a === '-h' || a === '--help') {
    process.stdout.write('usage: redact-personal.js [--check | --dry-run] [--json] FILE...\n');
    process.exit(0);
  } else if (a.startsWith('-')) {
    process.stderr.write(`redact-personal: unknown option ${a}\n`);
    process.exit(2);
  } else files.push(a);
}
if (args.includes('--check') && args.includes('--dry-run')) {
  process.stderr.write('redact-personal: --check and --dry-run are exclusive\n');
  process.exit(2);
}
if (files.length === 0) {
  process.stderr.write('redact-personal: no files given\n');
  process.exit(2);
}

const results = [];
for (const f of files) {
  try {
    results.push(redactFile(f, mode));
  } catch (e) {
    process.stderr.write(`redact-personal: ${f}: ${e.message}\n`);
    process.exit(2);
  }
}
if (json) {
  process.stdout.write(JSON.stringify({ mode, results }, null, 2) + '\n');
} else {
  for (const r of results) {
    if (r.skipped) process.stdout.write(`${r.file}: skipped (${r.skipped})\n`);
    else if (r.hits === 0) process.stdout.write(`${r.file}: clean\n`);
    else {
      const verb = mode === 'write' ? 'redacted' : mode === 'check' ? 'needs redaction' : 'would redact';
      process.stdout.write(`${r.file}: ${verb} ${r.hits} (${Object.entries(r.byCategory).map(([k, v]) => `${k}=${v}`).join(' ')})\n`);
    }
  }
}
process.exit(mode === 'check' && results.some((r) => r.changed) ? 1 : 0);
