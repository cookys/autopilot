#!/usr/bin/env bash
set -e
node -e '
const { dedupe } = require("./lib/util");
const got = JSON.stringify(dedupe(["b","a","b","c","a"]));
if (got !== JSON.stringify(["b","a","c"])) { console.error(`FAIL: ${got}`); process.exit(1); }
let threw = false;
try { dedupe("nope"); } catch (e) { threw = e instanceof TypeError; }
if (!threw) { console.error("FAIL: non-array must throw TypeError"); process.exit(1); }
console.log("PASS");
'
