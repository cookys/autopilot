#!/usr/bin/env node
'use strict';

// gate/check.js <capture-dir> [--json] — W4 real-machine gate: INDEPENDENT re-derivation of the band.
//
// Dev-time tool, not shipped. It deliberately shares no code with mods/live/model.ts, scripts/render-review-page.js or
// src/status/*: every rule below is written from the plan text (§4 P1W "W4 門檻", R5.5-R5.9) and the blueprint's
// cell -> source table, from the capture's own copies of the source files (see capture.sh for the layout).
// A disagreement between this checker and the band is a FINDING. Never tune a rule here to make a band pass.
//
// Expected values are derived from files only; the captured pane is read last and only compared.
//   verdict   attention kind permission|question OR an open decision file -> 要你決定
//             else any envelope run with stall:true                        -> 疑似卡住
//             else (frozen done==total OR every session task done) AND no live run -> 完成待驗收
//             else a live run OR a task in progress OR an active turn (turn.json state active, since within 24 h) -> 進行中
//             else                                                         -> 待命
//   project   repo identity, last directory of the git common dir's parent (else first 8 hex of the project key)
//   phase     campaign receipt phase > campaign phase kept by the job model > marker phase > task in progress > first open deliverable > —
//             (來源未接 when the sources manifest names phase, progress and task_status_input and all three are off)
//   progress  frozen: "<p>%" and "<n>/<N>"; unfrozen: "<n> done*"; none: 來源未接 (progress and tasks writers off) or —
//   decisions "代你決定 m 件（k 件不可逆）" when m>0, "n 件派工無決策紀錄" when n>0 (sidecar counts)
//   reason    要你決定: the attention summary or the decision question appears on band line 2
//   elapsed   start of this piece of work vs the capture instant, +-2 minutes
// Surface (dialogs): while a permission / AskUserQuestion dialog is open the band row is hidden and only the mod's top-right panel
//   shows the verdict word alone in its cell, the reason in the cell below. The band is judged when present; else the panel
//   (verdict + reason only; the other tokens print SKIP). The judged surface is printed as `surface: band|panel`.
// Exit: 0 every token PASS (or 來源未接 as expected), 1 any FAIL, 2 usage / unreadable capture.

const fs = require('fs');
const path = require('path');

const VERDICTS = [
  { mark: '▲', word: '要你決定' }, { mark: '⏸', word: '疑似卡住' }, { mark: '✓', word: '完成待驗收' },
  { mark: '●', word: '進行中' }, { mark: '◌', word: '待命' },
];
const NOT_WIRED = '來源未接';
const PHASE_ZH = {
  PREPARED: '準備', IMPLEMENTING: '實作', VERTICAL_VERIFICATION: '垂直驗證', REVIEWING: '審查', ADJUDICATING: '裁定',
  AWAITING_DISPOSITION: '等待處置', REPAIRING: '修復', TERMINAL_READY: '收尾', TERMINAL_FOLLOW_UP: '收尾（有後續）',
  TERMINAL_STOP: '已停止', BOUNDARY_REJECTED: '邊界被拒', AWAITING_CONVERGENCE_ADJUDICATION: '等待收斂裁定',
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return null; } }
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_e) { return null; } }
const ms = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };

function projectNameOf(identity, projectKey) {
  const fallback = String(projectKey || '').slice(0, 8) || '—';
  if (typeof identity !== 'string' || !identity.startsWith('git-common-dir:')) return fallback;
  let dir = identity.slice('git-common-dir:'.length).replace(/\/+$/, '');
  if (!dir.endsWith('/.git')) return fallback;
  dir = dir.slice(0, -5);
  return dir.split('/').filter(Boolean).pop() || fallback;
}

function elapsedText(startMs, nowMs) {
  if (startMs === null || nowMs < startMs) return '—';
  const min = Math.floor((nowMs - startMs) / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}
function parseElapsedMin(s) {
  let m = /^(\d+)d(\d+)h$/.exec(s); if (m) return (Number(m[1]) * 24 + Number(m[2])) * 60;
  m = /^(\d+)h(\d+)m$/.exec(s); if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+)m$/.exec(s); if (m) return Number(m[1]);
  return null;
}

