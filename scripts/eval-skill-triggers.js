#!/usr/bin/env node
/**
 * eval-skill-triggers.js -- S10 P2 skill trigger evaluator.
 *
 * Runs prompts from --should-trigger and --should-not-trigger against `claude -p`
 * (or an injected runner for tests) using isolated temp HOME and CLAUDE_CONFIG_DIR.
 *
 * Counting rules:
 * - Only counts `assistant` messages' `tool_use` blocks where `name === 'Skill'`
 *   and extracts `input.skill`.
 * - Ignores `system/init` and all non-Skill events.
 * - `--out <path>` writes per-skill hit_rate and false_positive_rate JSON.
 * - `--compare <baseline.json>` exits non-zero if any skill's hit_rate is lower
 *   or false_positive_rate is higher than baseline.
 * - `--budget-usd <num>` stops immediately when cumulative cost exceeds budget,
 *   writes partial results to `--out` (if set), and exits non-zero.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function parseArgs(argv) {
  const opts = {
    shouldTrigger: 'evals/trigger-prompts/s10-should-trigger.txt',
    shouldNotTrigger: 'evals/trigger-prompts/s10-should-not-trigger.txt',
    out: null,
    compare: null,
    budgetUsd: null,
    pluginDir: process.cwd(),
    timeoutMs: 120000,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--should-trigger') opts.shouldTrigger = argv[++i];
    else if (arg === '--should-not-trigger') opts.shouldNotTrigger = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--compare') opts.compare = argv[++i];
    else if (arg === '--budget-usd') opts.budgetUsd = Number(argv[++i]);
    else if (arg === '--plugin-dir') opts.pluginDir = argv[++i];
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function parsePromptFile(filePath, { requireSkill = false } = {}) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const pipeIdx = trimmed.indexOf('|');
    if (pipeIdx !== -1) {
      const skill = trimmed.slice(0, pipeIdx).trim();
      const prompt = trimmed.slice(pipeIdx + 1).trim();
      if (skill && prompt) {
        entries.push({ skill, prompt });
        continue;
      }
    }
    if (requireSkill) {
      throw new Error(`Expected "<skill> | <prompt>" in ${filePath}: ${trimmed}`);
    }
    entries.push({ skill: null, prompt: trimmed });
  }
  return entries;
}

/**
 * Parse stream-json NDJSON output.
 * Counts ONLY assistant `tool_use` blocks with `name === 'Skill'`.
 * Ignores `system/init` and all other events.
 */
