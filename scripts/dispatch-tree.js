#!/usr/bin/env node
'use strict';
// dispatch-tree.js — read-only merged view of everything one session dispatched, as ONE tree rooted at the
// session (live-pane plan docs/plans/2026-10-13-live-pane-design-system.md §7.1, identity hand-off step 1).
//
// It joins three existing records and writes nothing:
//   1. subagent tree  <projects>/<proj>/<session>/subagents/agent-*.meta.json  (parentAgentId, toolUseId, spawnDepth;
//      parsed with hooks/cost-tracker-lib.js readAgentTree when that file ships beside this script)
//   2. rail tree      <runs>/<run_id>.manifest.json  (parent_run_id, root_run_id, depth; directory rule of
//      scripts/dispatch-status.js)
//   3. session -> rail  manifest.session_id when the manifest has it (preferred); otherwise the session marker
//      <markers>/<session>.json (scripts/session-mode.js) root_run_id + campaign_roots against manifest.root_run_id.
//      An EXPIRED marker is still used (the 24 h TTL is exactly why manifest.session_id is being added) and flagged.
//
// A branch that cannot be connected is never dropped: it is attached under the nearest known node with
// untracked:true and untracked_reason, so a gap never reads as "nothing happened". A rail that ran a claude child
// (cc-shim, claude-native, claude) carries trace_end:"loop_back_not_recorded" (its children are not recorded yet).
//
// Usage: node scripts/dispatch-tree.js [--session <id>] [--json] [--projects-dir D] [--runs-dir D] [--marker-dir D]
//   --session      default $CLAUDE_CODE_SESSION_ID
//   --projects-dir default $CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects
//   --runs-dir     default $AUTOPILOT_DISPATCH_RUNS_DIR, else the runs directory of scripts/lib/runtime-paths.js
//   --marker-dir   default $AUTOPILOT_SESSION_MODE_DIR, else ~/.autopilot/session-mode
//
// EXIT: 0 ok (a missing source directory is a warning, not an error: the tree is just smaller)
//       2 usage error (unknown flag, or no session id from --session / $CLAUDE_CODE_SESSION_ID)
//
// --json schema (schema_version 1; additive changes only):
//   { schema_version:1, session_id,
//     sources:{ projects_dir, session_dir:string|null, runs_dir, marker_dir,
//               marker:{ found:bool, expired:bool|null, started_at:string|null, root_run_id:string|null, campaign_roots:string[] } },
//     counts:{ agents, rails, untracked },
//     warnings:[string],
//     root:{ kind:"session", id, children:[NODE] } }
//   NODE (common): { kind:"agent"|"rail", id, depth:int|null, started_at:string|null, ended_at:string|null,
//                    untracked:bool, untracked_reason:string|null, trace_end:string|null, children:[NODE] }
//   agent NODE adds: agent_type, description, tool_use_id, spawn_depth
//   rail  NODE adds: role, runner, model, root_run_id, parent_run_id, final_status, joined_by
//                    ("session_id"|"marker"|"parent_run_id")
//   untracked_reason: agent  "legacy_record_no_parent_info" | "missing_parentAgentId" | "parent_agent_not_found" | "cycle"
//                     rail   "parent_run_not_found" | "parent_run_other_session" | "cycle"
//   children sorted by started_at (null last), then id.

const fs = require('fs');
const os = require('os');
const path = require('path');
const runtimePaths = require('./lib/runtime-paths');

let readAgentTreeLib = null;
try { readAgentTreeLib = require('../hooks/cost-tracker-lib.js').readAgentTree; } catch { /* mirror without hooks/ */ }

const LOOP_BACK_RUNNERS = new Set(['cc-shim', 'claude-native', 'claude']);

function parseArgs(argv) {
  const a = { session: process.env.CLAUDE_CODE_SESSION_ID || '', json: false, projectsDir: null, runsDir: null, markerDir: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--json') a.json = true;
    else if (k === '--session' || k === '--projects-dir' || k === '--runs-dir' || k === '--marker-dir') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return { error: `${k} needs a value` };
      if (k === '--session') a.session = v;
      else if (k === '--projects-dir') a.projectsDir = v;
      else if (k === '--runs-dir') a.runsDir = v;
      else a.markerDir = v;
    } else return { error: `unknown argument: ${k}` };
  }
  if (!a.session) return { error: 'no session id: pass --session or set CLAUDE_CODE_SESSION_ID' };
  return a;
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

const str = (v) => (typeof v === 'string' && v ? v : null);

function nodeBase(kind, id) {
  return { kind, id, depth: null, started_at: null, ended_at: null, untracked: false, untracked_reason: null, trace_end: null, children: [] };
}

