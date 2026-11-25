'use strict';
/**
 * work-order-plan.js — parse SizeTag, Size, and Plan markers from a fleet work order.
 *
 * Parses structured markers only (prose mentions such as "we follow plan-first" are ignored):
 *   - Title SizeTag on line 1 (`[S]`, `[bug S]`, `[!L]`, `[L!]`, `[bug !M]`, `[!bug M]`):
 *     `parseSizeTag(title)` -> `{ size: 'XS'|'S'|'M'|'L'|'XL'|'conflict'|null, bug: boolean, urgent: boolean }`
 *   - Size field lines (`Size: XS|S|M|L|XL` or `| Size: X |` or line-1 SizeTag):
 *     `parse(text)` -> `{ size, plan }`, with `size = 'conflict'` if two different sizes appear
 *   - Plan field line: `{ path, sha }` for `Plan: <path>@<sha>` (7-40 lowercase hex), or `'plan-first'`
 *
 * Node built-ins only.
 */

const SIZES = Object.freeze(['XS', 'S', 'M', 'L', 'XL']);
const SIZE_SET = new Set(SIZES);
const M_PLUS_SIZES = new Set(['M', 'L', 'XL']);

const SIZE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?Size(?:\*\*)?\s*:\s*(?:\*\*)?\s*(XS|S|M|L|XL)\b/;
const BRIEF_HEADER_SIZE_RE = /\|\s*(?:\*\*)?Size(?:\*\*)?\s*:\s*(?:\*\*)?\s*(XS|S|M|L|XL)\b(?:\*\*)?\s*(?:\||$)/g;
const BRACKET_TAG_RE = /\[([^\[\]\r\n]+)\]/g;
const SIZE_TOKEN_RE = /^(!)?(XS|S|M|L|XL)(!)?$/;
const PLAN_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?Plan(?:\*\*)?\s*:\s*(?:\*\*)?\s*(?:plan-first|(\S+)@([0-9a-f]{7,40}))(?:\*\*)?\s*$/;
const PLAN_FIRST_ONLY_RE = /^\s*plan-first\s*$/;
const PLAN_LOOP_RE = /\bplan[- ]loop\b/i;
const PLAN_EXEMPT_RE = /\[plan-exempt:\s*([^\]\r\n]*)\]/;
const LEGACY_MD_SHA_RE = /(\S+\.md)@([0-9a-f]{7,})\b/;

function isMPlus(size) {
  return typeof size === 'string' && M_PLUS_SIZES.has(size);
}

function parseBracketTokens(inner) {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  const sizes = [];
  let bug = false;
  let urgent = false;

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower === 'bug') {
      bug = true;
      continue;
    }
    if (lower === '!bug' || lower === 'bug!') {
      bug = true;
      urgent = true;
      continue;
    }
    if (tok === '!' || lower === 'urgent') {
      urgent = true;
      continue;
    }
    const sm = SIZE_TOKEN_RE.exec(tok);
    if (sm && SIZE_SET.has(sm[2])) {
      sizes.push(sm[2]);
      if (sm[1] === '!' || sm[3] === '!') urgent = true;
      continue;
    }
    return null;
  }

  if (sizes.length === 0) return null;
  const unique = new Set(sizes);
  if (unique.size > 1) return { size: 'conflict', bug: false, urgent: false };
  return { size: sizes[0], bug, urgent };
}

/**
 * Parse the title SizeTag (`[S]`, `[bug S]`, `[!L]`, etc.) from line 1 of a fleet task title.
 */
function parseSizeTag(title) {
  if (typeof title !== 'string' || title.length === 0) {
    return { size: null, bug: false, urgent: false };
  }
  const firstLine = title.split(/\r?\n/, 1)[0];
  const foundSizes = new Set();
  let bug = false;
  let urgent = false;

  BRACKET_TAG_RE.lastIndex = 0;
  let match;
  while ((match = BRACKET_TAG_RE.exec(firstLine)) !== null) {
    const parsed = parseBracketTokens(match[1]);
    if (!parsed) continue;
    if (parsed.size === 'conflict') {
      return { size: 'conflict', bug: false, urgent: false };
    }
    foundSizes.add(parsed.size);
    if (parsed.bug) bug = true;
    if (parsed.urgent) urgent = true;
  }

  if (foundSizes.size === 0) return { size: null, bug: false, urgent: false };
  if (foundSizes.size > 1) return { size: 'conflict', bug: false, urgent: false };
  return { size: [...foundSizes][0], bug, urgent };
}

function parse(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { size: null, plan: null };
  }

  const lines = text.split(/\r?\n/);
  const foundSizes = new Set();
  let hasConflict = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sm = SIZE_LINE_RE.exec(line);
    if (sm) foundSizes.add(sm[1]);

    if (i === 0) {
      BRIEF_HEADER_SIZE_RE.lastIndex = 0;
      let bm;
      while ((bm = BRIEF_HEADER_SIZE_RE.exec(line)) !== null) {
        foundSizes.add(bm[1]);
      }
      const tag = parseSizeTag(line);
      if (tag.size === 'conflict') hasConflict = true;
      else if (tag.size) foundSizes.add(tag.size);
    }
  }

  let size = null;
  if (hasConflict || foundSizes.size > 1) {
    size = 'conflict';
  } else if (foundSizes.size === 1) {
    size = [...foundSizes][0];
  }

  let plan = null;
  for (const line of lines) {
    const pm = PLAN_LINE_RE.exec(line);
    if (pm) {
      plan = pm[1] ? { path: pm[1], sha: pm[2] } : 'plan-first';
      break;
    }
  }
  if (plan === null) {
    for (const line of lines) {
      if (PLAN_FIRST_ONLY_RE.test(line)) {
        plan = 'plan-first';
        break;
      }
    }
  }
  if (plan === null && PLAN_LOOP_RE.test(text)) {
    plan = 'plan-first';
  }
  if (plan === null) {
    const em = PLAN_EXEMPT_RE.exec(text);
    if (em && em[1].trim().length > 0) {
      plan = { exempt: em[1].trim() };
    }
  }
  if (plan === null) {
    const lm = LEGACY_MD_SHA_RE.exec(text);
    if (lm) {
      plan = { path: lm[1], sha: lm[2], legacy: true };
    }
  }

  return { size, plan };
}

module.exports = {
  parse,
  parseSizeTag,
  isMPlus,
  SIZES,
  M_PLUS_SIZES,
};
