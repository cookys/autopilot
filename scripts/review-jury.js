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
//        A seat of the implementer's own family is "excluded_family" and never dispatched. A seat's family is fixed in the table
//        (xai, moonshot, zhipu, minimax), never derived from --seat-model; --implementer-family must be a known family id.
//        Writes <out>/seats/<seat>.json (dispatch-review's stdout; plus an answers[] field in question mode), <out>/run.json
//        (what happened to each seat) and <out>/merged.json.
//        Never borrows another account's credentials or HOME: a seat this account cannot reach is
//        run by the account that can (grok in team, kimi/glm/minimax in cookys) and merged later.
// merge  Reads one or more run dirs (they may come from different accounts, moved by fleet blob),
//        writes <out>/merged.json: union of findings, per-seat state, round_valid. Run dirs whose implementer_family differ are
//        refused (rc 2); a seat whose own family equals it is excluded_family and never counts as valid.
//
// --pack may also be a review-pack directory or .tar/.tar.xz. Pack content is untrusted: every path is checked by lstat,
// a symlink or special file anywhere in the pack refuses it (rc 2), a tar with an absolute or ".." member (or a link member)
// is refused before extraction, and --diff / the questions file must resolve inside the pack. A directory or tar pack needs
// FILES.sha256, its entries must be relative without "..", and its list must equal the pack's file set exactly (then sha256sum -c).
// A single file passed as --pack needs no FILES.sha256. --diff default = the one top-level *.diff or *.patch.
// QUESTIONS.md becomes --spec-file; other small text files become one --pack-file context, capped at 300 KB. Files left out
// (binary or over the cap) are listed first in the context ("以下檔案因大小未附：...") and as skipped_files in run.json and merged.json.
// Question mode: when QUESTIONS.md has lines starting Q<n> (or `<n>.` / `<n>)`), an answer-format request is appended to the spec (<out>/spec.txt) and each
// seat must write one `ANSWER Q<n> | conclusion=.. | basis=<file:line> | counterexample=..` line per question inside FINDINGS (the lines
// dispatch-review keeps). They are parsed into the seat file's answers[]; merged.json lists answers by question and missing_answers
// (a valid seat that left a question out or left a field empty); that never changes round_valid.
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

const SEATS = Object.freeze({
  grok: { runner: 'grok', model: 'grok-4.7', effort: 'low', bin: 'grok', family: 'xai' },
  kimi: { runner: 'kimi', model: 'kimi-code/k3', effort: 'high', bin: 'kimi', family: 'moonshot' },
  glm: { runner: 'anthropic-compatible', model: 'glm-5.3', effort: 'high', endpoint: 'glm', family: 'zhipu' },
  minimax: { runner: 'anthropic-compatible', model: 'MiniMax-M3', effort: 'high', endpoint: 'minimax', family: 'minimax' },
});
// Family ids as scripts/lib/stage-write.js familyOfEngine() returns them, plus `claude` (what the PM writes for anthropic).
// A seat's family is fixed by the seat, never by --seat-model.
const KNOWN_FAMILIES = new Set(['anthropic', 'claude', 'openai', 'xai', 'moonshot', 'zhipu', 'minimax', 'google', 'alibaba', 'deepseek', 'meituan', 'reflection']);
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

function lst(p) {
  try { return fs.lstatSync(p); } catch (e) { return die(`pack path unreadable: ${p} (${e.code})`); }
}

// Every entry under root, by lstat (never following a link). A symlink or a special file anywhere refuses the pack.
// Returns the sorted relative paths of the regular files.
function walkTree(root) {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      const st = lst(p);
      if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) die(`pack refused: ${path.relative(root, p)} is a symlink or a special file`);
      if (st.isDirectory()) walk(p); else files.push(path.relative(root, p));
    }
  })(root);
  return files;
}

// A pack file we are going to read must be a regular file whose real path stays under the pack root.
function insideRoot(rootReal, p, what) {
  if (!lst(p).isFile()) die(`pack refused: ${what} is not a regular file: ${p}`);
  const rp = fs.realpathSync(p);
  if (!rp.startsWith(rootReal + path.sep)) die(`pack refused: ${what} resolves outside the pack: ${p}`);
}

function badTarName(n) { return n.startsWith('/') || n.split('/').includes('..'); }

