'use strict';
/**
 * switch-journal.js - one JSONL row per lane-switch step (plan 2026-11-10-profile-switch.md section 3).
 * File <base>/lane-switch-journal.jsonl, mode 0600, appended under the jsonl-store write lock.
 * Row: { ts, order, lane, step, from, to, outcome, detail? }. Values must be plain short strings: an e-mail-shaped or
 * token-shaped value rejects the whole row and nothing is written (constraint 2). Node >= 20.10, built-ins only.
 */
const path = require('path');
const { withWriteLock, appendRow } = require('./jsonl-store');
const { defaultBase } = require('./lane-manifest');

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TOKEN_RE = /sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}|[A-Za-z0-9+/_=-]{40,}/;
const KEYS = ['ts', 'order', 'lane', 'step', 'from', 'to', 'outcome', 'detail'];

function journalFile(base) { return path.join(base || defaultBase(), 'lane-switch-journal.jsonl'); }

function checkRow(row) {
  if (!row || typeof row !== 'object') throw new Error('journal_row_invalid');
  for (const k of Object.keys(row)) {
    if (!KEYS.includes(k)) throw new Error(`journal_field_rejected:${k}`);
    const v = row[k];
    if (typeof v !== 'string') throw new Error(`journal_value_not_string:${k}`);
    if (EMAIL_RE.test(v)) throw new Error(`journal_value_email_shaped:${k}`);
    if (TOKEN_RE.test(v)) throw new Error(`journal_value_token_shaped:${k}`);
  }
  for (const k of ['order', 'lane', 'step', 'outcome']) if (!row[k]) throw new Error(`journal_missing:${k}`);
}

function appendJournal(base, row, now) {
  const full = { ts: now || new Date().toISOString(), ...row };
  checkRow(full);
  const file = journalFile(base);
  const dir = path.dirname(file);
  withWriteLock({ storeDir: dir, lockFile: `${file}.lock`, name: 'lane-switch-journal' }, () => appendRow(file, full));
  return file;
}

module.exports = { journalFile, checkRow, appendJournal };
