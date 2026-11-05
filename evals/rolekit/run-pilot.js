#!/usr/bin/env node
'use strict';
// run-pilot.js -- the rolekit pilot cell runner. Node built-ins only. NOT part of the stamped set (prereg freeze_files
// lists files by name; this one is not listed), so adding it leaves `stamp-rolekit.js --row pilot --check` at rc 0.
//   run-pilot.js --account <alias> --out <dir> --model-weak <id> --model-strong <id> [--timeout 10m] [--cap-usd N]
//   run-pilot.js --dry-run --account <alias> --out <dir> [--scenario <json>]     (zero model calls, see below)
//
// What it does, per cell of the FROZEN schedule (score-rolekit.js schedule(): arm x seat x role x task x rep, 126 cells):
//   1. builds a fresh work dir from tasks/<role>/<task>/input in a temp dir under --out;
//   2. dispatches through an existing rail, always `--runner claude-native`, never `claude` directly:
//        roles whose kit tools line is empty (reviewer, verifier)  -> scripts/dispatch-author.sh (prompt + input appended, no cwd needed)
//        roles with tools (planner, implementer, debugger, explorer) -> scripts/dispatch-hetero.sh in a per-cell git repo (a worktree)
//      arm A and D pass no kit; arm B passes `--role-kit kits/<role>`; arm C passes `--role-kit placebo/<role>`;
//   3. takes the answer text from the rail (author: raw_log; hetero: agent_log), runs checks/check-cell.js
//      (rc 0 pass, 1 miss, 2 infra) and appends ONE row to <out>/results.jsonl in the format score-rolekit.js reads:
//      {role, task, rep, arm, seat, pass, infra, parse_ok, kit_applied, cost_usd} plus cost_source, check_rc, detail, attempts.
// Cells are run task-major (role, task, rep, arm A..D) so a stop leaves paired data. An infra cell is re-run once; a second
// infra stays infra (prereg exclusions). A B or C cell whose rail record does not match the compiled kit is infra (G2).
//
// Stops (nothing is retried after one): auth (rail result mentions STOP_AUTH / runner exited 6 / authentication) exit 6;
// quota (runner exited 4 / rate limit / quota) exit 4; the pilot cap (prereg cost.cap_usd, 15 USD; --cap-usd may only lower
// it) before a cell whose estimate would cross it, exit 5; the first-30-cells stop-loss (> 2x their share of the high
// estimate) exit 5; a rail precondition failure (e.g. the one-time claude-native owner confirmation is missing) exit 7. The
// stopping cell is NOT recorded, so a re-run resumes at it. Refusals before any cell exit 2: an API-key billing env var is
// set, `stamp-rolekit.js --row pilot --check` fails, the schedule digest differs from the one in <out>/run.json, --out is
// inside this root (a file there would change the G6 identity), a dry-run/real mix in one --out.
//
// Subscription only. --account names a G37 alias; the runner never reads, copies or prints credentials and never touches
// ~/.claude. The rails do not take an alias: the account layer picks one per call (claude-account.js pick). The runner
// checks `claude-account.js env-check --alias <alias>` (rc 0) before starting and records the alias; it cannot pin the pick.
//
// Cost (G5 needs a number on every row): cost_usd is the rail result's total_cost_usd when present (cost_source
// "rail_total_cost_usd"; current rails do not emit it), else the cost-model.json per-cell rate for the seat (haiku for
// weak1, sonnet_high for strong; cost_source "cost_model_rate"). cost-model.json has no per-token price and claude-native
// rail usage is null, so no token-based figure exists.
//
// --dry-run: same code path, with a stub `claude` (dry-run-stub.js, via --bin on the author rail and PATH for the hetero
// rail), a throwaway HOME/CLAUDE_CONFIG_DIR with FAKE credentials, and an empty accounts dir. The stub returns canned
// answers per cell (default scenario: explorer B/D pass, other cells miss, one infra cell, an auth stop on the last cell).
// It then runs `score-rolekit.js --row pilot` on the rows and prints the verdict.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { schedule, taskMapFrom } = require('./score-rolekit.js');
const { validateKit } = require('./compile-kit.js');

