#!/usr/bin/env node
'use strict';
// run-p2-batch.js - BL-0055 phase 2 batch wrapper v2 (plan docs/plans/2026-10-24-per-turn-gate-phase2.md, 3 and 3.1).
//
// D2 design: 30 ON runs (`--gate hook`) and 30 C runs (`--gate observe`) interleaved in pairs, order from a seed in
// the preregistration. One harness call per id, never a second attempt. Every validity condition of plan 3.1 has an
// artifact this wrapper writes at the moment the condition applies (invocation.log lines and files); `--audit`
// re-derives the verdict from those artifacts and exits non-zero if any is absent or any condition fails.
//
//   node run-p2-batch.js --selfcheck                       print the 3.1 table, run a synthetic batch, assert a writer per row
//   node run-p2-batch.js --order --manifest M              print the seeded order
//   node run-p2-batch.js --run --run-dir D --clone C --manifest M [--first i] [--last j]
//   node run-p2-batch.js --audit --run-dir D --manifest M  exit 0 only when every artifact is present and every condition holds
//
// Manifest (JSON; the preregistration commits it and states its sha256): task, model, cli, seed, n_per_arm,
// arms {ON:{gate,cap,prior_run}, C:{gate,cap,prior_run}}, probe_cost, window_s, min_complete, max_blocks, prereg,
// taskhash_expected, argv_sha {ON,C}, hashes {wrapper,hook,harness}, hook_path, harness_path.
//
// Exit codes: 0 done, 2 usage, 3 abort (prereg, version, hash, task hash), 4 refuse (id exists or predecessor
// unfinished), 5 STOP_COST, 6 STOP_AUTH, 7 probe failed (id not launched), 8 STOP_WINDOW, 1 audit failure.
// Times come from node (the host date is uutils and drops the leading zeros of %3N). The log never carries a
// scratch path. Every external command is prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ENV_PREFIX = ['env', '-u', 'AUTOPILOT_SESSION_ID', '-u', 'CLAUDE_CODE_SESSION_ID'];
const AUTH_RE = /failed to authenticate|oauth session expired|authentication_failed/i;
const PROJECTION_AFTER = 5;
const pad2 = (n) => String(n).padStart(2, '0');
const nowIso = () => new Date().toISOString();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- pure helpers (exported for tests)

function mulberry32(a) {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded interleaving: pair k holds ON-k and C-k, a coin from mulberry32(first 32 bits of sha256(seed)) picks who goes first. */
function makeOrder(seed, nPerArm) {
  const rng = mulberry32(crypto.createHash('sha256').update(String(seed)).digest().readUInt32BE(0));
  const out = [];
  for (let k = 1; k <= nPerArm; k++) {
    const onFirst = rng() < 0.5;
    const on = { id: `ON-${pad2(k)}`, arm: 'ON' };
    const c = { id: `C-${pad2(k)}`, arm: 'C' };
    out.push(...(onFirst ? [on, c] : [c, on]));
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sampleSd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};

/**
 * THE cost stop rule (one function; the preregistration quotes it). Per arm, before launching an id:
 *   spent = runs already paid in this arm + probes already paid in this arm
 *   fewer than 5 finished runs in the arm: projected = spent + one probe (no projection yet), stage pre5
 *   5 or more: projected = spent + remaining * (mean + 2 * sample sd of the finished run costs + one probe),
 *              remaining = ids of the arm not yet finished, the one about to start included; stage post5
 * stop when projected > the arm's cap.
 */
function projectCost({ runCosts, probeSpent, total, cap, probeCost }) {
  const spent = runCosts.reduce((x, y) => x + y, 0) + probeSpent;
  if (runCosts.length < PROJECTION_AFTER) {
    const projected = spent + probeCost;
    return { stage: 'pre5', spent, projected, cap, stop: projected > cap };
  }
  const remaining = total - runCosts.length;
  const projected = spent + remaining * (mean(runCosts) + 2 * sampleSd(runCosts) + probeCost);
  return { stage: 'post5', spent, projected, cap, stop: projected > cap };
}

function harnessArgv(m, arm, out, trace) {
  return ['bash', m.harness_path, '--task', m.task, '--arm', 'off', '--runner', 'cc', '--model', m.model,
    '--out', out, '--gate', m.arms[arm].gate, '--hook-trace-dir', trace];
}
const argvSha = (argv, out, trace) =>
  sha256(JSON.stringify(argv.map((a) => (a === out ? '<out>' : a === trace ? '<trace>' : a))));

/** All top-level JSON objects of a text, string-aware (a brace inside a string does not count). */
function jsonObjects(text) {
  const res = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try { res.push(JSON.parse(text.slice(start, i + 1))); } catch (_e) { /* skip */ }
        start = -1;
      }
    }
  }
  return res;
}

/** git hash-object of a blob, computed without git: sha1("blob <len>\0" + bytes). */
const gitBlobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

function taskListing(taskDir) {
  const files = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.isFile()) files.push(r);
    }
  };
  walk(taskDir, '.');
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return files.map((f) => `${gitBlobSha(fs.readFileSync(path.join(taskDir, f)))}  ${f}\n`).join('');
}

function parseLog(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const m = /^(\S+) (\S+)(?: (.*))?$/.exec(line);
    if (!m) { rows.push({ ts: null, kind: '?', rest: line, raw: line }); continue; }
    rows.push({ ts: m[1], kind: m[2], rest: m[3] || '', raw: line });
  }
  return rows;
}
const idOf = (r) => r.rest.split(' ')[0];
const kvOf = (rest) => {
  const o = {};
  for (const t of rest.split(' ')) { const i = t.indexOf('='); if (i > 0) o[t.slice(0, i)] = t.slice(i + 1); }
  return o;
};