// FILES.sha256 is mandatory for a directory or tar pack and must cover exactly the files that are there.
function checkManifest(root, files) {
  const sums = 'FILES.sha256';
  if (!files.includes(sums)) die('pack refused: FILES.sha256 is missing');
  const listed = new Set();
  for (const line of fs.readFileSync(path.join(root, sums), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^([0-9a-fA-F]{64}) [ *](.+)$/);
    if (!m) die(`pack refused: malformed FILES.sha256 line: ${line.slice(0, 80)}`);
    const p = m[2];
    if (p.startsWith('/') || p.startsWith('\\') || p.split('/').includes('..')) die(`pack refused: FILES.sha256 entry is absolute or contains "..": ${p}`);
    listed.add(path.posix.normalize(p));
  }
  const actual = new Set(files.filter((f) => f !== sums));
  const extra = [...actual].filter((f) => !listed.has(f));
  const missing = [...listed].filter((f) => !actual.has(f));
  if (extra.length || missing.length) die(`pack refused: FILES.sha256 does not match the file set (not listed: ${extra.slice(0, 5).join(', ') || '-'}; listed but absent: ${missing.slice(0, 5).join(', ') || '-'})`);
  const r = spawnSync('sha256sum', ['-c', '--quiet', sums], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) die(`pack refused: FILES.sha256 does not match (${(r.stdout + r.stderr).trim().split('\n').slice(0, 3).join('; ')})`);
}

const ANSWER_LINE_RE = /^ANSWER\s+Q\d+\s*\|/;

function questionIds(text) {
  const ids = [];
  for (const line of String(text).split('\n')) { const m = line.match(/^(?:Q(\d+)\b|(\d+)[.)]\s)/); const id = m && (m[1] || m[2]); if (id && !ids.includes(id)) ids.push(id); }
  return ids;
}

// Appended to the pack's QUESTIONS.md so every seat answers each numbered question, inside the FINDINGS section
// (dispatch-review.sh keeps every non-empty line there until NO-FINDING-PROOF).
function answerFormat(ids) {
  return `\n\n--- Answer format for the numbered questions above (added by review-jury) ---\n`
    + `Answer every question (${ids.map((i) => `Q${i}`).join(', ')}). Put one line per question inside the FINDINGS section of your wrapped block, after your finding lines (or after the word none). Each answer is ONE line, outside any code fence, in exactly this shape:\n`
    + `ANSWER Q<n> | conclusion=<your answer> | basis=<file:line, one or more> | counterexample=<a concrete counterexample, or none: and the reason none can be constructed>\n`
    + `Keep each ANSWER line under 600 characters. The answer lines do not change the verdict rules: a reachable counterexample is also a MUST-FIX finding line in the usual form.\n`;
}

// An answer starts at "ANSWER Q<n> |" (a seat may put all of them on one line, and in
// no_finding_proof as well as in findings) and runs to the next "ANSWER Q" or the end of its line. Its three fields are
// cut at " | key=". A field left empty, or a placeholder such as <your answer> copied from the format request, is no answer.
// The first occurrence of a question number is the answer; later ones are listed in duplicates.
// In findings only a line whose trimmed text starts with "ANSWER Q" counts (a finding line may quote an answer string);
// in no_finding_proof the answer may sit anywhere in a line.
function parseAnswers(findingsText, proofText) {
  const onlyAnswerLines = String(findingsText || '').split('\n').filter((l) => l.trim().startsWith('ANSWER Q')).join('\n');
  const texts = [onlyAnswerLines, proofText];
  const text = texts.map((t) => String(t || '')).join('\n');
  const out = []; const duplicates = []; const seen = new Set();
  const starts = [...text.matchAll(/ANSWER\s+Q(\d+)\s*\|/g)];
  for (const m of starts) {
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(/ANSWER\s+Q\d|\n/);
    const seg = (end < 0 ? rest : rest.slice(0, end));
    if (seen.has(m[1])) { if (!duplicates.includes(m[1])) duplicates.push(m[1]); continue; }
    seen.add(m[1]);
    const parts = ('|' + seg).split(/\|\s*(conclusion|basis|counterexample)=/);
    const f = {};
    for (let i = 1; i + 1 < parts.length; i += 2) if (!(parts[i] in f)) f[parts[i]] = parts[i + 1].trim();
    const { conclusion, basis, counterexample } = f;
    if (!conclusion || !basis || !counterexample || /^<[^>]*>$/.test(conclusion)) continue;
    out.push({ q: m[1], conclusion, basis, counterexample });
  }
  return { answers: out, duplicates };
}

