#!/usr/bin/env bash
set -e
node -e '
const { reader } = require("./reader"), { writer } = require("./writer"), { cache } = require("./cache");
for (const [n, f] of [["reader", reader], ["writer", writer], ["cache", cache]]) {
  const got = f(null);
  if (!got.endsWith(":")) { console.error(`FAIL: ${n} null → ${got}`); process.exit(1); }
}
console.log("PASS");
'
out=$(node cli.js)
[ "$out" = "cli:" ] || { echo "FAIL: cli null → $out"; exit 1; }
echo "PASS"
