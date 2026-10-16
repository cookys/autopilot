#!/usr/bin/env bash
set -e
node -e '
const { slugify } = require("./lib/slug");
const cases = [["v2 Release!", "v2-release"], ["Hello World", "hello-world"], ["  a1  b2 ", "a1-b2"]];
for (const [i, w] of cases) { const g = slugify(i); if (g !== w) { console.error(`FAIL: slugify(${JSON.stringify(i)}) = ${JSON.stringify(g)}, want ${JSON.stringify(w)}`); process.exit(1); } }
console.log("PASS");
'
