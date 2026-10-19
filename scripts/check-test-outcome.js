#!/usr/bin/env node
'use strict';
// check-test-outcome.js — decide whether a pushed SHA has a trustworthy "tests ran green" outcome.
//
// Usage:
//   node scripts/check-test-outcome.js --base <ref> --head <ref> [options]
//   node scripts/check-test-outcome.js --range <base>..<head> [options]
//   Options:
//     --root <dir>         repo to read (default: the repo containing this script)
//     --rerun sample|all|none   default sample
//     --sample <n>         extra non-direct suites in sample mode (default 20)
//     --budget-s <n>       re-run wall budget in seconds (default 600)
//     --seed <n>           deterministic sample (default: random)
//     --record-file <path> override the record path (tests). Default is
//                          <git-common-dir>/autopilot/qc-runs/<full-head-sha>.json
//     --help
//   Unknown option: stderr message, exit 2.
//
// The selection is recomputed with computeDoc from ./affected-suites.js. The record's own
// selected field is never read. Suites re-run serially (never in parallel) via entryCommand,
// in a detached worktree at the pushed SHA unless that SHA is the clean HEAD of --root.
// A red suite is not retried; flaky is always false.
//
// Stdout: exactly one JSON line, schema 1, keys in this order:
//   schema, verdict ("pass"|"refuse"|"unjudged"|"error"), code, head, base,
//   selected, recorded, rerun {mode, ran, planned, elapsed_s},
//   claimed_not_rederived, flaky, detail (string array).
//   code is "ok" for a plain pass. Other codes:
//     unjudged_full (exit 0), nothing_selected (exit 0),
//     record_missing (1), record_stale (1), recorded_red (1), selection_shortfall (1),
//     rerun_red (1), budget_exceeded (1),
//     worktree_failed (2), checker_error (2).
//   Exit 0 pass or deliberately unjudged. Exit 1 refuse. Exit 2 could not check
//   (the caller treats that as allow-but-loud).
// Stderr: a human line starting with "outcome gate:". A pass that did not re-run every
//   selected suite also prints "claimed, not re-derived: K of N suites".

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeDoc, isProse, entryCommand } = require('./affected-suites.js');

const ENV_STRIP = [
  'GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
  'AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID',
];

function childEnv() {
  const env = { ...process.env };
  for (const k of ENV_STRIP) delete env[k];
  // A checker launched by `node --test` inherits the runner channel. Leaving it
  // set makes a re-run `node --test` report itself as a worker and exit 0.
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  return env;
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    env: childEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26,
  });
}

function parseArgs(argv) {
  const a = { rerun: 'sample', sample: 20, budgetS: 600 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--root') a.root = argv[++i];
    else if (x === '--base') a.base = argv[++i];
    else if (x === '--head') a.head = argv[++i];
    else if (x === '--range') {
      const v = argv[++i];
      const idx = v == null ? -1 : v.indexOf('..');
      if (idx <= 0 || !v.slice(idx + 2)) throw new Error(`bad --range ${v}`);
      a.base = v.slice(0, idx);
      a.head = v.slice(idx + 2);
    } else if (x === '--rerun') a.rerun = argv[++i];
    else if (x === '--sample') a.sample = Number(argv[++i]);
    else if (x === '--budget-s') a.budgetS = Number(argv[++i]);
    else if (x === '--seed') a.seed = Number(argv[++i]);
    else if (x === '--record-file') a.recordFile = argv[++i];
    else if (x === '--help' || x === '-h') a.help = true;
    else throw new Error(`unknown option: ${x}`);
  }
  return a;
}

function sha7(s) {
  return (s && String(s).slice(0, 7)) || '???????';
}

function emit(obj, lines, code) {
  fs.writeSync(1, JSON.stringify(obj) + '\n');
  for (const line of lines) fs.writeSync(2, line.endsWith('\n') ? line : line + '\n');
  process.exit(code);
}

function verdict(fields, lines, code) {
  const obj = {
    schema: 1,
    verdict: fields.verdict,
    code: fields.code,
    head: fields.head,
    base: fields.base,
    selected: fields.selected,
    recorded: fields.recorded,
    rerun: fields.rerun,
    claimed_not_rederived: fields.claimed_not_rederived,
    flaky: false,
    detail: fields.detail || [],
  };
  emit(obj, lines, code);
}

