#!/usr/bin/env node
'use strict';
// lead-exam driver: runs ONE examinee through the 6 rounds (transcript replay, single-shot, no tools,
// 4 min per round, 24 min hard stop), writes the run record, and grades it when a judge is configured.
// Standalone measurement, not a qualification gate: no engine-qualify wiring, no qualification record.
//
//   node evals/lead-exam/run.js --dry-run --seed S --out-dir DIR
//   node evals/lead-exam/run.js --seed S --kind <cli kind> --model <id> --name <label> --out-dir DIR
//        [--config-dir DIR]   pre-seeded dedicated config dir; without it a fresh one is seeded from
//                             scripts/lib/seed-claude-config.js and removed afterwards
//        [--system-addendum FILE]   append the file text to the examinee system prompt (candidate-rule ON arm); path and sha256 go in the run record
//        [--judge-kind codex|agy --judge-model <id> [--judge-home DIR]]   also grade after the run
// --dry-run: stub examinee (the reference answers) and stub judge; no model call at all.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('./lib');
const fx = require('./fixtures');
const jd = require('./judge');
const { callProvider } = require('./transport');
const { gradeExam } = require('./grade');

const ROUND_TIMEOUT_MS = 4 * 60 * 1000;
const HARD_STOP_MS = 24 * 60 * 1000;
const KILL_WAIT_MS = 2000 + 1000; // transport kill grace + a margin
const KILL_GRACE_MS = 2000; // transport default (transport.js graceMs)

// LEAD_EXAM_* are test seams: each may only shorten a timer, never lengthen it past the production default.
// Unset or empty means the production default. Returns the effective values.
function resolveKnobs(env) {
  const knob = (k, prod) => {
    const raw = env[k];
    if (raw === undefined || raw === '') return prod;
    const v = Number(raw);
    if (!Number.isInteger(v) || v <= 0 || v > prod) {
      throw new Error(`${k}=${raw} must be a positive integer at or below the production default ${prod} ms`);
    }
    return v;
  };
  return {
    roundTimeoutMs: knob('LEAD_EXAM_ROUND_TIMEOUT_MS', ROUND_TIMEOUT_MS),
    hardStopMs: knob('LEAD_EXAM_HARD_STOP_MS', HARD_STOP_MS),
    graceMs: knob('LEAD_EXAM_KILL_GRACE_MS', KILL_GRACE_MS),
  };
}

// call: async (prompt, round, {timeoutMs, signal}) => {text, ms, in_tokens_est, out_tokens_est}
async function runExam(opts) {
  const items = opts.items || lib.loadItems();
  const now = opts.now || Date.now;
  const roundTimeout = opts.roundTimeoutMs || ROUND_TIMEOUT_MS;
  const hardStop = opts.hardStopMs || HARD_STOP_MS;
  const killWait = opts.killWaitMs || KILL_WAIT_MS;
  const started = now();
  const outputs = [];
  const rounds = [];
  for (let r = 1; r <= items.rounds.length; r += 1) {
    const rec = { round: r };
    if (now() - started >= hardStop) {
      outputs.push(''); rec.timed_out = true; rec.error = 'hard stop reached before this round'; rounds.push(rec); continue;
    }
    const remaining = hardStop - (now() - started);
    const timeoutMs = Math.min(roundTimeout, remaining);
    const prompt = lib.buildPrompt(items, opts.seed, r, outputs, opts.systemAddendum && opts.systemAddendum.text);
    rec.prompt_chars = prompt.length;
    rec.timeout_ms = timeoutMs;
    const ctl = new AbortController();
    let timer;
    const pending = Promise.resolve(opts.call(prompt, r, { timeoutMs, signal: ctl.signal }));
    try {
      const res = await Promise.race([
        pending,
        new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(Object.assign(new Error('round timeout'), { timeout: true })); }, timeoutMs); }),
      ]);
      outputs.push(res.text); rec.ms = res.ms; rec.in_tokens_est = res.in_tokens_est; rec.out_tokens_est = res.out_tokens_est;
      // the CLI's own numbers when it printed any; null otherwise (the *_est fields above are estimates, never merged in)
      const u = res.cli_usage;
      rec.usage = u ? {
        source: 'cli', input_tokens: u.input_tokens, output_tokens: u.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens || 0, cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      } : null;
    } catch (e) {
      outputs.push(''); rec.error = e.message; rec.timed_out = !!e.timeout || /timed? ?out/i.test(e.message); rec.ms = e.ms || null;
    } finally {
      clearTimeout(timer);
      // a timed-out call is only abandoned once its process group is dead (SIGTERM, then SIGKILL after the grace)
      if (ctl.signal.aborted) await Promise.race([pending.catch(() => {}), new Promise((res) => setTimeout(res, killWait))]);
    }
    rounds.push(rec);
  }
  return {
    schema: 'lead-exam-run/1', seed: opts.seed, name: opts.name, model: opts.model, kind: opts.kind || null,
    ...(opts.systemAddendum ? { system_addendum: { path: opts.systemAddendum.path, sha256: opts.systemAddendum.sha256 } } : {}),
    dry_run: !!opts.dry, outputs, rounds, usage_totals: lib.usageTotals(rounds), total_ms: now() - started,
  };
}