const ROOT = __dirname;
const REPO = path.resolve(ROOT, '../..');
const ARMS = ['A', 'B', 'C', 'D'];
const API_KEY_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_FOUNDRY_API_KEY', 'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE', 'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD'];
const EXIT = { DONE: 0, REFUSED: 2, QUOTA: 4, CAP: 5, AUTH: 6, PRECONDITION: 7 };

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const refuse = (m) => { const e = new Error(m); e.refusal = true; return e; };
const lastJsonLine = (s) => { const l = String(s).split('\n').filter((x) => x.startsWith('{')).pop(); return l ? JSON.parse(l) : null; };

function parseArgs(argv) {
  const val = new Set(['--account', '--out', '--model-weak', '--model-strong', '--timeout', '--cap-usd', '--scenario', '--roles']);
  const flag = new Set(['--dry-run']);
  const o = { timeout: '10m' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (flag.has(a)) o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true;
    else if (val.has(a)) { if (argv[i + 1] === undefined) throw refuse(`${a} needs a value`); o[a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[i + 1]; i += 1; } else throw refuse(`unknown option ${a}`);
  }
  if (!o.account || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(o.account)) throw refuse('--account <alias> is required (a G37 account alias)');
  if (!o.out) throw refuse('--out <dir> is required (outside evals/rolekit)');
  if (o.dryRun) { o.modelWeak = o.modelWeak || 'claude-haiku-4-5'; o.modelStrong = o.modelStrong || 'claude-sonnet-4-5'; }
  if (!o.modelWeak || !o.modelStrong) throw refuse('--model-weak and --model-strong are required (full model ids; pilot.json names the seats, not ids)');
  if (o.scenario && !o.dryRun) throw refuse('--scenario is only for --dry-run');
  if (o.capUsd !== undefined && !(Number(o.capUsd) > 0)) throw refuse('--cap-usd must be a positive number');
  return o;
}

function checkEnv(env) {
  const bad = API_KEY_ENV.find((k) => env[k] !== undefined && env[k] !== '');
  if (bad) throw refuse(`${bad} is set: this run is subscription only (no API-key billing); unset it`);
}

// ---- schedule
function loadPlan() {
  const prereg = JSON.parse(fs.readFileSync(path.join(ROOT, 'prereg/pilot.json'), 'utf8'));
  const taskMap = taskMapFrom(JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks/manifest.json'), 'utf8')));
  const keys = schedule(prereg, taskMap);
  const rank = (k) => { const [arm, , role, task, rep] = k.split('|'); return [prereg.design.roles.indexOf(role), taskMap[role].indexOf(task), Number(rep), ARMS.indexOf(arm)]; };
  const ordered = keys.slice().sort((a, b) => { const x = rank(a); const y = rank(b); for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return { prereg, taskMap, keys, ordered, digest: sha256(keys.slice().sort().join('\n')), preregSha: sha256(fs.readFileSync(path.join(ROOT, 'prereg/pilot.json'))) };
}
const parseKey = (k) => { const [arm, seat, role, task, rep] = k.split('|'); return { arm, seat, role, task, rep: Number(rep) }; };

// ---- cost
function costModel() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'cost-model.json'), 'utf8')).rates_usd_per_cell; }
function estimateUsd(seat, rates) { return seat === 'strong' ? rates.sonnet_high.usd : rates.haiku.usd; }
function costOf(result, seat, rates) {
  if (result && typeof result.total_cost_usd === 'number' && Number.isFinite(result.total_cost_usd) && result.total_cost_usd >= 0) return { usd: result.total_cost_usd, source: 'rail_total_cost_usd' };
  return { usd: estimateUsd(seat, rates), source: 'cost_model_rate' };
}

// ---- answers
function extractAnswer(text) {
  const t = String(text).trim();
  const ok = (s) => { try { JSON.parse(s); return true; } catch (e) { return false; } };
  if (ok(t)) return t;
  const fences = [...t.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1].trim()).reverse();
  for (const f of fences) if (ok(f)) return f;
  const end = t.lastIndexOf('}');
  for (const m of [...t.matchAll(/^\{/gm)].reverse()) if (end > m.index && ok(t.slice(m.index, end + 1))) return t.slice(m.index, end + 1);
  return t;
}
function stopKind(text) {
  if (/STOP_AUTH|runner exited 6\b|authentication|invalid[_ ]token|\b401\b/i.test(text)) return 'auth';
  if (/runner exited 4\b|rate.?limit|quota|usage limit|\b429\b/i.test(text)) return 'quota';
  return null;
}