// ---------------------------------------------------------------- the 3.1 table

// tokens: log kinds the writer emits (or files, prefixed "file:"); writer: the function that emits them.
const ROWS = [
  { key: 'order-and-uniqueness', cond: 'Each id launched exactly once, in the preregistered order', applies: 'per id', artifact: 'START <id> / END <id> rc=', writer: 'writeStartEnd', tokens: ['START', 'END'] },
  { key: 'window', cond: 'Sequential, one window of at most 8 h', applies: 'per id and end', artifact: 'WINDOW_START once; elapsed in each START; STOP_WINDOW', writer: 'writeWindow', tokens: ['WINDOW_START'] },
  { key: 'taskhash', cond: 'Task hashes equal the preregistered listing', applies: 'first call, last call, early exit', artifact: 'taskhash.pre.txt, taskhash.post.txt, TASKHASH_DIFF ok|fail', writer: 'writeTaskHash', tokens: ['TASKHASH_DIFF', 'file:taskhash.pre.txt', 'file:taskhash.post.txt'] },
  { key: 'cli-version', cond: 'CLI version 2.1.309', applies: 'per id', artifact: 'VERSION <id> before the call; RUNVERSION <id> from result.json', writer: 'writeVersion', tokens: ['VERSION', 'RUNVERSION'] },
  { key: 'auth-probe', cond: 'Authentication probe passed, no expiry', applies: 'per id', artifact: 'PROBE_OK|PROBE_FAIL <id>, probes.tsv; STOP_AUTH', writer: 'writeProbe', tokens: ['PROBE_OK', 'file:probes.tsv'] },
  { key: 'command', cond: 'No deviation from the preregistered command', applies: 'per id', artifact: 'CMD <id> <sha256 of argv>', writer: 'writeCmd', tokens: ['CMD'] },
  { key: 'score', cond: 'Oracle score recoverable', applies: 'per id, after the run', artifact: 'SCORE <id> m1 m2 m3 or SCORE_MISSING <id>', writer: 'writeScore', tokens: ['SCORE'] },
  { key: 'complete', cond: 'At least 27 of 30 completed five turns, in each arm separately', applies: 'per id and end', artifact: 'TURNS <id> arm n; COMPLETE ON=x/N C=y/N', writer: 'writeTurns', tokens: ['TURNS', 'COMPLETE'] },
  { key: 'model', cond: 'Single resolved model id', applies: 'per id', artifact: 'MODEL <id> <value>', writer: 'writeModel', tokens: ['MODEL'] },
  { key: 'hook-only-on', cond: 'Hook active only in ON runs, and only the gate hook', applies: 'per id', artifact: 'HOOKCOUNT <id> gate_trace gate_log plugin (+ HOOKERR)', writer: 'writeHookCount', tokens: ['HOOKCOUNT', 'HOOKERR'] },
  { key: 'blockmax', cond: 'Blocks per turn never exceed N', applies: 'per id', artifact: 'BLOCKMAX <id> <value> from the hook log', writer: 'writeBlockMax', tokens: ['BLOCKMAX'] },
  { key: 'interleave', cond: 'Interleaving order as preregistered (D2)', applies: 'per id', artifact: 'ORDER <id> <arm> before the call', writer: 'writeOrder', tokens: ['ORDER'] },
  { key: 'cost', cond: 'Cost within the cap', applies: 'per id', artifact: 'COSTCHK before, COST <id> run probe running projected after, per arm; STOP_COST', writer: 'writeCost', tokens: ['COSTCHK', 'COST'] },
  { key: 'prereg', cond: 'Preregistration committed earlier', applies: 'before first call', artifact: 'PREREG <hash> <time> ancestor=yes|no, HASH lines', writer: 'writePrereg', tokens: ['PREREG', 'HASH'] },
];

// ---------------------------------------------------------------- context, writers

class Exit extends Error { constructor(code, line) { super(line); this.code = code; this.line = line; } }

