#!/usr/bin/env node
'use strict';

// check-fixed-times.js - lint for the lead-watch rule (operator 2026-11-08, PM go 01M6VYKCJZ):
// an evidence time is the LATEST moment to look back and check the work is still moving; it is not a start time
// and not a delivery time. A fixed clock time written into a dispatch template is allowed only for a real
// external constraint, and that constraint must be written down next to it.
//
//   node scripts/check-fixed-times.js [--root <dir>] [file ...]
//
// Default targets (relative to --root, default this repo): references/batch-dispatch.md,
// skills/ceo-agent/references/level-front-door.md, skills/lead-watch/SKILL.md. A default target that does not
// exist is skipped (lead-watch lands later); a file named on the command line must exist.
// Exit 0 clean, 1 one or more unexplained fixed times, 2 usage / unreadable file.
//
// Rule constants (edit here only):
//   FIXED_TIME_RES  what counts as a fixed clock time:
//                   - HH:MM followed by Z (`12:30Z`), or
//                   - HH:MM followed by a start/send/delivery word (`12:30 送審`, `09:00 開工`, `18:00 推送`).
//   REASON_RES      what counts as a stated reason, on the SAME line or the NEXT line:
//                   - `（外部限制：...）` or `(外部限制：...)`
//                   - `(external limit: ...)`
//                   - `reason:` (case-insensitive)

const fs = require('fs');
const path = require('path');

const FIXED_TIME_RES = [
  /\b\d{1,2}:\d{2}\s?Z\b/,
  /\b\d{1,2}:\d{2}\s?(?:Z|UTC)?\s*(?:送審|開工|推送|交件|開跑|派工)/,
];
const REASON_RES = [
  /[（(]外部限制[：:]/,
  /\(external limit:/i,
  /\breason:/i,
];
const DEFAULT_TARGETS = [
  'references/batch-dispatch.md',
  'skills/ceo-agent/references/level-front-door.md',
  'skills/lead-watch/SKILL.md',
];

function lintText(text) {
  const lines = text.split('\n');
  const hits = [];
  const hasReason = (s) => REASON_RES.some((re) => re.test(s));
  lines.forEach((line, i) => {
    const re = FIXED_TIME_RES.find((r) => r.test(line));
    if (!re) return;
    if (hasReason(line) || hasReason(lines[i + 1] || '')) return;
    hits.push({ line: i + 1, time: line.match(re)[0].trim() });
  });
  return hits;
}

function main(argv) {
  let root = path.resolve(__dirname, '..');
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = path.resolve(argv[++i] || '');
    else if (argv[i].startsWith('-')) {
      process.stderr.write('Usage: node scripts/check-fixed-times.js [--root <dir>] [file ...]\n');
      return 2;
    } else files.push(argv[i]);
  }
  const explicit = files.length > 0;
  const targets = explicit ? files : DEFAULT_TARGETS;
  let bad = 0;
  for (const t of targets) {
    const p = path.resolve(root, t);
    if (!fs.existsSync(p)) {
      if (explicit) { process.stderr.write(`check-fixed-times: cannot read ${t}\n`); return 2; }
      continue;
    }
    for (const h of lintText(fs.readFileSync(p, 'utf8'))) {
      bad++;
      process.stdout.write(`${t}:${h.line}: fixed time "${h.time}" has no reason (add （外部限制：...） or "reason:" on this or the next line)\n`);
    }
  }
  if (bad) return 1;
  process.stdout.write('check-fixed-times: clean\n');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
