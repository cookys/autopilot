#!/usr/bin/env node
'use strict';
/**
 * measure-streamjson-equivalence.js - BL-0372: are the claude `--output-format json` result and the converted
 * `stream-json --verbose` result equivalent for every json consumer?  Plan: project/plans/2026-11-04-bl-ap-streamjson-measurement.md.
 *
 *   plan     --profiles P1a,P1b,P2,P3 [--pairs 5] [--control-pairs 2] [--json]      zero calls: matrix + argv + argv-diff assertion
 *   run      --alias A --profile P [--pairs N] [--control-pairs M] --out DIR          REAL calls through claude-account.js
 *            [--deny-alias-pattern codepower] [--max-util 0.80] [--resume]            (only a session the operator named may run it)
 *   analyze  --in DIR --out report.json [--md report.md] [--hetero-script FILE]       zero calls: verdict from files
 *   selftest                                                                          zero calls: negative controls R1..R13
 *
 * Exit: 0 PASS; 1 FAIL; 2 usage; 3 a negative control did not turn red / extraction marker missing (instrument broken);
 *       4 skipped_near_cap; 5 aborted by 429 / auth failure / version change; 6 INCONCLUSIVE.
 *
 * The converter is imported from lib/claude-stream-envelope.js (no second rebuilder). `run` never reads a credential: it only
 * records the alias name and the token PATH (composed as a string, never opened). Built-ins only, Node >= 20.10.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { streamToEnvelope } = require('./lib/claude-stream-envelope.js');
const quota = require('./lib/account-quota.js');
const { tokenSeatError } = require('./lib/token-seat');
const { resolveLiveDir } = require('./lib/live-state-dir.js');
const { parseEnvelope } = require('./claude-account.js');
const { verifyClaudeRuntimeIdentity } = require('./qualification-review-provider.js');

const EXIT = { PASS: 0, FAIL: 1, USAGE: 2, INSTRUMENT: 3, NEAR_CAP: 4, ABORT: 5, INCONCLUSIVE: 6 };
const REPO = path.resolve(__dirname, '..');
const WRAPPER = path.join(__dirname, 'claude-account.js');
const PURPOSE = 'streamjson-measure';
const PROMPT = 'Reply with exactly one word: OK';

// ---------------------------------------------------------------- profiles and argv (plan 4.1)

const PROFILES = {
  P1a: { controlledSession: true, base: ['-p', '--session-id', '@SID@', '--model', 'haiku', '--strict-mcp-config', '--dangerously-skip-permissions', '--effort', 'low'], prompt: PROMPT },
  P1b: { controlledSession: true, base: ['-p', '--session-id', '@SID@', '--model', 'haiku', '--strict-mcp-config', '--dangerously-skip-permissions', '--effort', 'low', '--allowed-tools', 'Read'], prompt: 'Read the first line of a small file inside the repo, then answer OK', budgetPair: 3 },
  P2: { base: ['-p', '--model', 'haiku', '--setting-sources', '', '--strict-mcp-config', '--tools', ''], prompt: PROMPT },
  P3: { base: ['-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config'], prompt: 'say OK' },
  // J8/J9 (eval paths, PM round 2): shape of evals/orchestration and evals/pipeline-bench.
  P4: { base: ['-p', '--model', 'haiku', '--setting-sources', 'project', '--strict-mcp-config', '--dangerously-skip-permissions'], prompt: PROMPT },
  // D2: error path, a model that does not exist; the request is rejected.
  ERR: { controlledSession: true, base: ['-p', '--session-id', '@SID@', '--model', 'no-such-model', '--strict-mcp-config', '--dangerously-skip-permissions', '--effort', 'low'], prompt: PROMPT },
};

function fakeUuid(profile, id) {
  const h = crypto.createHash('sha256').update(`bl0372/${profile}/${id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// fmt: 'json' | 'stream-json'. The ONLY differences between arms are the format tokens (and the session id value).
function buildArgv(profile, fmt, pairId, arm) {
  const p = PROFILES[profile];
  if (!p) throw new Error('unknown_profile');
  const sid = fakeUuid(profile, `${pairId}-${arm}`);
  let a = p.base.map((x) => (x === '@SID@' ? sid : x));
  if (p.budgetPair && pairId === `p${p.budgetPair}`) a = a.concat(['--max-budget-usd', '0.5']);
  a = a.concat(['--output-format', fmt]);
  if (fmt === 'stream-json') a.push('--verbose');
  a.push(p.prompt);
  return { argv: ['claude'].concat(a), session_id_passed: p.controlledSession ? sid : null };
}

// Removes the three format tokens and the session-id value; the rest of the two argvs must be identical.
function normalise(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-format') { i++; continue; }
    if (argv[i] === '--verbose') continue;
    if (argv[i - 1] === '--session-id') { out.push('<sid>'); continue; }
    out.push(argv[i]);
  }
  return out;
}
function assertArgvDiff(jArgv, sArgv) {
  const a = JSON.stringify(normalise(jArgv)); const b = JSON.stringify(normalise(sArgv));
  if (a !== b) throw new Error(`argv_difference: the J and S argv differ beyond the format tokens: ${a} vs ${b}`);
}

function pairOrder(k) { return k % 2 === 1 ? ['J', 'S'] : ['S', 'J']; } // J first in odd pairs
function buildMatrix(profile, pairs, controlPairs) {
  const runs = [];
  for (let k = 1; k <= pairs; k++) {
    const pairId = `p${k}`;
    const arms = pairOrder(k);
    const built = arms.map((arm) => ({ arm, ...buildArgv(profile, arm === 'J' ? 'json' : 'stream-json', pairId, arm) }));
    assertArgvDiff(built.find((b) => b.arm === 'J').argv, built.find((b) => b.arm === 'S').argv);
    built.forEach((b) => runs.push({ profile, pairId, arm: b.arm, kind: 'js', argv: b.argv, session_id_passed: b.session_id_passed }));
  }
  for (let k = 1; k <= controlPairs; k++) {
    const pairId = `c${k}`;
    ['J1', 'J2'].forEach((arm) => {
      const b = buildArgv(profile, 'json', pairId, arm);
      runs.push({ profile, pairId, arm, kind: 'jj', argv: b.argv, session_id_passed: b.session_id_passed });
    });
  }
  return runs;
}

// ---------------------------------------------------------------- level tables (plan 2.2)

// Declared volatile values live at the TOP LEVEL of the envelope only (a path, not a key name anywhere): a `duration_ms` inside
// permission_denials[] is not declared and must be seen as a difference. Inside a declared subtree only numbers are masked.
const B_SCALAR = new Set(['duration_ms', 'duration_api_ms', 'ttft_ms', 'ttft_stream_ms', 'time_to_request_ms', 'first_content_frame_ms', 'total_cost_usd', 'uuid', 'queued_turn_count', 'result_index', 'session_id']);
const B_TREE = new Set(['usage', 'modelUsage', 'subagent_stats', 'model_usage_since_last_result']); // numbers inside are masked, keys stay
const isBLevel = (k) => B_SCALAR.has(k) || B_TREE.has(k);
// PM ruling 2026-11-04 (amendment to D3): the plan declares exactly ONE additive key. It may be present on the stream side only; it is
// removed byte-exactly (never masked, never re-serialised) before the layer-2 comparison. Any other extra key is a difference.
const ADDITIVE_KEYS = ['model_usage_since_last_result'];

// opts.strip: top-level keys to drop (key, value and its separator) from the output.
function maskRaw(text, opts) {
  const strip = (opts && opts.strip) || [];
  let i = 0;
  const bad = () => { throw new Error('mask_unparsable'); };
  const ws = () => { const s0 = i; while (i < text.length && ' \t\r\n'.includes(text[i])) i++; return text.slice(s0, i); };
  function str() {
    const s0 = i; if (text[i] !== '"') bad(); i++;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    if (i >= text.length) bad(); i++;
    return text.slice(s0, i);
  }
  function value(mode, depth) {
    // mode: 'keep' | 'num' (mask numbers only) | 'scalar' (mask the whole value by type)
    const c = text[i];
    if (c === '{') {
      i++;
      const open = ws();
      if (text[i] === '}') { i++; return mode === 'scalar' ? '"<object>"' : '{' + open + '}'; }
      const members = []; let seps = []; let close = '';
      for (;;) {
        const k = str(); const w1 = ws(); if (text[i] !== ':') bad(); i++; const w2 = ws();
        const key = JSON.parse(k);
        let child = mode === 'scalar' ? 'keep' : mode;
        if (mode === 'keep' && depth === 0) child = B_SCALAR.has(key) ? 'scalar' : (B_TREE.has(key) ? 'num' : 'keep');
        const v = value(child, depth + 1);
        const pre = ws();
        members.push({ key, text: k + w1 + ':' + w2 + v, drop: depth === 0 && mode === 'keep' && strip.includes(key) });
        if (text[i] === ',') { i++; seps.push(pre + ',' + ws()); } else { close = pre; break; }
      }
      if (text[i] !== '}') bad(); i++;
      if (mode === 'scalar') return '"<object>"';
      let out = '{' + open;
      const kept = members.map((m, n) => ({ m, sep: seps[n] })).filter((x) => !x.m.drop);
      kept.forEach((x, n) => { out += x.m.text + (n < kept.length - 1 ? x.sep : ''); });
      return out + close + '}';
    }
    if (c === '[') {
      i++;
      let out = '[' + ws();
      if (text[i] === ']') { i++; return mode === 'scalar' ? '"<array>"' : out + ']'; }
      for (;;) {
        out += value(mode === 'scalar' ? 'keep' : mode, depth + 1); out += ws();
        if (text[i] === ',') { out += ','; i++; out += ws(); } else break;
      }
      if (text[i] !== ']') bad(); i++;
      return mode === 'scalar' ? '"<array>"' : out + ']';
    }
    if (c === '"') { const t = str(); return mode === 'scalar' ? '"<string>"' : t; }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) bad();
    i += m[0].length;
    if (/^[-\d]/.test(m[0])) return mode === 'keep' ? m[0] : '"<number>"';
    return mode === 'scalar' ? (m[0] === 'null' ? '"<null>"' : '"<boolean>"') : m[0];
  }
  const lead = ws();
  const v = value('keep', 0);
  const tail = text.slice(i);
  return lead + v + tail;
}

function keyPaths(o, prefix, acc) {
  if (o && typeof o === 'object') {
    if (Array.isArray(o)) { o.forEach((x, n) => keyPaths(x, `${prefix}[${n}]`, acc)); return acc; }
    acc.push(`${prefix}{${Object.keys(o).join(',')}}`);
    for (const k of Object.keys(o)) keyPaths(o[k], `${prefix}.${k}`, acc);
  }
  return acc;
}
function firstDiffPath(a, b, prefix) {
  if (a === b) return null;
  const ao = a && typeof a === 'object'; const bo = b && typeof b === 'object';
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b)) return prefix || '$';
  const ka = Object.keys(a); const kb = Object.keys(b);
  if (ka.join('\u0000') !== kb.join('\u0000')) return `${prefix || '$'} (keys: ${ka.join(',')} vs ${kb.join(',')})`;
  for (const k of ka) { const d = firstDiffPath(a[k], b[k], `${prefix || '$'}.${k}`); if (d) return d; }
  return null;
}
function leafDiffs(a, b, prefix, acc) {
  const ao = a && typeof a === 'object'; const bo = b && typeof b === 'object';
  if (ao && bo && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) leafDiffs(a[k], b[k], prefix ? `${prefix}.${k}` : k, acc);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) acc.push(prefix);
  return acc;
}

// ---------------------------------------------------------------- hetero consumer extraction (plan 2.3)

class ExtractError extends Error {}
class InstrumentError extends ExtractError {} // an extracted consumer could not run: the instrument is broken, never a verdict
const HETERO_MARKERS = {
  log: `node - "$CCSHIM_ENVELOPE" "$LOG" <<'NODE'`,
  err: `node - "\${LOG:-}" "\${CCSHIM_ENVELOPE:-}" "\${IS_CCSHIM:-0}" "\${IS_OPENCODE:-0}" <<'NODE'`,
};
function extractHetero(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { throw new ExtractError('hetero_script_unreadable'); }
  const lines = text.split('\n');
  const out = {};
  for (const [name, marker] of Object.entries(HETERO_MARKERS)) {
    const s = lines.findIndex((l) => l.includes(marker));
    if (s < 0) throw new ExtractError(`hetero_marker_missing:${name}`);
    const e = lines.findIndex((l, n) => n > s && l === 'NODE');
    if (e < 0) throw new ExtractError(`hetero_block_end_missing:${name}`);
    out[name] = lines.slice(s + 1, e).join('\n') + '\n';
  }
  return out;
}

function runHeteroBlocks(blocks, envBytes, tmp, tag) {
  const envFile = path.join(tmp, `env-${tag}`); fs.writeFileSync(envFile, envBytes);
  const logFile = path.join(tmp, `log-${tag}`); fs.writeFileSync(logFile, '');
  const f1 = path.join(tmp, 'b-log.js'); const f2 = path.join(tmp, 'b-err.js');
  fs.writeFileSync(f1, blocks.log); fs.writeFileSync(f2, blocks.err);
  const r1 = spawnSync(process.execPath, [f1, envFile, logFile], { encoding: 'utf8' });
  const r2 = spawnSync(process.execPath, [f2, logFile, envFile, '1', '0'], { encoding: 'utf8' });
  for (const [name, r] of [['log', r1], ['err', r2]]) {
    if (r.error || r.status !== 0) throw new InstrumentError(`hetero_block_failed:${name}`);
  }
  return { log: fs.readFileSync(logFile).toString('latin1'), err: r2.stdout };
}

// ---------------------------------------------------------------- consumers (layer 1)

function consumeAll(bytes, blocks, tmp, tag, model) {
  const res = {};
  const h = runHeteroBlocks(blocks, bytes, tmp, tag);
  res.hetero_log_bytes = h.log;
  res.hetero_error_lines = h.err;
  const env = parseEnvelope(bytes);
  res.wrapper_parse = JSON.stringify(env ? { is_error: env.is_error, api_error_status: env.api_error_status, result: env.result, type: env.type } : null);
  try { res.qualification = 'ok:' + JSON.stringify(verifyClaudeRuntimeIdentity(bytes, model)); } catch (e) { res.qualification = 'throw:' + e.message; }
  res.onboard_grep = String(/"is_error": ?false/.test(bytes));
  let cost = 'unparsable';
  try { const c = JSON.parse(bytes).total_cost_usd; cost = Number.isFinite(c) && c >= 0 ? 'finite_nonneg' : typeof c; } catch (_) { /* keep */ }
  res.benchmark_cost_type = cost;
  // J8: `grep -o '"session_id":"[^"]*"' | cut -d'"' -f4 | head -n1` reads the FIRST match anywhere in the line, so the captured VALUE must be
  // the envelope's own top-level session_id (a session_id inside a nested object that comes first would be captured instead).
  // The two arms carry different session ids by design, so equality is checked against each arm's own top level (and against the id the
  // harness passed, by the session_rewritten flag); the *_self keys must be 'ok' on both arms.
  const g = /"session_id":"([^"]*)"/.exec(bytes);
  let top = null; try { top = JSON.parse(bytes).session_id; } catch (_) { /* unparsable */ }
  res.j8_session_value_self = g && typeof top === 'string' && g[1] === top ? 'ok' : (g ? 'captured_value_is_not_the_top_level_session_id' : 'no_match');
  // J9: json.loads(line) per line, then .usage. Compared: every field name with its type, per arm, and the extracted usage must equal the
  // arm's own top-level usage (the numeric values are declared B-level, they vary with caching, so they are not compared across arms).
  try {
    const lines = bytes.split('\n').filter(Boolean);
    const usages = lines.map((l) => JSON.parse(l).usage);
    const u = usages[0];
    res.j9_usage_lines = String(lines.length);
    res.j9_usage_fields = u && typeof u === 'object' ? Object.keys(u).map((k) => `${k}:${Array.isArray(u[k]) ? 'array' : typeof u[k]}`).join(',') : 'none';
    // The comparison value is parsed on its own (whole envelope, top-level usage), not by the expression that produced `u`.
    let topU; try { topU = JSON.parse(bytes).usage; } catch (_) { topU = undefined; }
    res.j9_usage_self = JSON.stringify(u) === JSON.stringify(topU) ? 'ok' : 'differs';
  } catch (_) { res.j9_usage_lines = 'unparsable'; res.j9_usage_fields = 'unparsable'; res.j9_usage_self = 'unparsable'; }
  return res;
}

