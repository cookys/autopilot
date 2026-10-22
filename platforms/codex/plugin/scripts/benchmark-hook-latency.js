#!/usr/bin/env node
'use strict';

/**
 * P2 hook-latency measurement (mods visible dispatch plan, "P2 hook latency: measure first, do not move").
 *
 * Runs a fixed 20-tool-call `claude -p` workload against a detached checkout under three hook
 * configurations and reads every hook interval from `--debug-file` lines of the form
 *   Hooks: <Event>:<tool> [<command>] finished with status N (X ms)
 *
 *   enabled          every hook in the checkout's hooks/hooks.json, as shipped
 *   positive_control enabled + one PostToolUse marker hook (`sleep 0.2`)
 *   zero             no hooks; the arm is only trusted if --debug then shows zero hook lines
 *
 * Verdict rule per tool call (PreToolUse/PostToolUse only; a call = consecutive hook lines of one event, latency = their max):
 * enabled - zero p95 >= 150 ms AND >= 5 hook spawns per call -> open the guard-port plan, else no move.
 * Instrument is valid iff the marker's p95 (positive minus zero, zero being 0 by construction) >= 180 ms.
 * Refuses a verdict when: the zero arm still shows hook lines, the marker is not measured in the positive arm,
 * the marker is below 180 ms, or the run stopped early on --max-usd.
 * "enabled ~ zero" is a legitimate conclusion, not a broken instrument.
 *
 * Safety: every child gets a fresh mktemp CLAUDE_CONFIG_DIR holding only .credentials.json, a throwaway
 * HOME, a throwaway workload directory, and no AUTOPILOT_/CLAUDE_CODE session ids.
 * The real ~/.claude is never handed to a child.
 *
 * Exit codes: 0 conclusion written, 2 usage, 3 stopped on --max-usd, 4 conclusion refused.
 * Test hooks: BENCH_CLAUDE_BIN (claude executable), BENCH_CREDENTIALS (credentials source file).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TOOL_CALLS = 20;
const MARKER_CMD = 'sleep 0.2';
const MARKER_MIN_P95_MS = 180;
const DELTA_THRESHOLD_MS = 150;
const SPAWNS_THRESHOLD = 5;
const EST_USD_PER_RUN = 0.05; // rough planning number for --dry-run only; the real figure comes from total_cost_usd
const ARMS = ['enabled', 'positive_control', 'zero'];

function usage(code, msg) {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(
    'usage: benchmark-hook-latency.js --max-usd X [--samples N=30] [--out <path>] [--commit <ref>] '
    + '[--model haiku] [--dry-run]\n',
  );
  process.exit(code);
}

function parseArgs(argv) {
  const o = { samples: 30, model: 'haiku', commit: 'HEAD', dryRun: false, out: '.autopilot/evidence/hook-latency-baseline.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) usage(2, `${a} needs a value`); return argv[++i]; };
    if (a === '--samples') o.samples = Number(next());
    else if (a === '--max-usd') o.maxUsd = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--commit') o.commit = next();
    else if (a === '--model') o.model = next();
    else if (a === '--dry-run') o.dryRun = true;
    else usage(2, `unknown argument: ${a}`);
  }
  if (!Number.isInteger(o.samples) || o.samples < 1) usage(2, '--samples must be a positive integer');
  if (o.maxUsd === undefined) usage(2, '--max-usd is required');
  if (!Number.isFinite(o.maxUsd) || o.maxUsd <= 0) usage(2, '--max-usd must be a positive number');
  return o;
}

// ---- pure helpers (exported for reuse by tests of the parsing) --------------------------------------------

const HOOK_LINE = /Hooks: ([A-Za-z]+)(?::[^\s[]*)? \[(.*)\] finished with status (-?\d+) \((\d+(?:\.\d+)?)ms\)/;

function parseHookLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = HOOK_LINE.exec(line);
    if (m) out.push({ event: m[1], command: m[2], status: Number(m[3]), ms: Number(m[4]) });
  }
  return out;
}

function percentile(sorted, p) { // nearest rank
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

// A "call" is a maximal run of consecutive hook lines of one event: the workload makes its tool calls
// strictly one at a time and the hooks of one event run concurrently, so the call latency is the group's max.
function callGroups(lines) {
  const groups = [];
  for (const l of lines) {
    const g = groups[groups.length - 1];
    if (g && g.event === l.event) g.items.push(l.ms);
    else groups.push({ event: l.event, items: [l.ms] });
  }
  return groups;
}

function summarize(runs) { // runs: array of parsed-line arrays
  const per = {};
  const calls = {};
  for (const lines of runs) {
    for (const l of lines) (per[l.event] = per[l.event] || []).push(l.ms);
    for (const g of callGroups(lines)) (calls[g.event] = calls[g.event] || []).push({ max: Math.max(...g.items), n: g.items.length });
  }
  const res = {};
  for (const [ev, ms] of Object.entries(per)) {
    const s = ms.slice().sort((a, b) => a - b);
    const cg = calls[ev];
    const cs = cg.map((c) => c.max).sort((a, b) => a - b);
    res[ev] = {
      p50_ms: percentile(s, 50),
      p95_ms: percentile(s, 95),
      hook_count: s.length,
      spawns: Math.round((s.length / runs.length) * 100) / 100,
      calls: cg.length,
      call_p95_ms: percentile(cs, 95),
      spawns_per_call: Math.round((s.length / cg.length) * 100) / 100,
    };
  }
  return res;
}

function markerStats(runs) {
  const ms = [];
  for (const lines of runs) for (const l of lines) if (l.command.trim() === MARKER_CMD) ms.push(l.ms);
  ms.sort((a, b) => a - b);
  return { count: ms.length, p95: percentile(ms, 95) };
}

function conclude(raw, stoppedEarly) {
  const c = {
    refused: false, reason: null, instrument_valid: false, marker_p95_ms: 0,
    enabled_minus_zero_p95_ms: null, max_spawns_per_call: null, verdict: null,
  };
  const refuse = (reason) => { c.refused = true; c.reason = reason; return c; };
  if (stoppedEarly) return refuse('stopped_on_max_usd');
  const zeroLines = raw.zero.reduce((n, r) => n + r.length, 0);
  if (zeroLines > 0) return refuse('zero_arm_has_hook_lines');
  const marker = markerStats(raw.positive_control);
  if (marker.count === 0) return refuse('positive_control_not_measured');
  c.marker_p95_ms = marker.p95; // zero arm has no marker lines (checked above), so positive - zero = marker p95
  if (marker.p95 < MARKER_MIN_P95_MS) return refuse('instrument_invalid_marker_p95_below_180');
  c.instrument_valid = true;
  const en = summarize(raw.enabled);
  let delta = 0;
  let spawns = 0;
  // Per-call quantities on the tool-call events only: SessionStart/Stop run once per session, not per call.
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    if (!en[ev]) continue;
    delta = Math.max(delta, en[ev].call_p95_ms);
    spawns = Math.max(spawns, en[ev].spawns_per_call);
  }
  c.enabled_minus_zero_p95_ms = delta; // zero has no hook lines, so its p95 is 0 for every event
  c.max_spawns_per_call = spawns;
  c.verdict = delta >= DELTA_THRESHOLD_MS && spawns >= SPAWNS_THRESHOLD ? 'open_guard_port_plan' : 'no_move';
  return c;
}

// ---- workload ---------------------------------------------------------------------------------------------

function workloadFiles() {
  const f = {};
  for (let i = 1; i <= TOOL_CALLS; i++) {
    const n = String(i).padStart(2, '0');
    f[`f${n}.txt`] = `latency workload file ${n}\n`;
  }
  return f;
}

function workloadPrompt() {
  const names = Object.keys(workloadFiles()).join(', ');
  return `Make exactly ${TOOL_CALLS} tool calls, strictly one at a time and in this order: use the Read tool on each of `
    + `these files in the current directory: ${names}. Do not call any other tool and do not skip any file. `
    + 'After the last read, reply with the single word done.';
}

function workloadSha() {
  const h = crypto.createHash('sha256');
  h.update(workloadPrompt());
  for (const [k, v] of Object.entries(workloadFiles())) h.update(`\0${k}\0${v}`);
  return h.digest('hex');
}

function settingsFor(arm, checkout) {
  if (arm === 'zero') return { hooks: {} };
  const doc = JSON.parse(fs.readFileSync(path.join(checkout, 'hooks', 'hooks.json'), 'utf8'));
  const hooks = JSON.parse(JSON.stringify(doc.hooks || {}).split('${CLAUDE_PLUGIN_ROOT}').join(checkout));
  if (arm === 'positive_control') {
    (hooks.PostToolUse = hooks.PostToolUse || []).push({ matcher: '.*', hooks: [{ type: 'command', command: MARKER_CMD }] });
  }
  return { hooks };
}

// ---- execution ----------------------------------------------------------------------------------------------

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function detachedCheckout(ref, root) {
  const repo = git(['rev-parse', '--show-toplevel'], process.cwd());
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`], repo);
  const dest = path.join(root, 'checkout');
  git(['clone', '--local', '--no-checkout', '-q', repo, dest], repo);
  git(['checkout', '--detach', '-q', sha], dest);
  return { sha, dest };
}

function cleanEnv(home, configDir) {
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: configDir };
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_PARENT_SESSION_ID']) delete env[k];
  return env;
}

function runOnce(ctx, arm, remainingUsd) {
  let runDir;
  try {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-latency-run-'));
    const configDir = path.join(runDir, 'cfg');
    const home = path.join(runDir, 'home');
    fs.mkdirSync(configDir);
    fs.mkdirSync(home);
    fs.copyFileSync(ctx.credentials, path.join(configDir, '.credentials.json'));
    const settingsPath = path.join(ctx.root, `settings-${arm}.json`);
    fs.writeFileSync(settingsPath, JSON.stringify(settingsFor(arm, ctx.checkout)));
    const debugFile = path.join(ctx.root, `debug-${arm}-${crypto.randomBytes(4).toString('hex')}.log`);
    const budget = Math.max(0.01, Math.min(remainingUsd, 0.5));
    const r = spawnSync(ctx.claudeBin, [
      '-p', workloadPrompt(), '--model', ctx.model, '--settings', settingsPath, '--setting-sources', '',
      '--allowed-tools', 'Read', '--output-format', 'json', '--debug-file', debugFile,
      '--max-budget-usd', String(budget),
    ], { cwd: ctx.workDir, env: cleanEnv(home, configDir), encoding: 'utf8', input: '', timeout: 600000 });
    let cost = NaN;
    try { cost = Number(JSON.parse(r.stdout).total_cost_usd); } catch (_) { /* no JSON: handled below */ }
    // A child that died (timeout, signal, crash) or printed no readable cost may still have spent up to its
    // --max-budget-usd cap, so charge the cap: the stop-loss must not be bypassable by a missing cost.
    const costUnknown = r.status !== 0 || !Number.isFinite(cost);
    if (costUnknown) cost = budget;
    const text = fs.existsSync(debugFile) ? fs.readFileSync(debugFile, 'utf8') : '';
    return { ok: r.status === 0, cost, costUnknown, lines: parseHookLines(text), stderr: r.stderr };
  } finally {
    if (runDir) fs.rmSync(runDir, { recursive: true, force: true });
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const totalRuns = o.samples * ARMS.length;
  if (o.dryRun) {
    process.stdout.write(
      `plan: ${totalRuns} runs (${o.samples} samples x ${ARMS.length} arms: ${ARMS.join(', ')}), `
      + `${TOOL_CALLS} Read calls each, model ${o.model}, order interleaved per sample\n`
      + `workload_sha ${workloadSha()}\n`
      + `estimated cost ~ ${(totalRuns * EST_USD_PER_RUN).toFixed(2)} USD (planning figure ${EST_USD_PER_RUN}/run; `
      + `real cost comes from total_cost_usd); hard stop at --max-usd ${o.maxUsd}\n`,
    );
    return 0;
  }

  const credentials = process.env.BENCH_CREDENTIALS || path.join(os.homedir(), '.claude', '.credentials.json');
  if (!fs.existsSync(credentials)) usage(2, `credentials not found: ${credentials}`);
  let code = 0;
  let root;
  try {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-latency-'));
    const { sha, dest } = detachedCheckout(o.commit, root);
    const workDir = path.join(root, 'work');
    fs.mkdirSync(workDir);
    for (const [k, v] of Object.entries(workloadFiles())) fs.writeFileSync(path.join(workDir, k), v);
    const ctx = { root, checkout: dest, workDir, credentials, claudeBin: process.env.BENCH_CLAUDE_BIN || 'claude', model: o.model };

    const raw = { enabled: [], positive_control: [], zero: [] };
    let spent = 0;
    let stopped = null;
    let costUnknown = 0;
    outer:
    for (let s = 0; s < o.samples; s++) {
      for (const arm of ARMS) {
        if (spent >= o.maxUsd) { stopped = 'max_usd'; break outer; }
        const r = runOnce(ctx, arm, o.maxUsd - spent);
        spent += r.cost;
        if (r.costUnknown) costUnknown++;
        if (!r.ok) process.stderr.write(`warning: ${arm} sample ${s + 1} exited non-zero: ${r.stderr.slice(0, 200)}\n`);
        raw[arm].push(r.lines);
        process.stderr.write(`run ${arm} ${s + 1}/${o.samples}: ${r.lines.length} hook lines, cost ${r.cost.toFixed(4)}${r.costUnknown ? ' (unknown: cap charged)' : ''}, spent ${spent.toFixed(4)}\n`);
      }
    }
    const report = {
      commit: sha,
      workload_sha: workloadSha(),
      samples: o.samples,
      model: o.model,
      spent_usd: Math.round(spent * 1e6) / 1e6,
      max_usd: o.maxUsd,
      stopped,
      cost_unknown: costUnknown,
      arms: {},
      conclusion: null,
    };
    for (const arm of ARMS) report.arms[arm] = { runs: raw[arm].length, per_event: summarize(raw[arm].length ? raw[arm] : [[]]) };
    report.conclusion = conclude(raw, Boolean(stopped));
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`wrote ${o.out}; spent ${report.spent_usd} USD; conclusion ${report.conclusion.refused ? `REFUSED (${report.conclusion.reason})` : report.conclusion.verdict}\n`);
    if (stopped) { process.stderr.write(`stopped: --max-usd ${o.maxUsd} reached after spending ${report.spent_usd} USD\n`); code = 3; }
    else if (report.conclusion.refused) code = 4;
  } finally {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  return code;
}

if (require.main === module) process.exit(main());
module.exports = { parseHookLines, percentile, summarize, conclude };
