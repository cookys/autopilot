#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HIGH_RISK_PATH = path.join(__dirname, 'lib', 'high-risk-paths.json');

function loadHighRiskGlobs() {
  try {
    const raw = fs.readFileSync(HIGH_RISK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function globToRegex(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('\\.^$+()[]{}|'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchHighRiskPaths(filePaths, globs) {
  const regexes = globs.map(globToRegex);
  return filePaths.filter((p) => regexes.some((re) => re.test(p)));
}

function gitNumstat(repoDir, base, head) {
  const out = execFileSync(
    'git',
    ['-C', repoDir, 'diff', '--numstat', `${base}..${head}`],
    { encoding: 'utf8' }
  );
  const files = [];
  let diffLines = 0;
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? 0 : (parseInt(parts[0], 10) || 0);
    const deleted = parts[1] === '-' ? 0 : (parseInt(parts[1], 10) || 0);
    const filePath = parts.slice(2).join('\t');
    files.push({ path: filePath, added, deleted });
    diffLines += added + deleted;
  }
  return { files, diff_lines: diffLines };
}

function gitBranch(repoDir) {
  try {
    return execFileSync(
      'git',
      ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return 'HEAD';
  }
}

function commitExists(repoDir, head) {
  if (!head) return false;
  try {
    execFileSync(
      'git',
      ['-C', repoDir, 'rev-parse', '--verify', `${head}^{commit}`],
      { encoding: 'utf8', stdio: 'pipe' }
    );
    return true;
  } catch {
    return false;
  }
}

function parseNotes(notesPath) {
  if (!notesPath) return { tests: [], tests_green: false, risk: null };
  let raw;
  try {
    raw = fs.readFileSync(notesPath, 'utf8');
  } catch {
    return { tests: [], tests_green: false, risk: null };
  }
  if (!raw.trim()) return { tests: [], tests_green: false, risk: null };

  const lines = raw.split(/\r?\n/);
  let section = '';
  const tests = [];
  const riskLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Tests\b/i.test(trimmed)) {
      section = 'tests';
      continue;
    }
    if (/^##\s+Risk\b/i.test(trimmed)) {
      section = 'risk';
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      section = '';
      continue;
    }
    if (!trimmed) continue;

    if (section === 'tests') {
      const m = trimmed.match(/^(\d+)\s+(.+)$/);
      if (m) {
        tests.push({ cmd: m[2].trim(), rc: parseInt(m[1], 10) });
      }
    } else if (section === 'risk') {
      riskLines.push(trimmed);
    }
  }

  let risk = null;
  if (riskLines.length > 0) {
    const first = riskLines[0].toLowerCase();
    const levelMatch = first.match(/^(low|medium|high)\b(.*)$/);
    if (levelMatch) {
      const level = levelMatch[1];
      const restFirst = levelMatch[2].replace(/^[:\-\s]+/, '').trim();
      const noteParts = [];
      if (restFirst) noteParts.push(restFirst);
      if (riskLines.length > 1) noteParts.push(...riskLines.slice(1));
      risk = { level, note: noteParts.join(' ').trim() };
    }
  }

  const tests_green = tests.length > 0 && tests.every((t) => t.rc === 0);
  return { tests, tests_green, risk };
}

function readOptionalJson(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildPack(opts) {
  const { repo, base, head, runId, fleetTask, branch, notes, review, usage, out, runner } = opts;
  if (!repo || !base || !head || !runId || !out) {
    throw new Error('Missing required flags: --repo, --base, --head, --run-id, --out');
  }
  const { files, diff_lines } = gitNumstat(repo, base, head);
  const globs = loadHighRiskGlobs();
  const high_risk_paths = matchHighRiskPaths(files.map((f) => f.path), globs);
  const { tests, tests_green, risk } = parseNotes(notes);
  const reviewObj = readOptionalJson(review);
  const usageObj = readOptionalJson(usage);

  const mergeable_reasons = [];
  if (!tests_green) mergeable_reasons.push('tests_not_green');
  if (high_risk_paths.length > 0) mergeable_reasons.push('high_risk_paths');
  if (!risk) mergeable_reasons.push('risk_missing');
  else if (risk.level === 'high') mergeable_reasons.push('risk_high');
  if (!commitExists(repo, head)) mergeable_reasons.push('commit_missing');

  const mergeable = mergeable_reasons.length === 0;

  const isClaudeRunner = !runner || runner === 'claude-native' || runner === 'cc-shim' || runner.startsWith('claude');
  let claude_usage;
  if (!isClaudeRunner) {
    claude_usage = { runner, claude_tokens: 0 };
  } else if (usageObj && typeof usageObj === 'object') {
    claude_usage = { tokens: Number(usageObj.tokens || 0), usd: Number(usageObj.usd || 0) };
  } else {
    claude_usage = null;
    mergeable_reasons.push('claude_usage_missing');
  }

  const pack = {
    schema: 'autopilot.evidence-pack/1',
    fleet_task: fleetTask || null,
    run_id: runId,
    branch: branch || gitBranch(repo),
    base,
    head,
    files,
    diff_lines,
    tests,
    tests_green,
    review: reviewObj && typeof reviewObj === 'object'
      ? { verdict: String(reviewObj.verdict || ''), critical: Number(reviewObj.critical || 0) }
      : null,
    risk,
    high_risk_paths,
    mergeable,
    mergeable_reasons,
    claude_usage,
  };

  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(pack, null, 2) + '\n', 'utf8');
  return pack;
}

function showPack(packPath) {
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  const lines = [
    `Evidence Pack (${pack.schema})`,
    `Run: ${pack.run_id} | Branch: ${pack.branch} | Fleet-Task: ${pack.fleet_task || 'none'}`,
    `Range: ${String(pack.base).slice(0, 8)}..${String(pack.head).slice(0, 8)}`,
    `Files: ${pack.files.length} changed, ${pack.diff_lines} diff lines`,
    `High-risk: ${pack.high_risk_paths.length ? pack.high_risk_paths.join(', ') : 'none'}`,
    `Tests: ${pack.tests_green ? 'GREEN' : 'NOT GREEN'} (${pack.tests.length} recorded)`,
    ...pack.tests.slice(0, 4).map((t) => `  [${t.rc}] ${t.cmd}`),
    `Risk: ${pack.risk ? `${pack.risk.level} — ${pack.risk.note}` : 'none'}`,
    `Review: ${pack.review ? `${pack.review.verdict} (critical: ${pack.review.critical})` : 'none'}`,
    `Usage: ${pack.claude_usage ? (pack.claude_usage.runner ? `${pack.claude_usage.runner}: ${pack.claude_usage.claude_tokens} claude tokens` : `${pack.claude_usage.tokens} tokens ($${pack.claude_usage.usd})`) : 'none'}`,
  ];
  return lines.slice(0, 15).join('\n') + '\n';
}

function parseArgs(argv) {
  const cmd = argv[2];
  if (cmd === 'show') {
    return { cmd: 'show', packPath: argv[3] };
  }
  if (cmd === 'build') {
    const opts = { cmd: 'build' };
    for (let i = 3; i < argv.length; i += 1) {
      const a = argv[i];
      const v = argv[i + 1];
      if (a === '--repo') { opts.repo = v; i += 1; }
      else if (a === '--base') { opts.base = v; i += 1; }
      else if (a === '--head') { opts.head = v; i += 1; }
      else if (a === '--run-id') { opts.runId = v; i += 1; }
      else if (a === '--fleet-task') { opts.fleetTask = v; i += 1; }
      else if (a === '--branch') { opts.branch = v; i += 1; }
      else if (a === '--notes') { opts.notes = v; i += 1; }
      else if (a === '--review') { opts.review = v; i += 1; }
      else if (a === '--usage') { opts.usage = v; i += 1; }
      else if (a === '--runner') { opts.runner = v; i += 1; }
      else if (a === '--out') { opts.out = v; i += 1; }
    }
    return opts;
  }
  return { cmd: null };
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (args.cmd === 'build') {
    buildPack(args);
  } else if (args.cmd === 'show') {
    if (!args.packPath) {
      process.stderr.write('Usage: evidence-pack.js show <pack.json>\n');
      process.exit(2);
    }
    process.stdout.write(showPack(args.packPath));
  } else {
    process.stderr.write('Usage: evidence-pack.js <build|show> ...\n');
    process.exit(2);
  }
}

module.exports = {
  loadHighRiskGlobs,
  globToRegex,
  matchHighRiskPaths,
  parseNotes,
  buildPack,
  showPack,
};
