'use strict';
// Test driver for scripts/lib/record-files.js: node record-files-driver.js <repo> <function> <input-json> [<opts-json>]
// Pins the clock to 2026-11-09 and prints one JSON line: {ok:true,result} or {ok:false,name,rule,message,violations}.
const rf = require('../../../scripts/lib/record-files.js');

const [repo, fn, inputJson, optsJson] = process.argv.slice(2);
const opts = Object.assign({ clock: () => new Date('2026-11-09T12:00:00Z') }, optsJson ? JSON.parse(optsJson) : {});
try {
  const result = rf[fn](repo, JSON.parse(inputJson), opts);
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
} catch (e) {
  process.stdout.write(`${JSON.stringify({ ok: false, name: e.name, rule: e.rule || null, exitCode: e.exitCode, message: e.message, violations: e.violations || null })}\n`);
}
