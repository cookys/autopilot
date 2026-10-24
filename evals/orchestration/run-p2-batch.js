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
//   node run-p2-batch.js --run --run-dir D --clone C --manifest M [--first i] [--last j] [--credentials-source F] [--parent-pid P]
//   node run-p2-batch.js --audit --run-dir D --manifest M  exit 0 only when every artifact is present and every condition holds
//
// Credentials: every id copies ONE file (mode 0600) from the credential source into its own per-run home before its probe; the
// child process only ever sees that copy. The source is `$HOME/.claude/.credentials.json` unless `--credentials-source F` names
// another. Start the wrapper with the REAL HOME (or point --credentials-source at the real file): a one-off HOME copy goes stale
// (access token expired, refresh token rotated by the main CLI) and every later id would copy that stale file. When the source's
// claudeAiOauth.expiresAt is less than 10 minutes away the id is neither copied nor probed: it pauses (PROBE_FAIL, PAUSE, exit 7)
// with a saved response that says auth_ok false, reason source_token_expiring, cost 0. A source without expiresAt is not judged.
// Stop: the first TERM, INT or HUP (or a file <run-dir>/stop.request) is a safe pause: the running id finishes, the next id pauses before its
// probe (PROBE_FAIL, PAUSE, exit 7, reason operator_stop) and the batch resumes later; a second TERM or INT ends the process at once.
// --parent-pid P (set by run-p2-batch-loop.js): when that process is gone (the wrapper was re-parented or P no longer exists) the next
// id pauses before its probe (PROBE_FAIL, PAUSE, exit 7, reason parent_gone), so a killed launcher leaves no wrapper starting new ids.
// The id already running finishes. Resume after a pause with --first <position of the paused id>; run-p2-batch-loop.js does that.
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
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

/** Set in the batch worker: a shared flag the main thread raises on the first TERM or INT. */
let STOP = null;

// Every child runs with the variables that could point claude at the real configuration or change how it authenticates removed:
// every CLAUDE* and ANTHROPIC* variable (CLAUDE_CONFIG_DIR, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, CLAUDE_CODE_OAUTH_TOKEN, ...) and the
// XDG config, data, state and cache homes. HOME is replaced per call (the per-run home, or the credential-free version home).
const SCRUB_RE = /^(CLAUDE|ANTHROPIC)|^XDG_(CONFIG|DATA|STATE|CACHE)_HOME$/;
const scrubEnv = (env) => { const o = { ...env }; for (const k of Object.keys(o)) if (SCRUB_RE.test(k)) delete o[k]; return o; };
const SCRUB_KEYS = [...new Set(['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', ...Object.keys(process.env).filter((k) => SCRUB_RE.test(k))])];
const ENV_PREFIX = ['env', ...SCRUB_KEYS.flatMap((k) => ['-u', k])];
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
 *   5 or more: projected = spent + r * (mean of the finished run costs + one probe) + 2 * sample sd * sqrt(r),
 *              r = ids of the arm not yet finished, the one about to start included (independent costs add, so the
 *              sd of the sum of r costs is sd * sqrt(r); the plan's "mean plus 2 sd for the remaining ids" read this way); stage post5
 * stop when projected > the arm's cap.
 */
function projectCost({ runCosts, probeSpent, total, cap, probeCost }) {
  const spent = runCosts.reduce((x, y) => x + y, 0) + probeSpent;
  if (runCosts.length < PROJECTION_AFTER) {
    const projected = spent + probeCost;
    return { stage: 'pre5', spent, projected, cap, stop: projected > cap };
  }
  const remaining = total - runCosts.length;
  const projected = spent + remaining * (mean(runCosts) + probeCost) + 2 * sampleSd(runCosts) * Math.sqrt(remaining);
  return { stage: 'post5', spent, projected, cap, stop: projected > cap };
}

/** Timeout for one harness call: at most 90 minutes and never past the end of the window; 0 means no time is left (do not start). */
function harnessTimeoutMs(elapsedS, windowS) { return Math.max(0, Math.floor(Math.min(90 * 60 * 1000, (windowS - elapsedS) * 1000))); }

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

/** id -> integer rc of its END row (NaN when the row is absent or the rc is not a plain integer). */
function endRcs(rows) {
  const o = {};
  for (const r of rows) if (r.kind === 'END') { const v = kvOf(r.rest).rc; o[r.rest.split(' ')[0]] = /^\d+$/.test(v || '') ? Number(v) : NaN; }
  return o;
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
    // The preregistration note and the manifest it states the sha256 of must both be committed and unmodified.
    const mrel = path.relative(ctx.clone, ctx.manifestPath);
    for (const [what, rel] of [['prereg', m.prereg], ['manifest', mrel], ['taskhash baseline', m.taskhash_expected]]) {
      if (g(['ls-files', '--error-unmatch', rel]).status !== 0) throw new Exit(3, `ABORT ${what} not tracked`);
      if (g(['status', '--porcelain', '--', rel]).stdout.trim()) throw new Exit(3, `ABORT ${what} modified`);
    }
    ctx.log('HASH', `manifest ${sha256(fs.readFileSync(ctx.manifestPath))}`);
    ctx.log('HASH', `prereg ${sha256(fs.readFileSync(path.join(ctx.clone, m.prereg)))}`);
    const th = sha256(fs.readFileSync(path.join(ctx.clone, m.taskhash_expected)));
    ctx.log('HASH', `taskhash_expected ${th}`);
    if (th !== m.hashes.taskhash_expected) throw new Exit(3, 'ABORT taskhash baseline sha256 differs from the preregistered value');
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
    const w0 = Number(fs.readFileSync(f, 'utf8'));
    if (!Number.isFinite(w0) || w0 <= 0) throw new Exit(3, 'ABORT window.start is not a positive number');
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
    // --version needs no credentials: it runs in a throwaway home that holds only the onboarding file (never the real HOME).
    const vh = path.join(ctx.runDir, 'homes', '_version');
    fs.mkdirSync(vh, { recursive: true });
    fs.writeFileSync(path.join(vh, '.claude.json'), '{"hasCompletedOnboarding":true}\n');
    const v = (sh(ctx, [`HOME=${vh}`, 'claude', '--version']).stdout.split('\n')[0] || '').trim();
    if (!readLog(ctx).some((r) => r.kind === 'VERSION' && idOf(r) === id)) ctx.log('VERSION', `${id} ${v}`); // once per id, also after a resume
    if (v !== ctx.manifest.cli) throw new Exit(3, `ABORT version ${id} differs from the pinned CLI`);
  },
  writeRunVersion(ctx, id, resultJson) {
    const v = resultJson && typeof resultJson.runner_version === 'string' ? resultJson.runner_version : 'missing';
    ctx.log('RUNVERSION', `${id} ${v === ctx.manifest.cli ? 'ok' : 'fail'} ${v}`);
  },
  writeOrder(ctx, id, arm, pos) { ctx.log('ORDER', `${id} ${arm} pos=${pos}`); },
  writeCmd(ctx, id, argv, out, trace) {
    fs.mkdirSync(path.join(ctx.runDir, 'cmd'), { recursive: true });
    fs.writeFileSync(path.join(ctx.runDir, 'cmd', `${id}.json`), `${JSON.stringify(argv)}\n`);
    ctx.log('CMD', `${id} ${argvSha(argv, out, trace)}`);
  },
  writeStartEnd(ctx, kind, id, extra) { ctx.log(kind, `${id} ${extra}`); },
  /**
   * forced: a reason string (source_token_expiring, parent_gone): no call is made. The saved response says so (auth_ok false,
   * that reason, cost 0) and the id pauses through the ordinary PROBE_FAIL / PAUSE path.
   */
  writeProbe(ctx, id, home, forced) {
    const dir = path.join(ctx.runDir, 'probe-work');
    fs.mkdirSync(dir, { recursive: true });
    const r = forced ? { status: 1, stdout: '' } : sh(ctx, [`HOME=${home}`, 'timeout', '90', 'claude', '-p', '--model', ctx.manifest.model, '--setting-sources', 'project',
      '--strict-mcp-config', '--dangerously-skip-permissions', '--output-format', 'json'], { cwd: dir, input: 'Reply with exactly AUTH_OK\n' });
    let cost = 0, err = 1, ok = 0;
    const rec = { rc: r.status, parse_ok: false };
    if (forced) Object.assign(rec, { auth_ok: false, reason: String(forced) });
    try {
      const o = JSON.parse(r.stdout);
      // Only status, model and cost fields are kept (no credential material is ever in the probe response).
      // auth_ok is computed from the FULL response and saved with the response's sha256, so a long reply is judged the same way here and in the audit.
      const costOk = typeof o.total_cost_usd === 'number' && Number.isFinite(o.total_cost_usd) && o.total_cost_usd >= 0;
      Object.assign(rec, { parse_ok: true, is_error: !!o.is_error, auth_ok: String(o.result).includes('AUTH_OK'), result_sha256: sha256(String(o.result)), result_head: String(o.result).slice(0, 200), model: o.modelUsage ? Object.keys(o.modelUsage).sort().join(',') : null, total_cost_usd: costOk ? o.total_cost_usd : null });
      cost = costOk ? o.total_cost_usd : 0; err = (o.is_error || !costOk) ? 1 : 0; ok = rec.auth_ok ? 1 : 0;
    } catch (_e) { /* stays failed */ }
    const good = !(r.status !== 0 || err || !ok);
    fs.mkdirSync(path.join(ctx.runDir, 'probes'), { recursive: true });
    const nth = fs.readdirSync(path.join(ctx.runDir, 'probes')).filter((f) => f.startsWith(`${id}-`)).length + 1;
    fs.writeFileSync(path.join(ctx.runDir, 'probes', `${id}-${nth}.json`), `${JSON.stringify(rec)}\n`);
    fs.appendFileSync(path.join(ctx.runDir, 'probes.tsv'), `${id}\t${r.status}\t${cost.toFixed(6)}\t${good ? 'ok' : 'fail'}\n`);
    if (!good) { ctx.log('PROBE_FAIL', `${id} rc=${r.status} cost=${cost.toFixed(6)}`); throw new Exit(7, 'PAUSE id not launched'); }
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
    const { gate: gateTrace, plugin } = traceCounts(traceDir);
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
    // probes.tsv already holds this id's probe (written before the run), so it is not added a second time.
    const a = armSpend(ctx, arm);
    const p = projectCost({ runCosts: [...a.runCosts, runCost], probeSpent: a.probeSpent, total: ctx.manifest.n_per_arm, cap: ctx.manifest.arms[arm].cap, probeCost: ctx.manifest.probe_cost });
    ctx.log('COST', `${id} arm=${arm} run=${runCost.toFixed(6)} probe=${probeCost.toFixed(6)} running=${p.spent.toFixed(4)} projected=${p.projected.toFixed(4)}`);
  },
};

/** Gate-hook and other Stop-hook executions counted from the debug traces of one run. */
/**
 * Regular trace-turn<N>.log files of a trace directory, plus the verdict on a `latest` entry. The real CLI's --debug-file
 * adds `latest`, a symlink to the highest-numbered trace-turn file; it is never counted as a trace file, and it is valid
 * only as a symlink that resolves to that very file. Any other name is unexpected.
 */