// ---------------------------------------------------------------- analyze

function readRun(dir, profile, pairId, arm) {
  const base = path.join(dir, profile, `${pairId}-${arm}`);
  const rd = (ext) => { try { return fs.readFileSync(`${base}.${ext}`, 'utf8'); } catch (_) { return null; } };
  const stdout = rd('stdout'); const stderr = rd('stderr'); const runj = rd('run.json');
  if (stdout === null || stderr === null || runj === null) return null;
  let run = null; try { run = JSON.parse(runj); } catch (_) { return null; }
  return { stdout, stderr, run };
}

function modelOf(profile) {
  const a = PROFILES[profile].base; return a[a.indexOf('--model') + 1];
}

function analyzeProfile(dir, profile, opts, blocks, tmp) {
  const convert = opts.convert || streamToEnvelope;
  const pdir = path.join(dir, profile);
  const names = fs.existsSync(pdir) ? fs.readdirSync(pdir) : [];
  const pairIds = [...new Set(names.filter((n) => n.endsWith('.run.json')).map((n) => n.replace(/-(J|S|J1|J2)\.run\.json$/, '')))];
  const jsPairs = pairIds.filter((x) => x.startsWith('p')).sort((a, b) => +a.slice(1) - +b.slice(1));
  const ccPairs = pairIds.filter((x) => x.startsWith('c')).sort((a, b) => +a.slice(1) - +b.slice(1));
  const out = {
    pairs: jsPairs.length, control_pairs: ccPairs.length,
    layer1: { hetero_log_bytes: 'equal', hetero_error_lines: 'equal', wrapper_parse: 'equal', qualification: 'equal', onboard_grep: 'equal', benchmark_cost_type: 'equal', j8_session_value_self: 'equal', j9_usage_lines: 'equal', j9_usage_fields: 'equal', j9_usage_self: 'equal' },
    layer2: { result: 'identical', first_diff_path: null, key_order: 'same', additive_keys_removed: [] },
    exit_codes: 'equal', stderr: 'equal', stderr_nonempty: false,
    noise_floor: { fields_differing_in_control_pairs: [] },
    stream: { rate_limit_event_runs: 0, rate_limit_events: 0, system_init_present: false },
    flags: { incomplete: false, converter_failed: false, session_rewritten: false, a_level_noise: false, text_drift: false },
  };
  if (jsPairs.length === 0) { out.flags.incomplete = true; return out; }
  const rank = { identical: 0, identical_after_mask: 1, differs: 2 };
  for (const pairId of jsPairs) {
    const J = readRun(dir, profile, pairId, 'J'); const S = readRun(dir, profile, pairId, 'S');
    if (!J || !S) { out.flags.incomplete = true; continue; }
    const conv = convert(S.stdout);
    if (!conv || conv.ok !== true) { out.flags.converter_failed = true; out.layer2.result = 'differs'; out.layer2.first_diff_path = out.layer2.first_diff_path || '(no result line in stream)'; continue; }
    const sBytes = conv.bytes;
    // layer 1
    const cj = consumeAll(J.stdout, blocks, tmp, `${profile}-${pairId}-J`, modelOf(profile));
    const cs = consumeAll(sBytes, blocks, tmp, `${profile}-${pairId}-S`, modelOf(profile));
    for (const k of Object.keys(cj)) if (cj[k] !== cs[k]) out.layer1[k] = 'differs';
    // a value that must match the arm's own envelope is wrong on either arm, whatever the other arm shows
    for (const k of Object.keys(cj)) if (k.endsWith('_self') && (cj[k] !== 'ok' || cs[k] !== 'ok')) out.layer1[k] = 'differs';
    // layer 2
    let r; let diffPath = null;
    // The declared additive key(s): present on the stream side, absent on the json side -> removed exactly from the stream side.
    let strip = [];
    try {
      const jo = JSON.parse(J.stdout); const so = JSON.parse(sBytes);
      strip = ADDITIVE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(so, k) && !Object.prototype.hasOwnProperty.call(jo, k));
    } catch (_) { /* layer 1 / the mask will report it */ }
    for (const k of strip) if (!out.layer2.additive_keys_removed.includes(k)) out.layer2.additive_keys_removed.push(k);
    if (J.stdout === sBytes) r = 'identical';
    else {
      let mj; let ms;
      try { mj = maskRaw(J.stdout); ms = maskRaw(sBytes, { strip }); } catch (_) { mj = J.stdout; ms = sBytes; }
      if (mj === ms) r = 'identical_after_mask';
      else {
        r = 'differs';
        try { diffPath = firstDiffPath(JSON.parse(mj), JSON.parse(ms), '') || '(raw bytes: whitespace / trailing newline)'; } catch (_) { diffPath = '(unparsable)'; }
      }
    }
    if (rank[r] > rank[out.layer2.result]) { out.layer2.result = r; if (diffPath) out.layer2.first_diff_path = out.layer2.first_diff_path || diffPath; }
    try {
      const kp = (t) => keyPaths(JSON.parse(t), '$', []).join('|');
      const ks = strip.length ? maskRaw(sBytes, { strip }) : sBytes; // key sets compared after the declared additive key is removed
      if (kp(J.stdout) !== kp(ks)) out.layer2.key_order = 'differs';
    } catch (_) { out.layer2.key_order = 'differs'; }
    if (J.run.exit !== S.run.exit) out.exit_codes = 'differs';
    if (J.stderr !== S.stderr) out.stderr = 'differs';
    if (J.stderr.length > 0 || S.stderr.length > 0) out.stderr_nonempty = true;
    // controlled session id (C level)
    if (PROFILES[profile].controlledSession) {
      for (const [arm, bytes, run] of [['J', J.stdout, J.run], ['S', sBytes, S.run]]) {
        try { if (run.session_id_passed && JSON.parse(bytes).session_id !== run.session_id_passed) out.flags.session_rewritten = true; } catch (_) { /* layer 1 sees it */ void arm; }
      }
    }
    // stream facts
    const evs = S.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    const rl = evs.filter((e) => e.type === 'rate_limit_event').length;
    if (rl > 0) out.stream.rate_limit_event_runs++;
    out.stream.rate_limit_events += rl;
    if (evs.some((e) => e.type === 'system' && e.subtype === 'init')) out.stream.system_init_present = true;
  }
  // noise floor
  const noise = new Set();
  for (const pairId of ccPairs) {
    const a = readRun(dir, profile, pairId, 'J1'); const b = readRun(dir, profile, pairId, 'J2');
    if (!a || !b) { out.flags.incomplete = true; continue; }
    try {
      for (const p of leafDiffs(JSON.parse(a.stdout), JSON.parse(b.stdout), '', [])) {
        noise.add(p);
        const top = p.split('.')[0];
        if (!isBLevel(top) && !(PROFILES[profile].controlledSession && top === 'session_id')) {
          out.flags.a_level_noise = true;
          if (top === 'result') out.flags.text_drift = true;
        }
      }
    } catch (_) { out.flags.a_level_noise = true; }
  }
  out.noise_floor.fields_differing_in_control_pairs = [...noise].sort();
  return out;
}

