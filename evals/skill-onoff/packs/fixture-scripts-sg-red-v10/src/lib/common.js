'use strict';

function findJsonObjectCandidates(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push({
          source: text.slice(start, i + 1),
          start,
          end: i + 1,
        });
        start = -1;
      }
    }
  }

  return {
    candidates,
    trailingUnclosedStart: depth > 0 ? start : -1,
  };
}

function isImmutableGitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

function bufferToString(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  return '';
}

module.exports = {
  findJsonObjectCandidates,
  isImmutableGitSha,
  bufferToString,
};
