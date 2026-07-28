'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function canonicalExisting(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return fs.realpathSync(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 3000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function canonicalGitPath(cwd, value) {
  if (!value) return null;
  return canonicalExisting(path.isAbsolute(value) ? value : path.resolve(cwd, value));
}

function gitCommonDir(cwd) {
  const raw = git(cwd, ['rev-parse', '--git-common-dir']);
  return raw ? canonicalGitPath(cwd, raw) : null;
}

function worktreePaths(repoRoot) {
  const raw = git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!raw) return [];
  const paths = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('worktree ')) continue;
    const canonical = canonicalExisting(line.slice('worktree '.length));
    if (canonical) paths.push(canonical);
  }
  return [...new Set(paths)];
}

function createRepoIdentity(repoRoot) {
  const requested = canonicalExisting(repoRoot);
  if (!requested) {
    return {
      requested_root: path.resolve(repoRoot || process.cwd()),
      canonical_root: null,
      git_common_dir: null,
      worktrees: [],
      available: false,
    };
  }
  const top = git(requested, ['rev-parse', '--show-toplevel']);
  const canonicalRoot = top ? canonicalExisting(top) : requested;
  const common = top ? gitCommonDir(canonicalRoot) : null;
  const worktrees = top ? worktreePaths(canonicalRoot)
    .filter((worktree) => gitCommonDir(worktree) === common) : [canonicalRoot];
  if (!worktrees.includes(canonicalRoot)) worktrees.push(canonicalRoot);
  return {
    requested_root: requested,
    canonical_root: canonicalRoot,
    git_common_dir: common,
    worktrees: [...new Set(worktrees)].sort(),
    available: Boolean(top && common),
  };
}

function isWithin(candidate, root) {
  if (!candidate || !root) return false;
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sessionTime(session) {
  const timestamps = session.events
    .map((event) => event.timestamp && Date.parse(event.timestamp))
    .filter(Number.isFinite);
  if (timestamps.length > 0) {
    return {
      earliest: Math.min(...timestamps),
      latest: Math.max(...timestamps),
      source: 'event_timestamp',
    };
  }
  return {
    earliest: session.mtimeMs,
    latest: session.mtimeMs,
    source: 'file_mtime',
  };
}

function pathAttribution(value, identity) {
  const canonical = canonicalExisting(value);
  if (!canonical) return null;
  for (const worktree of identity.worktrees) {
    if (isWithin(canonical, worktree)) {
      return {
        included: true,
        confidence: identity.available ? 'canonical_worktree' : 'canonical_path',
        canonical,
      };
    }
  }
  if (identity.available && fs.existsSync(canonical)) {
    const common = gitCommonDir(canonical);
    if (common && common === identity.git_common_dir) {
      return { included: true, confidence: 'git_common_dir', canonical };
    }
    if (common && common !== identity.git_common_dir) {
      return { included: false, reason: 'different_repository', canonical };
    }
  }
  return { included: false, reason: 'different_repository', canonical };
}

function attributeSession(session, identity, options = {}) {
  const cutoffMs = options.cutoffMs || 0;
  const nowMs = options.nowMs || Date.now();
  if (session.budgetError) {
    return {
      included: false,
      reason: 'scan_budget_exceeded',
      confidence: null,
      time_source: 'not_read',
    };
  }
  const time = sessionTime(session);
  if (!Number.isFinite(time.latest) || time.latest < cutoffMs || time.earliest > nowMs) {
    return {
      included: false,
      reason: 'outside_window',
      confidence: null,
      time_source: time.source,
    };
  }

  const hints = [];
  for (const event of session.events) {
    if (event.cwd) hints.push(event.cwd);
    if (event.repo_hint) hints.push(event.repo_hint);
  }
  for (const hint of [...new Set(hints)]) {
    const result = pathAttribution(hint, identity);
    if (result && result.included) {
      return {
        included: true,
        reason: null,
        confidence: result.confidence,
        time_source: time.source,
      };
    }
  }
  if (hints.length > 0) {
    return {
      included: false,
      reason: 'different_repository',
      confidence: null,
      time_source: time.source,
    };
  }
  if (session.readError) {
    return {
      included: false,
      reason: 'unreadable_session',
      confidence: null,
      time_source: time.source,
    };
  }
  if (options.trustRootOverride) {
    return {
      included: true,
      reason: null,
      confidence: 'explicit_transcript_root',
      time_source: time.source,
    };
  }
  return {
    included: false,
    reason: 'missing_repo_evidence',
    confidence: null,
    time_source: time.source,
  };
}

module.exports = {
  attributeSession,
  canonicalExisting,
  createRepoIdentity,
  gitCommonDir,
  isWithin,
};
