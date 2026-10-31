#!/usr/bin/env node
'use strict';
/**
 * repo-layout.js - the one registry of where things live in this repo (3.0.0 relayout, section 2).
 *
 * Node API and shell CLI, built-ins only. The registry holds: the current stage, named paths, the
 * placement decision table, the top-level and root-file allowlists, and per-file exceptions.
 *
 * Stages run bootstrap -> P1 -> P2 -> P3 -> P4 -> P5. Each relayout generator moves files and then
 * advances `stage`; a placement rule is enforced only from its `active_from` stage on. There is exactly
 * one layout in force per merge and NO path aliases: a reader asks `path(key)` and gets the path that
 * is valid at the current stage.
 *
 * API:  stage()  path(key)  rules({activeOnly})  allowlists()  exceptions()  validate(data)  load()
 * CLI:  node scripts/lib/repo-layout.js stage            print the stage
 *       node scripts/lib/repo-layout.js path <key>       print one path (exit 2 on unknown key)
 *       node scripts/lib/repo-layout.js --json           print the whole registry
 *       node scripts/lib/repo-layout.js rules [--active] | allowlists | exceptions
 * Test override: env REPO_LAYOUT_REGISTRY=<json file> (or `--registry <file>`) replaces the whole
 * registry with that JSON, so tests never touch the real one.
 *
 * Placement rules are checked by scripts/layout-lint.js. A rule's `match` is
 * {include:[regex], exclude:[regex]} over repo-relative posix paths and describes a MISPLACED file; a
 * rule with `match: null` is declared but has no checker yet, and layout-lint refuses (exit 2) to run
 * once such a rule is active, so a rule can never be switched on without a checker.
 */

const fs = require('fs');
const path = require('path');

const STAGES = ['bootstrap', 'P1', 'P2', 'P3', 'P4', 'P5'];

