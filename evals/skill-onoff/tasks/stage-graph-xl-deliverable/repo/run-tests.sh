#!/usr/bin/env bash
set -e
node -e "
const r = require('./lib/records');
if (r.all().length !== 3) { console.error('FAIL: records'); process.exit(1); }
"
echo "PASS"
