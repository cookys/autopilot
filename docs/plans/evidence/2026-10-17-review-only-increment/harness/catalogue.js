'use strict';
// Fixture catalogue for the BL-0146 D5 experiment. Each module has a contract (published in spec.md),
// a v0 body (the base-commit placeholder), a good body, and optionally a bad body that differs from the
// good one on exactly ONE line (the planted defect). Contracts are objective so a defect is checkable.
const M = (name, fn, params, contract, v0, good, bad) => ({ name, fn, params, contract, v0, good, bad });

const MODULES = [
  M('clamp', 'clampQty', 'n', 'clampQty(n) returns n truncated to an integer and limited to the range 1..99 inclusive.',
    '  return n;',
    '  const q = Math.trunc(n);\n  return Math.min(99, Math.max(1, q));',
    '  const q = Math.trunc(n);\n  return Math.min(98, Math.max(1, q));'),
  M('bulk', 'bulkCents', 'qty, unitCents', 'bulkCents(qty, unitCents) returns the line total in integer cents; when qty is 10 or more the whole line is 10 percent cheaper (Math.round).',
    '  return qty * unitCents;',
    '  const gross = qty * unitCents;\n  return qty >= 10 ? Math.round(gross * 0.9) : gross;',
    '  const gross = qty * unitCents;\n  return qty > 10 ? Math.round(gross * 0.9) : gross;'),
  M('coupon', 'couponCents', 'subtotal, pct', 'couponCents(subtotal, pct) returns the discount in integer cents: Math.round(subtotal * pct / 100), where pct is limited to 0..100.',
    '  return 0;',
    '  const p = Math.min(100, Math.max(0, pct));\n  return Math.round((subtotal * p) / 100);',
    '  const p = Math.min(100, Math.max(0, pct));\n  return Math.round((subtotal * p) / 1000);'),
  M('tax', 'taxCents', 'amount, rateBp', 'taxCents(amount, rateBp) returns the tax in integer cents for a rate in basis points: Math.round(amount * rateBp / 10000).',
    '  return 0;',
    '  return Math.round((amount * rateBp) / 10000);',
    '  return Math.round((amount * rateBp) / 1000);'),
  M('ship', 'shippingCents', 'weightG', 'shippingCents(weightG) returns 0 for weight 0; otherwise 500 cents for up to 1000 g plus 100 cents for each started additional 500 g.',
    '  return 0;',
    '  if (weightG <= 0) return 0;\n  const extra = Math.max(0, weightG - 1000);\n  return 500 + Math.ceil(extra / 500) * 100;',
    '  if (weightG <= 0) return 0;\n  const extra = Math.max(0, weightG - 1000);\n  return 500 + Math.floor(extra / 500) * 100;'),
  M('loyalty', 'pointsFor', 'cents', 'pointsFor(cents) returns loyalty points: one point per full 100 cents spent (round down), never negative.',
    '  return 0;',
    '  return Math.max(0, Math.floor(cents / 100));',
    '  return Math.max(0, Math.round(cents / 100));'),
  M('refund', 'refundCents', 'paidCents', 'refundCents(paidCents) returns the paid amount minus a restocking fee of 5 percent (Math.round) but at least 100 cents; never below 0.',
    '  return paidCents;',
    '  const fee = Math.max(100, Math.round(paidCents * 0.05));\n  return Math.max(0, paidCents - fee);',
    '  const fee = Math.min(100, Math.round(paidCents * 0.05));\n  return Math.max(0, paidCents - fee);'),
  M('fee', 'cardFeeCents', 'amount', 'cardFeeCents(amount) returns the card fee: 2.9 percent of the amount (Math.round) plus a fixed 30 cents.',
    '  return 0;',
    '  return Math.round(amount * 0.029) + 30;',
    '  return Math.round(amount * 0.029) + 3;'),
  M('split', 'splitCents', 'total, n', 'splitCents(total, n) returns an array of n integer shares that sum exactly to total; the remainder cents go one each to the first shares.',
    '  return [total];',
    '  const base = Math.floor(total / n);\n  const rem = total - base * n;\n  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));',
    '  const base = Math.floor(total / n);\n  const rem = total - base * n;\n  return Array.from({ length: n }, (_, i) => base + (i <= rem ? 1 : 0));'),
  M('cap', 'capDiscount', 'discount, subtotal', 'capDiscount(discount, subtotal) returns the discount limited to at most 50 percent of the subtotal (integer cents, round down).',
    '  return discount;',
    '  return Math.min(discount, Math.floor(subtotal / 2));',
    '  return Math.min(discount, Math.ceil(subtotal / 2) + 1);'),
  M('minorder', 'meetsMinimum', 'cents', 'meetsMinimum(cents) is true when the order is at least 1000 cents.',
    '  return true;',
    '  return cents >= 1000;',
    '  return cents > 1000;'),
  M('vatid', 'isVatId', 's', 'isVatId(s) is true for two capital letters followed by 8 to 12 digits and nothing else.',
    '  return true;',
    '  return /^[A-Z]{2}[0-9]{8,12}$/.test(s);',
    '  return /^[A-Z]{2}[0-9]{8,12}/.test(s);'),
  M('sku', 'normalizeSku', 's', 'normalizeSku(s) trims the string, upper-cases it and replaces each run of spaces with a single hyphen.',
    '  return s;',
    '  return s.trim().toUpperCase().replace(/ +/g, \'-\');',
    '  return s.trim().toUpperCase().replace(/ /g, \'-\');'),
  M('email', 'isEmail', 's', 'isEmail(s) is true when s has exactly one @ with a non-empty local part and a domain containing a dot that is not its first or last character.',
    '  return true;',
    '  const parts = s.split(\'@\');\n  if (parts.length !== 2 || parts[0] === \'\') return false;\n  const d = parts[1];\n  return d.includes(\'.\') && !d.startsWith(\'.\') && !d.endsWith(\'.\');',
    '  const parts = s.split(\'@\');\n  if (parts.length !== 2 || parts[0] === \'\') return false;\n  const d = parts[1];\n  return d.includes(\'.\') && !d.startsWith(\'.\');'),
  M('slug', 'slugify', 's', 'slugify(s) lower-cases s, replaces each run of non-alphanumeric characters with one hyphen and strips leading and trailing hyphens.',
    '  return s;',
    '  return s.toLowerCase().replace(/[^a-z0-9]+/g, \'-\').replace(/^-+|-+$/g, \'\');',
    '  return s.toLowerCase().replace(/[^a-z0-9]+/g, \'-\').replace(/^-+/, \'\');'),
  M('pad', 'zeroPad', 'n, width', 'zeroPad(n, width) returns the non-negative integer n as a string left-padded with zeros to at least width characters.',
    '  return String(n);',
    '  return String(n).padStart(width, \'0\');',
    '  return String(n).padEnd(width, \'0\');'),
  M('dates', 'addDays', 'iso, days', 'addDays(iso, days) takes a YYYY-MM-DD date and returns the YYYY-MM-DD date days later (UTC, month and year overflow handled).',
    '  return iso;',
    '  const d = new Date(`${iso}T00:00:00Z`);\n  d.setUTCDate(d.getUTCDate() + days);\n  return d.toISOString().slice(0, 10);',
    '  const d = new Date(`${iso}T00:00:00Z`);\n  d.setUTCDate(d.getUTCDate() + days - 1);\n  return d.toISOString().slice(0, 10);'),
  M('range', 'inclusiveRange', 'a, b', 'inclusiveRange(a, b) returns the integers from a to b inclusive in ascending order; an empty array when a > b.',
    '  return [];',
    '  const out = [];\n  for (let i = a; i <= b; i += 1) out.push(i);\n  return out;',
    '  const out = [];\n  for (let i = a; i < b; i += 1) out.push(i);\n  return out;'),
  M('uniq', 'uniqueStable', 'xs', 'uniqueStable(xs) returns xs without duplicates, keeping the first occurrence of each value and the original order.',
    '  return xs;',
    '  const seen = new Set();\n  return xs.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));',
    '  const seen = new Set();\n  return xs.filter((x) => (seen.has(x) ? false : (seen.add(x), true))).reverse();'),
  M('sum', 'sumInts', 'xs', 'sumInts(xs) returns the sum of an array of integers; 0 for an empty array.',
    '  return 0;',
    '  return xs.reduce((a, b) => a + b, 0);',
    '  return xs.reduce((a, b) => a + b);'),
  M('avg', 'avgRounded', 'xs', 'avgRounded(xs) returns the mean of xs rounded half up (Math.round); 0 for an empty array.',
    '  return 0;',
    '  if (xs.length === 0) return 0;\n  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);',
    '  if (xs.length === 0) return 0;\n  return Math.floor(xs.reduce((a, b) => a + b, 0) / xs.length);'),
  M('median', 'medianOf', 'xs', 'medianOf(xs) returns the median of a non-empty array; for an even count it is the mean of the two middle values rounded down.',
    '  return xs[0];',
    '  const s = [...xs].sort((a, b) => a - b);\n  const m = Math.floor(s.length / 2);\n  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2);',
    '  const s = [...xs].sort((a, b) => a - b);\n  const m = Math.floor(s.length / 2);\n  return s.length % 2 ? s[m] : Math.floor((s[m] + s[m + 1]) / 2);'),
  M('pct', 'pctChange', 'from, to', 'pctChange(from, to) returns the percent change from -> to rounded to one decimal place; 0 when from is 0.',
    '  return 0;',
    '  if (from === 0) return 0;\n  return Math.round(((to - from) / from) * 1000) / 10;',
    '  if (from === 0) return 0;\n  return Math.round(((to - from) / to) * 1000) / 10;'),
  M('chunk', 'chunkArray', 'xs, n', 'chunkArray(xs, n) splits xs into consecutive arrays of length n; the last one may be shorter.',
    '  return [xs];',
    '  const out = [];\n  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));\n  return out;',
    '  const out = [];\n  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n - 1));\n  return out;'),
];

