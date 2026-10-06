#!/usr/bin/env bash
set -e
node -e "
const q = require('./lib/queue');
const s = require('./lib/scheduler');
q.push({ name: 'a' });
let ran = 0;
s.runOnce(() => { ran++; });
if (ran !== 1) { console.error('FAIL: runOnce'); process.exit(1); }
"
echo "PASS"
