#!/usr/bin/env bash
set -e
node -e '
const { parseQuery } = require("./lib/query");
const got = JSON.stringify(parseQuery("a=1&=x&b=2"));
const want = JSON.stringify([["a","1"],["","x"],["b","2"]]);
if (got !== want) { console.error(`FAIL: ${got} !== ${want}`); process.exit(1); }
console.log("PASS");
'
