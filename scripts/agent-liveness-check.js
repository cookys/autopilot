#!/usr/bin/env node
'use strict';

/**
 * agent-liveness-check.js — on-disk liveness facts for a repo an agent is working in.
 *
 * WHY: PID liveness is the wrong instrument for a Claude-Code-native foreman. `run-ledger.sh
 * stage-acquire` records the PID of the SHELL that invoked it, and that shell exits immediately;
 * the foreman keeps running as a separate agent turn. So `watch-foreman.js` reports
 * `dead/owner_absent` for a perfectly healthy foreman (docs/BACKLOG.md, v2.34.39). The durable
 * evidence a foreman leaves behind is on DISK — commits, a dirty worktree, a held lock, a growing
 * log — so that is what this reports.
 *
 * Deliberately NOT a verdict. It emits facts and lets the reader judge, because "no file changed in
 * the last 10 minutes" is consistent with both a thinking agent and a dead one. Nothing here proves
 * a process is alive; a worktree that is GONE is the only strong death signal it can offer, and it
 * says so as `worktree_absent` rather than `dead`.
 *
 * Repo-agnostic: every fact comes from git plumbing, the filesystem, or `statvfs`-equivalent output.
 * No project-specific paths, branch names, or container conventions are baked in — the container and
 * volume sections exist only when you name a prefix and a container runtime is installed.
 *
 * USAGE:
 *   scripts/agent-liveness-check.js [--repo-root <dir>] [--base <ref>] [--fresh-seconds N]
 *                                   [--container-prefix <p>] [--volume-prefix <p>]
 *                                   [--container-bin docker|podman] [--json]
 *
 *   --repo-root        repo to inspect (default: cwd's repo)
 *   --base             branch the worktrees are measured against (default: the repo's HEAD branch
 *                      as seen in the main worktree; falls back to `develop`, then `main`)
 *   --fresh-seconds    how recent counts as "fresh" for the `fresh` booleans (default 900)
 *   --container-prefix report containers whose NAME starts with this prefix (opt-in)
 *   --volume-prefix    report volumes whose NAME starts with this prefix (opt-in)
 *   --container-bin    runtime for the two sections above (default: docker if present, else podman)
 *   --json             emit JSON (the default; the flag exists so callers can be explicit)
 *
 * OUTPUT (stable schema):
 *   { schema_version, generated_at, repo_root, base, fresh_seconds,
 *     base_head: { ref, sha, committed_at, age_seconds, resolved },
 *     worktrees: [ { path, exists, branch, head, detached, dirty_files, ahead, behind,
 *                    newest_mtime, newest_mtime_age_seconds, fresh, locked, lock_holder_pid } ],
 *     containers: [...] | null, volumes: [...] | null,
 *     disk: { path, free_bytes, total_bytes } | null,
 *     warnings: [ ... ] }
 *
 * EXIT: 0 = facts emitted (even if some sections are null — a missing container runtime is not an
 *           error) · 2 = usage error or the repo could not be read at all.
 *
 * Node >= 20.10, built-ins only (runs under dep-minimal sandboxes).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
// Single owner for the on-disk activity primitives; watch-foreman.js consumes the same module so
// the two cannot drift apart on what counts as "activity".
const { newestMtime, lockHolderPid } = require('./lib/worktree-activity.js');

const SCHEMA_VERSION = 1;
const DEFAULT_FRESH_SECONDS = 900;

function usage(msg) {
  if (msg) process.stderr.write(`agent-liveness-check.js: ${msg}\n`);
  process.stderr.write('usage: agent-liveness-check.js [--repo-root <dir>] [--base <ref>] [--fresh-seconds N] [--container-prefix <p>] [--volume-prefix <p>] [--container-bin <bin>] [--json]\n');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    repoRoot: process.cwd(),
    base: '',
    freshSeconds: DEFAULT_FRESH_SECONDS,
    containerPrefix: '',
    volumePrefix: '',
    containerBin: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) usage(`${a} requires a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--repo-root': opts.repoRoot = next(); break;
      case '--base': opts.base = next(); break;
      case '--fresh-seconds': {
        const v = Number(next());
        if (!Number.isFinite(v) || v < 0) usage('--fresh-seconds must be a non-negative number');
        opts.freshSeconds = v;
        break;
      }
      case '--container-prefix': opts.containerPrefix = next(); break;
      case '--volume-prefix': opts.volumePrefix = next(); break;
      case '--container-bin': opts.containerBin = next(); break;
      case '--json': break;   // default; accepted so callers can be explicit
      case '-h': case '--help': usage(); break;
      default: usage(`unknown argument: ${a}`);
    }
  }
  return opts;
}

function git(repoRoot, args) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000,
    }).trim();
  } catch (_e) {
    return null;
  }
}

// Parse `git worktree list --porcelain` into records. Uses the porcelain form on purpose: the
// human form's column layout is not stable across git versions.
function readWorktrees(repoRoot) {
  const raw = git(repoRoot, ['worktree', 'list', '--porcelain']);
  if (raw === null) return [];
  const out = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice('worktree '.length), branch: null, head: null, detached: false, locked: false };
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      cur.detached = true;
    } else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function containerRuntime(explicit) {
  const candidates = explicit ? [explicit] : ['docker', 'podman'];
  for (const bin of candidates) {
    const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (probe.status === 0) return bin;
  }
  return null;
}

function listContainers(bin, prefix, warnings) {
  const res = spawnSync(bin, ['ps', '-a', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'], {
    encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    warnings.push(`${bin} ps failed (rc=${res.status}) — container section omitted`);
    return null;
  }
  return String(res.stdout || '').split('\n')
    .map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [name, status, image] = l.split('\t'); return { name, status, image }; })
    .filter((c) => c.name && c.name.startsWith(prefix));
}

function listVolumes(bin, prefix, warnings) {
  const res = spawnSync(bin, ['volume', 'ls', '--format', '{{.Name}}'], {
    encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    warnings.push(`${bin} volume ls failed (rc=${res.status}) — volume section omitted`);
    return null;
  }
  return String(res.stdout || '').split('\n')
    .map((l) => l.trim()).filter(Boolean)
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({ name }));
}

function diskFacts(target, warnings) {
  try {
    const st = fs.statfsSync(target);   // Node >= 18.15
    return {
      path: target,
      free_bytes: Number(st.bavail) * Number(st.bsize),
      total_bytes: Number(st.blocks) * Number(st.bsize),
    };
  } catch (e) {
    warnings.push(`statfs unavailable for ${target}: ${e.message}`);
    return null;
  }
}

function resolveBase(repoRoot, requested) {
  if (requested) return { ref: requested, resolved: git(repoRoot, ['rev-parse', '--verify', `${requested}^{commit}`]) !== null };
  const current = git(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  for (const candidate of [current, 'develop', 'main', 'master'].filter(Boolean)) {
    if (git(repoRoot, ['rev-parse', '--verify', `${candidate}^{commit}`]) !== null) {
      return { ref: candidate, resolved: true };
    }
  }
  return { ref: current || 'HEAD', resolved: false };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const warnings = [];
  const nowMs = Date.now();

  const repoRoot = git(opts.repoRoot, ['rev-parse', '--show-toplevel']);
  if (!repoRoot) {
    process.stderr.write(`agent-liveness-check.js: not a git repository (or git unavailable): ${opts.repoRoot}\n`);
    process.exit(2);
  }

  const base = resolveBase(repoRoot, opts.base);
  if (!base.resolved) warnings.push(`base ref '${base.ref}' does not resolve — ahead/behind counts omitted`);
  const baseSha = base.resolved ? git(repoRoot, ['rev-parse', base.ref]) : null;
  const baseCommittedAt = baseSha ? Number(git(repoRoot, ['show', '-s', '--format=%ct', baseSha])) : null;

  const worktrees = readWorktrees(repoRoot).map((wt) => {
    const exists = fs.existsSync(wt.path);
    const record = {
      path: wt.path,
      exists,
      branch: wt.branch,
      head: wt.head,
      detached: wt.detached,
      locked: wt.locked,
      dirty_files: null,
      ahead: null,
      behind: null,
      newest_mtime: null,
      newest_mtime_age_seconds: null,
      scan_truncated: false,
      fresh: false,
      lock_holder_pid: null,
    };
    if (!exists) return record;

    const status = git(wt.path, ['status', '--porcelain']);
    if (status !== null) record.dirty_files = status ? status.split('\n').length : 0;

    if (base.resolved && wt.head) {
      const counts = git(repoRoot, ['rev-list', '--left-right', '--count', `${base.ref}...${wt.head}`]);
      if (counts) {
        const [behind, ahead] = counts.split(/\s+/).map(Number);
        record.behind = Number.isFinite(behind) ? behind : null;
        record.ahead = Number.isFinite(ahead) ? ahead : null;
      }
    }

    const scan = newestMtime(wt.path);
    record.scan_truncated = scan.truncated;
    if (scan.mtime) {
      record.newest_mtime = new Date(scan.mtime).toISOString();
      record.newest_mtime_age_seconds = Math.max(0, Math.round((nowMs - scan.mtime) / 1000));
      record.fresh = record.newest_mtime_age_seconds <= opts.freshSeconds;
    }

    // The dispatch rails hold this lock for the life of a worktree run; a holder PID is the one
    // piece of process evidence that IS trustworthy here, because the holder is the running job.
    const holder = lockHolderPid(path.join(wt.path, '.autopilot-worktree.lock'));
    if (holder) record.lock_holder_pid = holder;
    return record;
  });

  let containers = null;
  let volumes = null;
  if (opts.containerPrefix || opts.volumePrefix) {
    const bin = containerRuntime(opts.containerBin);
    if (!bin) {
      warnings.push('no container runtime found — container/volume sections omitted');
    } else {
      if (opts.containerPrefix) containers = listContainers(bin, opts.containerPrefix, warnings);
      if (opts.volumePrefix) volumes = listVolumes(bin, opts.volumePrefix, warnings);
    }
  }

  const report = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date(nowMs).toISOString(),
    repo_root: repoRoot,
    base: base.ref,
    fresh_seconds: opts.freshSeconds,
    base_head: {
      ref: base.ref,
      sha: baseSha,
      resolved: base.resolved,
      committed_at: Number.isFinite(baseCommittedAt) ? new Date(baseCommittedAt * 1000).toISOString() : null,
      age_seconds: Number.isFinite(baseCommittedAt) ? Math.max(0, Math.round(nowMs / 1000 - baseCommittedAt)) : null,
    },
    worktrees,
    containers,
    volumes,
    disk: diskFacts(repoRoot, warnings),
    warnings,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

main();