function makeCtx(o) {
  const ctx = { ...o };
  ctx.logFile = path.join(ctx.runDir, 'invocation.log');
  ctx.exec = ctx.exec || ((argv, opts) => {
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
    return { status: r.status === null ? 124 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  });
  ctx.now = ctx.now || (() => Date.now());
  ctx.log = (kind, rest) => {
    let text = String(rest === undefined ? '' : rest);
    for (const p of [ctx.runDir, ctx.clone, os.tmpdir(), os.homedir()]) if (p && p.length > 1) text = text.split(p).join('<scratch>');
    fs.appendFileSync(ctx.logFile, `${nowIso()} ${kind}${text ? ` ${text}` : ''}\n`);
  };
  return ctx;
}
const sh = (ctx, argv, opts) => ctx.exec([...ENV_PREFIX, ...argv], opts);
const readLog = (ctx) => { try { return parseLog(fs.readFileSync(ctx.logFile, 'utf8')); } catch (_e) { return []; } };
const tsvRows = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')); } catch (_e) { return []; } };

const W = {
  writePrereg(ctx) {
    const m = ctx.manifest;
    const g = (a) => sh(ctx, ['git', '-C', ctx.clone, ...a]);
    const tracked = g(['ls-files', '--error-unmatch', m.prereg]);
    if (tracked.status !== 0) throw new Exit(3, 'ABORT prereg not tracked');
    if (g(['status', '--porcelain', '--', m.prereg]).stdout.trim()) throw new Exit(3, 'ABORT prereg modified');
    const hash = g(['log', '-1', '--format=%H', '--', m.prereg]).stdout.trim();
    const time = g(['log', '-1', '--format=%cI', '--', m.prereg]).stdout.trim();
    const anc = g(['merge-base', '--is-ancestor', hash, 'HEAD']).status === 0 ? 'yes' : 'no';
    ctx.log('PREREG', `${hash} ${time} ancestor=${anc}`);
    if (anc !== 'yes') throw new Exit(3, 'ABORT prereg commit is not an ancestor of HEAD');
    const mine = { wrapper: sha256(fs.readFileSync(ctx.wrapperPath)), hook: sha256(fs.readFileSync(path.join(ctx.clone, m.hook_path))), harness: sha256(fs.readFileSync(path.join(ctx.clone, m.harness_path))) };
    for (const k of ['wrapper', 'hook', 'harness']) ctx.log('HASH', `${k} ${mine[k]}`);
    for (const k of ['wrapper', 'hook', 'harness']) if (mine[k] !== m.hashes[k]) throw new Exit(3, `ABORT ${k} sha256 differs from the preregistered value`);
  },
  writeWindow(ctx) {
    const f = path.join(ctx.runDir, 'window.start');
    if (!fs.existsSync(f)) { fs.writeFileSync(f, `${ctx.now()}\n`); ctx.log('WINDOW_START', ''); }
    ctx.elapsed = () => Math.floor((ctx.now() - Number(fs.readFileSync(f, 'utf8'))) / 1000);
  },
  writeTaskHash(ctx, phase) {
    const listing = taskListing(ctx.taskDir);
    fs.writeFileSync(path.join(ctx.runDir, `taskhash.${phase}.txt`), listing);
    const expected = fs.readFileSync(path.join(ctx.clone, ctx.manifest.taskhash_expected), 'utf8');
    const ok = listing === expected;
    ctx.log('TASKHASH_DIFF', `${phase} ${ok ? 'ok' : 'fail'}`);
    return ok;
  },
  writeVersion(ctx, id) {
    const v = (sh(ctx, ['claude', '--version']).stdout.split('\n')[0] || '').trim();
    ctx.log('VERSION', `${id} ${v}`);
    if (v !== ctx.manifest.cli) throw new Exit(3, `ABORT version ${id} differs from the pinned CLI`);
  },
  writeRunVersion(ctx, id, resultJson) {
    const v = resultJson && typeof resultJson.runner_version === 'string' ? resultJson.runner_version : 'missing';
    ctx.log('RUNVERSION', `${id} ${v === ctx.manifest.cli ? 'ok' : 'fail'} ${v}`);
  },
  writeOrder(ctx, id, arm, pos) { ctx.log('ORDER', `${id} ${arm} pos=${pos}`); },
  writeCmd(ctx, id, argv, out, trace) { ctx.log('CMD', `${id} ${argvSha(argv, out, trace)}`); },
  writeStartEnd(ctx, kind, id, extra) { ctx.log(kind, `${id} ${extra}`); },
  writeProbe(ctx, id, home) {
    const dir = path.join(ctx.runDir, 'probe-work');
    fs.mkdirSync(dir, { recursive: true });
    const r = sh(ctx, [`HOME=${home}`, 'timeout', '90', 'claude', '-p', '--model', ctx.manifest.model, '--setting-sources', 'project',
      '--strict-mcp-config', '--dangerously-skip-permissions', '--output-format', 'json'], { cwd: dir, input: 'Reply with exactly AUTH_OK\n' });
    let cost = 0, err = 1, ok = 0;
    try {
      const o = JSON.parse(r.stdout);
      cost = Number(o.total_cost_usd) || 0; err = o.is_error ? 1 : 0; ok = String(o.result).includes('AUTH_OK') ? 1 : 0;
    } catch (_e) { /* stays failed */ }
    fs.appendFileSync(path.join(ctx.runDir, 'probes.tsv'), `${id}\t${r.status}\t${cost.toFixed(6)}\n`);
    if (r.status !== 0 || err || !ok) { ctx.log('PROBE_FAIL', `${id} rc=${r.status} cost=${cost.toFixed(6)}`); throw new Exit(7, 'PAUSE id not launched'); }
    ctx.log('PROBE_OK', `${id} cost=${cost.toFixed(6)}`);
    return cost;
  },
  writeScore(ctx, id, out) {
    let o = null;
    try { o = jsonObjects(fs.readFileSync(path.join(out, 'oracle.log'), 'utf8'))[0]; } catch (_e) { /* missing */ }
    if (!o || typeof o.constraints_pass !== 'boolean' || typeof o.features_pass !== 'boolean') { ctx.log('SCORE_MISSING', id); return; }
    const m1 = o.constraints_pass ? 1 : 0, m2 = o.features_pass ? 1 : 0;
    ctx.log('SCORE', `${id} m1=${m1} m2=${m2} m3=${m1 && m2 ? 1 : 0}`);
  },
  writeTurns(ctx, id, arm, resultJson) {
    ctx.log('TURNS', `${id} arm=${arm} n=${resultJson && Number.isInteger(resultJson.turns_completed) ? resultJson.turns_completed : -1}`);
  },
  writeModel(ctx, id, runLog) {
    const keys = new Set();
    for (const o of jsonObjects(runLog)) if (o.type === 'result' && o.modelUsage && typeof o.modelUsage === 'object') for (const k of Object.keys(o.modelUsage)) keys.add(k);
    ctx.log('MODEL', `${id} ${keys.size ? [...keys].sort().join(',') : 'unknown'}`);
  },
  writeHookCount(ctx, id, arm, out, traceDir) {
    const lines = [];
    try { for (const f of fs.readdirSync(traceDir).sort()) lines.push(...fs.readFileSync(path.join(traceDir, f), 'utf8').split('\n')); } catch (_e) { /* no trace */ }
    let gateTrace = 0, plugin = 0;
    for (const l of lines) {
      const m = /Hooks: Stop \[([^\]]*)\].*finished with status/.exec(l);
      if (!m) continue;
      if (m[1].includes('hooks/per-turn-gate.js')) gateTrace++; else plugin++;
    }
    const recs = hookRecords(out);
    ctx.log('HOOKCOUNT', `${id} gate_trace=${gateTrace} gate_log=${recs.length} plugin=${plugin}`);
    ctx.log('HOOKERR', `${id} ${recs.filter((r) => r.reason === 'error').length}`);
    return recs;
  },
  writeBlockMax(ctx, id, recs) {
    const per = {};
    for (const r of recs) if (r.decision === 'block') per[String(r.turn)] = (per[String(r.turn)] || 0) + 1;
    ctx.log('BLOCKMAX', `${id} ${Math.max(0, ...Object.values(per))}`);
  },
  writeCost(ctx, id, arm, runCost, probeCost) {
    const a = armSpend(ctx, arm);
    const p = projectCost({ runCosts: [...a.runCosts, runCost], probeSpent: a.probeSpent + probeCost, total: ctx.manifest.n_per_arm, cap: ctx.manifest.arms[arm].cap, probeCost: ctx.manifest.probe_cost });
    ctx.log('COST', `${id} arm=${arm} run=${runCost.toFixed(6)} probe=${probeCost.toFixed(6)} running=${p.spent.toFixed(4)} projected=${p.projected.toFixed(4)}`);
  },
};

