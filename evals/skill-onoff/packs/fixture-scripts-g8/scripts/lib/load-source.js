#!/usr/bin/env node
'use strict';

// scripts/lib/load-source.js — which copy of the autopilot plugin Claude Code actually loads (P7b).
// One detector shared by `scripts/dev-setup.sh --check` (CLI below) and the status watcher
// (`src/status/load-source.js` publishes it as `<live>/load-source.json`; the band's hygiene slot reads it).
//
// Why: the full plugin loader (/reload-plugins, /login, some startups) can copy a non-directory marketplace into
// `cache/<mkt>/<plugin>/<semver>/` and load THAT instead of the dev symlink (2026-10-06: a months-old 2.36.36 copy
// shadowed the dev tree). Each live Claude Code process leaves its pid under `<dir>/.in_use/<pid>`.
//
// detectLoadSource({ claudeDir, repoDir, sessionPid?, behindUpstream? }) -> {
//   plugin_version, source: "dev" | "cache:<semver>" | "unknown", source_basis,
//   marketplace: "directory" | "github" | … | "missing", marketplace_path, marketplace_is_dev,
//   dev_link_ok, behind_upstream: int|null, flags: [...],
//   stale_cache_dirs: [{ dir, in_use_pids: [...], alive: [...] }] }
// source_basis says HOW source was decided: "session_pid" (the caller's claude pid is listed in a cache dir's .in_use,
// or is not and the dev link is sound), "any_alive_pid" (no session pid given: some cache dir has a live pid, so the
// chip flags it conservatively), "dev_link" (no live pid in any cache dir and the dev link is sound), "none".
// The session-pid mapping is [unverified] against a real loader: the mod runs inside the claude process (process.pid
// there should be the claude pid) but that was not exercised; the unit tests plant `.in_use/<pid>` files.
//
// CLI (used by dev-setup.sh; the output formats are the shell's contract):
//   node load-source.js marketplace-desc --claude-dir D [--name autopilot]   -> `directory <path>` | `<kind>` | `missing`
//   node load-source.js stale-dirs --cache-base B                            -> one line per semver dir: `<name>\t<pids>\t<live>` (space-joined)
//   node load-source.js detect --claude-dir D --repo-dir R [--session-pid N] -> the JSON above

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$/;
const MARKETPLACE = 'autopilot';
const PLUGIN = 'autopilot';

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } }
function real(p) { try { return fs.realpathSync(p); } catch (_error) { return null; } }
function isAlive(pid) {
  // same as the shell `kill -0` it replaces: EPERM counts as not alive
  try { process.kill(Number(pid), 0); return true; } catch (_error) { return false; }
}

// { kind: "directory"|<other>|"missing", path: string|null } from known_marketplaces.json
function marketplaceSource(claudeDir, name = MARKETPLACE) {
  const known = readJson(path.join(claudeDir, 'plugins', 'known_marketplaces.json'));
  const entry = known && typeof known === 'object' ? known[name] : null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { kind: 'missing', path: null };
  const src = entry.source && typeof entry.source === 'object' ? entry.source : {};
  const kind = src.source === undefined || src.source === null ? 'unknown' : String(src.source);
  return { kind, path: kind === 'directory' ? String(src.path === undefined ? '' : src.path) : null };
}

// semver-named dirs under the cache base, each with the pids its .in_use lists
function listVersionDirs(cacheBase) {
  let names = [];
  try { names = fs.readdirSync(cacheBase); } catch (_error) { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (!SEMVER.test(name)) continue;
    const dir = path.join(cacheBase, name);
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch (_error) { continue; }
    let pids = [];
    try { pids = fs.readdirSync(path.join(dir, '.in_use')).sort(); } catch (_error) { /* no .in_use */ }
    out.push({ name, dir, in_use_pids: pids, alive: pids.filter(isAlive) });
  }
  return out;
}

function pluginVersion(repoDir) {
  const m = readJson(path.join(repoDir, '.claude-plugin', 'plugin.json'));
  return m && typeof m.version === 'string' ? m.version : null;
}

// commits the checked-out branch is behind its upstream, from LOCAL refs only (no fetch); null when unknown
function behindUpstreamOf(repoDir) {
  const r = spawnSync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD..@{u}'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0) return null;
  const n = Number.parseInt(String(r.stdout).trim(), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function detectLoadSource({ claudeDir, repoDir, sessionPid = null, behindUpstream } = {}) {
  const cacheBase = path.join(claudeDir, 'plugins', 'cache', MARKETPLACE, PLUGIN);
  const mkt = marketplaceSource(claudeDir);
  const repoReal = real(repoDir);
  const devLink = path.join(cacheBase, 'dev');
  const devLinkOk = (() => { try { return fs.lstatSync(devLink).isSymbolicLink() && real(devLink) === repoReal; } catch (_error) { return false; } })();
  const marketplaceIsDev = mkt.kind === 'directory' && Boolean(mkt.path) && real(mkt.path) === repoReal;
  const dirs = listVersionDirs(cacheBase);
  const stale = dirs.map((d) => ({ dir: d.dir, in_use_pids: d.in_use_pids, alive: d.alive }));
  const pid = sessionPid === null || sessionPid === undefined ? null : String(sessionPid);

  let source = 'unknown';
  let basis = 'none';
  const holder = pid === null ? null : dirs.find((d) => d.in_use_pids.includes(pid));
  if (holder) { source = `cache:${holder.name}`; basis = 'session_pid'; }
  else if (pid !== null) { if (devLinkOk) { source = 'dev'; basis = 'session_pid'; } }
  else {
    const live = dirs.filter((d) => d.alive.length > 0);
    if (live.length > 0) { source = `cache:${live[live.length - 1].name}`; basis = 'any_alive_pid'; }
    else if (devLinkOk) { source = 'dev'; basis = 'dev_link'; }
  }

  const flags = [];
  if (mkt.kind !== 'directory') flags.push('marketplace_not_directory');
  else if (!marketplaceIsDev) flags.push('marketplace_not_this_repo');
  if (!devLinkOk) flags.push('dev_link_missing_or_stale');
  if (dirs.length > 0) flags.push('stale_cache_dirs');
  if (source.startsWith('cache:')) flags.push('loaded_from_cache');

  return {
    plugin_version: pluginVersion(repoDir), source, source_basis: basis,
    marketplace: mkt.kind, marketplace_path: mkt.path, marketplace_is_dev: marketplaceIsDev, dev_link_ok: devLinkOk,
    behind_upstream: behindUpstream === undefined ? behindUpstreamOf(repoDir) : behindUpstream,
    flags, stale_cache_dirs: stale,
  };
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === 'marketplace-desc') {
    const s = marketplaceSource(arg('claude-dir'), arg('name') || MARKETPLACE);
    process.stdout.write(`${s.kind === 'directory' ? `directory ${s.path}` : s.kind}\n`);
    return 0;
  }
  if (cmd === 'stale-dirs') {
    for (const d of listVersionDirs(arg('cache-base'))) process.stdout.write(`${d.name}\t${d.in_use_pids.join(' ')}\t${d.alive.join(' ')}\n`);
    return 0;
  }
  if (cmd === 'detect') {
    process.stdout.write(`${JSON.stringify(detectLoadSource({ claudeDir: arg('claude-dir'), repoDir: arg('repo-dir'), sessionPid: arg('session-pid') || null }), null, 2)}\n`);
    return 0;
  }
  process.stderr.write('usage: load-source.js marketplace-desc|stale-dirs|detect (see header)\n');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { detectLoadSource, marketplaceSource, listVersionDirs, behindUpstreamOf };
