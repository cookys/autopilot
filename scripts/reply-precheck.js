#!/usr/bin/env node
/**
 * reply-precheck.js — run the owner-question Stop rules on a draft before sending it.
 * Shared rules: hooks/lib/owner-question-rules.js.
 *
 * Usage: node scripts/reply-precheck.js [--file <draft>|-] [--json] [--session <id>]
 * Stdin is the default. Exit 0 prints `ok`. Exit 1 prints one line per problem:
 *   <rule>: "<offending sentence>" -> <how to fix>
 * --json prints {ok, problems:[{rule, sentence, fix}]}.
 * Card-to-session binding is skipped (stderr note) unless --session <id> is set.
 */
'use strict';

const fs = require('fs');
const rules = require('../hooks/lib/owner-question-rules.js');

function usage() {
  process.stderr.write('usage: node scripts/reply-precheck.js [--file <draft>|-] [--json] [--session <id>]\n');
}

function parseArgs(argv) {
  const out = { file: '-', json: false, session: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') { usage(); return null; }
    else if (a === '--file') { out.file = argv[i + 1]; i += 1; if (!out.file) throw new Error('--file needs a path'); }
    else if (a === '--session') { out.session = argv[i + 1]; i += 1; if (!out.session) throw new Error('--session needs an id'); }
    else throw new Error(`unknown arg ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return 0;
  const text = !args.file || args.file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.file, 'utf8');
  const { problems, notes } = rules.collectProblems(text, {
    cwd: process.cwd(),
    session_id: args.session || undefined,
    skipSession: !args.session,
  });
  for (const note of notes) process.stderr.write(`reply-precheck: ${note}\n`);
  if (!problems.length) {
    process.stdout.write(args.json ? `${JSON.stringify({ ok: true, problems: [] })}\n` : 'ok\n');
    return 0;
  }
  if (args.json) process.stdout.write(`${JSON.stringify({ ok: false, problems })}\n`);
  else {
    for (const p of problems) process.stdout.write(`${p.rule}: "${String(p.sentence).replace(/[\r\n]+/g, ' ').replace(/"/g, "'")}" -> ${p.fix}\n`);
  }
  return 1;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (err) {
    process.stderr.write(`reply-precheck: ${err && err.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { main };
