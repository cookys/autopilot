#!/usr/bin/env node
'use strict';

// gate/check.js <capture-dir> [--json] — W4 real-machine gate: INDEPENDENT re-derivation of the band.
//
// Dev-time tool, not shipped. It deliberately shares no code with mods/live/model.ts, scripts/render-review-page.js or
// src/status/*: every rule below is written from the plan text (§4 P1W "W4 門檻", R5.5-R5.9) and the blueprint's
// cell -> source table, from the capture's own copies of the source files (see capture.sh for the layout).
// A disagreement between this checker and the band is a FINDING. Never tune a rule here to make a band pass.
//
// Root set (mods P1W SCOPE, gate run l5g): the session's band follows the root of its marker AND every root in marker.json
//   `campaign_roots` (the Mission roots of campaigns it launched; oldest -> newest). capture.sh copies envelope--<root>.json,
//   decisions-sidecar--<root>.json, model--<root>.json and campaign-work-orders/<root>/*.json per extra root. This checker
//   re-derives the union by its own code: live counts / stall rows / proxy decisions summed over the marker root's envelope and
//   every FRESH extra envelope (published_at within valid_for_s, default 180, of the capture instant); frozen progress and phase from the
//   newest campaign root that has them; the elapsed start from the newest campaign root with a bound receipt. A missing or stale
//   extra envelope contributes nothing and never hides the others.
// Expected values are derived from files only; the captured pane is read last and only compared.
//   verdict   attention kind permission|question OR an open decision file -> 要你決定
//             else any envelope run with stall:true                        -> 疑似卡住
//             else an un-ended agent (agents/*.json, no ended_at, last_tool_at within 24 h) quiet >= 180 s -> 疑似卡住 (reason 工頭 N 分沒有動作)
//             else (frozen done==total OR every session task done) AND no live run AND no un-ended agent quiet < 180 s -> 完成待驗收
//             else a live run OR an un-ended agent quiet < 180 s (reason 工頭在跑) OR a task in progress OR an active turn (turn.json state active, since within 24 h) -> 進行中
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
//   (verdict + reason only; the other tokens print SKIP). The judged surface is printed as `surface: band|panel|dialog`.
//   A dialog raised by a subagent is full-width and hides BOTH the band and the panel (gate run l4-running-foreman): when neither is
//   visible but the pane shows a permission / question dialog, only the verdict is judged, from attention.json alone
//   (kind permission|question -> 要你決定); `surface: dialog`. A dialog with no such attention file FAILs.
// Exit: 0 every token PASS (or 來源未接 as expected), 1 any FAIL, 2 usage / unreadable capture.

const fs = require('fs');
const path = require('path');

const VERDICTS = [
  { mark: '▲', word: '要你決定' }, { mark: '⏸', word: '疑似卡住' }, { mark: '✓', word: '完成待驗收' },
  { mark: '●', word: '進行中' }, { mark: '◌', word: '待命' },
];
const NOT_WIRED = '來源未接';
const FOREMAN_STALL_S = 180; // the dispatch stall bound (dispatch-status.js DEFAULT_STALL_SECS); written here from the plan text, not imported
const MARKER_TTL_MS = 24 * 3600 * 1000;
const PHASE_ZH = {
  PREPARED: '準備', IMPLEMENTING: '實作', VERTICAL_VERIFICATION: '垂直驗證', REVIEWING: '審查', ADJUDICATING: '裁定',
  AWAITING_DISPOSITION: '等待處置', REPAIRING: '修復', TERMINAL_READY: '收尾', TERMINAL_FOLLOW_UP: '收尾（有後續）',
  TERMINAL_STOP: '已停止', BOUNDARY_REJECTED: '邊界被拒', AWAITING_CONVERGENCE_ADJUDICATION: '等待收斂裁定',
  COMPLETED: '完成', FOLLOW_UP: '收尾（有後續）', TERMINAL: '已結束', SEALED_ZERO_DIFF: '零差異封存',
  AWAITING_EFFECT_RECONCILIATION: '等待效果對帳', ADOPTED_ORPHAN: '接手孤兒',
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
function newestReceipt(dir, root, sub = 'work-orders') {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(path.join(dir, sub)).filter((n) => n.endsWith('.json')).sort(); } catch (_e) { return null; }
  for (const n of names) {
    const f = readJson(path.join(dir, sub, n));
    if (!isObj(f)) continue;
    if (typeof f.root_run_id === 'string' && root && f.root_run_id !== root) continue;
    const list = isObj(f.controller) && Array.isArray(f.controller.progress_receipts) ? f.controller.progress_receipts : [];
    for (const r of list) {
      if (!isObj(r) || r.artifact_type !== 'controller_progress_receipt') continue;
      if (root && r.root_run_id !== root) continue;
      const key = [ms(r.issued_at) === null ? -Infinity : ms(r.issued_at), Number.isInteger(r.generation) ? r.generation : 0];
      if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] >= best.key[1])) best = { key, r, file: `${sub}/${n}` };
    }
  }
  return best;
}

