#!/usr/bin/env node
'use strict';

/**
 * CLI wrapper for src/engine/verification-strength.js (D7).
 * Usage:
 *   node scripts/verify-strength.js score --signals <json>
 *   node scripts/verify-strength.js calibrate --corpus <json>
 *   node scripts/verify-strength.js density-delta --strength <s> [--calibration <json>]
 */

const path = require('path');
const fs = require('fs');
const {
  scoreSignals,
  evaluateCalibration,
  densityDelta,
  loadCorpus,
  normalizeStrength,
} = require(path.join(__dirname, '..', 'src', 'engine', 'verification-strength'));

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const cmd = process.argv[2];
if (!cmd || cmd === '--help' || cmd === '-h') {
  process.stdout.write(
    'verify-strength.js — real-suite verification strength scorer (D7)\n'
    + '  score --signals <file>\n'
    + '  calibrate --corpus <file>\n'
    + '  density-delta --strength <weak|medium|strong|inconclusive> [--calibration <file>]\n',
  );
  process.exit(0);
}

if (cmd === 'score') {
  const p = arg('--signals');
  const signals = p ? JSON.parse(fs.readFileSync(p, 'utf8')) : JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(`${JSON.stringify(scoreSignals(signals), null, 2)}\n`);
  process.exit(0);
}
if (cmd === 'calibrate') {
  const p = arg('--corpus');
  if (!p) {
    process.stderr.write('--corpus required\n');
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(evaluateCalibration(loadCorpus(p)), null, 2)}\n`);
  process.exit(0);
}
if (cmd === 'density-delta') {
  const s = normalizeStrength(arg('--strength') || 'weak');
  const calPath = arg('--calibration');
  const cal = calPath
    ? JSON.parse(fs.readFileSync(calPath, 'utf8'))
    : { allow_strong_reduction: false };
  process.stdout.write(`${JSON.stringify(densityDelta(s, cal), null, 2)}\n`);
  process.exit(0);
}
process.stderr.write(`unknown command: ${cmd}\n`);
process.exit(2);