function hookRecords(out) {
  const dir = path.join(out, 'hook', 'live', 'per-turn-gate');
  const recs = [];
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
      for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) { if (!l.trim()) continue; try { recs.push(JSON.parse(l)); } catch (_e) { /* skip */ } }
    }
  } catch (_e) { /* no hook dir */ }
  return recs;
}

/** Spend per arm from the artifacts so far: COST rows for finished runs, probes.tsv for every probe made. */
function armSpend(ctx, arm) {
  const runCosts = [];
  const probeIds = [];
  for (const r of readLog(ctx)) {
    if (r.kind === 'COST') { const kv = kvOf(r.rest); if (kv.arm === arm) runCosts.push(Number(kv.run)); }
  }
  let probeSpent = 0;
  for (const [id, , cost] of tsvRows(path.join(ctx.runDir, 'probes.tsv'))) if (id.startsWith(`${arm}-`)) { probeSpent += Number(cost); probeIds.push(id); }
  return { runCosts, probeSpent, probeIds };
}

const finishedIds = (ctx) => new Set(readLog(ctx).filter((r) => r.kind === 'END').map(idOf));

// ---------------------------------------------------------------- the batch

function runBatch(ctx, first, last) {
  const m = ctx.manifest;
  const order = makeOrder(m.seed, m.n_per_arm);
  const lo = first || 1, hi = last || order.length;
  ctx.log('WRAPPER_START', `first=${lo} last=${hi}`);
  ctx.started = true;
  W.writePrereg(ctx);
  W.writeWindow(ctx);
  if (!W.writeTaskHash(ctx, 'pre')) throw new Exit(3, 'ABORT task hash differs');
  fs.mkdirSync(path.join(ctx.runDir, 'runs'), { recursive: true });
  for (let pos = lo; pos <= hi; pos++) {
    const { id, arm } = order[pos - 1];
    const out = path.join(ctx.runDir, 'runs', id);
    const traceDir = path.join(ctx.runDir, 'trace', id);
    const home = path.join(ctx.runDir, 'homes', id);
    if (fs.existsSync(out)) throw new Exit(4, `REFUSE ${id} output exists`);
    if (pos > 1 && !finishedIds(ctx).has(order[pos - 2].id)) throw new Exit(4, `REFUSE ${id} previous id not finished`);
    const elapsed = ctx.elapsed();
    if (elapsed > m.window_s) throw new Exit(8, `STOP_WINDOW before ${id} elapsed=${elapsed}`);
    const a = armSpend(ctx, arm);
    const p = projectCost({ runCosts: a.runCosts, probeSpent: a.probeSpent, total: m.n_per_arm, cap: m.arms[arm].cap, probeCost: m.probe_cost });
    ctx.log('COSTCHK', `${id} arm=${arm} stage=${p.stage} spent=${p.spent.toFixed(4)} projected=${p.projected.toFixed(4)} cap=${p.cap} ${p.stop ? 'stop' : 'ok'}`);
    if (p.stop) throw new Exit(5, `STOP_COST before ${id} arm=${arm} projected=${p.projected.toFixed(4)} cap=${p.cap}`);
    W.writeVersion(ctx, id);
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const cred = path.join(os.homedir(), '.claude', '.credentials.json');
    if (!fs.existsSync(cred)) throw new Exit(3, 'ABORT no credential file');
    fs.copyFileSync(cred, path.join(home, '.claude', '.credentials.json'));
    fs.chmodSync(path.join(home, '.claude', '.credentials.json'), 0o600);
    fs.writeFileSync(path.join(home, '.claude.json'), '{"hasCompletedOnboarding":true}\n');
    const probeCost = W.writeProbe(ctx, id, home);
    const argv = harnessArgv(m, arm, out, traceDir);
    W.writeOrder(ctx, id, arm, pos);
    W.writeCmd(ctx, id, argv, out, traceDir);
    W.writeStartEnd(ctx, 'START', id, `elapsed=${elapsed}`);
    const r = sh(ctx, [`HOME=${home}`, ...argv], { cwd: ctx.clone, timeout: 90 * 60 * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.mkdirSync(path.join(ctx.runDir, 'runs'), { recursive: true });
    fs.writeFileSync(`${out}.stdout`, r.stdout); fs.writeFileSync(`${out}.stderr`, r.stderr);
    W.writeStartEnd(ctx, 'END', id, `rc=${r.status}`);
    postRun(ctx, id, arm, out, traceDir, probeCost);
    fs.rmSync(home, { recursive: true, force: true });
    let bad = '';
    for (const f of [path.join(out, 'run.log'), `${out}.stderr`]) { try { bad += fs.readFileSync(f, 'utf8'); } catch (_e) { /* none */ } }
    if (AUTH_RE.test(bad)) throw new Exit(6, `STOP_AUTH after ${id}`);
  }
  ctx.log('WRAPPER_DONE', `last=${hi}`);
}

function postRun(ctx, id, arm, out, traceDir, probeCost) {
  let resultJson = null, runLog = '';
  try { resultJson = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')); } catch (_e) { /* missing */ }
  try { runLog = fs.readFileSync(path.join(out, 'run.log'), 'utf8'); } catch (_e) { /* missing */ }
  let runCost = 0;
  for (const o of jsonObjects(runLog)) if (o.type === 'result') runCost = Number(o.total_cost_usd) || 0;
  W.writeCost(ctx, id, arm, runCost, probeCost);
  W.writeScore(ctx, id, out);
  W.writeTurns(ctx, id, arm, resultJson);
  W.writeRunVersion(ctx, id, resultJson);
  W.writeModel(ctx, id, runLog);
  const recs = W.writeHookCount(ctx, id, arm, out, traceDir);
  W.writeBlockMax(ctx, id, recs);
}

/** Runs on every way out: normal end, STOP_*, abort, signal. */
function finish(ctx, code) {
  if (ctx.finished) return;
  ctx.finished = true;
  if (ctx.started) {
    try { W.writeTaskHash(ctx, 'post'); } catch (e) { ctx.log('TASKHASH_DIFF', `post fail ${String(e.message).slice(0, 80)}`); }
    const n = ctx.manifest.n_per_arm;
    const tally = { ON: 0, C: 0 };
    for (const r of readLog(ctx)) if (r.kind === 'TURNS') { const kv = kvOf(r.rest); if (kv.n === '5') tally[kv.arm]++; }
    ctx.log('COMPLETE', `ON=${tally.ON}/${n} C=${tally.C}/${n}`);
  }
  ctx.log('WRAPPER_EXIT', `rc=${code}`);
}

// ---------------------------------------------------------------- audit

function audit(runDir, m, clone) {
  const fails = [];
  const need = (cond, msg) => { if (!cond) fails.push(msg); };
  const read = (f) => { try { return fs.readFileSync(path.join(runDir, f), 'utf8'); } catch (_e) { return null; } };
  const logText = read('invocation.log');
  if (logText === null) return ['invocation.log is absent'];
  const rows = parseLog(logText);
  const order = makeOrder(m.seed, m.n_per_arm);
  const ids = order.map((o) => o.id);
  const by = (kind) => rows.filter((r) => r.kind === kind);
  const byId = (kind, id) => by(kind).filter((r) => idOf(r) === id);

  // 1 order and uniqueness: the START sequence is the seeded order, each START closed by its END before the next START.
  const seq = rows.filter((r) => r.kind === 'START' || r.kind === 'END').map((r) => `${r.kind} ${idOf(r)}`);
  const expectSeq = ids.flatMap((i) => [`START ${i}`, `END ${i}`]);
  need(seq.join('|') === expectSeq.join('|'), `START/END sequence differs from the preregistered order (got ${seq.length} entries, want ${expectSeq.length}; duplicate, missing, or out of order)`);
  // 2 window
  need(by('WINDOW_START').length === 1, `WINDOW_START must appear exactly once (got ${by('WINDOW_START').length})`);
  need(by('STOP_WINDOW').length === 0, 'STOP_WINDOW is present');
  for (const r of by('START')) need(Number(kvOf(r.rest).elapsed) <= m.window_s, `${idOf(r)} started after the window`);
  // 3 task hash
  const pre = read('taskhash.pre.txt'), post = read('taskhash.post.txt');
  need(pre !== null, 'taskhash.pre.txt is absent');
  need(post !== null, 'taskhash.post.txt is absent');
  let expected = null;
  if (clone) { try { expected = fs.readFileSync(path.join(clone, m.taskhash_expected), 'utf8'); } catch (_e) { /* below */ } }
  if (expected !== null) { need(pre === expected, 'taskhash.pre.txt differs from the preregistered listing'); need(post === expected, 'taskhash.post.txt differs from the preregistered listing'); }
  else need(pre !== null && post !== null && pre === post, 'taskhash.pre.txt and taskhash.post.txt differ');
  const td = by('TASKHASH_DIFF').map((r) => r.rest);
  need(td.length > 0 && !td.some((t) => t.includes('fail')), 'a TASKHASH_DIFF fail line is present or none was written');
  need(td.some((t) => t.startsWith('pre ok')), 'no TASKHASH_DIFF pre ok line');
  need(td.length > 0 && td[td.length - 1].startsWith('post ok'), 'the last TASKHASH_DIFF line is not "post ok"');
  // 4 version
  for (const id of ids) {
    const v = byId('VERSION', id);
    need(v.length >= 1 && v.every((r) => r.rest.slice(id.length + 1) === m.cli), `${id}: VERSION missing or not ${m.cli}`);
    const rv = byId('RUNVERSION', id);
    need(rv.length === 1 && rv[0].rest.split(' ')[1] === 'ok', `${id}: RUNVERSION missing or not ok`);
  }
  // 5 probe
  // A PROBE_FAIL pauses the batch; the id is then launched once after a fresh login, so only an id without PROBE_OK fails.
  need(by('STOP_AUTH').length === 0, 'STOP_AUTH is present');
  const probeTsv = (read('probes.tsv') || '').split('\n').filter(Boolean).map((l) => l.split('\t')[0]);
  for (const id of ids) {
    need(byId('PROBE_OK', id).length >= 1, `${id}: PROBE_OK missing`);
    need(probeTsv.includes(id), `${id}: no probes.tsv row`);
  }
  // 6 command
  for (const o of order) {
    const c = byId('CMD', o.id);
    need(c.length === 1 && c[0].rest.split(' ')[1] === m.argv_sha[o.arm], `${o.id}: CMD missing or differs from the preregistered argv`);
  }
  // 7 score
  need(by('SCORE_MISSING').length === 0, 'SCORE_MISSING is present');
  for (const id of ids) need(byId('SCORE', id).length === 1, `${id}: SCORE missing`);
  // 8 completion per arm
  const tally = { ON: 0, C: 0 };
  for (const id of ids) {
    const t = byId('TURNS', id);
    need(t.length === 1, `${id}: TURNS missing`);
    if (t.length === 1) { const kv = kvOf(t[0].rest); if (kv.n === '5') tally[kv.arm]++; }
  }
  for (const arm of ['ON', 'C']) need(tally[arm] >= m.min_complete, `${arm}: only ${tally[arm]} of ${m.n_per_arm} completed five turns (need ${m.min_complete})`);
  const comp = by('COMPLETE');
  need(comp.length > 0 && comp[comp.length - 1].rest === `ON=${tally.ON}/${m.n_per_arm} C=${tally.C}/${m.n_per_arm}`, 'last COMPLETE line does not match the TURNS rows');
  // 9 model
  const models = new Set(by('MODEL').map((r) => r.rest.slice(idOf(r).length + 1)));
  need(by('MODEL').length === ids.length, 'a MODEL line is missing');
  need(models.size === 1 && !models.has('unknown'), `resolved model ids are not a single known value: ${[...models].join(',')}`);
  // 10 hook only in ON
  for (const o of order) {
    const h = byId('HOOKCOUNT', o.id);
    need(h.length === 1, `${o.id}: HOOKCOUNT missing`);
    if (h.length === 1) {
      const kv = kvOf(h[0].rest);
      if (o.arm === 'ON') need(Number(kv.gate_trace) === Number(kv.gate_log) && Number(kv.gate_log) > 0, `${o.id}: gate_trace ${kv.gate_trace} != gate_log ${kv.gate_log} (or zero)`);
      else need(Number(kv.gate_trace) === 0 && Number(kv.gate_log) === 0, `${o.id}: control run shows gate hook activity`);
    }
  }
  // 11 blocks per turn
  for (const id of ids) {
    const b = byId('BLOCKMAX', id);
    need(b.length === 1 && Number(b[0].rest.split(' ')[1]) <= m.max_blocks, `${id}: BLOCKMAX missing or above ${m.max_blocks}`);
  }
  // 12 order lines
  for (let i = 0; i < order.length; i++) {
    const o = byId('ORDER', order[i].id);
    need(o.length === 1 && o[0].rest === `${order[i].id} ${order[i].arm} pos=${i + 1}`, `${order[i].id}: ORDER line missing or not as seeded`);
  }
  // 13 cost: recompute every COSTCHK from the COST rows before it
  need(by('STOP_COST').length === 0, 'STOP_COST is present');
  const seen = { ON: [], C: [] };
  const probes = { ON: 0, C: 0 };
  const probeRows = (read('probes.tsv') || '').split('\n').filter(Boolean).map((l) => l.split('\t'));
  for (const r of rows) {
    if (r.kind === 'COSTCHK') {
      const kv = kvOf(r.rest); const id = idOf(r); const arm = kv.arm;
      const before = probeRows.filter(([pid]) => pid.startsWith(`${arm}-`) && ids.indexOf(pid) < ids.indexOf(id)).reduce((x, p) => x + Number(p[2]), 0);
      // The logged spent must cover every earlier id's probe (a failed probe of this very id may be in it too).
      const probeSpent = Number(kv.spent) - seen[arm].reduce((x, y) => x + y, 0);
      need(probeSpent >= before - 5e-4, `${id}: COSTCHK spent ${kv.spent} does not cover the earlier runs and probes`);
      const p = projectCost({ runCosts: seen[arm], probeSpent, total: m.n_per_arm, cap: m.arms[arm].cap, probeCost: m.probe_cost });
      need(Math.abs(p.projected - Number(kv.projected)) < 5e-4 && !p.stop && r.rest.endsWith(' ok'), `${id}: COSTCHK projection ${kv.projected} differs from the recomputed ${p.projected.toFixed(4)} or exceeds the cap`);
    }
    if (r.kind === 'COST') { const kv = kvOf(r.rest); seen[kv.arm].push(Number(kv.run)); probes[kv.arm] += Number(kv.probe); }
  }
  for (const id of ids) need(byId('COST', id).length === 1, `${id}: COST missing`);
  // 14 prereg and hashes
  const pr = by('PREREG');
  need(pr.length >= 1 && pr.every((r) => r.rest.endsWith('ancestor=yes')), 'PREREG missing or not an ancestor of HEAD');
  const win = by('WINDOW_START')[0], firstStart = by('START')[0];
  if (pr.length && win && firstStart) {
    const prTime = Date.parse(pr[0].rest.split(' ')[1]);
    need(prTime < Date.parse(win.ts) && prTime < Date.parse(firstStart.ts), 'the preregistration commit is not earlier than the window start');
    need(rows.indexOf(pr[0]) < rows.indexOf(firstStart), 'PREREG line is not before the first START');
  }
  for (const k of ['wrapper', 'hook', 'harness']) {
    const h = by('HASH').filter((r) => r.rest.startsWith(`${k} `));
    need(h.length >= 1 && h.every((r) => r.rest === `${k} ${m.hashes[k]}`), `HASH ${k} missing or differs from the preregistered value`);
  }
  // no scratch path in the log
  need(!/(^|[\s=(\[])\/[^\s]+/m.test(logText.split('\n').map((l) => l.replace(/^\S+ /, '')).join('\n')), 'invocation.log contains an absolute path');
  need(!logText.includes(runDir), 'invocation.log contains the run directory');
  need(by('ABORT').length === 0 && by('REFUSE').length === 0, 'ABORT or REFUSE present');
  return fails;
}

// ---------------------------------------------------------------- selfcheck

/**
 * Prints the table, then drives the real batch code against a synthetic world (fake executor, temp dirs) and the
 * real audit over what it wrote. A row passes only when every token the row promises was actually written by the
 * code path and the audit accepts the result.
 */
function selfcheck(wrapperPath) {
  const out = [];
  const say = (s) => { out.push(s); process.stdout.write(`${s}\n`); };
  say('SELFCHECK run-p2-batch.js (plan 3.1)');
  say(`${'#'.padEnd(3)}| ${'condition'.padEnd(66)}| ${'applies'.padEnd(36)}| writer`);
  ROWS.forEach((r, i) => say(`${String(i + 1).padEnd(3)}| ${r.cond.padEnd(66)}| ${r.applies.padEnd(36)}| ${r.writer} -> ${r.artifact}`));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-selfcheck-'));
  let bad = 0;
  try {
    const clone = path.join(tmp, 'clone'), runDir = path.join(tmp, 'run');
    const taskDir = path.join(clone, 'evals', 'orchestration', 'tasks', 'syn');
    fs.mkdirSync(taskDir, { recursive: true }); fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'task.md'), 'synthetic task\n');
    fs.writeFileSync(path.join(clone, 'hook.js'), 'hook\n'); fs.writeFileSync(path.join(clone, 'harness.sh'), 'harness\n');
    fs.writeFileSync(path.join(clone, 'expected.txt'), taskListing(taskDir));
    const n = 3;
    const m = {
      task: 'syn', model: 'claude-haiku-4-5', cli: '2.1.309 (Claude Code)', seed: 'selfcheck-seed', n_per_arm: n,
      arms: { ON: { gate: 'hook', cap: 31 }, C: { gate: 'observe', cap: 17 } }, probe_cost: 0.0166, window_s: 28800, min_complete: 2, max_blocks: 2,
      prereg: 'PREREG.md', taskhash_expected: 'expected.txt', hook_path: 'hook.js', harness_path: 'harness.sh', argv_sha: {},
      hashes: { wrapper: sha256(fs.readFileSync(wrapperPath)), hook: sha256('hook\n'), harness: sha256('harness\n') },
    };
    const fakeOut = (argv) => argv[argv.indexOf('--out') + 1];
    const exec = (argv) => {
      const a = argv.slice(5); // drop env -u .. -u ..
      const home = a[0] && a[0].startsWith('HOME=') ? a.shift() : null;
      void home;
      if (a[0] === 'git') {
        const sub = a[3];
        if (sub === 'log') return { status: 0, stdout: a.includes('--format=%H') ? 'c0ffee\n' : '2026-01-01T00:00:00+00:00\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
      if (a[0] === 'claude') return { status: 0, stdout: '2.1.309 (Claude Code)\n', stderr: '' };
      if (a[0] === 'timeout') return { status: 0, stdout: JSON.stringify({ is_error: false, result: 'AUTH_OK', total_cost_usd: 0.0166 }), stderr: '' };
      if (a[0] === 'bash') {
        const o = fakeOut(a), arm = a[a.indexOf('--gate') + 1] === 'hook' ? 'ON' : 'C';
        const trace = a[a.indexOf('--hook-trace-dir') + 1];
        fs.mkdirSync(o, { recursive: true }); fs.mkdirSync(trace, { recursive: true });
        fs.writeFileSync(path.join(o, 'result.json'), JSON.stringify({ runner_version: '2.1.309 (Claude Code)', turns_completed: 5 }));
        fs.writeFileSync(path.join(o, 'run.log'), `${JSON.stringify({ type: 'result', total_cost_usd: 0.5, modelUsage: { 'claude-haiku-4-5': {} } })}\n`);
        fs.writeFileSync(path.join(o, 'oracle.log'), '{"features_pass":true,"constraints_pass":true}\n');
        if (arm === 'ON') {
          const d = path.join(o, 'hook', 'live', 'per-turn-gate'); fs.mkdirSync(d, { recursive: true });
          fs.writeFileSync(path.join(d, 's.jsonl'), `${JSON.stringify({ session: 's', turn: 1, decision: 'block', reason: 'block', counter: 1 })}\n`);
          fs.writeFileSync(path.join(trace, 'trace-turn1.log'), 'Hooks: Stop [node x/hooks/per-turn-gate.js] finished with status 0 (3ms)\n');
        }
        return { status: 0, stdout: '{}', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    process.env.HOME = tmp; // credentials for the synthetic copy
    fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true }); fs.writeFileSync(path.join(tmp, '.claude', '.credentials.json'), '{}');
    for (const arm of ['ON', 'C']) { const o = path.join(runDir, 'x'); m.argv_sha[arm] = argvSha(harnessArgv(m, arm, o, `${o}t`), o, `${o}t`); }
    // argv_sha is path independent: placeholders replace --out and --hook-trace-dir.
    const ctx = makeCtx({ runDir, clone, manifest: m, taskDir, wrapperPath, exec });
    let code = 0;
    try { runBatch(ctx, 1, 2 * n); } catch (e) { if (e instanceof Exit) { ctx.log(e.line.split(' ')[0], e.line.split(' ').slice(1).join(' ')); code = e.code; } else throw e; }
    finish(ctx, code);
    const kinds = new Set(readLog(ctx).map((r) => r.kind));
    ROWS.forEach((r, i) => {
      const missing = r.tokens.filter((t) => (t.startsWith('file:') ? !fs.existsSync(path.join(runDir, t.slice(5))) : !kinds.has(t)));
      if (typeof W[r.writer] !== 'function') missing.push(`writer ${r.writer}`);
      say(`row ${i + 1} ${r.key}: ${missing.length ? `NO WRITER OUTPUT (${missing.join(', ')})` : 'written'}`);
      bad += missing.length ? 1 : 0;
    });
    const fails = audit(runDir, m, clone);
    say(`synthetic batch: ${2 * n} ids, wrapper rc=${code}, audit ${fails.length ? `FAIL (${fails.join('; ')})` : 'PASS'}`);
    bad += fails.length + (code === 0 ? 0 : 1);
    // Dry projection on the first five costs of the P1 rerun control (docs/plans/evidence/2026-10-24-per-turn-gate-p1-rerun/costs.tsv).
    const p1 = [0.552910, 0.457526, 0.591696, 0.500538, 0.627904];
    const dry = projectCost({ runCosts: p1, probeSpent: 5 * 0.0166, total: 30, cap: 17, probeCost: 0.0166 });
    say(`dry projection, C arm after the P1 rerun's first five run costs: spent=${dry.spent.toFixed(4)} projected=${dry.projected.toFixed(4)} cap=${dry.cap} -> ${dry.stop ? 'STOP_COST' : 'ok'} (mean ${mean(p1).toFixed(4)}, sample sd ${sampleSd(p1).toFixed(4)})`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  say(bad ? `SELFCHECK FAIL (${bad})` : 'SELFCHECK OK: every row has a writer');
  return bad ? 1 : 0;
}

// ---------------------------------------------------------------- cli

function main(argv) {
  const opt = {};
  const flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--selfcheck', '--audit', '--run', '--order'].includes(a)) flags.add(a);
    else if (['--run-dir', '--clone', '--manifest', '--first', '--last'].includes(a)) opt[a] = argv[++i];
    else { process.stderr.write(`unknown argument ${a}\n`); return 2; }
  }
  if (flags.has('--selfcheck')) return selfcheck(__filename);
  if (!opt['--manifest']) { process.stderr.write('usage: --manifest M required\n'); return 2; }
  const manifest = JSON.parse(fs.readFileSync(opt['--manifest'], 'utf8'));
  if (flags.has('--order')) { makeOrder(manifest.seed, manifest.n_per_arm).forEach((o, i) => process.stdout.write(`${i + 1} ${o.id}\n`)); return 0; }
  if (!opt['--run-dir']) { process.stderr.write('usage: --run-dir D required\n'); return 2; }
  const runDir = path.resolve(opt['--run-dir']);
  if (flags.has('--audit')) {
    const clone = opt['--clone'] ? path.resolve(opt['--clone']) : null;
    const fails = audit(runDir, manifest, clone);
    for (const f of fails) process.stdout.write(`AUDIT FAIL: ${f}\n`);
    process.stdout.write(fails.length ? `AUDIT FAILED (${fails.length})\n` : 'AUDIT OK\n');
    return fails.length ? 1 : 0;
  }
  if (flags.has('--run')) {
    const clone = path.resolve(opt['--clone'] || process.cwd());
    fs.mkdirSync(runDir, { recursive: true });
    const ctx = makeCtx({ runDir, clone, manifest, wrapperPath: __filename, taskDir: path.join(clone, 'evals', 'orchestration', 'tasks', manifest.task) });
    const onSig = () => { finish(ctx, 130); process.exit(130); };
    process.on('SIGINT', onSig); process.on('SIGTERM', onSig);
    let code = 0;
    try { runBatch(ctx, Number(opt['--first']) || 0, Number(opt['--last']) || 0); } catch (e) {
      if (!(e instanceof Exit)) { ctx.log('ABORT', `unexpected ${String(e && e.message).slice(0, 120)}`); code = 3; } else {
        const [kind, ...rest] = e.line.split(' ');
        ctx.log(kind, rest.join(' '));
        code = e.code;
      }
    }
    finish(ctx, code);
    return code;
  }
  process.stderr.write('usage: --selfcheck | --order | --run | --audit\n');
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { makeOrder, projectCost, harnessArgv, argvSha, jsonObjects, taskListing, audit, ROWS, parseLog };