const DEFAULT_REGISTRY = {
  version: 1,
  stage: 'bootstrap',

  // Named paths. Value = the path at the CURRENT stage; generators rewrite these when they move files.
  paths: {
    docs_dir: 'docs',
    plans_dir: 'docs/plans',
    plans_archive_dir: 'docs/plans/_archive',
    plans_evidence_dir: 'docs/plans/evidence',
    projects_dir: 'docs/projects',
    projects_index: 'docs/projects/INDEX.md',
    projects_archive_dir: 'docs/projects/_archive',
    backlog_file: 'docs/BACKLOG.md',
    missions_dir: 'docs',
    metrics_dir: 'docs/metrics',
    surface_lines_baseline: 'docs/metrics/surface-lines.json',
    settings_reference: 'docs/settings-reference.md',
    hook_harness_matrix_doc: 'docs/hook-harness-matrix.md',
    scripts_inventory_doc: 'docs/scripts-inventory.md',
    hooks_dir: 'hooks',
    hooks_shared_dir: 'hooks/_shared',
    hooks_json: 'hooks/hooks.json',
    opt_in_manifest: 'hooks/opt-in-manifest.json',
    hooks_readme: 'hooks/README.md',
    hook_harness_evidence: 'hooks/harness-support-evidence.json',
    post_tool_chain_lib: 'hooks/post-tool-chain-lib.js',
    hook_tests_dir: 'hooks/tests',
    suite_runner: 'hooks/tests/run.sh',
    serial_suites: 'hooks/tests/lib/serial-suites.txt',
    scripts_dir: 'scripts',
    scripts_lib_dir: 'scripts/lib',
    config_keys: 'scripts/lib/config-keys.json',
    sync_manifest: 'scripts/sync-manifest.json',
    leak_guard_registry: 'scripts/leak-guard-registry.json',
    codex_plugin_dir: 'platforms/codex/plugin',
    codex_hooks_json: 'platforms/codex/hooks/hooks.json',
    claude_dir: '.claude',
    mission_routing_config: '.claude/mission-routing-config.json',
    owner_kernel_governance: '.claude/owner-kernel-governance.json',
    evals_dir: 'evals',
  },

  // Placement decision table (plan section 1 with the F2 correction: work records before docs).
  // layout-lint applies it in order, first hit wins. A file claimed by a rule that is not yet active is
  // left alone (it is waiting for that stage), it does not fall through to a later rule.
  rules: [
    {
      id: 1, name: 'tests',
      condition: 'test files (*.test.*) and fixtures used by tests',
      destination: 'tests/unit/<tested source path>, or tests/integration/ when a test covers two or more modules',
      active_from: 'P3',
      match: {
        include: ['\\.test\\.(js|cjs|mjs|ts|tsx|sh|py)$', '^hooks/tests/', '^scripts/tests/'],
        exclude: ['^tests/', '^mods/', '^website/', '^platforms/', '^\\.opencode/', '^evals/', '^skill-creator-workspace/', '^docs/plans/evidence/'],
      },
    },
    {
      id: 2, name: 'hook-main-file',
      condition: 'a file registered as a hook',
      destination: 'hooks/default/ or hooks/opt-in/, by whether hooks.json or opt-in-manifest.json lists it',
      active_from: 'P4', match: null,
    },
    {
      id: 3, name: 'shared-module',
      condition: 'a module required from two or more top-level directories',
      destination: 'lib/ (hooks/lib/ when only hooks use it)',
      active_from: 'P4', match: null,
    },
    {
      id: 4, name: 'runtime-script',
      condition: 'run by skills, hooks, agents, src, mods, user settings or a session',
      destination: 'scripts/<domain>/ (dispatch, review, mission, worktree, config, engine, scan, install); when also manual, this rule wins over #5',
      active_from: 'P4', match: null,
    },
    {
      id: 5, name: 'dev-tool',
      condition: 'runs only in release, CI, pre-commit/pre-push or manual maintenance',
      destination: 'tools/gates/ (checks), tools/sync/ (mirrors and sync), tools/evals/ (evaluation and benchmarks), tools/migrate/ (one-off migrations)',
      active_from: 'P4', match: null,
    },
    {
      id: 6, name: 'work-records',
      condition: 'plans, projects, backlog, missions, handoff',
      destination: 'project/',
      active_from: 'P1',
      match: {
        include: ['^docs/(plans|projects|missions|handoff|backlog)/', '^docs/BACKLOG\\.md$', '^docs/mission-[^/]+\\.json$', '^docs/[^/]*(HANDOFF|handoff)[^/]*$'],
        exclude: ['^docs/plans/evidence/'],
      },
    },
    {
      id: 7, name: 'reader-docs',
      condition: 'markdown that users or contributors read',
      destination: 'docs/guide/ (users) or docs/dev/ (contributors); docs/README.md and docs/assets/ stay',
      active_from: 'P1',
      match: {
        include: ['^docs/.+\\.md$'],
        exclude: ['^docs/(guide|dev)/', '^docs/README\\.md$', '^docs/assets/', '^docs/plans/evidence/'],
      },
    },
    {
      id: 8, name: 'machine-records',
      condition: 'machine-written records (jsonl, raw logs, screenshots, evaluation evidence)',
      destination: 'evidence/',
      active_from: 'P2',
      match: { include: ['^docs/plans/evidence/'], exclude: [] },
    },
  ],

  allowlists: {
    // Every entry says what it is for. `since` (default bootstrap) lets a later stage add a directory.
    top_dirs: [
      { name: '.agents', purpose: 'Codex/agents marketplace manifest and skills link' },
      { name: '.autopilot', purpose: 'two tracked benchmark evidence files that plans and missions cite' },
      { name: '.claude', purpose: 'this repo\'s own dogfood config, knowledge index and project skills' },
      { name: '.claude-plugin', purpose: 'Claude Code plugin and marketplace manifests' },
      { name: '.githooks', purpose: 'git hooks installed by install-hooks.sh (pre-commit, pre-push, ...)' },
      { name: '.github', purpose: 'CI workflows' },
      { name: '.opencode', purpose: 'opencode plugin package and agent bodies' },
      { name: '.qc', purpose: 'QC verdict files read by the pre-push qc gate' },
      { name: 'agents', purpose: 'methodology agent prompts' },
      { name: 'bin', purpose: 'autopilot CLI entry' },
      { name: 'docs', purpose: 'documentation, plans, projects, backlog, evidence (split up from P1 on)' },
      { name: 'evals', purpose: 'evaluation harness and preregistered corpora' },
      { name: 'hooks', purpose: 'hook main files, hooks.json, opt-in manifest and the hook test suite' },
      { name: 'mods', purpose: 'Claude Code mod surface (live pane, band)' },
      { name: 'platforms', purpose: 'generated mirrors for other platforms (codex)' },
      { name: 'profiles', purpose: 'execution profiles and their hash chain' },
      { name: 'project-config-template', purpose: 'config templates written into consuming projects' },
      { name: 'references', purpose: 'cross-skill reference documents' },
      { name: 'schemas', purpose: 'JSON schemas' },
      { name: 'scripts', purpose: 'deterministic tooling (runtime and dev, split up in P4)' },
      { name: 'skill-creator-workspace', purpose: 'baseline skill-eval definitions and results (May 2026)' },
      { name: 'skills', purpose: 'skills' },
      { name: 'src', purpose: 'engine and runners' },
      { name: 'tools', purpose: 'developer-only tooling; only the subdirectories listed in tools_subdirs' },
      { name: 'website', purpose: 'product site source' },
    ],
    // F2: tools/ starts with migrate/ only; later stages add gates/, sync/, evals/.
    tools_subdirs: [
      { name: 'migrate', purpose: 'one-off relayout generators and the suite baseline' },
    ],
    root_files: [
      { name: '.gitignore', purpose: 'git ignore rules' },
      { name: '.mailmap', purpose: 'author identity mapping' },
      { name: 'AGENTS.md', purpose: 'agents.md readme for non-Claude-Code agents' },
      { name: 'CHANGELOG.md', purpose: 'release notes' },
      { name: 'CLAUDE.md', purpose: 'project conventions for Claude Code sessions' },
      { name: 'LICENSE', purpose: 'license' },
      { name: 'plugin.json', purpose: 'plugin manifest at the root' },
      { name: 'README.md', purpose: 'project readme' },
      { name: 'README.zh-TW.md', purpose: 'Traditional Chinese readme' },
      { name: 'SECURITY.md', purpose: 'security policy and leak-guard exemption record' },
      { name: 'settings.example.json', purpose: 'example Claude Code settings referenced by the install docs' },
    ],
  },

  // Per-file exceptions only: an exact tracked file, the rule it escapes, and why. No globs, no directories.
  exceptions: [
    {
      path: 'docs/scripts-inventory.md',
      rule: 7,
      reason: 'F5: pinned in place until P4 moves it together with check-claude-md-inventory.js, which reads it',
    },
  ],
};

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function registryFile(opts) {
  if (opts && opts.registry) return opts.registry;
  return process.env.REPO_LAYOUT_REGISTRY || '';
}

