// READ-ONLY analysis of campaign controller checkpoints (BL-0016 D1 overlap value).
// Source: <git-common-dir>/autopilot/controller-authority/<hash>/g<N>-*/controller-checkpoint.json
const fs = require('fs'), p = require('path');
const D = process.argv[2] || require('path').join(require('child_process').execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(), 'autopilot', 'controller-authority'); // read-only; pass the controller-authority dir to override
const t = (s) => Date.parse(s);
const roots = [];
for (const r of fs.readdirSync(D)) {
  const rd = p.join(D, r);
  if (!fs.statSync(rd).isDirectory()) continue;
  const R = { r, root_run_id: null, node: null, written: [], gates: {}, ev: {}, startedMs: null };
  for (const g of fs.readdirSync(rd)) {
    const f = p.join(rd, g, 'controller-checkpoint.json');
    if (!fs.existsSync(f)) continue;
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
    R.root_run_id = j.root_run_id; R.node = j.graph_node;
    if (j.written_at) R.written.push(j.written_at);
    const c = j.controller || {};
    if (c.started_at_ms) R.startedMs = Math.min(R.startedMs || 1e18, c.started_at_ms);
    for (const e of (c.gate_journal && c.gate_journal.entries) || []) R.gates[e.gate_id] = e;
    for (const e of c.audit_events || []) R.ev[[e.at, e.event, e.stage, e.effect_identity].join('|')] = e;
  }
  R.written.sort();
  roots.push(R);
}
const uniqRoot = new Set(roots.map(r => r.root_run_id));
const days = new Set(roots.map(r => r.written[0].slice(0, 10)).concat(roots.map(r => r.written[r.written.length - 1].slice(0, 10))));
const rows = [];
let totalWall = 0, wallWithGate = 0;
for (const R of roots) {
  const first = R.written[0], last = R.written[R.written.length - 1];
  const start = R.startedMs ? Math.min(R.startedMs, t(first)) : t(first);
  const wall = (t(last) - start) / 1000;
  totalWall += wall;
  const G = Object.values(R.gates);
  const suite = G.filter(g => g.kind === 'full_suite');
  const diff = G.filter(g => g.kind === 'full_diff_review');
  if (suite.length || diff.length) wallWithGate += wall;
  const evs = Object.values(R.ev).sort((a, b) => a.at < b.at ? -1 : 1);
  const resv = evs.find(e => e.event === 'controller_effect_reserved' && e.stage === 'full_diff_review');
  const resu = evs.find(e => e.event === 'controller_effect_result' && e.effect_identity && e.effect_identity.startsWith('gate-full_diff_review'));
  let panel = null, panelSrc = null;
  if (diff.length) {
    const d = diff[0];
    const gateDur = (t(d.finished_at) - t(d.started_at)) / 1000;
    if (gateDur > 1) { panel = gateDur; panelSrc = 'gate'; }
    else if (resv && resu) { panel = (t(resu.at) - t(resv.at)) / 1000; panelSrc = 'audit_reserved->result'; }
  }
  const s = suite[0];
  const sdur = s ? (t(s.finished_at) - t(s.started_at)) / 1000 : null;
  rows.push({ root: R.root_run_id.slice(0, 20), node: R.node, wall, nSuite: suite.length, nDiff: diff.length, suite: sdur, reused: s ? sdur <= 1 : null, panel, panelSrc, diffOk: diff[0] && diff[0].result.success, suiteOk: s && s.result.success });
}
const med = (a) => { a = [...a].sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const suites = rows.filter(r => r.nSuite > 0);
const fresh = suites.filter(r => r.reused === false);
const reused = suites.filter(r => r.reused === true);
console.log('checkpoint roots', roots.length, 'distinct root_run_id', uniqRoot.size, 'days', [...days].sort().join(','));
console.log('full_suite entries', suites.reduce((a, r) => a + r.nSuite, 0), 'fresh', fresh.length, 'reused(<=1s)', reused.length);
console.log('fresh suite s: median', med(fresh.map(r => r.suite)), 'max', Math.max(...fresh.map(r => r.suite)), 'min', Math.min(...fresh.map(r => r.suite)), 'sum', fresh.reduce((a, r) => a + r.suite, 0));
const diffs = rows.filter(r => r.nDiff > 0);
console.log('full_diff_review entries', diffs.length, 'with panel duration', diffs.filter(r => r.panel != null).length);
console.log('panel s: median', med(diffs.filter(r => r.panel != null).map(r => r.panel)));
const both = rows.filter(r => r.reused === false && r.panel != null);
let save = 0;
console.log('--- both fresh (suite fresh & panel known)');
for (const r of both) { const m = Math.min(r.suite, r.panel); save += m; console.log(r.root, r.node.slice(0, 30), 'suite', r.suite.toFixed(0), 'panel', r.panel.toFixed(0), 'save', m.toFixed(0), 'wall', r.wall.toFixed(0), (100 * m / r.wall).toFixed(1) + '%'); }
console.log('n both', both.length, 'save sum', save.toFixed(0), 'median save', med(both.map(r => Math.min(r.suite, r.panel))), 'max', Math.max(...both.map(r => Math.min(r.suite, r.panel))));
console.log('--- reused pairs');
for (const r of rows.filter(r => r.reused === true)) console.log(r.root, r.node.slice(0, 30), 'suite', r.suite, 'panel', r.panel, r.panelSrc);
console.log('total wall all roots', totalWall.toFixed(0), 's', (totalWall / 3600).toFixed(1), 'h; roots reaching a gate', wallWithGate.toFixed(0), 's', (wallWithGate / 3600).toFixed(1), 'h');
console.log('save / total wall all', (100 * save / totalWall).toFixed(2) + '%', ' save / wall of gate-reaching roots', (100 * save / wallWithGate).toFixed(2) + '%');
const bothWall = both.reduce((a, r) => a + r.wall, 0);
console.log('save / wall of the both-fresh roots', (100 * save / bothWall).toFixed(2) + '%');
fs.writeFileSync(p.join(__dirname, 'analysis-rows.json'), JSON.stringify(rows, null, 1));