// --pack may be a single text file (the artifact itself), a review-pack directory or a .tar/.tar.xz of one.
// Pack content is untrusted data: it is only read, never executed. Every path is checked by lstat: a symlink or a
// special file anywhere in the pack refuses it; a tar with an absolute or ".." member name is refused before it is
// extracted. A directory or tar pack needs FILES.sha256, and its list must equal the file set (sha256sum -c after).
// Inside a pack: diff = --diff or the only top-level *.diff / *.patch; spec = --questions or QUESTIONS.md;
// every other small text file is concatenated into one context file (<= CONTEXT_CAP, the rest listed as skipped).
function resolvePack(o) {
  let root = fs.realpathSync(o.pack);
  const st = fs.statSync(root);
  if (st.isFile() && !/\.(tar|tar\.xz|txz)$/.test(root)) return { diff: root, spec: o['spec-file'], ctx: o.methodology, questions: [], skipped: [] };
  const work = path.join(o.out, 'pack');
  if (st.isFile()) {
    const names = spawnSync('tar', ['-tf', root], { encoding: 'utf8' });
    if (names.status !== 0) die(`cannot list ${root}: ${names.stderr}`);
    for (const n of names.stdout.split('\n')) if (n && badTarName(n)) die(`pack refused: tar member with an absolute or ".." name: ${n}`);
    const verbose = spawnSync('tar', ['-tvf', root], { encoding: 'utf8' });
    for (const l of verbose.stdout.split('\n')) if (/^[lh]/.test(l)) die(`pack refused: tar member is a link: ${l.slice(0, 120)}`);
    fs.mkdirSync(work, { recursive: true });
    const r = spawnSync('tar', ['-xf', root, '-C', work], { encoding: 'utf8' });
    if (r.status !== 0) die(`cannot extract ${root}: ${r.stderr}`);
    walkTree(work);
    const top = fs.readdirSync(work);
    root = top.length === 1 && lst(path.join(work, top[0])).isDirectory() ? path.join(work, top[0]) : work;
  } else if (!st.isDirectory()) die(`pack refused: ${root} is neither a file nor a directory`);
  const rootReal = fs.realpathSync(root);
  const files = walkTree(root);
  checkManifest(root, files);
  const sums = path.join(root, 'FILES.sha256');
  const top = files.filter((f) => !f.includes('/'));
  let diff = o.diff ? path.join(root, o.diff) : null;
  if (!diff) {
    const ds = top.filter((f) => f.endsWith('.diff') || f.endsWith('.patch'));
    if (ds.length !== 1) die(`pack needs exactly one top-level *.diff or *.patch, or --diff (found ${ds.length})`);
    diff = path.join(root, ds[0]);
  }
  insideRoot(rootReal, diff, 'the diff');
  const qf = path.join(root, o.questions || 'QUESTIONS.md');
  const hasQf = fs.lstatSync(qf, { throwIfNoEntry: false }) !== undefined;
  if (o.questions && !hasQf) die(`--questions not found in pack: ${o.questions}`);
  if (hasQf) insideRoot(rootReal, qf, 'the questions file');
  let spec = hasQf ? qf : o['spec-file'];
  let questions = [];
  if (hasQf) {
    questions = questionIds(fs.readFileSync(qf, 'utf8'));
    if (questions.length) {
      spec = path.join(o.out, 'spec.txt');
      fs.writeFileSync(spec, fs.readFileSync(qf, 'utf8') + answerFormat(questions));
    }
  }
  const ordered = files.map((f) => path.join(root, f));
  ordered.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  let text = ''; const skipped = [];
  for (const f of ordered) {
    if (f === diff || f === qf || f === sums) continue;
    const buf = fs.readFileSync(f);
    const rel = path.relative(root, f);
    if (buf.includes(0)) { skipped.push({ path: rel, bytes: buf.length, reason: 'binary' }); continue; }
    if (Buffer.byteLength(text) + buf.length > CONTEXT_CAP) { skipped.push({ path: rel, bytes: buf.length, reason: `over the ${CONTEXT_CAP} byte context cap` }); continue; }
    text += `\n===== ${rel} =====\n${buf.toString('utf8')}\n`;
  }
  if (skipped.length) {
    text = `以下檔案因大小未附：${skipped.map((s) => s.path).join('、')}\n${text}`;
    text += `\n===== skipped (binary or over the ${CONTEXT_CAP} byte context cap) =====\n${skipped.map((s) => `${s.path} (${s.bytes} bytes, ${s.reason})`).join('\n')}\n`;
  }
  const ctx = path.join(o.out, 'context.txt');
  fs.writeFileSync(ctx, text);
  return { diff, spec, ctx, questions, skipped };
}

