#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HELP_TEXT = `Usage: node scripts/project-detect.js [<target-dir>] [--help]

Inspect a repo and emit deterministic mechanical facts as a JSON object.

target-dir
  Optional target repository directory (defaults to current working directory).

--help
  Print this message and exit 0.
`;

const KEYS = ['lines', 'functions', 'branches', 'statements'];
const COVERAGE_CONFIG_CANDIDATES = [
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mts',
  'vitest.config.mjs',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
  'jest.config.js',
  'jest.config.ts',
  'jest.config.mts',
  'jest.config.mjs',
];

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  const targetArg = args.find((arg) => !arg.startsWith('-')) || process.cwd();
  const target = path.resolve(process.cwd(), targetArg);
  // Top-level guard: the contract is "never throw out of main on a malformed
  // target". Individual probes already fail-safe, but any unexpected error in
  // detection/stringification must still produce valid fallback JSON + exit 0.
  let result;
  try {
    result = detectProject(target);
  } catch (err) {
    result = {
      target,
      package_manager: 'unknown',
      default_branch: null,
      doc_dir: null,
      workspace: { type: 'none', packages: [], package_scope: null },
      commands: { build: null, test: null, test_watch: null, typecheck: null, lint: null, lint_is_noop: true },
      coverage_thresholds: {},
      protected_path_candidates: [],
      project_paths: null,
      installed_plugins: { superpowers: false },
      error: String(err && err.message ? err.message : err),
    };
  }
  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write('\n');
}

function detectProject(targetDir) {
  const report = {
    target: targetDir,
    package_manager: detectPackageManager(targetDir),
    default_branch: null,
    doc_dir: null,
    workspace: {
      type: 'none',
      packages: [],
      package_scope: null,
    },
    commands: {
      build: null,
      test: null,
      test_watch: null,
      typecheck: null,
      lint: null,
      lint_is_noop: false,
    },
    coverage_thresholds: {},
    protected_path_candidates: [],
    project_paths: null,
    installed_plugins: {
      superpowers: false,
    },
  };

  const packageJsonPath = path.join(targetDir, 'package.json');
  const cargoTomlPath = path.join(targetDir, 'Cargo.toml');
  const rootPackageJson = safeReadJson(packageJsonPath);
  const rootCargoToml = safeReadFile(cargoTomlPath);

  report.default_branch = detectDefaultBranch(targetDir);
  report.doc_dir = detectDocDir(targetDir);
  report.installed_plugins.superpowers = detectSuperpowersInstalled();
  report.project_paths = report.doc_dir
    ? {
        projects_dir: `${report.doc_dir}/projects/`,
        plans_dir: `${report.doc_dir}/plans/`,
        backlog: `${report.doc_dir}/BACKLOG.md`,
        index: `${report.doc_dir}/projects/INDEX.md`,
        archive_dir: `${report.doc_dir}/projects/_archive/`,
      }
    : null;

  const workspaceInfo = detectWorkspace(targetDir, rootPackageJson, rootCargoToml);
  report.workspace = {
    type: workspaceInfo.type,
    packages: workspaceInfo.package_names,
    package_scope: workspaceInfo.package_scope,
  };

  report.commands = buildCommands(workspaceInfo.type, targetDir, workspaceInfo.package_paths, rootPackageJson, report.package_manager);
  report.coverage_thresholds = collectCoverageThresholds(targetDir, workspaceInfo.type, workspaceInfo.package_paths, rootPackageJson);
  report.protected_path_candidates = detectProtectedPaths(targetDir, workspaceInfo.type, workspaceInfo.package_paths);

  return report;
}

function detectPackageManager(targetDir) {
  // pnpm-workspace.yaml is itself definitive pnpm evidence — a fresh workspace may
  // not have a lockfile yet (gpt-5.5 caught the lockfile-only gap that left
  // package_manager=unknown while workspace.type=pnpm-workspace).
  if (safeIsFile(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (safeIsFile(path.join(targetDir, 'pnpm-workspace.yaml'))) return 'pnpm';
  if (safeIsFile(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  if (safeIsFile(path.join(targetDir, 'package-lock.json'))) return 'npm';
  if (safeIsFile(path.join(targetDir, 'Cargo.toml'))) return 'cargo';
  if (safeIsFile(path.join(targetDir, 'go.mod'))) return 'go';
  return 'unknown';
}

function detectDefaultBranch(targetDir) {
  // Only report a branch when targetDir IS the git top-level — not merely nested
  // inside some unrelated parent repo (e.g. a fixture under this repo, or a subdir
  // of a monorepo). Otherwise we'd leak the enclosing repo's branch. (Same guard
  // shape as hooks/version-drift-check.js.)
  const topLevel = gitCommand(targetDir, ['-C', targetDir, 'rev-parse', '--show-toplevel']);
  if (!topLevel) return null;
  let realTarget, realTop;
  try {
    realTarget = fs.realpathSync(targetDir);
    realTop = fs.realpathSync(topLevel);
  } catch {
    return null;
  }
  if (realTarget !== realTop) return null;

  const remoteHead = gitCommand(targetDir, ['-C', targetDir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', 'refs/remotes/origin/HEAD']);
  if (remoteHead && remoteHead !== 'HEAD') {
    if (remoteHead.startsWith('origin/')) return remoteHead.slice(7);
    return remoteHead;
  }
  const current = gitCommand(targetDir, ['-C', targetDir, 'rev-parse', '--abbrev-ref', 'HEAD']);
  if (current && current !== 'HEAD') return current;
  return null;
}

function detectDocDir(targetDir) {
  if (safeIsDirectory(path.join(targetDir, 'docs'))) return 'docs';
  if (safeIsDirectory(path.join(targetDir, 'doc'))) return 'doc';
  return null;
}

function detectWorkspace(targetDir, rootPackageJson, rootCargoToml) {
  const pnpmWorkspacePath = path.join(targetDir, 'pnpm-workspace.yaml');
  if (safeIsFile(pnpmWorkspacePath)) {
    const patterns = parseYamlWorkspacePackages(safeReadFile(pnpmWorkspacePath));
    const package_paths = expandWorkspacePackages(targetDir, patterns, 'npm');
    const package_scope = firstPackageScopeFromPackages(targetDir, package_paths, 'npm');
    return {
      type: 'pnpm-workspace',
      package_paths,
      package_names: package_paths.map((p) => path.basename(p)),
      package_scope,
    };
  }

  // npm/yarn accept BOTH the array form (`"workspaces": [...]`) and the object
  // form (`"workspaces": { "packages": [...] }`) — gpt-5.5 caught the object form
  // being misreported as single.
  const wsField = rootPackageJson ? rootPackageJson.workspaces : undefined;
  const wsPatterns = Array.isArray(wsField)
    ? wsField
    : (wsField && typeof wsField === 'object' && Array.isArray(wsField.packages) ? wsField.packages : null);
  if (wsPatterns) {
    const patterns = wsPatterns;
    const package_paths = expandWorkspacePackages(targetDir, patterns, 'npm');
    const package_scope = firstPackageScopeFromPackages(targetDir, package_paths, 'npm');
    return {
      type: 'npm-workspaces',
      package_paths,
      package_names: package_paths.map((p) => path.basename(p)),
      package_scope,
    };
  }

  if (typeof rootCargoToml === 'string' && /^\s*\[workspace\]/m.test(rootCargoToml)) {
    const patterns = parseCargoWorkspaceMembers(rootCargoToml);
    const package_paths = expandWorkspacePackages(targetDir, patterns, 'cargo');
    return {
      type: 'cargo-workspace',
      package_paths,
      package_names: package_paths.map((p) => path.basename(p)),
      package_scope: null,
    };
  }

  if (rootPackageJson || safeIsFile(path.join(targetDir, 'Cargo.toml'))) {
    const package_scope = readPackageScope(rootPackageJson?.name || null);
    return {
      type: 'single',
      package_paths: [],
      package_names: [],
      package_scope,
    };
  }

  return {
    type: 'none',
    package_paths: [],
    package_names: [],
    package_scope: null,
  };
}

function parseCargoWorkspaceMembers(cargoTomlText) {
  const membersMatch = cargoTomlText.match(/^\s*\[workspace\][\s\S]*?^\s*members\s*=\s*\[([\s\S]*?)\]/m);
  if (!membersMatch) return [];
  const inside = membersMatch[1];
  return splitQuotedList(inside);
}

// True iff `candidate` resolves INSIDE `targetDir` — blocks workspace patterns
// that escape the repo read-only boundary, both via lexical `..` traversal AND
// via symlinks pointing outside (security findings). Resolves symlinks with
// realpath on whatever prefix exists; falls back to lexical resolution for paths
// not yet on disk (a non-existent path can't be read anyway).
function isInsideTarget(targetDir, candidate) {
  // 1. Lexical containment (catches `..`), compared against the LEXICAL base so a
  //    target that is itself reached through a symlink still accepts its own
  //    in-repo paths.
  const lexicalBase = path.resolve(targetDir);
  const lexical = path.resolve(targetDir, candidate);
  if (!(lexical === lexicalBase || lexical.startsWith(lexicalBase + path.sep))) return false;
  // 2. Realpath containment (catches a symlink ESCAPING the repo), comparing
  //    realpath-to-realpath. If either can't be resolved (target unresolved, or
  //    candidate not yet on disk), the lexical check above already sufficed.
  let realBase, realCand;
  try { realBase = fs.realpathSync(targetDir); } catch { return true; }
  try { realCand = fs.realpathSync(lexical); } catch { return true; }
  return realCand === realBase || realCand.startsWith(realBase + path.sep);
}

function expandWorkspacePackages(targetDir, patterns, type) {
  if (!Array.isArray(patterns)) return [];
  const packagePaths = [];
  const seen = new Set();
  // Best-effort glob support: literal paths and a trailing one-level `dir/*`
  // (also accept `dir/**` as one level — recursive nesting is rare and not
  // expanded). Negation patterns (`!pkg`, pnpm exclusions) are skipped, not
  // mis-joined. Full glob semantics are intentionally out of scope.
  for (const raw of patterns) {
    let pattern = String(raw || '').trim();
    if (!pattern) continue;
    if (pattern.startsWith('!')) continue;            // negation/exclusion — skip
    pattern = pattern.replace(/\/\*\*$/, '/*');        // treat dir/** as one level
    // Reject any pattern that escapes the target repo (path traversal).
    if (!isInsideTarget(targetDir, pattern.replace(/\/\*$/, ''))) continue;
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      const baseDir = path.join(targetDir, base);
      if (!safeIsDirectory(baseDir)) continue;
      for (const dirent of sortedDirectoryChildren(baseDir)) {
        if (!dirent.isDirectory()) continue;
        const pkgPath = path.join(base, dirent.name);
        // Per-member containment: a child dir may be a symlink escaping the repo.
        if (!isInsideTarget(targetDir, pkgPath)) continue;
        if (type === 'cargo') {
          if (!safeIsFile(path.join(baseDir, dirent.name, 'Cargo.toml'))) continue;
        } else if (!safeIsFile(path.join(baseDir, dirent.name, 'package.json'))) {
          continue;
        }
        const normalized = posixRel(pkgPath);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          packagePaths.push(normalized);
        }
      }
    } else if (safeIsDirectory(path.join(targetDir, pattern))) {
      if (type === 'cargo' && !safeIsFile(path.join(targetDir, pattern, 'Cargo.toml'))) {
        continue;
      }
      if (type !== 'cargo' && !safeIsFile(path.join(targetDir, pattern, 'package.json'))) {
        continue;
      }
      const normalized = posixRel(pattern);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        packagePaths.push(normalized);
      }
    }
  }
  return packagePaths;
}

function firstPackageScopeFromPackages(targetDir, packages, type) {
  for (const rel of packages) {
    if (type === 'cargo') continue;
    const file = path.join(targetDir, rel, 'package.json');
    const data = safeReadJson(file);
    if (data && typeof data.name === 'string') {
      const scope = readPackageScope(data.name);
      if (scope) return scope;
    }
  }
  return null;
}

function readPackageScope(name) {
  if (typeof name !== 'string') return null;
  if (!name.startsWith('@')) return null;
  const slash = name.indexOf('/', 1);
  return slash > 0 ? name.slice(0, slash) : null;
}

function buildCommands(workspaceType, targetDir, workspacePackages, rootPkgJson, packageManager) {
  // Cargo commands apply to ANY cargo repo — workspace OR single crate (the bug
  // gpt-5.5 caught: a non-workspace Cargo.toml fell through to null JS commands).
  if (workspaceType === 'cargo-workspace' || packageManager === 'cargo') {
    return {
      build: 'cargo build',
      test: 'cargo test',
      test_watch: null,
      typecheck: 'cargo check',
      lint: 'cargo clippy',
      lint_is_noop: false,
    };
  }

  const commands = {
    build: null,
    test: null,
    test_watch: null,
    typecheck: null,
    lint: null,
    lint_is_noop: true,
  };

  const scripts = rootPkgJson && typeof rootPkgJson.scripts === 'object' && rootPkgJson.scripts !== null ? rootPkgJson.scripts : {};
  commands.build = typeof scripts.build === 'string' ? scripts.build : null;
  commands.typecheck = typeof scripts.typecheck === 'string' ? scripts.typecheck : null;
  commands.lint = typeof scripts.lint === 'string' ? scripts.lint : null;

  const testCi = typeof scripts['test:ci'] === 'string' ? scripts['test:ci'] : null;
  if (testCi) {
    commands.test = testCi;
    commands.test_watch = typeof scripts.test === 'string' ? scripts.test : null;
  } else {
    commands.test = typeof scripts.test === 'string' ? scripts.test : null;
    commands.test_watch = null;
  }

  if (workspaceType === 'single') {
    commands.lint_is_noop = !commands.lint;
  } else {
    let anyMemberLint = false;
    for (const rel of workspacePackages) {
      const memberPackage = safeReadJson(path.join(targetDir, rel, 'package.json'));
      if (memberPackage && memberPackage.scripts && typeof memberPackage.scripts.lint === 'string' && memberPackage.scripts.lint.length > 0) {
        anyMemberLint = true;
        break;
      }
    }
    commands.lint_is_noop = !anyMemberLint;
  }

  return commands;
}

function collectCoverageThresholds(targetDir, workspaceType, workspacePackages, rootPkgJson) {
  if (workspaceType === 'cargo-workspace' || workspaceType === 'none') return {};

  const result = {};
  if (workspaceType === 'single') {
    const key = typeof rootPkgJson?.name === 'string' ? rootPkgJson.name : '.';
    const pkgPath = targetDir;
    const thresholds = readPackageCoverageThresholds(pkgPath);
    if (Object.keys(thresholds).length > 0) {
      result[key] = thresholds;
    }
    return result;
  }

  for (const rel of workspacePackages) {
    const pkgPath = path.join(targetDir, rel);
    const key = rel.split('/').at(-1);
    const thresholds = readPackageCoverageThresholds(pkgPath);
    if (Object.keys(thresholds).length > 0) {
      result[key] = thresholds;
    }
  }

  return result;
}

function readPackageCoverageThresholds(pkgDir) {
  const packageJsonPath = path.join(pkgDir, 'package.json');
  const pkg = safeReadJson(packageJsonPath);
  const jestGlobal = pkg?.jest?.coverageThreshold?.global;
  if (jestGlobal && typeof jestGlobal === 'object') {
    // package.json jest config is already a parsed object — read numeric keys
    // directly (do NOT regex it; it isn't a text block).
    const parsed = {};
    for (const key of KEYS) {
      if (typeof jestGlobal[key] === 'number') parsed[key] = jestGlobal[key];
    }
    if (Object.keys(parsed).length > 0) return parsed;
  }

  for (const fileName of COVERAGE_CONFIG_CANDIDATES) {
    const fullPath = path.join(pkgDir, fileName);
    const content = safeReadFile(fullPath);
    if (!content) continue;
    const thresholds = parseCoverageConfig(content);
    if (Object.keys(thresholds).length > 0) return thresholds;
  }

  return {};
}

function parseCoverageConfig(content) {
  const stripped = stripJsNoise(content);
  const coverageBlock = findObjectBlock(stripped, 'coverage');
  if (coverageBlock) {
    const thresholdsBlock = findObjectBlock(coverageBlock, 'thresholds');
    if (thresholdsBlock) {
      const thresholds = parseThresholdObject(thresholdsBlock);
      if (Object.keys(thresholds).length > 0) return thresholds;
    }
    const legacy = parseThresholdObject(coverageBlock);
    if (Object.keys(legacy).length > 0) return legacy;
  }

  const thresholdTop = findObjectBlock(stripped, 'coverageThreshold');
  if (thresholdTop) {
    const globalBlock = findObjectBlock(thresholdTop, 'global');
    if (globalBlock) {
      const thresholds = parseThresholdObject(globalBlock);
      if (Object.keys(thresholds).length > 0) return thresholds;
    }
    const legacy = parseThresholdObject(thresholdTop);
    if (Object.keys(legacy).length > 0) return legacy;
  }

  return {};
}

function parseThresholdObject(textBlock) {
  const result = {};
  if (typeof textBlock !== 'string') return result;  // never throw out of main (fail-safe contract)
  for (const key of KEYS) {
    const m = textBlock.match(new RegExp(`\\b${key}\\s*:\\s*(\\d+)\\b`));
    if (m) result[key] = parseInt(m[1], 10);
  }
  return result;
}

function findObjectBlock(text, key) {
  const regex = new RegExp(`\\b${key}\\s*:\\s*\\{`, 'g');
  let m;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index + m[0].lastIndexOf('{');
    const block = extractBalancedBlock(text, start);
    if (block) return block;
  }
  return null;
}

function extractBalancedBlock(text, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

// Best-effort comment stripping for coverage-config regex parsing. NOT a real JS
// tokenizer — braces inside string/template literals are not protected, so a
// pathological config could misparse. Acceptable: coverage parsing is documented
// best-effort (a bad parse yields {} / a wrong number, never a throw — main()'s
// top-level guard backstops any escape). Real vitest/jest threshold blocks parse
// correctly (verified against hangar-bridge's exact values).
function stripJsNoise(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\/\/.*$/gm, '')
    .replace(/^#.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '')
    ;
}

function detectProtectedPaths(targetDir, workspaceType, workspacePackages) {
  if (workspaceType === 'single') {
    return safeIsDirectory(path.join(targetDir, 'src')) ? ['src/'] : [];
  }
  if (workspaceType === 'none') return [];

  const candidates = [];
  for (const rel of workspacePackages) {
    const dir = path.join(targetDir, rel, 'src');
    if (safeIsDirectory(dir)) candidates.push(`${posixRel(rel)}/src/`);
  }
  return candidates;
}

function detectSuperpowersInstalled() {
  const installedPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  try {
    const content = safeReadJson(installedPath);
    const plugins = content && typeof content === 'object' ? content.plugins : null;
    if (!plugins || typeof plugins !== 'object') return false;
    return Object.keys(plugins).some((name) => typeof name === 'string' && name.startsWith('superpowers'));
  } catch {
    return false;
  }
}

function parseYamlWorkspacePackages(content) {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const packages = [];
  const seen = new Set();
  let collecting = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!collecting) {
      const inline = trimmed.match(/^packages:\s*\[(.*)\]\s*$/);
      if (inline) {
        for (const item of splitQuotedList(inline[1])) {
          if (!seen.has(item)) {
            seen.add(item);
            packages.push(item);
          }
        }
        return packages;
      }
      if (/^packages\s*:\s*$/.test(trimmed)) {
        collecting = true;
      }
      continue;
    }

    const item = trimmed.match(/^\-\s+(.+)$/) || trimmed.match(/^\-\s*(.+)$/);
    if (!item) {
      if (!trimmed.startsWith('#')) break;
      continue;
    }
    // Strip a trailing YAML comment that's OUTSIDE quotes (e.g. `- "packages/*" # foo`).
    const raw = item[1].trim();
    const quoted = raw.match(/^(['"])(.*?)\1\s*(?:#.*)?$/);
    const p = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
    if (!seen.has(p)) {
      seen.add(p);
      packages.push(p);
    }
  }

  return packages;
}

function splitQuotedList(listValue) {
  if (!listValue) return [];
  return listValue
    .split(',')
    .map((s) => stripYamlQuotes(s.trim()))
    .filter(Boolean);
}

function stripYamlQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function gitCommand(targetDir, args) {
  try {
    const out = execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    return out.trim();
  } catch {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function safeIsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeIsDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function sortedDirectoryChildren(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function posixRel(relPath) {
  return relPath.split(path.sep).join('/');
}

main();