function analyzeDir(dir, opts) {
  const o = opts || {};
  const blocks = extractHetero(o.heteroScript || path.join(REPO, 'scripts', 'dispatch-hetero.sh'));
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl0372-an-'));
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); } catch (_) { /* optional */ }
    let resume = {}; try { resume = JSON.parse(fs.readFileSync(path.join(dir, 'resume.json'), 'utf8')); } catch (_) { /* optional */ }
    const profiles = {};
    const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && PROFILES[d.name]).map((d) => d.name).sort();
    for (const p of dirs) profiles[p] = analyzeProfile(dir, p, o, blocks, tmp);
    const fail = []; const inconc = []; const runState = [];
    let runsTotal = 0; let runsFailed = 0;
    for (const p of dirs) {
      for (const n of fs.readdirSync(path.join(dir, p)).filter((x) => x.endsWith('.run.json'))) {
        runsTotal++;
        // runs_failed counts runs (the unit of runs_total) with a non-zero exit; the error-path profile is expected to fail and is left out.
        try { if (p !== 'ERR' && JSON.parse(fs.readFileSync(path.join(dir, p, n), 'utf8')).exit !== 0) runsFailed++; } catch (_) { /* counted as incomplete elsewhere */ }
      }
      // The persisted expected matrix: every expected artifact must exist before a PASS is possible.
      let exp = null; try { exp = JSON.parse(fs.readFileSync(path.join(dir, p, 'expected.json'), 'utf8')); } catch (_) { /* reported below */ }
      if (!exp || !Array.isArray(exp.ids)) { runState.push(`${p}:no_expected_matrix`); continue; }
      const missing = exp.ids.filter((id) => !['stdout', 'stderr', 'run.json'].every((ext) => fs.existsSync(path.join(dir, `${id}.${ext}`))));
      if (missing.length) runState.push(`${p}:missing_artifacts:${missing.length}/${exp.ids.length}`);
    }
    if (resume.status !== 'complete') runState.push(`resume:${resume.status || 'missing'}`);
    for (const [p, r] of Object.entries(profiles)) {
      for (const [k, v] of Object.entries(r.layer1)) if (v !== 'equal') fail.push(`${p}:layer1:${k}`);
      if (r.layer2.result === 'differs') fail.push(`${p}:layer2:differs`);
      if (r.layer2.key_order !== 'same') fail.push(`${p}:layer2:key_order`);
      if (r.exit_codes !== 'equal') fail.push(`${p}:exit_codes`);
      if (r.stderr !== 'equal') fail.push(`${p}:stderr`);
      if (r.flags.converter_failed) fail.push(`${p}:converter_failed`);
      if (r.flags.session_rewritten) fail.push(`${p}:session_id_rewritten`);
      if (r.flags.a_level_noise) inconc.push(`${p}:a_level_field_differs_in_control_pairs`);
      if (r.flags.incomplete) inconc.push(`${p}:incomplete`);
    }
    if (meta.claude_version && meta.claude_version_end && meta.claude_version !== meta.claude_version_end) inconc.push('claude_version_changed');
    if (dirs.length === 0) inconc.push('no_profiles');
    // A batch that stopped (429, auth, cap, version change, still running) or lacks expected artifacts is never judged on its partial data.
    const verdict = runState.length ? 'INCONCLUSIVE' : (fail.length ? 'FAIL' : (inconc.length ? 'INCONCLUSIVE' : 'PASS'));
    const notes = [];
    for (const [p, r] of Object.entries(profiles)) {
      if (r.flags.text_drift) notes.push(`${p}: result text drifted between control runs; compare structure only`);
    }
    notes.push('runs_failed counts runs with a non-zero exit, excluding the error-path profile ERR (its failure is expected).');
    notes.push('J2/J3 (hetero registry-absent branches) are measured per argv shape and recorded only; C2 does not touch that path and nothing is switched.');
    return {
      schema_version: 1, verdict,
      claude_version: meta.claude_version || null, runs_total: runsTotal,
      runs_failed: runsFailed,
      profiles, fail_reasons: fail, inconclusive_reasons: runState.concat(inconc),
      negative_controls: o.negativeControls || null, notes,
    };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function renderMd(report) {
  const L = [`# BL-0372 stream-json equivalence report`, '', `Verdict: **${report.verdict}** (claude ${report.claude_version || 'unknown'}, ${report.runs_total} runs)`, ''];
  if (report.fail_reasons.length) L.push('Fail reasons: ' + report.fail_reasons.join(', '), '');
  if (report.inconclusive_reasons.length) L.push('Inconclusive reasons: ' + report.inconclusive_reasons.join(', '), '');
  L.push('| Profile | pairs | layer2 | key order | exit | stderr | rate_limit_event runs |', '|---|---|---|---|---|---|---|');
  for (const [p, r] of Object.entries(report.profiles)) L.push(`| ${p} | ${r.pairs} | ${r.layer2.result} | ${r.layer2.key_order} | ${r.exit_codes} | ${r.stderr} | ${r.stream.rate_limit_event_runs} |`);
  L.push('', ...report.notes.map((n) => `- ${n}`), '');
  return L.join('\n');
}

