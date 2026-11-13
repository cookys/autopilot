#!/usr/bin/env node
'use strict';

/**
 * Replay the registered owner-question-guard's decision logic, ignoring opt-out switches.
 * Usage: node scripts/replay-stop-guard.js --dir <directory of .jsonl transcripts>
 * Local cards resolve from the invocation cwd. No card, transcript or fleet writes.
 * Output (sorted): <basename>: BLOCK <unresolved classes> | PASS - . Never reply text.
 * Exit 0: every file evaluated (BLOCK is an expected result); 2: usage/input error.
 * Contract: references/owner-question-guard.md.
 */
const fs = require('node:fs');
const path = require('node:path');
const guard = require('../hooks/owner-question-guard');

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--dir' || !argv[1] || argv[1].startsWith('--')) {
    process.stderr.write('usage: replay-stop-guard.js --dir <directory of .jsonl transcripts>\n');
    return 2;
  }
  try {
    const dir = path.resolve(argv[1]);
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile() && f.name.endsWith('.jsonl')).map((f) => f.name).sort();
    if (!files.length) throw new Error('no .jsonl transcripts');
    for (const file of files) {
      const transcript_path = path.join(dir, file);
      const text = guard.lastAssistantText(fs.readFileSync(transcript_path, 'utf8'));
      if (!text) throw new Error(`${file}: no final assistant text`);
      const out = guard.decide({ transcript_path, cwd: process.cwd(), stop_hook_active: false });
      const classes = [...new Set(guard.unresolvedHits(text).flatMap((h) => h.classes))].sort();
      process.stdout.write(`${file}: ${out?.decision === 'block' ? `BLOCK ${classes.join(',')}` : 'PASS -'}\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`replay-stop-guard: ${err.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { main };
