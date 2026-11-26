#!/usr/bin/env node
'use strict';
// Export the hook events of one Claude transcript as content-free trace rows (ts, kind, event, hook, byte counts, exit)
// in the format scripts/measure-seat-injection.js --from-trace / --check-targets reads. Never copies message text.
//   node scripts/export-hook-trace.js <transcript.jsonl> [--from <iso>] [--to <iso>] [--out <file>]
const fs = require('fs');

const HOOK_KINDS = new Set(['hook_success', 'hook_additional_context', 'hook_blocking_error', 'hook_cancelled', 'hook_system_message']);

function bytesOf(v) {
  if (v === undefined || v === null) return 0;
  return Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v));
}

// One content-free row per submitted prompt, the denominator of --check-targets. Tool results, meta and sidechain entries are not prompts.
function promptRow(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return null;
  const c = entry.message && entry.message.content;
  if (!(typeof c === 'string' || (Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result')))) return null;
  return { ts: entry.timestamp, kind: 'prompt', event: 'Prompt', hook: 'Prompt', context_bytes: 0, stdout_bytes: 0, exit: null };
}

function rowOf(entry) {
  const a = entry && entry.attachment;
  if (!a || !HOOK_KINDS.has(a.type)) return null;
  const additional = a.type === 'hook_additional_context' ? bytesOf(a.content) : 0;
  return {
    ts: entry.timestamp,
    kind: a.type,
    event: a.hookEvent || null,
    hook: a.hookName || null,
    context_bytes: additional,
    stdout_bytes: a.type === 'hook_additional_context' ? 0 : bytesOf(a.stdout),
    exit: typeof a.exitCode === 'number' ? a.exitCode : null,
  };
}

function exportTrace(text, { from, to } = {}) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const row = rowOf(entry) || promptRow(entry);
    if (!row || !row.ts) continue;
    if (from && row.ts < from) continue;
    if (to && row.ts > to) continue;
    rows.push(row);
  }
  return rows;
}

function main(argv) {
  const file = argv.find((x) => !x.startsWith('--') && argv[argv.indexOf(x) - 1] !== '--from' && argv[argv.indexOf(x) - 1] !== '--to' && argv[argv.indexOf(x) - 1] !== '--out');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  if (!file) { process.stderr.write('usage: export-hook-trace.js <transcript.jsonl> [--from iso] [--to iso] [--out file]\n'); return 2; }
  const rows = exportTrace(fs.readFileSync(file, 'utf8'), { from: opt('--from'), to: opt('--to') });
  const out = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  if (opt('--out')) fs.writeFileSync(opt('--out'), out); else process.stdout.write(out);
  process.stderr.write(`export-hook-trace: ${rows.length} rows\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { rowOf, exportTrace };