// ---------------------------------------------------------------- run (real calls through the account wrapper)

function readUtil(liveBase, alias) {
  try {
    const raw = quota.readSnapshotFile(liveBase, alias);
    if (!raw || raw.__error) return { five_hour: null, seven_day: null };
    return { five_hour: raw.five_hour ? raw.five_hour.pct : null, seven_day: raw.seven_day ? raw.seven_day.pct : null };
  } catch (_) { return { five_hour: null, seven_day: null }; }
}
// Returns null when fine, or a reason string. Unknown quota blocks too (stale > 6 h, absent, invalid); expired windows are fine.
function quotaGate(liveBase, alias, maxUtil) {
  const q = quota.readQuota(alias, { liveBase });
  if (q.state === 'known') return q.used >= maxUtil ? `utilization_${q.used}` : null;
  return q.note === 'quota_windows_expired' ? null : `quota_unknown_${q.note || 'absent'}`;
}

function writeJson(f, o) { fs.writeFileSync(f, JSON.stringify(o, null, 1) + '\n'); }
function claudeVersion(env) {
  const seatErr = tokenSeatError(env || {});
  if (seatErr) {
    const err = new Error(seatErr);
    err.code = 'TOKEN_SEAT_MISSING';
    throw err;
  }
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', env });
  return (r.stdout || '').trim().slice(0, 200);
}

