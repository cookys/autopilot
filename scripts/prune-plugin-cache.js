#!/usr/bin/env node
'use strict';
// prune-plugin-cache — delete ONE stale plugin cache copy, after re-checking that it is safe NOW.
//
// USAGE: prune-plugin-cache.js --version <semver> [--claude-dir <dir>] [--repo-dir <dir>] [--dry-run]
//   --claude-dir  the Claude config dir (default ~/.claude); the copy is <claude-dir>/plugins/cache/autopilot/autopilot/<version>/
//   --repo-dir    the plugin checkout used to decide which copy is loaded (default: this script's repo)
//   --dry-run     report only; delete nothing
//
// Removes the copy only when ALL hold, re-read at call time (the live pane's `[ 清掉 ]` button on the 外掛來源 row calls this, never an rm of its own):
//   (a) the version is a semver name (no path syntax) and the resolved path sits directly under the cache base, is a real directory (not a symlink, so never the `dev` link);
//   (b) no process in its `.in_use` list is alive, it is not the copy detectLoadSource() says is loaded and not the `installPath` of autopilot@autopilot in installed_plugins.json (the same judgement as the pane's "沒有程式在用", scripts/lib/load-source.js).
// Exit 0 = removed (or would be, with --dry-run); 1 = refused, the reason on stdout as JSON {ok:false,reason}; 2 = usage.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectLoadSource, listVersionDirs } = require('./lib/load-source.js');

function parse(argv) {
  const o = { version: null, claudeDir: path.join(os.homedir(), '.claude'), repoDir: path.resolve(__dirname, '..'), dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const need = () => { if (argv[i + 1] === undefined) throw new Error(`${k} needs a value`); i += 1; return argv[i]; };
    if (k === '--version') o.version = need();
    else if (k === '--claude-dir') o.claudeDir = need();
    else if (k === '--repo-dir') o.repoDir = need();
    else if (k === '--dry-run') o.dryRun = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (!o.version) throw new Error('--version is required');
  return o;
}

function decide(o) {
  const base = path.join(o.claudeDir, 'plugins', 'cache', 'autopilot', 'autopilot');
  const dir = path.join(base, o.version);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]*)?$/.test(o.version)) return { ok: false, reason: 'not a version name', dir };
  if (path.dirname(dir) !== base) return { ok: false, reason: 'outside the cache base', dir };
  let st;
  try { st = fs.lstatSync(dir); } catch (_e) { return { ok: false, reason: 'no such cache copy', dir }; }
  if (!st.isDirectory() || st.isSymbolicLink()) return { ok: false, reason: 'not a plain directory (a link such as dev is never removed)', dir };
  const found = listVersionDirs(base).find((d) => d.name === o.version);
  if (!found) return { ok: false, reason: 'not listed as a cache copy', dir };
  if (found.alive.length > 0) return { ok: false, reason: `in use by pid ${found.alive.join(', ')}`, dir };
  // the copy Claude Code installed the plugin from (installed_plugins.json, the same file `claude plugin` keeps): that one is the loaded version even when no pid is listed yet
  let installed = [];
  let raw = null;
  try { raw = fs.readFileSync(path.join(o.claudeDir, 'plugins', 'installed_plugins.json'), 'utf8'); } catch (e) {
    if (!e || e.code !== 'ENOENT') return { ok: false, reason: `cannot read installed_plugins.json (${e && e.code ? e.code : 'error'}): refusing to delete`, dir };
  }
  if (raw !== null) { // present: it must parse and have the known shape, else we cannot tell which copy is installed and keep everything
    let j = null;
    try { j = JSON.parse(raw); } catch (_e) { return { ok: false, reason: 'installed_plugins.json does not parse: refusing to delete', dir }; }
    if (!j || typeof j !== 'object' || !j.plugins || typeof j.plugins !== 'object' || Array.isArray(j.plugins)) return { ok: false, reason: 'installed_plugins.json has an unknown shape: refusing to delete', dir };
    const mine = j.plugins['autopilot@autopilot'];
    if (mine !== undefined && !Array.isArray(mine)) return { ok: false, reason: 'installed_plugins.json has an unknown shape: refusing to delete', dir };
    installed = (mine || []).map((e) => (e && typeof e.installPath === 'string' ? path.resolve(e.installPath) : ''));
  }
  if (installed.includes(path.resolve(dir))) return { ok: false, reason: 'this is the copy the plugin is installed from', dir };
  const src = detectLoadSource({ claudeDir: o.claudeDir, repoDir: o.repoDir, behindUpstream: null });
  if (src.source === `cache:${o.version}`) return { ok: false, reason: 'this is the copy currently loaded', dir };
  return { ok: true, dir };
}

function main(argv) {
  let o;
  try { o = parse(argv); } catch (e) { process.stderr.write(`prune-plugin-cache: ${e.message}\n`); return 2; }
  const d = decide(o);
  if (!d.ok) { process.stdout.write(`${JSON.stringify(d)}\n`); return 1; }
  if (!o.dryRun) fs.rmSync(d.dir, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ ok: true, dir: d.dir, removed: !o.dryRun, dry_run: o.dryRun })}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { decide };