function findSessionDir(projectsDir, session, warnings) {
  let projs = [];
  try { projs = fs.readdirSync(projectsDir); } catch { warnings.push(`projects dir unreadable: ${projectsDir}`); return null; }
  for (const p of projs.sort()) {
    const d = path.join(projectsDir, p, session);
    try { if (fs.statSync(d).isDirectory()) return d; } catch { /* next */ }
  }
  return null;
}

function loadAgents(sessionDir) {
  const out = [];
  if (!sessionDir) return out;
  const dir = path.join(sessionDir, 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^agent-.+\.meta\.json$/.test(f)); } catch { return out; }
  for (const f of files.sort()) {
    const file = path.join(dir, f);
    const raw = readJson(file);
    if (!raw) continue;
    const tree = readAgentTreeLib ? readAgentTreeLib(file) : { parentAgentId: str(raw.parentAgentId) || undefined };
    let mtime = null;
    try { mtime = fs.statSync(file).mtime.toISOString(); } catch { /* keep null */ }
    const n = nodeBase('agent', f.replace(/^agent-/, '').replace(/\.meta\.json$/, ''));
    n.agent_type = str(raw.agentType);
    n.description = str(raw.description);
    n.tool_use_id = str(raw.toolUseId);
    n.spawn_depth = Number.isInteger(raw.spawnDepth) ? raw.spawnDepth : null;
    n.depth = n.spawn_depth;
    n.started_at = str(raw.startedAt) || mtime; // meta carries no start time; file mtime is the only stamp
    n._parent = tree.parentAgentId || null;
    out.push(n);
  }
  return out;
}

function loadRails(runsDir, warnings) {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.manifest.json') && !f.startsWith('panel-')); }
  catch { warnings.push(`runs dir unreadable: ${runsDir}`); return out; }
  for (const f of files.sort()) {
    const m = readJson(path.join(runsDir, f));
    if (!m) continue;
    const id = str(m.run_id) || f.replace(/\.manifest\.json$/, '');
    const n = nodeBase('rail', id);
    n.role = str(m.role);
    n.runner = str(m.runner);
    n.model = str(m.model);
    n.root_run_id = str(m.root_run_id);
    n.parent_run_id = str(m.parent_run_id);
    n.final_status = str(m.final_status);
    n.joined_by = null;
    n.depth = m.depth != null && Number.isFinite(Number(m.depth)) ? Number(m.depth) : null;
    n.started_at = str(m.started_at);
    n.ended_at = str(m.ended_at);
    n._session = str(m.session_id);
    if (n.runner && LOOP_BACK_RUNNERS.has(n.runner)) n.trace_end = 'loop_back_not_recorded';
    out.push(n);
  }
  return out;
}

function readMarker(markerDir, session) {
  const info = { found: false, expired: null, started_at: null, root_run_id: null, campaign_roots: [] };
  const safe = String(session).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); // session-mode.js normalizeSessionId
  const m = readJson(path.join(markerDir, `${safe}.json`));
  if (!m) return info;
  info.found = true;
  info.expired = !m.expires_at || Date.parse(m.expires_at) <= Date.now();
  info.started_at = str(m.started_at);
  info.root_run_id = str(m.root_run_id);
  info.campaign_roots = Array.isArray(m.campaign_roots) ? m.campaign_roots.filter((x) => typeof x === 'string' && x) : [];
  return info;
}

const byStart = (a, b) => {
  if (a.started_at && b.started_at && a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
  if (!a.started_at !== !b.started_at) return a.started_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function sortTree(n) { n.children.sort(byStart); n.children.forEach(sortTree); }

function attachAgents(agents, root) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  for (const a of agents) {
    let parent = root;
    if (a._parent) {
      const p = byId.get(a._parent);
      // walk up to detect a cycle before attaching
      let cyc = false;
      for (let q = p, hops = 0; q; q = byId.get(q._parent), hops++) {
        if (q === a || hops > agents.length) { cyc = true; break; }
      }
      if (cyc) { a.untracked = true; a.untracked_reason = 'cycle'; }
      else if (!p) { a.untracked = true; a.untracked_reason = 'parent_agent_not_found'; }
      else parent = p;
    } else if (a.spawn_depth === null) {
      a.untracked = true; a.untracked_reason = 'legacy_record_no_parent_info';
    } else if (a.spawn_depth >= 2) {
      a.untracked = true; a.untracked_reason = 'missing_parentAgentId';
    }
    parent.children.push(a);
  }
}

function attachRails(rails, session, marker, root) {
  const roots = new Set([marker.root_run_id, ...marker.campaign_roots].filter(Boolean));
  const byId = new Map(rails.map((r) => [r.id, r]));
  const ours = new Set();
  for (const r of rails) {
    if (r._session) { if (r._session === session) { ours.add(r); r.joined_by = 'session_id'; } }
    else if (r.root_run_id && roots.has(r.root_run_id)) { ours.add(r); r.joined_by = 'marker'; }
  }
  // descendants by parent_run_id belong to us even when their own session/root differ (loop-back children)
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rails) {
      if (ours.has(r) || !r.parent_run_id) continue;
      const p = byId.get(r.parent_run_id);
      if (p && ours.has(p)) { ours.add(r); r.joined_by = 'parent_run_id'; grew = true; }
    }
  }
  for (const r of ours) {
    let parent = root;
    if (r.parent_run_id) {
      const p = byId.get(r.parent_run_id);
      let cyc = false;
      for (let q = p, hops = 0; q; q = byId.get(q.parent_run_id), hops++) {
        if (q === r || hops > rails.length) { cyc = true; break; }
      }
      if (cyc) { r.untracked = true; r.untracked_reason = 'cycle'; }
      else if (!p) { r.untracked = true; r.untracked_reason = 'parent_run_not_found'; }
      else if (!ours.has(p)) { r.untracked = true; r.untracked_reason = 'parent_run_other_session'; }
      else parent = p;
    }
    parent.children.push(r);
  }
  return ours.size;
}

