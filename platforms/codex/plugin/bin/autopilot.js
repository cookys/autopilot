#!/usr/bin/env node
'use strict';

const { dispatchReview } = require('../src/runners/review');
const { resolveReviewLoop } = require('../src/engine/resolve-review-loop');
const { runHarnessCli } = require('../src/harness/cli');
const { AutopilotEngine } = require('../src/engine');

function printHelp() {
  process.stdout.write(`Usage:
  node bin/autopilot.js dispatch review [dispatch-review args...]
  node bin/autopilot.js engine review-loop [resolve-review-loop args...]
  node bin/autopilot.js engine implement-review --prompt-file <file> --branch <branch> --base <sha> [--cwd <repo>] [--max-rounds N] [--allow-unqualified-reviewer]
  node bin/autopilot.js harness report [harness report args...]

Commands:
  dispatch review   Delegate to the read-only heterogeneous review dispatcher.
  engine review-loop
                    Delegate to the review-loop roster resolver.
  engine implement-review
                    Run implementer -> review -> repair through AutopilotEngine.
  harness report    Emit read-only harness capability state and stale flags.

Exit codes:
  Delegated commands preserve the wrapped command exit code.
  2 = usage error / unknown command
`);
}

function parseImplementReviewArgs(rawArgs) {
  const output = {
    promptFile: null,
    branch: null,
    base: null,
    cwd: null,
    maxRounds: null,
    requireQualifiedReviewer: true,
  };
  let sawRequireQualifiedReviewer = false;
  let sawAllowUnqualifiedReviewer = false;

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (arg === '--prompt-file') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--prompt-file requires a value' };
      }
      output.promptFile = value;
      i += 2;
      continue;
    }
    if (arg === '--branch') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--branch requires a value' };
      }
      output.branch = value;
      i += 2;
      continue;
    }
    if (arg === '--base') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--base requires a value' };
      }
      output.base = value;
      i += 2;
      continue;
    }
    if (arg === '--cwd') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--cwd requires a value' };
      }
      output.cwd = value;
      i += 2;
      continue;
    }
    if (arg === '--max-rounds') {
      const value = rawArgs[i + 1];
      if (!value) {
        return { error: '--max-rounds requires a value' };
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) {
        return { error: `invalid --max-rounds value: ${value}` };
      }
      output.maxRounds = n;
      i += 2;
      continue;
    }
    if (arg === '--require-qualified-reviewer') {
      sawRequireQualifiedReviewer = true;
      output.requireQualifiedReviewer = true;
      i += 1;
      continue;
    }
    if (arg === '--allow-unqualified-reviewer') {
      sawAllowUnqualifiedReviewer = true;
      output.requireQualifiedReviewer = false;
      i += 1;
      continue;
    }
    return { error: `unknown engine implement-review option: ${arg}` };
  }

  if (sawRequireQualifiedReviewer && sawAllowUnqualifiedReviewer) {
    return { error: 'flags --require-qualified-reviewer and --allow-unqualified-reviewer cannot be combined' };
  }

  if (!output.promptFile || !output.branch || !output.base) {
    return { error: 'flags --prompt-file, --branch, --base are required' };
  }

  return output;
}

function failUsage(message = '') {
  if (message) {
    process.stderr.write(`ERROR: ${message}\n`);
  }
  printHelp();
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
  printHelp();
  process.exit(0);
}

if (args[0] === 'dispatch') {
  if (args[1] !== 'review') {
    failUsage(`unknown dispatch subcommand: ${args.slice(1).join(' ') || '<missing>'}`);
  }
  const result = dispatchReview(args.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`ERROR: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.signal) {
    process.stderr.write(`ERROR: dispatch review terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (args[0] === 'engine') {
  if (args[1] !== 'review-loop') {
    if (args[1] === 'implement-review') {
      const parsed = parseImplementReviewArgs(args.slice(2));
      if (parsed.error) {
        failUsage(parsed.error);
      }
      const result = new AutopilotEngine({
        cwd: parsed.cwd || process.cwd(),
      }).runImplementationReviewLoop(parsed);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.status === 'converged' ? 0 : 1);
    }

    failUsage(`unknown engine subcommand: ${args.slice(1).join(' ') || '<missing>'}`);
  }
  const result = resolveReviewLoop(args.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    process.stderr.write(`ERROR: ${result.error.message}\n`);
    process.exit(2);
  }
  if (result.signal) {
    process.stderr.write(`ERROR: engine review-loop terminated by signal ${result.signal}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (args[0] === 'harness') {
  const result = runHarnessCli(args.slice(1), {
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exit(result.status);
}

failUsage(`unknown command: ${args.join(' ')}`);
