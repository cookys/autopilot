#!/usr/bin/env node
// opencode-discovery-probe.js — ask a real opencode binary three questions about a repo's
// .opencode/ + .agents/skills/ consumer layer, entirely inside a throwaway sandbox:
//   1. did the autopilot plugin load, and which version did it report?
//   2. can the skill (default dev-flow) be discovered?
//   3. does the agent (default autopilot-reviewer) resolve its {file:...} body without the
//      YAML frontmatter leaking into the prompt?
// It prints ONE JSON object of facts; the verdicts (hard / advisory) live in the callers
// (scripts/preflight-portability.sh, hooks/tests/opencode-v2-plugin.test.sh).
//
// Why a probe and not `opencode debug ...`: opencode 2.x moved debug/api commands behind the
// per-machine background service (fixed port, the caller's env ignored, owner's real data dir),
// removed `debug skill` / `debug agent`, and fills its agent / skill / plugin lists
// asynchronously after boot (an immediate `opencode api --standalone GET /api/skill` returns
// []). The only reliable, isolated 2.x surface is a private `opencode serve` on a free port,
// polled over HTTP until the lists are populated. 1.x keeps the `debug config|skill|agent`
// commands, which are synchronous.
//
// Isolation (hard rule): HOME and every XDG_* dir point inside --root; every inherited
// OPENCODE_* variable is dropped; the project is a COPY of the repo's consumer layer made
// under --root (never the repo itself: opencode writes package.json / lock files into the
// .opencode it finds). Nothing under the real ~/.config|.local/share|.cache/opencode is read
// or written.
//
// Usage:
//   node opencode-discovery-probe.js --bin opencode --repo <repo> [--root DIR]
//        [--skill dev-flow] [--agent autopilot-reviewer] [--timeout-ms 60000]
//        [--env KEY=VAL ...] [--log-file F]
// Exit: 0 facts printed; 2 usage; 3 unknown opencode major (fail closed, JSON {error});
//       4 the binary failed to start / answer.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { detectAdaptor } = require('./opencode-containment.js');

function parseArgs(argv) {
  const o = { env: {}, skill: 'dev-flow', agent: 'autopilot-reviewer', timeoutMs: 60000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--bin') o.bin = v();
    else if (k === '--repo') o.repo = v();
    else if (k === '--root') o.root = v();
    else if (k === '--skill') o.skill = v();
    else if (k === '--agent') o.agent = v();
    else if (k === '--timeout-ms') o.timeoutMs = Number(v());
    else if (k === '--log-file') o.logFile = v();
    else if (k === '--env') {
      const kv = v() || '';
      const eq = kv.indexOf('=');
      if (eq < 1) usage('--env wants KEY=VAL');
      o.env[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else usage(`unknown argument ${k}`);
  }
  if (!o.bin || !o.repo) usage('--bin and --repo are required');
  return o;
}

function usage(msg) {
  process.stderr.write(`opencode-discovery-probe: ${msg}\n`);
  process.exit(2);
}

// Copy the repo's opencode consumer layer into <root>/project. package.json / lock files are
// left out on purpose: the plugin only imports types, and a present package.json makes opencode
// 1.x try an npm install (network) inside the sandbox.
function buildProject(repo, root) {
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  const cp = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: false });
  const plug = path.join(repo, '.claude-plugin');
  if (fs.existsSync(plug)) cp(plug, path.join(project, '.claude-plugin'));
  const oc = path.join(repo, '.opencode');
  if (fs.existsSync(oc)) {
    fs.mkdirSync(path.join(project, '.opencode'), { recursive: true });
    for (const name of fs.readdirSync(oc)) {
      if (['node_modules', 'package.json', 'package-lock.json'].includes(name)) continue;
      cp(path.join(oc, name), path.join(project, '.opencode', name));
    }
  }
  const agents = path.join(repo, '.agents');
  if (fs.existsSync(agents)) fs.symlinkSync(fs.realpathSync(agents), path.join(project, '.agents'));
  return fs.realpathSync(project);
}

function sandboxEnv(root, project, extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('OPENCODE_') && !k.startsWith('XDG_')) env[k] = v;
  const home = path.join(root, 'home');
  const dirs = { HOME: home, XDG_CONFIG_HOME: path.join(root, 'xdg-config'), XDG_DATA_HOME: path.join(root, 'xdg-data'),
    XDG_CACHE_HOME: path.join(root, 'xdg-cache'), XDG_STATE_HOME: path.join(root, 'xdg-state') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  // v2 resolves its project directory from $PWD, not only from the process cwd.
  return { ...env, ...dirs, PWD: project, ...extra };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function httpGetJson(port, pathname, password) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 5000,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, json: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null }); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const leaks = (prompt) => /^\s*---\s*(\r?\n|$)/.test(String(prompt || ''));

