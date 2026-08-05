'use strict';

/**
 * verification-strength.js — deterministic real-suite strength scorer (D7 A13).
 *
 * Ordinal: weak | medium | strong | inconclusive
 * Fail-safe: unknown/missing/invalid evidence → weak (most review).
 *
 * Signals (additive, documented):
 *   - red_green: VALIDATED | NOT_RED_ON_BASE | NOT_GREEN_ON_HEAD | INCONCLUSIVE
 *   - assertion_density: assertions per changed production line (0..∞)
 *   - changed_line_coverage: 0..1 fraction of changed lines covered
 *   - mutation_survival: 0..1 (1 = all mutants killed)
 *   - oracle_present: boolean
 *
 * Calibration gate for "strong reduces review by at most one loop":
 *   held-out corpus ≥ 60 known-outcome cases, zero escaped defects labelled strong,
 *   one-sided 95% Wilson upper escape bound ≤ 5%.
 */

const fs = require('fs');
const path = require('path');

const ORDINAL = new Set(['weak', 'medium', 'strong', 'inconclusive']);

function wilsonUpper(successes, n, z = 1.6448536269514722) {
  if (n <= 0) return 1;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre + margin) / denom;
}

function scoreSignals(signals = {}) {
  if (!signals || typeof signals !== 'object') {
    return { strength: 'weak', reason: 'missing signals', score: 0 };
  }

  const redGreen = signals.red_green || signals.redGreen || 'INCONCLUSIVE';
  if (redGreen === 'INCONCLUSIVE' || redGreen === 'NOT_RED_ON_BASE' || redGreen === 'NOT_GREEN_ON_HEAD') {
    if (redGreen !== 'VALIDATED' && !signals.force_score) {
      return {
        strength: redGreen === 'INCONCLUSIVE' ? 'inconclusive' : 'weak',
        reason: `red_green=${redGreen}`,
        score: 0,
      };
    }
  }

  let score = 0;
  if (redGreen === 'VALIDATED') score += 2;

  const density = Number(signals.assertion_density ?? signals.assertionDensity ?? 0);
  if (Number.isFinite(density)) {
    if (density >= 0.5) score += 2;
    else if (density >= 0.2) score += 1;
  }

  const coverage = Number(signals.changed_line_coverage ?? signals.changedLineCoverage ?? 0);
  if (Number.isFinite(coverage)) {
    if (coverage >= 0.8) score += 2;
    else if (coverage >= 0.5) score += 1;
  }

  const mutation = Number(signals.mutation_survival ?? signals.mutationSurvival ?? 0);
  if (Number.isFinite(mutation)) {
    if (mutation >= 0.8) score += 2;
    else if (mutation >= 0.5) score += 1;
  }

  if (signals.oracle_present === true || signals.oraclePresent === true) score += 1;

  let strength = 'weak';
  if (score >= 7) strength = 'strong';
  else if (score >= 4) strength = 'medium';
  else strength = 'weak';

  return { strength, reason: 'scored', score };
}

function evaluateCalibration(corpus) {
  if (!Array.isArray(corpus) || corpus.length < 60) {
    return {
      allow_strong_reduction: false,
      reason: `corpus size ${Array.isArray(corpus) ? corpus.length : 0} < 60`,
      n: Array.isArray(corpus) ? corpus.length : 0,
      strong_escapes: 0,
      wilson_upper: 1,
    };
  }
  let strong = 0;
  let strongEscapes = 0;
  for (const row of corpus) {
    const s = row.strength || row.predicted_strength;
    const escaped = row.escaped === true || row.escape === true || row.outcome === 'escape';
    if (s === 'strong') {
      strong += 1;
      if (escaped) strongEscapes += 1;
    }
  }
  if (strongEscapes > 0) {
    return {
      allow_strong_reduction: false,
      reason: `strong-labelled escapes=${strongEscapes}`,
      n: corpus.length,
      strong_escapes: strongEscapes,
      wilson_upper: 1,
    };
  }
  // Escape rate among strong predictions (0 escapes); Wilson upper on 0/strong.
  const upper = wilsonUpper(0, Math.max(strong, 1));
  const allow = upper <= 0.05 && strong >= 1;
  return {
    allow_strong_reduction: allow,
    reason: allow ? 'calibration gate passed' : `wilson_upper=${upper.toFixed(4)} or no strong samples`,
    n: corpus.length,
    strong_escapes: strongEscapes,
    strong_n: strong,
    wilson_upper: upper,
  };
}

function loadCorpus(corpusPath) {
  const raw = fs.readFileSync(corpusPath, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.cases)) return data.cases;
  return [];
}

function normalizeStrength(value) {
  if (value == null || value === '') return 'weak';
  const v = String(value).toLowerCase();
  if (ORDINAL.has(v)) return v === 'inconclusive' ? 'weak' : v; // inconclusive routes as weak for density
  return 'weak';
}

/**
 * Fold verify_strength into review density delta.
 * Returns { delta_loops, effective_strength, allow_reduction }.
 * delta_loops: positive ⇒ more review, negative ⇒ less (capped at -1).
 */
function densityDelta(strength, calibration = { allow_strong_reduction: false }) {
  const s = normalizeStrength(strength);
  if (s === 'weak') return { delta_loops: 1, effective_strength: 'weak', allow_reduction: false };
  if (s === 'medium') return { delta_loops: 0, effective_strength: 'medium', allow_reduction: false };
  if (s === 'strong') {
    if (calibration && calibration.allow_strong_reduction === true) {
      return { delta_loops: -1, effective_strength: 'strong', allow_reduction: true };
    }
    return { delta_loops: 0, effective_strength: 'strong', allow_reduction: false };
  }
  return { delta_loops: 1, effective_strength: 'weak', allow_reduction: false };
}

function main(argv) {
  const args = argv.slice(2);
  if (args[0] === 'score') {
    const signals = args[1] ? JSON.parse(fs.readFileSync(args[1], 'utf8')) : JSON.parse(fs.readFileSync(0, 'utf8'));
    process.stdout.write(`${JSON.stringify(scoreSignals(signals))}\n`);
    return;
  }
  if (args[0] === 'calibrate') {
    const corpusPath = args[1];
    const corpus = loadCorpus(corpusPath);
    process.stdout.write(`${JSON.stringify(evaluateCalibration(corpus))}\n`);
    return;
  }
  if (args[0] === 'density-delta') {
    const strength = args[1] || 'weak';
    const cal = args[2] ? JSON.parse(fs.readFileSync(args[2], 'utf8')) : { allow_strong_reduction: false };
    process.stdout.write(`${JSON.stringify(densityDelta(strength, cal))}\n`);
    return;
  }
  process.stderr.write('usage: verification-strength.js score|calibrate|density-delta ...\n');
  process.exit(2);
}

if (require.main === module) main(process.argv);

module.exports = {
  ORDINAL,
  scoreSignals,
  evaluateCalibration,
  densityDelta,
  normalizeStrength,
  loadCorpus,
  wilsonUpper,
};