/** Load the registry: the override file when given, else the built-in one. Returns a fresh copy. */
function load(opts) {
  const f = registryFile(opts);
  if (!f) return clone(DEFAULT_REGISTRY);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function stageIndex(s) { return STAGES.indexOf(s); }

const GLOB_CHARS = /[*?[\]{}]/;
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

/** Structural check of a registry. Returns a list of error strings (empty = sound). */
function validate(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['registry is not an object'];
  if (d.version !== 1) errs.push(`version must be 1, got ${JSON.stringify(d.version)}`);
  if (stageIndex(d.stage) < 0) errs.push(`stage ${JSON.stringify(d.stage)} is not one of ${STAGES.join(', ')}`);
  if (!d.paths || typeof d.paths !== 'object' || Array.isArray(d.paths)) errs.push('paths must be an object');
  else {
    for (const [k, v] of Object.entries(d.paths)) {
      if (!isStr(v)) errs.push(`paths.${k}: value must be a non-empty string`);
      else if (v.startsWith('/') || v.split('/').includes('..') || GLOB_CHARS.test(v)) errs.push(`paths.${k}: ${JSON.stringify(v)} must be a plain repo-relative path`);
    }
  }
  const ruleIds = new Set();
  if (!Array.isArray(d.rules)) errs.push('rules must be an array');
  else {
    for (const r of d.rules) {
      const tag = `rules[id=${r && r.id}]`;
      if (!r || !Number.isInteger(r.id)) { errs.push(`${tag}: id must be an integer`); continue; }
      if (ruleIds.has(r.id)) errs.push(`${tag}: duplicate rule id`);
      ruleIds.add(r.id);
      if (!isStr(r.condition)) errs.push(`${tag}: condition missing`);
      if (!isStr(r.destination)) errs.push(`${tag}: destination missing`);
      if (stageIndex(r.active_from) < 0) errs.push(`${tag}: active_from ${JSON.stringify(r.active_from)} is not a stage`);
      if (r.match !== null && r.match !== undefined) {
        for (const part of ['include', 'exclude']) {
          const list = r.match[part];
          if (!Array.isArray(list)) { errs.push(`${tag}: match.${part} must be an array`); continue; }
          for (const p of list) {
            try { new RegExp(p); } catch (e) { errs.push(`${tag}: match.${part} regex ${JSON.stringify(p)} does not compile`); }
          }
        }
      }
      if ((r.match === null || r.match === undefined) && stageIndex(d.stage) >= 0 && stageIndex(r.active_from) >= 0
          && stageIndex(r.active_from) <= stageIndex(d.stage)) {
        errs.push(`${tag}: active at stage ${d.stage} but has no checker (match is null)`);
      }
    }
  }
  const al = d.allowlists;
  if (!al || typeof al !== 'object') errs.push('allowlists must be an object');
  else {
    for (const part of ['top_dirs', 'tools_subdirs', 'root_files']) {
      if (!Array.isArray(al[part])) { errs.push(`allowlists.${part} must be an array`); continue; }
      const seen = new Set();
      for (const e of al[part]) {
        if (!e || !isStr(e.name) || e.name.includes('/') || GLOB_CHARS.test(e.name)) errs.push(`allowlists.${part}: entry name ${JSON.stringify(e && e.name)} must be a plain single name`);
        else if (seen.has(e.name)) errs.push(`allowlists.${part}: duplicate ${e.name}`);
        else seen.add(e.name);
        if (!e || !isStr(e.purpose)) errs.push(`allowlists.${part}: ${JSON.stringify(e && e.name)} has no purpose`);
        if (e && e.since !== undefined && stageIndex(e.since) < 0) errs.push(`allowlists.${part}: ${e.name} since ${JSON.stringify(e.since)} is not a stage`);
      }
    }
  }
  if (!Array.isArray(d.exceptions)) errs.push('exceptions must be an array');
  else {
    const seen = new Set();
    for (const e of d.exceptions) {
      const tag = `exceptions[${JSON.stringify(e && e.path)}]`;
      if (!e || typeof e !== 'object') { errs.push('exceptions: entry is not an object'); continue; }
      const extra = Object.keys(e).filter((k) => !['path', 'rule', 'reason'].includes(k));
      if (extra.length) errs.push(`${tag}: unknown field(s) ${extra.join(', ')}`);
      if (!isStr(e.path)) { errs.push(`${tag}: path missing`); continue; }
      if (GLOB_CHARS.test(e.path)) errs.push(`${tag}: path is a glob; exceptions are per exact file`);
      if (e.path.endsWith('/')) errs.push(`${tag}: path is a directory; exceptions are per exact file`);
      if (e.path.startsWith('/') || e.path.split('/').includes('..')) errs.push(`${tag}: path must be repo-relative`);
      if (!Number.isInteger(e.rule) || !ruleIds.has(e.rule)) errs.push(`${tag}: rule ${JSON.stringify(e.rule)} is not a defined rule id`);
      if (!isStr(e.reason)) errs.push(`${tag}: reason missing`);
      if (seen.has(e.path + '#' + e.rule)) errs.push(`${tag}: duplicate exception`);
      seen.add(e.path + '#' + e.rule);
    }
  }
  return errs;
}

function checked(opts) {
  const d = load(opts);
  const errs = validate(d);
  if (errs.length) {
    const e = new Error('repo-layout registry is invalid:\n  ' + errs.join('\n  '));
    e.registryErrors = errs;
    throw e;
  }
  return d;
}

function stage(opts) { return checked(opts).stage; }

function pathOf(key, opts) {
  const d = checked(opts);
  if (!Object.prototype.hasOwnProperty.call(d.paths, key)) {
    throw new Error(`repo-layout: unknown path key ${JSON.stringify(key)} (known: ${Object.keys(d.paths).join(', ')})`);
  }
  return d.paths[key];
}

function isActive(rule, st) { return stageIndex(rule.active_from) <= stageIndex(st); }

function rules(opts) {
  const d = checked(opts);
  const all = d.rules.map((r) => Object.assign({}, r, { active: isActive(r, d.stage) }));
  return opts && opts.activeOnly ? all.filter((r) => r.active) : all;
}

function allowlists(opts) {
  const d = checked(opts);
  const live = (list) => list.filter((e) => stageIndex(e.since || 'bootstrap') <= stageIndex(d.stage));
  return {
    top_dirs: live(d.allowlists.top_dirs),
    tools_subdirs: live(d.allowlists.tools_subdirs),
    root_files: live(d.allowlists.root_files),
  };
}

function exceptions(opts) { return checked(opts).exceptions.map((e) => Object.assign({}, e)); }

module.exports = { STAGES, DEFAULT_REGISTRY, load, validate, stage, path: pathOf, rules, allowlists, exceptions, isActive, stageIndex };

if (require.main === module) {
  const argv = process.argv.slice(2);
  let registry = '';
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--registry') registry = argv[++i] || '';
    else rest.push(argv[i]);
  }
  const opts = registry ? { registry } : {};
  const out = (v) => process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '\n');
  try {
    const cmd = rest[0];
    if (cmd === '--json') {
      const d = checked(opts);
      out(Object.assign({}, d, { stages: STAGES }));
    } else if (cmd === 'stage') out(stage(opts));
    else if (cmd === 'path') {
      if (!rest[1]) { process.stderr.write('usage: repo-layout.js path <key>\n'); process.exit(2); }
      out(pathOf(rest[1], opts));
    } else if (cmd === 'rules') out(rules({ ...opts, activeOnly: rest.includes('--active') }));
    else if (cmd === 'allowlists') out(allowlists(opts));
    else if (cmd === 'exceptions') out(exceptions(opts));
    else {
      process.stderr.write('usage: repo-layout.js stage | path <key> | rules [--active] | allowlists | exceptions | --json  [--registry FILE]\n');
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
}
