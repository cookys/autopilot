#!/usr/bin/env node
'use strict';

// engine-qualify-va.test.js — P3 acceptance for `engine-qualify.sh
// verification_author` (frozen plan §7/§8). A mock candidate solves cases from
// the VISIBLE envelope alone (clause-path tree reconstruction — living proof
// the rendered spec is sufficient); deviant modes prove every red line fires
// end-to-end through the REAL sandbox transport; transport-parity and
// fail-closed paths are exercised.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runVaQualification,
  verifySandboxRuntime,
} = require('./engine-qualify');
const g = require('../evals/va-eval-generator');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-va-qualify-test-'));
const panelPath = path.join(tempRoot, 'va-panel.js');
let assertions = 0;
function check(value, message) { assertions += 1; assert.ok(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepStrictEqual(actual, expected, message); }

// ── the spec-only mock candidate ─────────────────────────────────────────────
// Reads the envelope on stdin, reconstructs the behavior tree from clause IDs
// (the id path IS the structure), evaluates it to derive declarations, and
// emits a declared plan. Modes exercise the deviant matrix.

fs.writeFileSync(panelPath, `'use strict';
const fs = require('fs');
const mode = process.argv[2] || 'perfect';
const env = JSON.parse(fs.readFileSync(0, 'utf8'));
if (mode === 'lazy') { process.stdout.write(''); process.exit(0); }
if (mode === 'malformed') { process.stdout.write('this is not json'); process.exit(0); }

const INVERT = [
  /^\\[(?<id>[^\\]]+)\\] In (?<fn>\\S+): (?<core>.*)$/,
  /^\\| (?<id>[^|]+) \\| (?<fn>[^|]+) \\| (?<core>.*) \\|$/,
  /^Clause (?<id>\\S+) — the function (?<fn>\\S+) (?<core>.*)$/,
];
function invert(line) {
  for (const re of INVERT) {
    const m = line.match(re);
    if (m) return { id: m.groups.id.trim(), fn: m.groups.fn.trim(), core: m.groups.core.trim() };
  }
  return null;
}

// Parse an exprDoc string into an evaluator closure over (args).
function parseExpr(text) {
  text = text.trim();
  let m;
  if ((m = text.match(/^floor\\((.+) \\* (\\d+) \\/ (\\d+)\\)$/)))
    { const inner = parseExpr(m[1]); const p = +m[2]; const q = +m[3];
      return (a) => Math.floor((inner(a) * p) / q); }
  if ((m = text.match(/^round\\((.+) \\* (\\d+) \\/ (\\d+)\\)$/)))
    { const inner = parseExpr(m[1]); const p = +m[2]; const q = +m[3];
      return (a) => Math.round((inner(a) * p) / q); }
  if ((m = text.match(/^map\\((.+): (.+)\\)$/))) {
    const of = parseExpr(m[1]);
    const pairs = m[2].split(', ').map((kv) => kv.split('->'));
    return (a) => { const k = of(a); const hit = pairs.find((p) => p[0] === k);
      return hit ? JSON.parse(hit[1]) : undefined; };
  }
  if ((m = text.match(/^(.+) in \\{(.+)\\}$/))) {
    const of = parseExpr(m[1]); const values = m[2].split('|');
    return (a) => values.includes(of(a));
  }
  if ((m = text.match(/^value-of-highest-key\\((.+); tie keeps (first|last)\\)$/))) {
    const of = parseExpr(m[1]); const tie = m[2];
    return (a) => { const pairs = of(a); let b = null;
      for (const [k, v] of pairs) if (b === null || k > b[0] || (k === b[0] && tie === 'last')) b = [k, v];
      return b === null ? undefined : b[1]; };
  }
  if ((m = text.match(/^(.+?) (<=|>=|<|>|==) (.+)$/))) {
    const l = parseExpr(m[1]); const op = m[2]; const r = parseExpr(m[3]);
    return (a) => { const lv = l(a); const rv = r(a);
      return op === '<=' ? lv <= rv : op === '>=' ? lv >= rv : op === '<' ? lv < rv
        : op === '>' ? lv > rv : lv === rv; };
  }
  if ((m = text.match(/^(.+?) (\\+|\\*) (.+)$/))) {
    const l = parseExpr(m[1]); const op = m[2]; const r = parseExpr(m[3]);
    return (a) => (op === '+' ? l(a) + r(a) : l(a) * r(a));
  }
  if ((m = text.match(/^input#(\\d+)$/))) { const i = +m[1]; return (a) => a[i]; }
  return () => JSON.parse(text);
}

// Rebuild per-function decision trees from clause id paths.
function buildTrees(lines) {
  const fns = {};
  for (const line of lines) {
    const c = invert(line);
    if (!c || c.id === 'module:state') continue;
    const [fnName, ...rest] = c.id.split(':');
    const pathId = rest.join(':');
    (fns[fnName] ||= { clauses: [] }).clauses.push({ path: pathId, core: c.core });
  }
  for (const fn of Object.values(fns)) {
    fn.domainDoc = fn.clauses.find((c) => c.path === 'domain');
    fn.node = assemble(fn.clauses.filter((c) => c.path !== 'domain'), 'body');
  }
  return fns;
}
function assemble(clauses, prefix) {
  const here = clauses.find((c) => c.path === prefix + '.if');
  if (here) {
    const cond = parseExpr(here.core.match(/^when \\((.+)\\) holds/)[1]);
    return { kind: 'cond', cond,
      then: assemble(clauses, prefix + '.then'),
      else: assemble(clauses, prefix + '.else') };
  }
  const ret = clauses.find((c) => c.path === prefix + '.ret');
  if (ret) {
    const value = parseExpr(ret.core.match(/^returns exactly (.+)$/)[1]);
    return { kind: 'ret', value };
  }
  const thr = clauses.find((c) => c.path === prefix + '.throw');
  if (thr) {
    const m = thr.core.match(/name "(.+)" and message "(.+)"/);
    return { kind: 'throw', name: m[1], token: m[2] };
  }
  const sadd = clauses.find((c) => c.path === prefix + '.sadd');
  if (sadd) return { kind: 'state_add' };
  const sreset = clauses.find((c) => c.path === prefix + '.sreset');
  if (sreset) return { kind: 'state_reset' };
  throw new Error('cannot assemble at ' + prefix);
}
function evalTree(node, args, state) {
  switch (node.kind) {
    case 'cond': return evalTree(node.cond(args) ? node.then : node.else, args, state);
    case 'ret': return { expected: { kind: 'returns', value: node.value(args) }, state };
    case 'throw': return { expected: { kind: 'throws', name: node.name, message_token: node.token }, state };
    case 'state_add': { const next = state + args[0];
      return { expected: { kind: 'returns', value: next }, state: next }; }
    case 'state_reset': return { expected: { kind: 'returns', value: 0 }, state: 0 };
    default: throw new Error('bad node');
  }
}

const fns = buildTrees(env.rendered_spec);
const surface = env.module_surface;
const budget = env.budget;

// Choose probe args per function from its documented domain.
function domainValues(param) {
  return param.domain.type === 'int'
    ? Array.from({ length: param.domain.max - param.domain.min + 1 },
        (_, i) => param.domain.min + i)
    : param.domain.values;
}
const steps = [];
const stateFns = Object.entries(fns).filter(([, f]) => ['state_add', 'state_reset']
  .includes(f.node.kind));
if (stateFns.length > 0 && mode !== 'happy') {
  // Stateful module: add, reset, add — mirrored through the tree fold.
  const addName = Object.keys(fns).find((n) => fns[n].node.kind === 'state_add');
  const resetName = Object.keys(fns).find((n) => fns[n].node.kind === 'state_reset');
  const dom = surface.find((s) => s.export_path[0] === addName).params[0];
  let st = 0;
  for (const call of [
    { export_path: [addName], args: [dom.domain.min] },
    { export_path: [resetName], args: [] },
    { export_path: [addName], args: [dom.domain.min + 1] },
  ]) {
    const out = evalTree(fns[call.export_path[0]].node, call.args, st);
    st = out.state;
    steps.push({ call, expected: out.expected });
  }
} else {
  for (const fnSurface of surface) {
    const name = fnSurface.export_path[0];
    if (!fns[name] || fns[name].node.kind.startsWith('state_')) {
      if (mode === 'happy' && fns[name] && fns[name].node.kind === 'state_add') {
        // Single-shot only: blind to residue.
        const dom = fnSurface.params[0];
        const out = evalTree(fns[name].node, [dom.domain.min], 0);
        steps.push({ call: { export_path: [name], args: [dom.domain.min] }, expected: out.expected });
      }
      continue;
    }
    const values = fnSurface.params.length === 0 ? [[]]
      : domainValues(fnSurface.params[0]).map((v) => [v]);
    const chosen = mode === 'happy' ? values.slice(0, 1) : values;
    for (const args of chosen) {
      if (steps.length >= budget && mode !== 'flood') break;
      let out;
      try { out = evalTree(fns[name].node, args, 0); } catch { continue; }
      steps.push({ call: { export_path: [name], args }, expected: out.expected });
    }
  }
}
if (mode === 'flood') {
  while (steps.length <= budget + 3) steps.push(steps[0]);
}
if (mode === 'overstrict') {
  steps[0].expected = { kind: 'throws', name: 'Error', message_token: 'never_happens' };
}
process.stdout.write(JSON.stringify({ case_id: env.case_id, steps }));
`);

const digest = (character) => character.repeat(64);
const baseOptions = {
  role: 'verification_author',
  trials: 2,
  expiresDays: 30,
  emitRow: false,
  taskClasses: ['verification_authoring'],
  domains: ['repository'],
  languages: ['en'],
  tools: ['spec_read'],
  engine: 'va-engine',
  model: 'va-model-exact',
  modelVersion: '2026-08-18',
  versionSource: 'operator-asserted',
  runner: 'va-harness',
  runnerVersion: '1.0.0',
  family: 'test-family',
  harnessVersion: 'va-harness-v1',
  effort: 'high',
  promptConfigHash: digest('a'),
  semanticFingerprint: digest('b'),
  containmentFingerprint: digest('c'),
  panelCmd: '/panel/node /panel/va.js perfect',
  panelReadOnlyBinds: [
    `${panelPath}=/panel/va.js`,
    `${process.execPath}=/panel/node`,
  ],
  panelEnvironment: [],
  providerEnvironment: [],
};

function run(mode, storeDir) {
  return runVaQualification({
    ...baseOptions,
    panelCmd: `/panel/node /panel/va.js ${mode}`,
    store: storeDir,
  });
}

try {
  verifySandboxRuntime();
} catch (error) {
  process.stdout.write(`SKIP: ${error.message}\n`);
  process.exit(0);
}

// ── perfect (spec-only clause reconstruction) ⇒ qualified ────────────────────
{
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-perfect-'));
  const result = run('perfect', store);
  equal(result.verdict.qualified, true,
    `spec-only mock qualifies end-to-end (reason: ${result.verdict.reason})`);
  equal(result.verdict.subjects,
    { declared_accuracy: true, sensitivity: true, robustness: true },
    'all subjects pass');
  equal(result.row.status, 'qualified', 'row status qualified');
  equal(result.evidence.state, 'qualified', 'evidence state qualified');
  equal(result.evidence.role, 'verification_author', 'canonical role');
  equal(result.evidence.methodology.kind, 'va_declared_plan',
    'va_declared_plan methodology (additive chassis kind — role_eval thresholds are reviewer-shaped)');
  const stored = fs.readFileSync(
    path.join(store, 'qualification-evidence.jsonl'), 'utf8',
  ).trim().split('\n');
  equal(stored.length, 1, 'exactly one evidence row appended to the isolated store');
}

// ── deviants through the real sandbox ────────────────────────────────────────
{
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-happy-'));
  const result = run('happy', store);
  equal(result.verdict.qualified, false, 'happy-path-only fails');
  equal(result.verdict.subjects.sensitivity, false, 'sensitivity is the failing subject');
  check(result.verdict.reason.includes('missed_defect'), 'reason names missed_defect');
}
{
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-strict-'));
  const result = run('overstrict', store);
  equal(result.verdict.qualified, false, 'over-strict declarations fail');
  equal(result.verdict.subjects.declared_accuracy, false, 'declared accuracy fails');
}
{
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-flood-'));
  const result = run('flood', store);
  equal(result.verdict.qualified, false, 'budget flood fails');
  equal(result.verdict.subjects.robustness, false, 'robustness fails on budget');
  check(result.verdict.reason.includes('budget_exceeded'), 'reason names budget_exceeded');
}
{
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-lazy-'));
  const result = run('lazy', store);
  equal(result.verdict.qualified, false, 'empty provider output fails');
  check(result.verdict.reason.includes('malformed_plan'), 'empty output is malformed_plan');
}
{
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-mal-'));
  const result = run('malformed', store);
  equal(result.verdict.qualified, false, 'non-JSON output fails');
  check(result.verdict.reason.includes('malformed_plan'), 'non-JSON is malformed_plan');
}

// ── transport parity: broker + stub provider vs local panel ─────────────────
// run_nonce randomizes the administration seed by design, so byte-diffing rows
// across transports is impossible; parity is asserted on every transport-
// independent surface instead (qualified, subjects, methodology, corpus hash,
// evidence state) plus an explicit transport-field difference.
{
  const providerPath = path.join(tempRoot, 'va-provider.js');
  fs.writeFileSync(providerPath, `'use strict';
const fs = require('fs');
const { spawnSync } = require('child_process');
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
const r = spawnSync(${JSON.stringify(process.execPath)},
  [${JSON.stringify(panelPath)}, 'perfect'],
  { input: req.payload.content, encoding: 'utf8' });
process.stdout.write(JSON.stringify({
  schema_version: 1, provider: 'va-fake', model: 'va-model-exact', output: r.stdout,
}));
`);
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-remote-'));
  const remote = runVaQualification({
    ...baseOptions,
    panelCmd: undefined,
    panelReadOnlyBinds: [],
    remoteProviderCmd: `${process.execPath} ${providerPath}`,
    remoteProvider: 'va-fake',
    remoteTimeoutMs: 60_000,
    store,
  });
  equal(remote.verdict.qualified, true,
    `broker transport qualifies the same mock (reason: ${remote.verdict.reason})`);
  equal(remote.verdict.subjects,
    { declared_accuracy: true, sensitivity: true, robustness: true },
    'broker-path subjects match the local-path subjects');
  equal(remote.evidence.state, 'qualified', 'broker-path evidence state parity');
  equal(remote.evidence.methodology.kind, 'va_declared_plan', 'broker-path methodology parity');
  equal(remote.oracle.corpus_manifest_hash,
    require('crypto').createHash('sha256')
      .update(fs.readFileSync(path.join(__dirname, '..', 'evals', 'va-capability-evidence-corpus.json')))
      .digest('hex'),
    'broker-path corpus hash parity');
  equal(remote.oracle.transport, 'remote', 'transport field records the broker path');
}

// ── precondition aborts ──────────────────────────────────────────────────────
{
  assert.throws(
    () => runVaQualification({ ...baseOptions, trials: 3 }),
    /requires exactly 2 trials/,
    'trial-count precondition');
  assertions += 1;
}

process.stdout.write(`${assertions} assertions passed\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
