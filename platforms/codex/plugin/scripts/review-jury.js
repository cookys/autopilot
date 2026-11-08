#!/usr/bin/env node
'use strict';

// review-jury - a four-vendor reviewer jury (grok, kimi, glm, minimax) that stands in for the
// Astra (codex) seat when codex has no quota. Plan review, code review and criteria review all use it.
// It is a thin layer over scripts/dispatch-review.sh (one read-only seat per call); it does not call
// any runner itself.
//
// USAGE
//   node scripts/review-jury.js run --pack <file> --implementer-family <family> --out <dir>
//        [--diff <path in pack>] [--questions <path in pack>] [--methodology <file>] [--spec-file <file>] [--seats grok,kimi,glm,minimax]
//        [--timeout 15m] [--dispatch-bin <path>] [--scorecard-bin <path>]
//        [--seat-model <seat>=<model>]... [--seat-effort <seat>=<effort>]...
//   node scripts/review-jury.js merge --out <dir> <run-dir> [<run-dir> ...]
//
// --seat-model / --seat-effort (repeatable) override the table below for one run, e.g.
//        --seat-model kimi=kimi-code/k3.1-pro --seat-model minimax=MiniMax-M3.1-Flash. The overridden value is used for
//        dispatch-review's --model/--effort and the seat-status lookup, and is what seats/<seat>.json, run.json and
//        merged.json record. An unknown seat or a value that is not name=value is a usage error (rc 2).
// run    Dispatches every seat that THIS account can reach, in parallel, each blind to the others,
//        then merges its own output. A seat whose runner binary (grok, kimi) or endpoint (glm,
//        minimax: resolve-endpoint.sh ready) is not found here is "unavailable" - not a failure.
//        A seat of the implementer's own family is "excluded_family" and never dispatched.
//        Writes <out>/seats/<seat>.json (dispatch-review's stdout, byte for byte), <out>/run.json
//        (what happened to each seat) and <out>/merged.json.
//        Never borrows another account's credentials or HOME: a seat this account cannot reach is
//        run by the account that can (grok in team, kimi/glm/minimax in cookys) and merged later.
// merge  Reads one or more run dirs (they may come from different accounts, moved by fleet blob),
//        writes <out>/merged.json: union of findings, per-seat state, round_valid.
//
// --pack may also be a review-pack directory or .tar/.tar.xz (FILES.sha256 verified first; --diff default = the one top-level *.diff;
// QUESTIONS.md becomes --spec-file; other small text files become one --pack-file context, capped at 300 KB).
// What is reviewed: --pack is the artifact under review as TEXT - a diff, a plan or a criteria
// document alike. dispatch-review.sh makes --diff-file mandatory and treats --pack-file as a
// methodology pack prepended inside the nonce protocol, so --pack goes to --diff-file and the
// optional --methodology goes to --pack-file (e.g. the review rubric). --spec-file is the trusted
// baseline, passed through unchanged. No implementer narrative may be passed (references/blind-dispatch.md).
//
// Merge rules (PM): findings are a UNION keyed by finding id, every source seat kept, no majority vote.
// The command only marks blocking_candidate (some seat wrote MUST-FIX and did not revoke it); depth-0
// verifies each one. A seat with no qualified reviewer row is advisory: its findings are listed but
// "blocking_candidate_qualified" stays false unless a qualified seat also raised the id, so it can
// neither block nor release alone. A round needs >= 2 seats with a parsed verdict, else round_valid
// is false and the exit code is 1. Exit codes: 0 round valid, 1 round not valid, 2 usage error.
//
// Seat table (runner / model / effort; source):
//   grok     grok                 grok-4.7            low   official reviewer row (references/official-qualification-defaults.json)
//   kimi     kimi                 kimi-code/k3        high  same file; kimi takes effort via KIMI_MODEL_THINKING_EFFORT (dispatch-review.sh)
//   glm      anthropic-compatible glm-5.3             high  same file; endpoint `glm` (project-config-template/review-loop-config.md)
//   minimax  anthropic-compatible MiniMax-M3          high  endpoint `minimax` (same template, "MiniMax-M3 (reviewer)")
// Qualified or advisory is read live from `engine-scorecard.js seat-status ... --role reviewer`
// (admission_status "qualified" means qualified; no_record, failed or an unreadable answer means advisory).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { familyOfEngine } = require('./lib/stage-write');

const SEATS = Object.freeze({
  grok: { runner: 'grok', model: 'grok-4.7', effort: 'low', bin: 'grok' },
  kimi: { runner: 'kimi', model: 'kimi-code/k3', effort: 'high', bin: 'kimi' },
  glm: { runner: 'anthropic-compatible', model: 'glm-5.3', effort: 'high', endpoint: 'glm' },
  minimax: { runner: 'anthropic-compatible', model: 'MiniMax-M3', effort: 'high', endpoint: 'minimax' },
});
const MIN_VALID = 2;
const VERDICTS = new Set(['SHIP-AS-IS', 'FIX-THEN-SHIP']);