function seedConfigDir(parent) {
  const script = path.join(__dirname, '..', '..', 'scripts', 'lib', 'seed-claude-config.js');
  const r = spawnSync(process.execPath, [script, '--parent', parent], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`seed-claude-config failed: ${String(r.stderr).trim()}`);
  return r.stdout.trim();
}

// A caller-supplied --config-dir must be a dedicated throwaway dir: refuse (throw) when its real path is, or is inside,
// the real $HOME/.claude or $CLAUDE_CONFIG_DIR target, or when it holds anything but a regular .credentials.json.
function realOrResolved(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function checkConfigDir(dir, env) {
  const e = env || process.env;
  let real;
  try { real = fs.realpathSync(dir); } catch { throw new Error(`--config-dir ${dir} does not exist`); }
  if (!fs.statSync(real).isDirectory()) throw new Error(`--config-dir ${dir} is not a directory`);
  const home = e.HOME || os.homedir();
  if (real === realOrResolved(home)) throw new Error(`--config-dir ${dir} is the real $HOME; give a dedicated throwaway dir`);
  const realDirs = [path.join(home, '.claude')];
  if (e.CLAUDE_CONFIG_DIR) realDirs.push(e.CLAUDE_CONFIG_DIR);
  realDirs.map(realOrResolved).forEach((rd) => {
    if (isInside(real, rd)) throw new Error(`--config-dir ${dir} is, or is inside, the real Claude config dir; give a dedicated throwaway dir`);
  });
  fs.readdirSync(real).forEach((name) => {
    const st = fs.lstatSync(path.join(real, name));
    if (name !== '.credentials.json' || !st.isFile()) throw new Error(`--config-dir ${dir} holds ${name}; only a regular .credentials.json is allowed`);
  });
  return real;
}

function parseArgs(argv) {
  const a = {};
  const withValue = ['seed', 'kind', 'model', 'name', 'out-dir', 'config-dir', 'judge-kind', 'judge-model', 'judge-home', 'system-addendum'];
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--dry-run') a.dry = true;
    else if (k.startsWith('--') && withValue.includes(k.slice(2)) && argv[i + 1] !== undefined) { a[k.slice(2)] = argv[i + 1]; i += 1; }
    else { process.stderr.write(`run: unknown or incomplete argument ${k}\n`); process.exit(2); }
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let knobs;
  try { knobs = resolveKnobs(process.env); } catch (err) { process.stderr.write(`run: ${err.message}\n`); process.exit(2); }
  if (!a.seed || !a['out-dir']) { process.stderr.write('run: --seed and --out-dir are required\n'); process.exit(2); }
  if (a['config-dir']) {
    try { a['config-dir'] = checkConfigDir(a['config-dir']); } catch (err) { process.stderr.write(`run: ${err.message}\n`); process.exit(2); }
  }
  let systemAddendum = null;
  if (a['system-addendum']) {
    let text;
    try { text = fs.readFileSync(a['system-addendum'], 'utf8'); } catch (err) { process.stderr.write(`run: --system-addendum ${a['system-addendum']}: ${err.code || err.message}\n`); process.exit(2); }
    systemAddendum = { text, path: a['system-addendum'], sha256: crypto.createHash('sha256').update(text).digest('hex') };
  }
  const items = lib.loadItems();
  fs.mkdirSync(a['out-dir'], { recursive: true });
  let call; let name; let model; let cleanupDir = null; let cleanup = null;
  if (a.dry) {
    const gold = fx.goldOutputs(a.seed, items);
    call = async (prompt, round) => ({ text: gold[round - 1], ms: 0, in_tokens_est: Math.ceil(prompt.length / 4), out_tokens_est: Math.ceil(gold[round - 1].length / 4) });
    name = a.name || 'dry-run-reference'; model = 'stub';
  } else {
    if (!a.kind || !a.model) { process.stderr.write('run: live runs need --kind and --model\n'); process.exit(2); }
    let dir = a['config-dir'];
    if (!dir) { dir = seedConfigDir(os.tmpdir()); cleanupDir = dir; }
    const passEnv = { CLAUDE_CONFIG_DIR: dir };
    // LEAD_EXAM_* env vars are test seams only (stub provider, short timers); unset in real runs
    call = (prompt, _round, ctl) => callProvider(prompt, {
      kind: a.kind, model: a.model, timeoutMs: ctl.timeoutMs, signal: ctl.signal, passEnv,
      providerBin: process.env.LEAD_EXAM_PROVIDER_BIN || undefined, graceMs: knobs.graceMs,
    });
    name = a.name || a.model; model = a.model;
  }
  let record;
  try {
    record = await runExam({
      items, seed: a.seed, call, name, model, kind: a.kind, dry: a.dry, systemAddendum,
      roundTimeoutMs: knobs.roundTimeoutMs, hardStopMs: knobs.hardStopMs, killWaitMs: knobs.graceMs + 1000,
    });
  } finally {
    if (cleanupDir) {
      fs.rmSync(cleanupDir, { recursive: true, force: true });
      cleanup = { config_dir_removed: !fs.existsSync(cleanupDir) };
    }
  }
  if (cleanup) record.cleanup = cleanup;
  const runFile = path.join(a['out-dir'], `run-${name}.json`);
  fs.writeFileSync(runFile, `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`run record: ${runFile}\n`);
  if (a.dry || a['judge-kind']) {
    let judge; let jk = null; let jm = null;
    if (a.dry) judge = jd.stubJudge(items);
    else {
      jk = a['judge-kind']; jm = a['judge-model'];
      if (!['codex', 'agy'].includes(jk) || !jm) { process.stderr.write('run: --judge-kind codex|agy and --judge-model are both needed to grade\n'); process.exit(2); }
      const passEnv = a['judge-home'] ? { [jk === 'codex' ? 'CODEX_HOME' : 'QRP_CLI_HOME']: a['judge-home'] } : {};
      judge = (req) => callProvider(jd.buildJudgePrompt(req), { kind: jk, model: jm, timeoutMs: 720000, passEnv });
    }
    const report = await gradeExam({ items, seed: a.seed, runs: [record], judge, judgeKind: jk, judgeModel: jm, stub: !!a.dry });
    const reportFile = path.join(a['out-dir'], `report-${name}.json`);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`report: ${reportFile}\n`);
  }
}

if (require.main === module) main().catch((e) => { process.stderr.write(`run: ${e.message}\n`); process.exit(1); });
module.exports = { runExam, checkConfigDir, resolveKnobs };
