'use strict';
/**
 * work-order-plan.js — parse Size and Plan marker lines from a fleet work order.
 *
 * Parses field lines only (prose mentions such as "we follow plan-first" are ignored):
 *   - Size: XS | S | M | L | XL (or `| Size: X |` on line 1), `'conflict'` if two different sizes appear
 *   - Plan: `{ path, sha }` for `Plan: <path>@<sha>` (7-40 lowercase hex), or `'plan-first'`
 *
 * Node built-ins only.
 */

const SIZES = Object.freeze(['XS', 'S', 'M', 'L', 'XL']);
const M_PLUS_SIZES = new Set(['M', 'L', 'XL']);

const SIZE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?Size(?:\*\*)?\s*:\s*(?:\*\*)?\s*(XS|S|M|L|XL)\b/;
const BRIEF_HEADER_SIZE_RE = /\|\s*(?:\*\*)?Size(?:\*\*)?\s*:\s*(?:\*\*)?\s*(XS|S|M|L|XL)\b(?:\*\*)?\s*(?:\||$)/g;
const PLAN_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?Plan(?:\*\*)?\s*:\s*(?:\*\*)?\s*(?:plan-first|(\S+)@([0-9a-f]{7,40}))(?:\*\*)?\s*$/;
const PLAN_FIRST_ONLY_RE = /^\s*plan-first\s*$/;

function isMPlus(size) {
  return typeof size === 'string' && M_PLUS_SIZES.has(size);
}

function parse(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { size: null, plan: null };
  }

  const lines = text.split(/\r?\n/);
  const foundSizes = new Set();

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
    }
  }

  let size = null;
  if (foundSizes.size === 1) {
    size = [...foundSizes][0];
  } else if (foundSizes.size > 1) {
    size = 'conflict';
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

  return { size, plan };
}

module.exports = {
  parse,
  isMPlus,
  SIZES,
  M_PLUS_SIZES,
};