// Plan totals: 5 J/S + 2 J/J pairs = 14 calls; P4 (J8/J9) is 5 J/S + 1 J/J = 12 (plan item 7); ERR is one J/S pair = 2.
function defaultControl(profile) { return profile === 'ERR' ? 0 : (profile === 'P4' ? 1 : 2); }
function planTotalFor(profile) { return profile === 'ERR' ? 2 : (profile === 'P4' ? 12 : 14); }
const STOP_STATUS = new Set([401, 402, 403, 429, 503, 529]);
// The api_error_status of the run's result envelope when it is a stop condition, else null (a missing model is 404/400 and is expected).
function stopStatus(stdoutFile) {
  try {
    const env = parseEnvelope(fs.readFileSync(stdoutFile, 'utf8'));
    if (env && env.is_error === true && STOP_STATUS.has(env.api_error_status)) return `api_error_status_${env.api_error_status}`;
  } catch (_) { /* unreadable: the exit code decides */ }
  return null;
}

function cmdRun(opts) {
  const alias = opts.alias; const profile = opts.profile; const out = opts.out;
  if (!alias || !profile || !out || !PROFILES[profile]) return usageErr('run needs --alias --profile --out');
  // Defaults equal `plan`'s: the error-path profile is ONE J/S pair and no control pair.
  const pairs = opts.pairs === undefined ? (profile === 'ERR' ? 1 : 5) : Number(opts.pairs);
  const control = opts['control-pairs'] === undefined ? defaultControl(profile) : Number(opts['control-pairs']);
  if (!Number.isInteger(pairs) || !Number.isInteger(control) || pairs < 0 || control < 0) return usageErr('pairs/control-pairs must be non-negative integers');
  // Hard cap: one run never makes more calls than the plan's total for that profile (5 J/S + 2 J/J pairs = 14 calls; ERR = 2).
  const planTotal = planTotalFor(profile);
  if (2 * (pairs + control) > planTotal) { process.stderr.write(`refused: ${2 * (pairs + control)} calls exceed the plan total of ${planTotal} for ${profile}; no call was made\n`); return EXIT.USAGE; }
  const deny = String(opts['deny-alias-pattern'] === undefined ? 'codepower' : opts['deny-alias-pattern']).toLowerCase();
  if (deny && alias.toLowerCase().includes(deny)) { process.stderr.write('refused: alias matches the deny pattern; no call was made\n'); return EXIT.USAGE; }
  // 0.80 is a ceiling: the knob can only lower it. NaN, Infinity, <= 0 and > 0.80 are refused.
  const maxUtil = opts['max-util'] === undefined ? 0.80 : Number(opts['max-util']);
  if (!Number.isFinite(maxUtil) || maxUtil <= 0 || maxUtil > 0.80) { process.stderr.write('refused: --max-util must be a number in (0, 0.80]; no call was made\n'); return EXIT.USAGE; }
  let liveBase = null;
  try { liveBase = resolveLiveDir({ env: process.env, warn: () => {} }).base; } catch (_) { liveBase = null; }
  if (!liveBase) { process.stderr.write('refused: no live dir, the quota gate cannot run\n'); return EXIT.NEAR_CAP; }
  const matrix = buildMatrix(profile, pairs, control);
  fs.mkdirSync(path.join(out, profile), { recursive: true });
  const resumeFile = path.join(out, 'resume.json');
  let done = new Set();
  if (opts.resume) { try { done = new Set(JSON.parse(fs.readFileSync(resumeFile, 'utf8')).done || []); } catch (_) { /* fresh */ } }
  writeJson(path.join(out, profile, 'expected.json'), { ids: matrix.map((m) => `${m.profile}/${m.pairId}-${m.arm}`) }); // the persisted expected matrix analyze checks
  const accountsDir = process.env.AUTOPILOT_ACCOUNTS_DIR || '~/.config/autopilot/accounts';
  const metaFile = path.join(out, 'meta.json');
  const gate0 = quotaGate(liveBase, alias, maxUtil);
  if (gate0) { writeJson(resumeFile, { status: 'skipped_near_cap', done: [...done], next: null }); process.stderr.write(`skipped_near_cap: ${gate0}\n`); return EXIT.NEAR_CAP; }
  const version0 = claudeVersion(process.env); // after the quota gate: a skipped run starts nothing, not even --version
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { /* new */ }
  let sha = null; try { sha = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null; } catch (_) { /* optional */ }
  meta = Object.assign(meta, {
    claude_version: meta.claude_version || version0, alias, token_path: `${accountsDir}/${alias}/token`,
    argv_shape_hash: crypto.createHash('sha256').update(JSON.stringify(matrix.map((m) => normalise(m.argv)))).digest('hex').slice(0, 16),
    started_epoch_ms: meta.started_epoch_ms || Date.now(), started_taipei: meta.started_taipei || new Date(Date.now() + 8 * 3600e3).toISOString().replace('Z', '+08:00'), script_git_sha: sha,
  });
  const saveResume = (status, next) => writeJson(resumeFile, { status, done: [...done], next: next || null });
  const gate = (n) => { if (n % 10 === 0) { const g = quotaGate(liveBase, alias, maxUtil); if (g) return g; } return null; };
  let n = 0;
  for (const [idx, m] of matrix.entries()) {
    const id = `${m.profile}/${m.pairId}-${m.arm}`;
    if (done.has(id)) continue;
    const g = gate(n);
    if (g) { writeJson(metaFile, meta); saveResume('skipped_near_cap', id); process.stderr.write(`skipped_near_cap: ${g}\n`); return EXIT.NEAR_CAP; }
    if (n > 0 && n % 10 === 0 && claudeVersion(process.env) !== meta.claude_version) { meta.aborted = 'version_changed'; writeJson(metaFile, meta); saveResume('version_changed', id); return EXIT.ABORT; }
    const base = path.join(out, m.profile, `${m.pairId}-${m.arm}`);
    const t0 = Date.now();
    const util = readUtil(liveBase, alias);
    const r = spawnSync(process.execPath, [WRAPPER, 'run', '--alias', alias, '--purpose', PURPOSE, '--stdout', `${base}.stdout`, '--stderr', `${base}.stderr`, '--timeout', '300', '--'].concat(m.argv), { encoding: 'utf8', env: process.env });
    const exit = r.status === null ? -1 : r.status;
    for (const ext of ['stdout', 'stderr']) { if (!fs.existsSync(`${base}.${ext}`)) fs.writeFileSync(`${base}.${ext}`, ''); }
    writeJson(`${base}.run.json`, { exit, argv_digest: crypto.createHash('sha256').update(JSON.stringify(normalise(m.argv))).digest('hex').slice(0, 16), order_index: idx, started_at: t0, duration_ms_wall: Date.now() - t0, util_before: util, session_id_passed: m.session_id_passed });
    done.add(id); n++;
    saveResume('running', null);
    // 429 / no account / auth stop: stop the whole batch, never retry, in EVERY profile. The error-path profile (ERR) is expected to
    // fail only because the model does not exist; a rate-limit, auth or overload envelope there is as much a stop as anywhere.
    // 2 = invalid usage/registry/token, 3 = no account, 4 = rate limited, 6 = auth stop, 7 = token leak, -1 = could not start: none is a measurement result.
    const why = [-1, 2, 3, 4, 6, 7].includes(exit) ? `wrapper_exit_${exit}` : stopStatus(`${base}.stdout`);
    if (why) { meta.aborted = why; writeJson(metaFile, meta); saveResume('aborted', null); process.stderr.write(`aborted: ${why}\n`); if (r.stderr) process.stderr.write(`wrapper said: ${String(r.stderr).trim().slice(0, 300)}\n`); return EXIT.ABORT; }
  }
  meta.claude_version_end = claudeVersion(process.env);
  writeJson(metaFile, meta);
  saveResume('complete', null);
  return EXIT.PASS;
}