function traceFiles(traceDir) {
  const out = { regular: [], unreadable: [], other: [], latest: null, latestOk: true };
  let names = [];
  try { names = fs.readdirSync(traceDir).sort(); } catch (_e) { return out; }
  for (const f of names) {
    let st = null; try { st = fs.lstatSync(path.join(traceDir, f)); } catch (_e) { st = null; }
    if (f === 'latest') { out.latest = st; continue; }
    if (st && st.isFile() && /^trace-turn\d+\.log$/.test(f)) {
      try { fs.readFileSync(path.join(traceDir, f)); out.regular.push(f); } catch (_e) { out.unreadable.push(f); }
    } else out.other.push(f);
  }
  if (out.latest) {
    const top = [...out.regular].sort((x, y) => Number(/\d+/.exec(y)[0]) - Number(/\d+/.exec(x)[0]))[0];
    try { out.latestOk = !!top && out.latest.isSymbolicLink() && fs.realpathSync(path.join(traceDir, 'latest')) === path.join(fs.realpathSync(traceDir), top); } catch (_e) { out.latestOk = false; }
  }
  return out;
}

function traceCounts(traceDir) {
  const lines = [];
  const tf = traceFiles(traceDir);
  let files = 0; // only files whose read succeeded count
  for (const f of tf.regular) { try { lines.push(...fs.readFileSync(path.join(traceDir, f), 'utf8').split('\n')); files++; } catch (_e) { /* unreadable: not counted */ } }
  let gate = 0, plugin = 0;
  for (const l of lines) {
    const m = /Hooks: Stop \[([^\]]*)\].*finished with status/.exec(l);
    if (!m) continue;
    if (m[1].includes('hooks/per-turn-gate.js')) gate++; else plugin++;
  }
  return { gate, plugin, files };
}

/** Resolved model ids from the result objects of a run.log, joined as the MODEL row writes them. */
function modelsOf(runLog) {
  const keys = new Set();
  for (const o of jsonObjects(runLog)) if (o.type === 'result' && o.modelUsage && typeof o.modelUsage === 'object') for (const k of Object.keys(o.modelUsage)) keys.add(k);
  return keys.size ? [...keys].sort().join(',') : 'unknown';
}
/** Cost of the last result object, or null when there is none or the field is missing, non-numeric or negative. */
const lastResultCost = (runLog) => { let c = null; for (const o of jsonObjects(runLog)) if (o.type === 'result') c = (typeof o.total_cost_usd === 'number' && Number.isFinite(o.total_cost_usd) && o.total_cost_usd >= 0) ? o.total_cost_usd : null; return c; };

/** Sum of the costs in every saved probe response of an id (failed attempts included). */
function probeTotal(runDir, id) {
  let t = 0;
  try { for (const f of fs.readdirSync(path.join(runDir, 'probes')).filter((x) => x.startsWith(`${id}-`))) { const o = JSON.parse(fs.readFileSync(path.join(runDir, 'probes', f), 'utf8')); if (typeof o.total_cost_usd === 'number') t += o.total_cost_usd; } } catch (_e) { /* partial */ }
  return t;
}

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

/** A credential source this close to its expiry is not copied and not probed: the id pauses (see writeProbe). */
const CRED_MIN_AHEAD_MS = 10 * 60 * 1000;
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/**
 * claudeAiOauth.expiresAt of a credential file as epoch milliseconds. Absent field -> null (nothing to judge). Anything else that is
 * not a positive finite number (zero, negative, a string, null, an unreadable or unparsable file) -> 0, which counts as expired.
 * Values below 1e11 are epoch seconds and are normalised to milliseconds (the CLI writes milliseconds).
 */
function credExpiresAt(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return 0; }
  const o = j && j.claudeAiOauth;
  if (!o || typeof o !== 'object' || !('expiresAt' in o)) return null;
  const e = o.expiresAt;
  if (typeof e !== 'number' || !Number.isFinite(e) || e <= 0) return 0;
  return e < 1e11 ? e * 1000 : e;
}

