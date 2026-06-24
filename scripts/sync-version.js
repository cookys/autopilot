#!/usr/bin/env node
/**
 * sync-version — autopilot release manifest sync (v2.7.3+)
 *
 * Updates version (everywhere) + the description's skill/hook-count FRAGMENTS across:
 *   - .claude-plugin/plugin.json       (canonical for Claude Code)
 *   - plugin.json                      (root mirror for non-Claude tools)
 *   - .claude-plugin/marketplace.json
 *   - README.md (version badge only)
 *
 * NOT owned here (single source of truth = scripts/check-hook-inventory.js, which
 * derives counts + tier membership from real wiring): the README hooks badge,
 * hooks/README.md tier tables, and whether the description's hook NUMBERS are
 * actually correct. sync-version mirrors the canonical fragment verbatim; the
 * numbers' correctness is check-hook-inventory's --check job.
 *
 * USAGE:
 *   node scripts/sync-version.js --version 2.7.3 --hook-count 20 \
 *     --skill-count 20 --opt-in-count 7 --disabled-count 5
 *   node scripts/sync-version.js --version 2.7.3 --hook-count 20 \
 *     --skill-count 20 --opt-in-count 7 --disabled-count 5 --dry-run
 *   node scripts/sync-version.js --check    # pre-commit gate: read canonical,
 *                                           # exit 1 if any tracked file drifts
 *
 * Safety (per L-5.2 r1 reviewer findings 2026-05-14):
 *   - Two-pass: pass 1 builds in-memory + asserts every replacement matched
 *     its expected count; pass 2 atomically commits writes
 *   - On any pass-1 failure → no file written, exit non-zero (no half-bump)
 *   - On pass-2 failure (rare — atomic write succeeded but somehow downstream
 *     fails) → restore from per-file `.bak.<pid>` backup
 *   - `--dry-run` prints proposed diff per file, writes nothing
 *   - `--check` reads .claude-plugin/plugin.json as source-of-truth,
 *     runs pass-1 only; exit 1 if any mirror would change. No CLI args needed.
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
  // optInCount / disabledCount intentionally start UNSET. When a flag is omitted
  // the write path backfills from the canonical description's CURRENT value
  // (see readCanonicalCounts) instead of clobbering to a hardcoded default — that
  // silent clobber was the v2.20.0 footgun. Only if canonical is unparseable do
  // the historical literal defaults (opt-in 7, disabled 0) apply as last resort.
  const args = { dryRun: false, check: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version' || a === '-v') args.version = argv[++i];
    else if (a === '--hook-count' || a === '-H') args.hookCount = parseInt(argv[++i], 10);
    else if (a === '--skill-count' || a === '-S') args.skillCount = parseInt(argv[++i], 10);
    else if (a === '--opt-in-count' || a === '-O') args.optInCount = parseInt(argv[++i], 10);
    else if (a === '--disabled-count' || a === '-X') args.disabledCount = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--check') args.check = true;
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else { console.error(`unknown arg: ${a}`); printUsage(); process.exit(2); }
  }
  return args;
}

// Read the CURRENT opt-in / disabled counts from the canonical description so an
// omitted --opt-in-count / --disabled-count PRESERVES them rather than silently
// clobbering to a hardcoded default (the v2.20.0 footgun: a bump that forgot
// --disabled-count rewrote "20 hooks (8 default-on, 7 opt-in, 5 disabled)" →
// "...(13 default-on, 7 opt-in)", dropping the disabled tier and miscomputing
// default-on — tiers shown are the v2.20.0-era split; current is 11 opt-in /
// 1 disabled). Returns null if canonical is missing / description unparseable —
// callers then fall back to the historical literal defaults.
function readCanonicalCounts() {
  try {
    const canonical = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf8'));
    const m = (canonical.description || '').match(/(\d+) hooks \((\d+) default-on, (\d+) opt-in(?:, (\d+) disabled)?\)/);
    if (!m) return null;
    return {
      optInCount: parseInt(m[3], 10),
      disabledCount: m[4] !== undefined ? parseInt(m[4], 10) : 0,
    };
  } catch {
    return null;
  }
}

// === --check mode: derive args from canonical (.claude-plugin/plugin.json + hooks.json) ===
function deriveArgsFromCanonical() {
  const canonicalPath = path.join(REPO_ROOT, '.claude-plugin/plugin.json');
  if (!fs.existsSync(canonicalPath)) {
    console.error(`error: canonical source ${canonicalPath} missing`);
    process.exit(2);
  }
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  const version = canonical.version;
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`error: canonical version invalid: ${version}`);
    process.exit(2);
  }
  // Description: "... N lifecycle skills + 3 methodology agents + H hooks (D default-on, O opt-in[, X disabled]) ..."
  // The "disabled" tier is optional (3-tier model since the hook-inventory
  // reconciliation). Hook-count SEMANTICS (do these numbers match real wiring +
  // tier membership) are owned by scripts/check-hook-inventory.js; sync-version
  // only mirrors the canonical description fragment verbatim into the manifests.
  const desc = canonical.description || '';
  const skillMatch = desc.match(/(\d+) lifecycle skills/);
  const hookMatch = desc.match(/(\d+) hooks \((\d+) default-on, (\d+) opt-in(?:, (\d+) disabled)?\)/);
  if (!skillMatch || !hookMatch) {
    console.error(`error: canonical description not in expected format: ${desc}`);
    process.exit(2);
  }
  return {
    version,
    skillCount: parseInt(skillMatch[1], 10),
    hookCount: parseInt(hookMatch[1], 10),
    optInCount: parseInt(hookMatch[3], 10),
    defaultOnCount: parseInt(hookMatch[2], 10),
    disabledCount: hookMatch[4] !== undefined ? parseInt(hookMatch[4], 10) : 0,
    dryRun: false,
    check: true,
  };
}

function printUsage() {
  console.log(`sync-version.js — autopilot release manifest sync

USAGE:
  node scripts/sync-version.js \\
    --version <V> --hook-count <N> --skill-count <M> [--opt-in-count <K>] [--disabled-count <X>] [--dry-run] [--help]

ARGS:
  --version        new semver string (e.g. "2.7.3")
  --hook-count     total hooks (default-on + opt-in + disabled; e.g. 20)
  --skill-count    total skills (currently 20)
  --opt-in-count   Tier B / opt-in count (default 7)
  --disabled-count shipped-but-disabled count (default 0); default-on is the
                   remainder = hook-count − opt-in-count − disabled-count
  --dry-run        print proposed changes, write nothing
  --help           this message

NOTE: hook-count NUMBERS + tier membership are validated against real wiring by
  scripts/check-hook-inventory.js (--check). sync-version only mirrors the
  canonical description fragment + version badges; it does not own the hooks badge
  or hooks/README.md (those are check-hook-inventory's).

OUTPUT:
  Modifies .claude-plugin/plugin.json, plugin.json, .claude-plugin/marketplace.json
  (version + description fragments) and README.md (version badge only). Two-pass
  design: validates ALL files in memory before writing ANY file. On pass-1 fail →
  nothing written.`);
}

function validateArgs(a) {
  const errs = [];
  if (!a.version) errs.push('--version required');
  else if (!/^\d+\.\d+\.\d+$/.test(a.version)) errs.push(`invalid version "${a.version}" (expected N.N.N)`);
  if (!Number.isInteger(a.hookCount) || a.hookCount < 1 || a.hookCount > 100) errs.push(`--hook-count must be integer 1-100, got ${a.hookCount}`);
  if (!Number.isInteger(a.skillCount) || a.skillCount < 1 || a.skillCount > 100) errs.push(`--skill-count must be integer 1-100, got ${a.skillCount}`);
  if (!Number.isInteger(a.optInCount) || a.optInCount < 0 || a.optInCount >= a.hookCount) errs.push(`--opt-in-count must be integer 0..hook-count-1, got ${a.optInCount}`);
  if (!Number.isInteger(a.disabledCount) || a.disabledCount < 0 || a.disabledCount >= a.hookCount) errs.push(`--disabled-count must be integer 0..hook-count-1, got ${a.disabledCount}`);
  // default-on is the remainder of the 3-tier split (total − opt-in − disabled).
  if (errs.length === 0 && a.hookCount - a.optInCount - a.disabledCount < 1) errs.push(`default-on count (hook-count − opt-in − disabled) must be ≥ 1, got ${a.hookCount - a.optInCount - a.disabledCount}`);
  if (errs.length) {
    errs.forEach(e => console.error(`error: ${e}`));
    process.exit(2);
  }
  a.defaultOnCount = a.hookCount - a.optInCount - a.disabledCount;
}

// === Per-file edit plan ===

function buildEditPlan(args) {
  const V = args.version;
  const H = args.hookCount;
  const D = args.defaultOnCount;
  const O = args.optInCount;
  const X = args.disabledCount;
  const S = args.skillCount;

  // Mirror the canonical hook-count fragment verbatim (3-tier when disabled > 0,
  // else 2-tier). The numbers themselves are validated against real wiring by
  // scripts/check-hook-inventory.js — here they are just a mirrored string.
  const hookFragTo = X > 0
    ? `${H} hooks (${D} default-on, ${O} opt-in, ${X} disabled)`
    : `${H} hooks (${D} default-on, ${O} opt-in)`;
  const hookFragFind = /\b\d+ hooks \(\d+ default-on, \d+ opt-in(?:, \d+ disabled)?\)/g;

  return [
    {
      file: '.claude-plugin/plugin.json',
      replacements: [
        { find: /"version":\s*"[^"]+"/g, to: `"version": "${V}"`, expectAfter: 1, label: 'version field' },
        { find: hookFragFind, to: hookFragTo, expectAfter: 1, label: 'description hook-count fragment' },
        { find: /\b\d+ lifecycle skills\b/g, to: `${S} lifecycle skills`, expectAfter: 1, label: 'description skill-count fragment' },
      ],
      // Post-edit guard: file contains exactly 1 line with new version
      verifyPatterns: [
        { regex: new RegExp(`"version":\\s*"${escapeRegex(V)}"`, 'g'), expect: 1, label: `JSON "version": "${V}"` },
      ],
    },
    {
      // Root plugin.json — mirror of .claude-plugin/plugin.json (version + description).
      // Consumers: npm registry, GitHub UI metadata, any non-Claude-aware tooling.
      file: 'plugin.json',
      replacements: [
        { find: /"version":\s*"[^"]+"/g, to: `"version": "${V}"`, expectAfter: 1, label: 'version field' },
        { find: hookFragFind, to: hookFragTo, expectAfter: 1, label: 'description hook-count fragment' },
        { find: /\b\d+ lifecycle skills\b/g, to: `${S} lifecycle skills`, expectAfter: 1, label: 'description skill-count fragment' },
      ],
      verifyPatterns: [
        { regex: new RegExp(`"version":\\s*"${escapeRegex(V)}"`, 'g'), expect: 1, label: `JSON "version": "${V}"` },
      ],
    },
    {
      file: '.claude-plugin/marketplace.json',
      replacements: [
        { find: /"version":\s*"[^"]+"/g, to: `"version": "${V}"`, expectAfter: 1, label: 'version field' },
        { find: hookFragFind, to: hookFragTo, expectAfter: 1, label: 'description hook-count fragment' },
        { find: /\b\d+ skills \+ 3 methodology agents/g, to: `${S} skills + 3 methodology agents`, expectAfter: 1, label: 'description skill-count fragment' },
      ],
      verifyPatterns: [
        { regex: new RegExp(`"version":\\s*"${escapeRegex(V)}"`, 'g'), expect: 1, label: `JSON "version": "${V}"` },
      ],
    },
    // hooks/hooks.json — intentionally omitted (its description is a historical marker, not the version).
    // hooks/README.md — intentionally omitted: hook counts + tier membership there are owned by
    //   scripts/check-hook-inventory.js (derived from real wiring), NOT mirrored from the version blurb.
    {
      // README.md badges — version badge only. The hooks badge is owned by
      // scripts/check-hook-inventory.js (--check asserts it == derived total),
      // so sync-version no longer writes it (single source of truth for hook counts).
      file: 'README.md',
      replacements: [
        { find: /badge\/version-\d+\.\d+\.\d+-/g, to: `badge/version-${V}-`, expectAfter: 1, label: 'version badge' },
        { find: /alt="v\d+\.\d+\.\d+"/g, to: `alt="v${V}"`, expectAfter: 1, label: 'version badge alt' },
      ],
      verifyPatterns: [
        { regex: new RegExp(`badge/version-${escapeRegex(V)}-`, 'g'), expect: 1, label: `version badge has ${V}` },
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
  let args = parseArgs(process.argv);
  if (args.check) {
    // --check mode: derive everything from canonical, run pass-1 only, exit 1 on drift
    args = deriveArgsFromCanonical();
  } else {
    // Backfill omitted optional counts from the canonical CURRENT values so a bump
    // that only changes --version can't silently clobber the opt-in / disabled
    // tiers (v2.20.0 footgun). Fall back to historical literals only if canonical
    // can't be parsed.
    const current = readCanonicalCounts();
    if (args.optInCount === undefined) args.optInCount = current ? current.optInCount : 7;
    if (args.disabledCount === undefined) args.disabledCount = current ? current.disabledCount : 0;
    validateArgs(args);
  }

  const editPlan = buildEditPlan(args);

  const mode = args.check ? '— CHECK (no writes; exit 1 on drift)' : args.dryRun ? '— DRY RUN' : '';
  console.log(`sync-version v${args.version} (hooks=${args.hookCount} = ${args.defaultOnCount} default-on + ${args.optInCount} opt-in + ${args.disabledCount} disabled, skills=${args.skillCount}) ${mode}\n`);

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

  if (args.check) {
    // Drift detection: any WOULD_CHANGE = drift
    const drifted = pass1Results.filter(r => r.before !== r.after);
    if (drifted.length > 0) {
      console.error('\n=== DRIFT DETECTED ===');
      for (const r of drifted) {
        console.error(`\n--- ${r.file} ---`);
        console.error(makeDiff(r.before, r.after));
      }
      console.error(`\nFix: edit .claude-plugin/plugin.json (canonical) then run:`);
      // opt-in / disabled counts are preserved from canonical when omitted, so the
      // safe-by-default invocation needs only version + the two required counts.
      console.error(`  node scripts/sync-version.js --version ${args.version} --hook-count ${args.hookCount} --skill-count ${args.skillCount}`);
      process.exit(1);
    }
    console.log('\nAll mirrors in sync with canonical. ✓');
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
