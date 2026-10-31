#!/usr/bin/env node
'use strict';
/**
 * layout-lint.js - checks the tracked files against the repo layout registry (scripts/lib/repo-layout.js).
 *
 * Usage: node scripts/layout-lint.js [--repo-root DIR] [--registry FILE]
 *
 * Judges `git ls-files` (tracked files only; untracked files in the work tree are not looked at) and only
 * the rules in force at the registry's current stage:
 *   always:           top-level directory allowlist, root-file allowlist, tools/ subdirectory allowlist,
 *                     path keys point at something tracked, exceptions name a tracked file
 *   from its stage:   each placement rule whose `active_from` is reached (first matching rule wins; a file
 *                     claimed by a not-yet-active rule is left alone)
 * Exit codes: 0 clean; 1 violations (each listed with the rule it hit); 2 the registry itself is
 * wrong (unknown stage, an exception that is a glob or a directory or has no reason, an active rule with no
 * checker, unreadable registry) or git failed.
 * Test override: REPO_LAYOUT_REGISTRY or --registry points at another registry file; --repo-root at another repo.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const layout = require('./lib/repo-layout.js');

function parseArgs(argv) {
  const o = { root: process.cwd(), registry: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo-root') o.root = path.resolve(argv[++i] || '');
    else if (argv[i] === '--registry') o.registry = argv[++i] || '';
    else {
      process.stderr.write('Usage: node scripts/layout-lint.js [--repo-root DIR] [--registry FILE]\n');
      process.exit(2);
    }
  }
  return o;
}

function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function compile(match) {
  return { include: match.include.map((p) => new RegExp(p)), exclude: match.exclude.map((p) => new RegExp(p)) };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const opts = o.registry ? { registry: o.registry } : {};
  let reg;
  try { reg = layout.load(opts); } catch (e) {
    process.stderr.write(`layout-lint: cannot read the registry: ${e.message}\n`);
    return 2;
  }
  const regErrs = layout.validate(reg);
  if (regErrs.length) {
    process.stderr.write('layout-lint: the registry is wrong (exit 2):\n');
    for (const e of regErrs) process.stderr.write(`  ${e}\n`);
    return 2;
  }

  let files;
  try { files = trackedFiles(o.root); } catch (e) {
    process.stderr.write(`layout-lint: git ls-files failed in ${o.root}: ${e.message}\n`);
    return 2;
  }
  const fileSet = new Set(files);
  const dirSet = new Set();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
  }

  // Exceptions that are directories are a registry error (they must name one exact file).
  const regErrs2 = [];
  for (const e of reg.exceptions) {
    if (dirSet.has(e.path)) regErrs2.push(`exception ${JSON.stringify(e.path)} is a directory; exceptions are per exact file`);
  }
  if (regErrs2.length) {
    process.stderr.write('layout-lint: the registry is wrong (exit 2):\n');
    for (const e of regErrs2) process.stderr.write(`  ${e}\n`);
    return 2;
  }

  const stage = reg.stage;
  const al = layout.allowlists(opts);
  const topDirs = new Set(al.top_dirs.map((e) => e.name));
  const rootFiles = new Set(al.root_files.map((e) => e.name));
  const toolsSub = new Set(al.tools_subdirs.map((e) => e.name));
  const violations = [];
  const bad = (rule, file, msg) => violations.push({ rule, file, msg });

  // 1. root files and top-level directories
  const seenTop = new Set();
  for (const f of files) {
    const i = f.indexOf('/');
    if (i < 0) {
      if (!rootFiles.has(f)) bad('allowlist:root_files', f, 'root file is not in the root-file allowlist');
      continue;
    }
    const top = f.slice(0, i);
    if (!seenTop.has(top)) {
      seenTop.add(top);
      if (!topDirs.has(top)) bad('allowlist:top_dirs', f, `top-level directory "${top}/" is not in the top-level allowlist`);
    }
    // 2. tools/ opens only the listed subdirectories
    if (top === 'tools') {
      const rest = f.slice(i + 1);
      const j = rest.indexOf('/');
      if (j < 0) bad('allowlist:tools_subdirs', f, 'file directly under tools/; only the listed subdirectories are open');
      else if (!toolsSub.has(rest.slice(0, j))) bad('allowlist:tools_subdirs', f, `tools/${rest.slice(0, j)}/ is not open at stage ${stage} (open: ${[...toolsSub].join(', ') || 'none'})`);
    }
  }

  // 3. every named path points at something tracked
  for (const [k, v] of Object.entries(reg.paths)) {
    if (!fileSet.has(v) && !dirSet.has(v)) bad('paths', `paths.${k}`, `${v} is not a tracked file or directory`);
  }

  // 4. exceptions name a tracked file
  for (const e of reg.exceptions) {
    if (!fileSet.has(e.path)) bad('exceptions', e.path, 'exception names a file that is not tracked (stale)');
  }

  // 5. placement rules in force at this stage
  const excepted = new Set(reg.exceptions.map((e) => `${e.rule}\0${e.path}`));
  const compiled = reg.rules.map((r) => ({ r, c: r.match ? compile(r.match) : null }));
  for (const f of files) {
    for (const { r, c } of compiled) {
      if (!c) continue;
      if (!c.include.some((re) => re.test(f)) || c.exclude.some((re) => re.test(f))) continue;
      // first claim wins, whether or not the rule is active yet
      if (layout.isActive(r, stage) && !excepted.has(`${r.id}\0${f}`)) {
        bad(`rule #${r.id} ${r.name}`, f, `belongs to ${r.destination}`);
      }
      break;
    }
  }

  if (violations.length) {
    process.stderr.write(`layout-lint: ${violations.length} violation(s) at stage ${stage}:\n`);
    for (const v of violations.slice(0, 200)) process.stderr.write(`  [${v.rule}] ${v.file}: ${v.msg}\n`);
    if (violations.length > 200) process.stderr.write(`  ... and ${violations.length - 200} more\n`);
    return 1;
  }
  process.stdout.write(`layout-lint: clean at stage ${stage} (${files.length} tracked files, ${layout.rules(opts).filter((r) => r.active).length} placement rule(s) in force)\n`);
  return 0;
}

process.exitCode = main();
