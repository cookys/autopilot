#!/usr/bin/env bash
set -e
node -e "
const { invoiceTotal } = require('./lib/report');
const { lineTotal } = require('./lib/pricing');
const eq = (a, b, m) => { if (a !== b) { console.error('FAIL: ' + m + ' got ' + a + ' want ' + b); process.exit(1); } };
eq(lineTotal({ price: 5, qty: 2 }), 10, 'plain line');
eq(invoiceTotal([{ price: 5, qty: 2 }]), 10, 'plain invoice');
eq(invoiceTotal([{ price: 19.99, qty: 3, discountPct: 10 }]), 53.97, 'discounted invoice');
"
echo "PASS"
