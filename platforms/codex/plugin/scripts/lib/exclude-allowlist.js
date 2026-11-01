'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_EXT_RE = /\.(js|ts|py|sh|md)(\/|$)/i;

// Work-record entries: this repo's locations from the layout registry (docs/ at bootstrap, project/ from P1) plus the docs/
// convention of a consuming project.
const LAYOUT = require('./repo-layout.js');
const WORK_RECORD_EXCLUDES = [...new Set([
  `${LAYOUT.path('projects_dir')}/**`,
  `${LAYOUT.path('plans_evidence_dir')}/**`,
  LAYOUT.path('backlog_file'),
  ['docs', 'projects', '**'].join('/'),
  ['docs', 'plans', 'evidence', '**'].join('/'),
  ['docs', 'BACKLOG.md'].join('/'),
])];

const EXCLUDE_ALLOWLIST = [
  'platforms/**',
  'profiles/*.json',
  ...WORK_RECORD_EXCLUDES,
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

function matchesAllowlist(normalized, list) {
  if (!Array.isArray(list)) return false;
  for (const pattern of list) {
    if (pattern === normalized) return true;
    if (typeof pattern === 'string' && pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(prefix + '/')) return true;
    }
  }
  return false;
}

function isAcceptedConsumerRow(raw) {
  const normalized = String(raw || '').trim();
  if (!normalized) return false;
  const core = normalized.endsWith('/**') ? normalized.slice(0, -3) : normalized;
  if (SOURCE_EXT_RE.test(core) || SOURCE_EXT_RE.test(normalized)) return false;
  if (!core.includes('/')) return false;
  if (/[*?]/.test(core)) return false;
  if (!normalized.endsWith('/**') && /[*?]/.test(normalized)) return false;
  return true;
}

function parseConsumerExcludeAllowlist(text) {
  const accepted = [];
  const lines = String(text || '').split(/\r?\n/);
  const rowRe = /(?:^|[-\s#*>])exclude_allowlist(?:[\s:=]+)(\S+)/i;
  for (const line of lines) {
    const m = line.match(rowRe);
    if (!m) continue;
    const value = m[1].trim();
    if (isAcceptedConsumerRow(value)) accepted.push(value);
  }
  return accepted;
}

function loadConsumerExcludeAllowlist(repoRoot) {
  const configRelPath = path.join('.claude', 'review-loop-config.md');
  const configPath = repoRoot ? path.join(repoRoot, configRelPath) : configRelPath;
  try {
    if (!fs.existsSync(configPath)) return [];
    return parseConsumerExcludeAllowlist(fs.readFileSync(configPath, 'utf8'));
  } catch (_e) {
    return [];
  }
}

function isPathspecAllowed(pathspec, consumerList) {
  const normalized = String(pathspec || '').trim();
  if (matchesAllowlist(normalized, EXCLUDE_ALLOWLIST)) return true;
  const extra = Array.isArray(consumerList)
    ? consumerList.filter(isAcceptedConsumerRow)
    : [];
  return matchesAllowlist(normalized, extra);
}

module.exports = {
  EXCLUDE_ALLOWLIST,
  isPathspecAllowed,
  isAcceptedConsumerRow,
  parseConsumerExcludeAllowlist,
  loadConsumerExcludeAllowlist,
};
