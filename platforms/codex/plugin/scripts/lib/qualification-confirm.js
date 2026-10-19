'use strict';

/**
 * qualification-confirm.js — BL-0194 P6 stage C.
 *
 * Confirmations live in <feed cache>/confirmations.jsonl. A missing file is
 * no confirmations. A torn line is skipped. This module never writes a
 * scorecard row, a strike, or an evidence file, and it never opens one card
 * per row.
 *
 * Node >= 20.10, built-ins plus the existing qualification and decision libs.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { withWriteLock, appendRow } = require('./jsonl-store.js');
const qualificationTrust = require('./qualification-trust.js');
const { openDecision, closeDecisionById } = require('../open-decision.js');

const CONFIRM_KEYS = ['record_id', 'seat', 'content_digest', 'confirmed_at', 'card_id'];
const SEAT_FIELDS = ['engine', 'runner', 'role', 'effort'];

function confirmationsPath(cacheDir) {
  return path.join(path.resolve(cacheDir), 'confirmations.jsonl');
}

function batchesPath(cacheDir) {
  return path.join(path.resolve(cacheDir), 'card-batches.jsonl');
}

function readJsonl(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    return [];
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      rows.push(value);
    } catch {
      // A torn or malformed line is skipped, never fatal.
    }
  }
  return rows;
}

function seatOf(seat) {
  const out = {};
  for (const field of SEAT_FIELDS) out[field] = seat && seat[field];
  return out;
}

function seatsEqual(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  return SEAT_FIELDS.every((field) => left[field] === right[field]);
}

function confirmationShape(line) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
  if (!CONFIRM_KEYS.every((key) => Object.prototype.hasOwnProperty.call(line, key))) return false;
  if (typeof line.record_id !== 'string' || typeof line.content_digest !== 'string') return false;
  if (typeof line.confirmed_at !== 'string' || typeof line.card_id !== 'string') return false;
  const seat = line.seat;
  if (!seat || typeof seat !== 'object' || Array.isArray(seat)) return false;
  if (typeof seat.engine !== 'string' || typeof seat.runner !== 'string' || typeof seat.role !== 'string') return false;
  return typeof seat.effort === 'string' || seat.effort === null;
}

function readConfirmations(cacheDir) {
  const file = confirmationsPath(cacheDir);
  let text;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      process.stderr.write(
        `qualification-feed confirmations: skipped 1 line (${file} is not a regular file); no confirmations\n`,
      );
      return [];
    }
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    process.stderr.write(
      `qualification-feed confirmations: skipped 1 line (${file} unreadable: ${error.code || error.message}); no confirmations\n`,
    );
    return [];
  }
  const rows = [];
  let skipped = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (!confirmationShape(value)) {
        skipped += 1;
        continue;
      }
      rows.push(value);
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    process.stderr.write(
      `qualification-feed confirmations: skipped ${skipped} line(s) in ${file}\n`,
    );
  }
  return rows;
}

function readBatches(cacheDir) {
  return readJsonl(batchesPath(cacheDir));
}

function lineMatches(line, row) {
  return line.record_id === row.record_id
    && line.content_digest === row.content_digest
    && seatsEqual(line.seat, seatOf(row.seat));
}

function isConfirmed(cacheDir, row) {
  return readConfirmations(cacheDir).some((line) => lineMatches(line, row));
}

function matchingConfirmation(cacheDir, row) {
  return readConfirmations(cacheDir).find((line) => lineMatches(line, row)) || null;
}

function batchIdOf(rows) {
  const pairs = rows.map((row) => `${row.record_id} ${row.content_digest}`).sort();
  return crypto.createHash('sha256').update(pairs.join('\n')).digest('hex');
}

function rejectedAtDigest(cacheDir) {
  const rejected = new Set();
  for (const line of readBatches(cacheDir)) {
    if (line.decision !== 'rejected') continue;
    if (typeof line.record_id !== 'string' || typeof line.content_digest !== 'string') continue;
    rejected.add(`${line.record_id} ${line.content_digest}`);
  }
  return rejected;
}

function pendingRows(cacheDir, gateResult) {
  const rejected = rejectedAtDigest(cacheDir);
  return qualificationTrust.usableQualificationRows(gateResult)
    .filter((row) => !isConfirmed(cacheDir, row))
    .filter((row) => !rejected.has(`${row.record_id} ${row.content_digest}`))
    .map((row) => ({
      record_id: row.record_id,
      seat: seatOf(row.seat),
      content_digest: row.content_digest,
    }));
}

function batchRecorded(cacheDir, batchId) {
  return readBatches(cacheDir).some((line) => line.batch_id === batchId);
}

function openBatches(cacheDir) {
  const lines = readBatches(cacheDir);
  const answered = new Set(lines.filter((line) => line.decision === 'confirm' || line.decision === 'rejected').map((line) => line.batch_id));
  return lines.filter((line) => Array.isArray(line.rows) && line.card_id && !answered.has(line.batch_id));
}

function lookupBatch(cacheDir, cardId) {
  return readBatches(cacheDir).find((line) => line.card_id === cardId && Array.isArray(line.rows)) || null;
}

function ensureStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) {
    const fd = fs.openSync(file, 'a', 0o600);
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
}

function feedLock(cacheDir) {
  const dir = path.resolve(cacheDir);
  return { storeDir: dir, lockFile: path.join(dir, '.feed-write.lock'), name: 'qualification-feed' };
}

// Caller holds feedLock. withWriteLock is not reentrant, so this must not lock again.
function appendLinesUnlocked(file, rows) {
  if (rows.length === 0) return;
  ensureStore(file);
  for (const row of rows) appendRow(file, row);
  fs.chmodSync(file, 0o600);
}

function describeSeats(rows) {
  return rows.map((row) => {
    const seat = seatOf(row.seat);
    return `${seat.engine} / ${seat.runner} / ${seat.role} / ${seat.effort}`;
  }).join('; ');
}

function sync(opts) {
  const cacheDir = opts && opts.cacheDir;
  const cwd = opts && opts.cwd;
  if (!cacheDir) return { ok: false, reason: 'feed cache dir is required' };
  const mode = qualificationTrust.resolveTrustMode();
  if (mode !== 'confirm') {
    return { ok: true, skipped: true, reason: `trust mode is ${mode}, not confirm` };
  }
  const nowMs = opts.nowMs === undefined ? Date.now() : opts.nowMs;
  const gated = qualificationTrust.gate(cacheDir, nowMs);
  if (!gated.ok) {
    return { ok: true, skipped: true, gateRejected: true, reason: `gate rejected: ${(gated.reasons || []).join('; ')}` };
  }
  return withWriteLock(feedLock(cacheDir), () => {
    const rows = pendingRows(cacheDir, gated);
    const batchId = batchIdOf(rows);
    if (rows.length === 0) {
      return { ok: true, skipped: true, reason: 'no pending rows', batch_id: batchId, pending: rows };
    }
    if (batchRecorded(cacheDir, batchId)) {
      return { ok: true, skipped: true, reason: 'a card is already recorded for this batch', batch_id: batchId, pending: rows };
    }
    const count = rows.length;
    const opened = openDecision({
      cwd: cwd || process.cwd(),
      question: `Confirm ${count} qualification feed ${count === 1 ? 'row' : 'rows'}?`,
      background: `${count} new feed ${count === 1 ? 'row is' : 'rows are'} waiting: ${describeSeats(rows)}. Confirming records that you accept ${count === 1 ? 'this row' : 'these rows'}. Rejecting leaves ${count === 1 ? 'it' : 'them'} unused.`,
      options: [
        { label: 'confirm', description: 'Record a confirmation for each row in this batch.' },
        { label: 'reject', description: 'Leave these rows unused. This batch is not asked again.' },
      ],
      source: 'qualification-feed trust',
    });
    if (!opened || opened.status !== 'ok') {
      return { ok: false, reason: (opened && opened.message) || 'could not open a decision card', batch_id: batchId };
    }
    appendLinesUnlocked(batchesPath(cacheDir), [{
      batch_id: batchId,
      card_id: opened.id,
      rows,
      opened_at: new Date().toISOString(),
      file: opened.file,
    }]);
    return { ok: true, opened: true, card_id: opened.id, file: opened.file, batch_id: batchId, pending: rows };
  });
}

function answer(opts) {
  const cacheDir = opts && opts.cacheDir;
  const cardId = opts && opts.cardId;
  const decision = opts && opts.decision;
  if (!cacheDir || typeof cardId !== 'string' || !cardId) {
    return { ok: false, usage: true, reason: 'answer needs a feed cache dir and a card id' };
  }
  if (decision !== 'confirm' && decision !== 'reject') {
    return { ok: false, usage: true, reason: 'decision must be confirm or reject' };
  }
  return withWriteLock(feedLock(cacheDir), () => {
    const batch = lookupBatch(cacheDir, cardId);
    if (!batch) return { ok: false, usage: true, reason: `unknown card id ${cardId}` };
    const already = readBatches(cacheDir).some((line) => line.batch_id === batch.batch_id && (line.decision === 'confirm' || line.decision === 'rejected'));
    if (decision === 'confirm' && !already) {
      const fresh = [];
      for (const row of batch.rows) {
        if (isConfirmed(cacheDir, row)) continue;
        fresh.push({
          record_id: row.record_id,
          seat: seatOf(row.seat),
          content_digest: row.content_digest,
          confirmed_at: new Date().toISOString(),
          card_id: cardId,
        });
      }
      appendLinesUnlocked(confirmationsPath(cacheDir), fresh);
    }
    if (!already) {
      const answeredAt = new Date().toISOString();
      const lines = [{
        batch_id: batch.batch_id,
        card_id: cardId,
        decision: decision === 'confirm' ? 'confirm' : 'rejected',
        answered_at: answeredAt,
      }];
      if (decision === 'reject') {
        for (const row of batch.rows) {
          lines.push({
            batch_id: batch.batch_id,
            card_id: cardId,
            decision: 'rejected',
            record_id: row.record_id,
            content_digest: row.content_digest,
            answered_at: answeredAt,
          });
        }
      }
      appendLinesUnlocked(batchesPath(cacheDir), lines);
    }
    if (typeof batch.file === 'string' && batch.file) closeDecisionById(batch.file, cardId);
    return { ok: true, decision, card_id: cardId, batch_id: batch.batch_id };
  });
}

module.exports = {
  confirmationsPath,
  batchesPath,
  readConfirmations,
  isConfirmed,
  matchingConfirmation,
  batchIdOf,
  pendingRows,
  sync,
  answer,
  openBatches,
  seatOf,
};
