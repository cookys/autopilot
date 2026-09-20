'use strict';

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

module.exports = { EXCLUDE_ALLOWLIST, isPathspecAllowed };