function parseStreamJsonTriggers(ndjsonText) {
  const triggeredSkills = [];
  let costUsd = 0;
  for (const line of String(ndjsonText || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    if (obj.type === 'system') continue;
    if (obj.type === 'assistant' && obj.message && Array.isArray(obj.message.content)) {
      for (const block of obj.message.content) {
        if (
          block &&
          block.type === 'tool_use' &&
          block.name === 'Skill' &&
          block.input &&
          typeof block.input.skill === 'string' &&
          block.input.skill.trim()
        ) {
          triggeredSkills.push(block.input.skill.trim());
        }
      }
    }
    if (obj.type === 'result') {
      if (typeof obj.total_cost_usd === 'number') costUsd = obj.total_cost_usd;
      else if (typeof obj.cost_usd === 'number') costUsd = obj.cost_usd;
    }
  }
  return { triggeredSkills, costUsd };
}

// The account layer (claude-account.js exec --pick) supplies the credential straight into the child env; it never
// reaches argv, a log or this process. The temp HOME/CLAUDE_CONFIG_DIR in `env` keep the run off the real config.
function defaultRunner({ prompt, pluginDir, timeoutMs, env }) {
  const stdout = execFileSync(
    process.execPath,
    [
      path.join(__dirname, 'claude-account.js'), 'exec', '--pick', '--purpose', 'skill-trigger-eval', '--', 'claude',
      '-p',
      prompt,
      '--plugin-dir',
      pluginDir,
      '--dangerously-skip-permissions',
      '--max-turns',
      '2',
      '--output-format',
      'stream-json',
    ],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  return stdout;
}

function ensureSkillBucket(skills, skillName) {
  if (!skills[skillName]) {
    skills[skillName] = {
      positive_total: 0,
      positive_hits: 0,
      hit_rate: 0,
      negative_total: 0,
      negative_hits: 0,
      false_positive_rate: 0,
    };
  }
  return skills[skillName];
}

function finalizeMetrics(skills, unscopedNeg) {
  for (const bucket of Object.values(skills)) {
    bucket.hit_rate = bucket.positive_total > 0 ? bucket.positive_hits / bucket.positive_total : 0;
    bucket.false_positive_rate =
      bucket.negative_total > 0 ? bucket.negative_hits / bucket.negative_total : 0;
  }
  unscopedNeg.false_positive_rate =
    unscopedNeg.total > 0 ? unscopedNeg.hits / unscopedNeg.total : 0;
}

function compareAgainstBaseline(report, baseline) {
  const regressions = [];
  const baseSkills = (baseline && baseline.skills) || {};
  for (const [skill, base] of Object.entries(baseSkills)) {
    const curr = report.skills[skill];
    if (!curr) {
      regressions.push({ skill, reason: 'missing_in_current' });
      continue;
    }
    if (typeof base.hit_rate === 'number' && curr.hit_rate < base.hit_rate) {
      regressions.push({
        skill,
        reason: 'hit_rate_regressed',
        baseline: base.hit_rate,
        current: curr.hit_rate,
      });
    }
    if (
      typeof base.false_positive_rate === 'number' &&
      curr.false_positive_rate > base.false_positive_rate
    ) {
      regressions.push({
        skill,
        reason: 'false_positive_rate_regressed',
        baseline: base.false_positive_rate,
        current: curr.false_positive_rate,
      });
    }
  }
  return regressions;
}

function runSuite(opts, { runner = defaultRunner } = {}) {
  const positives = parsePromptFile(opts.shouldTrigger, { requireSkill: true });
  const negatives = parsePromptFile(opts.shouldNotTrigger, { requireSkill: false });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-skill-triggers-'));
  const tempHome = path.join(tmpRoot, 'home');
  const tempConfigDir = path.join(tmpRoot, 'claude-config');
  fs.mkdirSync(tempHome, { recursive: true });
  fs.mkdirSync(tempConfigDir, { recursive: true });

  const childEnv = {
    ...process.env,
    HOME: tempHome,
    CLAUDE_CONFIG_DIR: tempConfigDir,
  };

  const skills = {};
  const unscopedNeg = { total: 0, hits: 0, false_positive_rate: 0 };
  let totalCostUsd = 0;
  let budgetExceeded = false;

  try {
    const queue = [
      ...positives.map((e) => ({ kind: 'positive', ...e })),
      ...negatives.map((e) => ({ kind: 'negative', ...e })),
    ];

    for (const item of queue) {
      if (
        typeof opts.budgetUsd === 'number' &&
        !Number.isNaN(opts.budgetUsd) &&
        totalCostUsd > opts.budgetUsd
      ) {
        budgetExceeded = true;
        break;
      }

      const rawStream = runner({
        prompt: item.prompt,
        skill: item.skill,
        kind: item.kind,
        pluginDir: opts.pluginDir,
        timeoutMs: opts.timeoutMs,
        env: childEnv,
      });

      const { triggeredSkills, costUsd } = parseStreamJsonTriggers(rawStream);
      totalCostUsd += costUsd;

      if (item.kind === 'positive') {
        const bucket = ensureSkillBucket(skills, item.skill);
        bucket.positive_total += 1;
        if (triggeredSkills.includes(item.skill)) {
          bucket.positive_hits += 1;
        }
      } else if (item.skill) {
        const bucket = ensureSkillBucket(skills, item.skill);
        bucket.negative_total += 1;
        if (triggeredSkills.includes(item.skill)) {
          bucket.negative_hits += 1;
        }
      } else {
        unscopedNeg.total += 1;
        if (triggeredSkills.some((s) => s.startsWith('autopilot:'))) {
          unscopedNeg.hits += 1;
        }
      }

      if (
        typeof opts.budgetUsd === 'number' &&
        !Number.isNaN(opts.budgetUsd) &&
        totalCostUsd > opts.budgetUsd
      ) {
        budgetExceeded = true;
        break;
      }
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  finalizeMetrics(skills, unscopedNeg);

  const report = {
    schema_version: 1,
    partial: budgetExceeded,
    total_cost_usd: Number(totalCostUsd.toFixed(6)),
    budget_usd: opts.budgetUsd ?? null,
    skills,
    unscoped_negative: unscopedNeg,
  };

  if (opts.out) {
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  let regressions = [];
  if (opts.compare) {
    const baseline = JSON.parse(fs.readFileSync(opts.compare, 'utf8'));
    regressions = compareAgainstBaseline(report, baseline);
  }

  let exitCode = 0;
  if (budgetExceeded) exitCode = 2;
  else if (regressions.length > 0) exitCode = 1;

  return { report, regressions, budgetExceeded, exitCode };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(
      'Usage: eval-skill-triggers.js [--should-trigger <file>] [--should-not-trigger <file>] [--out <file>] [--compare <baseline.json>] [--budget-usd <num>] [--plugin-dir <dir>] [--timeout-ms <ms>]\n'
    );
    process.exit(0);
  }
  const { report, regressions, budgetExceeded, exitCode } = runSuite(opts);
  if (budgetExceeded) {
    process.stderr.write(
      `eval-skill-triggers: budget exceeded (${report.total_cost_usd} > ${opts.budgetUsd}); partial results written\n`
    );
  }
  if (regressions.length > 0) {
    process.stderr.write(
      `eval-skill-triggers: ${regressions.length} regression(s) vs baseline: ${JSON.stringify(regressions)}\n`
    );
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  parsePromptFile,
  parseStreamJsonTriggers,
  compareAgainstBaseline,
  runSuite,
};
