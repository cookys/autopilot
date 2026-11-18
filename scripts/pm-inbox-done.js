#!/usr/bin/env node
'use strict';

// pm-inbox-done.js — PM CLI helper to close one inbox item via the inbox adapter.
//
// Usage:
//   node scripts/pm-inbox-done.js <message_id> --ref <id>
//   node scripts/pm-inbox-done.js <message_id> --no-action <reason>
//
// Refuses closing as done without --ref, and refuses --no-action without a reason.
// Exit codes: 0 ok | 2 usage/validation error | 1 adapter runtime failure.
// Node built-ins only.

const { createAdapter } = require('./lib/pm-inbox-adapter.js');

function usageError(message) {
  const err = new Error(`pm-inbox-done: ${message}`);
  err.exitCode = 2;
  return err;
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/pm-inbox-done.js <message_id> --ref <id>',
    '  node scripts/pm-inbox-done.js <message_id> --no-action <reason>',
  ].join('\n');
}

function parseArgs(argv) {
  let messageId = null;
  let ref = null;
  let hasRefFlag = false;
  let noActionReason = null;
  let hasNoActionFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      return { help: true };
    }
    if (arg === '--ref') {
      hasRefFlag = true;
      if (i + 1 >= argv.length) throw usageError('--ref requires a non-empty <id>');
      ref = argv[++i];
    } else if (arg.startsWith('--ref=')) {
      hasRefFlag = true;
      ref = arg.slice('--ref='.length);
    } else if (arg === '--no-action') {
      hasNoActionFlag = true;
      if (i + 1 >= argv.length) throw usageError('--no-action requires a non-empty <reason>');
      noActionReason = argv[++i];
    } else if (arg.startsWith('--no-action=')) {
      hasNoActionFlag = true;
      noActionReason = arg.slice('--no-action='.length);
    } else if (arg.startsWith('-')) {
      throw usageError(`unknown option "${arg}"`);
    } else if (messageId === null) {
      messageId = arg;
    } else {
      throw usageError(`unexpected positional argument "${arg}"`);
    }
  }

  if (!messageId || messageId.trim() === '') {
    throw usageError('missing <message_id>');
  }
  if (hasRefFlag && hasNoActionFlag) {
    throw usageError('cannot combine --ref and --no-action');
  }
  if (!hasRefFlag && !hasNoActionFlag) {
    throw usageError('refusing done without --ref <id> (or pass --no-action <reason>)');
  }
  if (hasRefFlag && (!ref || ref.trim() === '')) {
    throw usageError('refusing done without a non-empty --ref <id>');
  }
  if (hasNoActionFlag && (!noActionReason || noActionReason.trim() === '')) {
    throw usageError('refusing no_action without a non-empty <reason>');
  }

  return {
    help: false,
    messageId: messageId.trim(),
    disposition: hasRefFlag ? 'done' : 'no_action',
    ref: hasRefFlag ? ref.trim() : null,
    reason: hasNoActionFlag ? noActionReason.trim() : null,
  };
}

function runCli(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 0) {
    throw usageError('missing <message_id> and disposition flag (--ref <id> | --no-action <reason>)');
  }
  const parsed = parseArgs(argv);
  if (parsed.help) {
    return usageText();
  }
  const adapter = createAdapter(env);
  if (parsed.disposition === 'done') {
    adapter.mark(parsed.messageId, 'done', { ref: parsed.ref });
    return `done ${parsed.messageId} (ref=${parsed.ref})`;
  }
  adapter.mark(parsed.messageId, 'no_action', { reason: parsed.reason });
  return `no_action ${parsed.messageId} (${parsed.reason})`;
}

function main() {
  try {
    const out = runCli(process.argv.slice(2), process.env);
    if (out) process.stdout.write(`${out}\n`);
    process.exit(0);
  } catch (err) {
    const code = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(code);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  runCli,
};