function writeJson(file, obj) { fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`); }

async function cmdRun(o) {
  for (const k of ['pack', 'implementer-family', 'out']) if (!o[k]) die(`run needs --${k}`);
  if (!KNOWN_FAMILIES.has(o['implementer-family'])) die(`unknown --implementer-family ${o['implementer-family']} (known: ${[...KNOWN_FAMILIES].join(', ')})`);
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
    const family = SEATS[n].family;
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
    try {
      const j = JSON.parse(r.out); body = r.out;
      if (pk.questions.length) { const pa = parseAnswers(j.findings, j.no_finding_proof); j.answers = pa.answers; j.duplicate_answers = pa.duplicates; body = `${JSON.stringify(j)}\n`; }
    } catch {
      body = `${JSON.stringify({ runner: seatTable[r.name].runner, model: seatTable[r.name].model, status: 'no_verdict', verdict: null, findings: '', error: `dispatch-review produced no JSON (rc=${r.rc}) ${r.err}`.trim() })}\n`;
    }
    fs.writeFileSync(path.join(o.out, 'seats', `${r.name}.json`), body);
    state[r.name].rc = r.rc;
  }
  writeJson(path.join(o.out, 'run.json'), { implementer_family: o['implementer-family'], questions: pk.questions, skipped_files: pk.skipped, seats: state });
  return mergeDirs([o.out], o.out);
}

function parseFindings(text) {
  const out = [];
  const unparsed = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line || /^(findings:\s*)?none$/i.test(line) || /^FINDINGS:?$/.test(line) || ANSWER_LINE_RE.test(line)) continue;
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
  const runs = dirs.map((d) => {
    try { return { d, run: JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8')) }; } catch { return die(`${d} has no readable run.json`); }
  });
  const implFamily = runs[0].run.implementer_family;
  for (const { d, run } of runs) if (run.implementer_family !== implFamily) die(`run dirs disagree on implementer_family (${runs[0].d}: ${implFamily}, ${d}: ${run.implementer_family}); merge only runs of the same review`);
  const questionSet = new Set();
  const skippedFiles = []; const skippedSeen = new Set();
  for (const { d, run } of runs) {
    for (const q of run.questions || []) questionSet.add(String(q));
    for (const sk of run.skipped_files || []) { const key = `${sk.path}\0${sk.bytes}`; if (!skippedSeen.has(key)) { skippedSeen.add(key); skippedFiles.push(sk); } }
    for (const [n, st0] of Object.entries(run.seats)) {
      if (!SEATS[n]) die(`${d}/run.json names an unknown seat ${n} (known: ${Object.keys(SEATS).join(', ')})`);
      // The family is the seat's own, not whatever the (untrusted) run.json says.
      const st = { ...st0, family: SEATS[n].family };
      let verdict = null; let status = st.state; let findingsText = ''; let proofText = ''; let error = null;
      if (st.family === implFamily) status = 'excluded_family';
      else if (st.state === 'dispatched') {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(d, 'seats', `${n}.json`), 'utf8'));
          const ok = j.status === 'reviewed' && VERDICTS.has(j.verdict);
          status = ok ? 'valid' : 'invalid';
          verdict = ok ? j.verdict : null; findingsText = ok ? j.findings : ''; proofText = ok ? j.no_finding_proof : ''; error = j.error || null;
        } catch { status = 'invalid'; error = 'seat file missing or unreadable'; }
      }
      const prev = seats[n];
      // The same seat from two dirs: a valid answer beats anything else; otherwise keep the first.
      if (prev && (prev.status === 'valid' || status !== 'valid')) continue;
      seats[n] = { status, verdict, qualified: !!st.qualified, family: st.family, runner: st.runner, model: st.model, effort: st.effort, reason: st.reason || error || undefined, from: d, findingsText, proofText };
    }
  }
  const byId = new Map();
  const unparsed = {};
  for (const [n, s] of Object.entries(seats)) {
    if (s.status !== 'valid') continue;
    const { findings, unparsed: u } = parseFindings(s.findingsText);
    if (u.length) unparsed[n] = u;
    { const pa = parseAnswers(s.findingsText, s.proofText); s.answers = pa.answers; s.duplicate_answers = pa.duplicates; }
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
  const questions = [...questionSet].sort((a, b) => Number(a) - Number(b));
  const answers = {}; const missingAnswers = [];
  for (const q of questions) {
    answers[q] = {};
    for (const n of valid) { const a = seats[n].answers.find((x) => x.q === q); if (a) answers[q][n] = { conclusion: a.conclusion, basis: a.basis, counterexample: a.counterexample }; }
  }
  for (const n of valid) {
    const miss = questions.filter((q) => !answers[q][n]);
    if (miss.length) missingAnswers.push({ seat: n, questions: miss });
  }
  const merged = {
    round_valid: valid.length >= MIN_VALID,
    valid_seat_count: valid.length,
    min_valid_seats: MIN_VALID,
    qualified_seats: valid.filter((n) => seats[n].qualified),
    advisory_seats: valid.filter((n) => !seats[n].qualified),
    seat_states: Object.fromEntries(Object.entries(seats).map(([n, s]) => [n, { status: s.status, verdict: s.verdict, qualified: s.qualified, family: s.family, runner: s.runner, model: s.model, effort: s.effort, reason: s.reason, from: s.from, duplicate_answers: s.duplicate_answers }])),
    findings,
    questions,
    answers,
    missing_answers: missingAnswers,
    skipped_files: skippedFiles,
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