function runBatch(ctx, first, last) {
  const m = ctx.manifest;
  const order = makeOrder(m.seed, m.n_per_arm);
  const lo = first || 1, hi = last || order.length;
  if (!(typeof m.window_s === 'number' && Number.isFinite(m.window_s) && m.window_s > 0)) throw new Exit(3, 'ABORT window_s of the manifest is not a positive number');
  fs.rmSync(path.join(ctx.runDir, 'stop.request'), { force: true }); // a resume clears an earlier stop request
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
    if (elapsed >= m.window_s) throw new Exit(8, `STOP_WINDOW before ${id} elapsed=${elapsed}`);
    const a = armSpend(ctx, arm);
    const p = projectCost({ runCosts: a.runCosts, probeSpent: a.probeSpent, total: m.n_per_arm, cap: m.arms[arm].cap, probeCost: m.probe_cost });
    // One COSTCHK per id: a resumed id (after a failed probe) keeps its first row.
    if (!readLog(ctx).some((r) => r.kind === 'COSTCHK' && idOf(r) === id)) ctx.log('COSTCHK', `${id} arm=${arm} stage=${p.stage} spent=${p.spent.toFixed(4)} projected=${p.projected.toFixed(4)} cap=${p.cap} ${p.stop ? 'stop' : 'ok'}`);
    if (p.stop) throw new Exit(5, `STOP_COST before ${id} arm=${arm} projected=${p.projected.toFixed(4)} cap=${p.cap}`);
    W.writeVersion(ctx, id);
    fs.rmSync(home, { recursive: true, force: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    // The credential file is copied from its source for every id (the per-run home is the only place the child sees it).
    const cred = ctx.credSource || path.join(os.homedir(), '.claude', '.credentials.json');
    if (!fs.existsSync(cred)) throw new Exit(3, 'ABORT no credential file');
    const exp = credExpiresAt(cred);
    const expiring = exp !== null && exp - ctx.now() < CRED_MIN_AHEAD_MS;
    // A launcher that is gone (killed, even with SIGKILL) must not leave a wrapper that keeps starting ids: pause instead.
    const orphan = ctx.parentPid ? (process.ppid !== ctx.parentPid || !pidAlive(ctx.parentPid)) : false;
    // A stop request (first TERM or INT, or <run-dir>/stop.request) pauses before the next id; the running id always finishes.
    const stopAsked = (STOP !== null && Atomics.load(STOP, 0) === 1) || fs.existsSync(path.join(ctx.runDir, 'stop.request'));
    const pauseReason = expiring ? 'source_token_expiring' : (orphan ? 'parent_gone' : (stopAsked ? 'operator_stop' : ''));
    if (!pauseReason) {
      fs.copyFileSync(cred, path.join(home, '.claude', '.credentials.json'));
      fs.chmodSync(path.join(home, '.claude', '.credentials.json'), 0o600);
    }
    fs.writeFileSync(path.join(home, '.claude.json'), '{"hasCompletedOnboarding":true}\n');
    W.writeProbe(ctx, id, home, pauseReason);
    const probeCost = probeTotal(ctx.runDir, id);
    // The probe takes seconds. Decide the window BEFORE any START artifact (ORDER, CMD, START) exists, and take the
    // elapsed value written to START right before it is written, so it agrees with its own timestamp.
    // (The first check at the top of the loop keeps the early value: it only decides whether to begin an id at all.)
    // The final timeout is computed here, once, before ORDER/CMD/START, and is the value the harness call gets.
    const tmo = harnessTimeoutMs(ctx.elapsed(), m.window_s);
    if (tmo <= 0) throw new Exit(8, `STOP_WINDOW before ${id} no window left after the probe`);
    const argv = harnessArgv(m, arm, out, traceDir);
    W.writeOrder(ctx, id, arm, pos);
    W.writeCmd(ctx, id, argv, out, traceDir);
    const elapsedNow = ctx.elapsed();
    W.writeStartEnd(ctx, 'START', id, `elapsed=${elapsedNow}`);
    const r = sh(ctx, [`HOME=${home}`, ...argv], { cwd: ctx.clone, timeout: tmo, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.mkdirSync(path.join(ctx.runDir, 'runs'), { recursive: true });
    fs.writeFileSync(`${out}.stdout`, r.stdout); fs.writeFileSync(`${out}.stderr`, r.stderr);
    W.writeStartEnd(ctx, 'END', id, `rc=${r.status}`);
    postRun(ctx, id, arm, out, traceDir, probeCost);
    if (r.status === 124 && ctx.elapsed() >= m.window_s - 1) throw new Exit(8, `STOP_WINDOW during ${id}`);
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
  const runCost = lastResultCost(runLog);
  if (runCost === null) ctx.log('COST_INVALID', `${id} no usable total_cost_usd in the last result object`); else W.writeCost(ctx, id, arm, runCost, probeCost);
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
    try { W.writeTaskHash(ctx, 'post'); } catch (e) { ctx.log('TASKHASH_DIFF', 'post fail'); }
    const n = ctx.manifest.n_per_arm;
    const tally = { ON: 0, C: 0 };
    // A run counts as complete only when its harness call ended with rc 0 AND it finished five turns.
    const rcs = endRcs(readLog(ctx));
    for (const r of readLog(ctx)) if (r.kind === 'TURNS') { const kv = kvOf(r.rest); if (kv.n === '5' && rcs[idOf(r)] === 0) tally[kv.arm]++; }
    ctx.log('COMPLETE', `ON=${tally.ON}/${n} C=${tally.C}/${n}`);
  }
  ctx.log('WRAPPER_EXIT', `rc=${code}`);
}

// ---------------------------------------------------------------- strict schema (every log row kind, every field, every raw file)

const NUM = '\\d+(?:\\.\\d+)?';
/**
 * Every row kind the wrapper writes, its exact shape, and how the audit checks each field.
 * An unknown kind or a row that does not match its shape fails the audit. `how` names where the audit gets the truth:
 * RAW = recomputed from a raw file, SEED/MANIFEST = derived from the seed or manifest, ROW = derived from other rows,
 * GIT = read from git, FORMAT = shape and position only. `test` names the assertion message in
 * hooks/tests/p2-batch-wrapper.test.sh that tampers this row (a test checks that every name exists there).
 */
const LOG_SCHEMA = [
  { kind: 'WRAPPER_START', re: /^first=(\d+) last=(\d+)$/, fields: [['first', 'FORMAT: 1 <= first <= last <= 2n'], ['last', 'FORMAT: last <= 2n']] },
  { kind: 'WRAPPER_DONE', re: /^last=(\d+)$/, fields: [['last', 'ROW: the final one equals 2n (full batch)']] },
  { kind: 'WRAPPER_EXIT', re: /^rc=(\d+)$/, fields: [['rc', 'ROW: the last row of the log, rc 0; one per WRAPPER_START']] },
  { kind: 'HASH', re: /^(wrapper|hook|harness|taskhash_expected|manifest|prereg) ([0-9a-f]{64})$/, fields: [['name', 'FORMAT: one of six names, all present'], ['count', 'ROW: each of the six appears once per WRAPPER_START, and every one equals the actual file'], ['sha256', 'RAW: the file hashed now (wrapper, hook, harness, manifest, PREREG note, baseline) and MANIFEST']] },
  { kind: 'PREREG', re: /^([0-9a-f]{40}) (\S+) ancestor=(yes|no)$/, fields: [['commit', 'GIT: git log -1 -- the PREREG path; note at that commit hashes to HASH prereg'], ['time', 'GIT: committer time of that commit, and earlier than WINDOW_START'], ['ancestor', 'GIT: merge-base --is-ancestor now']] },
  { kind: 'WINDOW_START', re: /^$/, fields: [['row', 'RAW: window.start epoch agrees with the row timestamp; exactly one row, before the first START']] },
  { kind: 'TASKHASH_DIFF', re: /^(pre|post) (ok|fail)$/, fields: [['phase', 'FORMAT'], ['tail', 'FORMAT: nothing follows ok or fail'], ['verdict', 'RAW: taskhash.pre/post.txt equal the baseline listing and the task directory hashed now']] },
  { kind: 'ORDER', re: /^(\S+) (ON|C) pos=(\d+)$/, fields: [['id', 'SEED'], ['arm', 'SEED'], ['pos', 'SEED'], ['position', 'ROW: after the id\'s last probe row, before its CMD and START']] },
  { kind: 'VERSION', re: /^(\S+) (.+)$/, fields: [['id', 'SEED'], ['value', 'MANIFEST: the pinned CLI'], ['position', 'ROW: exactly one per id, after its COSTCHK and before its first PROBE row']] },
  { kind: 'PROBE_OK', re: /^(\S+) cost=(NUM)$/, fields: [['id', 'SEED'], ['cost', 'RAW: probes/<id>-<k>.json, the k-th attempt']] },
  { kind: 'PROBE_FAIL', re: /^(\S+) rc=(\d+) cost=(NUM)$/, fields: [['id', 'SEED'], ['rc', 'RAW: saved response rc'], ['cost', 'RAW: saved response cost']] },
  { kind: 'PAUSE', re: /^id not launched$/, fields: [['row', 'ROW: one per PROBE_FAIL']] },
  { kind: 'CMD', re: /^(\S+) ([0-9a-f]{64})$/, fields: [['id', 'SEED'], ['sha256', 'RAW: cmd/<id>.json re-hashed; MANIFEST argv_sha and template']] },
  { kind: 'START', re: /^(\S+) elapsed=(\d+)$/, fields: [['id', 'SEED (order)'], ['elapsed', 'ROW: timestamp minus WINDOW_START, 3 s slack']] },
  { kind: 'END', re: /^(\S+) rc=(\d+)$/, fields: [['id', 'SEED (order)'], ['rc', 'FORMAT integer; semantics in COMPLETE and SCORE_MISSING']] },
  { kind: 'COSTCHK', re: /^(\S+) arm=(ON|C) stage=(pre5|post5) spent=(NUM) projected=(NUM) cap=(NUM) (ok|stop)$/, fields: [['id', 'SEED'], ['arm', 'SEED'], ['stage', 'ROW: recomputed from the COST rows before it'], ['spent', 'ROW: recomputed; covers earlier probes in probes.tsv'], ['projected', 'ROW: recomputed by projectCost'], ['cap', 'MANIFEST'], ['verdict', 'ROW: ok only when the recomputed projection is within the cap']] },
  { kind: 'COST', re: /^(\S+) arm=(ON|C) run=(NUM) probe=(NUM) running=(NUM) projected=(NUM)$/, fields: [['id', 'SEED'], ['arm', 'SEED'], ['run', 'RAW: last result object of run.log'], ['probe', 'RAW: sum of the id\'s saved probe responses'], ['running', 'ROW: arm sum of runs plus probes.tsv up to this id'], ['projected', 'ROW: recomputed by projectCost']] },
  { kind: 'SCORE', re: /^(\S+) m1=(\S+) m2=(\S+) m3=(\S+)$/, fields: [['id', 'SEED'], ['m1', 'RAW: oracle.log constraints_pass (real boolean)'], ['m2', 'RAW: oracle.log features_pass (real boolean)'], ['m3', 'ROW: m1 and m2']] },
  { kind: 'SCORE_MISSING', re: /^(\S+)$/, fields: [['id', 'SEED; only after END rc != 0']] },
  { kind: 'TURNS', re: /^(\S+) arm=(ON|C) n=(-?\d+)$/, fields: [['id', 'SEED'], ['arm', 'SEED'], ['n', 'RAW: result.json turns_completed']] },
  { kind: 'RUNVERSION', re: /^(\S+) (ok|fail) (.+)$/, fields: [['id', 'SEED'], ['flag', 'ROW: ok exactly when the value is the pin'], ['value', 'RAW: result.json runner_version, and MANIFEST pin']] },
  { kind: 'MODEL', re: /^(\S+) (.+)$/, fields: [['id', 'SEED'], ['value', 'RAW: modelUsage keys of run.log; exactly one id, same in all rows']] },
  { kind: 'HOOKCOUNT', re: /^(\S+) gate_trace=(\d+) gate_log=(\d+) plugin=(\d+)$/, fields: [['id', 'SEED'], ['gate_trace', 'RAW: trace/<id>/ files'], ['gate_log', 'RAW: hook JSONL record count'], ['plugin', 'RAW: trace/<id>/ files']] },
  { kind: 'HOOKERR', re: /^(\S+) (\S+)$/, fields: [['id', 'SEED'], ['n', 'RAW: hook JSONL error records; non-negative integer']] },
  { kind: 'BLOCKMAX', re: /^(\S+) (\S+)$/, fields: [['id', 'SEED'], ['value', 'RAW: hook JSONL max block records in one turn; at most N']] },
  { kind: 'COMPLETE', re: /^ON=(\d+)\/(\d+) C=(\d+)\/(\d+)$/, fields: [['counts', 'ROW: recount from END rc and result.json turns_completed (the last row)'], ['n', 'MANIFEST: n_per_arm in both counts']] },
];
// Rows whose mere presence invalidates the batch.
const FAIL_KINDS = new Set(['STOP_COST', 'STOP_WINDOW', 'STOP_AUTH', 'ABORT', 'REFUSE', 'COST_INVALID']);
const SCHEMA_BY_KIND = Object.fromEntries(LOG_SCHEMA.map((e) => [e.kind, { ...e, re: new RegExp(e.re.source.replace(/NUM/g, NUM)) }]));

// Raw files: what must exist, parse completely, and which set of names is allowed.
const FILE_SCHEMA = [
  ['invocation.log', 'every line parses to a known row kind and shape', 'unknown row kind'],
  ['window.start', 'one number; agrees with the WINDOW_START row', 'WINDOW_START file'],
  ['taskhash.pre.txt, taskhash.post.txt', 'exist; equal the baseline', 'notaskpost'],
  ['probes.tsv', 'every line has 4 columns, id in the expected set, rc integer, cost number, status ok|fail', 'probes.tsv unknown id'],
  ['probes/<id>-<n>.json', 'the set is exactly the files of expected ids, n = 1..k per id, each a complete JSON object', 'extra probe response with a gap'],
  ['cmd/<id>.json', 'the set is exactly the expected ids; each a JSON array', 'cmd/ file set is not exactly the expected ids'],
  ['cmd/<id>.json (content)', 'equals the manifest template with the canonical paths and hashes to the CMD row', 'saved argv with another gate'],
  ['runs/', 'entries are exactly <id>/, <id>.stdout, <id>.stderr for the expected ids (no more, no fewer)', 'extra entry in runs'],
  ['runs/<id>/run.log', 'exists for a finished call; AUTH pattern absent', 'raw run.log shows an expired session'],
  ['runs/<id>/run.log (JSON lines)', 'every line that starts with { parses completely (a truncated result object fails)', 'run.log truncated result object'],
  ['runs/<id>.stderr', 'exists (empty is fine); AUTH pattern absent', 'stderr files deleted'],
  ['runs/<id>/result.json', 'exists and parses completely when the call ended with rc 0 (when present it must parse); runner_version equals the log', 'result.json truncated'],
  ['runs/<id>/oracle.log', 'exists when the call ended with rc 0; first JSON object parses', 'oracle.log disagrees'],
  ['runs/<id>/gate.jsonl', 'exists when the call ended with rc 0; every line is a JSON object', 'gate.jsonl corrupt line'],
  ['runs/<id>/hook/live/per-turn-gate/*.jsonl', 'ON: at least one file; C: no hook directory; every record line parses with its fields', 'corrupt hook log line'],
  ['trace/<id>/trace-turn<n>.log', 'the set is exactly the expected ids; at least one readable regular file each, none unreadable; only a `latest` symlink to the highest-numbered file may be extra (never counted)', 'all C-arm traces deleted'],
  ['trace/<id>/latest', 'absent, or a symlink resolving to the highest-numbered trace-turn file', 'trace latest symlink to the wrong file'],
];

const GRAMMAR_TEXT = [
  'log := invocation+ ; WRAPPER_DONE (last=2n) ends the batch: it appears only after every id has been through its block, the last invocation must have it, and no row follows that invocation',
  'a non-last invocation ends with a failed probe (PROBE_FAIL, PAUSE) and nothing else; an invocation that ends with neither WRAPPER_DONE nor PAUSE (a STOP_*, ABORT or REFUSE row, or an interrupted run) is not allowed in an audited batch',
  'invocation := WRAPPER_START header block* footer',
  'header := HASH manifest, HASH prereg, HASH taskhash_expected, PREREG, HASH wrapper, HASH hook, HASH harness, [WINDOW_START in the first invocation only], TASKHASH_DIFF pre (each exactly once, in this order, in every invocation)',
  'block := COSTCHK, VERSION, PROBE_OK, ORDER, CMD, START, END, COST, SCORE or SCORE_MISSING, TURNS, RUNVERSION, MODEL, HOOKCOUNT, HOOKERR, BLOCKMAX (all for the next id in the seeded order, in this order)',
  'a failed probe is COSTCHK, VERSION, PROBE_FAIL, PAUSE, then the footer; the next invocation continues that id at its probe (no second COSTCHK or VERSION)',
  'footer := (WRAPPER_DONE | PAUSE already written), TASKHASH_DIFF post, COMPLETE, WRAPPER_EXIT ; WRAPPER_DONE only between blocks, and TASKHASH_DIFF post therefore always follows the last END of its invocation',
  'every PREREG row is checked against git (commit, time, ancestry) and every HASH row against the real file',
];

function schemaTable() {
  const out = ['| Row kind | Field | How the audit checks it | Test (assertion text) |', '|---|---|---|---|'];
  for (const e of LOG_SCHEMA) e.fields.forEach(([f, how], i) => out.push(`| ${i === 0 ? `\`${e.kind}\`` : ''} | ${f} | ${how.replace(/\|/g, '/')} | \`T:${e.kind}.${f}\` |`));
  out.push('| any other kind, an unparseable row, a missing timestamp | all | the audit fails | `unknown row kind` |');
  out.push(`| ${[...FAIL_KINDS].map((k) => `\`${k}\``).join(', ')} | all | presence fails the audit | \`terminal row\` |`);
  out.push('', '| Raw file or set | Must | Test (assertion text) |', '|---|---|---|');
  for (const [f, must, test] of FILE_SCHEMA) out.push(`| \`${f}\` | ${must} | \`${test}\` |`);
  out.push('', '**Log grammar** (checked before every other row rule; any row off its place fails)', '', ...GRAMMAR_TEXT.map((l) => `- ${l}`));
  return `${out.join('\n')}\n`;
}

const POST_KINDS = ['COST', 'SCORE', 'SCORE_MISSING', 'TURNS', 'RUNVERSION', 'MODEL', 'HOOKCOUNT', 'HOOKERR', 'BLOCKMAX'];

