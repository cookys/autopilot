#!/usr/bin/env node
/**
 * check-loop-convergence.js — deterministic review-loop convergence gate.
 *
 * Usage:
 *   node scripts/check-loop-convergence.js --artifacts-dir <dir> [--generation-cap N] [--json] [--enforce]
 *   node scripts/check-loop-convergence.js <file1.json> <file2.json> ...
 */

const fs = require('fs');
const path = require('path');

const HELP_TEXT = `Usage:
  node scripts/check-loop-convergence.js --artifacts-dir <dir> [--generation-cap N] [--json] [--enforce]
  node scripts/check-loop-convergence.js <file1.json> <file2.json> ...
  -h, --help                     Show this message.`;

function printUsage() {
  console.log(HELP_TEXT);
}

function usageError(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseGeneration(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 1;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function parseGenerationCap(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function isZeroExecution(artifact) {
  return !artifact || artifact.tests_executed !== true;
}

function hasReworkShapeVerdict(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return true;
  }

  for (const key of Object.keys(artifact)) {
    if (!key.toLowerCase().includes('verdict')) continue;
    const value = artifact[key];
    if (typeof value === 'string' && /(FAIL|REJECT|REWORK)/i.test(value)) {
      return true;
    }
  }

  return artifact.ship_ready !== true;
}

function collectArtifactPathsFromDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    usageError(`cannot read artifact directory: ${err.message}`);
  }

  const jsonFiles = entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));

  return jsonFiles;
}

function loadArtifact(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    usageError(`cannot read artifact ${filePath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    usageError(`failed to parse artifact ${filePath}: ${err.message}`);
  }

  const generation = parseGeneration(parsed && parsed.artifact_generation);
  return {
    path: filePath,
    artifact: parsed,
    generation,
    _inputIndex: 0,
  };
}

function sortArtifactsByGeneration(stable) {
  return stable.slice().sort((a, b) => {
    if (a.generation !== b.generation) return a.generation - b.generation;
    return a._inputIndex - b._inputIndex;
  });
}

function runGate1(orderedArtifacts) {
  let streak = [];
  let result = {
    tripped: false,
    streak_generations: [],
  };

  for (const item of orderedArtifacts) {
    if (isZeroExecution(item.artifact)) {
      streak.push(item.generation);
      if (streak.length >= 2 && !result.tripped) {
        result.tripped = true;
        result.streak_generations = streak.slice();
        break;
      }
      continue;
    }

    streak = [];
  }

  return result;
}

function runGate3(orderedArtifacts, cap) {
  let maxGeneration = orderedArtifacts.reduce((currentMax, item) => {
    return item.generation > currentMax ? item.generation : currentMax;
  }, Number.NEGATIVE_INFINITY);

  let latest;
  for (let i = orderedArtifacts.length - 1; i >= 0; i--) {
    if (orderedArtifacts[i].generation === maxGeneration) {
      latest = orderedArtifacts[i];
      break;
    }
  }

  const latestReworkShape = hasReworkShapeVerdict(latest?.artifact);
  const tripped = maxGeneration >= cap && latestReworkShape;

  return {
    tripped,
    max_generation: maxGeneration,
    cap,
    latest_rework_shape: latestReworkShape,
  };
}

function buildReasons(verdict, gate1, gate3) {
  const reasons = [];

  if (gate1.tripped) {
    reasons.push(`gate1_zero_execution tripped: first zero-exec streak at generations [${gate1.streak_generations.join(', ')}]`);
  }
  if (gate3.tripped) {
    reasons.push(`gate3_generation_cap tripped: latest artifact is rework-shape at max_generation=${gate3.max_generation}`);
  }
  if (!reasons.length) {
    reasons.push('no convergence gate tripped');
  }

  return reasons;
}

function evaluateLoopConvergence(artifacts, options = {}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new TypeError('artifacts must be a non-empty array');
  }
  const generationCap = options.generationCap === undefined
    ? 3
    : parseGenerationCap(options.generationCap);
  if (generationCap === null) {
    throw new TypeError('generationCap must be a non-negative integer');
  }
  const ordered = sortArtifactsByGeneration(artifacts.map((artifact, index) => ({
    artifact,
    generation: parseGeneration(artifact && artifact.artifact_generation),
    _inputIndex: index,
  })));
  const gate1 = runGate1(ordered);
  const gate3 = runGate3(ordered, generationCap);
  const verdict = (gate1.tripped || gate3.tripped) ? 'TRIP' : 'PASS';
  return {
    verdict,
    artifact_count: ordered.length,
    gate1_zero_execution: gate1,
    gate3_generation_cap: gate3,
    reasons: buildReasons(verdict, gate1, gate3),
  };
}

function parseArgs(argv) {
  const opts = {
    artifactsDir: null,
    generationCap: 3,
    json: false,
    enforce: false,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--artifacts-dir') {
      if (i + 1 >= argv.length) usageError('--artifacts-dir requires a path');
      opts.artifactsDir = argv[++i];
      continue;
    }

    if (arg === '--generation-cap') {
      if (i + 1 >= argv.length) usageError('--generation-cap requires an integer');
      const parsed = parseGenerationCap(argv[++i]);
      if (parsed === null) usageError('--generation-cap must be an integer');
      opts.generationCap = parsed;
      continue;
    }

    if (arg === '--json') {
      opts.json = true;
      continue;
    }

    if (arg === '--enforce') {
      opts.enforce = true;
      continue;
    }

    if (/^--/.test(arg)) {
      usageError(`unknown flag: ${arg}`);
    }

    opts.positional.push(arg);
  }

  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let artifactList;
  if (args.artifactsDir && args.positional.length > 0) {
    usageError('cannot combine --artifacts-dir with positional artifact paths');
  }

  if (args.artifactsDir) {
    artifactList = collectArtifactPathsFromDir(args.artifactsDir);
    if (!Array.isArray(artifactList) || artifactList.length === 0) {
      usageError('no artifacts found in directory');
    }
  } else {
    artifactList = args.positional;
    if (!artifactList.length) usageError('no artifacts provided');
  }

  const loaded = artifactList.map((filePath, index) => {
    const loadedArtifact = loadArtifact(filePath);
    loadedArtifact._inputIndex = index;
    return loadedArtifact;
  });

  const result = evaluateLoopConvergence(
    loaded.map((item) => item.artifact),
    { generationCap: args.generationCap },
  );

  const out = JSON.stringify(result, null, 2);
  process.stdout.write(out + '\n');

  if (args.enforce && result.verdict === 'TRIP') {
    process.exit(3);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  evaluateLoopConvergence,
};