// ---- kits
function kitFor(arm, role) { return arm === 'B' ? path.join(ROOT, 'kits', role) : arm === 'C' ? path.join(ROOT, 'placebo', role) : null; }
function transportFor(role) { return validateKit(path.join(ROOT, 'kits', role)).tools.length === 0 ? 'author' : 'hetero'; }
// The rails refuse an empty tools line (they want the word `none`); the frozen reviewer and verifier kits have an empty line.
// Such a kit is staged as a byte-for-byte copy with tools = "none"; everything else is passed as the frozen directory itself.
function railKitDir(kitDir, stageDir) {
  const v = validateKit(kitDir);
  if (v.tools.length > 0) return kitDir;
  fs.mkdirSync(stageDir, { recursive: true });
  fs.copyFileSync(path.join(kitDir, 'role.md'), path.join(stageDir, 'role.md'));
  fs.writeFileSync(path.join(stageDir, 'tools'), 'none\n');
  if (fs.existsSync(path.join(kitDir, 'plugin'))) fs.cpSync(path.join(kitDir, 'plugin'), path.join(stageDir, 'plugin'), { recursive: true });
  return stageDir;
}
function kitApplied(arm, role, rec) {
  const dir = kitFor(arm, role);
  if (!dir) return false;
  const v = validateKit(dir);
  return !!rec && rec.role_md_sha256 === sha256(fs.readFileSync(path.join(dir, 'role.md'))) && rec.tools === v.tools.join(',') && !!rec.plugin === !!v.plugin;
}

// ---- one attempt
function walkFiles(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) => (e.isDirectory() ? walkFiles(dir, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));
}
const GIT_ENV = { GIT_AUTHOR_NAME: 'rkrun', GIT_AUTHOR_EMAIL: ['rkrun', 'x.invalid'].join('@'), GIT_COMMITTER_NAME: 'rkrun', GIT_COMMITTER_EMAIL: ['rkrun', 'x.invalid'].join('@') };