function receiptStartMs(dir, root, sub = 'work-orders') {
  let best = Infinity;
  let names = [];
  try { names = fs.readdirSync(path.join(dir, sub)).filter((n) => n.endsWith('.json')); } catch (_e) { return null; }
  for (const n of names) {
    const f = readJson(path.join(dir, sub, n));
    if (!isObj(f) || (typeof f.root_run_id === 'string' && f.root_run_id !== root)) continue;
    const list = isObj(f.controller) && Array.isArray(f.controller.progress_receipts) ? f.controller.progress_receipts : [];
    for (const r of list) {
      if (isObj(r) && r.artifact_type === 'controller_progress_receipt' && r.root_run_id === root && ms(r.issued_at) !== null) best = Math.min(best, ms(r.issued_at));
    }
  }
  return best === Infinity ? null : best;
}

// marker.campaign_roots: plain strings only (they name files), not the marker's own root, no repeats, at most 8, oldest -> newest
function campaignRootsOf(marker, root) {
  const raw = marker && Array.isArray(marker.campaign_roots) ? marker.campaign_roots : [];
  const out = [];
  for (const r of raw) if (typeof r === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(r) && r !== '.' && r !== '..' && r !== root && !out.includes(r)) out.push(r);
  return out.slice(-8);
}
// an extra root's envelope counts only while fresh: published_at parses and is within valid_for_s (default 180) of the capture instant
function freshEnvelope(env, nowMs) {
  if (!isObj(env)) return false;
  const at = ms(env.published_at);
  const validS = Number.isFinite(env.valid_for_s) ? env.valid_for_s : 180;
  return at !== null && nowMs !== null && nowMs - at <= validS * 1000;
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
  // ---- foremen: capture.sh copies <live>/agents/<sid>/*.json to agents/ (autopilot.agent-activity/1; ended_at set by SubagentStop)
  const agentsDir = path.join(dir, 'agents');
  let agentNames = [];
  try { agentNames = fs.readdirSync(agentsDir).filter((n) => n.endsWith('.json')).sort(); } catch (_e) { agentNames = []; }
  const foremen = { fresh: [], stalled: [] };
  for (const n of agentNames) {
    const a = readJson(path.join(agentsDir, n));
    if (!isObj(a) || a.schema !== 'autopilot.agent-activity/1' || typeof a.agent_id !== 'string' || !a.agent_id) continue;
    if (typeof a.ended_at === 'string' && ms(a.ended_at) !== null) continue; // done
    const at = ms(a.last_tool_at);
    if (at === null || nowMs - at > MARKER_TTL_MS) continue;
    const ageS = Math.max(0, Math.floor((nowMs - at) / 1000));
    (ageS < FOREMAN_STALL_S ? foremen.fresh : foremen.stalled).push({ id: a.agent_id, ageS, file: `agents/${n}` });
  }
  const foremanFresh = foremen.fresh.length > 0;
  const foremanStalled = foremen.stalled.length > 0;
  // ---- root set: the marker root + the campaign roots (oldest -> newest)
  const campaignRoots = campaignRootsOf(marker, root);
  const extras = [];
  for (const r of campaignRoots) {
    const e = J(`envelope--${r}.json`);
    if (freshEnvelope(e, nowMs)) extras.push({ root: r, envelope: e });
  }
  const envelopes = [envelope, ...extras.map((x) => x.envelope)].filter(isObj);
  const runs = envelopes.flatMap((e) => (Array.isArray(e.runs) ? e.runs.filter(isObj) : []));
  const stalled = runs.some((r) => r.stall === true);
  const withCounts = envelopes.filter((e) => isObj(e.counts) && Number.isFinite(e.counts.confirmed_live));
  const liveRun = withCounts.length > 0
    ? withCounts.reduce((n, e) => n + e.counts.confirmed_live, 0) > 0
    : runs.some((r) => r.alive === true && r.phase !== 'exited' && !r.ended_at && !r.final_status);

  // ---- progress: the newest campaign root with a FROZEN progress, else the marker root's, else the newest campaign root's
  const progressOf = (rec, mdl) => {
    if (rec) {
      const r = rec.r;
      const done = Array.isArray(r.completed_deliverables) ? r.completed_deliverables : null;
      const rem = Array.isArray(r.remaining_deliverables) ? r.remaining_deliverables : null;
      const frozen = Boolean(typeof r.frozen_denominator_digest === 'string' && r.frozen_denominator_digest && Number.isInteger(r.deliverable_count) && r.deliverable_count > 0 && done);
      return {
        frozen, done: done ? done.length : null, total: frozen ? r.deliverable_count : null,
        pct: frozen ? Math.round((done.length / r.deliverable_count) * 1000) / 10 : null,
        source: rec.file, openId: rem && rem.length ? String(rem[0]) : null, phaseCode: typeof r.phase === 'string' && r.phase ? r.phase : null,
      };
    }
    if (mdl && isObj(mdl.progress) && mdl.progress.frozen === true && Number.isFinite(mdl.progress.done) && Number.isFinite(mdl.progress.total) && mdl.progress.total > 0) {
      return { frozen: true, done: mdl.progress.done, total: mdl.progress.total, pct: Math.round((mdl.progress.done / mdl.progress.total) * 1000) / 10, source: mdl.__file || 'model.json', openId: null, phaseCode: null };
    }
    return null;
  };
  const rec = newestReceipt(dir, root);
  const own = progressOf(rec, model);
  const campaignViews = campaignRoots.map((r) => {
    const cm = J(`model--${r}.json`);
    const crec = newestReceipt(dir, r, path.join('campaign-work-orders', r));
    return { root: r, model: isObj(cm) ? { ...cm, __file: `model--${r}.json` } : null, rec: crec, progress: progressOf(crec, isObj(cm) ? { ...cm, __file: `model--${r}.json` } : null) };
  }).reverse(); // newest first
  const frozenCampaign = campaignViews.find((v) => v.progress && v.progress.frozen);
  const anyCampaign = campaignViews.find((v) => v.progress);
  const progress = frozenCampaign ? frozenCampaign.progress : (own || (anyCampaign ? anyCampaign.progress : null));
  // phase code: the newest campaign root whose receipt carries one, else the marker root's receipt
  const campaignPhase = campaignViews.find((v) => v.progress && v.progress.phaseCode);
  const phaseProgress = campaignPhase ? campaignPhase.progress : (own && own.phaseCode ? own : null);
  const campaignModelPhase = campaignViews.find((v) => v.model && isObj(v.model.phase) && v.model.phase.source === 'campaign' && typeof v.model.phase.label === 'string' && v.model.phase.label);

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
  else if (foremanStalled) { verdict = '疑似卡住'; verdictSource = `${foremen.stalled[0].file} un-ended, quiet ${Math.max(...foremen.stalled.map((x) => x.ageS))} s`; }
  else if ((frozenDone || tasksDone) && !liveRun && !foremanFresh) { verdict = '完成待驗收'; verdictSource = frozenDone ? `${progress.source} frozen ${progress.done}/${progress.total}` : 'tasks.json all completed'; }
  else if (liveRun || foremanFresh || (tasks && tasks.inProgress.length > 0) || turnActive) {
    verdict = '進行中';
    verdictSource = liveRun ? 'envelope.json live run' : foremanFresh ? `${foremen.fresh[0].file} un-ended, quiet < ${FOREMAN_STALL_S} s` : (tasks && tasks.inProgress.length > 0) ? 'tasks.json in_progress' : 'turn.json active';
  }
  else { verdict = '待命'; verdictSource = 'nothing live, awaited or complete'; }
  put('verdict', verdict, verdictSource, { exact: true });

  // ---- project
  const baseEnv = envelope || (envelopes[0] || null);
  const identity = (baseEnv && baseEnv.scope && baseEnv.scope.repo_identity) || (marker && marker.repo_identity) || null;
  const pkey = (baseEnv && baseEnv.scope && baseEnv.scope.project_key) || (marker && marker.project_key) || meta.project_key || '';
  put('project', projectNameOf(identity, pkey), baseEnv ? 'envelope.json scope.repo_identity' : 'marker.json repo_identity');

  // ---- phase
  let phaseAlts = null; let phaseSource = '';
  const taskNow = tasks && tasks.inProgress.length
    ? tasks.inProgress.slice().sort((a, b) => (b.started_seq || 0) - (a.started_seq || 0))[0] : null;
  if (phaseProgress) {
    const zh = Object.prototype.hasOwnProperty.call(PHASE_ZH, phaseProgress.phaseCode.toUpperCase()) ? PHASE_ZH[phaseProgress.phaseCode.toUpperCase()] : null;
    // a mapped code must be drawn as its label (the raw code is a FAIL); an unmapped one stays raw
    phaseAlts = [zh || phaseProgress.phaseCode]; phaseSource = `${phaseProgress.source} phase`;
  } else if (campaignModelPhase) {
    phaseAlts = [campaignModelPhase.model.phase.label]; phaseSource = `${campaignModelPhase.model.__file} phase (campaign)`;
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
  const sidecars = [sidecar, ...campaignRoots.map((r) => J(`decisions-sidecar--${r}.json`))].filter(isObj);
  if (sidecars.length > 0) {
    const sum = (k) => sidecars.reduce((n, sc) => n + (Number.isInteger(sc[k]) ? sc[k] : 0), 0);
    const m = sum('count');
    const k = sum('irreversible_count');
    const n = sum('undocumented_dispatches');
    if (m > 0) put('decisions', [`代你決定 ${m} 件（${k} 件不可逆）`], 'decisions-sidecar*.json count/irreversible_count', { line2: true });
    if (n > 0) put('undocumented', [`${n} 件派工無決策紀錄`], 'decisions-sidecar*.json undocumented_dispatches', { line2: true });
    if (m === 0 && n === 0) put('no-decisions-line', null, 'decisions-sidecar*.json counts zero', { absent: ['代你決定', '件派工無決策紀錄'] });
  } else {
    exp.notes.push('no decisions sidecar in the capture: decisions line not checked');
  }
  if (verdict === '要你決定') {
    if (attKind === 'permission' || attKind === 'question') put('reason', [String(attention.summary || '').slice(0, 30)], 'attention.json summary', { line2: true });
    else put('reason', [String(decisionFile.question).slice(0, 30)], 'decision-file.json question', { line2: true });
  }

  if (verdict === '疑似卡住' && !stalled && foremanStalled) put('reason', ['工頭 ', '分沒有動作'], foremen.stalled[0].file, { line2: true, all: true });
  if (verdict === '進行中' && !liveRun && foremanFresh) put('reason', ['工頭在跑：'], foremen.fresh[0].file, { line2: true });
  else if (verdict === '進行中' && !liveRun && !(tasks && tasks.inProgress.length > 0)) put('reason', ['回合進行中'], 'turn.json active (no live run, no task in progress)', { line2: true });

  // ---- elapsed
  // campaign root with a bound receipt: earliest receipt; otherwise the session's own start (tasks, then marker); last the earliest run
  let start = null; let startSource = '';
  let rs = null;
  for (const v of campaignViews) { rs = receiptStartMs(dir, v.root, path.join('campaign-work-orders', v.root)); if (rs !== null) break; }
  if (rs === null && root) rs = receiptStartMs(dir, root);
  if (rs !== null) { start = rs; startSource = 'work-orders earliest receipt'; }
  else if (tasks && tasks.first !== null) { start = tasks.first; startSource = 'tasks.json first_created_at'; }
  else if (marker && ms(marker.started_at) !== null) { start = ms(marker.started_at); startSource = 'marker.json started_at'; }
  else {
    const starts = runs.map((r) => ms(r.started_at)).filter((x) => x !== null);
    if (starts.length) { start = Math.min(...starts); startSource = 'envelope.json earliest run'; }
  }
  if (nowMs !== null && start !== null) put('elapsed', elapsedText(start, nowMs), startSource, { tolerantMin: 2, startMs: start, nowMs });
  else exp.notes.push('elapsed not derivable (no start source or no capture time)');

  return { meta, tokens: exp.tokens, notes: exp.notes, verdict, attentionKind: attKind };
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

// A permission / question dialog drawn by Claude Code itself (full width: it can hide the band AND the panel). Marker texts of the
// dialog chrome, nothing the mod draws.
function findDialog(paneText) {
  return /This command requires approval|Do you want to (proceed|make this edit|create|run)|❯ 1\. Yes|Esc to cancel · Tab to amend/.test(String(paneText || ''));
}

function compare(derived, band) {
  const results = [];
  for (const t of derived.tokens) {
    const r = { name: t.name, source: t.source, expected: t.expected, status: 'FAIL', detail: '' };
    if (!band) { r.detail = 'no band or panel verdict found in the pane'; results.push(r); continue; }
    if (band.surface === 'dialog' && t.name !== 'verdict') { r.status = 'SKIP'; r.detail = 'a dialog hides the band and the panel'; results.push(r); continue; }
    if (band.surface === 'panel' && t.name !== 'verdict' && t.name !== 'reason') { r.status = 'SKIP'; r.detail = 'not shown on the panel'; results.push(r); continue; }
    // the phase is judged in its own slot (line 1 = "<mark> <verdict> <project> · <phase> · <elapsed> · ..."), never anywhere on the line:
    // the verdict word 完成待驗收 would otherwise satisfy a phase label 完成
    let text = t.line2 ? band.line2 : band.line1;
    if (t.name === 'phase' && !t.line2) { const segs = band.line1.split(' · '); text = segs.length >= 2 ? segs[1].trim() : ''; }
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
  let band = bandOnly ? { ...bandOnly, surface: 'band' } : findPanel(pane);
  // neither band nor panel, but a permission / question dialog is on screen: the verdict is judged from attention.json alone
  if (!band && findDialog(pane)) {
    const kind = derived.attentionKind;
    band = { verdict: kind === 'permission' || kind === 'question' ? '要你決定' : '(a dialog is shown but attention.json is not permission / question)', line1: '(dialog)', line2: '', surface: 'dialog' };
  }
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
  process.stdout.write(`${out.surface === 'panel' ? 'panel' : out.surface === 'dialog' ? 'dialog' : 'band'}: ${out.band ? `${out.band.line1}\n      ${out.band.line2}` : 'NOT FOUND'}\n`);
  for (const r of out.results) {
    const exp = Array.isArray(r.expected) ? r.expected.join(' + ') : String(r.expected);
    process.stdout.write(`${r.status}  ${r.name.padEnd(12)} expected ${exp}  [${r.source}]${r.detail ? `  (${r.detail})` : ''}\n`);
  }
  for (const n of out.derived.notes) process.stdout.write(`note: ${n}\n`);
  process.stdout.write(out.ok ? 'RESULT: PASS\n' : 'RESULT: FAIL\n');
  return out.ok ? 0 : 1;
}

module.exports = { derive, compare, findBand, findPanel, findDialog, run, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