function emptyRerun(mode) {
  return { mode, ran: 0, planned: 0, elapsed_s: 0 };
}

function makeRng(seed) {
  if (seed == null || Number.isNaN(seed)) return Math.random;
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pickSample(suites, chains, mode, n, rand) {
  if (mode === 'none') return [];
  if (mode === 'all') return suites.slice();
  const direct = [];
  const rest = [];
  for (const s of suites) {
    const c = chains[s];
    if (Array.isArray(c) && c.length === 2) direct.push(s);
    else rest.push(s);
  }
  const pool = rest.slice();
  const take = Math.min(Math.max(0, n), pool.length);
  const extra = [];
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    extra.push(pool[i]);
  }
  return direct.concat(extra);
}

function recordPath(root, sha, override) {
  if (override) return path.resolve(override);
  let common = git(root, ['rev-parse', '--git-common-dir']).trim();
  if (!path.isAbsolute(common)) common = path.resolve(root, common);
  return path.join(common, 'autopilot', 'qc-runs', `${sha}.json`);
}

function readRecord(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    throw e;
  }
  let obj;
  try { obj = JSON.parse(text); } catch { return { stale: true }; }
  if (!obj || typeof obj !== 'object' || obj.schema !== 1 || typeof obj.head !== 'string' || !Array.isArray(obj.suites)) {
    return { stale: true, head: obj && obj.head };
  }
  return { obj };
}