/** Row shapes, ids, positions and the per-id sequence. Returns the failures (the caller stops here when there are any). */
/** Token a row stands for in the log grammar. */
function logToken(r) {
  if (r.kind === 'HASH') return `HASH:${r.rest.split(' ')[0]}`;
  if (r.kind === 'TASKHASH_DIFF') return `TD:${r.rest.split(' ')[0]}`;
  if (r.kind === 'SCORE_MISSING') return 'SCORE';
  return r.kind;
}

/**
 * The log as a grammar. One wrapper invocation is: WRAPPER_START, a fixed header (HASH manifest, HASH prereg, HASH taskhash_expected,
 * PREREG, HASH wrapper, HASH hook, HASH harness, WINDOW_START in the first invocation only, TASKHASH_DIFF pre), then id blocks, then
 * a footer ([WRAPPER_DONE], TASKHASH_DIFF post, COMPLETE, WRAPPER_EXIT). An id block is COSTCHK, VERSION, then PROBE_OK followed by
 * ORDER, CMD, START, END, COST, SCORE or SCORE_MISSING, TURNS, RUNVERSION, MODEL, HOOKCOUNT, HOOKERR, BLOCKMAX; a probe that fails
 * is PROBE_FAIL, PAUSE and the footer, and the next invocation continues that id at its probe (no second COSTCHK or VERSION).
 * Ids come in the seeded order. The last invocation ends with WRAPPER_DONE after the last id. Any row off its place fails.
 */
function auditGrammar(rows, ids) {
  const BODY = ['ORDER', 'CMD', 'START', 'END', 'COST', 'SCORE', 'TURNS', 'RUNVERSION', 'MODEL', 'HOOKCOUNT', 'HOOKERR', 'BLOCKMAX'];
  const idOf2 = (r) => r.rest.split(' ')[0];
  let i = 0, inv = 0, cur = 0, stage = 'new', k = 0, done = false;
  const bad = (msg) => [`log grammar: ${msg}`];
  while (i < rows.length) {
    inv++;
    const hdr = ['WRAPPER_START', 'HASH:manifest', 'HASH:prereg', 'HASH:taskhash_expected', 'PREREG', 'HASH:wrapper', 'HASH:hook', 'HASH:harness', ...(inv === 1 ? ['WINDOW_START'] : []), 'TD:pre'];
    for (const want of hdr) {
      if (i >= rows.length || logToken(rows[i]) !== want) return bad(`row ${i + 1}: expected ${want} in the header of invocation ${inv}, found ${i < rows.length ? logToken(rows[i]) : 'the end of the log'}`);
      i++;
    }
    let paused = false;
    for (;;) {
      const r = rows[i];
      if (!r) return bad(`invocation ${inv} has no footer`);
      const t = logToken(r);
      if (t === 'WRAPPER_DONE' || t === 'TD:post') break;
      if (paused) return bad(`row ${i + 1}: ${t} after PAUSE, only the footer may follow`);
      const wantId = ids[cur];
      if (stage === 'run') {
        if (t !== BODY[k]) return bad(`row ${i + 1}: expected ${BODY[k]} for ${wantId}, found ${t}`);
        if (idOf2(r) !== wantId) return bad(`row ${i + 1}: ${t} names ${idOf2(r)}, expected ${wantId}`);
        k++; if (k === BODY.length) { cur++; stage = 'new'; }
      } else if (t === 'COSTCHK' && stage === 'new' && cur < ids.length && idOf2(r) === wantId) stage = 'costchk';
      else if (t === 'VERSION' && stage === 'costchk' && idOf2(r) === wantId) stage = 'version';
      else if (t === 'PROBE_OK' && stage === 'version' && idOf2(r) === wantId) { stage = 'run'; k = 0; }
      else if (t === 'PROBE_FAIL' && stage === 'version' && idOf2(r) === wantId) {
        if (!rows[i + 1] || rows[i + 1].kind !== 'PAUSE') return bad(`row ${i + 1}: PROBE_FAIL is not followed by PAUSE`);
        i++; paused = true;
      } else return bad(`row ${i + 1}: ${t} is not allowed here (id ${wantId}, stage ${stage})`);
      i++;
    }
    if (logToken(rows[i]) === 'WRAPPER_DONE') {
      if (paused || stage !== 'new') return bad(`row ${i + 1}: WRAPPER_DONE in the middle of an id block`);
      if (cur !== ids.length) return bad(`row ${i + 1}: WRAPPER_DONE after ${cur} of ${ids.length} ids (it ends the batch)`);
      done = true; i++;
    } else if (!paused) return bad(`row ${i + 1}: invocation ${inv} ends without WRAPPER_DONE or PAUSE`);
    for (const want of ['TD:post', 'COMPLETE', 'WRAPPER_EXIT']) {
      if (i >= rows.length || logToken(rows[i]) !== want) return bad(`row ${i + 1}: expected ${want} in the footer of invocation ${inv}, found ${i < rows.length ? logToken(rows[i]) : 'the end of the log'}`);
      i++;
    }
    if (done && i < rows.length) return bad(`row ${i + 1}: rows after the invocation that ended with WRAPPER_DONE`);
  }
  if (!done || cur !== ids.length) return bad(`the log ends after ${cur} of ${ids.length} ids or without WRAPPER_DONE`);
  return [];
}

function auditRows(rows, ids, order, m) {
  const f = [];
  const n2 = ids.length;
  rows.forEach((r, i) => {
    if (r.kind === '?' || !r.ts || !Number.isFinite(Date.parse(r.ts))) { f.push(`unknown row kind or unparseable row ${i + 1}: ${r.raw.slice(0, 60)}`); return; }
    if (FAIL_KINDS.has(r.kind)) { f.push(`terminal row present: ${r.kind}`); return; }
    const sc = SCHEMA_BY_KIND[r.kind];
    if (!sc) { f.push(`unknown row kind ${r.kind}`); return; }
    const mm = sc.re.exec(r.rest);
    if (!mm) { f.push(`${r.kind}: row does not match its shape: ${r.rest.slice(0, 80)}`); return; }
    const hasId = !['WRAPPER_START', 'WRAPPER_DONE', 'WRAPPER_EXIT', 'HASH', 'PREREG', 'WINDOW_START', 'TASKHASH_DIFF', 'PAUSE', 'COMPLETE'].includes(r.kind);
    if (hasId && !ids.includes(mm[1])) f.push(`${r.kind}: id ${mm[1]} is not in the expected set`);
    const arm = ({ ORDER: 2, COSTCHK: 2, COST: 2, TURNS: 2 })[r.kind];
    if (hasId && arm && ids.includes(mm[1])) { const want = order.find((o) => o.id === mm[1]).arm; if (mm[arm] !== want) f.push(`${r.kind} ${mm[1]}: arm ${mm[arm]} differs from the seeded arm ${want}`); }
    if (r.kind === 'WRAPPER_START' && !(Number(mm[1]) >= 1 && Number(mm[1]) <= Number(mm[2]) && Number(mm[2]) <= n2)) f.push(`WRAPPER_START range: ${r.rest}`);
  });
  if (f.length) return f;
  const gr = auditGrammar(rows, ids);
  if (gr.length) return gr;
  const kinds = (k) => rows.filter((r) => r.kind === k);
  const done = kinds('WRAPPER_DONE'), exits = kinds('WRAPPER_EXIT');
  if (!(done.length && Number(/last=(\d+)/.exec(done[done.length - 1].rest)[1]) === n2)) f.push('final WRAPPER_DONE is missing or not last=2n');
  if (!(exits.length && rows[rows.length - 1] === exits[exits.length - 1] && exits[exits.length - 1].rest === 'rc=0')) f.push('final WRAPPER_EXIT is missing, not the last row, or not rc=0');
  if (exits.length !== kinds('WRAPPER_START').length) f.push('final WRAPPER_EXIT count differs from the WRAPPER_START count');
  if (kinds('PAUSE').length !== kinds('PROBE_FAIL').length) f.push('PAUSE count differs from the PROBE_FAIL count');
  // per-id sequence: COSTCHK < VERSION < probes < ORDER < CMD < START < END < every post row, each post row once
  for (const id of ids) {
    const of = (k) => rows.map((r, i) => (r.kind === k && r.rest.split(' ')[0] === id ? i : -1)).filter((i) => i >= 0);
    const one = (k) => { const a = of(k); if (a.length !== 1) f.push(`${id}: need exactly one ${k} row (got ${a.length})`); return a[0]; };
    const cc = one('COSTCHK'), vr = one('VERSION'), or = one('ORDER'), cm = one('CMD'), st = one('START'), en = one('END');
    const pr = [...of('PROBE_OK'), ...of('PROBE_FAIL')].sort((a, b) => a - b);
    const lastBefore = Math.max(vr, ...pr, cc);
    if (!(cc < vr && vr < Math.min(...pr) && Math.max(...pr) < or && or < cm && cm < st && st < en && lastBefore < or)) f.push(`${id}: rows are out of sequence (COSTCHK, VERSION, PROBE, ORDER, CMD, START, END)`);
    const postKinds = POST_KINDS.filter((k) => k !== 'SCORE' && k !== 'SCORE_MISSING');
    for (const k of postKinds) { const p = one(k); if (!(p > en)) f.push(`${id}: ${k} is not after END`); }
    const sa = of('SCORE'), sb = of('SCORE_MISSING');
    if (sa.length + sb.length !== 1 || !((sa[0] ?? sb[0]) > en)) f.push(`${id}: need exactly one SCORE or SCORE_MISSING after END`);
  }
  const pre = rows.findIndex((r) => r.kind === 'PREREG'), ws = rows.findIndex((r) => r.kind === 'WINDOW_START'), s0 = rows.findIndex((r) => r.kind === 'START');
  if (kinds('WINDOW_START').length !== 1 || !(ws < s0)) f.push('WINDOW_START must appear exactly once, before the first START');
  if (!(pre >= 0 && pre < s0)) f.push('PREREG must appear before the first START');
  void m;
  return f;
}

