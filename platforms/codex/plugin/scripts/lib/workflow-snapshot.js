'use strict';

/**
 * workflow-snapshot.js — collect the workflow state a session needs after a compaction or /clear
 * from files that already exist on disk, and render it as a bounded block of text.
 * Plan: docs/plans/2026-10-13-workflow-snapshot-at-compaction.md (P1).
 *
 * Callers: hooks/state-checkpoint.js (PreCompact: file + stdout to the summarizer) and
 * hooks/session-handoff.js (SessionEnd on /clear).
 *
 * Contract: every source is optional and fail-open. A missing, unreadable, malformed or stale
 * source gives ONE line "<source>: absent (<reason>)" — never an invented value. Nothing here
 * writes, and nothing is a verdict: this reads state, it does not attest to it (ADR-0001).
 * Session id is passed in (the hook payload carries it); the cwd fallback of session-mode.js
 * getSessionId is deliberately not used.
 *
 * API:
 *   collect({ sessionId, cwd, now?, dirs?, git? }) -> { lines: string[], sources: {name: 'ok'|'absent'},
 *     bySource: {name: string[]}, marker: object|null }   (bySource/marker serve a hook's own section layout)
 *   render(snapshot, { maxBytes }) -> string   (whole lines only; ends with "... N lines omitted" if cut)
 *   snapshotText({ ...collect opts, maxBytes }) -> string
 * dirs (all optional, for tests): sessionMode, live, taskCard, dispatchRuns.
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const STALE_MS = 24 * 3600 * 1000;
const AGENT_STALE_MS = 30 * 60 * 1000;
const ROSTER_READ_CAP = 40;
const MANIFEST_READ_CAP = 60;
const TAIL_READ_BYTES = 64 * 1024;
const GIT_TIMEOUT_MS = 3000;

function norm(raw) { return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); }
function clip(v, n) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}
function ageLabel(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
function absent(name, reason) { return { name, ok: false, lines: [`${name}: absent (${reason})`] }; }
function ok(name, lines) { return { name, ok: true, lines }; }

function liveBase(dirs) {
  if (dirs.live) return dirs.live;
  try {
    const { resolveLiveDir } = require('./live-state-dir.js');
    return resolveLiveDir({ warn: () => {} }).base;
  } catch { return null; }
}

// --- sources --------------------------------------------------------------------------------

function readMarker(ctx) {
  const dir = ctx.dirs.sessionMode || process.env.AUTOPILOT_SESSION_MODE_DIR
    || path.join(os.homedir(), '.autopilot', 'session-mode');
  const m = readJson(path.join(dir, `${norm(ctx.sessionId)}.json`));
  if (!m) return null;
  if (!m.expires_at || Date.parse(m.expires_at) <= ctx.now) return null; // expired: same rule as readSessionRecord
  return m;
}

function srcSession(ctx) {
  const m = ctx.marker;
  if (!m) return absent('session', 'no unexpired session-mode marker');
  const bits = [];
  bits.push(m.level ? `level ${m.level}` : 'plain session (no orchestrator level)');
  if (m.size) bits.push(`size ${m.size}${m.urgent ? '!' : ''}${m.bug ? ' bug' : ''}${m.high_risk ? ' high-risk' : ''}`);
  bits.push(m.stage ? `stage ${m.stage}` : 'stage not set');
  if (m.unit) bits.push(`unit ${clip(m.unit, 60)}`);
  if (m.task_seq) bits.push(`task #${m.task_seq}`);
  if (m.root_run_id) bits.push(`root ${clip(m.root_run_id, 40)}`);
  return ok('session', [`session: ${bits.join(' · ')}`]);
}

function srcNext(ctx) {
  const m = ctx.marker || {};
  let size = m.size; let stage = m.stage; let flags = m;
  let from = 'marker';
  if (!(size && stage)) {
    const live = liveBase(ctx.dirs);
    const sw = live ? readJson(path.join(live, 'stage', `${norm(ctx.sessionId)}.json`)) : null;
    if (sw && sw.size && sw.current) { size = sw.size; stage = sw.current; flags = sw; from = 'stage file'; }
  }
  if (!size || !stage) return absent('next legal node', 'no size and stage in the marker or the stage file');
  const sg = require('../stage-graph.js');
  const graph = JSON.parse(fs.readFileSync(sg.DEFAULT_GRAPH, 'utf8'));
  if (!graph.sizes[size]) return absent('next legal node', `unknown size ${clip(size, 12)}`);
  if (!graph.node_ids.includes(stage)) return absent('next legal node', `unknown stage ${clip(stage, 20)}`);
  const next = sg.nextNodes(graph, {
    size, bug: !!flags.bug, urgent: !!flags.urgent, highRisk: !!flags.high_risk, research: false, units: 1,
  }, stage);
  return ok('next legal node', [`next legal node after ${stage}: ${next.length ? next.join(', ') : '(none, terminal)'} (from ${from})`]);
}

function srcGit(ctx) {
  const run = ctx.git || ((cwd) => {
    const r = spawnSync('git', ['-C', cwd, 'status', '--porcelain=v2', '--branch'], { timeout: GIT_TIMEOUT_MS, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
  });
  if (!ctx.cwd) return absent('git', 'no cwd in the payload');
  const out = run(ctx.cwd);
  if (out == null) return absent('git', 'not a git work tree or git failed');
  let head = null; let oid = null; let dirty = 0;
  for (const line of String(out).split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim();
    else if (line && !line.startsWith('#')) dirty++;
  }
  if (!head) return absent('git', 'no branch header in git output');
  const short = oid && oid !== '(initial)' ? oid.slice(0, 8) : 'no commit';
  ctx.headOid = oid && oid !== '(initial)' ? oid : null; // srcCodeReview compares the recorded round's head with this
  return ok('git', [`git: branch ${head === '(detached)' ? '(detached HEAD)' : head} @ ${short}, ${dirty} changed path${dirty === 1 ? '' : 's'}`]);
}

function srcTaskCard(ctx) {
  const dir = ctx.dirs.taskCard || process.env.AUTOPILOT_TASK_CARD_DIR || path.join(os.homedir(), '.autopilot', 'task-card');
  const c = readJson(path.join(dir, `${norm(ctx.sessionId)}.json`));
  if (!c || c.schema !== 'autopilot.task-card/1') return absent('task card', 'none written for this session; scripts/task-card.js set writes one');
  ctx.card = c;
  const lines = [];
  if (c.goal) lines.push(`goal: ${clip(c.goal, 300)}`);
  if (Array.isArray(c.success) && c.success.length) lines.push(`success criteria: ${c.success.slice(0, 5).map((s) => clip(s, 140)).join(' | ')}`);
  if (c.plan) lines.push(`plan: ${clip(c.plan, 200)}`);
  if (c.review_ledger) lines.push(`review ledger: ${clip(c.review_ledger, 200)}`);
  if (Array.isArray(c.requirements) && c.requirements.length) lines.push(`stated requirements: ${c.requirements.slice(0, 6).map((s) => clip(s, 140)).join(' | ')}`);
  if (!lines.length) return absent('task card', 'card has no fields');
  return ok('task card', lines.map((l, i) => (i === 0 ? `task card — ${l}` : `task card — ${l}`)));
}

function srcTasks(ctx) {
  const live = liveBase(ctx.dirs);
  if (!live) return absent('session tasks', 'no live-state directory');
  const t = readJson(path.join(live, 'tasks', `${norm(ctx.sessionId)}.json`));
  if (!t || !Array.isArray(t.tasks)) return absent('session tasks', 'no task list for this session');
  const live_ = t.tasks.filter((x) => x && x.status !== 'deleted');
  if (!live_.length) return absent('session tasks', 'task list is empty');
  const done = live_.filter((x) => x.status === 'completed').length;
  const open = live_.filter((x) => x.status === 'pending' || x.status === 'in_progress');
  const stale = Date.parse(t.updated_at) && ctx.now - Date.parse(t.updated_at) > STALE_MS ? ' [stale: not updated for over 24h]' : '';
  const lines = [`session tasks: ${done}/${live_.length} completed${stale}`];
  for (const x of open.slice(0, 6)) lines.push(`  - [${x.status === 'in_progress' ? 'doing' : 'todo'}] #${clip(x.id, 8)} ${clip(x.subject, 120)}`);
  if (open.length > 6) lines.push(`  - ... ${open.length - 6} more open`);
  return ok('session tasks', lines);
}

function srcCodeReview(ctx) {
  const key = ctx.marker && ctx.marker.project_key;
  if (!key || !/^[0-9a-f]{8,64}$/.test(String(key))) return absent('code review', 'no project key in the marker');
  const live = liveBase(ctx.dirs);
  const r = live ? readJson(path.join(live, 'review-rounds', `${key}.json`)) : null;
  if (!r || r.schema !== 'autopilot.review-round/1') return absent('code review', 'no review round recorded for this project');
  const seats = Array.isArray(r.seats) ? r.seats : [];
  const verdicts = seats.map((s) => `${clip(s.family || s.id, 12)}=${clip(s.verdict || s.status, 16)}`).join(' ');
  const when = ageLabel(r.at, ctx.now);
  const stale = Date.parse(r.at) && ctx.now - Date.parse(r.at) > STALE_MS ? ' [stale]' : '';
  // review-rounds/<project_key>.json is shared by every worktree of the repo (the key comes from the git
  // common dir), so the last writer wins. A recorded head that is not this checkout's HEAD may be another
  // lane's round or an older round of this one: keep the facts but say so, never present it as this lane's.
  const recorded = String(r.head || '');
  const cur = ctx.headOid ? String(ctx.headOid) : '';
  const differs = recorded && cur && !(cur.startsWith(recorded) || recorded.startsWith(cur));
  const headNote = differs ? ` [head differs: round reviewed ${recorded.slice(0, 8)}, this checkout is at ${cur.slice(0, 8)}; may be another worktree's or an older round]` : (!cur ? ' [head not compared; shared by every worktree]' : '');
  return ok('code review', [`code review: phase ${clip(r.phase, 24)} generation ${clip(r.generation, 4)} head ${recorded.slice(0, 8)} ${r.converged ? 'converged' : 'not converged'}${verdicts ? `; ${verdicts}` : ''}${when ? ` (${when})` : ''}${stale}${headNote}`]);
}

function srcPlanReview() {
  return absent('plan review', 'not collected: its state key cannot be derived from the session alone');
}

function tailLines(file, maxBytes) {
  const st = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    let text = buf.toString('utf8');
    if (st.size > len) text = text.slice(text.indexOf('\n') + 1);
    return text.split('\n').filter(Boolean);
  } finally { fs.closeSync(fd); }
}

function srcLedger(ctx) {
  let file = ctx.card && ctx.card.ledger ? String(ctx.card.ledger) : null;
  let how = 'task card';
  if (file && !path.isAbsolute(file) && ctx.cwd) file = path.join(ctx.cwd, file);
  if (!file && ctx.cwd) {
    try {
      const pdir = path.join(ctx.cwd, 'docs', 'projects');
      let best = null;
      for (const e of fs.readdirSync(pdir)) {
        const f = path.join(pdir, e, 'ledger', 'decisions.jsonl');
        let st; try { st = fs.statSync(f); } catch { continue; }
        if (ctx.now - st.mtimeMs <= STALE_MS && (!best || st.mtimeMs > best.m)) best = { f, m: st.mtimeMs };
      }
      if (best) { file = best.f; how = 'newest docs/projects/*/ledger by mtime, under 24h, may be another session\'s in this checkout'; }
    } catch { /* no projects dir */ }
  }
  if (!file) return absent('decision ledger', 'no ledger path in the task card and none modified in the last 24h');
  let rows;
  try { rows = tailLines(file, TAIL_READ_BYTES); } catch { return absent('decision ledger', 'ledger file unreadable'); }
  const picked = [];
  for (let i = rows.length - 1; i >= 0 && picked.length < 3; i--) {
    let r; try { r = JSON.parse(rows[i]); } catch { continue; }
    if (r && ['decision', 'pick', 'refreeze', 'veto'].includes(r.kind)) picked.push(r);
  }
  if (!picked.length) return absent('decision ledger', 'no decision rows in the ledger tail');
  const lines = [`decision ledger (${how}): last ${picked.length}`];
  for (const r of picked.reverse()) lines.push(`  - ${clip(r.kind, 10)} ${clip(r.decision_id || r.target_decision_id, 24)}: ${clip(r.rationale || r.reason || r.row_title, 140)}`);
  return ok('decision ledger', lines);
}

