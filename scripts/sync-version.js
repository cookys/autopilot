#!/usr/bin/env node
/**
 * sync-version — autopilot release manifest sync (v2.7.3+)
 *
 * Updates version + hook/skill counts across:
 *   - .claude-plugin/plugin.json
 *   - .claude-plugin/marketplace.json
 *   - hooks/hooks.json (description line, paren-wrapped version)
 *   - hooks/README.md (header count)
 *
 * USAGE:
 *   node scripts/sync-version.js --version 2.7.3 --hook-count 19 \
 *     --skill-count 16 --opt-in-count 7
 *   node scripts/sync-version.js --version 2.7.3 --hook-count 19 \
 *     --skill-count 16 --opt-in-count 7 --dry-run
 *
 * Safety (per L-5.2 r1 reviewer findings 2026-05-14):
 *   - Two-pass: pass 1 builds in-memory + asserts every replacement matched
 *     its expected count; pass 2 atomically commits writes
 *   - On any pass-1 failure → no file written, exit non-zero (no half-bump)
 *   - On pass-2 failure (rare — atomic write succeeded but somehow downstream
 *     fails) → restore from per-file `.bak.<pid>` backup
 *   - `--dry-run` prints proposed diff per file, writes nothing
 *
 * Inspired by autopilot's hook discipline (atomic write + chmod + fail-open),
 * adapted for one-shot release tool (fail-LOUD instead of fail-open).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// === CLI parse ===
function parseArgs(argv) {
  const args = { dryRun: false, optInCount: 7 }; // default 7 = current Tier B count
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version' || a === '-v') args.version = argv[++i];
    else if (a === '--hook-count' || a === '-H') args.hookCount = parseInt(argv[++i], 10);
    else if (a === '--skill-count' || a === '-S') args.skillCount = parseInt(argv[++i], 10);
    else if (a === '--opt-in-count' || a === '-O') args.optInCount = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { console.error(`unknown arg: ${a}`); printUsage(); process.exit(2); }
  }
  return args;
}

function printUsage() {
  console.log(`sync-version.js — autopilot release manifest sync

USAGE:
  node scripts/sync-version.js \\
    --version <V> --hook-count <N> --skill-count <M> [--opt-in-count <K>] [--dry-run] [--help]

ARGS:
  --version       new semver string (e.g. "2.7.3")
  --hook-count    total hooks (Tier A + Tier B; e.g. 19)
  --skill-count   total skills (currently 16)
  --opt-in-count  Tier B count (default 7); default-on count is computed
                  as (hook-count - opt-in-count)
  --dry-run       print proposed changes, write nothing
  --help          this message

OUTPUT:
  Modifies .claude-plugin/plugin.json, .claude-plugin/marketplace.json,
  hooks/hooks.json, hooks/README.md. Two-pass design: validates ALL files
  in memory before writing ANY file. On pass-1 fail → nothing written.`);
}

function validateArgs(a) {
  const errs = [];
  if (!a.version) errs.push('--version required');
  else if (!/^\d+\.\d+\.\d+$/.test(a.version)) errs.push(`invalid version "${a.version}" (expected N.N.N)`);
  if (!Number.isInteger(a.hookCount) || a.hookCount < 1 || a.hookCount > 100) errs.push(`--hook-count must be integer 1-100, got ${a.hookCount}`);
  if (!Number.isInteger(a.skillCount) || a.skillCount < 1 || a.skillCount > 100) errs.push(`--skill-count must be integer 1-100, got ${a.skillCount}`);
  if (!Number.isInteger(a.optInCount) || a.optInCount < 0 || a.optInCount >= a.hookCount) errs.push(`--opt-in-count must be integer 0..hook-count-1, got ${a.optInCount}`);
  if (errs.length) {
    errs.forEach(e => console.error(`error: ${e}`));
    process.exit(2);
  }
  a.defaultOnCount = a.hookCount - a.optInCount;
}

// === Per-file edit plan ===

function buildEditPlan(args) {
  const V = args.version;
  const H = args.hookCount;
  const D = args.defaultOnCount;
  const O = args.optInCount;
  const S = args.skillCount;

  return [
    {
      file: '.claude-plugin/plugin.json',
      replacements: [
        { find: /"version":\s*"[^"]+"/g, to: `"version": "${V}"`, expectAfter: 1, label: 'version field' },
        { find: /\b\d+ hooks \(\d+ default-on, \d+ opt-in\)/g, to: `${H} hooks (${D} default-on, ${O} opt-in)`, expectAfter: 1, label: 'description hook-count fragment' },
        { find: /\b\d+ lifecycle skills\b/g, to: `${S} lifecycle skills`, expectAfter: 1, label: 'description skill-count fragment' },
      ],
      // Post-edit guard: file contains exactly 1 line with new version
      verifyPatterns: [
        { regex: new RegExp(`"version":\\s*"${escapeRegex(V)}"`, 'g'), expect: 1, label: `JSON "version": "${V}"` },
      ],
    },
    {
      file: '.claude-plugin/marketplace.json',
      replacements: [
        { find: /"version":\s*"[^"]+"/g, to: `"version": "${V}"`, expectAfter: 1, label: 'version field' },
        { find: /\b\d+ hooks \(\d+ default-on, \d+ opt-in\)/g, to: `${H} hooks (${D} default-on, ${O} opt-in)`, expectAfter: 1, label: 'description hook-count fragment' },
        { find: /\b\d+ skills \+ 3 methodology agents/g, to: `${S} skills + 3 methodology agents`, expectAfter: 1, label: 'description skill-count fragment' },
      ],
      verifyPatterns: [
        { regex: new RegExp(`"version":\\s*"${escapeRegex(V)}"`, 'g'), expect: 1, label: `JSON "version": "${V}"` },
      ],
    },
    {
      file: 'hooks/hooks.json',
      replacements: [
        // description line: "session priming + N default-on Tier A hooks (vX.Y.Z)"
        { find: /session priming \+ \d+ default-on Tier A hooks \(v[0-9.]+\)/g, to: `session priming + ${D} default-on Tier A hooks (v${V})`, expectAfter: 1, label: 'description string' },
      ],
      // hooks.json has no JSON "version" key — version is paren-wrapped in description
      verifyPatterns: [
        { regex: new RegExp(`\\(v${escapeRegex(V)}\\)`, 'g'), expect: 1, label: `paren-version (v${V})` },
      ],
    },
    {
      file: 'hooks/README.md',
      replacements: [
        // header line: "N Claude Code hooks ... (D Tier A default-on + O Tier B opt-in)"
        { find: /\b\d+ Claude Code hooks for runtime enforcement of development discipline \(\d+ Tier A default-on \+ \d+ Tier B opt-in\)/g, to: `${H} Claude Code hooks for runtime enforcement of development discipline (${D} Tier A default-on + ${O} Tier B opt-in)`, expectAfter: 1, label: 'header hook-count line' },
      ],
      // README is markdown; no JSON-key verify. Just confirm new count fragment is present.
      verifyPatterns: [
        { regex: new RegExp(`${H} Claude Code hooks for runtime enforcement`, 'g'), expect: 1, label: `header has new count ${H}` },
      ],
    },
  ];
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// === Pass 1: compute new content + validate each replacement applied as expected ===

function buildNewContent(plan) {
  const target = path.join(REPO_ROOT, plan.file);
  if (!fs.existsSync(target)) {
    return { file: plan.file, status: 'MISSING', error: 'file does not exist' };
  }
  const before = fs.readFileSync(target, 'utf8');
  let after = before;
  const subs = [];
  for (const r of plan.replacements) {
    const matchCount = (before.match(r.find) || []).length;
    after = after.replace(r.find, r.to);
    subs.push({ label: r.label, matched: matchCount, expected: r.expectAfter });
    if (matchCount !== r.expectAfter) {
      return {
        file: plan.file,
        status: 'PASS1_FAIL',
        error: `replacement "${r.label}" matched ${matchCount} times, expected ${r.expectAfter} (format drift?)`,
        substitutions: subs,
      };
    }
  }
  // Post-edit verifyPatterns — assert new content contains expected sentinel
  for (const v of plan.verifyPatterns) {
    const count = (after.match(v.regex) || []).length;
    if (count !== v.expect) {
      return {
        file: plan.file,
        status: 'PASS1_FAIL',
        error: `verifyPattern "${v.label}" found ${count} in new content, expected ${v.expect}`,
        substitutions: subs,
      };
    }
  }
  return { file: plan.file, status: 'READY', before, after, substitutions: subs };
}

// === Diff helper ===

function makeDiff(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
    if (beforeLines[i] !== afterLines[i]) {
      if (beforeLines[i] !== undefined) diff.push(`-${i + 1}: ${beforeLines[i]}`);
      if (afterLines[i] !== undefined) diff.push(`+${i + 1}: ${afterLines[i]}`);
    }
  }
  return diff.join('\n');
}

// === Backup / atomic write ===

function backupPath(file) {
  return path.join(REPO_ROOT, `${file}.bak.${process.pid}-${Date.now()}`);
}

function backup(file) {
  const src = path.join(REPO_ROOT, file);
  const dst = backupPath(file);
  fs.copyFileSync(src, dst);
  return dst;
}

function atomicWrite(file, content) {
  const target = path.join(REPO_ROOT, file);
  const tmp = target + '.tmp.' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

// === Main ===

(function main() {
  const args = parseArgs(process.argv);
  validateArgs(args);

  const editPlan = buildEditPlan(args);

  console.log(`sync-version v${args.version} (hooks=${args.hookCount} = ${args.defaultOnCount} Tier A + ${args.optInCount} Tier B, skills=${args.skillCount}) ${args.dryRun ? '— DRY RUN' : ''}\n`);

  // PASS 1 — compute all in memory, validate every replacement, abort if any fail
  console.log('=== PASS 1: validate ===');
  const pass1Results = [];
  for (const plan of editPlan) {
    const r = buildNewContent(plan);
    pass1Results.push(r);
    if (r.status === 'READY') {
      const isNoop = r.before === r.after;
      console.log(`  [${isNoop ? 'NOOP' : 'WOULD_CHANGE'}] ${plan.file}`);
      r.substitutions.forEach(s => console.log(`    - ${s.label}: matched ${s.matched}/${s.expected}`));
    } else {
      console.log(`  [${r.status}] ${plan.file}`);
      console.error(`    ERROR: ${r.error}`);
      if (r.substitutions) r.substitutions.forEach(s => console.error(`    - ${s.label}: matched ${s.matched}/${s.expected}`));
    }
  }

  const hasFail = pass1Results.some(r => r.status !== 'READY');
  if (hasFail) {
    console.error('\nPASS 1 FAILED — no files written. Fix the source-of-truth files or update the script.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('\n=== DRY RUN diff per file ===');
    for (const r of pass1Results) {
      if (r.before === r.after) continue;
      console.log(`\n--- ${r.file} ---`);
      console.log(makeDiff(r.before, r.after));
    }
    console.log('\nDRY RUN complete — no files written.');
    return;
  }

  // PASS 2 — backup all + atomic write all
  console.log('\n=== PASS 2: commit ===');
  const backups = [];
  let pass2Err = null;
  try {
    for (const r of pass1Results) {
      if (r.before === r.after) {
        console.log(`  [NOOP] ${r.file}`);
        continue;
      }
      backups.push({ file: r.file, path: backup(r.file) });
      atomicWrite(r.file, r.after);
      console.log(`  [WROTE] ${r.file}`);
    }
  } catch (err) {
    pass2Err = err;
    console.error(`\nPASS 2 FAILED mid-write: ${err.message}`);
    console.error('Restoring all already-written files from backup...');
    for (const b of backups) {
      try {
        fs.copyFileSync(b.path, path.join(REPO_ROOT, b.file));
        console.error(`  restored ${b.file}`);
      } catch (e) {
        console.error(`  RESTORE FAILED for ${b.file}: ${e.message} — backup at ${b.path}`);
      }
    }
    process.exit(1);
  }

  // Success — remove backups
  for (const b of backups) {
    try { fs.unlinkSync(b.path); } catch { /* ignore */ }
  }
  console.log('\nAll files updated successfully. Backups removed.');
})();
