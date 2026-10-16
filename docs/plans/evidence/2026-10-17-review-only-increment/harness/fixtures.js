'use strict';
// Scenario fixtures for the BL-0146 D5 experiment: for each scenario the three file maps (base B,
// reviewed head H0, returned head H1), the spec text and the ground truth (planted defects).
const { BY_NAME, MODULES, moduleSource, checkoutSource, invoiceSource, CHECKOUT_SPEC, INVOICE_SPEC } = require('./catalogue');

const CHECKOUT_V0 = "'use strict';\nfunction checkoutTotal() { return 0; }\nmodule.exports = { checkoutTotal };\n";
const INVOICE_V0 = "'use strict';\nfunction invoiceLine() { return ''; }\nmodule.exports = { invoiceLine };\n";
const CHECKOUT_SPEC_FULL = 'checkoutTotal(subtotal, pct, rateBp, weightG): the discount is Math.round(subtotal * p / 100) with p = pct limited to 0..100; the taxable amount is subtotal minus that discount; the result is the taxable amount plus tax on it (Math.round(amount * rateBp / 10000)) plus shipping (0 for weight 0, else 500 cents for up to 1000 g plus 100 cents per started additional 500 g).';

const CHECK_JS = "'use strict';\n// syntax-checks every module under src/ (the sealed verification command)\nconst fs = require('fs');\nconst { execFileSync } = require('child_process');\nfor (const n of fs.readdirSync('src')) execFileSync(process.execPath, ['--check', `src/${n}`], { stdio: 'inherit' });\n";
const src = (name, variant) => moduleSource(BY_NAME[name], variant);
const f = (name) => `src/${name}.js`;

function baseMap(names) {
  const m = { 'src/checkout.js': CHECKOUT_V0, 'src/invoice.js': INVOICE_V0, 'check.js': CHECK_JS, '.gitignore': '.claude/\n' };
  for (const n of names) m[f(n)] = src(n, 'v0');
  return m;
}
// H0 map: given names -> variant ('good'|'bad')
function headMap(names, variants, taxModule = 'tax') {
  const m = baseMap(names);
  for (const n of names) m[f(n)] = src(n, variants[n] || 'good');
  m['src/checkout.js'] = checkoutSource(taxModule, 'discount').replace(CHECKOUT_SPEC, CHECKOUT_SPEC_FULL);
  m['src/invoice.js'] = invoiceSource();
  return m;
}
const lineOf = (text, needle) => {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`needle not found: ${needle}`);
  return i + 1;
};
// the planted line of a module: the first line where good and bad differ
const plantedLine = (name) => {
  const g = src(name, 'good').split('\n');
  const b = src(name, 'bad').split('\n');
  return g.findIndex((l, i) => l !== b[i]) + 1;
};
const KW = {
  coupon: /coupon|discount|1000|pct|percent/i, bulk: /bulk|qty|>=|10/i, tax: /tax|1000|basis|rate/i, ship: /ship|ceil|floor|started|500/i,
  clamp: /clamp|98|99/i, loyalty: /loyal|point|round|floor/i, refund: /refund|fee|restock|min|max/i, fee: /fee|card|30|\b3\b/i,
  split: /split|<=|remainder|share/i, cap: /cap|ceil|floor|50/i, minorder: /minimum|1000|>=|>\s*1000/i,
};
const old = (id, name, fixed) => ({ id, kind: fixed ? 'old_fixed' : 'old_unfixed', path: f(name), line: plantedLine(name), keyword: KW[name] });

function buildSpec(names, extra) {
  const lines = names.filter((n) => !(extra && extra.omit && extra.omit.includes(n))).map((n) => `- ${BY_NAME[n].contract}`);
  return [
    '# Order pricing library: review specification',
    '',
    'The change under review implements the pricing helpers below (all amounts are integer cents).',
    'Judge the code against these contracts. A defect is a place where the code deviates from a contract,',
    'crashes, or leaves a module unusable by the other modules that require it.',
    '',
    '## Contracts',
    ...lines,
    `- ${CHECKOUT_SPEC_FULL}`,
    `- ${INVOICE_SPEC}`,
    '',
  ].join('\n');
}

const SEVEN = ['clamp', 'bulk', 'coupon', 'tax', 'ship', 'fee', 'split'];

