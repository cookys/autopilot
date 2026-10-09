#!/usr/bin/env node
'use strict';

// stage-graph.js — query the dev-flow stage graph (references/stage-graph.json).
//
//   nodes  --size S [--bug] [--urgent] [--high-risk] [--research] [--units N]
//          -> {"nodes":[...],"walk":[...],"entry":"..","terminal":"..","unit_kind":..}
//   next   --from <node> --size S [same flags]
//          -> JSON array of legal next nodes, sorted (e.g. ["code-review","implement"])
//   validate [--graph <file>]
//          -> {"ok":bool,"errors":[...]}; schema check + every node_id reachable
//   limits --size S
//          -> {"size":"S","files":6,"lines":200}   (null = no limit; equal fits)
//
// `--urgent` without `--high-risk` is urgent-low: code-review moves after finish
// and is terminal (no loop-back). `--urgent --high-risk` keeps the normal order.
//
// Exit codes: 0 ok; 1 validate failed; 2 usage / unreadable graph / unknown size or node.
// One JSON value on stdout; diagnostics on stderr. Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_GRAPH = path.join(REPO_ROOT, 'references', 'stage-graph.json');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'stage-graph.schema.json');

function die(code, msg) {
  process.stderr.write(`stage-graph: ${msg}\n`);
  process.exit(code);
}

function out(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function loadGraph(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return die(2, `cannot read graph ${file}: ${e.message}`);
  }
}

function parseArgs(argv) {
  const o = { flags: new Set(), vals: {} };
  const valued = new Set(['--size', '--from', '--units', '--graph']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.has(a)) {
      if (argv[i + 1] === undefined) die(2, `${a} needs a value`);
      o.vals[a] = argv[++i];
    } else if (['--bug', '--urgent', '--high-risk', '--research'].includes(a)) {
      o.flags.add(a);
    } else {
      die(2, `unknown argument ${a}`);
    }
  }
  return o;
}

function variantFrom(o) {
  const units = o.vals['--units'] === undefined ? 1 : Number(o.vals['--units']);
  if (!Number.isInteger(units) || units < 1) die(2, '--units must be an integer >= 1');
  return {
    size: o.vals['--size'],
    bug: o.flags.has('--bug'),
    urgent: o.flags.has('--urgent'),
    highRisk: o.flags.has('--high-risk'),
    research: o.flags.has('--research'),
    units,
  };
}

// Expand one variant's walk from the rule data.
function buildWalk(graph, v) {
  const cfg = graph.sizes[v.size];
  if (!cfg) die(2, `unknown size ${v.size}`);
  let walk = [];
  for (const item of cfg.base) {
    if (typeof item === 'string') walk.push(item);
    else if (item.optional) {
      if (v.research) walk.push(item.optional);
    } else if (item.unit_loop) {
      for (let n = 0; n < v.units; n++) walk.push(...item.unit_loop);
    }
  }
  if (v.bug) {
    if (cfg.bug.mode === 'replace') {
      const i = walk.indexOf(cfg.bug.target);
      walk[i] = graph.bug_node;
    } else {
      walk = [graph.bug_node, ...walk];
    }
  }
  const urgentLow = v.urgent && !v.highRisk;
  let terminal = graph.terminal;
  if (urgentLow && walk.includes(graph.urgency.low.move_after.node)) {
    const { node, after } = graph.urgency.low.move_after;
    walk = walk.filter((n) => n !== node);
    walk.splice(walk.indexOf(after) + 1, 0, node);
    terminal = graph.urgency.low.terminal;
  }
  const nodes = [...new Set(walk)];
  const hasLoop = cfg.base.some((b) => typeof b === 'object' && b.unit_loop);
  return { nodes, walk, entry: walk[0], terminal, unit_kind: hasLoop ? cfg.unit_kind : null, urgentLow };
}

function nextNodes(graph, v, from) {
  if (!graph.node_ids.includes(from)) die(2, `unknown node ${from}`);
  const edges = new Set();
  // Forward edges: union over research taken / skipped and a repeated unit, so
  // both optional paths and the next-unit edge are legal.
  for (const research of [true, false]) {
    const w = buildWalk(graph, { ...v, research, units: 2 }).walk;
    for (let i = 0; i + 1 < w.length; i++) if (w[i] === from) edges.add(w[i + 1]);
  }
  const base = buildWalk(graph, v);
  if (!base.nodes.includes(from)) return [];
  const urgency = base.urgentLow ? 'urgent-low' : null;
  for (const lb of graph.loop_backs) {
    if (lb.from !== from) continue;
    if (urgency && (lb.except_urgency || []).includes(urgency)) continue;
    if (base.nodes.includes(lb.to)) edges.add(lb.to);
  }
  return [...edges].sort();
}

function validateGraph(graph) {
  const errors = [];
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`cannot read schema: ${e.message}`] };
  }
  const { validateJsonSchema } = require('./validate-json-schema.js');
  const r = validateJsonSchema(schema, graph);
  if (!r.valid) {
    for (const e of r.errors) errors.push(`schema: ${typeof e === 'string' ? e : JSON.stringify(e)}`);
    return { ok: false, errors };
  }
  const ids = new Set(graph.node_ids);
  for (const id of ids) if (id.includes('hetero')) errors.push(`node id contains "hetero": ${id}`);
  const seen = new Set();
  for (const size of Object.keys(graph.sizes)) {
    for (const bug of [false, true]) {
      for (const urgent of [false, true]) {
        for (const research of [false, true]) {
          let w;
          try {
            w = buildWalk(graph, { size, bug, urgent, highRisk: false, research, units: 2 });
          } catch (e) {
            errors.push(`walk build failed for ${size}: ${e.message}`);
            continue;
          }
          for (const n of w.walk) {
            if (!ids.has(n)) errors.push(`size ${size} references undeclared node ${n}`);
            seen.add(n);
          }
        }
      }
    }
  }
  for (const id of ids) if (!seen.has(id)) errors.push(`unreachable node: ${id}`);
  for (const lb of graph.loop_backs) {
    if (!ids.has(lb.from) || !ids.has(lb.to)) errors.push(`loop_back references undeclared node: ${lb.from}->${lb.to}`);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!['nodes', 'next', 'validate', 'limits'].includes(cmd)) {
    die(2, 'usage: stage-graph.js nodes|next|validate|limits [flags] (see script header)');
  }
  const o = parseArgs(rest);
  const graph = loadGraph(o.vals['--graph'] || DEFAULT_GRAPH);
  if (cmd === 'validate') {
    const r = validateGraph(graph);
    out(r);
    process.exit(r.ok ? 0 : 1);
  }
  if (!o.vals['--size']) die(2, '--size is required');
  const v = variantFrom(o);
  if (cmd === 'limits') {
    const l = graph.bump_limits[v.size];
    if (!l) die(2, `unknown size ${v.size}`);
    return out({ size: v.size, files: l.files, lines: l.lines });
  }
  if (cmd === 'nodes') {
    const r = buildWalk(graph, v);
    return out({ nodes: r.nodes, walk: r.walk, entry: r.entry, terminal: r.terminal, unit_kind: r.unit_kind });
  }
  if (!o.vals['--from']) die(2, '--from is required');
  return out(nextNodes(graph, v, o.vals['--from']));
}

if (require.main === module) main();

// Library surface (src/status/stage-walk.js): buildWalk() reads rule data only; it die()s on an unknown size, so callers check graph.sizes first.
module.exports = { buildWalk, DEFAULT_GRAPH };
