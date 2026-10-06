#!/usr/bin/env bash
set -e
node -e "
const { runAll } = require('./lib/runner');
const r = runAll();
if (r.length !== 1 || r[0] !== 'report: done') { console.error('FAIL: runAll'); process.exit(1); }
"
echo "PASS"