const BY_NAME = Object.fromEntries(MODULES.map((m) => [m.name, m]));

function moduleSource(m, variant) {
  const body = variant === 'bad' && m.bad ? m.bad : (variant === 'v0' ? m.v0 : m.good);
  return `'use strict';\n// ${m.contract}\nfunction ${m.fn}(${m.params}) {\n${body}\n}\nmodule.exports = { ${m.fn} };\n`;
}

// Cross-file modules. checkout composes coupon, tax and shipping; invoice formats with tax.
const CHECKOUT_SPEC = 'checkoutTotal(subtotal, pct, rateBp, weightG) returns subtotal minus couponCents(subtotal, pct), plus taxCents of that discounted amount, plus shippingCents(weightG).';
const INVOICE_SPEC = 'invoiceLine(label, amount, rateBp) returns "label: amount+tax" where tax is taxCents(amount, rateBp), both in integer cents.';

function checkoutSource(taxModule, couponMode) {
  const disc = couponMode === 'remaining'
    ? '  const discounted = couponCents(subtotal, pct);'
    : '  const discounted = subtotal - couponCents(subtotal, pct);';
  return `'use strict';\n// ${CHECKOUT_SPEC}\nconst { couponCents } = require('./coupon');\nconst { ${taxModule === 'vat' ? 'vatCents' : 'taxCents'} } = require('./${taxModule}');\nconst { shippingCents } = require('./ship');\nfunction checkoutTotal(subtotal, pct, rateBp, weightG) {\n${disc}\n  return discounted + ${taxModule === 'vat' ? 'vatCents' : 'taxCents'}(discounted, rateBp) + shippingCents(weightG);\n}\nmodule.exports = { checkoutTotal };\n`;
}
function invoiceSource() {
  return `'use strict';\n// ${INVOICE_SPEC}\nconst { taxCents } = require('./tax');\nfunction invoiceLine(label, amount, rateBp) {\n  return \`\${label}: \${amount + taxCents(amount, rateBp)}\`;\n}\nmodule.exports = { invoiceLine };\n`;
}

module.exports = { MODULES, BY_NAME, moduleSource, checkoutSource, invoiceSource, CHECKOUT_SPEC, INVOICE_SPEC };
