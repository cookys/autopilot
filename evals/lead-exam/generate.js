#!/usr/bin/env node
'use strict';
// lead-exam generator: round N prompt = system prompt + rounds 1..N-1 (messages plus this examinee's own
// earlier outputs) + round N messages. Names, card ids and shas come from --seed; structure is fixed.
// The same seed gives byte-identical output.
//
//   node evals/lead-exam/generate.js --seed S --round N [--outputs outputs.json]
//   outputs.json: JSON array of the examinee's outputs for rounds 1..N-1 (strings)
const fs = require('fs');
const lib = require('./lib');

function main() {
  const argv = process.argv.slice(2);
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (['--seed', '--round', '--outputs'].includes(argv[i]) && argv[i + 1] !== undefined) { a[argv[i].slice(2)] = argv[i + 1]; i += 1; }
    else { process.stderr.write(`generate: unknown or incomplete argument ${argv[i]}\n`); process.exit(2); }
  }
  const round = Number(a.round);
  if (!a.seed || !Number.isInteger(round) || round < 1 || round > 6) { process.stderr.write('generate: --seed and --round 1..6 are required\n'); process.exit(2); }
  const prior = a.outputs ? JSON.parse(fs.readFileSync(a.outputs, 'utf8')) : [];
  process.stdout.write(`${lib.buildPrompt(lib.loadItems(), a.seed, round, prior)}\n`);
}

if (require.main === module) main();
