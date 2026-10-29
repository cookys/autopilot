'use strict';
// d0gate/cell.js - a d0gate cell on disk: fixture repo + installed fixture packs + per-cell live/state dirs, plus a PATH
// sentinel for runner binaries. Everything lives under one cell root on tmpfs ($XDG_RUNTIME_DIR, else /dev/shm; an explicit
// D0GATE_CELL_BASE wins, used by tests). Zero spend: the stub dispatch never starts a model runner.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const L = require('./lib');

// A cell root must be tmpfs/ramfs (the hook state is rewritten every turn): there is NO fallback to a disk directory.
function isTmpfs(dir) {
  const r = cp.spawnSync('findmnt', ['-T', dir, '-o', 'FSTYPE', '-n'], { encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status !== 0) {
    const s = cp.spawnSync('stat', ['-f', '-c', '%T', dir], { encoding: 'utf8', timeout: 5000 });
    return s.status === 0 && /^(tmpfs|ramfs)$/.test(String(s.stdout).trim());
  }
  return /^(tmpfs|ramfs)$/.test(String(r.stdout).trim());
}
function assertTmpfs(dir, why) {
  try { fs.accessSync(dir, fs.constants.W_OK); } catch { throw new Error(`d0gate cell base ${dir} (${why}) is not writable`); }
  if (!isTmpfs(dir)) throw new Error(`d0gate cell base ${dir} (${why}) is not tmpfs/ramfs; refusing to build a cell on disk`);
  return dir;
}
function cellBase() {
  if (process.env.D0GATE_CELL_BASE) return assertTmpfs(process.env.D0GATE_CELL_BASE, 'D0GATE_CELL_BASE');
  for (const c of [process.env.XDG_RUNTIME_DIR, '/dev/shm']) {
    if (c) { try { return assertTmpfs(c, 'default'); } catch { /* next candidate */ } }
  }
  throw new Error('d0gate: no tmpfs base for a cell (set D0GATE_CELL_BASE to a tmpfs directory; XDG_RUNTIME_DIR and /dev/shm are unusable)');
}
const SENTINEL_NAMES = ['claude', 'codex', 'agy', 'opencode', 'kimi', 'grok', 'cursor-agent', 'gemini'];
// A sentinel dir goes FIRST on PATH: each runner name is a script that logs its argv and exits 97.
function makeSentinel(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'sentinel.log');
  fs.writeFileSync(log, '');
  for (const n of SENTINEL_NAMES) {
    const f = path.join(dir, n);
    fs.writeFileSync(f, `#!/bin/sh\necho "${n} $*" >>'${log}'\nexit 97\n`, { mode: 0o755 });
  }
  return { dir, log, env: (base) => ({ ...base, PATH: `${dir}:${base.PATH || ''}` }), calls: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

class Cell {
  constructor(opts = {}) {
    const base = opts.base ? assertTmpfs(opts.base, 'opts.base') : cellBase();
    this.root = fs.mkdtempSync(path.join(base, 'd0gate-cell-'));
    this.repo = path.join(this.root, 'repo');
    this.live = path.join(this.root, 'live');
    this.home = path.join(this.root, 'home');
    this.prompt = path.join(this.root, 'prompt.txt');
    this.sentinel = opts.sentinel || null;
    this.baseSha = null;
  }
  // pin(values): write values into this cell's own copy of the stub; the stub trusts nothing else (no environment value, no call position).
  //   cell: the cell root (written once at init); worker / hookCmd / noDisarm: the worker mode and the test-only negative-control knobs.
  // Only keys present in `values` change; an absent or empty value means the stub's default.
  pin(values) {
    const q = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
    const names = { cell: 'D0G_PINNED_CELL', worker: 'D0G_PINNED_WORKER', hookCmd: 'D0G_PINNED_HOOK_CMD', noDisarm: 'D0G_PINNED_NO_DISARM' };
    let text = fs.readFileSync(this.stubPath, 'utf8');
    for (const [k, v] of Object.entries(values)) {
      if (!names[k]) throw new Error(`d0gate: unknown stub knob ${k}`);
      const re = new RegExp(`^${names[k]}=.*$`, 'm');
      if (!re.test(text)) throw new Error(`d0gate: the stub has no ${names[k]} line to pin`);
      text = text.replace(re, () => `${names[k]}=${v === undefined || v === null || v === '' ? '""' : q(v)}`);
    }
    fs.writeFileSync(this.stubPath, text);
    return this;
  }
  init(opts = {}) {
    for (const d of [this.live, this.home, path.join(this.home, '.claude'), path.join(this.root, '.d0gate'), path.join(this.root, 'rules')]) fs.mkdirSync(d, { recursive: true });
    fs.chmodSync(this.live, 0o700);
    this.baseSha = L.buildTinylib(this.repo);
    fs.writeFileSync(path.join(this.root, '.d0gate', 'base_sha'), `${this.baseSha}\n`);
    // install the fixture packs onto the repo root (untracked + excluded: the worker worktrees start from the base commit)
    for (const id of ['fixture-scripts-d0gate', 'fixture-stubs-d0gate']) L.copyTree(path.join(L.packsDir(), id), this.repo);
    this.stubPath = path.join(this.repo, 'scripts', 'dispatch-hetero.sh');
    this.pin({ cell: fs.realpathSync(this.root), ...(opts.knobs || {}) });
    fs.writeFileSync(path.join(this.repo, '.git', 'info', 'exclude'), 'scripts/\nhooks/\nschemas/\ngate/\n');
    fs.writeFileSync(path.join(this.root, 'config.json'), '{}\n');
    fs.writeFileSync(this.prompt, 'Implement the task described by the owner in this repository. Work in the repository root.\n');
    return this;
  }
  env(extra = {}) {
    const keep = {};
    for (const k of ['PATH', 'LANG', 'TERM', 'TMPDIR']) if (process.env[k]) keep[k] = process.env[k];
    const base = {
      ...keep, HOME: this.home, CLAUDE_CONFIG_DIR: path.join(this.home, '.claude'), D0GATE_CELL: this.root, D0GATE_LIVE: this.live,
      AUTOPILOT_LIVE_DIR: this.live, AUTOPILOT_CONFIG_FILE: path.join(this.root, 'config.json'), ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    };
    return this.sentinel ? this.sentinel.env({ ...base, ...extra }) : { ...base, ...extra };
  }
  write(rel, text) { const f = path.join(this.repo, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; }
  // putRules(fixtureName, where): where = 'repo' (repo/gate/rules.json) or 'tmp' (cell/rules/<name>); returns the absolute path.
  putRules(name, where = 'repo') {
    const src = L.rulesPath(name);
    const dst = where === 'repo' ? path.join(this.repo, 'gate', 'rules.json') : path.join(this.root, 'rules', name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return dst;
  }
  // pinKnobs(opts): the stub worker mode and negative-control knobs of the next call (opts.worker / hookCmd / noDisarm), written into the stub.
  // opts.rawEnv is passed to the process as-is (the way a caller could set it): the stub ignores those values and flags them.
  pinKnobs(opts) { return this.pin({ worker: opts.worker || '', hookCmd: opts.hookCmd || '', noDisarm: opts.noDisarm || '' }); }
  // std(extra, opts): the usual claude-native dispatch; opts.worker sets the stub worker mode, opts.env adds env.
  std(extra = [], opts = {}) {
    const runner = opts.runner || 'claude-native';
    return this.dispatch(['--runner', runner, '--model', 'm', '--prompt-file', this.prompt, ...extra], opts);
  }
  dispatch(args, opts = {}) {
    const script = opts.script || path.join(this.repo, 'scripts', 'dispatch-hetero.sh');
    if (!opts.script) this.pinKnobs(opts);
    const env = this.env({ ...(opts.rawEnv || {}) });
    const r = cp.spawnSync('bash', [script, ...args], { cwd: opts.cwd || this.repo, env, encoding: 'utf8', timeout: 120000 });
    return { rc: r.status, out: String(r.stdout), err: String(r.stderr) };
  }
  // sh(cmd, opts): run a shell command line in the cell (cd into subdirs, ./script form, ...).
  sh(cmd, opts = {}) {
    this.pinKnobs(opts);
    const env = this.env({ ...(opts.rawEnv || {}) });
    const r = cp.spawnSync('bash', ['-c', cmd], { cwd: opts.cwd || this.repo, env, encoding: 'utf8', timeout: 120000 });
    return { rc: r.status, out: String(r.stdout), err: String(r.stderr) };
  }
  facts() { return L.readFacts(this.root); }
  destroy() {
    try { cp.spawnSync('git', ['-C', this.repo, 'worktree', 'prune'], { stdio: 'ignore' }); } catch { /* none */ }
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}
module.exports = { Cell, cellBase, isTmpfs, makeSentinel, SENTINEL_NAMES };
