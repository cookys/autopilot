#!/usr/bin/env node
'use strict';
// suite-baseline.js -- compare the test suite before and after a repo move (3.0.0 relayout, F1).
// Node built-ins only. Nothing here executes a suite; it lists them, records a finished run, and diffs two records.
//
//   list    [--root <dir>] [--json]
//     Every suite id the current entry points would run: `scripts/affected-suites.js --list-all`
//     (the set hooks/tests/run.sh runs) plus each mods/*/run-tests.sh. scripts/tests/*.test.sh are
//     NOT listed: no entry point runs them today; they are reported as pending_join "P3" by `record`.
//
//   run-all [--root <dir>] [--ids <file>] [--pending] [--entry-timeout <secs>] [--jobs <N>]
//     Runs every listed suite one at a time (`.test.js` with `node --test`, `.sh` with `bash`, stdin
//     /dev/null, AUTOPILOT_SESSION_ID and CLAUDE_CODE_SESSION_ID removed) and prints each suite's output
//     followed by `rc=N <path>` (124 = timed out; default 1800 s). That stream is what `record` reads.
//     --ids: run only the ids in that file (one per line) instead of `list`; --pending: run the
//     scripts/tests/ suites instead. Use it before AND after a move so both sides are measured the same way.
//     --jobs N (BL-0353; default 1 = the one-at-a-time run above, output byte-for-byte unchanged; max 6 on this host
//     by convention): suites NOT listed in hooks/tests/lib/serial-suites.txt (the file run.sh and
//     affected-suites --jobs read) run up to N at a time; when the pool has drained, each listed suite runs alone,
//     one at a time, so nothing ever overlaps it. Every suite gets its own TMPDIR (/tmp/sbj.XXXXXX, removed after)
//     and, in the pool, a private XDG_RUNTIME_DIR (under the caller's when it has one, else inside that TMPDIR); AUTOPILOT_TEST_TIMING_FACTOR defaults to N for
//     pool suites and 1 for serial ones (a value already in the environment wins). A suite's output is buffered and
//     written whole, followed by its `rc=N <path>`, so outputs never interleave. A pool suite that exits non-zero
//     is re-run once, alone, after the pool drains (the rerun's output and rc are the ones printed):
//       green alone  -> `flaky-under-parallel: <path> (rc=P in pool)` (or `(timeout in pool)`) then `rc=0 <path>`
//       red again    -> `red-in-both-runs: <path> (rc=P in pool, rc=S alone)` then `rc=S <path>`
//     (same flaky line shape as `affected-suites.js --run --jobs`). A one-line tally goes to stderr.
//
//   record  --results <file> --out <baseline.json> [--pending-results <file>] [--root <dir>] [--flaky-as-green]
//     Reads the output of one full run. Accepted shapes:
//       (1) text from `affected-suites.js --run`: each suite's output followed by a `rc=N <path>` line
//           (mods runners may append the same line shape);
//       (2) the JSON record `affected-suites.js --record` writes ({schema:1, suites:[{path, rc}]}) --
//           counts are then null with reason "json_record_has_no_output".
//     Per suite it stores {rc, status:"pass"|"fail", count, count_reason?}. count = assertions/tests
//     parsed from the output ("tests N" of node --test, or "N passed"/"pass=N" plus failed); null when
//     no such line exists (count_reason says why). scripts/tests/*.test.sh found under --root are
//     stored with pending_join:"P3" and a `standalone` result taken from --pending-results (same shapes).
//     A suite carrying a `flaky-under-parallel:` line (red in the pool, green alone) is stored with
//     flaky_under_parallel:true and pool_rc, and by default status "fail" (conservative); --flaky-as-green
//     stores status "pass" instead. Either way each one is listed on stderr. A `red-in-both-runs:` line stores
//     red_in_both_runs:true and pool_rc (status already fail).
//
//   compare --baseline <a.json> --current <b.json> [--layout-map <map.json>] [--declared-new <ids.json>]
//     layout-map.json: { "<old path>": "<new path>" }  (exact repo-relative suite paths; a key ending in "/"
//     renames a directory prefix). declared-new.json: ["<new suite id>", ...].
//     Red when: a baseline suite (after layout-map) is missing, its status changed, its count decreased,
//     a current suite is neither mapped from the baseline nor declared new, or a declared-new id is absent.
//     The only free exception: a pending_join suite may be absent (it joins at P3); if present it is
//     compared like any other, against its standalone result.
//
// Exit: 0 consistent, 1 differences (one line each on stdout), 2 bad or missing input.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

