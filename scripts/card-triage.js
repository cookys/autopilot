#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_RECEIPT_FIELDS = ['card_id', 'answer_id', 'failure_class', 'timestamp'];
const VALID_FAILURE_CLASSES = new Set([
  'courier_unreachable',
  'verify_failed',
  'target_offline',
  'scope_mismatch',
]);

function hasValue(val) {
  return val !== undefined && val !== null && val !== '';
}

function classifyVisibility(card, visibleIds, repo) {
  if (repo && hasValue(card.cwd)) {
    if (path.resolve(String(card.cwd)) !== path.resolve(String(repo))) {
      return 'scope_mismatch';
    }
  }

  const hasVisibleIds = visibleIds !== undefined && visibleIds !== null;
  if (card.status === 'open' && hasVisibleIds) {
    const idSet = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
    if (!idSet.has(card.id)) {
      return 'not_shown';
    }
  }

  if (!hasVisibleIds && !repo) {
    return 'unknown';
  }

  return 'visible';
}

function classifyDelivery(card) {
  if (hasValue(card.dispatch_error)) {
    return 'dispatch_failed';
  }
  if (card.forward_status === 'failed') {
    return 'forward_failed';
  }
  if (card.forward_status === 'sent' || hasValue(card.dispatched_message_id)) {
    return 'delivered';
  }
  if (card.status === 'pending_dispatch') {
    return 'pending';
  }
  return 'n/a';
}

function classifyReceipt(receipt) {
  if (receipt === undefined || receipt === null) {
    return { receipt: 'none' };
  }

  const missing = REQUIRED_RECEIPT_FIELDS.filter((field) => !hasValue(receipt[field]));
  const invalidClass =
    hasValue(receipt.failure_class) && !VALID_FAILURE_CLASSES.has(receipt.failure_class);

  if (missing.length > 0 || invalidClass) {
    return { receipt: 'malformed', missing };
  }

  return { receipt: `valid:${receipt.failure_class}` };
}

/**
 * Pure, read-only triage of a decision card's visibility, delivery, and receipt.
 */
function triage({ card, visibleIds, receipt, repo } = {}) {
  if (!card || typeof card !== 'object') {
    throw new TypeError('triage requires a card object');
  }

  const id = hasValue(card.id) ? card.id : null;
  const visibility = classifyVisibility(card, visibleIds, repo);
  const delivery = classifyDelivery(card);
  const receiptResult = classifyReceipt(receipt);

  const ok =
    (visibility === 'visible' || visibility === 'unknown') &&
    delivery !== 'dispatch_failed' &&
    delivery !== 'forward_failed' &&
    receiptResult.receipt !== 'malformed';

  const result = {
    id,
    visibility,
    delivery,
    receipt: receiptResult.receipt,
    ok,
  };

  if (receiptResult.missing !== undefined) {
    result.missing = receiptResult.missing;
  }

  return result;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--card' && i + 1 < argv.length) {
      args.card = argv[++i];
    } else if (token === '--visible-ids' && i + 1 < argv.length) {
      args.visibleIds = argv[++i];
    } else if (token === '--receipt' && i + 1 < argv.length) {
      args.receipt = argv[++i];
    } else if (token === '--repo' && i + 1 < argv.length) {
      args.repo = argv[++i];
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.card) {
    process.stderr.write(
      'Usage: node scripts/card-triage.js --card <card.json> [--visible-ids <file>] [--receipt <receipt.json>] [--repo <path>]\n'
    );
    process.exit(2);
  }

  const card = JSON.parse(fs.readFileSync(args.card, 'utf8'));
  let visibleIds;
  if (args.visibleIds) {
    visibleIds = fs
      .readFileSync(args.visibleIds, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  let receipt;
  if (args.receipt) {
    receipt = JSON.parse(fs.readFileSync(args.receipt, 'utf8'));
  }

  const out = triage({ card, visibleIds, receipt, repo: args.repo });
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = { triage };
