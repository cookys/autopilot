#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

function showHelp() {
  console.log(`Usage: node scripts/hetero-review-loop.js <subcommand> [flags]

Subcommands:
  collect     Collect reviews across seat panel for a generation

Common flags:
  --repo-root <path>    Path to target git repository
  --ledger <dir>        Path to ledger directory
  --phase <id>          Phase identifier
  --help, -h            Show this help message

Collect flags:
  --generation <n>      Generation number (integer >= 1)
  --branch <b>          Target git branch
  --phase-base <sha>    Base commit sha (required for generation 1)
  --seats <specs>       Comma-separated list of seats (engine/effort@runner[:endpoint])
  --spec-file <file>    Task specification file to pass to reviewer
  --timeout <duration>  Timeout for dispatch (default: 20m)
  --allow-seat-gap      Allow generation to proceed even if some seats return no_verdict
`);
}

function parseArgv(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'allow-seat-gap') {
        flags[key] = true;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

function resolveField(resolverPath, repoRoot, name) {
  try {
    const args = ['--field', name];
    if (repoRoot) {
      args.push('--repo-root', repoRoot);
    }
    const res = spawnSync(resolverPath, args, {
      encoding: 'utf8',
      cwd: repoRoot || process.cwd(),
      env: { ...process.env },
    });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim();
    }
    return '';
  } catch (_e) {
    return '';
  }
}

function parseSeatSpec(spec, id) {
  let seatStr = spec.trim();
  let endpoint = '';
  const colonIdx = seatStr.indexOf(':');
  if (colonIdx !== -1) {
    endpoint = seatStr.slice(colonIdx + 1);
    seatStr = seatStr.slice(0, colonIdx);
  }

  const atIdx = seatStr.indexOf('@');
  if (atIdx === -1) {
    throw new Error(`Invalid seat specification: ${spec}`);
  }
  const runner = seatStr.slice(atIdx + 1);
  const engineEffort = seatStr.slice(0, atIdx);

  const slashIdx = engineEffort.indexOf('/');
  if (slashIdx === -1) {
    throw new Error(`Invalid seat engine/effort in spec: ${spec}`);
  }
  const engine = engineEffort.slice(0, slashIdx);
  const effort = engineEffort.slice(slashIdx + 1);

  return {
    id,
    runner,
    engine,
    effort,
    endpoint: endpoint || undefined,
  };
}