// ---------------------------------------------------------------- plan

function cmdPlan(opts) {
  const names = String(opts.profiles || 'P1a,P1b,P2,P3').split(',').filter(Boolean);
  const pairs = opts.pairs === undefined ? 5 : Number(opts.pairs);
  const all = [];
  try {
    for (const p of names) {
      if (!PROFILES[p]) return usageErr('unknown profile');
      all.push(...buildMatrix(p, p === 'ERR' ? 1 : pairs, p === 'ERR' ? 0 : (opts['control-pairs'] === undefined ? defaultControl(p) : Number(opts['control-pairs']))));
    }
  } catch (e) { process.stderr.write(e.message + '\n'); return EXIT.FAIL; }
  if (opts.json) process.stdout.write(JSON.stringify({ calls: all.length, runs: all }, null, 1) + '\n');
  else {
    process.stdout.write(`calls: ${all.length}\n`);
    for (const r of all) process.stdout.write(`${r.profile}/${r.pairId}-${r.arm}  ${r.argv.join(' ')}\n`);
  }
  return EXIT.PASS;
}

// ---------------------------------------------------------------- selftest (negative controls R1..R13)

const FIX = {
  duration_api_ms: 812, stop_reason: 'end_turn', session_id: 'S', total_cost_usd: 0.0034,
  usage: { input_tokens: 5, output_tokens: 1 }, modelUsage: { 'claude-haiku-5-5': { inputTokens: 5, outputTokens: 1 } },
  permission_denials: [], terminal_reason: 'completed', fast_mode_state: 'off', is_error: false, num_turns: 1,
  subtype: 'success', api_error_status: null, result: '\n\nOK', ttft_ms: 400, type: 'result', duration_ms: 900, uuid: 'U',
};

// Writes a synthetic data set for profile P1a (5 J/S pairs + 2 J/J control pairs), plus an optional ERR pair. Fixture input only.
function writeDataset(dir, o) {
  const opt = o || {};
  const pd = path.join(dir, 'P1a'); fs.mkdirSync(pd, { recursive: true });
  const put = (pairId, arm, fmt, n) => {
    const sid = fakeUuid('P1a', `${pairId}-${arm}`);
    const res = Object.assign({}, FIX, opt.denials ? { permission_denials: [{ tool_name: 'Read', duration_ms: opt.denials === 'vary' ? n : 7 }] } : {}, { session_id: sid, duration_ms: 900 + n, duration_api_ms: 800 + n, ttft_ms: 400 + n, total_cost_usd: 0.003 + n / 1e5, uuid: `U${n}-${arm}` });
    const line = JSON.stringify(res);
    let stdout;
    if (fmt === 'json') stdout = line + '\n';
    else {
      const evs = [JSON.stringify({ type: 'system', subtype: 'init', session_id: sid }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'OK' }] } })];
      if (opt.earlyResult) evs.push(JSON.stringify(Object.assign({}, res, { result: 'early', uuid: 'E' })));
      evs.push(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), line);
      stdout = evs.join('\n') + '\n';
    }
    const base = path.join(pd, `${pairId}-${arm}`);
    fs.writeFileSync(`${base}.stdout`, stdout); fs.writeFileSync(`${base}.stderr`, '');
    fs.writeFileSync(`${base}.run.json`, JSON.stringify({ exit: 0, session_id_passed: sid }));
  };
  let n = 0;
  for (let k = 1; k <= 5; k++) { put(`p${k}`, 'J', 'json', n++); put(`p${k}`, 'S', 'stream-json', n++); }
  for (let k = 1; k <= 2; k++) { put(`c${k}`, 'J1', 'json', n++); put(`c${k}`, 'J2', 'json', n++); }
  const ids = [];
  for (let k = 1; k <= 5; k++) ids.push(`P1a/p${k}-J`, `P1a/p${k}-S`);
  for (let k = 1; k <= 2; k++) ids.push(`P1a/c${k}-J1`, `P1a/c${k}-J2`);
  fs.writeFileSync(path.join(pd, 'expected.json'), JSON.stringify({ ids }));
  fs.writeFileSync(path.join(dir, 'resume.json'), JSON.stringify({ status: 'complete', done: ids, next: null }));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ claude_version: 'fixture', claude_version_end: 'fixture' }));
  return dir;
}
// Appends extra members before the last closing brace of the text (the result line is the last line of a stream).
function withExtra(t, extra) { const i = t.lastIndexOf('}'); return t.slice(0, i) + extra + t.slice(i); }
function mutateS(dir, fn) {
  const pd = path.join(dir, 'P1a');
  for (const f of fs.readdirSync(pd)) {
    const m = /^(p\d+)-S\.(stdout|stderr|run\.json)$/.exec(f);
    if (m) { const p = path.join(pd, f); fs.writeFileSync(p, fn(m[2], fs.readFileSync(p, 'utf8'), m[1])); }
  }
}

