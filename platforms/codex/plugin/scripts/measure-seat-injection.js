#!/usr/bin/env node
'use strict';

/**
 * S10 P0 measurement tool and baseline gate for seat injection.
 *
 * Subcommands:
 *   --check-baseline
 *   --check-budget --max-desc-total <T> --max-desc-each <E>
 *   --check-targets
 *   --compare <a.json> <b.json>
 *   --from-trace <jsonl>
 *
 * Optional flags:
 *   --baseline <path>   Path to baseline.json (default: project/evidence/s10/baseline.json)
 *   --trace <path>      Path to pm-events.jsonl (default: project/evidence/s10/pm-events.jsonl)
 *   --root <dir>        Repo root override (for tests)
 *   --help, -h          Show help
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const opts = {
    mode: null,
    maxDescTotal: null,
    maxDescEach: null,
    compareFiles: [],
    fromTracePath: null,
    baselinePath: null,
    tracePath: null,
    rootDir: null,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--check-baseline') {
      opts.mode = 'check-baseline';
    } else if (arg === '--check-budget') {
      opts.mode = 'check-budget';
    } else if (arg === '--check-targets') {
      opts.mode = 'check-targets';
    } else if (arg === '--compare') {
      opts.mode = 'compare';
      opts.compareFiles = [argv[++i], argv[++i]];
    } else if (arg === '--from-trace') {
      opts.mode = 'from-trace';
      opts.fromTracePath = argv[++i];
    } else if (arg === '--max-desc-total') {
      opts.maxDescTotal = Number(argv[++i]);
    } else if (arg === '--max-desc-each') {
      opts.maxDescEach = Number(argv[++i]);
    } else if (arg === '--baseline') {
      opts.baselinePath = argv[++i];
    } else if (arg === '--trace') {
      opts.tracePath = argv[++i];
    } else if (arg === '--root') {
      opts.rootDir = argv[++i];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/**
 * Extract frontmatter `description` from SKILL.md content:
 * strip YAML block indicators (`>`, `|`, `>-`, `|-`), fold lines, trim.
 */