function resolveSeats(seatsArg, repoRoot) {
  if (seatsArg) {
    const specs = seatsArg.split(',').map((s) => s.trim()).filter(Boolean);
    return specs.map((spec, idx) => parseSeatSpec(spec, `s${idx}`));
  }

  let resolver = process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
  if (!resolver) {
    resolver = repoRoot
      ? path.join(repoRoot, 'scripts', 'resolve-review-loop.sh')
      : path.join('scripts', 'resolve-review-loop.sh');
  }

  let fullJson = null;
  try {
    const args = [];
    if (repoRoot) {
      args.push('--repo-root', repoRoot);
    }
    const res = spawnSync(resolver, args, {
      encoding: 'utf8',
      cwd: repoRoot || process.cwd(),
      env: { ...process.env },
    });
    if (res.status === 0 && res.stdout) {
      fullJson = JSON.parse(res.stdout);
    }
  } catch (_e) {
    fullJson = null;
  }

  let qcPanel = fullJson && fullJson.qc_panel;
  let qcRunners = fullJson && fullJson.qc_panel_runners;
  let qcEfforts = fullJson && fullJson.qc_panel_efforts;
  let qcEndpoints = fullJson && fullJson.qc_panel_endpoints;

  if (qcPanel === undefined) {
    qcPanel = resolveField(resolver, repoRoot, 'qc_panel');
  }
  if (qcRunners === undefined) {
    qcRunners = resolveField(resolver, repoRoot, 'qc_panel_runners');
  }
  if (qcEfforts === undefined) {
    qcEfforts = resolveField(resolver, repoRoot, 'qc_panel_efforts');
  }
  if (qcEndpoints === undefined) {
    qcEndpoints = resolveField(resolver, repoRoot, 'qc_panel_endpoints');
  }

  const toList = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.split(',').map((s) => s.trim());
    }
    return [];
  };

  const panelList = toList(qcPanel);
  if (panelList.length > 0) {
    const runnerList = toList(qcRunners);
    const effortList = toList(qcEfforts);
    const endpointList = toList(qcEndpoints);

    return panelList.map((engine, idx) => {
      const runner = runnerList[idx] || '';
      const effort = effortList[idx] || '';
      let endpoint = endpointList[idx] || '';
      if (endpoint === '@none' || !endpoint) {
        endpoint = undefined;
      }
      return {
        id: `s${idx}`,
        runner,
        engine,
        effort,
        endpoint,
      };
    });
  }

  // Fallback to reviewer_*
  let revEngine = fullJson && fullJson.reviewer_engine;
  let revEffort = fullJson && fullJson.reviewer_effort;
  let revRunner = fullJson && fullJson.reviewer_runner;
  let revEndpoint = fullJson && fullJson.reviewer_endpoint;

  if (revEngine === undefined) revEngine = resolveField(resolver, repoRoot, 'reviewer_engine');
  if (revEffort === undefined) revEffort = resolveField(resolver, repoRoot, 'reviewer_effort');
  if (revRunner === undefined) revRunner = resolveField(resolver, repoRoot, 'reviewer_runner');
  if (revEndpoint === undefined) revEndpoint = resolveField(resolver, repoRoot, 'reviewer_endpoint');

  if (revEndpoint === '@none' || !revEndpoint) {
    revEndpoint = undefined;
  }

  return [
    {
      id: 's0',
      runner: revRunner || '',
      engine: revEngine || '',
      effort: revEffort || '',
      endpoint: revEndpoint,
    },
  ];
}

const SEVERITY_WORDS = new Set(['Critical', 'Major', 'Minor', 'Suggestion']);
const EMOJI_TO_WORD = {
  '🔴': 'Critical',
  '🟠': 'Major',
  '🟡': 'Minor',
  '🔵': 'Suggestion',
};

function extractFindings(seatId, findingsText) {
  if (!findingsText || typeof findingsText !== 'string') return [];
  const lines = findingsText.split(/\r?\n/);
  const findings = [];

  function parseSeverityFromLine(line) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:[-*#>\s\d.)]*)(?:(🔴|🟠|🟡|🔵)\s*(Critical|Major|Minor|Suggestion)?|(Critical|Major|Minor|Suggestion))\b/i);
    if (!match) return null;
    if (match[1]) {
      const word = EMOJI_TO_WORD[match[1]];
      if (word) return word;
    }
    const rawWord = match[2] || match[3];
    if (rawWord) {
      const lower = rawWord.toLowerCase();
      for (const w of SEVERITY_WORDS) {
        if (w.toLowerCase() === lower) return w;
      }
    }
    return null;
  }

  let currentFinding = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sev = parseSeverityFromLine(line);
    if (sev) {
      if (currentFinding) {
        findings.push(currentFinding);
      }
      currentFinding = {
        severity: sev,
        lines: [line],
      };
    } else {
      if (currentFinding) {
        currentFinding.lines.push(line);
      }
    }
  }
  if (currentFinding) {
    findings.push(currentFinding);
  }

  return findings.map((f) => {
    const text = f.lines.join('\n');
    const firstLine = f.lines[0] || '';
    const normalizedFirstLine = firstLine.trim().replace(/\s+/g, ' ');
    const idInput = `${seatId}|${f.severity}|${normalizedFirstLine}`;
    const id = crypto.createHash('sha256').update(idInput, 'utf8').digest('hex');
    return {
      id,
      severity: f.severity,
      seat: seatId,
      text,
    };
  });
}

