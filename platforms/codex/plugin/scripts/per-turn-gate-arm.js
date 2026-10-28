#!/usr/bin/env node
'use strict';

// per-turn-gate-arm.js - the only writer of the worker-bound gate file read by hooks/per-turn-gate.js
// (plan docs/plans/2026-10-26-depth0-per-turn-gate.md, section 3.1 and P2; BL-0306).
//
//   per-turn-gate-arm.js arm --session <id> [--agent <id>] --repo <dir> --rules <file>
//                            [--base <sha>] [--mode violations|violations+features]
//                            [--max-blocks 0|1|2] --ttl-seconds <n>
//   per-turn-gate-arm.js disarm --session <id> [--agent <id>]
//   per-turn-gate-arm.js show --session <id> [--agent <id>]
//   per-turn-gate-arm.js settings --out <file>
//
// arm first runs `gate-verify.js --check` on the rule list; when that fails nothing is written (exit 2).
// The gate file lives in <live-state>/per-turn-gate/<session>[.<agent>].gate.json (dir 0700, file 0600,
// written through a temp file and rename). It holds exactly seven keys: v, repo, base, mode, max_blocks,
// expires_at, rules. disarm is idempotent. settings writes a per-run --settings file whose Stop hook runs
// hooks/per-turn-gate.js (same shape as the P0 evidence mk-settings.js).
//
// Exit codes: 0 ok, 1 show: no file, 2 usage error or any failure (nothing written).
// Node built-ins only (Node >= 20.10).

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { resolveLiveDir } = require('./lib/live-state-dir.js');

const ID_RE = /^[A-Za-z0-9-]{1,128}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MODES = ['violations', 'violations+features'];
const STEM = 'per-turn-gate';
const GATE_VERIFY = path.join(__dirname, 'gate-verify.js');
const HOOK = path.resolve(__dirname, '..', 'hooks', 'per-turn-gate.js');

class Usage extends Error {}
const die = (m) => { throw new Usage(m); };

// Same isolation as scripts/gate-verify.js git() (a worker repo's .git/config must not run code).
function isolatedGit(repo, args) {
  const env = {};
  for (const k of Object.keys(process.env)) if (!k.startsWith('GIT_')) env[k] = process.env[k];
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_NO_REPLACE_OBJECTS = '1';
  const full = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null'].concat(args);
  return cp.spawnSync('git', full, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
}

function parse(argv) {
  const opts = {};
  const withValue = new Set(['--session', '--agent', '--repo', '--rules', '--base', '--mode', '--max-blocks', '--ttl-seconds', '--out']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!withValue.has(a)) die(`unknown argument: ${a}`);
    if (i + 1 >= argv.length) die(`missing value for ${a}`);
    opts[a.slice(2)] = argv[++i];
  }
  return opts;
}

function keyOf(opts) {
  if (typeof opts.session !== 'string' || !ID_RE.test(opts.session)) die('--session must match ^[A-Za-z0-9-]{1,128}$');
  if (opts.agent === undefined) return opts.session;
  if (!ID_RE.test(opts.agent)) die('--agent must match ^[A-Za-z0-9-]{1,128}$');
  return `${opts.session}.${opts.agent}`;
}

function gateDir() {
  return path.join(resolveLiveDir().base, STEM);
}

function arm(opts) {
  const key = keyOf(opts);
  if (!opts.repo) die('--repo is required');
  if (!opts.rules) die('--rules is required');
  if (opts['ttl-seconds'] === undefined || !/^[0-9]{1,9}$/.test(opts['ttl-seconds']) || Number(opts['ttl-seconds']) < 1) die('--ttl-seconds is required (positive integer)');
  const mode = opts.mode === undefined ? 'violations+features' : opts.mode;
  if (!MODES.includes(mode)) die('--mode must be violations or violations+features');
  const maxBlocks = opts['max-blocks'] === undefined ? 2 : Number(opts['max-blocks']);
  if (!Number.isInteger(maxBlocks) || maxBlocks < 0 || maxBlocks > 2 || (opts['max-blocks'] !== undefined && !/^[0-2]$/.test(opts['max-blocks']))) die('--max-blocks must be 0, 1 or 2');
  let repo;
  try { repo = fs.realpathSync(opts.repo); } catch (e) { die(`--repo unreadable: ${e.message}`); }
  let base = opts.base;
  if (base === undefined) {
    const r = isolatedGit(repo, ['rev-parse', 'HEAD']);
    if (r.error || r.status !== 0) die('cannot resolve HEAD of --repo');
    base = String(r.stdout).trim();
  }
  if (!SHA_RE.test(base)) die('--base must be a 40-hex sha');
  let rules;
  try { rules = JSON.parse(fs.readFileSync(opts.rules, 'utf8')); } catch (e) { die(`--rules unreadable or not JSON: ${e.message}`); }
  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) die('--rules must hold a JSON object');

  const chk = cp.spawnSync(process.execPath, [GATE_VERIFY, '--check', '--rules', opts.rules, '--base', base, '--repo', repo, '--json'], {
    encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (chk.error || chk.status !== 0) die(`rule list failed gate-verify --check: ${String(chk.stdout || chk.stderr || (chk.error && chk.error.message)).trim().slice(0, 500)}`);

  const dir = gateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_e) { /* not ours to tighten: the write below still succeeds */ }
  const file = path.join(dir, `${key}.gate.json`);
  const expires = new Date(Date.now() + Number(opts['ttl-seconds']) * 1000).toISOString();
  const body = { v: 1, repo, base, mode, max_blocks: maxBlocks, expires_at: expires, rules };
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(body)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* nothing */ }
    die(`cannot write gate file: ${e.message}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, path: file, expires_at: expires })}\n`);
  return 0;
}

function disarm(opts) {
  const file = path.join(gateDir(), `${keyOf(opts)}.gate.json`);
  try { fs.unlinkSync(file); } catch (e) { if (!e || e.code !== 'ENOENT') die(`cannot remove gate file: ${e.message}`); }
  return 0;
}

function show(opts) {
  const file = path.join(gateDir(), `${keyOf(opts)}.gate.json`);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_e) { return 1; }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}

function settings(opts) {
  if (!opts.out) die('--out is required');
  const q = (x) => `'${String(x).replace(/'/g, `'\\''`)}'`;
  const body = { hooks: { Stop: [{ hooks: [{ type: 'command', command: `${q(process.execPath)} ${q(HOOK)}`, timeout: 60 }] }] } };
  fs.writeFileSync(opts.out, `${JSON.stringify(body, null, 2)}\n`);
  return 0;
}

function main(argv) {
  const cmd = argv[0];
  const opts = parse(argv.slice(1));
  if (cmd === 'arm') return arm(opts);
  if (cmd === 'disarm') return disarm(opts);
  if (cmd === 'show') return show(opts);
  if (cmd === 'settings') return settings(opts);
  die('usage: per-turn-gate-arm.js arm|disarm|show|settings ...');
  return 2;
}

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`per-turn-gate-arm: ${e instanceof Usage ? e.message : `internal error: ${e && e.stack || e}`}\n`);
    code = 2;
  }
  process.exitCode = code;
}
