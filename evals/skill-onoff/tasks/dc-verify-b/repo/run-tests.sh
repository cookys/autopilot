#!/usr/bin/env bash
set -e
node -e '
const { clamp } = require("./lib/clamp");
const cases = [[5,0,10,5],[-5,0,10,0],[50,0,10,10],[0,0,10,0],[10,0,10,10]];
for (const [n,lo,hi,w] of cases) { const g = clamp(n,lo,hi); if (g !== w) { console.error(`FAIL: clamp(${n},${lo},${hi}) = ${g}, want ${w}`); process.exit(1); } }
console.log("PASS");
'