const HOOK_REASONS = new Set(['block', 'clean', 'cap', 'error', 'off']);
/** Raw file inventory and completeness. */
function auditFiles(runDir, ids, order, m, rcOf) {
  const f = [];
  const exists = (p) => fs.existsSync(path.join(runDir, p));
  const list = (p) => { try { return fs.readdirSync(path.join(runDir, p)).sort(); } catch (_e) { return null; } };
  const sameSet = (got, want, what) => { if (got === null) { f.push(`${what}: directory is missing`); return; } const a = new Set(got), b = new Set(want); const extra = got.filter((x) => !b.has(x)), miss = want.filter((x) => !a.has(x)); if (extra.length || miss.length) f.push(`${what}: extra entry in ${what} [${extra.join(',')}] or missing [${miss.join(',')}]`); };
  sameSet(list('runs'), ids.flatMap((i) => [i, `${i}.stdout`, `${i}.stderr`]), 'runs');
  sameSet(list('trace'), ids, 'trace');
  sameSet(list('cmd'), ids.map((i) => `${i}.json`), 'cmd');
  const parseJson = (p) => { try { return JSON.parse(fs.readFileSync(path.join(runDir, p), 'utf8')); } catch (_e) { return undefined; } };
  const ws = (() => { try { return fs.readFileSync(path.join(runDir, 'window.start'), 'utf8').trim(); } catch (_e) { return null; } })();
  if (ws === null || !/^\d+$/.test(ws)) f.push('window.start is missing or not a number');
  for (const id of ids) {
    const ok = rcOf[id] === 0;
    const rp = (x) => path.join('runs', id, x);
    if (ok) {
      for (const need of ['run.log', 'result.json', 'oracle.log', 'gate.jsonl']) if (!exists(rp(need))) f.push(`${id}: runs/${id}/${need} is missing`);
      const rj = parseJson(rp('result.json'));
      if (exists(rp('result.json')) && !(rj && typeof rj === 'object' && ['task_id', 'arm', 'runner', 'model', 'runner_version', 'turns', 'turns_completed'].every((k) => k in rj))) f.push(`${id}: result.json does not parse or lacks fields`);
    } else if (exists(rp('result.json')) && parseJson(rp('result.json')) === undefined) f.push(`${id}: result.json does not parse`);
    if (exists(rp('run.log'))) fs.readFileSync(path.join(runDir, rp('run.log')), 'utf8').split('\n').forEach((l, i) => { if (l.trimStart().startsWith('{')) { try { JSON.parse(l); } catch (_e) { f.push(`${id}: run.log truncated result object or broken JSON line ${i + 1}`); } } });
    if (exists(rp('gate.jsonl'))) fs.readFileSync(path.join(runDir, rp('gate.jsonl')), 'utf8').split('\n').forEach((l, i) => { if (l.trim()) { try { const o = JSON.parse(l); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('x'); } catch (_e) { f.push(`${id}: gate.jsonl corrupt line ${i + 1}`); } } });
    const arm = order.find((o) => o.id === id).arm;
    const hd = path.join('runs', id, 'hook', 'live', 'per-turn-gate');
    if (arm === 'C') { if (exists(path.join('runs', id, 'hook'))) f.push(`${id}: control run has a hook directory`); } else {
      const files = (list(hd) || []).filter((x) => x.endsWith('.jsonl'));
      if (!files.length) f.push(`${id}: ON run has no hook JSONL file`);
      for (const file of files) fs.readFileSync(path.join(runDir, hd, file), 'utf8').split('\n').forEach((l, i) => {
        if (!l.trim()) return;
        let o; try { o = JSON.parse(l); } catch (_e) { f.push(`${id}: corrupt hook log line ${file}:${i + 1}`); return; }
        const okRec = o && typeof o === 'object' && typeof o.session === 'string' && (o.turn === null || Number.isInteger(o.turn)) && (o.decision === 'allow' || o.decision === 'block') && HOOK_REASONS.has(o.reason) && Number.isInteger(o.counter) && o.counter >= 0;
        if (!okRec) f.push(`${id}: corrupt hook log line ${file}:${i + 1} (fields)`);
      });
    }
    const tf = traceFiles(path.join(runDir, 'trace', id));
    if (!tf.regular.length || tf.other.length || tf.unreadable.length) f.push(`${id}: trace/${id} has no readable trace-turn file, an unreadable one, or unexpected names`);
    if (tf.latest && !tf.latestOk) f.push(`${id}: trace/${id}/latest is not a symlink to the highest trace-turn file`);
    const cmdv = parseJson(path.join('cmd', `${id}.json`));
    if (!Array.isArray(cmdv)) f.push(`${id}: cmd/${id}.json is not a JSON array`);
  }
  // probes.tsv: complete and well formed
  const tsv = (() => { try { return fs.readFileSync(path.join(runDir, 'probes.tsv'), 'utf8').split('\n').filter(Boolean); } catch (_e) { return null; } })();
  if (tsv === null) f.push('probes.tsv is missing');
  else tsv.forEach((l, i) => { const c = l.split('\t'); if (!(c.length === 4 && ids.includes(c[0]) && /^\d+$/.test(c[1]) && /^\d+(\.\d+)?$/.test(c[2]) && (c[3] === 'ok' || c[3] === 'fail'))) f.push(`probes.tsv line ${i + 1} unknown id or malformed: ${l.slice(0, 60)}`); });
  // saved probe responses: each a complete JSON object
  for (const file of list('probes') || []) { const o = parseJson(path.join('probes', file)); if (!(o && typeof o === 'object' && 'rc' in o && 'parse_ok' in o)) f.push(`probes/${file}: not a complete probe record`); }
  void m;
  return f;
}

// ---------------------------------------------------------------- audit

