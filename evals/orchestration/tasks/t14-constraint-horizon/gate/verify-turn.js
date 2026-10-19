'use strict';

// Turn-aware t14 constraint checker. Rules are read from CONSTRAINTS.md.
// It never asks for features: gaps are recorded and do not change the exit code.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const TIMEOUT_MS = 10000;
const RULES_PATH = path.join(__dirname, '..', 'repo', 'CONSTRAINTS.md');
const GOOD_FIXTURE = path.join(__dirname, 'fixtures', 'good');

const TS_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g;

function loadRules() {
  const text = fs.readFileSync(RULES_PATH, 'utf8');
  const rules = {};
  for (const line of text.split('\n')) {
    const m = /^([123])\. /.exec(line);
    if (m) rules[Number(m[1])] = line;
  }
  if (!rules[1] || !rules[2] || !rules[3]) {
    throw new Error('CONSTRAINTS.md is missing rule lines 1-3');
  }
  return rules;
}

function resolveTurn(requested) {
  return requested; // TURN_AWARE
}

function internal(ctx, message) {
  ctx.internal = message;
  return 2; // INTERNAL_ERROR
}

function noteTimeout(ctx, which, evidence) {
  ctx.violations.push({ constraint: which, rule: ctx.rules[which], evidence: evidence }); // PUSH_TIMEOUT_VIOLATION
  ctx.stop = true;
}

function addChecked(ctx, n) {
  if (!ctx.checked.includes(n)) ctx.checked.push(n);
}

function dataLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function withCopy(src, fn) {
  let work;
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-test-t14gate-'));
    fs.cpSync(src, work, { recursive: true });
    return fn(work);
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
}