function runSelftest(opts) {
  const o = opts || {};
  const results = {};
  let tmp;
  const ds = (name, dsOpts, mut) => { const d = path.join(tmp, name); writeDataset(d, dsOpts); if (mut) mut(d); return d; };
  const A = (d, an) => analyzeDir(d, Object.assign({ heteroScript: o.heteroScript }, an || {}));
  const red = (rep) => rep.verdict === 'FAIL';
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bl0372-st-'));
    // positive baselines: the real converter passes on both shapes of data
    const base = A(ds('base'));
    const baseEarly = A(ds('base-early', { earlyResult: true }));
    results.baseline_pass = base.verdict === 'PASS' && baseEarly.verdict === 'PASS' ? 'green' : 'broken';
    const conv = (fn) => ({ convert: fn });
    // R1 trailing newline dropped: only layer 2 sees it
    const r1 = A(ds('r1'), conv((s) => { const r = streamToEnvelope(s); return { ok: r.ok, bytes: r.bytes.replace(/\n$/, '') }; }));
    results.R1 = red(r1) && r1.profiles.P1a.layer2.result === 'differs' && r1.profiles.P1a.layer1.hetero_log_bytes === 'equal' ? 'red' : 'MISSED';
    // R2 first result instead of last
    const r2 = A(ds('r2', { earlyResult: true }), conv((s) => { for (const l of s.split('\n')) { try { if (JSON.parse(l).type === 'result') return { ok: true, bytes: l + '\n' }; } catch (_) { /* skip */ } } return { ok: false, bytes: '' }; }));
    results.R2 = red(r2) && r2.profiles.P1a.layer1.wrapper_parse === 'differs' && r2.profiles.P1a.layer1.hetero_log_bytes === 'differs' ? 'red' : 'MISSED';
    // R3 assistant text instead of the result line
    const r3 = A(ds('r3'), conv((s) => { let t = ''; for (const l of s.split('\n')) { try { const j = JSON.parse(l); if (j.type === 'assistant') t = j.message.content[0].text; } catch (_) { /* skip */ } } return { ok: true, bytes: JSON.stringify({ type: 'result', result: t }) + '\n' }; }));
    results.R3 = red(r3) && r3.profiles.P1a.layer1.qualification === 'differs' ? 'red' : 'MISSED';
    // R4 result trimmed
    const r4 = A(ds('r4'), conv((s) => { const j = JSON.parse(streamToEnvelope(s).bytes); j.result = j.result.trim(); return { ok: true, bytes: JSON.stringify(j) + '\n' }; }));
    results.R4 = red(r4) && r4.profiles.P1a.layer1.hetero_log_bytes === 'differs' && r4.profiles.P1a.layer2.result === 'differs' ? 'red' : 'MISSED';
    // R5 re-serialised with indentation
    const r5 = A(ds('r5'), conv((s) => ({ ok: true, bytes: JSON.stringify(JSON.parse(streamToEnvelope(s).bytes), null, 2) + '\n' })));
    results.R5 = red(r5) && r5.profiles.P1a.layer2.result === 'differs' ? 'red' : 'MISSED';
    // R6 key reorder (type first): layer 2 key_order red, layer 1 all green
    const r6 = A(ds('r6'), conv((s) => { const j = JSON.parse(streamToEnvelope(s).bytes); const { type, ...rest } = j; return { ok: true, bytes: JSON.stringify(Object.assign({ type }, rest)) + '\n' }; }));
    const l1ok = Object.values(r6.profiles.P1a.layer1).every((v) => v === 'equal');
    results.R6 = red(r6) && r6.profiles.P1a.layer2.key_order === 'differs' && l1ok ? 'red' : 'MISSED';
    // R7 one byte of stderr on the S arm
    const r7 = A(ds('r7', null, (d) => mutateS(d, (ext, t) => (ext === 'stderr' ? 'x' : t))));
    results.R7 = red(r7) && r7.profiles.P1a.stderr === 'differs' ? 'red' : 'MISSED';
    // R8 different exit code
    const r8 = A(ds('r8', null, (d) => mutateS(d, (ext, t) => (ext === 'run.json' ? JSON.stringify(Object.assign(JSON.parse(t), { exit: 1 })) : t))));
    results.R8 = red(r8) && r8.profiles.P1a.exit_codes === 'differs' ? 'red' : 'MISSED';
    // R9 A-level field num_turns changed on the S arm
    const r9 = A(ds('r9', null, (d) => mutateS(d, (ext, t) => (ext === 'stdout' ? t.replace(/"num_turns":1/g, '"num_turns":2') : t))));
    results.R9 = red(r9) && r9.profiles.P1a.layer2.result === 'differs' ? 'red' : 'MISSED';
    // R10 positive control: a B-level field changes -> must stay PASS; an undeclared field changes -> must turn red
    const r10 = A(ds('r10', null, (d) => mutateS(d, (ext, t) => (ext === 'stdout' ? t.replace(/"duration_ms":\d+/g, '"duration_ms":123456') : t))));
    results.R10 = r10.verdict === 'PASS' ? 'green' : 'MISSED';
    const r10b = A(ds('r10b', null, (d) => mutateS(d, (ext, t) => (ext === 'stdout' ? t.replace(/"fast_mode_state":"off"/g, '"fast_mode_state":"on"') : t))));
    results.R10_undeclared_field = red(r10b) && r10b.profiles.P1a.layer2.result === 'differs' ? 'red' : 'MISSED';
    // PM amendment: the one declared additive key may appear on the stream side only (removed exactly); a second extra key is a FAIL.
    const addKey = ',"model_usage_since_last_result":{"claude-haiku-5-5":{"inputTokens":5}}';
    const rAdd = A(ds('add-ok', null, (d) => mutateS(d, (e, t) => (e === 'stdout' ? withExtra(t, addKey) : t))));
    results.ADD_POSITIVE = rAdd.verdict === 'PASS' && rAdd.profiles.P1a.layer2.result === 'identical_after_mask' && rAdd.profiles.P1a.layer2.additive_keys_removed.join() === 'model_usage_since_last_result' ? 'green' : 'MISSED';
    const rAdd2 = A(ds('add-two', null, (d) => mutateS(d, (e, t) => (e === 'stdout' ? withExtra(t, addKey + ',"x_undeclared":1') : t))));
    results.ADD_SECOND_KEY = red(rAdd2) && rAdd2.profiles.P1a.layer2.result === 'differs' ? 'red' : 'MISSED';
    // J8 reads the FIRST "session_id":"..." in the line. A wrong one inside the additive object, placed before the top-level one, is
    // removed by layer 2 but is what the consumer would capture: layer 1 must call it a FAIL.
    const wrongFirst = (t) => t.replace('"stop_reason":"end_turn",', '"stop_reason":"end_turn","model_usage_since_last_result":{"m":{"session_id":"wrong"}},');
    const rJ8 = A(ds('j8-nested', null, (d) => mutateS(d, (e, t) => (e === 'stdout' ? t.split('\n').map((l) => (l.includes('"type":"result"') ? wrongFirst(l) : l)).join('\n') : t))));
    results.J8_NESTED_WRONG_ID = red(rJ8) && rJ8.profiles.P1a.layer1.j8_session_value_self === 'differs' && rJ8.profiles.P1a.layer2.result === 'identical_after_mask' ? 'red' : 'MISSED';
    // J9 must see the usage of the envelope's own top level: a first line that carries another usage is a mismatch, not a pass.
    const rJ9 = A(ds('j9-mismatch'), conv((s0) => { const r0 = streamToEnvelope(s0); return { ok: r0.ok, bytes: JSON.stringify({ type: 'system', usage: { input_tokens: 999 } }) + '\n' + r0.bytes }; }));
    results.J9_USAGE_MISMATCH = red(rJ9) && rJ9.profiles.P1a.layer1.j9_usage_self === 'differs' ? 'red' : 'MISSED';
    // Masking is by declared path: a duration_ms inside permission_denials[] is not volatile.
    const rPath = A(ds('path', { denials: 'vary' }));
    results.MASK_PATH = red(rPath) && rPath.profiles.P1a.layer2.result === 'differs' ? 'red' : 'MISSED';
    const rPathOk = A(ds('path-ok', { denials: 'same' }));
    results.MASK_PATH_POSITIVE = rPathOk.verdict === 'PASS' ? 'green' : 'MISSED';
    // A stopped or partial batch is never a PASS, whatever its partial data says.
    const stateOk = [];
    for (const st of ['aborted', 'version_changed', 'running', 'skipped_near_cap']) {
      const rs = A(ds(`state-${st}`, null, (d) => fs.writeFileSync(path.join(d, 'resume.json'), JSON.stringify({ status: st, done: [], next: null }))));
      stateOk.push(rs.verdict === 'INCONCLUSIVE' && rs.inconclusive_reasons.includes(`resume:${st}`));
    }
    const rMiss = A(ds('state-missing', null, (d) => fs.unlinkSync(path.join(d, 'P1a', 'p5-S.stdout'))));
    stateOk.push(rMiss.verdict === 'INCONCLUSIVE' && rMiss.inconclusive_reasons.some((x) => x.startsWith('P1a:missing_artifacts')));
    const rNoExp = A(ds('state-noexp', null, (d) => fs.unlinkSync(path.join(d, 'P1a', 'expected.json'))));
    stateOk.push(rNoExp.verdict === 'INCONCLUSIVE' && rNoExp.inconclusive_reasons.includes('P1a:no_expected_matrix'));
    // a one-pair batch whose second arm never ran (429 on the second arm), with the complete-looking files of the first arm
    const rOne = A(ds('state-onepair', null, (d) => {
      const pd = path.join(d, 'P1a');
      for (const f of fs.readdirSync(pd)) if (!/^p1-/.test(f) && f !== 'expected.json') fs.unlinkSync(path.join(pd, f));
      fs.unlinkSync(path.join(pd, 'p1-S.stdout')); fs.unlinkSync(path.join(pd, 'p1-S.stderr')); fs.unlinkSync(path.join(pd, 'p1-S.run.json'));
      fs.writeFileSync(path.join(d, 'resume.json'), JSON.stringify({ status: 'aborted', done: ['P1a/p1-J'], next: null }));
    }));
    stateOk.push(rOne.verdict === 'INCONCLUSIVE');
    results.PARTIAL_NEVER_PASS = stateOk.every(Boolean) ? 'red' : 'MISSED';
    // An extracted consumer that cannot run (markers intact, block broken) is an instrument failure, not a verdict.
    const hs0 = o.heteroScript || path.join(REPO, 'scripts', 'dispatch-hetero.sh');
    const broken = path.join(tmp, 'hetero-broken.sh');
    const src = fs.readFileSync(hs0, 'utf8').split('\n');
    const bi = src.findIndex((l) => l.includes(HETERO_MARKERS.log));
    src.splice(bi + 1, 0, 'process.exit(7);');
    fs.writeFileSync(broken, src.join('\n'));
    let rb = 'MISSED'; try { analyzeDir(path.join(tmp, 'base'), { heteroScript: broken }); } catch (e) { if (e instanceof InstrumentError) rb = 'red'; }
    results.BLOCK_FAILS = rb;
    // R13 hetero marker renamed on a copy: extraction must fail
    const hs = o.heteroScript || path.join(REPO, 'scripts', 'dispatch-hetero.sh');
    const copy = path.join(tmp, 'hetero-renamed.sh');
    fs.writeFileSync(copy, fs.readFileSync(hs, 'utf8').replace(HETERO_MARKERS.log, HETERO_MARKERS.log.replace('<<', '<< ').replace('CCSHIM_ENVELOPE', 'CCSHIM_RENAMED')));
    let r13 = 'MISSED'; try { analyzeDir(path.join(tmp, 'base'), { heteroScript: copy }); } catch (e) { if (e instanceof ExtractError) r13 = 'red'; }
    results.R13 = r13;
    // R11 / R12 go through the real `run` path with the claude shim: zero calls
    Object.assign(results, runGateControls(tmp));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const expected = (k) => (['R10', 'baseline_pass', 'ADD_POSITIVE', 'MASK_PATH_POSITIVE'].includes(k) ? 'green' : 'red');
  const ok = Object.keys(results).every((k) => results[k] === expected(k));
  return { ok, results };
}