function parseSkillDescription(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  const fm = match[1];
  const lines = fm.split(/\r?\n/);
  let inDesc = false;
  let baseIndent = null;
  const parts = [];

  for (const line of lines) {
    if (!inDesc) {
      const m = line.match(/^description:\s*(.*)$/);
      if (m) {
        inDesc = true;
        const rest = m[1].trim();
        if (rest && !/^[>|][+-]?$/.test(rest)) {
          parts.push(rest.replace(/^['"]|['"]$/g, ''));
          if (!/^[>|]/.test(rest)) {
            // Check if next lines are indented continuation
          }
        }
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:\s*/.test(line)) {
      break;
    }
    if (line.trim() === '') {
      continue;
    }
    const indentMatch = line.match(/^(\s+)/);
    if (!indentMatch) {
      break;
    }
    if (baseIndent === null) {
      baseIndent = indentMatch[1].length;
    }
    parts.push(line.trim());
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Compute reachable floor bytes: only `Use when` and `Not for` segments.
 */
function computeReachableFloor(desc) {
  const useWhen = desc.match(/Use when:\s*[^.]*(?:\.|$)/i);
  const notFor = desc.match(/Not for:\s*[^.]*(?:\.|$)/i);
  const kept = [useWhen ? useWhen[0].trim() : '', notFor ? notFor[0].trim() : '']
    .filter(Boolean)
    .join(' ');
  return Buffer.byteLength(kept, 'utf8');
}

function measureSkills(rootDir) {
  const skillsDir = path.join(rootDir, 'skills');
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const skills = {};
  let totalBytes = 0;
  let floorTotalBytes = 0;

  for (const name of entries) {
    const skillPath = path.join(skillsDir, name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, 'utf8');
    const desc = parseSkillDescription(content);
    const bytes = Buffer.byteLength(desc, 'utf8');
    skills[name] = bytes;
    totalBytes += bytes;
    floorTotalBytes += computeReachableFloor(desc);
  }

  return {
    description_total_bytes: totalBytes,
    reachable_floor_bytes: floorTotalBytes,
    skills,
  };
}

function parseTrace(jsonlPath) {
  const raw = fs.readFileSync(jsonlPath, 'utf8');
  const byEvent = {};
  const byHook = {};
  const targetCandidates = {};
  let prompts = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed);
    if (row.kind === 'prompt') { prompts += 1; continue; }
    const bytes = (Number(row.context_bytes) || 0) + (Number(row.stdout_bytes) || 0);
    const ev = row.event || 'unknown';
    const hk = row.hook || ev;

    byEvent[ev] = (byEvent[ev] || 0) + bytes;
    byHook[hk] = (byHook[hk] || 0) + bytes;

    if (ev === 'UserPromptSubmit' || ev === 'PreToolUse') {
      targetCandidates[hk] = (targetCandidates[hk] || 0) + bytes;
    }
  }

  const totalTargetBytes = Object.values(targetCandidates).reduce((a, b) => a + b, 0);
  const targets = totalTargetBytes === 0
    ? []
    : Object.entries(targetCandidates)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([hook, baselineBytes]) => ({
        hook,
        baseline_bytes: baselineBytes,
        threshold_50pct: Math.floor(baselineBytes * 0.5),
      }));

  return { by_event: byEvent, by_hook: byHook, targets, prompts };
}

function checkBaseline(rootDir, baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const current = measureSkills(rootDir);
  const mismatches = [];

  if (current.description_total_bytes !== baseline.description_total_bytes) {
    mismatches.push(
      `description_total_bytes: expected ${baseline.description_total_bytes}, got ${current.description_total_bytes}`
    );
  }

  const baselineSkills = baseline.skills || {};
  for (const [name, expectedBytes] of Object.entries(baselineSkills)) {
    const actualBytes = current.skills[name];
    if (actualBytes !== expectedBytes) {
      mismatches.push(`skill ${name}: expected ${expectedBytes}, got ${actualBytes}`);
    }
  }

  return { ok: mismatches.length === 0, mismatches, current };
}

function getHeadTotalBytes(rootDir) {
  try {
    const filesRaw = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'skills'], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    let total = 0;
    for (const rel of filesRaw.split(/\r?\n/)) {
      if (!rel.endsWith('/SKILL.md')) continue;
      const content = execFileSync('git', ['show', `HEAD:${rel}`], {
        cwd: rootDir,
        encoding: 'utf8',
      });
      total += Buffer.byteLength(parseSkillDescription(content), 'utf8');
    }
    return total;
  } catch {
    return null;
  }
}

function checkBudget(rootDir, maxDescTotal, maxDescEach) {
  if (!Number.isFinite(maxDescTotal) || !Number.isFinite(maxDescEach)) {
    throw new Error('--check-budget requires --max-desc-total <T> and --max-desc-each <E>');
  }
  const current = measureSkills(rootDir);
  const violations = [];

  if (current.description_total_bytes > maxDescTotal) {
    violations.push(`description_total_bytes ${current.description_total_bytes} > ${maxDescTotal}`);
  }
  for (const [name, bytes] of Object.entries(current.skills)) {
    if (bytes > maxDescEach) {
      violations.push(`skill ${name} ${bytes} > ${maxDescEach}`);
    }
  }
  const headTotal = getHeadTotalBytes(rootDir);
  if (headTotal !== null && current.description_total_bytes > headTotal) {
    violations.push(`description_total_bytes ${current.description_total_bytes} > HEAD ${headTotal}`);
  }

  return { ok: violations.length === 0, violations, current, head_total_bytes: headTotal };
}

const MIN_PROMPTS = 50;

// Per-prompt average, not totals (PM ruling 01M8B7T6VD): totals follow how long the window was. Too few prompts, or a
// baseline without its prompt count, is red — never a pass by absence of data.
function checkTargets(baselinePath, tracePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const trace = parseTrace(tracePath);
  const prompts = trace.prompts;
  const violations = [];

  if (!(baseline.baseline_prompts > 0)) violations.push('baseline_prompts missing: export the baseline window with export-hook-trace.js and record its prompt count');
  if (prompts < MIN_PROMPTS) violations.push(`insufficient sample: ${prompts} prompts < ${MIN_PROMPTS}`);
  if (violations.length) return { ok: false, violations, prompts };

  for (const target of baseline.targets || []) {
    const actual = (trace.by_hook[target.hook] || 0) / prompts;
    const limit = (target.baseline_bytes / baseline.baseline_prompts) * 0.5;
    if (actual > limit) {
      violations.push(`${target.hook}: ${actual.toFixed(1)} B/prompt > threshold ${limit.toFixed(1)}`);
    }
  }

  return { ok: violations.length === 0, violations, prompts };
}

function compareResults(aPath, bPath) {
  const a = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  const b = JSON.parse(fs.readFileSync(bPath, 'utf8'));
  const regressions = [];

  if (typeof a.description_total_bytes === 'number' && typeof b.description_total_bytes === 'number') {
    if (b.description_total_bytes > a.description_total_bytes) {
      regressions.push(`description_total_bytes: ${b.description_total_bytes} > ${a.description_total_bytes}`);
    }
  }
  if (a.skills && b.skills) {
    for (const [name, aVal] of Object.entries(a.skills)) {
      if (typeof b.skills[name] === 'number' && b.skills[name] > aVal) {
        regressions.push(`skill ${name}: ${b.skills[name]} > ${aVal}`);
      }
    }
  }

  return { ok: regressions.length === 0, regressions };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.mode) {
    console.log('Usage: node scripts/measure-seat-injection.js [--check-baseline | --check-budget --max-desc-total T --max-desc-each E | --check-targets | --compare a.json b.json | --from-trace trace.jsonl]');
    process.exit(opts.help ? 0 : 2);
  }

  const rootDir = opts.rootDir || path.resolve(__dirname, '..');
  const baselinePath = opts.baselinePath || path.join(rootDir, 'project/evidence/s10/baseline.json');
  const tracePath = opts.tracePath || path.join(rootDir, 'project/evidence/s10/pm-events.jsonl');

  if (opts.mode === 'from-trace') {
    const res = parseTrace(opts.fromTracePath);
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }

  if (opts.mode === 'check-baseline') {
    const res = checkBaseline(rootDir, baselinePath);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  if (opts.mode === 'check-budget') {
    const res = checkBudget(rootDir, opts.maxDescTotal, opts.maxDescEach);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  if (opts.mode === 'check-targets') {
    const res = checkTargets(baselinePath, tracePath);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }

  if (opts.mode === 'compare') {
    const res = compareResults(opts.compareFiles[0], opts.compareFiles[1]);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseSkillDescription,
  computeReachableFloor,
  measureSkills,
  parseTrace,
  checkBaseline,
  checkBudget,
  checkTargets,
  compareResults,
};