async function probeV2(o, project, env, log) {
  const port = await freePort();
  const password = crypto.randomBytes(16).toString('hex');
  const child = spawn(o.bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: project, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, OPENCODE_SERVER_PASSWORD: password },
  });
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  let exited = false;
  child.on('exit', () => { exited = true; });
  const stop = () => { if (!exited) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } } };
  process.on('exit', stop);
  try {
    const deadline = Date.now() + o.timeoutMs;
    let skills = null; let agent = null; let plugins = null; let settledAt = 0;
    while (Date.now() < deadline && !exited) {
      const [s, a, p] = await Promise.all([
        httpGetJson(port, '/api/skill', password),
        httpGetJson(port, `/api/agent/${encodeURIComponent(o.agent)}`, password),
        httpGetJson(port, '/api/plugin', password),
      ]);
      if (s.json && Array.isArray(s.json.data)) skills = s.json.data;
      if (a.status === 200 && a.json && a.json.data) agent = a.json.data;
      if (p.json && Array.isArray(p.json.data)) plugins = p.json.data;
      const pluginSeen = plugins && plugins.some((x) => x.source && x.source.type !== 'builtin');
      const listsReady = skills && skills.length > 0 && agent;
      // Lists fill asynchronously: stop as soon as everything is there; if the plugin never
      // shows up, give it a bounded grace window after the lists settle, then report absence.
      if (listsReady && pluginSeen && /plugin loaded, version:/.test(log.join(''))) break;
      if (listsReady) { settledAt = settledAt || Date.now(); if (Date.now() - settledAt > 8000) break; }
      await sleep(500);
    }
    if (exited && !skills) return { startFailed: true };
    const text = log.join('');
    const m = /\[autopilot\] plugin loaded, version: (\S+)/.exec(text);
    const external = (plugins || []).filter((x) => x.source && x.source.type !== 'builtin');
    return {
      plugin_loaded_version: m ? m[1] : null,
      plugin_registered: external.some((x) => x.state && x.state.status === 'active'),
      plugin_ids: external.map((x) => x.id),
      skill_count: skills ? skills.length : 0,
      skill_found: !!(skills && skills.some((x) => x.name === o.skill)),
      agent_found: !!agent,
      agent_prompt_head: agent ? String(agent.system || '').slice(0, 120) : '',
      agent_frontmatter_leak: agent ? leaks(agent.system) : false,
    };
  } finally {
    stop();
    await sleep(200);
  }
}

function runV1(o, args, project, env) {
  return spawnSync(o.bin, args, { cwd: project, env, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function probeV1(o, project, env, log) {
  const cfg = runV1(o, ['debug', 'config', '--print-logs'], project, env);
  const cfgText = `${cfg.stdout || ''}${cfg.stderr || ''}`;
  log.push(cfgText);
  const m = /\[autopilot\] plugin loaded, version: (\S+)/.exec(cfgText);
  // opencode 1.x's first cold `debug skill` can return a partial listing; retry like the old gate.
  let skillOut = '';
  for (let i = 0; i < 3; i++) {
    skillOut = (runV1(o, ['debug', 'skill'], project, env).stdout) || '';
    if (skillOut.includes(`"name": "${o.skill}"`)) break;
    await sleep(1000);
  }
  const ag = runV1(o, ['debug', 'agent', o.agent], project, env);
  let prompt = '';
  let agentFound = false;
  try {
    const j = JSON.parse(ag.stdout);
    agentFound = true;
    prompt = String(j.prompt || '');
  } catch { /* not json: not found */ }
  log.push(skillOut, ag.stdout || '');
  return {
    plugin_loaded_version: m ? m[1] : null,
    plugin_registered: !!m,
    plugin_ids: [],
    skill_count: (skillOut.match(/"name": "/g) || []).length,
    skill_found: skillOut.includes(`"name": "${o.skill}"`),
    agent_found: agentFound,
    agent_prompt_head: prompt.slice(0, 120),
    agent_frontmatter_leak: leaks(prompt),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  // Own sandbox root (no --root): removed at the end whatever happens; a caller-supplied --root
  // is the caller's to keep (the tests read the intent file and data dir under it afterwards).
  let tmpRoot = null;
  try {
    tmpRoot = o.root ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'oc-probe-'));
    if (o.root) fs.mkdirSync(o.root, { recursive: true });
    const root = fs.realpathSync(o.root || tmpRoot);
    // `opencode --version` itself appends a "cli starting" line to <XDG_DATA_HOME>/opencode/log, so
    // even the version probe runs inside the sandbox env (never the caller's real one).
    const env = sandboxEnv(root, root, o.env);
    let adaptor;
    try { adaptor = detectAdaptor(o.bin, { env }); } catch (e) {
      process.stdout.write(`${JSON.stringify({ error: e.message })}\n`);
      process.exitCode = 3;
      return;
    }
    const project = buildProject(path.resolve(o.repo), root);
    env.PWD = project;
    const log = [];
    const facts = adaptor.adaptor === 'v2' ? await probeV2(o, project, env, log) : await probeV1(o, project, env, log);
    if (o.logFile) fs.writeFileSync(o.logFile, log.join(''));
    if (facts.startFailed) {
      process.stdout.write(`${JSON.stringify({ adaptor: adaptor.adaptor, version: adaptor.version, error: 'opencode exited before answering' })}\n`);
      process.exitCode = 4;
      return;
    }
    process.stdout.write(`${JSON.stringify({ adaptor: adaptor.adaptor, version: adaptor.version, root, ...facts })}\n`);
  } finally {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((e) => { process.stderr.write(`opencode-discovery-probe: ${e.stack || e}\n`); process.exitCode = 4; });