// R11 (alias contains the deny pattern) and R12 (utilization 0.85): `run` must refuse before any call.
function runGateControls(tmp) {
  const { makeFixture } = require('./lib/account-fixtures/shim-install.js');
  const res = {};
  const spawnRun = (fx, alias, out) => spawnSync(process.execPath, [__filename, 'run', '--alias', alias, '--profile', 'P2', '--pairs', '1', '--control-pairs', '0', '--out', out], { env: fx.env, encoding: 'utf8' });
  // A healthy quota snapshot, so only the alias deny pattern can stop this run (otherwise the unknown-quota gate would hide a broken deny check).
  const fx1 = makeFixture({ aliases: [{ alias: 'my-codepower-1' }], snapshots: { 'my-codepower-1': { schema: 'codeforge.quota/1', alias: 'my-codepower-1', root: null, written_at_ms: Date.now(), five_hour: { pct: 0.1, resets_at: Math.floor(Date.now() / 1000) + 3600 } } } });
  try {
    const r = spawnRun(fx1, 'my-codepower-1', path.join(tmp, 'o11'));
    res.R11 = r.status === EXIT.USAGE && fx1.shim.calls().length === 0 ? 'red' : 'MISSED';
  } finally { fx1.cleanup(); }
  const fx2 = makeFixture({ aliases: [{ alias: 'a' }], snapshots: { a: { schema: 'codeforge.quota/1', alias: 'a', root: null, written_at_ms: Date.now(), five_hour: { pct: 0.85, resets_at: Math.floor(Date.now() / 1000) + 3600 } } } });
  try {
    const r = spawnRun(fx2, 'a', path.join(tmp, 'o12'));
    res.R12 = r.status === EXIT.NEAR_CAP && fx2.shim.calls().length === 0 && /utilization/.test(r.stderr) ? 'red' : 'MISSED';
  } finally { fx2.cleanup(); }
  return res;
}

// ---------------------------------------------------------------- CLI

function usageErr(msg) { process.stderr.write(`usage: ${msg}\n`); return EXIT.USAGE; }
function parseFlags(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) return null;
    const k = a.slice(2);
    if (['json', 'resume'].includes(k)) o[k] = true;
    else { if (i + 1 >= argv.length) return null; o[k] = argv[++i]; }
  }
  return o;
}

function main(argv) {
  const sub = argv[0];
  const opts = parseFlags(argv.slice(1));
  if (!sub || opts === null) return usageErr('measure-streamjson-equivalence.js plan|run|analyze|selftest [flags]');
  if (sub === 'plan') return cmdPlan(opts);
  if (sub === 'run') return cmdRun(opts);
  if (sub === 'selftest') {
    const r = runSelftest({ heteroScript: opts['hetero-script'] });
    for (const [k, v] of Object.entries(r.results)) process.stdout.write(`${k}: ${v}\n`);
    return r.ok ? EXIT.PASS : EXIT.INSTRUMENT;
  }
  if (sub === 'analyze') {
    if (!opts.in || !opts.out) return usageErr('analyze needs --in and --out');
    let st;
    let report;
    try {
      extractHetero(opts['hetero-script'] || path.join(REPO, 'scripts', 'dispatch-hetero.sh')); // a missing marker stops here, before the selftest
      // --negative-controls-file reuses a selftest result already computed (tests only; the default recomputes it).
      st = opts['negative-controls-file'] ? JSON.parse(fs.readFileSync(opts['negative-controls-file'], 'utf8')) : runSelftest({ heteroScript: opts['hetero-script'] });
      report = analyzeDir(opts.in, { heteroScript: opts['hetero-script'], negativeControls: st.results });
    } catch (e) {
      if (e instanceof ExtractError) { process.stderr.write(`instrument broken: ${e.message}\n`); return EXIT.INSTRUMENT; }
      throw e;
    }
    if (!st.ok) { report.verdict = 'INCONCLUSIVE'; report.inconclusive_reasons.push('selftest_not_all_red'); }
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
    if (opts.md) fs.writeFileSync(opts.md, renderMd(report));
    process.stdout.write(`verdict: ${report.verdict}\n`);
    if (!st.ok) return EXIT.INSTRUMENT;
    return report.verdict === 'PASS' ? EXIT.PASS : (report.verdict === 'FAIL' ? EXIT.FAIL : EXIT.INCONCLUSIVE);
  }
  return usageErr('unknown subcommand');
}

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`error: ${e.message}\n`); code = e instanceof ExtractError ? EXIT.INSTRUMENT : EXIT.USAGE; }
  process.exitCode = code;
}

module.exports = { ADDITIVE_KEYS, InstrumentError, EXIT, PROFILES, buildArgv, buildMatrix, assertArgvDiff, maskRaw, extractHetero, ExtractError, analyzeDir, runSelftest, writeDataset, mutateS, quotaGate, HETERO_MARKERS };