class InputError extends Error {}

function readText(p, what) {
  if (!p) throw new InputError(`missing ${what} argument`);
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { throw new InputError(`cannot read ${what} ${p}: ${e.code || e.message}`); }
}
function readJson(p, what) {
  const t = readText(p, what);
  try { return JSON.parse(t); } catch (e) { throw new InputError(`${what} ${p} is not valid JSON: ${e.message}`); }
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--pending') o.pending = true;
    else if (a === '--flaky-as-green') o['flaky-as-green'] = true;
    else if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new InputError(`${a} needs a value`);
      o[a.slice(2)] = v; i++;
    } else throw new InputError(`unexpected argument ${a}`);
  }
  return o;
}

function listSuites(root) {
  let out;
  try {
    out = cp.execFileSync(process.execPath, [path.join(root, 'scripts/affected-suites.js'), '--root', root, '--list-all'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { throw new InputError(`affected-suites --list-all failed under ${root}: ${e.message}`); }
  const ids = out.split('\n').map((s) => s.trim()).filter(Boolean);
  const modsDir = path.join(root, 'mods');
  if (fs.existsSync(modsDir)) {
    for (const d of fs.readdirSync(modsDir).sort()) {
      const rel = `mods/${d}/run-tests.sh`;
      if (fs.existsSync(path.join(root, rel))) ids.push(rel);
    }
  }
  return [...new Set(ids)].sort();
}

function pendingSuites(root) {
  const d = path.join(root, 'scripts/tests');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /\.test\.(sh|js)$/.test(f)).sort().map((f) => `scripts/tests/${f}`);
}

function parseCount(id, text) {
  if (text == null) return { count: null, reason: 'json_record_has_no_output' };
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  if (/\.test\.js$/.test(id)) {
    const m = [...clean.matchAll(/^ℹ tests (\d+)\s*$/gm)];
    if (m.length) return { count: Number(m[m.length - 1][1]) };
  }
  const last = (re) => { const m = [...clean.matchAll(re)]; return m.length ? Number(m[m.length - 1][1]) : null; };
  const pass = last(/(\d+) passed\b/g) ?? last(/\bPASS \[[^\]]*\] (\d+) assertions/g) ?? last(/\bpass(?:ed)?[=:]\s*(\d+)/gi);
  const fail = last(/(\d+) failed\b/g) ?? last(/\bfail(?:ed)?[=:]\s*(\d+)/gi);
  const nodeTests = last(/^ℹ tests (\d+)\s*$/gm);
  if (pass !== null) return { count: pass + (fail || 0) };
  if (nodeTests !== null) return { count: nodeTests };
  return { count: null, reason: 'no_count_line' };
}

// -> Map id -> {rc, text|null}
function parseResults(file, what) {
  const raw = readText(file, what);
  const out = new Map();
  const marks = new Map(); // id -> {flaky|both, pool_rc}
  const add = (id, rc, text) => {
    if (out.has(id)) throw new InputError(`${what}: suite ${id} appears twice`);
    out.set(id, { rc, text });
    if (marks.has(id)) Object.assign(out.get(id), marks.get(id));
  };
  if (/^\s*\{/.test(raw)) {
    let j; try { j = JSON.parse(raw); } catch (e) { throw new InputError(`${what} is not valid JSON: ${e.message}`); }
    if (!j || !Array.isArray(j.suites)) throw new InputError(`${what}: JSON has no suites array`);
    for (const s of j.suites) {
      if (!s || typeof s.path !== 'string' || !Number.isInteger(s.rc)) throw new InputError(`${what}: bad suites entry`);
      add(s.path, s.rc, null);
    }
    return out;
  }
  let buf = [];
  for (const line of raw.split('\n')) {
    const fm = /^flaky-under-parallel: (\S+) \((?:timeout|rc=(\d+)) in pool\)\s*$/.exec(line);
    if (fm) marks.set(fm[1], { flaky: true, pool_rc: fm[2] === undefined ? 124 : Number(fm[2]) });
    const bm = /^red-in-both-runs: (\S+) \((?:timeout|rc=(\d+)) in pool, rc=\d+ alone\)\s*$/.exec(line);
    if (bm) marks.set(bm[1], { both_red: true, pool_rc: bm[2] === undefined ? 124 : Number(bm[2]) });
    const m = /^rc=(\d+) (\S+)\s*$/.exec(line);
    if (m) { add(m[2], Number(m[1]), buf.join('\n')); buf = []; } else buf.push(line);
  }
  if (!out.size) throw new InputError(`${what}: no "rc=N <path>" lines found`);
  return out;
}

function entry(id, r, flakyAsGreen) {
  const c = parseCount(id, r.text);
  const e = { rc: r.rc, status: r.rc === 0 ? 'pass' : 'fail', count: c.count };
  if (c.reason) e.count_reason = c.reason;
  if (r.flaky) {
    e.flaky_under_parallel = true; e.pool_rc = r.pool_rc;
    if (!flakyAsGreen) e.status = 'fail';
  }
  if (r.both_red) { e.red_in_both_runs = true; e.pool_rc = r.pool_rc; }
  return e;
}

function cmdRecord(o) {
  const root = path.resolve(o.root || process.cwd());
  const results = parseResults(o.results, '--results');
  if (!o.out) throw new InputError('missing --out argument');
  const pending = pendingSuites(root);
  const pend = o['pending-results'] ? parseResults(o['pending-results'], '--pending-results') : new Map();
  const suites = {};
  const fg = !!o['flaky-as-green'];
  for (const id of [...results.keys()].sort()) suites[id] = entry(id, results.get(id), fg);
  for (const id of pending) {
    const r = pend.get(id) || results.get(id);
    const e = r ? entry(id, r, fg) : { rc: null, status: 'not_run', count: null, count_reason: 'not_run' };
    suites[id] = { ...e, pending_join: 'P3', standalone: { rc: e.rc, status: e.status, count: e.count } };
  }
  const flaky = Object.keys(suites).filter((i) => suites[i].flaky_under_parallel);
  if (flaky.length) process.stderr.write(`suite-baseline: ${flaky.length} suite(s) red in the pool, green alone (stored as ${fg ? 'pass' : 'fail'}): ${flaky.join(' ')}\n`);
  const both = Object.keys(suites).filter((i) => suites[i].red_in_both_runs);
  if (both.length) process.stderr.write(`suite-baseline: ${both.length} suite(s) red in both runs: ${both.join(' ')}\n`);
  const doc = { schema: 1, root_note: 'ids are repo-relative suite paths', suites };
  fs.writeFileSync(o.out, JSON.stringify(doc, null, 2) + '\n');
  process.stdout.write(`recorded ${Object.keys(suites).length} suites (${pending.length} pending_join) -> ${o.out}\n`);
  return 0;
}

function loadBaseline(file, what) {
  const j = readJson(file, what);
  if (!j || typeof j !== 'object' || !j.suites || typeof j.suites !== 'object' || Array.isArray(j.suites)) {
    throw new InputError(`${what} ${file}: not a suite-baseline record (no suites object)`);
  }
  for (const [id, s] of Object.entries(j.suites)) {
    if (!s || typeof s !== 'object' || typeof s.status !== 'string') throw new InputError(`${what} ${file}: suite ${id} has no status`);
  }
  return j.suites;
}

function mapId(id, map) {
  if (Object.prototype.hasOwnProperty.call(map, id)) return map[id];
  for (const k of Object.keys(map)) if (k.endsWith('/') && id.startsWith(k)) return map[k] + id.slice(k.length);
  return id;
}

function compare(base, cur, map, declared) {
  const diffs = [];
  const seen = new Set();
  for (const [oldId, b] of Object.entries(base)) {
    const id = mapId(oldId, map);
    if (seen.has(id)) diffs.push(`collision: ${oldId} maps to ${id}, already claimed by another baseline suite`);
    seen.add(id);
    const c = cur[id];
    if (!c) {
      if (b.pending_join) continue;
      diffs.push(`missing: ${oldId}${id !== oldId ? ` (expected at ${id})` : ''} is not in the current run`);
      continue;
    }
    const want = b.pending_join && b.standalone ? b.standalone : b;
    if (c.status !== want.status) diffs.push(`result changed: ${id} was ${want.status}, now ${c.status}`);
    if (typeof want.count === 'number') {
      if (typeof c.count !== 'number') diffs.push(`count lost: ${id} had ${want.count}, now unparseable`);
      else if (c.count < want.count) diffs.push(`count decreased: ${id} ${want.count} -> ${c.count}`);
    }
  }
  const decl = new Set(declared);
  for (const id of Object.keys(cur)) {
    if (seen.has(id)) continue;
    if (!decl.has(id)) diffs.push(`undeclared new: ${id}`);
  }
  for (const id of decl) if (!cur[id]) diffs.push(`declared new but absent: ${id}`);
  return diffs;
}

function cmdCompare(o) {
  const base = loadBaseline(o.baseline, '--baseline');
  const cur = loadBaseline(o.current, '--current');
  const map = o['layout-map'] ? readJson(o['layout-map'], '--layout-map') : {};
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new InputError('--layout-map must be a JSON object');
  const declared = o['declared-new'] ? readJson(o['declared-new'], '--declared-new') : [];
  if (!Array.isArray(declared)) throw new InputError('--declared-new must be a JSON array');
  const diffs = compare(base, cur, map, declared);
  for (const d of diffs) process.stdout.write(`RED ${d}\n`);
  process.stdout.write(diffs.length ? `suite-baseline: ${diffs.length} difference(s)\n` : `suite-baseline: consistent (${Object.keys(base).length} baseline suites)\n`);
  return diffs.length ? 1 : 0;
}

function cmdRunAll(o) {
  const root = path.resolve(o.root || process.cwd());
  let ids;
  if (o.ids) ids = readText(o.ids, '--ids').split('\n').map((x) => x.trim()).filter(Boolean);
  else ids = o.pending ? pendingSuites(root) : listSuites(root);
  const secs = o['entry-timeout'] === undefined ? 1800 : Number(o['entry-timeout']);
  if (!Number.isFinite(secs) || secs <= 0) throw new InputError('--entry-timeout must be a positive number');
  const env = { ...process.env };
  delete env.AUTOPILOT_SESSION_ID; delete env.CLAUDE_CODE_SESSION_ID;
  let jobs = 1;
  if (o.jobs !== undefined) {
    jobs = Number(o.jobs);
    if (!Number.isInteger(jobs) || jobs < 1) throw new InputError('--jobs must be a positive integer');
  }
  if (jobs > 1) return runAllParallel(root, ids, secs, jobs, env);
  for (const id of ids) {
    const argv = id.endsWith('.test.js') ? ['--test', id] : [id];
    const r = cp.spawnSync(id.endsWith('.test.js') ? process.execPath : 'bash', argv,
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 << 20, timeout: secs * 1000, killSignal: 'SIGKILL' });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stdout.write(r.stderr);
    const rc = r.error && r.error.code === 'ETIMEDOUT' ? 124 : (r.status === null ? 1 : r.status);
    process.stdout.write(`\nrc=${rc} ${id}\n`);
  }
  return 0;
}

function serialSuites(root) {
  let rel = 'hooks/tests/lib/serial-suites.txt';
  if (fs.existsSync(path.join(root, 'scripts/lib/repo-layout.js'))) {
    try {
      rel = cp.execFileSync(process.execPath, [path.join(root, 'scripts/lib/repo-layout.js'), 'path', 'serial_suites'],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || rel;
    } catch (e) { throw new InputError(`layout registry cannot resolve serial_suites under ${root}: ${e.message}`); }
  }
  const set = new Set();
  let text = '';
  try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { /* no list = no serial suites */ }
  for (const line of text.split('\n')) { const t = line.replace(/#.*/, '').trim(); if (t) set.add(t); }
  return set;
}

// One suite, asynchronously, in its own process group; resolves {rc, out} with the output buffered whole.
function runOne(root, id, secs, env) {
  return new Promise((resolve) => {
    const isJs = id.endsWith('.test.js');
    const child = cp.spawn(isJs ? process.execPath : 'bash', isJs ? ['--test', id] : [id],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    ACTIVE_PIDS.add(child.pid);
    const so = []; const se = [];
    let timedOut = false;
    child.stdout.on('data', (d) => so.push(d));
    child.stderr.on('data', (d) => se.push(d));
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, secs * 1000);
    child.on('error', () => { /* surfaces as close with null status */ });
    child.on('close', (code) => {
      clearTimeout(timer); killGroup(); ACTIVE_PIDS.delete(child.pid);
      resolve({ rc: timedOut ? 124 : (code === null ? 1 : code), timedOut,
        out: Buffer.concat(so).toString('utf8') + Buffer.concat(se).toString('utf8') });
    });
  });
}
const ACTIVE_PIDS = new Set();
const MADE_DIRS = new Set();

async function runAllParallel(root, ids, secs, jobs, baseEnv) {
  const serial = serialSuites(root);
  const poolIds = ids.filter((i) => !serial.has(i));
  const serialIds = ids.filter((i) => serial.has(i));
  const cleanup = () => { for (const d of MADE_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } MADE_DIRS.clear(); };
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { for (const p of ACTIVE_PIDS) { try { process.kill(-p, 'SIGKILL'); } catch { /* gone */ } } cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); });
  }
  const callerFactor = process.env.AUTOPILOT_TEST_TIMING_FACTOR;
  const xdgParent = process.env.XDG_RUNTIME_DIR && path.isAbsolute(process.env.XDG_RUNTIME_DIR) && fs.existsSync(process.env.XDG_RUNTIME_DIR) ? process.env.XDG_RUNTIME_DIR : null;
  const exec = async (id, pool) => {
    const tmp = fs.mkdtempSync('/tmp/sbj.'); MADE_DIRS.add(tmp); fs.chmodSync(tmp, 0o700);
    const env = { ...baseEnv, TMPDIR: tmp };
    if (pool) { // every pool suite gets its own XDG_RUNTIME_DIR: under the caller's when usable, else inside its private TMPDIR
      let x = null;
      if (xdgParent) { try { x = fs.mkdtempSync(path.join(xdgParent, 'sbj.')); MADE_DIRS.add(x); } catch { x = null; } }
      if (!x) { x = path.join(tmp, 'x'); fs.mkdirSync(x); }
      fs.chmodSync(x, 0o700); env.XDG_RUNTIME_DIR = x;
    }
    if (callerFactor === undefined) env.AUTOPILOT_TEST_TIMING_FACTOR = String(pool ? jobs : 1);
    const r = await runOne(root, id, secs, env);
    for (const d of [tmp, env.XDG_RUNTIME_DIR]) if (d && MADE_DIRS.has(d)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } MADE_DIRS.delete(d); }
    return r;
  };
  const emit = (r, extra, id) => process.stdout.write(`${r.out}\n${extra}rc=${r.rc} ${id}\n`);
  const held = [];
  let flaky = 0; let both = 0; let red = 0;
  try {
    let next = 0;
    const worker = async () => {
      while (next < poolIds.length) {
        const id = poolIds[next++];
        const r = await exec(id, true);
        if (r.rc === 0) emit(r, '', id); else held.push({ id, r });
      }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, poolIds.length) }, worker));
    // Every pool failure is re-run alone; nothing else is running now.
    for (const { id, r } of held) {
      const again = await exec(id, false);
      const poolWhy = r.timedOut ? 'timeout' : `rc=${r.rc}`;
      if (again.rc === 0) { flaky++; emit(again, `flaky-under-parallel: ${id} (${poolWhy} in pool)\n`, id); }
      else { both++; red++; emit(again, `red-in-both-runs: ${id} (${poolWhy} in pool, rc=${again.rc} alone)\n`, id); }
    }
    // Serial-listed suites: strictly one at a time, after the pool is empty.
    for (const id of serialIds) {
      const r = await exec(id, false);
      if (r.rc !== 0) red++;
      emit(r, '', id);
    }
  } finally { cleanup(); }
  process.stderr.write(`suite-baseline: run-all --jobs ${jobs}: ${ids.length} run (${poolIds.length} pooled, ${serialIds.length} serial), ${flaky} flaky-under-parallel, ${both} red in both runs\n`);
  return 0;
}

function cmdList(o) {
  const root = path.resolve(o.root || process.cwd());
  const ids = listSuites(root);
  if (o.json) process.stdout.write(JSON.stringify({ total: ids.length, suites: ids, pending_join: pendingSuites(root) }, null, 2) + '\n');
  else process.stdout.write(ids.join('\n') + '\n');
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    if (!['list', 'run-all', 'record', 'compare'].includes(cmd)) throw new InputError('usage: suite-baseline.js list|run-all|record|compare ... (see file header)');
    const o = parseArgs(rest);
    return await { list: cmdList, 'run-all': cmdRunAll, record: cmdRecord, compare: cmdCompare }[cmd](o);
  } catch (e) {
    if (e instanceof InputError) { process.stderr.write(`suite-baseline: ${e.message}\n`); return 2; }
    throw e;
  }
}

if (require.main === module) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
module.exports = { compare, parseCount, parseResults, mapId };
