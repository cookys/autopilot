#!/usr/bin/env node
'use strict';
/**
 * check-events-contract.js - gate for the events contract (schema autopilot.events/1, operator console A1 E4).
 *
 * Keeps docs/dev/events-contract.md, schemas/events.schema.json and schemas/events.baseline.json from drifting.
 * Five classes of gap, each reported (first one named) on stderr; exit 1 when any class has a gap:
 *   (i)   schema-undocumented : a property of a kind's `data` shape that the doc kinds table row does not list
 *   (ii)  consumer-unknown    : a kind.field named in the doc consumer table that the schema does not have
 *   (iii) example-drift       : a doc example that differs from the fixture's golden event (after the documented
 *                               normalisation; runs buildFixture in a tempdir)
 *   (iv)  path-unresolved     : the doc / schema / baseline path the registry names does not exist
 *   (0)   schema-shape        : an oneOf branch without a fixed kind const and a resolvable data $ref, or no oneOf
 *   (v)   baseline-regression : a field of the committed baseline that is gone, or changed type, nullability or
 *                               required-ness (additions pass; removal or retyping needs /2)
 * Exit 0 clean, 1 gap, 2 usage.
 * Regenerating the baseline (--print-baseline) is for ADDITIONS only: it first runs (v) against the existing baseline and
 * refuses (exit 1) on any removal or retype. A breaking change needs schema /2, never a regenerated baseline.
 *
 * Usage: node scripts/check-events-contract.js [--doc F] [--schema F] [--baseline F] [--print-baseline]
 *   Defaults come from scripts/lib/repo-layout.js (events_contract_doc, events_schema, events_baseline).
 *   --print-baseline writes the baseline derived from the schema to stdout (how schemas/events.baseline.json is made).
 * Node >= 20.10, built-ins only. Contract: docs/dev/events-contract.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const repoLayout = require('./lib/repo-layout');

const REPO = path.join(__dirname, '..');
// Kinds that the consumer table may name before the schema has them (additive future kinds). Anything else that has the
// shape kind.field or kind but is not a schema kind is a gap (a typo must not pass silently).
const FUTURE_KINDS = new Set(['quota.observed']);
const BASELINE_VERSION = 'autopilot.events.baseline/1';
const BASELINE_SECTIONS = ['envelope', 'project', 'source_stat', 'warning', 'event', 'error_object', 'error', 'kinds'];

// kind -> name of its data $def, derived from the oneOf of $defs.event (each branch pins `kind` with a const and its
// `data` with a $ref to a $defs entry). Fail closed: a branch of any other shape is reported in `problems`, never
// skipped. The one allowed exception is the open-set branch (its `kind` is a `pattern`, no const).
function kindInfo(schema) {
  const d = schema.$defs || {};
  const map = {};
  const problems = [];
  let openSeen = false;
  const branches = d.event && d.event.oneOf;
  if (!Array.isArray(branches) || branches.length === 0) {
    problems.push('schema has no $defs.event.oneOf (or it is empty): no kinds can be derived');
    return { map, problems };
  }
  branches.forEach((branch, i) => {
    const def = resolveRef(schema, branch);
    const props = (def && def.properties) || {};
    const kindNode = props.kind || {};
    if (kindNode.pattern !== undefined && kindNode.const === undefined && kindNode.enum === undefined) {
      // The open-set fallback: exactly one such branch, and its data must be the forward-compat shell (no named properties).
      const dRef = props.data && props.data.$ref;
      const dDef = props.data && (dRef ? d[String(dRef).replace(/^#\/\$defs\//, '')] : props.data);
      if (openSeen) problems.push(`oneOf branch ${i} is a second pattern-kind (open-set) branch; only one fallback is allowed`);
      else if (!dDef) problems.push(`oneOf branch ${i} (pattern kind) has a data $ref that does not resolve`);
      else if (dDef.properties && Object.keys(dDef.properties).length) problems.push(`oneOf branch ${i} (pattern kind) carries named data properties; only a kind with a const may`);
      openSeen = true;
      return;
    }
    const kind = kindNode.const;
    const dataRef = props.data && props.data.$ref;
    const defName = typeof dataRef === 'string' ? dataRef.replace(/^#\/\$defs\//, '') : null;
    if (typeof kind !== 'string' || !defName || !d[defName]) {
      problems.push(`oneOf branch ${i} has no fixed kind const or no data $ref that resolves to a $defs entry`);
      return;
    }
    map[kind] = defName;
  });
  return { map, problems };
}
const kindMap = (schema) => kindInfo(schema).map;
const kindsOf = (schema) => Object.keys(kindMap(schema));

function resolveRef(schema, node) {
  let cur = node;
  while (cur && cur.$ref) {
    const parts = cur.$ref.replace(/^#\//, '').split('/');
    cur = parts.reduce((acc, p) => (acc ? acc[p] : undefined), schema);
  }
  return cur;
}

// {type, nullable} of one property schema ($ref resolved; const and enum are strings).
function describe(schema, node) {
  const n = resolveRef(schema, node) || {};
  let types = n.type === undefined ? [] : [].concat(n.type);
  let nullable = types.includes('null');
  const typeOfValue = (v) => (v === null ? 'null' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string');
  if (!types.length && n.const !== undefined) types = [typeOfValue(n.const)];
  if (!types.length && n.enum) types = [...new Set(n.enum.map(typeOfValue))];
  nullable = nullable || types.includes('null');
  const base = types.filter((t) => t !== 'null');
  return { type: base.length ? base.sort().join('|') : 'any', nullable };
}

function fieldsOf(schema, shape) {
  const s = resolveRef(schema, shape) || {};
  const required = new Set(s.required || []);
  const out = {};
  for (const [name, prop] of Object.entries(s.properties || {})) {
    out[name] = { ...describe(schema, prop), required: required.has(name) };
  }
  return out;
}

function baselineOf(schema) {
  const d = schema.$defs || {};
  const envelope = d.envelope;
  const out = {
    baseline: BASELINE_VERSION,
    envelope: fieldsOf(schema, envelope),
    project: fieldsOf(schema, envelope.properties.project),
    source_stat: fieldsOf(schema, d.source_stat),
    warning: fieldsOf(schema, d.warning),
    event: fieldsOf(schema, d.event_unknown_kind),
    error_object: fieldsOf(schema, d.error_object),
    error: fieldsOf(schema, d.error_object.properties.error),
    kinds: {},
  };
  const km = kindMap(schema);
  for (const kind of Object.keys(km)) out.kinds[kind] = fieldsOf(schema, d[km[kind]]);
  return out;
}

function readJson(file, what, problems) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    problems.push(['path-unresolved', `cannot read ${what} ${file}: ${e.code || e.message}`]);
    return null;
  }
}

// ---- (i) -----------------------------------------------------------------------------------------------------------
function kindsRow(doc, kind) { return doc.split('\n').find((l) => l.startsWith(`| \`${kind}\` |`)); }
function lastCell(row) { const cells = row.split(/(?<!\\)\|/).map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1))); return cells[cells.length - 1]; }

function checkSchemaDocumented(schema, doc) {
  const gaps = [];
  const km = kindMap(schema);
  for (const kind of Object.keys(km)) {
    const row = kindsRow(doc, kind);
    if (!row) { gaps.push(`kinds table has no row for ${kind}`); continue; }
    const cell = lastCell(row);
    for (const prop of Object.keys(((schema.$defs || {})[km[kind]] || {}).properties || {})) {
      if (!cell.includes(`\`${prop}\``) && !cell.includes(`\`${prop}?\``)) gaps.push(`${kind}.data.${prop} is in the schema but not in the doc kinds table`);
    }
  }
  return gaps;
}

// ---- (ii) ----------------------------------------------------------------------------------------------------------
function consumerRows(doc) {
  const start = doc.indexOf('\n## Consumer table');
  if (start < 0) return null;
  const rest = doc.slice(start + 1);
  const end = rest.indexOf('\n## ', 4);
  const lines = (end < 0 ? rest : rest.slice(0, end)).split('\n').filter((l) => l.startsWith('|'));
  return lines.slice(2).map((l) => l.split(/(?<!\\)\|/).map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1))));
}

function checkConsumers(schema, doc) {
  const rows = consumerRows(doc);
  if (!rows) return ['doc has no "## Consumer table" section'];
  const d = schema.$defs;
  const km = kindMap(schema);
  const KINDS = Object.keys(km);
  const fieldSet = (kind) => new Set(Object.keys((d[km[kind]] || {}).properties || {}));
  const knownKinds = [...KINDS].sort((a, b) => b.length - a.length);
  const gaps = [];
  for (const k of FUTURE_KINDS) if (KINDS.includes(k)) gaps.push(`FUTURE_KINDS lists ${k}, which the schema now has: remove it from the whitelist`);
  for (const cells of rows) {
    const [who, reads] = cells;
    const spans = [...(reads || '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (who === 'all') {
      const env = Object.keys(d.envelope.properties);
      for (const span of spans) {
        const [top, sub] = span.split(/\[\]\.?/);
        if (!env.includes(top)) { gaps.push(`consumer table (all): envelope field ${top} is not in the schema`); continue; }
        if (sub && top === 'sources' && !(sub in d.source_stat.properties)) gaps.push(`consumer table (all): sources[].${sub} is not in the schema`);
        if (sub && top === 'warnings' && !(sub in d.warning.properties)) gaps.push(`consumer table (all): warnings[].${sub} is not in the schema`);
      }
      continue;
    }
    let ctx = [];
    let futureOnly = false;
    for (const raw of spans) {
      const span = raw.split('=')[0];
      let m;
      const slash = /^([a-z]+\.[a-z]+)\/([a-z]+)$/.exec(span);
      if (slash && !(KINDS.includes(slash[1]) && KINDS.includes(`${slash[1].split('.')[0]}.${slash[2]}`))) {
        gaps.push(`consumer table (${who}): ${span} names a kind the schema does not have`);
        continue;
      }
      if (slash) { ctx = [slash[1], `${slash[1].split('.')[0]}.${slash[2]}`].filter((k) => KINDS.includes(k)); continue; }
      if (KINDS.includes(span)) { ctx = [span]; futureOnly = false; continue; }
      const prefixed = knownKinds.find((k) => span.startsWith(`${k}.`));
      if (prefixed) {
        const field = span.slice(prefixed.length + 1);
        if (!fieldSet(prefixed).has(field)) gaps.push(`consumer table (${who}): ${prefixed}.${field} is not in the schema`);
        ctx = [prefixed];
        continue;
      }
      const shaped = /^([a-z][a-z_0-9]*\.[a-z][a-z_0-9]*)(?:\.[a-z_0-9.]+)?$/.exec(span);
      const envDef = shaped && ({ envelope: d.envelope, project: d.envelope.properties.project, source_stat: d.source_stat, warning: d.warning, event: d.event_unknown_kind, error_object: d.error_object })[shaped[1].split('.')[0]];
      if (envDef) {
        const f = shaped[1].split('.')[1];
        if (!(f in (envDef.properties || {}))) gaps.push(`consumer table (${who}): ${span} is not in the schema`);
        continue;
      }
      if (shaped && shaped[1].split('.')[0] !== 'data') {
        if (FUTURE_KINDS.has(span)) {
          // exactly the bare future kind is allowed; following bare fields have no schema kind to belong to
          ctx = [];
          futureOnly = true;
          continue;
        }
        gaps.push(`consumer table (${who}): ${span} names kind ${shaped[1]}, which the schema does not have`);
        continue;
      }
      if ((m = /^data\.([a-z_0-9]+)$/.exec(span))) {
        if (!KINDS.some((k) => fieldSet(k).has(m[1]))) gaps.push(`consumer table (${who}): data.${m[1]} is not in any kind of the schema`);
        continue;
      }
      if (/^[a-z][a-z_0-9]*$/.test(span) && futureOnly && !ctx.length) {
        gaps.push(`consumer table (${who}): bare field ${span} follows a future kind and has no schema kind to check against`);
        continue;
      }
      if (/^[a-z][a-z_0-9]*$/.test(span) && ctx.length) {
        if (!ctx.some((k) => fieldSet(k).has(span)) && !(span in d.event_unknown_kind.properties)) gaps.push(`consumer table (${who}): ${ctx.join('/')}.${span} is not in the schema`);
      }
    }
  }
  return gaps;
}

// ---- (iii) ---------------------------------------------------------------------------------------------------------
function docExamples(doc) {
  const found = {};
  const re = /^### Example: (\S+)\n\n```json\n([\s\S]*?)\n```/gm;
  let m;
  while ((m = re.exec(doc)) !== null) {
    try { found[m[1]] = JSON.parse(m[2]); } catch (e) { found[m[1]] = { __unparseable: e.message }; }
  }
  return found;
}

function checkExamples(doc, schema) {
  const fixtureLib = require('./lib/events-fixture');
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-events-contract-'));
    const fx = fixtureLib.buildFixture({ dir });
    const golden = fixtureLib.goldenEvents(fx);
    const examples = docExamples(doc);
    const gaps = [];
    const want = { envelope: fixtureLib.normaliseExample(fixtureLib.goldenEnvelope(fx), fx) };
    for (const kind of kindsOf(schema)) {
      const event = fixtureLib.exampleEvent(golden, kind);
      want[kind] = event ? fixtureLib.normaliseExample(event, fx) : undefined;
    }
    for (const name of Object.keys(want)) {
      if (!(name in examples)) { gaps.push(`doc has no "### Example: ${name}" block`); continue; }
      if (!util.isDeepStrictEqual(examples[name], want[name])) gaps.push(`doc example ${name} differs from the normalised fixture event`);
    }
    for (const name of Object.keys(examples)) if (!(name in want)) gaps.push(`doc example ${name} has no fixture event`);
    return gaps;
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- (v) -----------------------------------------------------------------------------------------------------------
function checkBaseline(schema, baseline) {
  const now = baselineOf(schema);
  const gaps = [];
  if (baseline.baseline !== BASELINE_VERSION) gaps.push(`baseline version key is ${JSON.stringify(baseline.baseline)}, expected ${BASELINE_VERSION}`);
  for (const sec of BASELINE_SECTIONS) if (!baseline[sec] || typeof baseline[sec] !== 'object') gaps.push(`baseline section ${sec} is missing`);
  const sections = Object.keys(baseline).filter((k) => k !== 'baseline');
  const compare = (label, was, is) => {
    for (const [field, w] of Object.entries(was)) {
      const c = is && is[field];
      if (!c) { gaps.push(`baseline field ${label}.${field} is gone from the schema`); continue; }
      if (c.type !== w.type) gaps.push(`baseline field ${label}.${field} changed type ${w.type} -> ${c.type}`);
      else if (c.nullable !== w.nullable) gaps.push(`baseline field ${label}.${field} changed nullable ${w.nullable} -> ${c.nullable}`);
      else if (c.required !== w.required) gaps.push(`baseline field ${label}.${field} changed required ${w.required} -> ${c.required}`);
    }
  };
  const emptyWhere = (label, was, is) => { if (was && Object.keys(was).length === 0 && is && Object.keys(is).length > 0) gaps.push(`baseline ${label} is empty but the schema derives ${Object.keys(is).length} field(s)`); };
  for (const section of sections) {
    if (section === 'kinds') {
      for (const [kind, fields] of Object.entries(baseline.kinds || {})) emptyWhere(`kinds.${kind}`, fields, now.kinds[kind]);
      for (const [kind, fields] of Object.entries(baseline.kinds)) {
        if (!now.kinds[kind]) { gaps.push(`baseline kind ${kind} is gone from the schema`); continue; }
        compare(`kinds.${kind}`, fields, now.kinds[kind]);
      }
    } else { emptyWhere(section, baseline[section], now[section]); compare(section, baseline[section], now[section]); }
  }
  return gaps;
}

// ---- main ----------------------------------------------------------------------------------------------------------
function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--print-baseline') opts.print = true;
    else if (['--doc', '--schema', '--baseline'].includes(a) && argv[i + 1]) opts[a.slice(2)] = argv[++i];
    else { process.stderr.write(`check-events-contract: usage error at ${a}\n`); return 2; }
  }
  const rel = (key) => path.join(REPO, repoLayout.path(key));
  const problems = [];
  const docFile = opts.doc || rel('events_contract_doc');
  const schemaFile = opts.schema || rel('events_schema');
  const baselineFile = opts.baseline || rel('events_baseline');
  for (const [what, file] of [['doc', docFile], ['schema', schemaFile], ['baseline', baselineFile]]) {
    if (opts.print && what !== 'schema') continue;
    if (!fs.existsSync(file)) problems.push(['path-unresolved', `${what} path does not exist: ${file}`]);
  }
  const schema = fs.existsSync(schemaFile) ? readJson(schemaFile, 'schema', problems) : null;
  if (opts.print) {
    if (!schema) { process.stderr.write(`check-events-contract: ${problems.length ? problems[0][1] : 'schema unreadable'}\n`); return 1; }
    const shape = kindInfo(schema).problems;
    if (shape.length) { process.stderr.write(`check-events-contract: [schema-shape] refusing to print: ${shape[0]}\n`); return 1; }
    // Regenerating may only add: compare the new schema against the existing baseline first.
    if (fs.existsSync(baselineFile)) {
      const existing = readJson(baselineFile, 'baseline', []);
      if (!existing) { process.stderr.write(`check-events-contract: [path-unresolved] existing baseline is unreadable: ${baselineFile}\n`); return 1; }
      const gaps = checkBaseline(schema, existing);
      if (gaps.length) { process.stderr.write(`check-events-contract: [baseline-regression] refusing to print: ${gaps[0]} (breaking changes need /2, not a regenerated baseline)\n`); return 1; }
    }
    process.stdout.write(`${JSON.stringify(baselineOf(schema), null, 2)}\n`);
    return 0;
  }
  const doc = fs.existsSync(docFile) ? fs.readFileSync(docFile, 'utf8') : null;
  const baseline = fs.existsSync(baselineFile) ? readJson(baselineFile, 'baseline', problems) : null;
  if (schema) for (const g of kindInfo(schema).problems.slice(0, 1)) problems.push(['schema-shape', g]);
  if (schema && doc !== null) {
    for (const g of checkSchemaDocumented(schema, doc).slice(0, 1)) problems.push(['schema-undocumented', g]);
    for (const g of checkConsumers(schema, doc).slice(0, 1)) problems.push(['consumer-unknown', g]);
  }
  if (doc !== null && schema) for (const g of checkExamples(doc, schema).slice(0, 1)) problems.push(['example-drift', g]);
  if (schema && baseline) for (const g of checkBaseline(schema, baseline).slice(0, 1)) problems.push(['baseline-regression', g]);
  for (const [cls, msg] of problems) process.stderr.write(`check-events-contract: [${cls}] ${msg}\n`);
  if (problems.length) return 1;
  process.stderr.write('check-events-contract: ok\n');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main, baselineOf, checkSchemaDocumented, checkConsumers, checkExamples, checkBaseline };