// newest controller_progress_receipt among work-orders/*.json (issued_at, then generation)
function newestReceipt(dir, root) {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'work-orders')).filter((n) => n.endsWith('.json')).sort(); } catch (_e) { return null; }
  for (const n of names) {
    const f = readJson(path.join(dir, 'work-orders', n));
    if (!isObj(f)) continue;
    if (typeof f.root_run_id === 'string' && root && f.root_run_id !== root) continue;
    const list = isObj(f.controller) && Array.isArray(f.controller.progress_receipts) ? f.controller.progress_receipts : [];
    for (const r of list) {
      if (!isObj(r) || r.artifact_type !== 'controller_progress_receipt') continue;
      if (root && r.root_run_id !== root) continue;
      const key = [ms(r.issued_at) === null ? -Infinity : ms(r.issued_at), Number.isInteger(r.generation) ? r.generation : 0];
      if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] >= best.key[1])) best = { key, r, file: `work-orders/${n}` };
    }
  }
  return best;
}

function receiptStartMs(dir, root) {
  let best = Infinity;
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'work-orders')).filter((n) => n.endsWith('.json')); } catch (_e) { return null; }
  for (const n of names) {
    const f = readJson(path.join(dir, 'work-orders', n));
    if (!isObj(f) || (typeof f.root_run_id === 'string' && f.root_run_id !== root)) continue;
    const list = isObj(f.controller) && Array.isArray(f.controller.progress_receipts) ? f.controller.progress_receipts : [];
    for (const r of list) {
      if (isObj(r) && r.artifact_type === 'controller_progress_receipt' && r.root_run_id === root && ms(r.issued_at) !== null) best = Math.min(best, ms(r.issued_at));
    }
  }
  return best === Infinity ? null : best;
}

