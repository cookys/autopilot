#!/usr/bin/env node
'use strict';

// runner-smoke.js — daily read-only smoke gate for engine CLIs in config/runner-pins.json.
//
// For each runner in config/runner-pins.json installed on this host (or --only <runner>),
// sends ONE short token prompt ("Reply with exactly the word PINEAPPLE-<6 random hex> and
// nothing else.") through the SAME read-only dispatch wrapper the rails use:
//   - scripts/dispatch-author.sh (scratch cwd, read-only posture, zero repo writes)
//   - scripts/lib/opencode-containment.js (locked review containment, empty non-git cwd,
//     event audit) for opencode, which dispatch-author.sh does not support.
//
// Pass = rail exit 0 AND unwrapped answer contains the token.
// Writes receipt JSON (schema "autopilot.runner-smoke/1") to:
//   $XDG_RUNTIME_DIR/autopilot/runner-smoke/<YYYY-MM-DD>.json
//   (fallback: ~/.autopilot/runner-smoke/<YYYY-MM-DD>.json)
//
// On a PASS for a runner, atomically appends {version, receipt_sha256, vetted_at}
// (idempotent per runner+version, temp+rename) to the host-local vetted overlay:
//   ${AUTOPILOT_RUNNER_VETTED_FILE:-$HOME/.autopilot/runner-vetted.json}
//   (schema "autopilot.runner-vetted/1")
// A FAIL never writes. --dry-run never writes.
//
// With --notify <fleet-addr>: on failure ONLY, runs:
//   fleet send <addr> "<one line per failed runner>"
// On all-pass (or --dry-run), sends nothing.
//
// Exit codes: 0 all pass (or --dry-run) | 1 any fail | 2 usage / invalid flag.
// Node built-ins only (Node >= 20.10).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  VETTED_OVERLAY_SCHEMA,
  DEFAULT_PINS_PATH,
  loadPinTable,
  resolveVettedPath,
  loadVettedOverlay,
  resolvePinBinary,
  probeRunnerVersion,
} = require('./lib/runner-pins.js');
const opencodeContainment = require('./lib/opencode-containment.js');
const { redactText } = require('./lib/ar-redact-rules.js');

const SMOKE_SCHEMA = 'autopilot.runner-smoke/1';
const DISPATCH_AUTHOR_SH = path.join(__dirname, 'dispatch-author.sh');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STDERR_TAIL_CHARS = 1500;
const STDOUT_TAIL_CHARS = 500;
const NOTIFY_STDERR_CHARS = 200;

// Cheap / non-frontier model per runner used only to prove the binary runs
// (never expensive tiers: fable, astra, carbon, or argon). Codex effort is
// pinned to "high" ONLY (never "xhigh").
const EXPENSIVE_SMOKE_MODEL_RE = /fable|astra|carbon|argon/i;

const RUNNER_SMOKE_TARGETS = Object.freeze({
  codex: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'codex',
    model: 'gpt-6.2-sol',
    effort: 'high',
  }),
  agy: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'agy',
    model: 'gemini-4-hydrogen-high',
    effort: 'high',
  }),
  claude: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'claude-native',
    model: 'haiku',
    effort: 'low',
  }),
  grok: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'grok',
    model: 'grok-4.7',
    effort: 'low',
  }),
  cursor: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'cursor',
    model: 'cursor-grok-4.6-low-fast',
    effort: 'low',
  }),
  kimi: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'kimi',
    model: 'kimi-code/k3',
    effort: 'low',
  }),
  opencode: Object.freeze({
    wrapper: 'opencode-containment',
    dispatch_runner: 'opencode',
    model: 'opencode-go/muse-spark-1.3-contributor',
    effort: 'low',
  }),
  qwen: Object.freeze({
    wrapper: 'dispatch-author',
    dispatch_runner: 'qwen',
    model: 'qwen3.6-plus',
    effort: 'low',
  }),
});

const GIT_REPO_ENV_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_SUPER_PREFIX',
  'GIT_INTERNAL_SUPER_PREFIX',
]);

