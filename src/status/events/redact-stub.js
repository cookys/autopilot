'use strict';

// src/status/events/redact-stub.js - TEMPORARY local stand-in for src/status/events/redact.js (written by lane B, merged in E3).
// Call point (the one E3 swaps): `redactFreeText(text) -> { text, count }`, `[redacted]` replacing every hit, count = hits.
// Used by sources/decision.js and sources/runledger.js. When redact.js lands, point both requires at it and delete this file.

const patterns = require('../../../scripts/lib/personal-data-patterns');

const MARKER = '[redacted]';
const PLACEHOLDERS = Object.values(patterns.PLACEHOLDER).concat('<email>');
const EXTRA = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

function redactFreeText(input) {
  if (typeof input !== 'string' || input === '') return { text: typeof input === 'string' ? input : '', count: 0 };
  let count = 0;
  let text = input;
  try {
    const res = patterns.redact(text);
    count += res.hits.length;
    text = res.text;
    for (const placeholder of PLACEHOLDERS) text = text.split(placeholder).join(MARKER);
  } catch (_error) { /* the extra patterns below still apply */ }
  for (const re of EXTRA) text = text.replace(re, () => { count += 1; return MARKER; });
  return { text, count };
}

module.exports = { redactFreeText, MARKER };
