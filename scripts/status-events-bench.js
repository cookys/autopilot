#!/usr/bin/env node
'use strict';
/**
 * status-events-bench.js - KR-A1.5 performance bench of `autopilot status events` (operator console A1 E4, plan step 4).
 *
 *   node scripts/status-events-bench.js [--scale N] [--keep] [--json]
 *
 * Builds a SYNTHETIC store in its own tempdir (never reads or writes a real source): 200 000 cost rows, 20 000 decision rows,
 * 20 000 run-ledger rows, 2 000 manifests and 500 review phases (--scale N divides every size by N for a quick smoke run; the
 * verdict is only meaningful at scale 1). Every read runs in a fresh child process so wall time and peak RSS are that read's own:
 *   cold   --since 0 --limit 1000                                     bound <= 8 s
 *   warm   resume from a cursor with hints, after live appends        bound <= 1.5 s, cost bytes read <= 5 % of the cost file
 *   binary the same warm resume through `node bin/autopilot.js status events --since <cursor> --json` (process start included)
 *   rss    peak RSS of every child                                    bound <= 256 MB
 * Prints wall time, peak RSS and the bytes each source read (counted by wrapping fs.openSync/readSync/readFileSync in the child).
 * Exit 0 when every bound holds, 1 when one does not, 2 on a usage error. Removes its tempdir unless --keep.
 * Reference: docs/dev/events-contract.md; plan KR-A1.5.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const BOUNDS = { coldSeconds: 8, warmSeconds: 1.5, warmCostFraction: 0.05, rssMb: 256 };
const SIZES = { cost: 200000, decision: 20000, runledger: 20000, manifests: 2000, phases: 500 };

// ---------------------------------------------------------------------------------------------------------------- child
function childMain(spec) {
  const byPath = new Map(); // fd -> path
  const bytes = {};
  const classify = (file) => {
    for (const [name, prefix] of spec.classes) if (String(file).startsWith(prefix)) return name;
    return 'other';
  };
  const add = (file, n) => { const k = classify(file); bytes[k] = (bytes[k] || 0) + n; };
  const realOpen = fs.openSync;
  const realRead = fs.readSync;
  const realReadFile = fs.readFileSync;
  fs.openSync = function openSync(file, ...rest) { const fd = realOpen.call(fs, file, ...rest); byPath.set(fd, String(file)); return fd; };
  fs.readSync = function readSync(fd, ...rest) { const n = realRead.call(fs, fd, ...rest); add(byPath.get(fd) || '', n); return n; };
  fs.readFileSync = function readFileSync(file, ...rest) {
    const out = realReadFile.call(fs, file, ...rest);
    if (typeof file === 'string') add(file, Buffer.byteLength(out));
    return out;
  };
  const { collectEvents } = require('../src/status/events');
  const t0 = process.hrtime.bigint();
  const page = collectEvents({ cwd: spec.cwd, env: spec.env, home: spec.env.HOME, since: spec.since, limit: spec.limit });
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  process.stdout.write(`${JSON.stringify({
    wall_ms: wallMs, rss_mb: process.resourceUsage().maxRSS / 1024, bytes, events: page.events ? page.events.length : 0,
    has_more: page.has_more, cursor: page.cursor, error: page.error || null, warnings: (page.warnings || []).map((w) => w.code),
  })}\n`);
}

// ------------------------------------------------------------------------------------------------------------ generator
function writeLines(file, count, make) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  try {
    let chunk = [];
    for (let i = 0; i < count; i += 1) {
      chunk.push(make(i));
      if (chunk.length >= 5000) { fs.writeSync(fd, `${chunk.join('\n')}\n`); chunk = []; }
    }
    if (chunk.length) fs.writeSync(fd, `${chunk.join('\n')}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

function generate(dir, scale) {
  const { buildFixture } = require('./lib/events-fixture');
  const fx = buildFixture({ dir });
  const n = (k) => Math.max(10, Math.floor(SIZES[k] / scale));
  const END = Date.parse('2026-11-02T00:00:00.000Z');
  const iso = (ms) => new Date(ms).toISOString();
  const spanAt = (i, count) => END - (count - i) * 20000; // one row per 20 s, ending at END
  const identity = fx.identity;

  // wipe the fixture's tiny sources: the bench store holds only synthetic rows
  for (const f of [fx.paths.costsFile, fx.paths.decisionLedger, fx.paths.workOrderLedger, fx.paths.runLedger, fx.paths.runLedgerRotated]) fs.rmSync(f, { force: true });
  fs.rmSync(fx.paths.runsDir, { recursive: true, force: true });
  for (const d of Object.values(fx.paths.reviewLedgers)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(fx.paths.reviewPointer, { force: true });

  const costN = n('cost');
  writeLines(fx.paths.costsFile, costN, (i) => JSON.stringify({
    ts: iso(spanAt(i, costN)), session: `s-bench-${i % 40}`, model: i % 3 ? 'claude-sonnet-5-5' : 'claude-fable-5',
    input_tokens: 1000 + (i % 700), output_tokens: 200 + (i % 90), cache_read_tokens: 8000 + (i % 1000), cache_write_tokens: 400 + (i % 50),
    cost_usd: Number((0.001 + (i % 97) / 10000).toFixed(5)), cwd: fx.repoDir,
  }));
  const decN = n('decision');
  writeLines(fx.paths.decisionLedger, decN, (i) => JSON.stringify({
    schema_version: 1, repo_identity: identity, root_run_id: null, ts: iso(spanAt(i, decN)), kind: 'decision', decision_id: `D-${i}`, round: 1,
    class: 'routine', rationale: `bench decision ${i}`, reversibility: 'two-way', refs: [],
  }));
  const runN = n('runledger');
  const manifestN = n('manifests');
  writeLines(fx.paths.runLedger, runN, (i) => JSON.stringify(i % 2
    ? { kind: 'stage', ts: iso(spanAt(i, runN)), run_id: `bench-run-${i % manifestN}`, stage: 'implement', state: 'running', generation: 1 + (i % 5), nonce: `n-${i}`, pid: 4242, reason: null }
    : { kind: 'heartbeat', ts: iso(spanAt(i, runN)), run_id: `bench-run-${i % manifestN}`, stage: 'implement', generation: 1 }));
  fs.mkdirSync(fx.paths.runsDir, { recursive: true });
  for (let i = 0; i < manifestN; i += 1) {
    const startMs = spanAt(i * Math.floor(costN / manifestN), costN);
    const m = {
      schema: 1, role: 'implementer', runner: 'codex', model: 'gpt-bench-1', base: 'main', base_sha: fx.commits.c1, run_id: `bench-run-${i}`,
      branch: `dispatch/bench-${i}`, worktree: path.join(dir, 'worktrees', `bench-run-${i}`), lock_path: path.join(dir, 'worktrees', `bench-run-${i}`, '.lock'),
      log_path: path.join(dir, 'logs', `bench-run-${i}.log`), log_format: 'codex-chrome', pid: 4242, containment_planned: 'plain',
      prompt_file: path.join(dir, 'prompts', `bench-run-${i}.md`), scaffold_tier: 'off', ledger: fx.paths.runLedger, stage: 'implement',
      started_at: iso(startMs).replace(/\.\d+Z$/, 'Z'), started_epoch: Math.floor(startMs / 1000),
      ended_at: iso(startMs + 600000).replace(/\.\d+Z$/, 'Z'), ended_epoch: Math.floor(startMs / 1000) + 600, final_status: 'success',
      parent_run_id: null, root_run_id: 'bench-root', depth: 0, timeout_seconds: 600, timeout_source: 'default', timeout_enforced: true,
      repo_identity: identity, repo_identity_source: 'git-common-dir',
    };
    fs.writeFileSync(path.join(fx.paths.runsDir, `bench-run-${i}.manifest.json`), `${JSON.stringify(m)}\n`);
  }
  // review phases: one ledger dir, half finalized
  const ledger = path.join(dir, 'ledgers', 'review-bench');
  const phaseN = n('phases');
  for (let p = 0; p < phaseN; p += 1) {
    const phase = `P${p}`;
    const collectedAt = iso(spanAt(p * Math.floor(costN / phaseN), costN));
    const phaseDir = path.join(ledger, `review-${phase}`);
    fs.mkdirSync(path.join(phaseDir, 'g1'), { recursive: true });
    fs.writeFileSync(path.join(ledger, `phase-${phase}.base`), `${fx.commits.c1}\n`);
    fs.writeFileSync(path.join(phaseDir, 'g1', 'findings.json'), `${JSON.stringify({ findings: [{ id: 'F-1', severity: 'Minor', seat_id: 'seat-a', text: 'bench finding' }] })}\n`);
    const entry = {
      generation: 1, base: fx.commits.c1, head: fx.commits.c3, seats: [{ id: 'seat-a', status: 'reviewed' }], reviewed_seats: 1, total_seats: 1,
      reviewed_seats_count: 1, total_seats_count: 1, status: p % 2 ? 'finalized' : 'pending', collected_at: collectedAt,
    };
    if (p % 2) {
      const dispositions = `${JSON.stringify({ schema_version: 1, phase, generation: 1, dispositions: [] })}\n`;
      fs.writeFileSync(path.join(phaseDir, 'g1', 'dispositions.json'), dispositions);
      entry.finalized_at = iso(Date.parse(collectedAt) + 60000);
      entry.dispositions_path = `review-${phase}/g1/dispositions.json`;
      entry.dispositions_sha256 = require('crypto').createHash('sha256').update(dispositions).digest('hex');
      fs.writeFileSync(path.join(ledger, `receipt-${phase}.json`), `${JSON.stringify({ kind: 'review', phase, phase_base_sha: fx.commits.c1, chain: [entry], verdict: 'SHIP-AS-IS', open_findings: [] })}\n`);
    }
    fs.writeFileSync(path.join(phaseDir, 'chain.json'), `${JSON.stringify([entry])}\n`);
  }
  return { fx, ledger, END, counts: { cost: costN, decision: decN, runledger: runN, manifests: manifestN, phases: phaseN } };
}

// live appends between the prime read and the warm resume (what a console sees between two polls)
function appendLive(fx, END) {
  const iso = (ms) => new Date(ms).toISOString();
  const costLines = [];
  for (let i = 1; i <= 100; i += 1) {
    costLines.push(JSON.stringify({ ts: iso(END + i * 1000), session: 's-live', model: 'claude-sonnet-5-5', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.001, cwd: fx.repoDir }));
  }
  fs.appendFileSync(fx.paths.costsFile, `${costLines.join('\n')}\n`);
  const decisions = [];
  for (let i = 1; i <= 10; i += 1) {
    decisions.push(JSON.stringify({ schema_version: 1, repo_identity: fx.identity, root_run_id: null, ts: iso(END + i * 1000), kind: 'decision', decision_id: `D-live-${i}`, round: 1, class: 'routine', rationale: 'live', reversibility: 'two-way', refs: [] }));
  }
  fs.appendFileSync(fx.paths.decisionLedger, `${decisions.join('\n')}\n`);
}

// ------------------------------------------------------------------------------------------------------------- runner
function runChild(spec) {
  const r = spawnSync(process.execPath, [__filename, '--child', JSON.stringify(spec)], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`child failed: ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout);
}

function main(argv) {
  if (argv[0] === '--child') { childMain(JSON.parse(argv[1])); return 0; }
  let scale = 1;
  let keep = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--keep') keep = true;
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '--scale' && /^[1-9][0-9]*$/.test(argv[i + 1] || '')) { scale = Number(argv[i + 1]); i += 1; }
    else { process.stderr.write(`usage: status-events-bench.js [--scale N] [--keep] [--json]\n`); return 2; }
  }
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-events-bench-'));
    const t0 = Date.now();
    const { fx, ledger, END, counts } = generate(dir, scale);
    const costBytes = fs.statSync(fx.paths.costsFile).size;
    const env = { ...fx.env, AUTOPILOT_EVENTS_REVIEW_LEDGERS: ledger };
    const classes = [['code', REPO], ['cost', fx.paths.costsFile], ['dispatch', fx.paths.runsDir], ['decision', path.dirname(fx.paths.decisionLedger)],
      ['runledger', path.dirname(fx.paths.runLedger)], ['review', path.join(dir, 'ledgers', 'review-bench')]];
    const base = { cwd: fx.repoDir, env, classes };
    const genSeconds = (Date.now() - t0) / 1000;

    const cold = runChild({ ...base, since: '0', limit: 1000 });
    // prime: a read by wall time near the end of the data gives a cursor with hints deep in the files
    const prime = runChild({ ...base, since: new Date(END - 3600000).toISOString(), limit: 1000 });
    appendLive(fx, END);
    const warm = runChild({ ...base, since: prime.cursor, limit: 1000 });
    // the same resume through the real binary (process start included)
    const b0 = process.hrtime.bigint();
    const bin = spawnSync(process.execPath, [path.join(REPO, 'bin', 'autopilot.js'), 'status', 'events', '--since', prime.cursor, '--json', '--limit', '1000'], { cwd: fx.repoDir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const binSeconds = Number(process.hrtime.bigint() - b0) / 1e9;
    const binBody = bin.status === 0 ? JSON.parse(bin.stdout) : null;

    const warmCost = warm.bytes.cost || 0;
    const fraction = warmCost / costBytes;
    const results = [
      ['cold --limit 1000 wall', cold.wall_ms / 1000, BOUNDS.coldSeconds, 's'],
      ['warm resume wall (in-process read)', warm.wall_ms / 1000, BOUNDS.warmSeconds, 's'],
      ['warm resume wall (real binary, incl. node start)', binSeconds, BOUNDS.warmSeconds, 's'],
      ['warm resume cost-file bytes / file bytes', fraction, BOUNDS.warmCostFraction, 'x'],
      ['peak RSS cold', cold.rss_mb, BOUNDS.rssMb, 'MB'],
      ['peak RSS warm', warm.rss_mb, BOUNDS.rssMb, 'MB'],
    ];
    const verdictOk = results.every(([, v, bound]) => v <= bound) && !cold.error && !warm.error && binBody && binBody.events.length === warm.events;
    const report = { scale, counts, cost_file_bytes: costBytes, generate_seconds: genSeconds, cold, warm: { ...warm, cursor: undefined }, binary: { seconds: binSeconds, status: bin.status, events: binBody ? binBody.events.length : null }, results: results.map(([name, value, bound]) => ({ name, value, bound, ok: value <= bound })), ok: verdictOk };
    if (json) { process.stdout.write(`${JSON.stringify(report)}\n`); return verdictOk ? 0 : 1; }
    const out = [];
    out.push(`status events bench (synthetic store, scale 1/${scale}${scale > 1 ? ', verdict not meaningful' : ''})`);
    out.push(`rows: cost ${counts.cost}, decision ${counts.decision}, runledger ${counts.runledger}, manifests ${counts.manifests}, review phases ${counts.phases}; cost file ${costBytes} bytes; generated in ${genSeconds.toFixed(1)} s`);
    for (const [label, r] of [['cold (--since 0 --limit 1000)', cold], ['prime (--since end-1h)', prime], ['warm (resume after 110 live appends)', warm]]) {
      out.push(`${label}: wall ${(r.wall_ms / 1000).toFixed(3)} s, peak RSS ${r.rss_mb.toFixed(1)} MB, events ${r.events}, has_more ${r.has_more}, bytes read ${JSON.stringify(r.bytes)}`);
    }
    out.push(`warm via real binary: wall ${binSeconds.toFixed(3)} s, exit ${bin.status}, events ${binBody ? binBody.events.length : 'n/a'}`);
    for (const [name, value, bound, unit] of results) out.push(`${value <= bound ? 'PASS' : 'FAIL'} ${name}: ${unit === 'x' ? value.toFixed(5) : value.toFixed(3)} ${unit === 'x' ? '' : unit} (bound ${bound}${unit === 'x' ? '' : ` ${unit}`})`.replace(/ +\(/, ' ('));
    out.push(`KR-A1.5: ${verdictOk ? 'MET' : 'NOT MET'}`);
    process.stdout.write(`${out.join('\n')}\n`);
    return verdictOk ? 0 : 1;
  } finally {
    if (dir && keep) process.stderr.write(`kept ${dir}\n`);
    else if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

process.exitCode = main(process.argv.slice(2));