function usage(code) {
  const text = [
    'Usage: node scripts/runner-smoke.js [options]',
    '',
    'Options:',
    '  --only <runner>        Run smoke only for the named installed runner.',
    '  --dry-run              Print the execution plan as JSON; invoke and write nothing.',
    '  --notify <fleet-addr>  On failure only, send one line per failed runner via `fleet send`.',
    '  --pins <path>          Override path to config/runner-pins.json.',
    '  --vetted <path>        Override host overlay path (else AUTOPILOT_RUNNER_VETTED_FILE or ~/.autopilot/runner-vetted.json).',
    '  --receipt-dir <dir>    Override receipt output directory.',
    '  --date <YYYY-MM-DD>    Override local date stamp for receipt filename.',
    '  --timeout <dur>        Per-runner dispatch timeout (default: 3m).',
    '  --fleet-bin <bin>      Override `fleet` executable name/path.',
    '  --install-timer        Render systemd user service and timer units into unit-dir.',
    '  --fleet-address <addr> Fleet address for --install-timer (else AUTOPILOT_FLEET_ADDRESS).',
    '  --unit-dir <dir>       Override systemd user unit dir (else XDG_CONFIG_HOME/systemd/user).',
    '  -h, --help             Print this help message.',
    '',
    'Exit: 0 all pass | 1 any runner failed | 2 usage or configuration error.',
  ].join('\n');
  (code === 0 ? process.stdout : process.stderr).write(`${text}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    only: null,
    dryRun: false,
    notify: null,
    pinsPath: DEFAULT_PINS_PATH,
    vettedPath: null,
    receiptDir: null,
    date: null,
    timeout: '3m',
    fleetBin: 'fleet',
    installTimer: false,
    fleetAddress: null,
    unitDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--only') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.only = argv[i + 1].trim();
      i += 1;
    } else if (arg === '--notify') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.notify = argv[i + 1].trim();
      i += 1;
    } else if (arg === '--pins') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.pinsPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--vetted') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.vettedPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--receipt-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.receiptDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--date') {
      if (i + 1 >= argv.length || !DATE_RE.test(argv[i + 1])) usage(2);
      opts.date = argv[i + 1];
      i += 1;
    } else if (arg === '--timeout') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.timeout = argv[i + 1].trim();
      i += 1;
    } else if (arg === '--fleet-bin') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.fleetBin = argv[i + 1].trim();
      i += 1;
    } else if (arg === '--install-timer') {
      opts.installTimer = true;
    } else if (arg === '--fleet-address') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.fleetAddress = argv[i + 1].trim();
      i += 1;
    } else if (arg === '--unit-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) usage(2);
      opts.unitDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      usage(0);
    } else {
      process.stderr.write(`runner-smoke: unknown argument: ${arg}\n`);
      usage(2);
    }
  }
  return opts;
}

function localDateString(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveReceiptDir(explicitDir, env = process.env) {
  if (explicitDir) return path.resolve(explicitDir);
  const xdg = env.XDG_RUNTIME_DIR;
  if (typeof xdg === 'string' && xdg.trim() !== '' && path.isAbsolute(xdg)) {
    return path.join(xdg, 'autopilot', 'runner-smoke');
  }
  return path.join(os.homedir(), '.autopilot', 'runner-smoke');
}

function resolveTargetSpec(runner, entry) {
  const base = RUNNER_SMOKE_TARGETS[runner];
  if (!base && !entry.smoke_model) {
    throw new Error(`no smoke model mapping configured for runner "${runner}"`);
  }
  const wrapper = entry.smoke_wrapper || (base ? base.wrapper : 'dispatch-author');
  const dispatchRunner = entry.dispatch_runner || (base ? base.dispatch_runner : runner);
  const model = entry.smoke_model || base.model;
  if (EXPENSIVE_SMOKE_MODEL_RE.test(model)) {
    throw new Error(
      `refusing expensive smoke model "${model}" for runner "${runner}" `
      + '(fable/astra/carbon/argon are reserved for hard problems, not smoke checks)',
    );
  }
  const effort = runner === 'codex' ? 'high' : (entry.smoke_effort || (base ? base.effort : 'low'));
  if (runner === 'codex' && effort !== 'high') {
    throw new Error(`codex smoke effort must be "high" (never xhigh); got "${effort}"`);
  }
  return {
    runner,
    bin: entry.bin,
    vetted: [...entry.vetted],
    wrapper,
    dispatch_runner: dispatchRunner,
    model,
    effort,
  };
}

function selectTargets(table, onlyRunner, env = process.env) {
  if (onlyRunner) {
    if (!Object.prototype.hasOwnProperty.call(table.runners, onlyRunner)) {
      throw new Error(`unknown runner "${onlyRunner}" (not in pin table)`);
    }
    const entry = table.runners[onlyRunner];
    if (!resolvePinBinary(onlyRunner, entry.bin, env)) {
      throw new Error(`runner "${onlyRunner}" is not installed on this host (binary "${entry.bin}" not found)`);
    }
    return [{ runner: onlyRunner, entry, target: resolveTargetSpec(onlyRunner, entry) }];
  }
  const out = [];
  for (const [runner, entry] of Object.entries(table.runners)) {
    if (!resolvePinBinary(runner, entry.bin, env)) continue;
    out.push({ runner, entry, target: resolveTargetSpec(runner, entry) });
  }
  return out;
}

function timeoutToMs(spec) {
  const raw = String(spec || '3m').trim();
  let m = /^(\d+)m$/.exec(raw);
  if (m) return Number(m[1]) * 60 * 1000;
  m = /^(\d+)s$/.exec(raw);
  if (m) return Number(m[1]) * 1000;
  m = /^(\d+)$/.exec(raw);
  if (m) return Number(m[1]) * 1000;
  return 180000;
}

function stripPseudoTtyChrome(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !line.startsWith('Script started on ') && !line.startsWith('Script done on '))
    .join('\n');
}

function redactTail(raw, maxChars) {
  const str = String(raw || '');
  if (str === '') return '';
  // Redact a wider window before slicing so a secret straddling the tail boundary cannot leak a suffix.
  const window = str.length > maxChars * 4 ? str.slice(-(maxChars * 4)) : str;
  const redacted = redactText(window).text;
  return redacted.length > maxChars ? redacted.slice(-maxChars) : redacted;
}

function formatSpawnError(err) {
  if (!err) return undefined;
  const code = err.code ? String(err.code) : '';
  const message = err.message ? String(err.message) : String(err);
  if (code && message) {
    return message.startsWith(code) ? message : `${code}: ${message}`;
  }
  return code || message || undefined;
}

function stripKnownNoiseLines(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('codeforge-collect:'))
    .join('\n');
}

function extractRunFailureDetails(run) {
  const details = {
    stderr_tail: redactTail(stripKnownNoiseLines(run && run.stderr), STDERR_TAIL_CHARS),
    stdout_tail: redactTail(run && run.stdout, STDOUT_TAIL_CHARS),
  };
  if (run && run.error) {
    const spawnError = formatSpawnError(run.error);
    if (spawnError !== undefined) {
      details.spawn_error = spawnError;
    }
  }
  return details;
}

// Last non-empty line of the CLI's combined output, redacted and cut to 200 chars.
// Only called for quota_exhausted / runner_failed so normal replies never reach a receipt.
function cliLastLine(run) {
  const combined = `${run && run.stdout ? run.stdout : ''}\n${run && run.stderr ? run.stderr : ''}`;
  const lines = combined.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '';
  return redactText(last).text.slice(0, 200);
}

function parseLastJsonObject(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (!t.startsWith('{') || !t.endsWith('}')) continue;
    try {
      return JSON.parse(t);
    } catch { /* try earlier line */ }
  }
  const trimmed = String(stdout || '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try { return JSON.parse(trimmed); } catch { /* ignore */ }
  }
  return null;
}

function mintSmokePrompt() {
  const hex = crypto.randomBytes(3).toString('hex');
  const token = `PINEAPPLE-${hex}`;
  const prompt = `Reply with exactly the word ${token} and nothing else.`;
  return { token, prompt };
}

function buildSmokeChildEnv(baseEnv, paths, runner) {
  const env = { ...(baseEnv || process.env) };
  delete env.AUTOPILOT_TOKEN_SEAT;
  delete env.AUTOPILOT_SESSION_ID;
  delete env.AUTOPILOT_CHILD_SESSION_ID;
  for (const k of GIT_REPO_ENV_VARS) delete env[k];
  env.TMPDIR = paths.childTmp;
  env.DISPATCH_QUIET = '1';
  env.DISPATCH_DETACH = '0';
  // Unattended probe, not repo work: the Fleet-Task gate exempts probe- callers (fleet-task-ref.js EXEMPT_CALLER_RE).
  env.AUTOPILOT_DISPATCH_ROLE = 'probe-runner-smoke';
  env.AUTOPILOT_DISPATCH_USAGE = 'off';
  env.AUTOPILOT_DISPATCH_MANIFEST = '0';
  env.AUTOPILOT_DISPATCH_RUNS_DIR = paths.runsDir;
  env.AUTOPILOT_SESSION_MODE_DIR = paths.sessionModeDir;
  env.AUTOPILOT_AUTHOR_MAX_TOKENS = '512';
  env.AUTOPILOT_SETTLE_MS = '250';
  return env;
}

function initScratchGitRepo(gitCwd, env) {
  fs.mkdirSync(gitCwd, { recursive: true, mode: 0o700 });
  const gitEnv = { ...env, GIT_CONFIG_NOSYSTEM: '1' };
  const res = spawnSync('git', ['init', '--quiet', gitCwd], {
    cwd: gitCwd,
    env: gitEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });
  if (res.error || res.status !== 0) {
    throw new Error(`scratch git init failed: ${res.stderr || (res.error && res.error.message) || res.status}`);
  }
}

function runDispatchAuthorSmoke(item, paths, opts) {
  const { runner, target } = item;
  const { token, prompt } = mintSmokePrompt();
  const promptFile = path.join(paths.scratchRoot, `prompt-${runner}.txt`);
  fs.writeFileSync(promptFile, prompt, { mode: 0o600 });

  const childEnv = buildSmokeChildEnv(process.env, paths, runner);
  const args = [
    DISPATCH_AUTHOR_SH,
    '--runner', target.dispatch_runner,
    '--model', target.model,
    '--effort', target.effort,
    '--timeout', opts.timeout,
    '--context-window', 'off',
    '--prompt-file', promptFile,
  ];
  const nodeTimeoutMs = timeoutToMs(opts.timeout) + 20000;
  const run = spawnSync('bash', args, {
    cwd: paths.gitCwd,
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: nodeTimeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });

  const parsed = parseLastJsonObject(run.stdout);
  let railExit;
  if (run.error && run.error.code === 'ETIMEDOUT') {
    railExit = 124;
  } else if (Number.isInteger(run.status)) {
    railExit = run.status;
  } else {
    railExit = 3;
  }

  const railClassification = (parsed && typeof parsed.status === 'string' && parsed.status)
    ? parsed.status
    : (railExit === 124 ? 'timeout' : (railExit === 6 ? 'quota_exhausted' : 'runner_failed'));

  let answer = '';
  if (parsed && typeof parsed.raw_log === 'string' && parsed.raw_log !== '') {
    try {
      const rawBytes = fs.readFileSync(parsed.raw_log, 'utf8');
      answer = stripPseudoTtyChrome(rawBytes);
    } catch { /* unreadable or absent raw_log */ }
  }

  const pass = railExit === 0 && railClassification === 'authored' && answer.includes(token);
  const outcome = {
    rail_exit: railExit,
    rail_classification: railClassification,
    pass,
  };
  if (!pass) {
    Object.assign(outcome, extractRunFailureDetails(run));
    if (railClassification === 'quota_exhausted' || railClassification === 'runner_failed') {
      outcome.cli_last_line = (parsed && typeof parsed.cli_last_line === 'string')
        ? parsed.cli_last_line
        : cliLastLine(run);
    }
  }
  return outcome;
}

function runOpencodeContainedSmoke(item, actualVersion, paths, opts) {
  const { runner, entry, target } = item;
  const binPath = resolvePinBinary(runner, entry.bin, process.env);
  if (!binPath) {
    return {
      rail_exit: 2,
      rail_classification: 'precondition_failed',
      pass: false,
    };
  }

  const { token, prompt } = mintSmokePrompt();
  const ocRoot = path.join(paths.scratchRoot, `oc-${runner}`);
  fs.mkdirSync(ocRoot, { recursive: true, mode: 0o700 });
  const childEnv = buildSmokeChildEnv(process.env, paths, runner);

  let plan;
  try {
    plan = opencodeContainment.buildPlan({
      bin: binPath,
      model: target.model,
      effort: target.effort,
      profile: 'review',
      root: ocRoot,
      baseEnv: childEnv,
      versionString: actualVersion || undefined,
    });
  } catch {
    return {
      rail_exit: 2,
      rail_classification: 'precondition_failed',
      pass: false,
    };
  }

  const planBreach = opencodeContainment.assertPlan(plan, { baseEnv: childEnv });
  if (planBreach) {
    return {
      rail_exit: 4,
      rail_classification: 'containment_breach',
      pass: false,
    };
  }

  const effectiveEnv = opencodeContainment.applyEnv(childEnv, plan.env);
  const run = spawnSync(binPath, plan.args, {
    input: prompt,
    cwd: plan.cwd,
    env: effectiveEnv,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutToMs(opts.timeout),
    maxBuffer: 16 * 1024 * 1024,
  });

  if (run.error && run.error.code === 'ETIMEDOUT') {
    return {
      rail_exit: 124,
      rail_classification: 'timeout',
      pass: false,
      ...extractRunFailureDetails(run),
    };
  }
  if (run.error || run.status !== 0) {
    return {
      rail_exit: Number.isInteger(run.status) && run.status !== 0 ? run.status : 3,
      rail_classification: 'runner_failed',
      pass: false,
      ...extractRunFailureDetails(run),
      cli_last_line: cliLastLine(run),
    };
  }

  const toolBreaches = opencodeContainment.auditEvents(run.stdout || '', plan.adaptor);
  if (toolBreaches.length > 0) {
    return {
      rail_exit: 4,
      rail_classification: 'containment_breach',
      pass: false,
      ...extractRunFailureDetails(run),
    };
  }

  const answer = opencodeContainment.extractText(run.stdout || '');
  if (!answer.trim()) {
    return {
      rail_exit: 1,
      rail_classification: 'empty_output',
      pass: false,
      ...extractRunFailureDetails(run),
    };
  }

  const pass = answer.includes(token);
  const outcome = {
    rail_exit: 0,
    rail_classification: 'authored',
    pass,
  };
  if (!pass) {
    Object.assign(outcome, extractRunFailureDetails(run));
  }
  return outcome;
}

function writeReceiptAtomic(receiptPath, doc) {
  const dir = path.dirname(receiptPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const bytes = `${JSON.stringify(doc, null, 2)}\n`;
  const tmpFile = `${receiptPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpFile, bytes, { mode: 0o600 });
  fs.renameSync(tmpFile, receiptPath);
  return crypto.createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function appendSmokePassesToOverlay(vettedPath, rows, receiptSha256, vettedAt) {
  const passed = rows.filter(
    (r) => r.pass === true && typeof r.version === 'string' && r.version.trim() !== '',
  );
  if (passed.length === 0) return false;
  const overlay = loadVettedOverlay(vettedPath, { allowMissing: true });
  const runners = { ...overlay.runners };
  let changed = false;
  for (const row of passed) {
    const current = Array.isArray(runners[row.runner]) ? [...runners[row.runner]] : [];
    if (!current.some((item) => item.version === row.version)) {
      current.push({
        version: row.version,
        receipt_sha256: receiptSha256,
        vetted_at: vettedAt,
      });
      runners[row.runner] = current;
      changed = true;
    }
  }
  if (!changed) return false;
  const outDoc = {
    schema: VETTED_OVERLAY_SCHEMA,
    runners,
  };
  const dir = path.dirname(vettedPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpFile = `${vettedPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(outDoc, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpFile, vettedPath);
  return true;
}

function notifyFailures(fleetBin, fleetAddr, failedRows) {
  const lines = failedRows.map((row) => {
    const line = `runner-smoke FAIL ${row.runner}: version=${row.version || 'missing'} rail_exit=${row.rail_exit} classification=${row.rail_classification} wall=${row.wall_seconds}s`;
    const stderrPreview = typeof row.stderr_tail === 'string'
      ? row.stderr_tail.slice(0, NOTIFY_STDERR_CHARS).replace(/[\r\n]+/g, ' ').trim()
      : '';
    if (stderrPreview) return `${line} stderr=${stderrPreview}`;
    const stdoutPreview = typeof row.stdout_tail === 'string'
      ? row.stdout_tail.slice(0, NOTIFY_STDERR_CHARS).replace(/[\r\n]+/g, ' ').trim()
      : '';
    return stdoutPreview ? `${line} stdout=${stdoutPreview}` : line;
  });
  const body = lines.join('\n');
  const env = { ...process.env };
  delete env.AUTOPILOT_TOKEN_SEAT;
  delete env.AUTOPILOT_SESSION_ID;
  delete env.AUTOPILOT_CHILD_SESSION_ID;
  const res = spawnSync(fleetBin, ['send', fleetAddr, body], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  if (res.error || res.status !== 0) {
    const detail = (res.stderr && res.stderr.trim()) || (res.error && res.error.message) || `rc=${res.status}`;
    process.stderr.write(`runner-smoke: fleet notify failed (${fleetAddr}): ${detail}\n`);
    return false;
  }
  return true;
}

function resolveUnitDir(explicitDir, env = process.env) {
  if (explicitDir) return path.resolve(explicitDir);
  const xdg = env.XDG_CONFIG_HOME;
  if (typeof xdg === 'string' && xdg.trim() !== '' && path.isAbsolute(xdg)) {
    return path.join(xdg, 'systemd', 'user');
  }
  return path.join(os.homedir(), '.config', 'systemd', 'user');
}

function renderSystemdUnits(repoRoot, fleetAddress) {
  const systemdDir = path.join(__dirname, 'systemd');
  const serviceTpl = fs.readFileSync(path.join(systemdDir, 'runner-smoke.service'), 'utf8');
  const timerTpl = fs.readFileSync(path.join(systemdDir, 'runner-smoke.timer'), 'utf8');
  const replaceAll = (text) => text
    .replace(/@REPO_PATH@/g, repoRoot)
    .replace(/@FLEET_ADDRESS@/g, fleetAddress);
  const service = replaceAll(serviceTpl);
  const timer = replaceAll(timerTpl);
  const unresolved = new Set();
  for (const text of [service, timer]) {
    const matches = text.match(/@[A-Z0-9_]+@/g);
    if (matches) {
      for (const m of matches) unresolved.add(m);
    }
  }
  if (unresolved.size > 0) {
    throw new Error(`unrendered placeholder(s) in unit template: ${[...unresolved].join(', ')}`);
  }
  return { service, timer };
}

function installTimer(opts) {
  const fleetAddress = (opts.fleetAddress || process.env.AUTOPILOT_FLEET_ADDRESS || '').trim();
  if (!fleetAddress) {
    process.stderr.write('runner-smoke: --install-timer requires @FLEET_ADDRESS@ (--fleet-address <addr> or AUTOPILOT_FLEET_ADDRESS)\n');
    process.exit(2);
  }
  const repoRoot = path.resolve(__dirname, '..');
  let rendered;
  try {
    rendered = renderSystemdUnits(repoRoot, fleetAddress);
  } catch (err) {
    process.stderr.write(`runner-smoke: ${err.message}\n`);
    process.exit(2);
  }
  const unitDir = resolveUnitDir(opts.unitDir, process.env);
  const servicePath = path.join(unitDir, 'runner-smoke.service');
  const timerPath = path.join(unitDir, 'runner-smoke.timer');
  if (opts.dryRun) {
    process.stdout.write(`# ${servicePath}\n${rendered.service}\n# ${timerPath}\n${rendered.timer}\n`);
  } else {
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(servicePath, rendered.service, { mode: 0o644 });
    fs.writeFileSync(timerPath, rendered.timer, { mode: 0o644 });
    process.stdout.write(`Installed ${servicePath}\nInstalled ${timerPath}\n`);
  }
  process.stdout.write('Next:\n  systemctl --user daemon-reload\n  systemctl --user enable --now runner-smoke.timer\n');
  process.exit(0);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.installTimer) {
    installTimer(opts);
    return;
  }
  const vettedPath = resolveVettedPath(opts.vettedPath, process.env);
  let table;
  let items;
  try {
    table = loadPinTable(opts.pinsPath);
    loadVettedOverlay(vettedPath, { allowMissing: true });
    items = selectTargets(table, opts.only);
  } catch (err) {
    process.stderr.write(`runner-smoke: ${err.message}\n`);
    process.exit(2);
  }

  const dateStr = opts.date || localDateString();
  const receiptDir = resolveReceiptDir(opts.receiptDir);
  const receiptPath = path.join(receiptDir, `${dateStr}.json`);

  if (opts.dryRun) {
    const planDoc = {
      schema: SMOKE_SCHEMA,
      dry_run: true,
      date: dateStr,
      receipt_path: receiptPath,
      vetted_path: vettedPath,
      notify: opts.notify,
      prompt_template: 'Reply with exactly the word PINEAPPLE-<6-hex> and nothing else.',
      runners: items.map(({ runner, target }) => ({
        runner,
        bin: target.bin,
        vetted: target.vetted,
        wrapper: target.wrapper,
        dispatch_runner: target.dispatch_runner,
        model: target.model,
        effort: target.effort,
      })),
    };
    process.stdout.write(`${JSON.stringify(planDoc, null, 2)}\n`);
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  const rows = [];

  let scratchRoot = '';
  try {
    scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-smoke-'));
    fs.chmodSync(scratchRoot, 0o700);
    const paths = {
      scratchRoot,
      childTmp: path.join(scratchRoot, 'tmp'),
      gitCwd: path.join(scratchRoot, 'git-cwd'),
      runsDir: path.join(scratchRoot, 'runs'),
      sessionModeDir: path.join(scratchRoot, 'session-mode'),
    };
    fs.mkdirSync(paths.childTmp, { recursive: true, mode: 0o700 });
    fs.mkdirSync(paths.runsDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(paths.sessionModeDir, { recursive: true, mode: 0o700 });
    initScratchGitRepo(paths.gitCwd, buildSmokeChildEnv(process.env, paths, 'init'));

    for (const item of items) {
      const t0 = process.hrtime.bigint();
      const verProbe = probeRunnerVersion(item.runner, item.entry);
      let outcome;
      if (!verProbe.ok) {
        outcome = {
          rail_exit: 2,
          rail_classification: 'precondition_failed',
          pass: false,
        };
      } else if (item.target.wrapper === 'opencode-containment') {
        outcome = runOpencodeContainedSmoke(item, verProbe.actual, paths, opts);
      } else {
        outcome = runDispatchAuthorSmoke(item, paths, opts);
      }
      const wallSeconds = Number(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(3);
      const row = {
        runner: item.runner,
        model: item.target.model,
        effort: item.target.effort,
        version: verProbe.actual,
        rail_exit: outcome.rail_exit,
        rail_classification: outcome.rail_classification,
        pass: outcome.pass,
        result: outcome.pass ? 'pass' : 'fail',
        wall_seconds: Number(wallSeconds),
      };
      if (!outcome.pass) {
        if (typeof outcome.stderr_tail === 'string') {
          row.stderr_tail = outcome.stderr_tail;
        }
        if (typeof outcome.stdout_tail === 'string') {
          row.stdout_tail = outcome.stdout_tail;
        }
        if (typeof outcome.cli_last_line === 'string') {
          row.cli_last_line = outcome.cli_last_line;
        }
        if (typeof outcome.spawn_error === 'string' && outcome.spawn_error !== '') {
          row.spawn_error = outcome.spawn_error;
        }
      }
      rows.push(row);
    }
  } finally {
    if (scratchRoot) fs.rmSync(scratchRoot, { recursive: true, force: true });
  }

  const failedRows = rows.filter((r) => !r.pass);
  const allPass = failedRows.length === 0;
  const finishedAt = new Date().toISOString();
  const receipt = {
    schema: SMOKE_SCHEMA,
    date: dateStr,
    started_at: startedAt,
    finished_at: finishedAt,
    ok: allPass,
    pass_count: rows.length - failedRows.length,
    fail_count: failedRows.length,
    runners: rows,
  };

  const receiptSha256 = writeReceiptAtomic(receiptPath, receipt);
  try {
    appendSmokePassesToOverlay(vettedPath, rows, receiptSha256, finishedAt);
  } catch (err) {
    process.stderr.write(`runner-smoke: failed to update vetted overlay: ${err.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ ...receipt, receipt_path: receiptPath }, null, 2)}\n`);

  if (!allPass && opts.notify) {
    notifyFailures(opts.fleetBin, opts.notify, failedRows);
  }

  process.exit(allPass ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SMOKE_SCHEMA,
  RUNNER_SMOKE_TARGETS,
  appendSmokePassesToOverlay,
  buildSmokeChildEnv,
  localDateString,
  parseArgs,
  resolveReceiptDir,
  resolveTargetSpec,
  selectTargets,
};
