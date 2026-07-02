'use strict';

const { buildCapabilityReport, formatWarning, parseDurationDays, validateRequiredLevel } = require('./capabilities');
const { redact } = require('../../hooks/_shared/secret-patterns');

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function usage() {
  return `Usage:
  node bin/autopilot.js harness report [--stale-after 14d] [--required-level H3] [--format json|warning] [--capabilities-dir <dir>] [--now <iso-date>]

Commands:
  harness report   Emit read-only harness capability state and stale flags.
`;
}

function parseReportArgs(args) {
  const options = {
    format: 'json',
    staleAfter: '14d',
    requiredLevel: 'H3',
  };

  function readValue(index, flag) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new UsageError(`${flag} requires a value`);
    }
    return value;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') {
      options.format = 'json';
    } else if (arg === '--warning' || arg === '--format=warning') {
      options.format = 'warning';
    } else if (arg === '--format') {
      options.format = readValue(i, arg);
      i += 1;
    } else if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
    } else if (arg === '--stale-after') {
      options.staleAfter = readValue(i, arg);
      i += 1;
    } else if (arg.startsWith('--stale-after=')) {
      options.staleAfter = arg.slice('--stale-after='.length);
    } else if (arg === '--required-level') {
      options.requiredLevel = readValue(i, arg);
      i += 1;
    } else if (arg.startsWith('--required-level=')) {
      options.requiredLevel = arg.slice('--required-level='.length);
    } else if (arg === '--capabilities-dir') {
      options.dir = readValue(i, arg);
      i += 1;
    } else if (arg.startsWith('--capabilities-dir=')) {
      options.dir = arg.slice('--capabilities-dir='.length);
    } else if (arg === '--now') {
      options.now = readValue(i, arg);
      i += 1;
    } else if (arg.startsWith('--now=')) {
      options.now = arg.slice('--now='.length);
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else {
      throw new UsageError(`unknown harness report argument: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }
  if (!['json', 'warning'].includes(options.format)) {
    throw new UsageError(`unsupported harness report format: ${options.format}`);
  }
  try {
    parseDurationDays(options.staleAfter);
    validateRequiredLevel(options.requiredLevel);
  } catch (error) {
    throw new UsageError(error.message);
  }
  return options;
}

function runHarnessCli(args, options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;

  try {
    if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
      stdout.write(usage());
      return { status: 0 };
    }

    if (args[0] !== 'report') {
      stderr.write(`ERROR: unknown harness command: ${args.join(' ')}\n`);
      stdout.write(usage());
      return { status: 2 };
    }

    const reportOptions = parseReportArgs(args.slice(1));
    if (reportOptions.help) {
      stdout.write(usage());
      return { status: 0 };
    }

    const report = buildCapabilityReport(reportOptions);
    if (reportOptions.format === 'warning') {
      stdout.write(formatWarning(report));
    } else {
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
    return { status: 0 };
  } catch (error) {
    stderr.write(`ERROR: ${redact(error.message)}\n`);
    if (error instanceof UsageError) {
      stdout.write(usage());
      return { status: 2 };
    }
    return { status: 1 };
  }
}

module.exports = {
  parseReportArgs,
  runHarnessCli,
  usage,
};