function srcDispatches(ctx) {
  const dir = ctx.dirs.dispatchRuns || process.env.AUTOPILOT_DISPATCH_RUNS_DIR
    || path.join(process.env.TMPDIR || '/tmp', 'autopilot-dispatch-runs');
  const m = ctx.marker;
  const roots = new Set();
  if (m && m.root_run_id) roots.add(m.root_run_id);
  if (m && Array.isArray(m.campaign_roots)) for (const r of m.campaign_roots) roots.add(r);
  if (!roots.size) return absent('dispatches', 'no root run id in the marker to match manifests against');
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.manifest.json')); } catch { return absent('dispatches', 'no dispatch-runs directory'); }
  const rows = names.map((n) => { try { return { n, m: fs.statSync(path.join(dir, n)).mtimeMs }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.m - a.m).slice(0, MANIFEST_READ_CAP);
  const live = [];
  for (const r of rows) {
    const mf = readJson(path.join(dir, r.n));
    if (!mf || !roots.has(mf.root_run_id) || mf.ended_at) continue;
    let alive = true;
    if (Number.isInteger(mf.pid)) { try { process.kill(mf.pid, 0); } catch (e) { alive = e.code === 'EPERM'; } }
    if (alive) live.push(mf);
  }
  if (!live.length) return ok('dispatches', ['dispatches: none in flight for this session\'s root']);
  const lines = [`dispatches in flight: ${live.length}`];
  for (const d of live.slice(0, 5)) lines.push(`  - ${clip(d.role, 14)} ${clip(d.runner, 12)}/${clip(d.model, 20)} run ${clip(d.run_id, 36)} started ${ageLabel(d.started_at, ctx.now) || '?'}`);
  if (live.length > 5) lines.push(`  - ... ${live.length - 5} more`);
  return ok('dispatches', lines);
}

function srcRoster(ctx) {
  const live = liveBase(ctx.dirs);
  if (!live) return absent('subagents', 'no live-state directory');
  const dir = path.join(live, 'agents', norm(ctx.sessionId));
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return absent('subagents', 'no agent activity recorded for this session'); }
  const rows = names.map((n) => { try { return { n, m: fs.statSync(path.join(dir, n)).mtimeMs }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.m - a.m).slice(0, ROSTER_READ_CAP);
  const running = [];
  for (const r of rows) {
    const a = readJson(path.join(dir, r.n));
    if (!a || a.ended_at) continue;
    const t = Date.parse(a.last_tool_at);
    if (Number.isFinite(t) && ctx.now - t > AGENT_STALE_MS) continue; // un-ended but silent: not counted as running
    running.push(a);
  }
  const lines = [`subagents: ${names.length} recorded, ${running.length} running (newest ${Math.min(names.length, ROSTER_READ_CAP)} read)`];
  for (const a of running.slice(0, 5)) {
    lines.push(`  - ${clip(a.agent_type || 'unknown type', 30)} ${clip(a.agent_id, 20)} last tool ${clip(a.last_tool_name || 'none yet', 16)} ${ageLabel(a.last_tool_at, ctx.now) || ''}`.trimEnd());
  }
  return ok('subagents', lines);
}

// --- public ---------------------------------------------------------------------------------

function collect(opts = {}) {
  const ctx = {
    sessionId: opts.sessionId || '',
    cwd: opts.cwd || '',
    now: Number.isFinite(opts.now) ? opts.now : Date.now(),
    dirs: opts.dirs || {},
    git: opts.git,
    marker: null,
    card: null,
  };
  const sources = {};
  const lines = [];
  const bySource = {};
  const run = (name, fn) => {
    let res;
    try { res = fn(ctx); } catch (e) { res = absent(name, `error: ${clip(e && e.message, 80)}`); }
    sources[name] = res.ok ? 'ok' : 'absent';
    bySource[name] = res.lines;
    lines.push(...res.lines);
  };
  if (!ctx.sessionId) {
    lines.push('session: absent (the hook payload carried no session id)');
    sources.session = 'absent';
  } else {
    try { ctx.marker = readMarker(ctx); } catch { ctx.marker = null; }
    run('session', srcSession);
    run('next legal node', srcNext);
  }
  run('git', srcGit);
  if (ctx.sessionId) {
    run('task card', srcTaskCard);
    run('session tasks', srcTasks);
    run('code review', srcCodeReview);
    run('plan review', srcPlanReview);
    run('decision ledger', srcLedger);
    run('dispatches', srcDispatches);
    run('subagents', srcRoster);
  }
  return { lines, sources, bySource, marker: ctx.marker };
}

function render(snapshot, { maxBytes = 3000 } = {}) {
  const head = 'Workflow state read from disk (a source marked absent was missing; nothing is guessed):';
  const out = [head];
  let used = Buffer.byteLength(head) + 1;
  const reserve = 40; // room for the omitted-lines marker
  let i = 0;
  for (; i < snapshot.lines.length; i++) {
    const b = Buffer.byteLength(snapshot.lines[i]) + 1;
    if (used + b + reserve > maxBytes && i < snapshot.lines.length) break;
    out.push(snapshot.lines[i]);
    used += b;
  }
  if (i < snapshot.lines.length) out.push(`... ${snapshot.lines.length - i} lines omitted`);
  return out.join('\n');
}

// Structured facts for the PostCompact check: the branch and the stage as they are on disk right now.
// null when a source is missing; the same sources and rules as collect().
function facts(opts = {}) {
  const ctx = { sessionId: opts.sessionId || '', cwd: opts.cwd || '', now: Number.isFinite(opts.now) ? opts.now : Date.now(), dirs: opts.dirs || {}, git: opts.git };
  let stage = null;
  try { const m = ctx.sessionId ? readMarker(ctx) : null; stage = m && m.stage ? String(m.stage) : null; } catch { stage = null; }
  let branch = null;
  try {
    const g = srcGit(ctx);
    const mm = g.ok ? /branch (\S+) @/.exec(g.lines[0]) : null;
    branch = mm && mm[1] !== '(detached' ? mm[1] : null;
  } catch { branch = null; }
  return { branch, stage };
}

function snapshotText(opts = {}) {
  return render(collect(opts), { maxBytes: opts.maxBytes || 3000 });
}

module.exports = { collect, facts, render, snapshotText, STALE_MS };
