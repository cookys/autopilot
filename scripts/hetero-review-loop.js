#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const deriveReceiptState = require('./lib/review-chain-derive');

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

const EXCLUDE_ALLOWLIST = [
  'platforms/**',
  'profiles/*.json',
  'docs/projects/**',
  'docs/plans/evidence/**',
  'docs/BACKLOG.md',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'Cargo.lock',
  'composer.lock',
  'poetry.lock',
  'flake.lock',
  '*.lock',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  'lockfiles',
  'generated/**',
];

function isPathspecAllowed(pathspec) {
  const normalized = pathspec.trim();
  if (EXCLUDE_ALLOWLIST.includes(normalized)) {
    return true;
  }
  for (const pattern of EXCLUDE_ALLOWLIST) {
    if (pattern === normalized) return true;
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(prefix + '/')) return true;
    }
  }
  return false;
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
  --exclude <specs>     Comma-separated git pathspecs to exclude from diff
  --timeout <duration>  Timeout for dispatch (default: 20m)
  --allow-seat-gap      Allow generation to proceed even if some seats return no_verdict

Generation numbers are never reused. If a generation is aborted (e.g. the target branch
moved during collection, or a seat's findings failed to parse), its evidence directory is
left untouched on disk and stays referenced from chain.json; collect the next generation
number instead — it continues from the aborted generation's base. An aborted generation
contributes nothing to finalize (it closes no earlier finding) and check-phase-review-receipt
accepts it only when a finalized generation follows it (v2.36.3).

Finalize flags:
  --generation <n>      Generation number (integer >= 1)
  --dispositions <file> Path to dispositions JSON file
  --branch <b>          Target git branch (optional)

Opt-out flags:
  --knob <knob>         Review knob to opt out (plan_review|hetero_review)

Environment overrides:
  AUTOPILOT_DISPATCH_REVIEW_SCRIPT  Path to reviewer dispatcher script (overrides default dispatch-review.sh)
  AUTOPILOT_REVIEW_LOOP_RESOLVER    Path to review-loop resolver script (overrides default resolve-review-loop.sh)
  AUTOPILOT_CHECK_REDISPATCH_PROMPT_SCRIPT Path to check-redispatch-prompt script (overrides default check-redispatch-prompt.sh)
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

function getResolverPath(_repoRoot) {
  if (process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER) {
    return process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
  }
  return path.join(__dirname, 'resolve-review-loop.sh');
}

function runResolver(resolverPath, repoRoot, fieldName) {
  const args = fieldName ? ['--field', fieldName] : [];
  const res = spawnSync(resolverPath, args, {
    encoding: 'utf8',
    cwd: repoRoot || process.cwd(),
    env: { ...process.env },
  });
  if (res.error) {
    const errDetail = res.error.message || String(res.error);
    console.error(`ERROR: Failed to run review-loop resolver (${resolverPath}): ${errDetail}`);
    process.exit(2);
  }
  if (res.status !== 0) {
    const errDetail = (res.stderr || '').trim() || (res.stdout || '').trim() || `exit code ${res.status}`;
    console.error(`ERROR: Review-loop resolver failed: ${errDetail}`);
    process.exit(2);
  }
  return (res.stdout || '').trim();
}

function resolveConfig(resolverPath, repoRoot) {
  const stdout = runResolver(resolverPath, repoRoot);
  try {
    return JSON.parse(stdout);
  } catch (e) {
    console.error(`ERROR: Failed to parse review-loop resolver JSON: ${e.message}`);
    process.exit(2);
  }
}

function resolveField(resolverPath, repoRoot, name) {
  return runResolver(resolverPath, repoRoot, name);
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

  const resolver = getResolverPath(repoRoot);
  const fullJson = resolveConfig(resolver, repoRoot);

  const qcComplete = fullJson && fullJson.qc_panel_seats_complete;
  const qcSeats = fullJson && fullJson.qc_panel_seats;

  if (qcComplete !== true || !Array.isArray(qcSeats) || qcSeats.length === 0) {
    const cfgSource = (fullJson && (fullJson.config_source || fullJson.config_path)) || '';
    if (cfgSource) {
      console.error(`ERROR: Resolved qc panel is incomplete (${cfgSource})`);
    } else {
      console.error('ERROR: Resolved qc panel is incomplete');
    }
    process.exit(2);
  }

  return qcSeats.map((seatObj, idx) => {
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

function runGitDiff(base, head, repoRoot, excludes = []) {
  const args = ['diff', `${base}..${head}`];
  if (Array.isArray(excludes) && excludes.length > 0) {
    args.push('--');
    for (const pattern of excludes) {
      args.push(`:!${pattern}`);
    }
  }
  const res = spawnSync('git', args, {
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

      const validVerdict = parsed && (parsed.verdict === 'SHIP-AS-IS' || parsed.verdict === 'FIX-THEN-SHIP' || parsed.verdict === null || parsed.verdict === 'no_verdict');
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
    console.error(`ERROR: Generation ${generation} already exists with status '${existingGenEntry.status}'; generation numbers are never reused (including aborted ones) — collect the next generation number instead`);
    process.exit(1);
  }

  const gDir = path.join(reviewPhaseDir, `g${generation}`);
  if (fs.existsSync(gDir)) {
    console.error(`ERROR: Generation directory ${gDir} already exists; refusing to reuse`);
    process.exit(1);
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
    if (prevEntry.status === 'finalized') {
      base = prevEntry.head;
    } else if (prevEntry.status === 'aborted') {
      // The aborted generation never produced a reviewable result, so nothing advanced;
      // continue from the same base it was attempted against. Its evidence directory is
      // preserved on disk and remains referenced from this chain.json entry.
      base = prevEntry.base;
    } else {
      console.error(`ERROR: Cannot collect generation ${generation}: generation ${generation - 1} is not finalized (status is '${prevEntry.status}')`);
      process.exit(1);
    }
  }

  // Persist phase base for generation 1 at the documented ledger-root path
  // (<ledger>/phase-<phase>.base) — this is what skills/dev-flow/SKILL.md and
  // skills/dev-flow/references/hetero-loops.md `cat` to build --phase-base.
  if (generation === 1) {
    fs.mkdirSync(ledgerDir, { recursive: true });
    const phaseBaseFile = path.join(ledgerDir, `phase-${phase}.base`);
    writeFileSyncAtomic(phaseBaseFile, base + '\n');
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
  fs.mkdirSync(reviewPhaseDir, { recursive: true });
  try {
    fs.mkdirSync(gDir);
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.error(`ERROR: Generation directory ${gDir} already exists; refusing to overwrite`);
      process.exit(1);
    }
    throw err;
  }

  const excludedList = typeof flags.exclude === 'string'
    ? flags.exclude.split(',').map((p) => p.trim()).filter(Boolean)
    : [];

  for (const pattern of excludedList) {
    if (!isPathspecAllowed(pattern)) {
      console.error(`ERROR: Exclude pathspec '${pattern}' is not permitted by allowlist`);
      process.exit(1);
    }
  }

  let diffText = '';
  try {
    diffText = runGitDiff(base, head, repoRoot, excludedList);
  } catch (e) {
    console.error(`ERROR: Failed to generate diff: ${e.message}`);
    process.exit(1);
  }

  const diffBytes = Buffer.byteLength(diffText, 'utf8');
  const diffSha256 = crypto.createHash('sha256').update(diffText, 'utf8').digest('hex');

  let fullRangeSha256 = diffSha256;
  if (excludedList.length > 0) {
    try {
      const fullRangeDiffText = runGitDiff(base, head, repoRoot, []);
      fullRangeSha256 = crypto.createHash('sha256').update(fullRangeDiffText, 'utf8').digest('hex');
    } catch (e) {
      console.error(`ERROR: Failed to generate unfiltered diff: ${e.message}`);
      process.exit(1);
    }
  }

  const rangeJson = {
    base,
    head,
    diff_sha256: diffSha256,
    full_range_sha256: fullRangeSha256,
    excluded: excludedList,
    diff_bytes: diffBytes,
  };
  writeFileSyncAtomic(path.join(gDir, 'range.json'), JSON.stringify(rangeJson, null, 2) + '\n');
  writeFileSyncAtomic(path.join(gDir, 'diff.txt'), diffText);

  // Before dispatching, if diff exceeds 400000 bytes, print warning
  if (diffBytes > 400000) {
    console.warn(`WARNING: Diff size (${diffBytes} bytes) exceeds 400000 bytes; consider using --exclude <pathspec,...>`);
  }

  // Dispatch all seats concurrently
  const timeout = flags.timeout || '20m';
  const specFile = flags['spec-file'] ? path.resolve(flags['spec-file']) : '';

  const seatPromises = seats.map((seat) => runSeatDispatch(seat, repoRoot, gDir, specFile, timeout));
  const seatResults = await Promise.all(seatPromises);

  // Write per-seat JSON files and compute hashes
  const seatArtifactSha256 = {};
  for (const res of seatResults) {
    const seatPath = path.join(gDir, `seat-${res.seat.id}.json`);
    const seatContent = JSON.stringify(res.rawOutput, null, 2) + '\n';
    writeFileSyncAtomic(seatPath, seatContent);
    seatArtifactSha256[res.seat.id] = crypto.createHash('sha256').update(seatContent, 'utf8').digest('hex');
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

  // Parse findings per seat and handle placeholders / parse failures
  const seatFindingMap = new Map();
  for (const res of seatResults) {
    const raw = res.rawOutput || {};
    const findingsStr = typeof raw.findings === 'string' ? raw.findings : '';
    const trimmedFindings = findingsStr.trim();
    const lowerFindings = trimmedFindings.toLowerCase();
    const isPlaceholder = lowerFindings === 'none' || lowerFindings === 'n/a' || lowerFindings === 'no findings';
    const extracted = extractFindings(res.seat.id, findingsStr);
    seatFindingMap.set(res.seat.id, extracted);

    // If findingsStr is non-empty and nothing parses out of it and the text is not a placeholder token,
    // that seat's collection aborts with a parse-failure result, regardless of verdict.
    if (trimmedFindings.length > 0 && extracted.length === 0 && !isPlaceholder) {
      saveChainEntry({
        generation,
        base,
        status: 'aborted',
        reason: 'parse_failed',
      });
      console.error(`ERROR: Failed to parse non-empty findings for seat ${res.seat.id}`);
      process.exit(1);
    }

    const verdict = raw.verdict;
    const proof = (typeof raw.no_finding_proof === 'string') ? raw.no_finding_proof.trim() : '';

    if (verdict === 'FIX-THEN-SHIP') {
      if (extracted.length === 0) {
        // FIX-THEN-SHIP with empty findings is no_verdict
        res.status = 'no_verdict';
        raw.status = 'no_verdict';
        raw.verdict = 'no_verdict';
      } else if (raw.status === 'reviewed') {
        res.status = 'reviewed';
      } else {
        res.status = 'no_verdict';
      }
    } else if (verdict === 'SHIP-AS-IS') {
      if (extracted.length === 0) {
        if (!proof) {
          res.status = 'no_verdict';
          raw.status = 'no_verdict';
        } else if (raw.status === 'reviewed') {
          res.status = 'reviewed';
        } else {
          res.status = 'no_verdict';
        }
      } else if (raw.status === 'reviewed') {
        res.status = 'reviewed';
      } else {
        res.status = 'no_verdict';
      }
    } else {
      // verdict null, missing, or any other verdict
      // A seat whose verdict is null or missing is never counted as reviewed; treat it as a gap (no_verdict)
      // unless real findings parsed out of it.
      if (extracted.length > 0) {
        res.status = 'reviewed';
      } else {
        res.status = 'no_verdict';
        raw.status = 'no_verdict';
        raw.verdict = 'no_verdict';
      }
    }
  }

  // Extract findings
  const allFindings = [];
  let hasGap = false;
  const seatIds = seats.map((s) => s.id);

  for (const res of seatResults) {
    if (res.status === 'reviewed') {
      const seatFindings = seatFindingMap.get(res.seat.id) || [];
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
  const findingsContent = JSON.stringify(findingsJson, null, 2) + '\n';
  writeFileSyncAtomic(path.join(gDir, 'findings.json'), findingsContent);
  const findingsSha256 = crypto.createHash('sha256').update(findingsContent, 'utf8').digest('hex');

  // Seat gap status and counts for chain entry
  const seatRecords = seatResults.map((res) => ({
    id: res.seat.id,
    status: res.status === 'reviewed' ? 'reviewed' : 'no_verdict',
  }));
  const reviewedSeatsCount = seatResults.filter((r) => r.status === 'reviewed').length;
  const totalSeatsCount = seatResults.length;

  // Update chain.json
  const genStatus = hasGap ? 'pending-with-gap' : 'pending';
  saveChainEntry({
    generation,
    base,
    head,
    seats: seatRecords,
    reviewed_seats: reviewedSeatsCount,
    total_seats: totalSeatsCount,
    reviewed_seats_count: reviewedSeatsCount,
    total_seats_count: totalSeatsCount,
    status: genStatus,
    diff_sha256: diffSha256,
    full_range_sha256: fullRangeSha256,
    findings_sha256: findingsSha256,
    seat_artifact_sha256: seatArtifactSha256,
  });

  const seatSummaries = {};
  for (const res of seatResults) {
    const extracted = seatFindingMap.get(res.seat.id) || [];
    const proof = (res.rawOutput && typeof res.rawOutput.no_finding_proof === 'string')
      ? res.rawOutput.no_finding_proof.trim()
      : '';
    seatSummaries[res.seat.id] = {
      findings_count: extracted.length,
      proof_present: proof.length > 0,
    };
  }

  // Output summary JSON
  const summary = {
    phase,
    generation,
    base,
    head,
    seats: seatIds,
    findings_count: allFindings.length,
    status: genStatus,
    seat_summaries: seatSummaries,
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
  const rangePath = path.join(gDir, 'range.json');

  // Require readable range.json file for that generation
  if (!fs.existsSync(rangePath)) {
    console.error(`ERROR: Missing or unreadable range.json at ${rangePath}`);
    process.exit(1);
  }
  let rangeObj;
  try {
    rangeObj = JSON.parse(fs.readFileSync(rangePath, 'utf8'));
    if (!rangeObj || typeof rangeObj !== 'object') {
      console.error(`ERROR: Invalid range.json at ${rangePath}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`ERROR: Failed to parse range.json at ${rangePath}: ${e.message}`);
    process.exit(1);
  }

  // Chain entry validation
  const chainPath = path.join(reviewPhaseDir, 'chain.json');
  let chain = [];
  if (!fs.existsSync(chainPath)) {
    console.error(`ERROR: Missing chain.json at ${chainPath}`);
    process.exit(1);
  }
  try {
    chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR: Failed to parse chain.json at ${chainPath}: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(chain)) {
    console.error(`ERROR: Malformed chain.json at ${chainPath}: expected array`);
    process.exit(1);
  }

  // When more than one chain entry exists for the same generation, select the last one in the chain array
  let targetChainIdx = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i] && chain[i].generation === generation) {
      targetChainIdx = i;
      break;
    }
  }

  if (targetChainIdx === -1) {
    console.error(`ERROR: No chain entry found for generation ${generation}`);
    process.exit(1);
  }

  const targetChainEntry = chain[targetChainIdx];
  const allowedPendingStatuses = new Set(['pending', 'pending-with-gap']);
  if (!allowedPendingStatuses.has(targetChainEntry.status)) {
    console.error(`ERROR: Chain entry for generation ${generation} is not pending (got '${targetChainEntry.status}')`);
    process.exit(1);
  }

  // Never fabricate or default a chain entry with a blank base or head field if the real entry is missing fields
  if (!targetChainEntry.base || typeof targetChainEntry.base !== 'string' || !targetChainEntry.base.trim() ||
      !targetChainEntry.head || typeof targetChainEntry.head !== 'string' || !targetChainEntry.head.trim()) {
    console.error(`ERROR: Chain entry for generation ${generation} is missing base or head field`);
    process.exit(1);
  }

  // Validate findings.json
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

  if (!findingsData || typeof findingsData !== 'object' || Array.isArray(findingsData) || !Array.isArray(findingsData.findings)) {
    console.error(`ERROR: findings.json must be a JSON object holding a findings array`);
    process.exit(1);
  }

  const findingsList = findingsData.findings;
  const findingsMap = new Map();
  for (let i = 0; i < findingsList.length; i++) {
    const f = findingsList[i];
    if (!f || typeof f !== 'object') {
      console.error(`ERROR: Finding entry at index ${i} is not an object`);
      process.exit(1);
    }
    if (typeof f.id !== 'string' || f.id.trim().length === 0) {
      console.error(`ERROR: Finding entry at index ${i} has empty or non-string id`);
      process.exit(1);
    }
    if (findingsMap.has(f.id)) {
      console.error(`ERROR: Duplicate finding id in findings.json: ${f.id}`);
      process.exit(1);
    }
    if (!SEVERITY_WORDS.has(f.severity)) {
      console.error(`ERROR: Finding ${f.id} has invalid severity '${f.severity}' (must be Critical, Major, Minor, or Suggestion)`);
      process.exit(1);
    }
    findingsMap.set(f.id, f);
  }

  // Validate dispositions file
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

  if (!dispData || typeof dispData !== 'object' || Array.isArray(dispData) || !Array.isArray(dispData.findings)) {
    console.error(`ERROR: Dispositions file must be a JSON object holding a findings array`);
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

  const allowedDispositions = new Set(['verified', 'refuted', 'deferred']);
  const dispFindings = dispData.findings;
  const dispMap = new Map();
  for (let i = 0; i < dispFindings.length; i++) {
    const df = dispFindings[i];
    if (!df || typeof df !== 'object') {
      console.error(`ERROR: Dispositions entry at index ${i} is not an object`);
      process.exit(1);
    }
    if (typeof df.id !== 'string' || df.id.trim().length === 0) {
      console.error(`ERROR: Dispositions entry at index ${i} has empty or non-string id`);
      process.exit(1);
    }
    if (dispMap.has(df.id)) {
      console.error(`ERROR: Duplicate finding id in dispositions file: ${df.id}`);
      process.exit(1);
    }
    if (!allowedDispositions.has(df.disposition)) {
      console.error(`ERROR: Finding ${df.id} has invalid disposition '${df.disposition}' (must be verified, refuted, or deferred)`);
      process.exit(1);
    }
    if (typeof df.rationale !== 'string' || df.rationale.trim().length === 0) {
      console.error(`ERROR: Finding ${df.id} missing non-empty rationale string`);
      process.exit(1);
    }
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

  // Snapshot dispositions file into the generation's ledger directory as dispositions.json
  const snapshotRelPath = path.join(`review-${phase}`, `g${generation}`, 'dispositions.json');
  const snapshotAbsPath = path.join(gDir, 'dispositions.json');
  const dispRawBytes = fs.readFileSync(dispositionsFile);
  const dispSha256 = crypto.createHash('sha256').update(dispRawBytes).digest('hex');
  writeFileSyncAtomic(snapshotAbsPath, dispRawBytes);

  // Load findings and dispositions across generations in the chain
  const findingsByGeneration = new Map();
  const dispositionsByGeneration = new Map();

  for (const entry of chain) {
    const g = entry.generation;
    if (g === generation) {
      findingsByGeneration.set(g, findingsList);
      dispositionsByGeneration.set(g, dispFindings);
    } else if (entry.status === 'finalized' && entry.dispositions_path) {
      const earlierGDir = path.join(reviewPhaseDir, `g${g}`);
      const earlierFindingsPath = path.join(earlierGDir, 'findings.json');
      let earlierDispPath = entry.dispositions_path;
      if (!path.isAbsolute(earlierDispPath)) {
        earlierDispPath = path.join(ledgerDir, earlierDispPath);
      }
      let earlierFindings = [];
      let earlierDisps = [];
      // v2.36.3: disk evidence is the ONLY closure input (review-chain-derive no longer honours
      // chain-entry stamps), so an unreadable earlier generation must fail closed — defaulting
      // to [] would read as "that generation reported nothing" and close every open finding.
      try {
        const efData = JSON.parse(fs.readFileSync(earlierFindingsPath, 'utf8'));
        earlierFindings = Array.isArray(efData.findings) ? efData.findings : [];
      } catch (e) {
        console.error(`ERROR: Cannot read findings.json of finalized generation ${g} at ${earlierFindingsPath}: ${e.message}`);
        process.exit(1);
      }
      try {
        const edData = JSON.parse(fs.readFileSync(earlierDispPath, 'utf8'));
        earlierDisps = Array.isArray(edData.findings) ? edData.findings : [];
      } catch (e) {
        console.error(`ERROR: Cannot read dispositions of finalized generation ${g} at ${earlierDispPath}: ${e.message}`);
        process.exit(1);
      }
      findingsByGeneration.set(g, earlierFindings);
      dispositionsByGeneration.set(g, earlierDisps);
    }
  }

  // Derive final verdict, open findings, and closed findings using shared routine
  const derived = deriveReceiptState(chain, findingsByGeneration, dispositionsByGeneration);
  const verdict = derived.verdict;
  const openFindings = derived.open_findings || derived.openFindings;

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

    const baseSha = rangeObj.base || '';
    const headSha = rangeObj.head || '';
    briefLines.push(`Base: ${baseSha}`);
    briefLines.push(`Head: ${headSha}`);
    briefLines.push('');

    // One paragraph per verified finding (any severity) written in plain prose
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

    // Run scripts/check-redispatch-prompt.sh from __dirname (with env override)
    const checkScript = process.env.AUTOPILOT_CHECK_REDISPATCH_PROMPT_SCRIPT
      || path.join(__dirname, 'check-redispatch-prompt.sh');

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

  // Update target chain entry
  targetChainEntry.status = 'finalized';
  targetChainEntry.dispositions_path = snapshotRelPath;
  targetChainEntry.dispositions_sha256 = dispSha256;
  if (!targetChainEntry.findings_sha256 && fs.existsSync(findingsPath)) {
    targetChainEntry.findings_sha256 = crypto.createHash('sha256').update(fs.readFileSync(findingsPath)).digest('hex');
  }
  if (targetChainEntry.reviewed_seats === undefined && Array.isArray(targetChainEntry.seats)) {
    const revCount = targetChainEntry.seats.filter((s) => typeof s === 'string' || s.status === 'reviewed').length;
    targetChainEntry.reviewed_seats = revCount;
    targetChainEntry.total_seats = targetChainEntry.seats.length;
    targetChainEntry.reviewed_seats_count = revCount;
    targetChainEntry.total_seats_count = targetChainEntry.seats.length;
  }

  writeFileSyncAtomic(chainPath, JSON.stringify(chain, null, 2) + '\n');

  // Receipt
  let phaseBaseSha = '';
  const gen1Entry = chain.find((c) => c && c.generation === 1);
  if (gen1Entry && gen1Entry.base) {
    phaseBaseSha = gen1Entry.base;
  }

  const resolverPath = getResolverPath(repoRoot);
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

  if (!fs.existsSync(configPath)) {
    console.error(`ERROR: Config source file does not exist at ${configPath}`);
    process.exit(1);
  }

  let configuredValue = 'absent';
  let configBytes;

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
  } catch (e) {
    console.error(`ERROR: Failed to read config source file at ${configPath}: ${e.message}`);
    process.exit(1);
  }

  const sha256 = crypto.createHash('sha256').update(configBytes).digest('hex');
  const configSource = {
    path: configPath,
    sha256,
  };

  const resolverPath = getResolverPath(repoRoot);
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