function derive(dir) {
  const J = (n) => readJson(path.join(dir, n));
  const meta = J('meta.json') || {};
  const marker = J('marker.json');
  const attention = J('attention.json');
  const turnFile = J('turn.json');
  const turnEff = J('turn-effective.json');
  const tasksFile = J('tasks.json');
  const envelope = J('envelope.json');
  const sidecar = J('decisions-sidecar.json');
  const decisionFile = J('decision-file.json');
  const model = J('model.json');
  const sourcesFile = J('sources.json') || (model && model.sources_manifest) || null;
  const nowMs = Number.isFinite(meta.captured_at_ms) ? meta.captured_at_ms : ms(meta.captured_at);
  const root = (marker && typeof marker.root_run_id === 'string' && marker.root_run_id) || meta.root_run_id || null;
  const files = {};
  const exp = { tokens: [], notes: [] };
  const put = (name, expected, source, extra) => exp.tokens.push({ name, expected, source, ...(extra || {}) });

  // ---- tasks (deleted ones never count)
  let tasks = null;
  if (isObj(tasksFile) && Array.isArray(tasksFile.tasks)) {
    const live = tasksFile.tasks.filter((t) => isObj(t) && t.status !== 'deleted');
    tasks = {
      total: live.length, completed: live.filter((t) => t.status === 'completed').length,
      inProgress: live.filter((t) => t.status === 'in_progress'),
      first: ms(tasksFile.first_created_at),
    };
  }
  const runs = envelope && Array.isArray(envelope.runs) ? envelope.runs.filter(isObj) : [];
  const stalled = runs.some((r) => r.stall === true);
  const liveRun = envelope && isObj(envelope.counts) && Number.isFinite(envelope.counts.confirmed_live)
    ? envelope.counts.confirmed_live > 0
    : runs.some((r) => r.alive === true && r.phase !== 'exited' && !r.ended_at && !r.final_status);

  // ---- progress
  const rec = newestReceipt(dir, root);
  let progress = null; // {frozen, done, total, pct, source, openId, phaseCode}
  if (rec) {
    const r = rec.r;
    const done = Array.isArray(r.completed_deliverables) ? r.completed_deliverables : null;
    const rem = Array.isArray(r.remaining_deliverables) ? r.remaining_deliverables : null;
    const frozen = Boolean(typeof r.frozen_denominator_digest === 'string' && r.frozen_denominator_digest && Number.isInteger(r.deliverable_count) && r.deliverable_count > 0 && done);
    progress = {
      frozen, done: done ? done.length : null, total: frozen ? r.deliverable_count : null,
      pct: frozen ? Math.round((done.length / r.deliverable_count) * 1000) / 10 : null,
      source: rec.file, openId: rem && rem.length ? String(rem[0]) : null, phaseCode: typeof r.phase === 'string' && r.phase ? r.phase : null,
    };
  } else if (model && isObj(model.progress) && model.progress.frozen === true && Number.isFinite(model.progress.done) && Number.isFinite(model.progress.total) && model.progress.total > 0) {
    progress = { frozen: true, done: model.progress.done, total: model.progress.total, pct: Math.round((model.progress.done / model.progress.total) * 1000) / 10, source: 'model.json', openId: null, phaseCode: null };
  }

  // ---- sources manifest
  const srcs = isObj(sourcesFile) && isObj(sourcesFile.sources) ? sourcesFile.sources : null;
  const off = (names) => srcs !== null && names.every((n) => isObj(srcs[n]) && !(srcs[n].installed === true && srcs[n].enabled === true));

  // ---- verdict
  const attKind = isObj(attention) ? attention.kind : null;
  const decisionOpen = isObj(decisionFile) && typeof decisionFile.question === 'string' && decisionFile.question !== '';
  const frozenDone = progress && progress.frozen && progress.done === progress.total;
  // turn.json (hooks/awaiting-owner.js): active while a prompt is being worked; older than the 24 h marker TTL = a crashed session's leftover
  const turnActive = isObj(turnFile) && turnFile.schema === 'autopilot.session-turn/1' && turnFile.state === 'active'
    && ms(turnFile.since) !== null && nowMs - ms(turnFile.since) <= 24 * 3600 * 1000
    // turn-effective.json (watcher-owned, GATEFIX2): an Escape interrupt fires no Stop; the watcher publishes `ended` for that ONE turn (same `since`).
    && !(isObj(turnEff) && turnEff.schema === 'autopilot.session-turn-effective/1' && turnEff.state === 'ended' && turnEff.turn_since === turnFile.since);
  const tasksDone = tasks && tasks.total > 0 && tasks.completed === tasks.total;
  let verdict; let verdictSource;
  if (attKind === 'permission' || attKind === 'question') { verdict = '要你決定'; verdictSource = 'attention.json kind=' + attKind; }
  else if (decisionOpen) { verdict = '要你決定'; verdictSource = 'decision-file.json (open)'; }
  else if (stalled) { verdict = '疑似卡住'; verdictSource = 'envelope.json run stall:true'; }
  else if ((frozenDone || tasksDone) && !liveRun) { verdict = '完成待驗收'; verdictSource = frozenDone ? `${progress.source} frozen ${progress.done}/${progress.total}` : 'tasks.json all completed'; }
  else if (liveRun || (tasks && tasks.inProgress.length > 0) || turnActive) {
    verdict = '進行中';
    verdictSource = liveRun ? 'envelope.json live run' : (tasks && tasks.inProgress.length > 0) ? 'tasks.json in_progress' : 'turn.json active';
  }
  else { verdict = '待命'; verdictSource = 'nothing live, awaited or complete'; }
  put('verdict', verdict, verdictSource, { exact: true });

  // ---- project
  const identity = (envelope && envelope.scope && envelope.scope.repo_identity) || (marker && marker.repo_identity) || null;
  const pkey = (envelope && envelope.scope && envelope.scope.project_key) || (marker && marker.project_key) || meta.project_key || '';
  put('project', projectNameOf(identity, pkey), envelope ? 'envelope.json scope.repo_identity' : 'marker.json repo_identity');

  // ---- phase
  let phaseAlts = null; let phaseSource = '';
  const taskNow = tasks && tasks.inProgress.length
    ? tasks.inProgress.slice().sort((a, b) => (b.started_seq || 0) - (a.started_seq || 0))[0] : null;
  if (progress && progress.phaseCode) {
    phaseAlts = [progress.phaseCode, PHASE_ZH[progress.phaseCode.toUpperCase()]].filter(Boolean); phaseSource = `${progress.source} phase`;
  } else if (model && isObj(model.phase) && model.phase.source === 'campaign' && typeof model.phase.label === 'string' && model.phase.label) {
    phaseAlts = [model.phase.label]; phaseSource = 'model.json phase (campaign)';
  } else if (marker && typeof marker.phase === 'string' && marker.phase) {
    phaseAlts = [marker.phase]; phaseSource = 'marker.json phase';
  } else if (taskNow && typeof taskNow.subject === 'string' && taskNow.subject.trim()) {
    const s = taskNow.subject.replace(/\s+/g, ' ').trim();
    phaseAlts = [`做：${s.length > 40 ? `${s.slice(0, 39)}…` : s}`]; phaseSource = 'tasks.json in_progress task';
  } else if (progress && progress.openId) {
    phaseAlts = [`做 ${progress.openId}`]; phaseSource = `${progress.source} first open deliverable`;
  } else if (off(['phase', 'progress', 'task_status_input'])) {
    phaseAlts = [NOT_WIRED]; phaseSource = 'sources.json phase/progress/task_status_input all off';
  } else { phaseAlts = ['—']; phaseSource = 'no phase source has data'; }
  put('phase', phaseAlts, phaseSource);

  // ---- progress text
  if (progress && progress.frozen) {
    put('progress', [`${progress.pct}%`, `${progress.done}/${progress.total}`], progress.source, { all: true });
  } else if (progress && progress.done !== null) {
    put('progress', [`${progress.done} done*`], progress.source);
  } else if (tasks && tasks.total > 0) {
    put('progress', [`${tasks.completed} done*`], 'tasks.json');
  } else if (off(['progress', 'tasks'])) {
    put('progress', [NOT_WIRED], 'sources.json progress/tasks off');
  } else put('progress', ['—'], 'no progress source has data');

  // ---- decisions line + reason
  if (isObj(sidecar)) {
    const m = Number.isInteger(sidecar.count) ? sidecar.count : 0;
    const k = Number.isInteger(sidecar.irreversible_count) ? sidecar.irreversible_count : 0;
    const n = Number.isInteger(sidecar.undocumented_dispatches) ? sidecar.undocumented_dispatches : 0;
    if (m > 0) put('decisions', [`代你決定 ${m} 件（${k} 件不可逆）`], 'decisions-sidecar.json count/irreversible_count', { line2: true });
    if (n > 0) put('undocumented', [`${n} 件派工無決策紀錄`], 'decisions-sidecar.json undocumented_dispatches', { line2: true });
    if (m === 0 && n === 0) put('no-decisions-line', null, 'decisions-sidecar.json counts zero', { absent: ['代你決定', '件派工無決策紀錄'] });
  } else {
    exp.notes.push('no decisions sidecar in the capture: decisions line not checked');
  }
  if (verdict === '要你決定') {
    if (attKind === 'permission' || attKind === 'question') put('reason', [String(attention.summary || '').slice(0, 30)], 'attention.json summary', { line2: true });
    else put('reason', [String(decisionFile.question).slice(0, 30)], 'decision-file.json question', { line2: true });
  }

  if (verdict === '進行中' && !liveRun && !(tasks && tasks.inProgress.length > 0)) put('reason', ['回合進行中'], 'turn.json active (no live run, no task in progress)', { line2: true });

  // ---- elapsed
  // campaign root with a bound receipt: earliest receipt; otherwise the session's own start (tasks, then marker); last the earliest run
  let start = null; let startSource = '';
  const rs = root ? receiptStartMs(dir, root) : null;
  if (rs !== null) { start = rs; startSource = 'work-orders earliest receipt'; }
  else if (tasks && tasks.first !== null) { start = tasks.first; startSource = 'tasks.json first_created_at'; }
  else if (marker && ms(marker.started_at) !== null) { start = ms(marker.started_at); startSource = 'marker.json started_at'; }
  else {
    const starts = runs.map((r) => ms(r.started_at)).filter((x) => x !== null);
    if (starts.length) { start = Math.min(...starts); startSource = 'envelope.json earliest run'; }
  }
  if (nowMs !== null && start !== null) put('elapsed', elapsedText(start, nowMs), startSource, { tolerantMin: 2, startMs: start, nowMs });
  else exp.notes.push('elapsed not derivable (no start source or no capture time)');

  return { meta, tokens: exp.tokens, notes: exp.notes, verdict };
}

