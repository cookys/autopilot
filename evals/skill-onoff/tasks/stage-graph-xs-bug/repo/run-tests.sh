#!/usr/bin/env bash
set -e
node -e "
const { parseCount } = require('./lib/count');
const eq = (a, b, m) => { if (a !== b) { console.error('FAIL: ' + m + ' got ' + a); process.exit(1); } };
eq(parseCount('12'), 12, 'plain');
eq(parseCount(''), 0, 'empty string is zero');
"
echo "PASS"