function audit(runDir, m, clone, opts) {
  const fails = [];
  const need = (cond, msg) => { if (!cond) fails.push(msg); };
  const read = (f) => { try { return fs.readFileSync(path.join(runDir, f), 'utf8'); } catch (_e) { return null; } };
  const logText = read('invocation.log');
  if (logText === null) return ['invocation.log is absent'];
  if (!clone) return ['audit needs --clone (the committed files are re-checked against git and the real files)'];
  const rows = parseLog(logText);
  const order = makeOrder(m.seed, m.n_per_arm);
  const ids = order.map((o) => o.id);
  const by = (kind) => rows.filter((r) => r.kind === kind);
  const byId = (kind, id) => by(kind).filter((r) => idOf(r) === id);
  // Strict layer 1: every row has a known kind, its exact shape, an expected id/arm and its place in the per-id sequence.
  const strictRows = auditRows(rows, ids, order, m);
  if (strictRows.length) return strictRows;

  // 1 order and uniqueness: the START sequence is the seeded order, each START closed by its END before the next START.
  const seq = rows.filter((r) => r.kind === 'START' || r.kind === 'END').map((r) => `${r.kind} ${idOf(r)}`);
  const expectSeq = ids.flatMap((i) => [`START ${i}`, `END ${i}`]);
  need(seq.join('|') === expectSeq.join('|'), `START/END sequence differs from the preregistered order (got ${seq.length} entries, want ${expectSeq.length}; duplicate, missing, or out of order)`);
  // timestamps: all parse, never go backwards, START <= END per id, START elapsed agrees with WINDOW_START
  {
    let prev = -Infinity, badTs = 0, backwards = 0;
    for (const r of rows) { const t = Date.parse(r.ts); if (!Number.isFinite(t)) { badTs++; continue; } if (t < prev) backwards++; prev = Math.max(prev, t); }
    need(badTs === 0, `${badTs} log lines have an unparseable timestamp`);
    need(backwards === 0, `${backwards} log lines go back in time`);
    for (const id of ids) { const st = byId('START', id)[0], en = byId('END', id)[0]; if (st && en) need(Date.parse(st.ts) <= Date.parse(en.ts), `${id}: END is earlier than START`); }
    const w0 = by('WINDOW_START')[0];
    if (w0) for (const r of by('START')) need(Math.abs((Date.parse(r.ts) - Date.parse(w0.ts)) / 1000 - Number(kvOf(r.rest).elapsed)) <= 3, `${idOf(r)}: START elapsed ${kvOf(r.rest).elapsed} disagrees with its timestamp`);
  }
  // Weak window cross-check: the run's own files were written between its START and END (strict: START <= mtime <= END, same clock).
  for (const id of ids) {
    const st = byId('START', id)[0], en = byId('END', id)[0];
    if (!st || !en) continue;
    for (const f of ['run.log', 'result.json']) {
      // Math.floor on the upper bound is deliberate: log timestamps have millisecond precision (Date.now) while a file mtime has a
      // fraction, so a file written in the same millisecond just before the END row would otherwise look later than END.
      let mt = NaN; try { mt = fs.statSync(path.join(runDir, 'runs', id, f)).mtimeMs; } catch (_e) { /* below */ }
      need(Number.isFinite(mt) && Math.floor(mt) >= Date.parse(st.ts) && Math.floor(mt) <= Date.parse(en.ts), `${id}: runs/${id}/${f} was last written outside its START..END window`);
    }
  }
  { const w0 = by('WINDOW_START')[0]; const wsv = Number((read('window.start') || '').trim()); need(w0 && Number.isFinite(wsv) && Math.abs(wsv - Date.parse(w0.ts)) < 2000, 'window.start does not agree with the WINDOW_START row'); }
  // 2 window
  const win0 = by('WINDOW_START')[0];
  need(by('WINDOW_START').length === 1, `WINDOW_START must appear exactly once (got ${by('WINDOW_START').length})`);
  need(by('STOP_WINDOW').length === 0, 'STOP_WINDOW is present');
  { const ends = by('END'); if (win0 && ends.length) need((Date.parse(ends[ends.length - 1].ts) - Date.parse(win0.ts)) / 1000 <= m.window_s, 'the last END is later than the window end'); }
  for (const r of by('START')) need(Number(kvOf(r.rest).elapsed) <= m.window_s, `${idOf(r)} started after the window`);
  // 3 task hash
  const pre = read('taskhash.pre.txt'), post = read('taskhash.post.txt');
  need(pre !== null, 'taskhash.pre.txt is absent');
  need(post !== null, 'taskhash.post.txt is absent');
  let expected = null;
  if (clone) { try { expected = fs.readFileSync(path.join(clone, m.taskhash_expected), 'utf8'); } catch (_e) { /* below */ } }
  if (expected !== null) { need(pre === expected, 'taskhash.pre.txt differs from the preregistered listing'); need(post === expected, 'taskhash.post.txt differs from the preregistered listing'); }
  else need(pre !== null && post !== null && pre === post, 'taskhash.pre.txt and taskhash.post.txt differ');
  if (clone) {
    // The task directory as it is now, re-hashed here (it lives in the repo and still exists at audit time).
    let nowList = null; try { nowList = taskListing(path.join(clone, 'evals', 'orchestration', 'tasks', m.task)); } catch (_e) { /* below */ }
    need(nowList !== null && nowList === expected && nowList === post, 'the task directory now does not hash to the baseline listing and taskhash.post.txt');
  }
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
    need(rv.length !== 1 || (rv[0].rest.split(' ')[1] === 'ok') === (rv[0].rest.split(' ').slice(2).join(' ') === m.cli), `${id}: RUNVERSION flag disagrees with its value`);
    // Do not trust the ok marker: compare the logged value with the pin and with the run's own result.json.
    const rvVal = rv.length === 1 ? rv[0].rest.split(' ').slice(2).join(' ') : null;
    need(rvVal === m.cli, `${id}: RUNVERSION value "${rvVal}" is not the pinned ${m.cli}`);
    let rj = null; try { rj = JSON.parse(read(path.join('runs', id, 'result.json'))).runner_version; } catch (_e) { /* below */ }
    need(rj === rvVal, `${id}: result.json runner_version "${rj}" differs from the logged RUNVERSION`);
  }
  // 5 probe
  // The complete set of saved probe responses: every file name must be a known id and a sequence number, numbers run 1..n
  // per id with no gap, and (below) the count matches probes.tsv and the PROBE rows.
  const pfm = {}; const pfBad = [];
  try { for (const f of fs.readdirSync(path.join(runDir, 'probes'))) { const mm = /^((?:ON|C)-\d\d)-(\d+)\.json$/.exec(f); if (!mm || !ids.includes(mm[1])) pfBad.push(f); else (pfm[mm[1]] = pfm[mm[1]] || []).push(Number(mm[2])); } } catch (_e) { pfBad.push('(probes directory unreadable)'); }
  need(pfBad.length === 0, `unexpected or unreadable entries in probes/: ${pfBad.join(', ')}`);
  // A PROBE_FAIL pauses the batch; the id is then launched once after a fresh login, so only an id without PROBE_OK fails.
  need(by('STOP_AUTH').length === 0, 'STOP_AUTH is present');
  // Re-scan the raw logs with the wrapper's own pattern: a session that expired inside a run invalidates the batch.
  for (const id of ids) {
    const errText = read(path.join('runs', `${id}.stderr`));
    need(errText !== null, `${id}: runs/${id}.stderr is missing or unreadable (an empty file is fine)`);
    const raw = `${read(path.join('runs', id, 'run.log')) || ''}\n${errText || ''}`;
    need(!AUTH_RE.test(raw), `${id}: the raw run.log/stderr shows an authentication failure`);
  }
  const probeRaw = {};
  const probeTsvRows = (read('probes.tsv') || '').split('\n').filter(Boolean).map((l) => l.split('\t'));
  for (const id of ids) {
    // probes.tsv statuses and the PROBE_OK/PROBE_FAIL rows of this id must be the same sequence, ending in a success
    // that comes before the id's START; a failed row cannot be covered by a PROBE_OK.
    const tsvSeq = probeTsvRows.filter((q) => q[0] === id).map((q) => (q[1] === '0' && q[3] === 'ok' ? 'ok' : 'fail'));
    const logRows = rows.filter((r) => (r.kind === 'PROBE_OK' || r.kind === 'PROBE_FAIL') && idOf(r) === id);
    const logSeq = logRows.map((r) => (r.kind === 'PROBE_OK' ? 'ok' : 'fail'));
    need(tsvSeq.length > 0 && tsvSeq.join(',') === logSeq.join(','), `${id}: probes.tsv statuses (${tsvSeq.join(',')}) differ from the PROBE rows in the log (${logSeq.join(',')})`);
    // The probe's own saved response decides ok/fail and the cost; tsv and log must agree with it.
    const nums = (pfm[id] || []).sort((a, b) => a - b);
    need(nums.length > 0 && nums.every((n, k) => n === k + 1), `${id}: probe response files are not numbered 1..n without a gap (${nums.join(',')})`);
    const pfiles = nums.map((n) => path.join(runDir, 'probes', `${id}-${n}.json`));
    const rawSeq = [], rawCost = [];
    for (const f of pfiles) { let o = {}; try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_e) { /* fail */ }
      rawSeq.push(o.rc === 0 && o.parse_ok === true && o.is_error === false && o.auth_ok === true && typeof o.total_cost_usd === 'number' && Number.isFinite(o.total_cost_usd) && o.total_cost_usd >= 0 ? 'ok' : 'fail'); rawCost.push(typeof o.total_cost_usd === 'number' ? o.total_cost_usd : 0); } // a failed probe without a usable cost is recorded as 0 on both sides (probes.tsv and the saved response)
    const tsvCost = probeTsvRows.filter((q) => q[0] === id).map((q) => Number(q[2]));
    need(rawSeq.join(',') === tsvSeq.join(',') && rawCost.length === tsvCost.length && rawCost.every((c, k) => Math.abs(c - tsvCost[k]) < 5e-7), `${id}: probes/${id}-n.json (${rawSeq.join(',')}) differ from probes.tsv / the PROBE rows in status or cost`);
    // The k-th PROBE row of this id is the k-th saved response: same cost, and for a failure the same rc.
    logRows.forEach((r, k) => {
      let o = {}; try { o = JSON.parse(fs.readFileSync(pfiles[k], 'utf8')); } catch (_e) { /* mismatch below */ }
      const kvp = kvOf(r.rest); const c = Number(kvp.cost);
      need(Math.abs(c - (typeof o.total_cost_usd === 'number' ? o.total_cost_usd : 0)) < 5e-7, `${id}: PROBE_OK/PROBE_FAIL cost ${kvp.cost} differs from the saved response ${k + 1}`);
      if (r.kind === 'PROBE_FAIL') need(String(o.rc) === kvp.rc, `${id}: PROBE_FAIL rc ${kvp.rc} differs from the saved response rc ${o.rc}`);
    });
    probeRaw[id] = rawCost.reduce((x, y) => x + (Number.isFinite(y) ? y : 0), 0);
    need(tsvSeq[tsvSeq.length - 1] === 'ok', `${id}: the last probe did not succeed`);
    const okRows = logRows.filter((r) => r.kind === 'PROBE_OK'), st0 = byId('START', id)[0];
    need(okRows.length >= 1 && st0 && rows.indexOf(okRows[okRows.length - 1]) < rows.indexOf(st0) && Date.parse(okRows[okRows.length - 1].ts) <= Date.parse(st0.ts), `${id}: no successful probe before the START`);
  }
  // 6 command
  for (const o of order) {
    const c = byId('CMD', o.id);
    need(c.length === 1 && c[0].rest.split(' ')[1] === m.argv_sha[o.arm], `${o.id}: CMD missing or differs from the preregistered argv`);
    // The saved argv is hashed again here and must be the manifest's command template (only out and trace may differ).
    let av = null; try { av = JSON.parse(read(path.join('cmd', `${o.id}.json`))); } catch (_e) { /* below */ }
    const outV = av && av[av.indexOf('--out') + 1], trV = av && av[av.indexOf('--hook-trace-dir') + 1];
    need(Array.isArray(av) && JSON.stringify(av) === JSON.stringify(harnessArgv(m, o.arm, outV, trV)) && c.length === 1 && argvSha(av, outV, trV) === c[0].rest.split(' ')[1], `${o.id}: the saved argv (cmd/${o.id}.json) is not the preregistered command template or does not hash to the CMD row`);
    // The out and trace paths are the canonical ones under this run directory (the audit runs where the batch ran).
    need(Array.isArray(av) && outV === path.join(runDir, 'runs', o.id) && trV === path.join(runDir, 'trace', o.id), `${o.id}: the saved argv does not use the canonical run paths ${path.join(runDir, 'runs', o.id)} and ${path.join(runDir, 'trace', o.id)}`);
  }
  // 7 score
  const rcOf = endRcs(rows);
  for (const id of ids) need(Number.isInteger(rcOf[id]), `${id}: END rc is absent or not an integer`);
  for (const id of ids) {
    const sc = byId('SCORE', id), miss = byId('SCORE_MISSING', id);
    // A failed harness call (rc != 0, 124 included) may have no score; a successful one must.
    need((sc.length === 1 && miss.length === 0) || (sc.length === 0 && miss.length === 1 && rcOf[id] !== 0), `${id}: need one SCORE (or SCORE_MISSING only after a failed call, rc != 0)`);
    if (sc.length === 1) {
      let o = null; try { o = jsonObjects(read(path.join('runs', id, 'oracle.log')))[0]; } catch (_e) { /* below */ }
      const kv0 = kvOf(sc[0].rest);
      // Both oracle fields must be real booleans (as writeScore requires); anything else is not a recoverable score.
      need(o && typeof o.constraints_pass === 'boolean' && typeof o.features_pass === 'boolean' && kv0.m1 === (o.constraints_pass === true ? '1' : '0') && kv0.m2 === (o.features_pass === true ? '1' : '0'), `${id}: SCORE differs from the oracle.log recomputation`);
    }
    if (sc.length === 1) {
      const kv = kvOf(sc[0].rest);
      const okv = ['m1', 'm2', 'm3'].every((k) => kv[k] === '0' || kv[k] === '1');
      need(okv, `${id}: SCORE values must each be 0 or 1 (got ${sc[0].rest})`);
      need(okv && kv.m3 === (kv.m1 === '1' && kv.m2 === '1' ? '1' : '0'), `${id}: SCORE m3 must be 1 exactly when m1 and m2 are 1`);
    }
  }
  // 8 completion per arm
  const tally = { ON: 0, C: 0 };
  for (const id of ids) {
    const t = byId('TURNS', id);
    need(t.length === 1, `${id}: TURNS missing`);
    if (t.length === 1) {
      // The raw count comes from the run's own result.json; the TURNS row must equal it and the recount uses the raw value.
      let rawTurns = -1; try { const v = JSON.parse(read(path.join('runs', id, 'result.json'))).turns_completed; if (Number.isInteger(v)) rawTurns = v; } catch (_e) { /* -1 */ }
      const kv = kvOf(t[0].rest);
      need(Number(kv.n) === rawTurns, `${id}: TURNS n=${kv.n} differs from result.json turns_completed (${rawTurns})`);
      if (rawTurns === 5 && rcOf[id] === 0) tally[(order.find((o) => o.id === id) || {}).arm]++;
    }
  }
  for (const arm of ['ON', 'C']) need(tally[arm] >= m.min_complete, `${arm}: only ${tally[arm]} of ${m.n_per_arm} completed five turns (need ${m.min_complete})`);
  const comp = by('COMPLETE');
  need(comp.length > 0 && comp[comp.length - 1].rest === `ON=${tally.ON}/${m.n_per_arm} C=${tally.C}/${m.n_per_arm}`, 'last COMPLETE line does not match the recount from END rc and TURNS rows');
  // 9 model
  const models = new Set(by('MODEL').map((r) => r.rest.slice(idOf(r).length + 1)));
  need(by('MODEL').length === ids.length, 'a MODEL line is missing');
  need(models.size === 1 && !models.has('unknown'), `resolved model ids are not a single known value: ${[...models].join(' | ')}`);
  for (const id of ids) need(byId('MODEL', id).length === 1, `${id}: need exactly one MODEL row`);
  for (const id of ids) { const mr = byId('MODEL', id)[0]; if (mr) need(mr.rest.slice(id.length + 1) === modelsOf(read(path.join('runs', id, 'run.log')) || ''), `${id}: MODEL row differs from the model ids in the run's own result objects`); }
  for (const r of by('MODEL')) need(/^[^\s,]+$/.test(r.rest.slice(idOf(r).length + 1)), `${idOf(r)}: MODEL must be exactly one model id (got "${r.rest.slice(idOf(r).length + 1)}")`);
  // 10 hook only in ON
  for (const o of order) {
    const h = byId('HOOKCOUNT', o.id);
    need(h.length === 1, `${o.id}: HOOKCOUNT missing`);
    if (h.length === 1) {
      const kv = kvOf(h[0].rest);
      const tc = traceCounts(path.join(runDir, 'trace', o.id));
      need(tc.files > 0, `${o.id}: no readable debug trace under trace/${o.id} (a missing trace cannot show that the gate did or did not run)`);
      need(Number(kv.gate_trace) === tc.gate && Number(kv.plugin) === tc.plugin, `${o.id}: HOOKCOUNT gate_trace/plugin (${kv.gate_trace}/${kv.plugin}) differ from the debug traces (${tc.gate}/${tc.plugin})`);
      if (o.arm === 'ON') need(Number(kv.gate_trace) === Number(kv.gate_log) && Number(kv.gate_log) > 0, `${o.id}: gate_trace ${kv.gate_trace} != gate_log ${kv.gate_log} (or zero)`);
      else need(Number(kv.gate_trace) === 0 && Number(kv.gate_log) === 0, `${o.id}: control run shows gate hook activity`);
    }
  }
  { // instrument health: hook errors in at most 2 ON runs
    let errRuns = 0;
    for (const o of order) { const e = byId('HOOKERR', o.id); need(e.length === 1, `${o.id}: need exactly one HOOKERR row`); if (e.length === 1) { const v = e[0].rest.split(' ')[1]; need(/^\d+$/.test(v), `${o.id}: HOOKERR must be a non-negative integer (got "${v}")`); if (o.arm === 'ON' && Number(v) > 0) errRuns++; } }
    need(errRuns <= 2, `${errRuns} ON runs had hook errors (at most 2 allowed)`);
  }
  // 11 blocks per turn
  for (const id of ids) {
    const b = byId('BLOCKMAX', id);
    const bv = b.length === 1 ? b[0].rest.split(' ')[1] : null;
    need(bv !== null && /^\d+$/.test(bv) && Number(bv) <= m.max_blocks, `${id}: BLOCKMAX missing, not a non-negative integer, or above ${m.max_blocks}`);
    // Recompute from the raw hook log of the run, not from the summary rows.
    const raw = hookRecords(path.join(runDir, 'runs', id));
    const per = {}; for (const rec of raw) if (rec.decision === 'block') per[String(rec.turn)] = (per[String(rec.turn)] || 0) + 1;
    const rawMax = Math.max(0, ...Object.values(per));
    need(bv !== null && rawMax === Number(bv), `${id}: BLOCKMAX ${bv} differs from the raw hook log (${rawMax})`);
    need(rawMax <= m.max_blocks, `${id}: raw hook log shows ${rawMax} blocks in one turn (max ${m.max_blocks})`);
    const hc = byId('HOOKCOUNT', id)[0], he = byId('HOOKERR', id)[0];
    if (hc) need(Number(kvOf(hc.rest).gate_log) === raw.length, `${id}: HOOKCOUNT gate_log differs from the raw hook log (${raw.length})`);
    if (he) need(Number(he.rest.split(' ')[1]) === raw.filter((x) => x.reason === 'error').length, `${id}: HOOKERR differs from the raw hook log`);
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
      // spent is recomputed from the raw files of every earlier id of the arm: run.log result costs plus every saved probe response.
      const earlier = ids.filter((i2) => i2.startsWith(`${arm}-`) && ids.indexOf(i2) < ids.indexOf(id));
      const rawRuns = earlier.map((i2) => lastResultCost(read(path.join('runs', i2, 'run.log')) || '')).map((c) => (c === null ? 0 : c));
      const probeSpent = earlier.reduce((x, i2) => x + (probeRaw[i2] || 0), 0);
      const spentWant = rawRuns.reduce((x, y) => x + y, 0) + probeSpent;
      need(Math.abs(Number(kv.spent) - spentWant) < 5e-4, `${id}: COSTCHK spent ${kv.spent} differs from the raw files (${spentWant.toFixed(4)})`);
      const p = projectCost({ runCosts: rawRuns, probeSpent, total: m.n_per_arm, cap: m.arms[arm].cap, probeCost: m.probe_cost });
      need(kv.stage === p.stage && Number(kv.cap) === m.arms[arm].cap, `${id}: COSTCHK stage/cap (${kv.stage}/${kv.cap}) differ from the recomputed ${p.stage}/${m.arms[arm].cap}`);
      need(Math.abs(p.projected - Number(kv.projected)) < 5e-4 && !p.stop && r.rest.endsWith(' ok'), `${id}: COSTCHK projection ${kv.projected} differs from the recomputed ${p.projected.toFixed(4)} or exceeds the cap`);
    }
    if (r.kind === 'COST') {
      const kv = kvOf(r.rest); const id = idOf(r);
      const probeToDate = probeRows.filter(([pid]) => pid.startsWith(`${kv.arm}-`) && ids.indexOf(pid) <= ids.indexOf(id)).reduce((x, q) => x + Number(q[2]), 0);
      const p2 = projectCost({ runCosts: [...seen[kv.arm], Number(kv.run)], probeSpent: probeToDate, total: m.n_per_arm, cap: m.arms[kv.arm].cap, probeCost: m.probe_cost });
      need(Math.abs(p2.projected - Number(kv.projected)) < 5e-4, `${id}: COST projected ${kv.projected} differs from the recomputed ${p2.projected.toFixed(4)}`);
      seen[kv.arm].push(Number(kv.run)); probes[kv.arm] += Number(kv.probe);
    }
  }
  for (const id of ids) need(byId('COST', id).length === 1, `${id}: COST missing`);
  for (const id of ids) { const c0 = byId('COST', id)[0]; if (c0) { const rawCost = lastResultCost(read(path.join('runs', id, 'run.log')) || ''); need(rawCost !== null && Math.abs(Number(kvOf(c0.rest).run) - rawCost) < 1e-5, `${id}: COST run ${kvOf(c0.rest).run} differs from the last result object of run.log (${rawCost})`); } }
  for (const r of by('COST')) need(ids.includes(idOf(r)), `COST row for an unexpected id ${idOf(r)}`);
  for (const id of ids) {
    const cc = byId('COSTCHK', id), st = byId('START', id)[0];
    need(cc.length === 1, `${id}: need exactly one COSTCHK (got ${cc.length})`);
    need(cc.length === 1 && st && rows.indexOf(cc[0]) < rows.indexOf(st), `${id}: COSTCHK is not before the START`);
  }
  // Costs are finite, non-negative numbers (a negative run cost could hide spend behind a consistent running total).
  for (const r of by('COST')) { const kv = kvOf(r.rest); for (const k of ['run', 'probe']) need(/^\d+(\.\d+)?$/.test(kv[k] || '') && Number.isFinite(Number(kv[k])), `${idOf(r)}: COST ${k}=${kv[k]} is not a finite non-negative number`); }
  for (const [pid, , pc] of probeRows) need(/^\d+(\.\d+)?$/.test(pc || ''), `${pid}: probes.tsv cost ${pc} is not a finite non-negative number`);
  // Actual spend per arm, re-derived from every COST row and probes.tsv (not from the wrapper's own pre-launch checks).
  for (const arm of ['ON', 'C']) {
    const armIds = ids.filter((i) => i.startsWith(`${arm}-`));
    let runSum = 0;
    for (const id of armIds) {
      const c = byId('COST', id)[0];
      if (!c) continue;
      runSum += Number(kvOf(c.rest).run);
      need(Math.abs(Number(kvOf(c.rest).probe) - (probeRaw[id] || 0)) < 5e-6, `${id}: COST probe ${kvOf(c.rest).probe} differs from the sum of the saved probe responses (${(probeRaw[id] || 0).toFixed(6)})`);
      const probeSum = probeRows.filter(([pid]) => armIds.indexOf(pid) >= 0 && armIds.indexOf(pid) <= armIds.indexOf(id)).reduce((x, q) => x + Number(q[2]), 0);
      need(Math.abs(Number(kvOf(c.rest).running) - (runSum + probeSum)) < 5e-4, `${id}: COST running ${kvOf(c.rest).running} differs from the sum of runs and probes ${(runSum + probeSum).toFixed(4)}`);
    }
    // Every COST row counts toward its arm, expected id or not; an unknown or repeated id is itself a failure.
    const allRuns = by('COST').filter((r) => (kvOf(r.rest).arm || idOf(r).split('-')[0]) === arm).reduce((x, r) => x + (Number(kvOf(r.rest).run) || 0), 0);
    runSum = Math.max(runSum, allRuns);
    const total = runSum + probeRows.filter(([pid]) => pid.startsWith(`${arm}-`)).reduce((x, q) => x + Number(q[2]), 0);
    need(total <= m.arms[arm].cap, `${arm}: actual spend ${total.toFixed(4)} exceeds the cap ${m.arms[arm].cap}`);
  }
  // 14 prereg and hashes
  const pr = by('PREREG');
  need(pr.length >= 1 && pr.every((r) => r.rest.endsWith('ancestor=yes')), 'PREREG missing or not an ancestor of HEAD');
  // Re-check the preregistration now, not from what the wrapper logged at the start.
  if (!clone) fails.push('audit needs --clone to re-check the preregistration');
  else if (pr.length) {
    const ex = (opts && opts.exec) || ((a) => { const r = spawnSync(a[0], a.slice(1), { encoding: 'utf8', env: scrubEnv(process.env) }); return { status: r.status === null ? 124 : r.status, stdout: r.stdout || '' }; });
    const g = (a) => ex(['git', '-C', clone, ...a]);
    const mrel = path.relative(clone, (opts && opts.manifestPath) || '');
    const logged = (k) => { const h = by('HASH').filter((r) => r.rest.startsWith(`${k} `)); return h.length ? h[0].rest.split(' ')[1] : null; };
    for (const [what, rel, key] of [['PREREG note', m.prereg, 'prereg'], ['manifest', mrel, 'manifest'], ['taskhash baseline', m.taskhash_expected, 'taskhash_expected']]) {
      need(g(['ls-files', '--error-unmatch', rel]).status === 0, `${what} is no longer tracked`);
      need(g(['status', '--porcelain', '--', rel]).stdout.trim() === '', `${what} is modified`);
      let now = null; try { now = sha256(fs.readFileSync(path.join(clone, rel))); } catch (_e) { /* below */ }
      need(now !== null && now === logged(key), `${what} content hash differs from the value logged at the start`);
    }
    for (const prr of pr) { // every invocation's PREREG row is checked against git, not only the first
      const prCommit = prr.rest.split(' ')[0];
      need(g(['log', '-1', '--format=%H', '--', m.prereg]).stdout.trim() === prCommit, 'the logged PREREG commit is not the commit of the PREREG note');
      need(g(['log', '-1', '--format=%cI', prCommit]).stdout.trim() === prr.rest.split(' ')[1], 'the logged PREREG time differs from the commit time in git');
      need(g(['merge-base', '--is-ancestor', prCommit, 'HEAD']).status === 0, 'the recorded preregistration commit is not an ancestor of HEAD now');
      // The note as committed at the recorded commit is the one hashed at the start, and nothing was committed over it since.
      const atCommit = g(['show', `${prCommit}:${m.prereg}`]);
      need(atCommit.status === 0 && sha256(atCommit.stdout) === logged('prereg'), 'the PREREG note at the recorded commit does not hash to the value logged at the start');
      const since = g(['log', '--format=%H', `${prCommit}..HEAD`, '--', m.prereg, mrel, m.taskhash_expected]);
      need(since.status === 0 && since.stdout.trim() === '', 'PREREG note, manifest or task hash baseline was committed again after the recorded preregistration commit');
    }
  }
  const win = by('WINDOW_START')[0], firstStart = by('START')[0];
  if (pr.length && win && firstStart) {
    // The commit time comes from git now, not from the time string the wrapper logged.
    let prTime = NaN;
    if (clone) {
      const ex2 = (opts && opts.exec) || ((a) => { const r = spawnSync(a[0], a.slice(1), { encoding: 'utf8', env: scrubEnv(process.env) }); return { status: r.status === null ? 124 : r.status, stdout: r.stdout || '' }; });
      prTime = Date.parse(ex2(['git', '-C', clone, 'log', '-1', '--format=%cI', pr[0].rest.split(' ')[0]]).stdout.trim());
    }
    need(Number.isFinite(prTime) && prTime < Date.parse(win.ts) && prTime < Date.parse(firstStart.ts), 'the preregistration commit (time read from git) is not earlier than the window start and the first START');
    need(rows.indexOf(pr[0]) < rows.indexOf(firstStart), 'PREREG line is not before the first START');
  }
  {
    // Each HASH kind appears once per wrapper invocation, and every row equals the actual file (not only the first one).
    const nStart = by('WRAPPER_START').length;
    const fh = (f) => { try { return sha256(fs.readFileSync(f)); } catch (_e) { return null; } };
    const actual = { manifest: fh(opts && opts.manifestPath), prereg: fh(path.join(clone, m.prereg)), taskhash_expected: fh(path.join(clone, m.taskhash_expected)), hook: fh(path.join(clone, m.hook_path)), harness: fh(path.join(clone, m.harness_path)), wrapper: fh((opts && opts.wrapperPath) || __filename) };
    for (const k of Object.keys(actual)) {
      const h = by('HASH').filter((r) => r.rest.startsWith(`${k} `));
      need(h.length === nStart, `HASH ${k}: ${h.length} rows for ${nStart} wrapper invocations (each kind exactly once per invocation)`);
      need(h.every((r) => r.rest === `${k} ${actual[k]}`), `HASH ${k}: a row differs from the actual file`);
      if (m.hashes[k]) need(actual[k] === m.hashes[k], `HASH ${k}: the actual file differs from the preregistered value`);
    }
  }
  // The files themselves, hashed now: hook, harness, this wrapper (the file that is running, or --wrapper-file) and the manifest values.
  {
    const fh = (f) => { try { return sha256(fs.readFileSync(f)); } catch (_e) { return null; } };
    need(fh(path.join(clone, m.hook_path)) === m.hashes.hook, 'the hook file now differs from the preregistered sha256');
    need(fh(path.join(clone, m.harness_path)) === m.hashes.harness, 'the harness file now differs from the preregistered sha256');
    need(fh((opts && opts.wrapperPath) || __filename) === m.hashes.wrapper, 'the wrapper file differs from the preregistered sha256');
  }
  // no scratch path in the log
  need(!/(^|[\s=(\[])\/[^\s]+/m.test(logText.split('\n').map((l) => l.replace(/^\S+ /, '')).join('\n')), 'invocation.log contains an absolute path');
  need(!logText.includes(runDir), 'invocation.log contains the run directory');
  need(by('ABORT').length === 0 && by('REFUSE').length === 0, 'ABORT or REFUSE present');
  // Strict layer 2: the raw files are complete, parse in full, and the sets are exactly the expected ids.
  fails.push(...auditFiles(runDir, ids, order, m, endRcs(rows)));
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
    fs.writeFileSync(path.join(clone, 'PREREG.md'), 'prereg\n'); fs.writeFileSync(path.join(clone, 'hook.js'), 'hook\n'); fs.writeFileSync(path.join(clone, 'harness.sh'), 'harness\n');
    fs.writeFileSync(path.join(clone, 'expected.txt'), taskListing(taskDir));
    const n = 3;
    const m = {
      task: 'syn', model: 'claude-haiku-4-5', cli: '2.1.309 (Claude Code)', seed: 'selfcheck-seed', n_per_arm: n,
      arms: { ON: { gate: 'hook', cap: 30 }, C: { gate: 'observe', cap: 18 } }, probe_cost: 0.0166, window_s: 28800, min_complete: 2, max_blocks: 2,
      prereg: 'PREREG.md', taskhash_expected: 'expected.txt', hook_path: 'hook.js', harness_path: 'harness.sh', argv_sha: {},
      hashes: { wrapper: sha256(fs.readFileSync(wrapperPath)), hook: sha256('hook\n'), harness: sha256('harness\n'), taskhash_expected: sha256(fs.readFileSync(path.join(clone, 'expected.txt'))) },
    };
    const fakeOut = (argv) => argv[argv.indexOf('--out') + 1];
    const exec = (argv) => {
      const a = argv.slice(ENV_PREFIX.length); // drop the env -u .. prefix
      const home = a[0] && a[0].startsWith('HOME=') ? a.shift() : null;
      void home;
      if (a[0] === 'git') {
        const sub = a[3];
        if (sub === 'log') return { status: 0, stdout: a.includes('--format=%H') ? 'c0ffee0000000000000000000000000000000000\n' : '2026-01-01T00:00:00+00:00\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      }
      if (a[0] === 'claude') return { status: 0, stdout: '2.1.309 (Claude Code)\n', stderr: '' };
      if (a[0] === 'timeout') return { status: 0, stdout: JSON.stringify({ is_error: false, result: 'AUTH_OK', total_cost_usd: 0.0166 }), stderr: '' };
      if (a[0] === 'bash') {
        const o = fakeOut(a), arm = a[a.indexOf('--gate') + 1] === 'hook' ? 'ON' : 'C';
        const trace = a[a.indexOf('--hook-trace-dir') + 1];
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // a real harness call takes far longer than the 1 ms file clock granularity
        fs.mkdirSync(o, { recursive: true }); fs.mkdirSync(trace, { recursive: true });
        fs.writeFileSync(path.join(o, 'result.json'), JSON.stringify({ task_id: 'syn', arm: 'off', runner: 'cc', model: 'claude-haiku-4-5', runner_version: '2.1.309 (Claude Code)', turns: 5, turns_completed: 5 }));
        fs.writeFileSync(path.join(o, 'gate.jsonl'), '{"turn":1,"ok":true}\n');
        fs.writeFileSync(path.join(o, 'run.log'), `${JSON.stringify({ type: 'result', total_cost_usd: 0.5, modelUsage: { 'claude-haiku-4-5': {} } })}\n`);
        fs.writeFileSync(path.join(o, 'oracle.log'), '{"features_pass":true,"constraints_pass":true}\n');
        fs.writeFileSync(path.join(trace, 'trace-turn1.log'), '');
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
    fs.writeFileSync(path.join(clone, 'manifest.json'), JSON.stringify(m));
    const ctx = makeCtx({ runDir, clone, manifest: m, manifestPath: path.join(clone, 'manifest.json'), taskDir, wrapperPath, exec });
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
    const fails = audit(runDir, m, clone, { manifestPath: path.join(clone, 'manifest.json'), exec: (a) => ({ status: 0, stdout: a.includes('--format=%cI') ? '2026-01-01T00:00:00+00:00\n' : a.some((x) => x.endsWith('..HEAD')) ? '' : a.includes('--format=%H') ? 'c0ffee0000000000000000000000000000000000\n' : a.includes('show') ? 'prereg\n' : '' }) });
    say(`synthetic batch: ${2 * n} ids, wrapper rc=${code}, audit ${fails.length ? `FAIL (${fails.join('; ')})` : 'PASS'}`);
    bad += fails.length + (code === 0 ? 0 : 1);
    // Dry projection on the first five costs of the P1 rerun control (docs/plans/evidence/2026-10-24-per-turn-gate-p1-rerun/costs.tsv).
    const p1 = [0.552910, 0.457526, 0.591696, 0.500538, 0.627904];
    const dry = projectCost({ runCosts: p1, probeSpent: 5 * 0.0166, total: 30, cap: 18, probeCost: 0.0166 });
    say(`dry projection (C cap 18), C arm after the P1 rerun's first five run costs: spent=${dry.spent.toFixed(4)} projected=${dry.projected.toFixed(4)} cap=${dry.cap} -> ${dry.stop ? 'STOP_COST' : 'ok'} (mean ${mean(p1).toFixed(4)}, sample sd ${sampleSd(p1).toFixed(4)})`);
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
    if (['--selfcheck', '--audit', '--run', '--order', '--schema-table'].includes(a)) flags.add(a);
    else if (['--run-dir', '--clone', '--manifest', '--first', '--last', '--wrapper-file', '--credentials-source', '--parent-pid'].includes(a)) opt[a] = argv[++i];
    else { process.stderr.write(`unknown argument ${a}\n`); return 2; }
  }
  if (flags.has('--selfcheck')) return selfcheck(__filename);
  if (flags.has('--schema-table')) { process.stdout.write(schemaTable()); return 0; }
  if (!opt['--manifest']) { process.stderr.write('usage: --manifest M required\n'); return 2; }
  const manifest = JSON.parse(fs.readFileSync(opt['--manifest'], 'utf8'));
  if (flags.has('--order')) { makeOrder(manifest.seed, manifest.n_per_arm).forEach((o, i) => process.stdout.write(`${i + 1} ${o.id}\n`)); return 0; }
  if (!opt['--run-dir']) { process.stderr.write('usage: --run-dir D required\n'); return 2; }
  const runDir = path.resolve(opt['--run-dir']);
  if (flags.has('--audit')) {
    const clone = opt['--clone'] ? path.resolve(opt['--clone']) : null;
    const fails = audit(runDir, manifest, clone, { manifestPath: path.resolve(opt['--manifest']), wrapperPath: opt['--wrapper-file'] ? path.resolve(opt['--wrapper-file']) : undefined });
    for (const f of fails) process.stdout.write(`AUDIT FAIL: ${f}\n`);
    process.stdout.write(fails.length ? `AUDIT FAILED (${fails.length})\n` : 'AUDIT OK\n');
    return fails.length ? 1 : 0;
  }
  if (flags.has('--run')) {
    const nIds = 2 * manifest.n_per_arm;
    const rangeArg = (name) => { if (opt[name] === undefined) return 0; const v = Number(opt[name]); return Number.isInteger(v) && v >= 1 && v <= nIds ? v : -1; };
    const first = rangeArg('--first'), last = rangeArg('--last');
    if (first < 0 || last < 0 || (first && last && first > last)) { process.stderr.write(`usage: --first and --last must be integers from 1 to ${nIds}, first not after last\n`); return 2; }
    const clone = path.resolve(opt['--clone'] || process.cwd());
    fs.mkdirSync(runDir, { recursive: true });
    const ctx = makeCtx({ runDir, clone, manifest, manifestPath: path.resolve(opt['--manifest']), wrapperPath: __filename, parentPid: opt['--parent-pid'] ? Number(opt['--parent-pid']) : undefined, credSource: opt['--credentials-source'] ? path.resolve(opt['--credentials-source']) : undefined, taskDir: path.join(clone, 'evals', 'orchestration', 'tasks', manifest.task) });
    let code = 0;
    try { runBatch(ctx, first, last); } catch (e) {
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

/**
 * The batch is synchronous, so signal handlers cannot run inside it. It runs in a worker thread instead and this thread keeps the
 * handlers: the first TERM or INT raises the stop flag (safe pause: the running id finishes, the next one pauses with reason
 * operator_stop, a legal log that resumes); the second one ends the process at once (an interrupted batch that does not audit).
 */
function runInWorker() {
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  let code = 3, n = 0;
  for (const [name, c] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) process.on(name, () => { n++; if (n === 1) Atomics.store(flag, 0, 1); else process.exit(c); });
  const w = new Worker(__filename, { argv: process.argv.slice(2), workerData: { sab, p2batchWorker: true } });
  w.on('message', (m) => { code = m.code; });
  w.on('error', (e) => { process.stderr.write(`${e && e.stack}\n`); code = 3; });
  w.on('exit', () => { process.exitCode = code; });
}

if (!isMainThread && workerData && workerData.p2batchWorker) {
  // The batch worker started by runInWorker: decided by the thread and its data, not by require.main.
  STOP = new Int32Array(workerData.sab);
  parentPort.postMessage({ code: main(process.argv.slice(2)) });
} else if (require.main === module) {
  if (process.argv.includes('--run')) runInWorker(); else process.exitCode = main(process.argv.slice(2));
}

module.exports = { schemaTable, credExpiresAt, scrubEnv, LOG_SCHEMA, lastResultCost, harnessTimeoutMs, makeOrder, projectCost, harnessArgv, argvSha, jsonObjects, taskListing, audit, ROWS, parseLog };