function strip(n) {
  delete n._parent; delete n._session;
  n.children.forEach(strip);
}

function count(n, acc) {
  for (const c of n.children) {
    if (c.kind === 'agent') acc.agents++; else acc.rails++;
    if (c.untracked) acc.untracked++;
    count(c, acc);
  }
  return acc;
}

function build(opts) {
  const warnings = [];
  const projectsDir = opts.projectsDir || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  let runsDir = opts.runsDir;
  if (!runsDir) {
    const ens = runtimePaths.ensureRunsDir(process.env);
    runsDir = ens.path;
    if (!ens.ok) warnings.push(`runs directory unusable: ${ens.reason}`);
  }
  const markerDir = opts.markerDir || process.env.AUTOPILOT_SESSION_MODE_DIR || path.join(os.homedir(), '.autopilot', 'session-mode');
  const sessionDir = findSessionDir(projectsDir, opts.session, warnings);
  if (!sessionDir) warnings.push(`no subagent record directory for session ${opts.session}`);
  const marker = readMarker(markerDir, opts.session);
  if (!marker.found) warnings.push('no session marker: rails joinable only through manifest.session_id');
  else if (marker.expired) warnings.push(`session marker is expired (started_at ${marker.started_at || 'unknown'}): rails joined through it may be incomplete`);
  const root = { kind: 'session', id: opts.session, children: [] };
  attachAgents(loadAgents(sessionDir), root);
  attachRails(loadRails(runsDir, warnings), opts.session, marker, root);
  strip(root); sortTree(root);
  return {
    schema_version: 1,
    session_id: opts.session,
    sources: { projects_dir: projectsDir, session_dir: sessionDir, runs_dir: runsDir, marker_dir: markerDir, marker },
    counts: count(root, { agents: 0, rails: 0, untracked: 0 }),
    warnings,
    root,
  };
}

function label(n) {
  if (n.kind === 'agent') return `agent ${n.id}${n.agent_type ? ` [${n.agent_type}]` : ''}${n.description ? ` ${n.description}` : ''}`;
  return `rail ${n.id}${n.role ? ` [${n.role}]` : ''}${n.runner ? ` ${n.runner}` : ''}${n.model ? `/${n.model}` : ''}${n.joined_by ? ` joined_by=${n.joined_by}` : ''}${n.ended_at ? ` ended${n.final_status ? ` ${n.final_status}` : ''}` : ' live?'}`;
}

function render(tree) {
  const lines = [`session ${tree.session_id}  (agents ${tree.counts.agents}, rails ${tree.counts.rails}, untracked ${tree.counts.untracked})`];
  const walk = (n, indent) => {
    for (const c of n.children) {
      lines.push(`${indent}${c.untracked ? '? ' : '- '}${label(c)}${c.untracked ? `  untracked: ${c.untracked_reason}` : ''}`);
      walk(c, `${indent}  `);
      if (c.trace_end) lines.push(`${indent}  ◦ 之後的工作沒有紀錄 (${c.trace_end})`);
    }
  };
  walk(tree.root, '  ');
  for (const w of tree.warnings) lines.push(`! ${w}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { process.stderr.write(`dispatch-tree: ${args.error}\n`); return 2; }
  const tree = build(args);
  const out = args.json ? `${JSON.stringify(tree)}\n` : render(tree);
  process.stdout.write(out);
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { build, render };
