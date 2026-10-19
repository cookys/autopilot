#!/usr/bin/env node
'use strict';
//
// qualification-feed-trust.js — BL-0194 P6 stage C. This is not an adopt command.
// It never writes a scorecard row, a strike, or an evidence file. It writes only
// confirmations.jsonl and card-batches.jsonl under the feed cache directory.
//
//   node scripts/qualification-feed-trust.js status [--feed-cache-dir <dir>] [--cwd <dir>]
//   node scripts/qualification-feed-trust.js sync   [--feed-cache-dir <dir>] [--cwd <dir>]
//   node scripts/qualification-feed-trust.js answer --card <id> --decision confirm|reject
//                                                    [--feed-cache-dir <dir>] [--cwd <dir>]
//
// Exit codes: 0 ok, 2 usage, 3 gate rejected (loud; the gate already wrote the reason).
// There is no adopt subcommand.

const path = require('path');
const os = require('os');
const qualificationTrust = require('./lib/qualification-trust.js');
const confirm = require('./lib/qualification-confirm.js');

function usage(message) {
  if (message) process.stderr.write(`qualification-feed-trust: ${message}\n`);
  process.stderr.write('usage: qualification-feed-trust.js status|sync|answer --card <id> --decision confirm|reject [--feed-cache-dir <dir>] [--cwd <dir>]\n');
  return 2;
}

function parse(argv) {
  const opts = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => {
      i += 1;
      return argv[i];
    };
    if (arg === '--feed-cache-dir') opts.cacheDir = take();
    else if (arg === '--cwd') opts.cwd = take();
    else if (arg === '--card') opts.card = take();
    else if (arg === '--decision') opts.decision = take();
    else return { error: `unknown argument ${arg}` };
  }
  if (opts.cacheDir && opts.cacheDir.startsWith('~/')) opts.cacheDir = path.join(os.homedir(), opts.cacheDir.slice(2));
  return opts;
}

function cacheDirOf(opts) {
  return opts.cacheDir || path.join(os.homedir(), '.autopilot', 'qualification-feeds');
}

function main(argv) {
  const opts = parse(argv);
  if (opts.error) return usage(opts.error);
  if (!opts.command || !['status', 'sync', 'answer'].includes(opts.command)) {
    return usage(opts.command ? `unknown command ${opts.command}` : 'missing command');
  }
  const cacheDir = cacheDirOf(opts);
  const nowMs = Date.now();
  if (opts.command === 'answer') {
    if (!opts.card || !opts.decision) return usage('answer needs --card and --decision');
    const result = confirm.answer({ cacheDir, cardId: opts.card, decision: opts.decision, cwd: opts.cwd });
    if (!result.ok && result.usage) return usage(result.reason);
    if (!result.ok) {
      process.stderr.write(`qualification-feed-trust: ${result.reason}\n`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  const mode = qualificationTrust.resolveTrustMode();
  const gated = qualificationTrust.gate(cacheDir, nowMs);
  if (opts.command === 'status') {
    const pending = gated.ok ? confirm.pendingRows(cacheDir, gated) : [];
    process.stdout.write(`${JSON.stringify({
      trust_mode: mode,
      gate: { ok: gated.ok, reasons: gated.reasons },
      pending,
      open_batches: confirm.openBatches(cacheDir).map((line) => ({
        batch_id: line.batch_id,
        card_id: line.card_id,
        rows: line.rows,
        opened_at: line.opened_at,
      })),
    })}\n`);
    if (!gated.ok) return 3;
    return 0;
  }
  const result = confirm.sync({ cacheDir, cwd: opts.cwd || process.cwd(), nowMs });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.gateRejected) return 3;
  if (!result.ok) {
    process.stderr.write(`qualification-feed-trust: ${result.reason}\n`);
    return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