function attempt(ctx, c, n) {
  const taskDir = path.join(ROOT, 'tasks', c.role, c.task);
  const cellId = `${c.arm}-${c.seat}-${c.role}-${c.task}-${c.rep}-${n}`;
  const tmp = fs.mkdtempSync(path.join(ctx.out, 'tmp', 'cell-'));
  const out = { stop: null, infra: null, row: null };
  try {
    const model = c.seat === 'strong' ? ctx.opts.modelStrong : ctx.opts.modelWeak;
    const kit = kitFor(c.arm, c.role);
    const kitArgs = kit ? ['--role-kit', railKitDir(kit, path.join(tmp, 'kit'))] : [];
    const transport = transportFor(c.role);
    let prompt = fs.readFileSync(path.join(taskDir, 'prompt.md'), 'utf8');
    const env = { ...ctx.env, ...(ctx.dry ? { RKRUN_CELL: `${c.arm}|${c.seat}|${c.role}|${c.task}|${c.rep}`, RKRUN_TASK_DIR: taskDir } : {}) };
    let r; let railOut; let answerText = ''; let workdir = null;
    if (transport === 'author') { // the input is appended to the prompt; the child has no cwd content
      for (const f of walkFiles(path.join(taskDir, 'input'))) prompt += `\n\n--- input/${f} ---\n${fs.readFileSync(path.join(taskDir, 'input', f), 'utf8')}`;
      const pf = path.join(tmp, 'prompt.txt'); fs.writeFileSync(pf, prompt);
      railOut = cp.spawnSync('bash', [path.join(REPO, 'scripts/dispatch-author.sh'), '--runner', 'claude-native', '--model', model, '--prompt-file', pf, '--timeout', ctx.opts.timeout, ...(ctx.dry ? ['--bin', ctx.stubBin] : []), ...kitArgs],
        { cwd: tmp, env, encoding: 'utf8', input: '', maxBuffer: 1 << 26 });
      r = lastJsonLine(railOut.stdout);
      if (r && r.status === 'authored' && r.raw_log) answerText = fs.readFileSync(r.raw_log, 'utf8');
    } else { // a per-cell git repo whose root commit is exactly the frozen input; the rail makes a worktree of it
      const repo = path.join(tmp, 'repo'); fs.mkdirSync(repo);
      const nested = c.role === 'planner' || c.role === 'explorer'; // those prompts say "the repository under input/"
      fs.cpSync(path.join(taskDir, 'input'), nested ? path.join(repo, 'input') : repo, { recursive: true });
      const git = (...a) => cp.execFileSync('git', ['-C', repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...a], { env: { ...process.env, ...GIT_ENV }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'base');
      const pf = path.join(tmp, 'prompt.txt'); fs.writeFileSync(pf, prompt);
      railOut = cp.spawnSync('bash', [path.join(REPO, 'scripts/dispatch-hetero.sh'), '--runner', 'claude-native', '--model', model, '--prompt-file', pf, '--branch', `rk/${cellId}`, '--base', 'main', '--timeout', ctx.opts.timeout, '--keep-worktree', '--retain-owner', 'rkrun', '--retain-reason', 'pilot-check-workdir', '--retain-until', String(Math.floor(Date.now() / 1000) + 3600), ...kitArgs],
        { cwd: repo, env, encoding: 'utf8', input: '', maxBuffer: 1 << 26 });
      r = lastJsonLine(railOut.stdout);
      if (r && ['committed', 'no_op', 'dirty'].includes(r.status) && r.agent_log) { answerText = fs.readFileSync(r.agent_log, 'utf8'); workdir = r.worktree; }
    }
    const failed = !r || !(r.status === 'authored' || ['committed', 'no_op', 'dirty'].includes(r.status));
    const cost = costOf(r, c.seat, ctx.rates);
    out.cost = cost;
    if (failed) {
      let logTail = ''; // the hetero rail keeps the runner's stderr in its agent log, not in its own result
      for (const f of [r && r.agent_log, r && r.raw_log]) { try { if (f) logTail += `\n${fs.readFileSync(f, 'utf8').slice(-2000)}`; } catch (e) { /* log gone */ } }
      const why = `${r ? `${r.status}: ${r.error || ''}` : 'no rail result'} ${railOut.stderr || ''}${logTail}`.slice(-6000);
      if (r && r.status === 'precondition_failed') { out.stop = { kind: 'precondition', why: why.trim() }; return out; }
      const k = stopKind(why);
      if (k) { out.stop = { kind: k, why: why.trim() }; return out; }
      out.infra = `rail ${r ? r.status : 'gave no result'}`; return out;
    }
    if (answerText.trim() === '') { out.infra = 'empty answer (no model output)'; return out; }
    out.kit_applied = ['B', 'C'].includes(c.arm) ? kitApplied(c.arm, c.role, r.role_kit) : false;
    if (['B', 'C'].includes(c.arm) && !out.kit_applied) { out.infra = 'kit not applied (rail role_kit record differs from the compiled kit)'; return out; }
    if (['A', 'D'].includes(c.arm) && r.role_kit) { out.infra = 'a kit was recorded on a no-kit arm'; return out; }
    const answerFile = path.join(ctx.out, 'answers', `${cellId}.json`); fs.writeFileSync(answerFile, extractAnswer(answerText));
    const chk = cp.spawnSync('node', [path.join(ROOT, 'checks/check-cell.js'), '--role', c.role, '--task-dir', taskDir, '--answer', answerFile, ...(workdir ? ['--workdir', workdir] : [])], { encoding: 'utf8' });
    let line = {}; try { line = JSON.parse(chk.stdout.trim().split('\n').pop()); } catch (e) { line = { detail: `check output unreadable: ${chk.stderr}` }; }
    out.check_rc = chk.status; out.parse_ok = line.parse_ok === true; out.detail = String(line.detail || '').slice(0, 300);
    if (chk.status === 2 || ![0, 1].includes(chk.status)) { out.infra = `check-cell rc ${chk.status}: ${out.detail}`; return out; }
    out.pass = chk.status === 0 ? 1 : 0;
    return out;
  } finally {
    if (out.worktreeCleanup) { /* none */ }
    try { const wt = path.join(tmp, 'repo'); if (fs.existsSync(wt)) cp.spawnSync('git', ['-C', wt, 'worktree', 'prune'], { stdio: 'ignore' }); } catch (e) { /* best effort */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runCell(ctx, c) {
  let cost = 0; let last = null;
  for (let n = 1; n <= 2; n += 1) {
    const a = attempt(ctx, c, n);
    cost += a.cost ? a.cost.usd : 0;
    if (a.stop) return { stop: a.stop, cost };
    last = a;
    if (!a.infra) break;
  }
  const infra = !!last.infra;
  return {
    cost,
    row: { role: c.role, task: c.task, rep: c.rep, arm: c.arm, seat: c.seat, pass: infra ? 0 : last.pass, infra, parse_ok: infra ? false : last.parse_ok, kit_applied: last.kit_applied === true,
      cost_usd: Math.round(cost * 1e6) / 1e6, cost_source: last.cost ? last.cost.source : 'cost_model_rate', check_rc: last.check_rc === undefined ? null : last.check_rc, detail: infra ? last.infra : last.detail, attempts: last.infra && cost > estimateUsd(c.seat, ctx.rates) * 1.0001 ? 2 : 1 },
  };
}

// ---- the run
function run(opts, env = process.env) {
  checkEnv(env);
  const out = path.resolve(opts.out);
  const rel = path.relative(ROOT, out);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw refuse('--out must be outside evals/rolekit (a file there changes the tested tree identity)');
  const chk = cp.spawnSync('node', [path.join(ROOT, 'stamp-rolekit.js'), '--row', 'pilot', '--check', '--root', ROOT], { encoding: 'utf8' });
  if (chk.status !== 0) throw refuse(`stamp-rolekit --row pilot --check failed: ${chk.stderr.trim()}`);
  const plan = loadPlan();
  const rates = costModel();
  const cap = Math.min(plan.prereg.cost.cap_usd, opts.capUsd === undefined ? Infinity : Number(opts.capUsd));
  fs.mkdirSync(path.join(out, 'tmp'), { recursive: true }); fs.mkdirSync(path.join(out, 'answers'), { recursive: true });
  const stateFile = path.join(out, 'run.json');
  const state = { schedule_sha256: plan.digest, prereg_sha256: plan.preregSha, dry_run: !!opts.dryRun, account: opts.account,
    known_deviations: [
      'dispatch-hetero.sh (claude-native) prepends a harness instruction ("only do file edits") to the prompt of every hetero-routed role (planner, implementer, debugger, explorer), identically on all four arms; reviewer and verifier go through dispatch-author.sh and do not get it',
      'reviewer and verifier kits have an empty tools line, which the rails refuse; they are dispatched from a byte-for-byte copy of the frozen kit with tools = none; kit_applied compares the frozen role.md sha256',
      '--account is checked (claude-account.js env-check --alias) and recorded, not pinned: the rails pick the account per call',
      'cost_usd is the rail total_cost_usd when present, else the cost-model.json per-cell rate; cost_source says which, per row'] };
  if (fs.existsSync(stateFile)) {
    const old = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (old.schedule_sha256 !== state.schedule_sha256 || old.prereg_sha256 !== state.prereg_sha256) throw refuse('the schedule digest in run.json differs from the frozen schedule: refusing to resume');
    if (old.dry_run !== state.dry_run) throw refuse('run.json belongs to a different mode (dry-run vs real): use another --out');
  } else fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);

  const ctx = { opts, out, rates, dry: !!opts.dryRun, env: { ...env, AUTOPILOT_DISPATCH_RUNS_DIR: path.join(out, 'rail-runs'), DISPATCH_QUIET: '1' } };
  fs.mkdirSync(ctx.env.AUTOPILOT_DISPATCH_RUNS_DIR, { recursive: true });
  if (ctx.dry) setupDry(ctx, plan);
  else {
    const ec = cp.spawnSync('node', [path.join(REPO, 'scripts/claude-account.js'), 'env-check', '--alias', opts.account], { env: ctx.env, encoding: 'utf8', input: '' });
    if (ec.status !== 0) throw refuse(`claude-account.js env-check --alias ${opts.account} failed (rc ${ec.status}); register the account first`);
  }

  const resultsFile = path.join(out, 'results.jsonl');
  const rows = fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
  const done = new Set(rows.map((r) => `${r.arm}|${r.seat}|${r.role}|${r.task}|${r.rep}`));
  let spent = rows.reduce((n, r) => n + r.cost_usd, 0);
  const summary = { dry_run: ctx.dry, account: opts.account, scheduled: plan.keys.length, skipped_already_recorded: 0, ran: 0, stopped: null, spent_usd: 0, cap_usd: cap };
  const share30 = (plan.prereg.cost.estimate_usd_high * 30) / plan.keys.length;
  const roleSet = opts.roles ? new Set(opts.roles.split(',')) : null;
  for (const key of plan.ordered) {
    if (done.has(key)) { summary.skipped_already_recorded += 1; continue; }
    const c = parseKey(key);
    if (roleSet && !roleSet.has(c.role)) continue; // --roles narrows the walk; the schedule digest and the other cells are untouched
    if (spent + estimateUsd(c.seat, rates) > cap) { summary.stopped = { kind: 'cap', at: key, why: `spent ${spent.toFixed(4)} + estimate would cross ${cap}` }; break; }
    if (rows.length >= 30 && rows.slice(0, 30).reduce((n, r) => n + r.cost_usd, 0) > 2 * share30 && !state.stoploss_waived) { summary.stopped = { kind: 'cap', at: key, why: 'stop-loss: the first 30 cells cost more than 2x their share of the high estimate' }; break; }
    const res = runCell(ctx, c);
    spent += res.cost;
    if (res.stop) { summary.stopped = { kind: res.stop.kind, at: key, why: res.stop.why.slice(0, 500) }; break; }
    fs.appendFileSync(resultsFile, `${JSON.stringify(res.row)}\n`);
    rows.push(res.row); done.add(key); summary.ran += 1;
  }
  summary.spent_usd = Math.round(spent * 1e6) / 1e6;
  summary.rows = rows.length;
  fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return { summary, resultsFile, rows };
}

// ---- dry run
function defaultScenario(plan) {
  const sc = {};
  const first = plan.ordered.find((k) => k.startsWith('A|') && k.includes('|reviewer|'));
  for (const k of plan.ordered) { const c = parseKey(k); if (c.role === 'explorer' && (c.arm === 'B' || c.arm === 'D')) sc[k] = 'pass'; }
  sc[first] = 'infra';
  sc[plan.ordered[plan.ordered.length - 1]] = 'auth';
  return sc;
}
function setupDry(ctx, plan) {
  const d = path.join(ctx.out, 'dry');
  for (const s of ['bin', 'home', 'claude', 'no-accounts', 'tmp']) fs.mkdirSync(path.join(d, s), { recursive: true });
  fs.writeFileSync(path.join(d, 'claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'FAKE-rkrun-dry-run-token' } }), { mode: 0o600 });
  ctx.stubBin = path.join(d, 'bin', 'claude');
  fs.writeFileSync(ctx.stubBin, `#!/bin/sh\nexec node ${JSON.stringify(path.join(ROOT, 'dry-run-stub.js'))} "$@"\n`, { mode: 0o755 });
  const scenario = ctx.opts.scenario ? JSON.parse(fs.readFileSync(ctx.opts.scenario, 'utf8')) : defaultScenario(plan);
  fs.writeFileSync(path.join(d, 'scenario.json'), JSON.stringify(scenario));
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_CONFIG_FILE']) delete ctx.env[k];
  Object.assign(ctx.env, { PATH: `${path.join(d, 'bin')}:${ctx.env.PATH}`, HOME: path.join(d, 'home'), CLAUDE_CONFIG_DIR: path.join(d, 'claude'), AUTOPILOT_ACCOUNTS_DIR: path.join(d, 'no-accounts'),
    TMPDIR: path.join(d, 'tmp'), AUTOPILOT_SETTLE_MS: '0', RKRUN_SCENARIO: path.join(d, 'scenario.json'), RKRUN_CALLS: path.join(d, 'calls.jsonl') });
  cp.spawnSync('node', [path.join(REPO, 'scripts/run-approval.js'), 'confirm-claude-native'], { env: ctx.env, stdio: 'ignore' }); // the throwaway HOME only
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    const { summary, resultsFile } = run(opts);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (opts.dryRun) {
      const sc = cp.spawnSync('node', [path.join(ROOT, 'score-rolekit.js'), '--row', 'pilot', '--results', resultsFile], { encoding: 'utf8' });
      process.stdout.write(`--- score-rolekit.js --row pilot (dry run, no evidence file: G6 is expected to fail) rc=${sc.status}\n${sc.stdout}${sc.stderr}`);
      process.exit(sc.status === 0 ? 0 : 2);
    }
    const k = summary.stopped && summary.stopped.kind;
    process.exit(k === 'auth' ? EXIT.AUTH : k === 'quota' ? EXIT.QUOTA : k === 'cap' ? EXIT.CAP : k === 'precondition' ? EXIT.PRECONDITION : EXIT.DONE);
  } catch (e) {
    if (e.refusal) { console.error(`run-pilot: refused: ${e.message}`); process.exit(EXIT.REFUSED); }
    throw e;
  }
}
if (require.main === module) main();
module.exports = { parseArgs, checkEnv, loadPlan, costOf, extractAnswer, stopKind, kitApplied, railKitDir, transportFor, defaultScenario, run, EXIT };