// the band = the last line carrying one of the five marks + verdict words, and the line after it
function findBand(paneText) {
  const lines = String(paneText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    for (const v of VERDICTS) {
      const at = lines[i].indexOf(`${v.mark} ${v.word}`);
      if (at >= 0) return { verdict: v.word, line1: lines[i].slice(at), line2: (lines[i + 1] || '').trim(), line1Raw: lines[i] };
    }
  }
  return null;
}

// the panel (right-hand column, after the last │): a cell that is exactly one verdict word, the cell on the next line is the reason
function findPanel(paneText) {
  const cells = String(paneText || '').split('\n').map((l) => { const parts = l.split('│').map((p) => p.trim()).filter(Boolean); return l.includes('│') ? (parts[parts.length - 1] || '') : l.trim(); });
  for (let i = 0; i < cells.length; i += 1) {
    const v = VERDICTS.find((x) => cells[i] === x.word);
    if (v) return { verdict: v.word, line1: v.word, line2: cells[i + 1] || '', surface: 'panel' };
  }
  return null;
}

function compare(derived, band) {
  const results = [];
  for (const t of derived.tokens) {
    const r = { name: t.name, source: t.source, expected: t.expected, status: 'FAIL', detail: '' };
    if (!band) { r.detail = 'no band or panel verdict found in the pane'; results.push(r); continue; }
    if (band.surface === 'panel' && t.name !== 'verdict' && t.name !== 'reason') { r.status = 'SKIP'; r.detail = 'not shown on the panel'; results.push(r); continue; }
    const text = t.line2 ? band.line2 : band.line1;
    if (t.exact) {
      r.status = band.verdict === t.expected ? 'PASS' : 'FAIL';
      r.detail = `band shows ${band.verdict}`;
    } else if (t.absent) {
      const hit = t.absent.filter((s) => band.line2.includes(s) || band.line1.includes(s));
      r.status = hit.length === 0 ? 'PASS' : 'FAIL'; r.detail = hit.length ? `band shows ${hit.join(', ')}` : 'band shows none';
    } else if (t.tolerantMin !== undefined) {
      const segs = band.line1.split(' · ');
      const shown = segs.length >= 3 ? segs[2].trim() : null;
      const min = shown === null ? null : parseElapsedMin(shown);
      if (t.expected === '—') { r.status = shown === '—' ? 'PASS' : 'FAIL'; r.detail = `band shows ${shown}`; }
      else if (min === null) { r.detail = `band elapsed unreadable (${shown})`; }
      else { const want = parseElapsedMin(t.expected); r.status = Math.abs(min - want) <= t.tolerantMin ? 'PASS' : 'FAIL'; r.detail = `band shows ${shown}`; }
    } else {
      const alts = Array.isArray(t.expected) ? t.expected : [t.expected];
      const ok = t.all ? alts.every((a) => text.includes(a)) : alts.some((a) => text.includes(a));
      r.status = ok ? 'PASS' : 'FAIL';
      r.detail = ok ? '' : `band line ${t.line2 ? 2 : 1}: ${text}`;
    }
    results.push(r);
  }
  return results;
}

