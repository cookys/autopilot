#!/usr/bin/env bash
set -e
node -e "
const { importText } = require('./lib/importer');
const r = importText('a\nb\n', 'lines');
if (r.length !== 2) { console.error('FAIL: lines'); process.exit(1); }
"
echo "PASS"
