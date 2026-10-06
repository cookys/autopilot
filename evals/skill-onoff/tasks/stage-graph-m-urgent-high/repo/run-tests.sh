#!/usr/bin/env bash
set -e
node -e "
const s = require('./src/auth/session');
const a = s.create('ann', 0);
if (!s.get(a.id, 1000)) { console.error('FAIL: fresh session valid'); process.exit(1); }
if (s.get(a.id, s.TTL_MS + 1)) { console.error('FAIL: old session expires'); process.exit(1); }
"
echo "PASS"