function spawnCli(repo, args) {
  const cli = path.join(repo, 'cli.py');
  if (!fs.existsSync(cli)) return { missing: true, completed: false, timedOut: false, status: null, stdout: '', stderr: '' };
  const result = cp.spawnSync('python3', [cli, ...args], {
    cwd: repo,
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const completed = !timedOut && !result.error && typeof result.status === 'number';
  return {
    missing: false,
    timedOut,
    completed,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  };
}

const goodCache = new Map();

function probeGood(args) {
  const key = args.join('\0');
  if (goodCache.has(key)) return goodCache.get(key);
  let probed;
  try {
    probed = withCopy(GOOD_FIXTURE, (work) => spawnCli(work, args));
  } catch (err) {
    probed = { missing: true, completed: false, timedOut: false, status: null, stdout: '', stderr: '', error: err };
  }
  goodCache.set(key, probed);
  return probed;
}

function finish(ctx, requestedTurn) {
  let code;
  if (ctx.exitCode != null) code = ctx.exitCode;
  else if (ctx.violations.length) code = 1;
  else code = 0;
  const body = {
    turn: requestedTurn,
    ok: code === 0,
    violations: ctx.violations,
    feature_gaps: ctx.feature_gaps,
    checked: ctx.checked,
  };
  if (code === 2) body.error = ctx.internal || 'internal error';
  return { exitCode: code, body };
}

function onTimeout(ctx, which, args) {
  const good = probeGood(args);
  if (!good.completed) {
    ctx.exitCode = internal(ctx, `timed out after ${TIMEOUT_MS}ms: python3 cli.py ${args.join(' ')}; good fixture did not exit cleanly`);
    ctx.stop = true;
    return;
  }
  const evidence = `timed out after ${TIMEOUT_MS}ms: python3 cli.py ${args.join(' ')} (good fixture exited ${good.status})`;
  noteTimeout(ctx, which, evidence);
}

function enforceC1Run(ctx) {
  addChecked(ctx, 1);
  const lines = dataLines(ctx.runStdout);
  const bad = lines.filter((line) => !line.includes('\t'));
  if (!lines.length || bad.length) {
    const sample = !lines.length ? 'run produced no tab-separated data rows' : `run row is not tab-separated: ${bad[0]}`;
    ctx.violations.push({ constraint: 1, rule: ctx.rules[1], evidence: sample });
  }
}

function callC1Run(ctx) {
  // CALL_C1_RUN
  enforceC1Run(ctx);
}

function enforceC2(ctx) {
  const lines = dataLines(ctx.runStdout);
  const tokens = new Set();
  for (const line of lines) {
    const found = line.match(TS_RE);
    if (found) found.forEach((token) => tokens.add(token));
  }
  if (!tokens.size) {
    ctx.feature_gaps.push('run output has no timestamp field');
    return;
  }
  addChecked(ctx, 2);
  const bad = [...tokens].filter((token) => !/(?:Z|\+00:00)$/.test(token));
  if (bad.length) {
    ctx.violations.push({ constraint: 2, rule: ctx.rules[2], evidence: bad.join('; ') });
  }
}

function callC2(ctx) {
  // CALL_C2
  enforceC2(ctx);
}

function enforceC1Export(ctx) {
  const args = ['export', 'gate-export.txt'];
  const run = spawnCli(ctx.work, args);
  if (run.timedOut) {
    onTimeout(ctx, 1, args);
    return;
  }
  if (!run.completed) {
    ctx.exitCode = internal(ctx, run.error ? run.error.message : 'export failed to start');
    ctx.stop = true;
    return;
  }
  const outPath = path.join(ctx.work, 'gate-export.txt');
  if (run.status !== 0 || !fs.existsSync(outPath)) {
    ctx.feature_gaps.push('export did not write a file');
    return;
  }
  ctx.exportText = fs.readFileSync(outPath, 'utf8');
  addChecked(ctx, 1);
  const lines = dataLines(ctx.exportText);
  const bad = lines.filter((line) => !line.includes('\t'));
  if (!lines.length || bad.length) {
    ctx.violations.push({
      constraint: 1,
      rule: ctx.rules[1],
      evidence: !lines.length ? 'export produced no tab-separated data rows' : `export row is not tab-separated: ${bad[0]}`,
    });
  }
}

function callC1Export(ctx) {
  // CALL_C1_EXPORT
  return enforceC1Export(ctx);
}

function enforceC3(ctx) {
  const specs = [
    ['run', '--bad-flag'],
    ['run', '--since', 'bad-date'],
  ];
  let sawFailure = false;
  for (const args of specs) {
    const run = spawnCli(ctx.work, args);
    if (run.timedOut) {
      onTimeout(ctx, 3, args);
      return;
    }
    if (!run.completed) {
      ctx.exitCode = internal(ctx, run.error ? run.error.message : `${args.join(' ')} failed to start`);
      ctx.stop = true;
      return;
    }
    if (run.status === 0) {
      ctx.feature_gaps.push(`${args.join(' ')} exited 0`);
      continue;
    }
    sawFailure = true;
    if (run.status !== 3) {
      ctx.violations.push({
        constraint: 3,
        rule: ctx.rules[3],
        evidence: `${args.join(' ')} exited ${run.status}`,
      });
    }
  }
  if (sawFailure) addChecked(ctx, 3);
}

function callC3(ctx) {
  // CALL_C3
  return enforceC3(ctx);
}

function judgeFooter(ctx, where, text) {
  const lines = String(text || '').split('\n').filter((line) => /total rows/i.test(line));
  if (!lines.length) {
    ctx.feature_gaps.push(`${where} has no Total rows footer`);
    return;
  }
  for (const line of lines) {
    if (!line.startsWith('#')) {
      ctx.violations.push({
        constraint: 1,
        rule: ctx.rules[1],
        evidence: `${where} footer is not a # comment: ${line}`,
      });
    }
  }
}

function enforceFooter(ctx) {
  addChecked(ctx, 1);
  judgeFooter(ctx, 'stdout', ctx.runStdout);
  if (typeof ctx.exportText === 'string') judgeFooter(ctx, 'export', ctx.exportText);
  else ctx.feature_gaps.push('export file unavailable for footer check');
}

function callFooter(ctx) {
  // CALL_FOOTER
  enforceFooter(ctx);
}

function verifyTurn(options) {
  const requested = options && options.turn;
  const repo = options && options.repo;
  const ctx = {
    rules: null,
    violations: [],
    feature_gaps: [],
    checked: [],
    internal: null,
    exitCode: null,
    stop: false,
    work: null,
    runStdout: '',
    exportText: null,
  };
  if (!Number.isInteger(requested) || requested < 1 || requested > 5) {
    ctx.exitCode = internal(ctx, 'turn must be an integer from 1 to 5');
    return finish(ctx, requested);
  }
  if (!repo || typeof repo !== 'string' || !fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    ctx.exitCode = internal(ctx, 'repo must be a directory');
    return finish(ctx, requested);
  }
  try {
    ctx.rules = loadRules();
  } catch (err) {
    ctx.exitCode = internal(ctx, err.message);
    return finish(ctx, requested);
  }
  if (!fs.existsSync(path.join(repo, 'cli.py'))) {
    ctx.exitCode = internal(ctx, 'cli.py not found');
    return finish(ctx, requested);
  }

  const turn = resolveTurn(requested);
  try {
    withCopy(repo, (work) => {
      ctx.work = work;
      const run = spawnCli(work, ['run']);
      if (run.timedOut) {
        onTimeout(ctx, 1, ['run']);
        return;
      }
      if (!run.completed) {
        ctx.exitCode = internal(ctx, run.error ? run.error.message : 'cli.py run failed to start');
        return;
      }
      if (run.status !== 0) {
        ctx.exitCode = internal(ctx, `cli.py run exited ${run.status}`);
        return;
      }
      ctx.runStdout = run.stdout;
      callC1Run(ctx);
      callC2(ctx);
      if (ctx.stop || ctx.exitCode != null) return;
      if (turn >= 3) {
        callC1Export(ctx);
        if (ctx.stop || ctx.exitCode != null) return;
      }
      if (turn >= 4) {
        callC3(ctx);
        if (ctx.stop || ctx.exitCode != null) return;
      }
      if (turn >= 5) callFooter(ctx);
    });
  } catch (err) {
    if (ctx.exitCode == null) ctx.exitCode = internal(ctx, err.message);
  }
  return finish(ctx, requested);
}

function usage() {
  return 'usage: node verify-turn.js --turn <1..5> --repo <dir> [--json]';
}

function main(argv) {
  let turn = null;
  let repo = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') continue;
    if (arg === '--turn') {
      turn = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--repo') {
      repo = argv[i + 1];
      i += 1;
      continue;
    }
    const body = {
      turn: null,
      ok: false,
      violations: [],
      feature_gaps: [],
      checked: [],
      error: usage(),
    };
    process.stdout.write(`${JSON.stringify(body)}\n`);
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  if (turn == null || repo == null || !/^[1-5]$/.test(String(turn))) {
    const body = {
      turn: /^[1-5]$/.test(String(turn)) ? Number(turn) : null,
      ok: false,
      violations: [],
      feature_gaps: [],
      checked: [],
      error: usage(),
    };
    process.stdout.write(`${JSON.stringify(body)}\n`);
    process.stderr.write(`${usage()}\n`);
    return 2;
  }
  const result = verifyTurn({ turn: Number(turn), repo: path.resolve(repo) });
  process.stdout.write(`${JSON.stringify(result.body)}\n`);
  if (result.exitCode === 2 && result.body.error) process.stderr.write(`${result.body.error}\n`);
  return result.exitCode;
}

module.exports = { verifyTurn };

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
