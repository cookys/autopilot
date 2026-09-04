#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

function writeFileSyncAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpName = `.tmp-${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);
  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (_e) {}
    throw err;
  }
}

function showHelp() {
  console.log(`Usage: node scripts/hetero-review-loop.js <subcommand> [flags]

Subcommands:
  collect     Collect reviews across seat panel for a generation
  finalize    Finalize review generation, aggregate verdict, and write receipt
  opt-out     Record opt-out receipt for review loop

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

Finalize flags:
  --generation <n>      Generation number (integer >= 1)
  --dispositions <file> Path to dispositions JSON file
  --branch <b>          Target git branch (optional)

Opt-out flags:
  --knob <knob>         Review knob to opt out (plan_review|hetero_review)

Environment overrides:
  AUTOPILOT_DISPATCH_REVIEW_SCRIPT  Path to reviewer dispatcher script (overrides default dispatch-review.sh)
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

  let qcPanelSeats = fullJson && fullJson.qc_panel_seats;
  if (Array.isArray(qcPanelSeats) && qcPanelSeats.length > 0) {
    return qcPanelSeats.map((seatObj, idx) => {
      let endpoint = seatObj.endpoint;
      if (endpoint === null || endpoint === undefined || endpoint === '' || endpoint === '@none') {
        endpoint = undefined;
      }
      return {
        id: `s${idx}`,
        runner: seatObj.runner || '',
        engine: seatObj.model || '',
        effort: seatObj.effort || '',
        endpoint,
      };
    });
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
    // Recognise four line shapes:
    // 1. A severity glyph alone at start of line
    // 2. A severity glyph followed by the plain severity word
    // 3. The plain severity word alone with no glyph
    // 4. A severity glyph immediately followed by a bracketed id (glyph then whitespace then open bracket)
    const match = trimmed.match(/^(?:[-*#>\s\d.)]*)(?:(🔴|🟠|🟡|🔵)(?:\s*\[|\s+(Critical|Major|Minor|Suggestion)\b|\s*$|\s+)|(Critical|Major|Minor|Suggestion)\b)/i);
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
    let dispatchScript = process.env.AUTOPILOT_DISPATCH_REVIEW_SCRIPT;
    if (!dispatchScript) {
      dispatchScript = path.join(__dirname, 'dispatch-review.sh');
    }

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

    child.on('close', (exitCode) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch (_e) {
        parsed = null;
      }

      const validVerdict = parsed && (parsed.verdict === 'SHIP-AS-IS' || parsed.verdict === 'FIX-THEN-SHIP' || parsed.verdict === null);
      const validShape = parsed && typeof parsed === 'object' && typeof parsed.status === 'string' && validVerdict;

      if (exitCode !== 0 || !validShape) {
        const errorMsg = exitCode !== 0
          ? `dispatch-review exited with status ${exitCode}`
          : 'Invalid or non-matching output shape from dispatch-review';
        const fallbackRaw = (parsed && typeof parsed === 'object') ? parsed : { raw: stdout };
        resolve({
          seat,
          status: 'no_verdict',
          rawOutput: {
            ...fallbackRaw,
            status: 'no_verdict',
            verdict: 'no_verdict',
            error: errorMsg,
          },
        });
        return;
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

  let chain = [];
  if (fs.existsSync(chainPath)) {
    try {
      chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (_e) {
      console.error(`ERROR: Failed to parse chain.json at ${chainPath}`);
      process.exit(1);
    }
    if (!Array.isArray(chain)) {
      console.error(`ERROR: Malformed chain.json at ${chainPath}: expected array`);
      process.exit(1);
    }
  }

  const existingGenEntry = chain.find((c) => c && c.generation === generation);
  if (existingGenEntry) {
    if (existingGenEntry.status === 'pending' || existingGenEntry.status === 'finalized') {
      console.error(`ERROR: Generation ${generation} already exists with status '${existingGenEntry.status}'`);
      process.exit(1);
    }
  }

  let base = '';
  if (generation === 1) {
    if (!flags['phase-base']) {
      console.error('ERROR: --phase-base <sha> is required for generation 1');
      process.exit(2);
    }
    base = flags['phase-base'].trim();
  } else {
    // generation > 1
    const prevEntry = chain.find((c) => c && c.generation === generation - 1);
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

  for (let idx = 0; idx < seats.length; idx++) {
    const seat = seats[idx];
    if (!seat.runner) {
      console.error(`ERROR: Seat ${seat.id || `s${idx}`} missing runner`);
      process.exit(2);
    }
    if (!seat.engine) {
      console.error(`ERROR: Seat ${seat.id || `s${idx}`} missing engine`);
      process.exit(2);
    }
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
  writeFileSyncAtomic(path.join(gDir, 'range.json'), JSON.stringify(rangeJson, null, 2) + '\n');
  writeFileSyncAtomic(path.join(gDir, 'diff.txt'), diffText);

  // Dispatch all seats concurrently
  const timeout = flags.timeout || '20m';
  const specFile = flags['spec-file'] ? path.resolve(flags['spec-file']) : '';

  const seatPromises = seats.map((seat) => runSeatDispatch(seat, repoRoot, gDir, specFile, timeout));
  const seatResults = await Promise.all(seatPromises);

  // Write per-seat JSON files
  for (const res of seatResults) {
    const seatPath = path.join(gDir, `seat-${res.seat.id}.json`);
    writeFileSyncAtomic(seatPath, JSON.stringify(res.rawOutput, null, 2) + '\n');
  }

  function saveChainEntry(newEntry) {
    let currentChain = [];
    if (fs.existsSync(chainPath)) {
      try {
        currentChain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
      } catch (_e) {
        currentChain = [];
      }
      if (!Array.isArray(currentChain)) {
        currentChain = [];
      }
    }
    const existingIdx = currentChain.findIndex((c) => c && c.generation === generation);
    if (existingIdx !== -1) {
      currentChain[existingIdx] = newEntry;
    } else {
      currentChain.push(newEntry);
    }
    writeFileSyncAtomic(chainPath, JSON.stringify(currentChain, null, 2) + '\n');
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
    saveChainEntry({
      generation,
      base,
      status: 'aborted',
    });
    console.error(`ERROR: Branch '${branch}' moved from ${head} to ${postHead} during review collection`);
    process.exit(1);
  }

  // Check for parse failures across seats (Defect 2)
  for (const res of seatResults) {
    const findingsStr = (res.rawOutput && typeof res.rawOutput.findings === 'string') ? res.rawOutput.findings : '';
    if (findingsStr.trim().length > 0) {
      const extracted = extractFindings(res.seat.id, findingsStr);
      if (extracted.length === 0) {
        saveChainEntry({
          generation,
          base,
          status: 'aborted',
          reason: 'parse_failed',
        });
        console.error(`ERROR: Failed to parse non-empty findings for seat ${res.seat.id}`);
        process.exit(1);
      }
    }
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
  writeFileSyncAtomic(path.join(gDir, 'findings.json'), JSON.stringify(findingsJson, null, 2) + '\n');

  // Update chain.json
  const genStatus = hasGap ? 'pending-with-gap' : 'pending';
  saveChainEntry({
    generation,
    base,
    head,
    seats: seatIds,
    status: genStatus,
  });

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

async function handleFinalize(flags) {
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const phase = flags.phase;
  const generationRaw = flags.generation;
  const dispositionsFile = flags.dispositions ? path.resolve(flags.dispositions) : '';
  const branch = flags.branch || '';

  if (!ledgerDir || !phase || !generationRaw || !dispositionsFile) {
    console.error('ERROR: --ledger <dir>, --phase <id>, --generation <n>, and --dispositions <file> are required for finalize');
    process.exit(2);
  }

  const generation = parseInt(generationRaw, 10);
  if (isNaN(generation) || generation < 1) {
    console.error(`ERROR: Invalid --generation: '${generationRaw}' (must be integer >= 1)`);
    process.exit(2);
  }

  const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
  const gDir = path.join(reviewPhaseDir, `g${generation}`);
  const findingsPath = path.join(gDir, 'findings.json');

  if (!fs.existsSync(findingsPath)) {
    console.error(`ERROR: Missing findings.json at ${findingsPath}`);
    process.exit(1);
  }

  let findingsData;
  try {
    findingsData = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse ${findingsPath}: ${e.message}`);
    process.exit(1);
  }

  const findingsList = Array.isArray(findingsData.findings) ? findingsData.findings : [];
  const findingsMap = new Map();
  for (const f of findingsList) {
    findingsMap.set(f.id, f);
  }

  if (!fs.existsSync(dispositionsFile)) {
    console.error(`ERROR: Missing dispositions file at ${dispositionsFile}`);
    process.exit(1);
  }

  let dispData;
  try {
    dispData = JSON.parse(fs.readFileSync(dispositionsFile, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse dispositions file ${dispositionsFile}: ${e.message}`);
    process.exit(1);
  }

  if (dispData.schema_version !== 1) {
    console.error(`ERROR: Schema version mismatch in dispositions file: expected 1, got ${dispData.schema_version}`);
    process.exit(1);
  }

  if (dispData.phase !== phase || dispData.generation !== generation) {
    console.error(`ERROR: Phase or generation mismatch in dispositions file: expected phase '${phase}' generation ${generation}, got phase '${dispData.phase}' generation ${dispData.generation}`);
    process.exit(1);
  }

  const dispFindings = Array.isArray(dispData.findings) ? dispData.findings : [];
  const dispMap = new Map();
  for (const df of dispFindings) {
    dispMap.set(df.id, df);
  }

  // Check matching IDs: one entry per finding id, no extras, none missing
  for (const fid of findingsMap.keys()) {
    if (!dispMap.has(fid)) {
      console.error(`ERROR: Dispositions file missing finding id: ${fid}`);
      process.exit(1);
    }
  }
  for (const did of dispMap.keys()) {
    if (!findingsMap.has(did)) {
      console.error(`ERROR: Dispositions file contains unexpected finding id: ${did}`);
      process.exit(1);
    }
  }

  // Aggregate verdict and open_findings
  let hasVerifiedCritical = false;
  const openFindings = [];

  for (const f of findingsList) {
    const disp = dispMap.get(f.id);
    if (!disp) {
      if (f.severity === 'Critical') {
        console.error(`ERROR: Critical finding ${f.id} has no matching disposition entry`);
        process.exit(1);
      }
      continue;
    }

    if (f.severity === 'Critical' && disp.disposition === 'verified') {
      hasVerifiedCritical = true;
    }

    if ((f.severity === 'Major' || f.severity === 'Minor') && disp.disposition === 'verified') {
      openFindings.push({
        id: f.id,
        severity: f.severity,
        seat: f.seat,
        text: f.text,
        disposition: 'verified',
      });
    }
  }

  // Defensive check: if any finding has severity Critical and no matching disposition
  for (const f of findingsList) {
    if (f.severity === 'Critical' && !dispMap.has(f.id)) {
      console.error(`ERROR: Undispositioned Critical finding encountered: ${f.id}`);
      process.exit(1);
    }
  }

  const verdict = hasVerifiedCritical ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS';

  // Read chain.json
  const chainPath = path.join(reviewPhaseDir, 'chain.json');
  let chain = [];
  if (fs.existsSync(chainPath)) {
    try {
      chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (_e) {
      chain = [];
    }
  }

  // Cross-generation closure:
  // if a chain.json file exists with earlier finalized generations, and this generation's
  // findings.json does NOT contain a finding id that was verified in an earlier generation's
  // dispositions, mark that earlier finding closed_by_generation: <this generation's n>
  const currentFindingIds = new Set(findingsList.map((f) => f.id));
  for (const entry of chain) {
    if (entry.generation < generation && entry.status === 'finalized' && entry.dispositions_path) {
      const earlierDispPath = entry.dispositions_path;
      if (fs.existsSync(earlierDispPath)) {
        try {
          const earlierDisp = JSON.parse(fs.readFileSync(earlierDispPath, 'utf8'));
          const earlierFindings = Array.isArray(earlierDisp.findings) ? earlierDisp.findings : [];
          if (!Array.isArray(entry.closed_findings)) {
            entry.closed_findings = [];
          }
          const alreadyClosedIds = new Set(entry.closed_findings.map((cf) => cf.id));
          for (const ef of earlierFindings) {
            if (ef.disposition === 'verified' && !currentFindingIds.has(ef.id) && !alreadyClosedIds.has(ef.id)) {
              entry.closed_findings.push({
                id: ef.id,
                closed_by_generation: generation,
              });
              alreadyClosedIds.add(ef.id);
            }
          }
        } catch (_e) {
          // Ignore parse errors on earlier dispositions defensively
        }
      }
    }
  }

  // If FIX-THEN-SHIP, write hands-brief.md and run check-redispatch-prompt.sh
  const briefPath = path.join(gDir, 'hands-brief.md');
  if (verdict === 'FIX-THEN-SHIP') {
    let engineLine = 'Engine: sonnet@claude-native effort=high';
    const topologyPath = process.env.AUTOPILOT_TOPOLOGY_FILE || path.join(process.env.HOME || '', '.autopilot', 'topology.json');
    if (fs.existsSync(topologyPath)) {
      try {
        const topData = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
        if (Array.isArray(topData.implementer_ladder) && topData.implementer_ladder.length > 0) {
          const first = topData.implementer_ladder[0];
          const eng = first.engine || '';
          const run = first.runner || '';
          const eff = first.effort || '';
          if (eng && run && eff) {
            engineLine = `Engine: ${eng}@${run} effort=${eff}`;
          }
        }
      } catch (_e) {
        engineLine = 'Engine: sonnet@claude-native effort=high';
      }
    }

    const briefLines = [engineLine];
    if (branch) {
      briefLines.push(`Branch: ${branch}`);
    }

    const rangePath = path.join(gDir, 'range.json');
    let baseSha = '';
    let headSha = '';
    if (fs.existsSync(rangePath)) {
      try {
        const rangeObj = JSON.parse(fs.readFileSync(rangePath, 'utf8'));
        baseSha = rangeObj.base || '';
        headSha = rangeObj.head || '';
      } catch (_e) {}
    }
    briefLines.push(`Base: ${baseSha}`);
    briefLines.push(`Head: ${headSha}`);
    briefLines.push('');

    // One paragraph per verified finding (any severity) written in plain prose — no fenced code blocks, no "around line N" phrasing; just describe the finding text and the file/location it concerns in prose sentences.
    for (const f of findingsList) {
      const disp = dispMap.get(f.id);
      if (disp && disp.disposition === 'verified') {
        const cleanText = (f.text || '')
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/[🔴🟠🟡🔵]/g, '')
          .replace(/\baround\s+line\s+\d+\b/gi, 'at the specified line')
          .replace(/[\r\n]+/g, ' ')
          .trim();
        briefLines.push(`Finding ${f.id} from seat ${f.seat}: ${cleanText}`);
        briefLines.push('');
      }
    }

    writeFileSyncAtomic(briefPath, briefLines.join('\n').trim() + '\n');

    // Run scripts/check-redispatch-prompt.sh
    const checkScript = repoRoot
      ? path.join(repoRoot, 'scripts', 'check-redispatch-prompt.sh')
      : path.join('scripts', 'check-redispatch-prompt.sh');

    const checkRes = spawnSync(checkScript, [briefPath], {
      encoding: 'utf8',
      cwd: repoRoot || process.cwd(),
      env: { ...process.env },
    });

    if (checkRes.status !== 0) {
      console.error(`ERROR: check-redispatch-prompt.sh failed for ${briefPath}: ${checkRes.stderr || checkRes.stdout}`);
      process.exit(1);
    }
  }

  // Update this generation's entry in chain.json before writing receipt
  let currentGenEntry = chain.find((c) => c.generation === generation);
  if (!currentGenEntry) {
    currentGenEntry = {
      generation,
      base: '',
      head: '',
      status: 'finalized',
      dispositions_path: dispositionsFile,
    };
    chain.push(currentGenEntry);
  } else {
    currentGenEntry.status = 'finalized';
    currentGenEntry.dispositions_path = dispositionsFile;
  }

  writeFileSyncAtomic(chainPath, JSON.stringify(chain, null, 2) + '\n');

  // Receipt
  let phaseBaseSha = '';
  const gen1Entry = chain.find((c) => c.generation === 1);
  if (gen1Entry && gen1Entry.base) {
    phaseBaseSha = gen1Entry.base;
  }

  let resolverPath = process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
  if (!resolverPath) {
    resolverPath = repoRoot
      ? path.join(repoRoot, 'scripts', 'resolve-review-loop.sh')
      : path.join('scripts', 'resolve-review-loop.sh');
  }

  let resolvedFrom = resolveField(resolverPath, repoRoot, 'hetero_review_resolved_from');
  if (!resolvedFrom) {
    resolvedFrom = 'unknown';
  }

  const receipt = {
    kind: 'review',
    phase,
    branch: branch || undefined,
    phase_base_sha: phaseBaseSha,
    chain,
    verdict,
    open_findings: openFindings,
    resolved_from: resolvedFrom,
    written_at: new Date().toISOString(),
  };

  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  writeFileSyncAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

  const summary = {
    phase,
    generation,
    verdict,
    open_findings_count: openFindings.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

async function handleOptOut(flags) {
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : '';
  const ledgerDir = flags.ledger ? path.resolve(flags.ledger) : '';
  const phase = flags.phase;
  const knob = flags.knob;

  if (!ledgerDir || !phase || !knob) {
    console.error('ERROR: --ledger <dir>, --phase <id>, and --knob <knob> are required for opt-out');
    process.exit(2);
  }

  if (knob !== 'plan_review' && knob !== 'hetero_review') {
    console.error(`ERROR: Invalid --knob '${knob}' (must be plan_review or hetero_review)`);
    process.exit(2);
  }

  const configRelPath = path.join('.claude', 'review-loop-config.md');
  const configPath = repoRoot ? path.join(repoRoot, configRelPath) : configRelPath;

  let configuredValue = 'absent';
  let configBytes = Buffer.alloc(0);

  if (fs.existsSync(configPath)) {
    try {
      configBytes = fs.readFileSync(configPath);
      const text = configBytes.toString('utf8');
      const lines = text.split(/\r?\n/);
      const regex = new RegExp(`(?:^|[\\s#*->])${knob}(?:[\\s:=]+)(off|on|auto)\\b`, 'i');
      for (const line of lines) {
        const m = line.match(regex);
        if (m) {
          configuredValue = m[1].toLowerCase();
          break;
        }
      }
    } catch (_e) {
      configuredValue = 'absent';
      configBytes = Buffer.alloc(0);
    }
  }

  const sha256 = crypto.createHash('sha256').update(configBytes).digest('hex');
  const configSource = {
    path: configPath,
    sha256,
  };

  let resolverPath = process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
  if (!resolverPath) {
    resolverPath = repoRoot
      ? path.join(repoRoot, 'scripts', 'resolve-review-loop.sh')
      : path.join('scripts', 'resolve-review-loop.sh');
  }

  let resolvedFrom = resolveField(resolverPath, repoRoot, `${knob}_resolved_from`);
  if (!resolvedFrom) {
    resolvedFrom = 'unknown';
  }

  const receipt = {
    kind: 'opt-out',
    phase,
    knob,
    configured_value: configuredValue,
    config_source: configSource,
    resolved_from: resolvedFrom,
    written_at: new Date().toISOString(),
  };

  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  writeFileSyncAtomic(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

  const summary = {
    phase,
    knob,
    configured_value: configuredValue,
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
  } else if (subcommand === 'finalize') {
    await handleFinalize(flags);
  } else if (subcommand === 'opt-out') {
    await handleOptOut(flags);
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