function run(dir) {
  const derived = derive(dir);
  const pane = readText(path.join(dir, 'pane.txt')) || `${readText(path.join(dir, 'band.txt')) || ''}\n${readText(path.join(dir, 'panel.txt')) || ''}`;
  const bandOnly = findBand(pane);
  const band = bandOnly ? { ...bandOnly, surface: 'band' } : findPanel(pane);
  const results = compare(derived, band);
  return {
    derived, band, results, surface: band ? band.surface : null,
    ok: results.length > 0 && results.every((r) => r.status === 'PASS' || r.status === 'SKIP') && results.some((r) => r.status === 'PASS'),
  };
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  if (args.length !== 1 || !fs.existsSync(args[0]) || !fs.statSync(args[0]).isDirectory()) {
    process.stderr.write('usage: check.js <capture-dir> [--json]\n');
    return 2;
  }
  const out = run(args[0]);
  if (argv.includes('--json')) { process.stdout.write(`${JSON.stringify({ ok: out.ok, results: out.results, surface: out.surface, notes: out.derived.notes }, null, 2)}\n`); return out.ok ? 0 : 1; }
  process.stdout.write(`capture ${args[0]}  cell=${out.derived.meta.cell || '?'}\n`);
  process.stdout.write(`surface: ${out.surface || 'none'}\n`);
  process.stdout.write(`${out.surface === 'panel' ? 'panel' : 'band'}: ${out.band ? `${out.band.line1}\n      ${out.band.line2}` : 'NOT FOUND'}\n`);
  for (const r of out.results) {
    const exp = Array.isArray(r.expected) ? r.expected.join(' + ') : String(r.expected);
    process.stdout.write(`${r.status}  ${r.name.padEnd(12)} expected ${exp}  [${r.source}]${r.detail ? `  (${r.detail})` : ''}\n`);
  }
  for (const n of out.derived.notes) process.stdout.write(`note: ${n}\n`);
  process.stdout.write(out.ok ? 'RESULT: PASS\n' : 'RESULT: FAIL\n');
  return out.ok ? 0 : 1;
}

module.exports = { derive, compare, findBand, findPanel, run, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
