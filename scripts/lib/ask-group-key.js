'use strict';

const { createHash } = require('node:crypto');

function normalizeQuestion(text) {
  if (typeof text !== 'string') {
    return '';
  }

  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function groupKey(text) {
  const normalized = normalizeQuestion(text);

  if (normalized === '') {
    return null;
  }

  return createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

module.exports = {
  normalizeQuestion,
  groupKey,
};