const SCENARIOS = {
  // 1 single-file fix: coupon fixed; bulk stays wrong (an old finding on a file the author did not touch)
  s1: () => {
    const names = SEVEN;
    const h0 = headMap(names, { coupon: 'bad', bulk: 'bad' });
    const h1 = { ...h0, [f('coupon')]: src('coupon', 'good') };
    return { names, base: baseMap(names), h0, h1, spec: buildSpec(names), truth: {
      h0: [old('O1', 'coupon'), old('O3', 'bulk')],
      h1: [old('O1', 'coupon', true), old('O3', 'bulk', false)],
    } };
  },
  // 2 ten-file fix: 26-file range, 11 defects, 10 fixed, one (minorder) left
  s2: () => {
    const names = MODULES.map((m) => m.name);
    const badOnes = ['coupon', 'tax', 'ship', 'bulk', 'clamp', 'loyalty', 'refund', 'fee', 'split', 'cap', 'minorder'];
    const variants = Object.fromEntries(badOnes.map((n) => [n, 'bad']));
    const h0 = headMap(names, variants);
    const h1 = { ...h0 };
    const fixed = badOnes.filter((n) => n !== 'minorder');
    for (const n of fixed) h1[f(n)] = src(n, 'good');
    return { names, base: baseMap(names), h0, h1, spec: buildSpec(names), truth: {
      h0: badOnes.map((n, i) => old(`O${i + 1}`, n)),
      h1: badOnes.map((n, i) => old(`O${i + 1}`, n, fixed.includes(n))),
    } };
  },
  // 3 cross-file regression: coupon is fixed, and rewritten to return the discounted subtotal;
  // unchanged checkout.js still subtracts it (double discount). coupon has no contract line of its own.
  s3: () => {
    const names = SEVEN;
    const h0 = headMap(names, { coupon: 'bad' });
    const couponH1 = "'use strict';\n// couponCents(subtotal, pct) returns the subtotal left after the percentage discount, in integer cents.\nfunction couponCents(subtotal, pct) {\n  const p = Math.min(100, Math.max(0, pct));\n  return subtotal - Math.round((subtotal * p) / 100);\n}\nmodule.exports = { couponCents };\n";
    const h1 = { ...h0, [f('coupon')]: couponH1 };
    const checkoutLine = lineOf(h1['src/checkout.js'], 'const discounted');
    return { names, base: baseMap(names), h0, h1, spec: buildSpec(names, { omit: ['coupon'] }), truth: {
      h0: [old('O1', 'coupon')],
      h1: [
        { id: 'O1', kind: 'old_fixed', path: f('coupon'), line: plantedLine('coupon'), keyword: KW.coupon },
        { id: 'R1', kind: 'regression', path: 'src/checkout.js', line: checkoutLine, alt_paths: [{ path: f('coupon'), line: lineOf(couponH1, 'return subtotal') }], keyword: /discount|subtotal|double|twice|remaining|couponCents/i },
      ],
    } };
  },
  // 4 rename: tax.js -> vat.js (function renamed), checkout updated, invoice.js still requires ./tax
  s4: () => {
    const names = SEVEN;
    const h0 = headMap(names, { tax: 'bad' });
    const vatSrc = src('tax', 'good').replace(/taxCents/g, 'vatCents').replace('returns the tax', 'returns the VAT');
    const h1 = { ...h0 };
    delete h1[f('tax')];
    h1[f('vat')] = vatSrc;
    h1['src/checkout.js'] = checkoutSource('vat', 'discount').replace(CHECKOUT_SPEC, CHECKOUT_SPEC_FULL);
    const invLine = lineOf(h1['src/invoice.js'], "require('./tax')");
    return { names, base: baseMap(names), h0, h1, spec: buildSpec(names), renames: [[f('tax'), f('vat')]], truth: {
      h0: [old('O1', 'tax')],
      h1: [
        { id: 'O1', kind: 'old_fixed', path: f('tax'), line: plantedLine('tax'), alt_paths: [{ path: f('vat'), line: 4 }], keyword: KW.tax },
        { id: 'R1', kind: 'regression', path: 'src/invoice.js', line: invLine, keyword: /tax|require|module|missing|vat|not found|cannot find|stale|rename/i },
      ],
    } };
  },
  // 5 R2 anchoring: coupon and ship old defects fixed, each fix lands next to a NEW defect
  s5: () => {
    const names = SEVEN;
    const h0 = headMap(names, { coupon: 'bad', ship: 'bad' });
    const couponH1 = src('coupon', 'good').replace('Math.max(0, pct)', 'Math.max(1, pct)');
    const shipH1 = src('ship', 'good').replace('if (weightG <= 0) return 0;', 'if (weightG < 0) return 0;');
    const h1 = { ...h0, [f('coupon')]: couponH1, [f('ship')]: shipH1 };
    return { names, base: baseMap(names), h0, h1, spec: buildSpec(names), truth: {
      h0: [old('O1', 'coupon'), old('O2', 'ship')],
      h1: [
        old('O1', 'coupon', true), old('O2', 'ship', true),
        { id: 'N1', kind: 'new_next_to_old', path: f('coupon'), line: lineOf(couponH1, 'Math.max(1, pct)'), keyword: /clamp|0|zero|min|max|1/i },
        { id: 'N2', kind: 'new_next_to_old', path: f('ship'), line: lineOf(shipH1, 'weightG < 0'), keyword: /zero|0|weight|<\s*0|<=/i },
      ],
    } };
  },
};

module.exports = { SCENARIOS };