function runGitRevParse(branch, repoRoot) {
  const res = spawnSync('git', ['rev-parse', branch], {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
  });
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`git rev-parse ${branch} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function runGitDiff(base, head, repoRoot) {
  const res = spawnSync('git', ['diff', `${base}..${head}`], {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`git diff ${base}..${head} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

function runSeatDispatch(seat, repoRoot, ledgerPhaseGDir, specFile, timeout) {
  return new Promise((resolve) => {
    const dispatchScript = repoRoot
      ? path.join(repoRoot, 'scripts', 'dispatch-review.sh')
      : path.join('scripts', 'dispatch-review.sh');

    const diffFile = path.join(ledgerPhaseGDir, 'diff.txt');

    const args = [
      '--runner', seat.runner,
      '--model', seat.engine,
      '--effort', seat.effort,
      '--diff-file', diffFile,
      '--timeout', timeout || '20m',
    ];
    if (seat.endpoint) {
      args.push('--endpoint', seat.endpoint);
    }
    if (specFile) {
      args.push('--spec-file', specFile);
    }

    const child = spawn(dispatchScript, args, {
      cwd: repoRoot || process.cwd(),
      env: { ...process.env, STUB_SEAT_ID: seat.id },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (err) => {
      resolve({
        seat,
        status: 'no_verdict',
        rawOutput: { status: 'no_verdict', error: err.message },
      });
    });

    child.on('close', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (_e) {
        parsed = null;
      }

      if (!parsed || typeof parsed !== 'object') {
        parsed = { status: 'no_verdict', error: 'Invalid JSON output from dispatch-review', raw: stdout };
      }

      const status = parsed.status === 'reviewed' ? 'reviewed' : 'no_verdict';
      resolve({
        seat,
        status,
        rawOutput: parsed,
      });
    });
  });
}

async function handleCollect(flags) {
  const generation = parseInt(flags.generation, 10);
  if (!flags.generation || isNaN(generation) || generation < 1) {
    console.error('ERROR: --generation <n> must be an integer >= 1');
    process.exit(2);
  }

  const branch = flags.branch;
  if (!branch) {
    console.error('ERROR: --branch <b> is required');
    process.exit(2);
  }

  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const phase = flags.phase;

  if (!ledgerDir || !phase) {
    console.error('ERROR: --ledger <dir> and --phase <id> are required');
    process.exit(2);
  }

  const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
  const chainPath = path.join(reviewPhaseDir, 'chain.json');

  let base = '';
  if (generation === 1) {
    if (!flags['phase-base']) {
      console.error('ERROR: --phase-base <sha> is required for generation 1');
      process.exit(2);
    }
    base = flags['phase-base'].trim();
  } else {
    // generation > 1
    if (!fs.existsSync(chainPath)) {
      console.error(`ERROR: Contiguous chain broken: chain.json does not exist at ${chainPath}`);
      process.exit(1);
    }
    let chain = [];
    try {
      chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (_e) {
      console.error(`ERROR: Failed to parse chain.json at ${chainPath}`);
      process.exit(1);
    }
    const prevEntry = chain.find((c) => c.generation === generation - 1);
    if (!prevEntry) {
      console.error(`ERROR: Contiguous chain broken: missing generation ${generation - 1} in ${chainPath}`);
      process.exit(1);
    }
    const allowedStatuses = new Set(['pending', 'pending-with-gap', 'finalized']);
    if (!allowedStatuses.has(prevEntry.status)) {
      console.error(`ERROR: Contiguous chain broken: generation ${generation - 1} status is '${prevEntry.status}' (expected pending, pending-with-gap, or finalized)`);
      process.exit(1);
    }
    base = prevEntry.head;
  }

  let head = '';
  try {
    head = runGitRevParse(branch, repoRoot);
  } catch (e) {
    console.error(`ERROR: Failed to resolve branch '${branch}': ${e.message}`);
    process.exit(1);
  }

  // Resolve seats
  let seats = [];
  try {
    seats = resolveSeats(flags.seats, repoRoot);
  } catch (e) {
    console.error(`ERROR: Seat resolution failed: ${e.message}`);
    process.exit(1);
  }

  if (!seats.length) {
    console.error('ERROR: No seats configured or resolved');
    process.exit(1);
  }

  // Range and diff
  const gDir = path.join(reviewPhaseDir, `g${generation}`);
  fs.mkdirSync(gDir, { recursive: true });

  let diffText = '';
  try {
    diffText = runGitDiff(base, head, repoRoot);
  } catch (e) {
    console.error(`ERROR: Failed to generate diff: ${e.message}`);
    process.exit(1);
  }

  const diffSha256 = crypto.createHash('sha256').update(diffText, 'utf8').digest('hex');

  const rangeJson = {
    base,
    head,
    diff_sha256: diffSha256,
  };
  fs.writeFileSync(path.join(gDir, 'range.json'), JSON.stringify(rangeJson, null, 2) + '\n');
  fs.writeFileSync(path.join(gDir, 'diff.txt'), diffText);

  // Dispatch all seats concurrently
  const timeout = flags.timeout || '20m';
  const specFile = flags['spec-file'] ? path.resolve(flags['spec-file']) : '';

  const seatPromises = seats.map((seat) => runSeatDispatch(seat, repoRoot, gDir, specFile, timeout));
  const seatResults = await Promise.all(seatPromises);

  // Write per-seat JSON files
  for (const res of seatResults) {
    const seatPath = path.join(gDir, `seat-${res.seat.id}.json`);
    fs.writeFileSync(seatPath, JSON.stringify(res.rawOutput, null, 2) + '\n');
  }

  // Check head again
  let postHead = '';
  try {
    postHead = runGitRevParse(branch, repoRoot);
  } catch (e) {
    console.error(`ERROR: Failed to re-check branch '${branch}': ${e.message}`);
    process.exit(1);
  }

  if (postHead !== head) {
    // Head moved during dispatch
    let chain = [];
    if (fs.existsSync(chainPath)) {
      try {
        chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
      } catch (_e) {
        chain = [];
      }
    }
    chain.push({
      generation,
      base,
      status: 'aborted',
    });
    fs.mkdirSync(reviewPhaseDir, { recursive: true });
    fs.writeFileSync(chainPath, JSON.stringify(chain, null, 2) + '\n');
    console.error(`ERROR: Branch '${branch}' moved from ${head} to ${postHead} during review collection`);
    process.exit(1);
  }

  // Extract findings
  const allFindings = [];
  let hasGap = false;
  const seatIds = seats.map((s) => s.id);

  for (const res of seatResults) {
    if (res.status === 'reviewed') {
      const seatFindings = extractFindings(res.seat.id, res.rawOutput.findings || '');
      allFindings.push(...seatFindings);
    } else {
      hasGap = true;
    }
  }

  const allowSeatGap = Boolean(flags['allow-seat-gap']);

  if (hasGap && !allowSeatGap) {
    const gapSeats = seatResults.filter((r) => r.status !== 'reviewed').map((r) => r.seat.id);
    console.error(`ERROR: Review seat gap detected on seat(s): ${gapSeats.join(', ')}`);
    process.exit(1);
  }

  // Write findings.json
  const findingsJson = {
    findings: allFindings,
  };
  fs.writeFileSync(path.join(gDir, 'findings.json'), JSON.stringify(findingsJson, null, 2) + '\n');

  // Update chain.json
  let chain = [];
  if (fs.existsSync(chainPath)) {
    try {
      chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (_e) {
      chain = [];
    }
  }

  const genStatus = hasGap ? 'pending-with-gap' : 'pending';
  chain.push({
    generation,
    base,
    head,
    seats: seatIds,
    status: genStatus,
  });
  fs.mkdirSync(reviewPhaseDir, { recursive: true });
  fs.writeFileSync(chainPath, JSON.stringify(chain, null, 2) + '\n');

  // Output summary JSON
  const summary = {
    phase,
    generation,
    base,
    head,
    seats: seatIds,
    findings_count: allFindings.length,
    status: genStatus,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgv(argv);

  if (flags.help || positional.length === 0) {
    showHelp();
    process.exit(0);
  }

  const subcommand = positional[0];

  if (subcommand === 'collect') {
    await handleCollect(flags);
  } else {
    console.error(`Subcommand '${subcommand}' is not yet implemented.`);
    console.error('Usage: node scripts/hetero-review-loop.js <subcommand> [flags]');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
