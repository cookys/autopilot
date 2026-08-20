'use strict';
// Host-side oracle for Task A. Authored BEFORE any dispatch (2026-08-17) and
// never shown to the candidate engine. Usage:
//   node oracle-semver.js /path/to/produced/semver-compare.js
const path = process.argv[2];
if (!path) { console.error('usage: node oracle-semver.js <module>'); process.exit(2); }
const { compareSemver } = require(require('node:path').resolve(path));

const vectors = [
  ['1.2.3', '1.2.3', 0],
  ['1.2.3', '1.2.4', -1],
  ['2.0.0', '1.99.99', 1],
  ['01.2.3', '1.2.3', 0],
  ['1.10.0', '1.9.0', 1],
  ['0.0.0', '0.0.1', -1],
  ['10.0.0', '9.9.9', 1],
];
const invalid = ['1.2', '1.2.3.4', 'a.b.c', '1.2.-3', '', 'v1.2.3', '1.2.3-rc1', 5, null];

let failures = 0;
for (const [a, b, want] of vectors) {
  let got;
  try { got = compareSemver(a, b); } catch (e) { got = `threw ${e.name}`; }
  if (got !== want) { failures += 1; console.error(`FAIL compare(${a},${b}) want ${want} got ${got}`); }
}
for (const bad of invalid) {
  let ok = false;
  try { compareSemver(bad, '1.2.3'); } catch (e) { ok = e instanceof TypeError; }
  if (!ok) { failures += 1; console.error(`FAIL compare(${JSON.stringify(bad)},"1.2.3") did not throw TypeError`); }
}
if (failures === 0) { console.log('ORACLE PASS (7 compare + 8 invalid vectors)'); process.exit(0); }
console.error(`ORACLE FAIL: ${failures} vector(s)`); process.exit(1);
