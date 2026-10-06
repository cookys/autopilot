#!/usr/bin/env bash
set -e
node -e "
const n = require('./lib/notes');
n.add('a'); n.add('b');
if (n.list().length !== 2) { console.error('FAIL: add/list'); process.exit(1); }
if (!n.remove(1) || n.list().length !== 1) { console.error('FAIL: remove'); process.exit(1); }
"
echo "PASS"