function die(msg) {
  process.stderr.write(`review-jury: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const o = { _: [] };
  const takes = new Set(['pack', 'implementer-family', 'out', 'methodology', 'spec-file', 'seats', 'timeout', 'dispatch-bin', 'scorecard-bin', 'diff', 'questions']);
  const repeat = new Set(['seat-model', 'seat-effort']);
  for (const k of repeat) takes.add(k);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (!takes.has(k)) die(`unknown flag ${a}`);
      if (i + 1 >= argv.length) die(`${a} needs a value`);
      if (repeat.has(k)) (o[k] = o[k] || []).push(argv[++i]); else o[k] = argv[++i];
    } else o._.push(a);
  }
  return o;
}

// Effective seat table: SEATS with the per-run --seat-model / --seat-effort overrides applied.
function applyOverrides(o) {
  const eff = Object.fromEntries(Object.entries(SEATS).map(([n, s]) => [n, { ...s }]));
  for (const [flag, field] of [['seat-model', 'model'], ['seat-effort', 'effort']]) {
    for (const item of o[flag] || []) {
      const m = item.match(/^([^=]+)=(.+)$/);
      if (!m) die(`--${flag} needs <seat>=<value>, got ${item}`);
      if (!eff[m[1]]) die(`--${flag}: unknown seat ${m[1]} (known: ${Object.keys(SEATS).join(', ')})`);
      eff[m[1]][field] = m[2];
    }
  }
  return eff;
}

function onPath(bin) {
  for (const d of (process.env.PATH || '').split(':')) {
    if (!d) continue;
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return true; } catch { /* next */ }
  }
  return false;
}

function runnerFound(seat) {
  if (onPath(seat.bin)) return true;
  if (seat.bin === 'kimi') {
    try { fs.accessSync(path.join(os.homedir(), '.kimi-code', 'bin', 'kimi'), fs.constants.X_OK); return true; } catch { return false; }
  }
  return false;
}

// resolve-endpoint.sh only reads the process env; dispatch-review.sh fills it from endpoints.env first,
// so do the same here. Only the non-secret `ready` flag is read back.
function endpointReady(name) {
  const dir = __dirname;
  const r = spawnSync('bash', ['-c', '. "$1/load-endpoints-env.sh" && autopilot_load_endpoints_env >/dev/null 2>&1; "$1/resolve-endpoint.sh" "$2"', '_', dir, name],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try { return JSON.parse(r.stdout).ready === true; } catch { return false; }
}

function isQualified(seat, scorecardBin) {
  const args = [scorecardBin, 'seat-status', '--engine', seat.model, '--runner', seat.runner, '--role', 'reviewer', '--effort', seat.effort];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try { return JSON.parse(r.stdout).admission_status === 'qualified'; } catch { return false; }
}

function dispatchSeat(name, seat, opts) {
  const args = ['--runner', seat.runner, '--model', seat.model, '--effort', seat.effort, '--diff-file', opts.pk.diff, '--timeout', opts.timeout];
  if (seat.endpoint) args.push('--endpoint', seat.endpoint);
  if (opts.pk.spec) args.push('--spec-file', opts.pk.spec);
  if (opts.pk.ctx) args.push('--pack-file', opts.pk.ctx);
  return new Promise((resolve) => {
    const child = spawn(opts.dispatchBin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DISPATCH_QUIET: '1' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.resume();
    child.on('error', (e) => resolve({ name, rc: 127, out: '', err: String(e.message) }));
    child.on('close', (rc) => resolve({ name, rc: rc === null ? 1 : rc, out, err: '' }));
  });
}

const CONTEXT_CAP = 300 * 1024;

// --pack may be a single text file (the artifact itself), a review-pack directory or a .tar/.tar.xz of one.
// A pack with FILES.sha256 is verified first (sha256sum -c inside the pack); any mismatch refuses the pack.
// Inside a pack: diff = --diff or the only top-level *.diff; spec = --questions or QUESTIONS.md;
// every other small text file is concatenated into one context file (<= CONTEXT_CAP, the rest listed as skipped).
// Pack content is untrusted data: it is only read, never executed.
function resolvePack(o) {
  let root = o.pack;
  const st = fs.statSync(root);
  if (st.isFile() && !/\.(tar|tar\.xz|txz)$/.test(root)) return { diff: root, spec: o['spec-file'], ctx: o.methodology };
  const work = path.join(o.out, 'pack');
  if (st.isFile()) {
    fs.mkdirSync(work, { recursive: true });
    const r = spawnSync('tar', ['-xf', root, '-C', work], { encoding: 'utf8' });
    if (r.status !== 0) die(`cannot extract ${root}: ${r.stderr}`);
    const top = fs.readdirSync(work);
    root = top.length === 1 && fs.statSync(path.join(work, top[0])).isDirectory() ? path.join(work, top[0]) : work;
  }
  const sums = path.join(root, 'FILES.sha256');
  if (fs.existsSync(sums)) {
    const r = spawnSync('sha256sum', ['-c', '--quiet', 'FILES.sha256'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) die(`pack refused: FILES.sha256 does not match (${(r.stdout + r.stderr).trim().split('\n').slice(0, 3).join('; ')})`);
  }
  const top = fs.readdirSync(root).filter((f) => fs.statSync(path.join(root, f)).isFile());
  let diff = o.diff ? path.join(root, o.diff) : null;
  if (!diff) {
    const ds = top.filter((f) => f.endsWith('.diff'));
    if (ds.length !== 1) die(`pack needs exactly one top-level *.diff or --diff (found ${ds.length})`);
    diff = path.join(root, ds[0]);
  }
  const qf = path.join(root, o.questions || 'QUESTIONS.md');
  if (o.questions && !fs.existsSync(qf)) die(`--questions not found in pack: ${o.questions}`);
  const spec = fs.existsSync(qf) ? qf : o['spec-file'];
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(root);
  files.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  let text = ''; const skipped = [];
  for (const f of files) {
    if (f === diff || f === qf || f === sums) continue;
    const buf = fs.readFileSync(f);
    const rel = path.relative(root, f);
    if (buf.includes(0) || text.length + buf.length > CONTEXT_CAP) { skipped.push(rel); continue; }
    text += `\n===== ${rel} =====\n${buf.toString('utf8')}\n`;
  }
  if (skipped.length) text += `\n===== skipped (binary or over the ${CONTEXT_CAP} byte context cap) =====\n${skipped.join('\n')}\n`;
  const ctx = path.join(o.out, 'context.txt');
  fs.writeFileSync(ctx, text);
  return { diff, spec, ctx };
}

function writeJson(file, obj) { fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); }

async function cmdRun(o) {
  for (const k of ['pack', 'implementer-family', 'out']) if (!o[k]) die(`run needs --${k}`);
  if (!fs.existsSync(o.pack)) die(`--pack not found: ${o.pack}`);
  fs.mkdirSync(o.out, { recursive: true });
  const pk = resolvePack(o);
  const seatTable = applyOverrides(o);
  const names = (o.seats || Object.keys(SEATS).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!SEATS[n]) die(`unknown seat ${n} (known: ${Object.keys(SEATS).join(', ')})`);
  const scorecardBin = o['scorecard-bin'] || path.join(__dirname, 'engine-scorecard.js');
  const opts = { ...o, pk, timeout: o.timeout || '15m', dispatchBin: o['dispatch-bin'] || path.join(__dirname, 'dispatch-review.sh') };
  fs.mkdirSync(path.join(o.out, 'seats'), { recursive: true });

  const state = {};
  const todo = [];
  for (const n of names) {
    const s = seatTable[n];
    const family = familyOfEngine(s.model);
    const base = { runner: s.runner, model: s.model, effort: s.effort, family, qualified: isQualified(s, scorecardBin) };
    if (family === o['implementer-family']) { state[n] = { ...base, state: 'excluded_family' }; continue; }
    const reach = s.endpoint ? endpointReady(s.endpoint) : runnerFound(s);
    if (!reach) { state[n] = { ...base, state: 'unavailable', reason: s.endpoint ? `endpoint ${s.endpoint} not ready on this account` : `runner ${s.bin} not found on this account` }; continue; }
    state[n] = { ...base, state: 'dispatched' };
    todo.push(n);
  }
  const results = await Promise.all(todo.map((n) => dispatchSeat(n, seatTable[n], opts)));
  for (const r of results) {
    let body;
    try { JSON.parse(r.out); body = r.out; } catch {
      body = `${JSON.stringify({ runner: seatTable[r.name].runner, model: seatTable[r.name].model, status: 'no_verdict', verdict: null, findings: '', error: `dispatch-review produced no JSON (rc=${r.rc}) ${r.err}`.trim() })}\n`;
    }
    fs.writeFileSync(path.join(o.out, 'seats', `${r.name}.json`), body);
    state[r.name].rc = r.rc;
  }
  writeJson(path.join(o.out, 'run.json'), { implementer_family: o['implementer-family'], seats: state });
  return mergeDirs([o.out], o.out);
}

function parseFindings(text) {
  const out = [];
  const unparsed = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || /^findings:\s*none$/i.test(line) || /^FINDINGS:?$/.test(line)) continue;
    const m = line.match(/^(\S+)\s+\[([^\]\s]+)\]\s+(.*)$/) || line.match(/^()\[([^\]\s]+)\]\s+(.*)$/);
    if (!m) { unparsed.push(line); continue; }
    const claim = m[3];
    const cls = /^REVOKED:/.test(claim) ? 'revoked' : /^MUST-FIX\b/.test(claim) ? 'must-fix' : /^CUT\/FOLLOW-UP\b/.test(claim) ? 'cut' : 'other';
    out.push({ id: m[2], severity: m[1], class: cls, claim });
  }
  return { findings: out, unparsed };
}

function mergeDirs(dirs, outDir) {
  const seats = {};
  for (const d of dirs) {
    let run;
    try { run = JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8')); } catch { die(`${d} has no readable run.json`); }
    for (const [n, st] of Object.entries(run.seats)) {
      let verdict = null; let status = st.state; let findingsText = ''; let error = null;
      if (st.state === 'dispatched') {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(d, 'seats', `${n}.json`), 'utf8'));
          const ok = j.status === 'reviewed' && VERDICTS.has(j.verdict);
          status = ok ? 'valid' : 'invalid';
          verdict = ok ? j.verdict : null; findingsText = ok ? j.findings : ''; error = j.error || null;
        } catch { status = 'invalid'; error = 'seat file missing or unreadable'; }
      }
      const prev = seats[n];
      // The same seat from two dirs: a valid answer beats anything else; otherwise keep the first.
      if (prev && (prev.status === 'valid' || status !== 'valid')) continue;
      seats[n] = { status, verdict, qualified: !!st.qualified, family: st.family, runner: st.runner, model: st.model, effort: st.effort, reason: st.reason || error || undefined, from: d, findingsText };
    }
  }
  const byId = new Map();
  const unparsed = {};
  for (const [n, s] of Object.entries(seats)) {
    if (s.status !== 'valid') continue;
    const { findings, unparsed: u } = parseFindings(s.findingsText);
    if (u.length) unparsed[n] = u;
    const revoked = new Set(findings.filter((f) => f.class === 'revoked').map((f) => f.id));
    for (const f of findings) {
      if (f.class === 'revoked' || revoked.has(f.id)) continue;
      if (!byId.has(f.id)) byId.set(f.id, { id: f.id, sources: [] });
      byId.get(f.id).sources.push({ seat: n, advisory: !s.qualified, severity: f.severity, class: f.class, claim: f.claim });
    }
  }
  const findings = [...byId.values()].map((e) => {
    const must = e.sources.filter((x) => x.class === 'must-fix');
    return { ...e, blocking_candidate: must.length > 0, blocking_candidate_qualified: must.some((x) => !x.advisory), needs_depth0_verification: must.length > 0 };
  });
  const valid = Object.entries(seats).filter(([, s]) => s.status === 'valid').map(([n]) => n);
  const merged = {
    round_valid: valid.length >= MIN_VALID,
    valid_seat_count: valid.length,
    min_valid_seats: MIN_VALID,
    qualified_seats: valid.filter((n) => seats[n].qualified),
    advisory_seats: valid.filter((n) => !seats[n].qualified),
    seat_states: Object.fromEntries(Object.entries(seats).map(([n, s]) => [n, { status: s.status, verdict: s.verdict, qualified: s.qualified, family: s.family, runner: s.runner, model: s.model, effort: s.effort, reason: s.reason, from: s.from }])),
    findings,
    unparsed_finding_lines: unparsed,
    note: 'union of findings, no majority vote; blocking_candidate is a mark, depth-0 verifies each one; advisory seats cannot block or release alone',
  };
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, 'merged.json'), merged);
  process.stdout.write(`${JSON.stringify({ round_valid: merged.round_valid, valid_seats: valid, qualified_seats: merged.qualified_seats, advisory_seats: merged.advisory_seats, findings: findings.length, merged: path.join(outDir, 'merged.json') })}\n`);
  return merged.round_valid ? 0 : 1;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') { process.stdout.write('usage: review-jury.js run|merge (see the header of this file)\n'); process.exit(cmd ? 0 : 2); }
  const o = parseArgs(rest);
  if (cmd === 'run') process.exit(await cmdRun(o));
  if (cmd === 'merge') {
    if (!o.out || !o._.length) die('merge needs --out <dir> and at least one run dir');
    process.exit(mergeDirs(o._, o.out));
  }
  die(`unknown command ${cmd}`);
}

main();