function removeWorktree(root, dir) {
  try { git(root, ['worktree', 'remove', '--force', dir]); } catch { /* still prune */ }
  try { git(root, ['worktree', 'prune']); } catch { /* best effort */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function prepareCwd(root, head) {
  let current = '';
  let clean = false;
  try {
    current = git(root, ['rev-parse', 'HEAD']).trim();
    clean = git(root, ['status', '--porcelain']).trim() === '';
  } catch { /* fall through to a detached worktree */ }
  if (current === head && clean) return { cwd: root, cleanup() {} };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-outcome-wt-'));
  try {
    git(root, ['worktree', 'add', '--detach', dir, head]);
  } catch (e) {
    removeWorktree(root, dir);
    const err = new Error('worktree_failed');
    err.cause = e;
    throw err;
  }
  return { cwd: dir, cleanup() { removeWorktree(root, dir); } };
}

function main(argv) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    process.stderr.write(`outcome gate: ${e.message}\n`);
    return 2;
  }
  if (a.help) {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n');
    const end = lines.findIndex((l, i) => i > 2 && l.startsWith('// Stdout:'));
    process.stdout.write(lines.slice(2, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return 0;
  }
  if (!a.base || !a.head) {
    process.stderr.write('outcome gate: need --base and --head, or --range <base>..<head>\n');
    return 2;
  }
  if (!['sample', 'all', 'none'].includes(a.rerun) || !Number.isFinite(a.sample) || !Number.isFinite(a.budgetS)) {
    process.stderr.write('outcome gate: bad --rerun, --sample, or --budget-s\n');
    return 2;
  }
  const root = path.resolve(a.root || path.join(__dirname, '..'));
  let head;
  let base;
  let doc;
  try {
    head = git(root, ['rev-parse', a.head]).trim();
    base = git(root, ['rev-parse', a.base]).trim();
    doc = computeDoc(root, base, head);
  } catch (e) {
    const lines = [
      'outcome gate: WARNING could not check (exit 2) - NOT enforced',
      `outcome gate: ${e.message}`,
    ];
    try {
      verdict({
        verdict: 'error', code: 'checker_error', head: a.head, base: a.base,
        selected: 0, recorded: 0, rerun: emptyRerun(a.rerun), claimed_not_rederived: 0, detail: [],
      }, lines, 2);
    } catch {
      process.stderr.write(lines.join('\n') + '\n');
      return 2;
    }
  }

  const selected = doc.suites;
  const rerunBase = emptyRerun(a.rerun);
  const common = {
    head, base, selected: selected.length, recorded: 0, rerun: rerunBase, claimed_not_rederived: selected.length, detail: [],
  };

  if (doc.mode === 'full') {
    const reason = (doc.full_reasons && doc.full_reasons[0]) || 'unjudgeable';
    verdict({
      ...common, verdict: 'unjudged', code: 'unjudged_full', claimed_not_rederived: 0,
    }, [
      `outcome gate: NOT JUDGED, selector returned full (${reason}); whole suite stays a pre-merge duty`,
    ], 0);
  }

  if (selected.length === 0) {
    const prose = doc.changed.every(isProse);
    if (prose) {
      verdict({ ...common, verdict: 'pass', code: 'nothing_selected', claimed_not_rederived: 0 }, [
        'outcome gate: nothing selected; every changed file is documentation',
        'claimed, not re-derived: 0 of 0 suites',
      ], 0);
    }
    verdict({ ...common, verdict: 'error', code: 'checker_error' }, [
      'outcome gate: WARNING could not check (exit 2) - NOT enforced',
      'outcome gate: selective selection is empty and not every changed file is documentation',
    ], 2);
  }

  let recInfo;
  try {
    recInfo = readRecord(recordPath(root, head, a.recordFile));
  } catch (e) {
    verdict({ ...common, verdict: 'error', code: 'checker_error' }, [
      'outcome gate: WARNING could not check (exit 2) - NOT enforced',
      `outcome gate: ${e.message}`,
    ], 2);
  }
  if (recInfo.missing) {
    verdict({ ...common, verdict: 'refuse', code: 'record_missing' }, [
      `outcome gate: no test run record for ${sha7(head)}. Fix: node scripts/affected-suites.js --base ${base} --head ${head} --run --record`,
    ], 1);
  }
  if (recInfo.stale || recInfo.obj.head !== head) {
    verdict({ ...common, verdict: 'refuse', code: 'record_stale' }, [
      `outcome gate: record is for ${sha7(recInfo.obj && recInfo.obj.head || recInfo.head)}, pushed ${sha7(head)} (amended or rebased since the run). Re-run.`,
    ], 1);
  }
  const record = recInfo.obj;
  common.recorded = record.suites.length;
  const failing = record.suites.filter((s) => s.rc !== 0).map((s) => s.path);
  if (failing.length) {
    verdict({ ...common, verdict: 'refuse', code: 'recorded_red', detail: failing }, [
      `outcome gate: recorded run has ${failing.length} failing suites: ${failing.join(' ')}`,
    ], 1);
  }
  const have = new Set(record.suites.map((s) => s.path));
  const missing = selected.filter((p) => !have.has(p));
  if (missing.length) {
    verdict({ ...common, verdict: 'refuse', code: 'selection_shortfall', detail: missing }, [
      `outcome gate: selector picks ${missing.length} suites the record does not list: ${missing.slice(0, 5).join(' ')}`,
    ], 1);
  }

  if (a.rerun === 'none') {
    verdict({
      ...common, verdict: 'pass', code: 'ok', claimed_not_rederived: selected.length,
      rerun: { mode: 'none', ran: 0, planned: 0, elapsed_s: 0 },
    }, [
      'outcome gate: pass',
      `claimed, not re-derived: ${selected.length} of ${selected.length} suites`,
    ], 0);
  }

  const sample = pickSample(selected, doc.chains, a.rerun, a.sample, makeRng(a.seed));
  const byRc = new Map(record.suites.map((s) => [s.path, s.rc]));
  let place;
  try {
    place = prepareCwd(root, head);
  } catch (e) {
    if (e.message === 'worktree_failed') {
      verdict({ ...common, verdict: 'error', code: 'worktree_failed' }, [
        'outcome gate: WARNING could not check (exit 2) - NOT enforced',
      ], 2);
    }
    verdict({ ...common, verdict: 'error', code: 'checker_error' }, [
      'outcome gate: WARNING could not check (exit 2) - NOT enforced',
      `outcome gate: ${e.message}`,
    ], 2);
  }

  const t0 = Date.now();
  let ran = 0;
  let stop = null;
  try {
    for (const rel of sample) {
      const elapsed = Math.floor((Date.now() - t0) / 1000);
      if (elapsed >= a.budgetS) {
        stop = {
          fields: {
            verdict: 'refuse', code: 'budget_exceeded',
            rerun: { mode: a.rerun, ran, planned: sample.length, elapsed_s: elapsed },
            claimed_not_rederived: selected.length - ran,
          },
          lines: [`outcome gate: re-ran ${ran} of ${sample.length} sampled suites in ${elapsed}s, budget hit; rest NOT re-derived`],
          code: 1,
        };
        break;
      }
      const spec = entryCommand(rel);
      if (!spec) {
        stop = {
          fields: {
            verdict: 'refuse', code: 'rerun_red', detail: [rel],
            rerun: { mode: a.rerun, ran, planned: sample.length, elapsed_s: elapsed },
            claimed_not_rederived: selected.length - ran,
          },
          lines: [`outcome gate: record claims green but ${rel} fails when re-run (rc=1)`],
          code: 1,
        };
        break;
      }
      const remainMs = Math.max(1, Math.floor((a.budgetS - (Date.now() - t0) / 1000) * 1000));
      const argv = spec.argv.slice();
      argv[argv.length - 1] = path.join(place.cwd, rel);
      const child = spawnSync(spec.cmd, argv, {
        cwd: place.cwd, env: childEnv(), timeout: remainMs, stdio: 'ignore',
      });
      if (child.error && child.error.code === 'ETIMEDOUT') {
        const elapsedHit = Math.floor((Date.now() - t0) / 1000);
        stop = {
          fields: {
            verdict: 'refuse', code: 'budget_exceeded',
            rerun: { mode: a.rerun, ran, planned: sample.length, elapsed_s: elapsedHit },
            claimed_not_rederived: selected.length - ran,
          },
          lines: [`outcome gate: re-ran ${ran} of ${sample.length} sampled suites in ${elapsedHit}s, budget hit; rest NOT re-derived`],
          code: 1,
        };
        break;
      }
      const rc = child.status == null ? 1 : child.status;
      ran += 1;
      const recordedRc = byRc.has(rel) ? byRc.get(rel) : 0;
      if (rc !== 0 || rc !== recordedRc) {
        const elapsedNow = Math.floor((Date.now() - t0) / 1000);
        stop = {
          fields: {
            verdict: 'refuse', code: 'rerun_red', detail: [rel],
            rerun: { mode: a.rerun, ran, planned: sample.length, elapsed_s: elapsedNow },
            claimed_not_rederived: selected.length - ran,
          },
          lines: [`outcome gate: record claims green but ${rel} fails when re-run (rc=${rc})`],
          code: 1,
        };
        break;
      }
    }
  } finally {
    place.cleanup();
  }
  if (stop) {
    verdict({ ...common, ...stop.fields }, stop.lines, stop.code);
  }

  const elapsed = Math.floor((Date.now() - t0) / 1000);
  const claimed = selected.length - ran;
  const lines = ['outcome gate: pass'];
  const fullRerun = a.rerun === 'all' && ran === selected.length;
  if (!fullRerun) lines.push(`claimed, not re-derived: ${claimed} of ${selected.length} suites`);
  verdict({
    ...common, verdict: 'pass', code: 'ok', claimed_not_rederived: claimed,
    rerun: { mode: a.rerun, ran, planned: sample.length, elapsed_s: elapsed },
  }, lines, 0);
}

try {
  const code = main(process.argv.slice(2));
  if (code) process.exit(code);
} catch (e) {
  try {
    emit({
      schema: 1, verdict: 'error', code: 'checker_error', head: null, base: null,
      selected: 0, recorded: 0, rerun: { mode: 'sample', ran: 0, planned: 0, elapsed_s: 0 },
      claimed_not_rederived: 0, flaky: false, detail: [],
    }, [
      'outcome gate: WARNING could not check (exit 2) - NOT enforced',
      `outcome gate: ${e.message}`,
    ], 2);
  } catch {
    process.stderr.write(`outcome gate: WARNING could not check (exit 2) - NOT enforced\n${e.message}\n`);
    process.exit(2);
  }
}
