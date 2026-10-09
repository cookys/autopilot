#!/usr/bin/env node
'use strict';

// gate/check.js <capture-dir> [--json] [--body-columns N] — real-machine gate: INDEPENDENT re-derivation of the one-line band.
//
// Dev-time tool, not shipped. It deliberately shares no code with mods/live/model.ts, scripts/render-review-page.js or
// src/status/*: every rule below is written from the P7 contract (docs/plans/evidence/2026-10-06-stage-graph/p7/contract.md
// section 2: the slot table and the width table) and the earlier W4 verdict rules, from the capture's own copies of the source
// files (see capture.sh for the layout). A disagreement between this checker and the band is a FINDING. Never tune a rule here
// to make a band pass; when the mod and the contract disagree, the contract wins and the slot FAILs.
//
// The band is ONE line: slots joined by ` │ `, last segment `ⓘ`. A non-ok snapshot (no project / error / stale) is one dim line
// `<reason> │ ⓘ`. Slots, in priority order (contract section 2):
//   verdict   `<glyph> <word>`, from attention / decision file / stall / foreman / completion / live work (the W4 precedence below)
//   position  `<size>[!]·<level> ▸ <stage>` + ` ◷<age>` (marker.json size/urgent/level/stage; age of stage_set_at, +-2 min);
//             `·<level>` omitted when level is null; empty when the marker has no stage
//   unit      `<bar> <k>/<N>` + ` ·<n>族` (marker.unit, marker.review_families); bar = k-1 done + the current cell (`▰`) + the rest `▱`,
//             N > 10 scaled to 10 cells (current cell = ceil(k*10/N): the contract names no rounding, this is the assumption)
//   dispatch  `⚙<live>` + ` ⏸<stalled>` (envelope counts / stall rows over the fresh root set; zero is left out)
//   review    `R<n> ⟲` (review.json: code.generation, else plan.generation) + ` · QC ✓` / ` · QC owed` (qc.json state)
//   decisions `◆<proxy>` + ` ?<undocumented>` + ` <rung>` (decisions sidecars summed over the root set; latest ladder rung)
//   spend     `$<brain today>/<cap>` (envelope host_today_brain_usd / brain_cap_usd, rounded to integers; empty when not published)
//   hygiene   load-source chip (dev / dev ↓n / dev ⚠ / cache <v> ⚠ / src ? ⚠) + ` · wt <n>` (residue.json reapable worktrees, n > 0)
//   ⓘ         always last
// Width table (applied to bodyColumns, cumulative): < 160 no hygiene; < 140 also no spend, decisions; < 120 also no ◷ age, no review;
//   < 80 only verdict, dispatch, the unit BAR (no k/N, no 族) and ⓘ. A slot the table removes must be ABSENT (drawn = FAIL). If the line
//   still does not fit, only the position's stage text may be cut with `…`.
// Overflow fallback (contract section 2, as accepted from review of the mod): after the stage cut, still over -> remove the unit bar, then the
//   ⏸ stalled count, then the ⚙ live count, then shorten the verdict word with `…` (glyph alone below 2 cells); never the glyph, never ⓘ.
// bodyColumns: the engine's AbovePrompt prop `bodyColumns` = "the column's width less the engine's five at the right end" (plugin-authoring
//   types/claude-code.d.ts, UiSite props). The column is the terminal, or the transcript's beside a docked Pane. ASSUMPTION recorded in the
//   output: precedence --body-columns > meta.json body_columns > a docked pane found in pane.txt (the same cell offset of `│` on >= 6 rows; bodyColumns = that offset - 5) > window_width - 5.
// Root set (mods P1W SCOPE): the session's band follows the root of its marker AND every root in marker.json `campaign_roots`; live counts,
//   stall rows and proxy decisions are summed over the marker root's envelope and every FRESH extra envelope (published_at within
//   valid_for_s, default 180, of the capture instant). A missing or stale extra envelope contributes nothing.
// Verdict precedence (W4):
//   attention kind permission|question OR an open decision file -> 要你決定; else any envelope run with stall:true -> 疑似卡住;
//   else an un-ended agent quiet >= 180 s -> 疑似卡住; else (frozen done==total OR every session task done) AND no live run AND no fresh
//   agent -> 完成待驗收; else a live run OR a fresh agent OR a task in progress OR an active turn -> 進行中; else 待命.
// Surface (dialogs): while a permission / AskUserQuestion dialog is open the band row is hidden and only the mod's top-right panel
//   shows the verdict word alone in its cell, the reason in the cell below (verdict + reason judged, the slots print SKIP). A dialog
//   raised by a subagent hides BOTH: only the verdict is judged, from attention.json alone; `surface: dialog`.
// Output: one line per judged slot `PASS|FAIL|ABSENT <slot> expected <..> got <..> [source]`, then the final line
//   `PASS <mode> fields=<n>` or `FAIL <mode> fields=<n> failed=<slot,...>` (n = slots judged, SKIP not counted).
// Exit: 0 PASS, 1 any FAIL, 2 usage / unreadable capture.

const fs = require('fs');
const path = require('path');

const VERDICTS = [
  { mark: '▲', word: '要你決定' }, { mark: '⏸', word: '疑似卡住' }, { mark: '✓', word: '完成待驗收' },
  { mark: '●', word: '進行中' }, { mark: '◌', word: '待命' },
];
const SLOT_ORDER = ['verdict', 'position', 'unit', 'dispatch', 'review', 'decisions', 'spend', 'hygiene'];
const SEP = ' │ ';
const ICON = 'ⓘ';
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const FOREMAN_STALL_S = 180; // the dispatch stall bound (dispatch-status.js DEFAULT_STALL_SECS); written here from the plan text, not imported
const MARKER_TTL_MS = 24 * 3600 * 1000;
const RIGHT_MARGIN = 5; // the engine's five cells at the right end of the column (types/claude-code.d.ts bodyColumns)
const AGE_TOLERANCE_MIN = 2;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return null; } }
function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch (_e) { return null; } }
const ms = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const posInt = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const count = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

// Terminal cells: East Asian Wide / Fullwidth = 2, combining / zero-width = 0, everything else (the band glyphs included) = 1.
function cellWidth(c) {
  if (c === 0 || (c >= 0x0300 && c <= 0x036f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x20d0 && c <= 0x20ff)) return 0;
  const wide = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3],
    [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd]];
  return wide.some(([a, b]) => c >= a && c <= b) ? 2 : 1;
}
function displayWidth(text) { let w = 0; for (const ch of String(text)) w += cellWidth(ch.codePointAt(0)); return w; }

function elapsedText(startMs, nowMs) {
  if (startMs === null || nowMs === null || nowMs < startMs) return '—';
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

// newest controller_progress_receipt among <sub>/*.json (issued_at, then generation); only the frozen progress (the verdict's completion rule) uses it
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

// marker.campaign_roots: plain strings only (they name files), not the marker's own root, no repeats, at most 8, oldest -> newest
function campaignRootsOf(marker, root) {
  const raw = marker && Array.isArray(marker.campaign_roots) ? marker.campaign_roots : [];
  const out = [];
  for (const r of raw) if (typeof r === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(r) && r !== '.' && r !== '..' && r !== root && !out.includes(r)) out.push(r);
  return out.slice(-8);
}
// an envelope counts only while fresh: published_at parses and is within valid_for_s (default 180) of the capture instant
function freshEnvelope(env, nowMs) {
  if (!isObj(env)) return false;
  const at = ms(env.published_at);
  const validS = Number.isFinite(env.valid_for_s) ? env.valid_for_s : 180;
  return at !== null && nowMs !== null && nowMs - at <= validS * 1000;
}

// ---- slot builders: each returns { text, parts } or null (empty)
function unitBar(index, total) {
  const cells = Math.min(total, 10);
  const k = Math.min(Math.max(index, 1), total);
  const cur = total > 10 ? Math.max(1, Math.min(10, Math.ceil((k * 10) / total))) : k;
  return '▰'.repeat(cur - 1) + '▰' + '▱'.repeat(cells - cur);
}

function hygieneChip(ls) {
  const source = str(ls.source) || 'unknown';
  const flags = Array.isArray(ls.flags) ? ls.flags.filter((f) => typeof f === 'string') : [];
  if (source.startsWith('cache:')) return `cache ${source.slice('cache:'.length)} ⚠`;
  if (source === 'dev') {
    const behind = count(ls.behind_upstream) && ls.behind_upstream > 0 ? ` ↓${ls.behind_upstream}` : '';
    const bad = flags.includes('marketplace_not_directory') || flags.includes('marketplace_not_this_repo');
    return `dev${behind}${bad ? ' ⚠' : ''}`;
  }
  return 'src ? ⚠';
}

// A docked pane splits the screen: the same cell offset of `│` repeats on many rows (the pane's left border). The transcript column is
// the cells left of that border. The band row itself (verdict mark / ⓘ) is not evidence. Needs >= 6 rows; the leftmost such offset wins.
function dockOf(paneText) {
  if (!paneText) return null;
  const lines = String(paneText).replace(/\n+$/, '').split('\n');
  const byOffset = new Map();
  let inBox = false; // rows between a `╭` line and its `╰` line are a boxed panel (stacked below 100 columns), never a dock
  for (const line of lines) {
    if (line.includes('╭')) inBox = true;
    const boxRow = inBox;
    if (line.includes('╰')) inBox = false;
    if (boxRow) continue;
    if (VERDICTS.some((v) => line.includes(`${v.mark} ${v.word}`)) || line.includes(`${SEP}${ICON}`)) continue;
    let off = 0; const seen = new Set();
    for (const ch of line) { if (ch === '│' && off >= 20 && !seen.has(off)) { seen.add(off); byOffset.set(off, (byOffset.get(off) || 0) + 1); } off += cellWidth(ch.codePointAt(0)); }
  }
  // a docked pane runs the full height of the screen: the border must span most (>= 60 %) of the pane.txt rows
  const need = Math.max(6, Math.ceil(lines.length * 0.6));
  const hits = [...byOffset.entries()].filter(([, n]) => n >= need).sort((a, b) => a[0] - b[0]);
  return hits.length ? { column: hits[0][0], rows: hits[0][1] } : null;
}
function truncateTo(text, width) {
  if (width < 1) return '';
  if (displayWidth(text) <= width) return text;
  let out = ''; let w = 0;
  for (const ch of text) { const cw = cellWidth(ch.codePointAt(0)); if (w + cw > width - 1) break; out += ch; w += cw; }
  return `${out}…`;
}

function derive(dir, opts = {}) {
  const J = (n) => readJson(path.join(dir, n));
  const meta = J('meta.json') || {};
  const marker = J('marker.json');
  const attention = J('attention.json');
  const turnFile = J('turn.json');
  const turnEff = J('turn-effective.json');
  const tasksFile = J('tasks.json');
  const envelope = J('envelope.json');
  const decisionFile = J('decision-file.json');
  const nowMs = Number.isFinite(meta.captured_at_ms) ? meta.captured_at_ms : ms(meta.captured_at);
  const root = (marker && typeof marker.root_run_id === 'string' && marker.root_run_id) || meta.root_run_id || null;
  const notes = [];
  const reasons = []; // the legacy panel-surface reason tokens

  // ---- tasks (deleted ones never count)
  let tasks = null;
  if (isObj(tasksFile) && Array.isArray(tasksFile.tasks)) {
    const live = tasksFile.tasks.filter((t) => isObj(t) && t.status !== 'deleted');
    tasks = { total: live.length, completed: live.filter((t) => t.status === 'completed').length, inProgress: live.filter((t) => t.status === 'in_progress') };
  }
  // ---- foremen: agents/*.json (autopilot.agent-activity/1; ended_at set by SubagentStop)
  let agentNames = [];
  try { agentNames = fs.readdirSync(path.join(dir, 'agents')).filter((n) => n.endsWith('.json')).sort(); } catch (_e) { agentNames = []; }
  const foremen = { fresh: [], stalled: [] };
  for (const n of agentNames) {
    const a = readJson(path.join(dir, 'agents', n));
    if (!isObj(a) || a.schema !== 'autopilot.agent-activity/1' || typeof a.agent_id !== 'string' || !a.agent_id) continue;
    if (typeof a.ended_at === 'string' && ms(a.ended_at) !== null) continue; // done
    const at = ms(a.last_tool_at);
    if (at === null || nowMs === null || nowMs - at > MARKER_TTL_MS) continue;
    const ageS = Math.max(0, Math.floor((nowMs - at) / 1000));
    (ageS < FOREMAN_STALL_S ? foremen.fresh : foremen.stalled).push({ id: a.agent_id, ageS, file: `agents/${n}` });
  }
  const foremanFresh = foremen.fresh.length > 0;
  const foremanStalled = foremen.stalled.length > 0;
  // ---- root set: the marker root + the FRESH campaign roots (oldest -> newest)
  const campaignRoots = campaignRootsOf(marker, root);
  const extras = [];
  for (const r of campaignRoots) {
    const e = J(`envelope--${r}.json`);
    if (freshEnvelope(e, nowMs)) extras.push({ root: r, envelope: e, sidecar: J(`decisions-sidecar--${r}.json`) });
  }
  // a snapshot is ok only when the marker root's own envelope is fresh (published_at within valid_for_s); otherwise the band is the non-ok line
  const okSnapshot = freshEnvelope(envelope, nowMs);
  // no marker file and no envelope in the capture (e.g. the run ended with `session-mode clear`): the session has no scope of its own
  const noScope = !isObj(marker) && !isObj(envelope);
  const envelopes = [envelope, ...extras.map((x) => x.envelope)].filter(isObj);
  const runs = envelopes.flatMap((e) => (Array.isArray(e.runs) ? e.runs.filter(isObj) : []));
  const stalledRows = runs.filter((r) => r.stall === true).length;
  const withCounts = envelopes.filter((e) => isObj(e.counts) && Number.isFinite(e.counts.confirmed_live));
  const liveN = withCounts.length > 0
    ? withCounts.reduce((n, e) => n + e.counts.confirmed_live, 0)
    : runs.filter((r) => r.alive === true && r.phase !== 'exited' && !r.ended_at && !r.final_status).length;
  const liveRun = liveN > 0;

  // ---- frozen progress (only the completion rule of the verdict uses it): the newest campaign root with a frozen receipt, else the marker root's
  const frozenOf = (rec) => {
    if (!rec) return null;
    const r = rec.r;
    const done = Array.isArray(r.completed_deliverables) ? r.completed_deliverables : null;
    const ok = Boolean(typeof r.frozen_denominator_digest === 'string' && r.frozen_denominator_digest && Number.isInteger(r.deliverable_count) && r.deliverable_count > 0 && done);
    return ok ? { done: done.length, total: r.deliverable_count, source: rec.file } : null;
  };
  const frozenViews = campaignRoots.map((r) => frozenOf(newestReceipt(dir, r, path.join('campaign-work-orders', r)))).reverse();
  const modelFrozen = (() => {
    const m = J('model.json');
    return isObj(m) && isObj(m.progress) && m.progress.frozen === true && Number.isFinite(m.progress.done) && Number.isFinite(m.progress.total) && m.progress.total > 0
      ? { done: m.progress.done, total: m.progress.total, source: 'model.json' } : null;
  })();
  const frozen = frozenViews.find(Boolean) || frozenOf(newestReceipt(dir, root)) || modelFrozen;

  // ---- verdict
  const attKind = isObj(attention) ? attention.kind : null;
  const decisionOpen = isObj(decisionFile) && typeof decisionFile.question === 'string' && decisionFile.question !== '';
  const frozenDone = frozen && frozen.done === frozen.total;
  const turnActive = isObj(turnFile) && turnFile.schema === 'autopilot.session-turn/1' && turnFile.state === 'active'
    && ms(turnFile.since) !== null && nowMs !== null && nowMs - ms(turnFile.since) <= MARKER_TTL_MS
    // an Escape interrupt fires no Stop; the watcher publishes `ended` for that ONE turn (same `since`)
    && !(isObj(turnEff) && turnEff.schema === 'autopilot.session-turn-effective/1' && turnEff.state === 'ended' && turnEff.turn_since === turnFile.since);
  const tasksDone = tasks && tasks.total > 0 && tasks.completed === tasks.total;
  let verdict; let verdictSource;
  if (attKind === 'permission' || attKind === 'question') { verdict = '要你決定'; verdictSource = `attention.json kind=${attKind}`; }
  else if (decisionOpen) { verdict = '要你決定'; verdictSource = 'decision-file.json (open)'; }
  else if (stalledRows > 0) { verdict = '疑似卡住'; verdictSource = 'envelope.json run stall:true'; }
  else if (foremanStalled) { verdict = '疑似卡住'; verdictSource = `${foremen.stalled[0].file} un-ended, quiet ${Math.max(...foremen.stalled.map((x) => x.ageS))} s`; }
  else if ((frozenDone || tasksDone) && !liveRun && !foremanFresh) { verdict = '完成待驗收'; verdictSource = frozenDone ? `${frozen.source} frozen ${frozen.done}/${frozen.total}` : 'tasks.json all completed'; }
  else if (liveRun || foremanFresh || (tasks && tasks.inProgress.length > 0) || turnActive) {
    verdict = '進行中';
    verdictSource = liveRun ? 'envelope.json live run' : foremanFresh ? `${foremen.fresh[0].file} un-ended, quiet < ${FOREMAN_STALL_S} s` : (tasks && tasks.inProgress.length > 0) ? 'tasks.json in_progress' : 'turn.json active';
  } else { verdict = '待命'; verdictSource = 'nothing live, awaited or complete'; }
  const mark = VERDICTS.find((v) => v.word === verdict).mark;

  // legacy panel reason (the reason moved to the panel's Now tab; it is still judged on the dialog-time top-right panel)
  if (verdict === '要你決定') {
    // the panel draws `<label><summary>` (+ `（等了 N 分）`), cut by DISPLAY width with a trailing `…` (mods/live/model.ts reason line)
    if (attKind === 'permission' || attKind === 'question') {
      const label = attKind === 'permission' ? '等你批准：' : '等你回答：';
      reasons.push({ expected: label + String(attention.summary || ''), label, full: label + String(attention.summary || ''), source: 'attention.json summary' });
    }
    else reasons.push({ expected: String(decisionFile.question).slice(0, 30), source: 'decision-file.json question' });
  } else if (verdict === '疑似卡住' && stalledRows === 0 && foremanStalled) reasons.push({ expected: '工頭 ', source: foremen.stalled[0].file });
  else if (verdict === '進行中' && !liveRun && foremanFresh) reasons.push({ expected: '工頭在跑：', source: foremen.fresh[0].file });
  else if (verdict === '進行中' && !liveRun && !(tasks && tasks.inProgress.length > 0)) reasons.push({ expected: '回合進行中', source: 'turn.json active' });

  // ---- slots (full, before the width table)
  const pkey = (isObj(envelope) && isObj(envelope.scope) && envelope.scope.project_key) || (marker && marker.project_key) || meta.project_key || null;
  const slots = {};
  const put = (name, text, source, parts) => { slots[name] = { name, text, source, parts: parts || {}, state: text === null ? 'empty' : 'present' }; };

  put('verdict', `${mark} ${verdict}`, verdictSource);

  // position + unit from the marker (§2.9 fields; a field of the wrong type reads as absent)
  const mSize = marker && SIZES.includes(marker.size) ? marker.size : null;
  const mLevel = marker ? str(marker.level) : null;
  const mStage = marker ? str(marker.stage) : null;
  if (mStage !== null) {
    const head = [mSize === null ? null : mSize + (marker.urgent === true ? '!' : ''), mLevel].filter((x) => x !== null).join('·');
    const setAt = ms(marker.stage_set_at);
    const age = setAt === null ? '—' : elapsedText(setAt, nowMs);
    put('position', `${head === '' ? '' : `${head} `}▸ ${mStage}${age === '—' ? '' : ` ◷${age}`}`, 'marker.json size/urgent/level/stage/stage_set_at',
      { head: head === '' ? '' : `${head} `, stage: mStage, age: age === '—' ? null : age });
  } else put('position', null, 'marker.json has no stage');

  const u = marker && isObj(marker.unit) ? marker.unit : null;
  if (u && str(u.kind) && posInt(u.index) && posInt(u.total)) {
    const fams = Array.isArray(marker.review_families) ? marker.review_families.filter((f) => typeof f === 'string' && f !== '').length : 0;
    const bar = unitBar(u.index, u.total);
    put('unit', `${bar} ${u.index}/${u.total}${fams > 0 ? ` ·${fams}族` : ''}`, 'marker.json unit/review_families', { bar, kn: ` ${u.index}/${u.total}`, fam: fams > 0 ? ` ·${fams}族` : '' });
  } else put('unit', null, 'marker.json has no unit');

  put('dispatch', liveN > 0 || stalledRows + (foremanStalled ? 1 : 0) > 0
    ? [liveN > 0 ? `⚙${liveN}` : null, stalledRows + (foremanStalled ? 1 : 0) > 0 ? `⏸${stalledRows + (foremanStalled ? 1 : 0)}` : null].filter(Boolean).join(' ') : null,
  'envelope*.json counts.confirmed_live / stall rows (+ a stalled foreman)');

  // review: review.json (scope = this project) + qc.json (scope = this project)
  const review = J('review.json');
  const qc = J('qc.json');
  const reviewOk = isObj(review) && review.schema === 'autopilot.review/1' && review.project_key === pkey;
  let rn = null;
  if (reviewOk) {
    if (isObj(review.code) && Number.isInteger(review.code.generation)) rn = review.code.generation;
    else if (isObj(review.plan) && Number.isInteger(review.plan.generation)) rn = review.plan.generation;
  }
  const qcOk = isObj(qc) && qc.schema === 'autopilot.qc-status/1' && isObj(qc.scope) && qc.scope.project_key === pkey;
  const chip = qcOk ? (qc.state === 'ok' ? 'QC ✓' : qc.state === 'owed' ? 'QC owed' : null) : null;
  put('review', rn === null && chip === null ? null : [rn === null ? null : `R${rn} ⟲`, chip].filter(Boolean).join(' · '), 'review.json generation + qc.json state');

  // decisions: sidecars of the root set (summed), the latest ladder rung by `at`
  const sidecars = [J('decisions-sidecar.json'), ...extras.map((x) => x.sidecar)].filter(isObj);
  const sum = (k) => sidecars.reduce((n, sc) => n + (count(sc[k]) ? sc[k] : 0), 0);
  const ladders = sidecars.map((sc) => sc.ladder).filter((l) => isObj(l) && /^U[0-5]$/.test(l.rung) && ms(l.at) !== null).sort((a, b) => ms(b.at) - ms(a.at));
  const dparts = [sum('count') > 0 ? `◆${sum('count')}` : null, sum('undocumented_dispatches') > 0 ? `?${sum('undocumented_dispatches')}` : null, ladders[0] ? ladders[0].rung : null].filter(Boolean);
  put('decisions', dparts.length ? dparts.join(' ') : null, 'decisions-sidecar*.json count / undocumented_dispatches / ladder');

  // spend: D1 on the envelope
  const brain = isObj(envelope) ? envelope.host_today_brain_usd : null;
  const cap = isObj(envelope) ? envelope.brain_cap_usd : null;
  put('spend', Number.isFinite(brain) && Number.isFinite(cap) && cap > 0 ? `$${Math.round(brain)}/${Math.round(cap)}` : null, 'envelope.json host_today_brain_usd / brain_cap_usd');

  // hygiene: load-source chip + reapable worktrees (clean-integrated + missing-dir, from by_class when present)
  const ls = J('load-source.json');
  const lsOk = isObj(ls) && ls.schema === 'autopilot.load-source/1';
  const res = J('residue.json');
  let wt = 0;
  if (isObj(res) && res.schema === 'autopilot.residue/1' && res.project_key === pkey && count(res.reapable_worktrees)) {
    wt = res.reapable_worktrees;
    if (isObj(res.by_class)) {
      const by = (res.by_class['clean-integrated'] || 0) + (res.by_class['missing-dir'] || 0);
      if (by !== res.reapable_worktrees) notes.push(`residue.json is inconsistent: reapable_worktrees=${res.reapable_worktrees} but by_class clean-integrated + missing-dir = ${by}`);
    }
  }
  const hchip = lsOk ? hygieneChip(ls) : null;
  put('hygiene', hchip === null && wt === 0 ? null : [hchip, wt > 0 ? `wt ${wt}` : null].filter(Boolean).join(' · '), 'load-source.json + residue.json');

  // ---- width
  let columns; let columnsHow;
  if (Number.isFinite(opts.bodyColumns)) { columns = opts.bodyColumns; columnsHow = '--body-columns'; }
  else if (Number.isFinite(meta.body_columns)) { columns = meta.body_columns; columnsHow = 'meta.body_columns'; }
  else if (dockOf(readText(path.join(dir, 'pane.txt')))) {
    const dk = dockOf(readText(path.join(dir, 'pane.txt')));
    columns = dk.column - RIGHT_MARGIN; columnsHow = `docked pane: transcript column ${dk.column} cells (border │ at cell ${dk.column} on ${dk.rows} rows of pane.txt) - ${RIGHT_MARGIN}`;
  } else if (Number.isFinite(meta.window_width)) { columns = meta.window_width - RIGHT_MARGIN; columnsHow = `meta.window_width ${meta.window_width} - ${RIGHT_MARGIN} (engine right margin; no docked pane assumed)`; }
  else {
    const pane = readText(path.join(dir, 'pane.txt')) || '';
    const w = Math.max(0, ...pane.split('\n').map(displayWidth));
    columns = w - RIGHT_MARGIN; columnsHow = `widest pane line ${w} - ${RIGHT_MARGIN} (no width recorded in meta.json)`;
  }
  const dropped = new Set();
  if (columns < 160) dropped.add('hygiene');
  if (columns < 140) { dropped.add('spend'); dropped.add('decisions'); }
  if (columns < 120) { dropped.add('review'); dropped.add('age'); }
  if (columns < 80) { dropped.add('position'); dropped.add('kn'); dropped.add('fam'); }
  const tableRule = (name) => (name === 'hygiene' ? '< 160' : name === 'spend' || name === 'decisions' ? '< 140' : name === 'review' ? '< 120' : '< 80');
  for (const name of SLOT_ORDER) {
    const s = slots[name];
    if (s.state === 'present' && dropped.has(name)) { s.state = 'width'; s.why = `removed by the width table (bodyColumns ${columns} ${tableRule(name)})`; }
    else if (s.state === 'empty') s.why = `empty: ${s.source}`;
  }
  // slot parts the table removes while the slot stays: age (< 120), k/N and 族 (< 80)
  const pos = slots.position;
  if (pos.state === 'present' && dropped.has('age') && pos.parts.age !== null) { pos.text = pos.text.replace(` ◷${pos.parts.age}`, ''); pos.parts.ageRemoved = true; }
  const un = slots.unit;
  if (un.state === 'present' && dropped.has('kn')) { un.text = un.parts.bar; un.parts.knRemoved = true; }
  // does the line fit? (only the position's stage text may be cut)
  const present = SLOT_ORDER.filter((n) => slots[n].state === 'present');
  let stageW = pos.state === 'present' ? displayWidth(pos.parts.stage) : 0;
  let stageDrawn = pos.state === 'present' ? pos.parts.stage : ''; // the stage as the band draws it: whole, or cut with the 1-cell `…` counted
  const widthNow = () => present.filter((n) => slots[n].state === 'present')
    .reduce((n, name) => n + (name === 'position' ? displayWidth(pos.text) - displayWidth(pos.parts.stage) + displayWidth(stageDrawn) : displayWidth(slots[name].text)), 0)
    + displayWidth(SEP) * present.filter((n) => slots[n].state === 'present').length + displayWidth(ICON);
  const over = widthNow() - columns;
  // 1. the position's stage text is cut with `…` (never below 2 cells); 2. still over: the overflow fallback of contract section 2, in order:
  //    remove the unit bar, then the ⏸ stalled count, then the ⚙ live count; 3. still over: shorten the verdict word with `…` (the glyph stays)
  if (over > 0 && pos.state === 'present') {
    stageW = Math.max(2, stageW - over);
    stageDrawn = truncateTo(pos.parts.stage, stageW); // the EXACT cut: only as far as needed, never below 2 cells
    pos.parts.stageCut = stageDrawn;
  }
  const dsp = slots.dispatch;
  const fallbackWhy = `removed by the overflow fallback (line over bodyColumns ${columns})`;
  const steps = [
    () => { if (slots.unit.state === 'present') { slots.unit.state = 'fallback'; slots.unit.why = fallbackWhy; } },
    () => { if (dsp.state === 'present' && /⏸\d+/.test(dsp.text)) { const t = dsp.text.replace(/ ?⏸\d+/, ''); if (t === '') { dsp.state = 'fallback'; dsp.why = fallbackWhy; } else dsp.text = t; } },
    () => { if (dsp.state === 'present') { dsp.state = 'fallback'; dsp.why = fallbackWhy; } },
  ];
  for (const step of steps) { if (widthNow() <= columns) break; step(); }
  const vs = slots.verdict;
  if (widthNow() > columns) {
    const target = displayWidth(vs.text) - (widthNow() - columns);
    vs.text = target >= 2 ? truncateTo(vs.text, target) : Array.from(vs.text)[0];
  }

  return {
    meta, mode: meta.mode || String(meta.cell || '').split('-')[0] || '?', verdict, mark, attentionKind: attKind, okSnapshot, noScope, dock: dockOf(readText(path.join(dir, 'pane.txt'))), columns, columnsHow, slots, over, notes, reasons, nowMs,
  };
}

// ---- reading the pane
// what is drawn on the band row after the ⓘ: { tail, tailAt (cell offset of the first char of the tail) }
function tailOf(line, end) {
  if (end < 0) return { tail: '', tailAt: 0 };
  return { tail: line.slice(end), tailAt: displayWidth(line.slice(0, end)) };
}
// Nothing but whitespace and the engine's `[-]` toggle may follow the ⓘ; with a docked pane the pane's border `│` (at the dock cell)
// and the pane's own text after it are not the band. Returns a problem text or null.
function tailProblem(band, d) {
  const tail = band.tail || '';
  const m = /^\s*(\[-\])?\s*/.exec(tail);
  const rest = tail.slice(m[0].length);
  if (rest === '') return null;
  if (d.dock && rest.startsWith('│') && band.tailAt + displayWidth(tail.slice(0, m[0].length)) === d.dock.column) return null;
  return `content drawn after ⓘ on the band row: "${rest.trim()}"`;
}
// the band: the last line carrying a verdict mark + word; it runs up to ` │ ⓘ` (a docked pane to its right is not part of the band)
function findBand(paneText) {
  const lines = String(paneText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    for (const v of VERDICTS) {
      for (let at = lines[i].indexOf(v.mark); at >= 0; at = lines[i].indexOf(v.mark, at + 1)) {
        const iconAt = lines[i].indexOf(`${SEP}${ICON}`, at);
        const text = iconAt >= 0 ? lines[i].slice(at, iconAt + SEP.length + ICON.length) : lines[i].slice(at).replace(/\s+$/, '');
        const first = text.split(SEP)[0];
        const full = first === `${v.mark} ${v.word}`;
        // the overflow fallback shortens the verdict word to a prefix + `…`, or to the glyph alone; only with the ⓘ drawn (else it is just a mention)
        const cut = iconAt >= 0 && (first === v.mark || first === `${v.mark}…` || (first.startsWith(`${v.mark} `) && /^.*…$/.test(first) && v.word.startsWith(first.slice(2, -1)) && first.length > 3));
        if (!full && !cut) continue;
        if (iconAt < 0 && !(text === first || text.startsWith(`${first}${SEP}`))) continue; // a transcript line that merely mentions a verdict
        return { verdict: v.word, text, line1: text, line2: '', icon: iconAt >= 0, kind: 'ok', surface: 'band', ...tailOf(lines[i], iconAt >= 0 ? iconAt + SEP.length + ICON.length : -1) };
      }
    }
  }
  return null;
}
// a non-ok line: `<reason> │ ⓘ`, no verdict mark
function findNonOk(paneText) {
  const lines = String(paneText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const at = lines[i].indexOf(`${SEP}${ICON}`);
    if (at < 0) continue;
    if (VERDICTS.some((v) => lines[i].includes(`${v.mark} ${v.word}`))) continue;
    const text = lines[i].slice(0, at + SEP.length + ICON.length).replace(/^\s+/, '');
    if (text.length > SEP.length + ICON.length) return { text, line1: text, line2: '', icon: true, kind: 'nonok', surface: 'band', ...tailOf(lines[i], at + SEP.length + ICON.length) };
  }
  return null;
}
// the panel (right-hand column, after the last │): a cell that is exactly one verdict word, the cell on the next line is the reason
function findPanel(paneText) {
  const cells = String(paneText || '').split('\n').map((l) => { const parts = l.split('│').map((p) => p.trim()).filter(Boolean); return l.includes('│') ? (parts[parts.length - 1] || '') : l.trim(); });
  for (let i = 0; i < cells.length; i += 1) {
    const v = VERDICTS.find((x) => cells[i] === x.word);
    if (v) return { verdict: v.word, line1: v.word, line2: cells[i + 1] || '', kind: 'panel', surface: 'panel' };
  }
  return null;
}
// A permission / question dialog drawn by Claude Code itself (full width: it can hide the band AND the panel).
function findDialog(paneText) {
  // permission dialogs, and the AskUserQuestion dialog (footer `Enter to select · ↑/↓ to navigate · Esc to cancel`)
  return /This command requires approval|Do you want to (proceed|make this edit|create|run)|❯ 1\. Yes|Esc to cancel · Tab to amend|Enter to select · ↑\/↓ to navigate/.test(String(paneText || ''));
}

// classify one drawn segment by its own text (independent of what is expected)
function classify(seg, index) {
  if (index === 0) return /^[▲⏸✓●◌](…| \S.*)?$/.test(seg) ? 'verdict' : null;
  if (seg.includes('▸')) return 'position';
  if (/^[▰▱]/.test(seg)) return 'unit';
  if (/^(⚙\d+( ⏸\d+)?|⏸\d+)$/.test(seg)) return 'dispatch';
  if (/^R\d+ ⟲|^QC /.test(seg)) return 'review';
  if (/^\$\d+\/\d+$/.test(seg)) return 'spend';
  if (/^(dev|cache |src \?|wt )/.test(seg)) return 'hygiene';
  if (seg.split(' ').every((tok) => /^(◆\d+|\?\d+|U\d)$/.test(tok))) return 'decisions';
  return null;
}

// ---- judging
function judgeBand(d, band) {
  const results = [];
  const res = (name, status, expected, got, source, detail) => results.push({ name, status, expected, got, source, detail: detail || '' });
  const iconDrawn = band.icon;
  // the non-ok snapshot
  if (!d.okSnapshot && d.noScope) {
    // No marker, so the mod resolves the project from the cwd path map instead: either no project / no envelope (the mod's plain
    // `no project · run: …` / `unavailable · run: …` line), or the project-level envelope the capture driver does not copy, which
    // draws the verdict alone. The capture holds no slot facts, so only a bare verdict band (derived from attention / turn) is accepted.
    const bare = `${d.mark} ${d.verdict} │ ⓘ`;
    const plainLine = band.kind === 'nonok' && /^(no project|unavailable) · run: .* │ ⓘ$/.test(band.text);
    const ok = plainLine || band.text === bare;
    res('no-scope', ok ? 'PASS' : 'FAIL', `\`${bare}\` or the mod's no-project / unavailable line (no marker, no envelope)`, band.text, 'marker.json and envelope.json both missing');
    res('ⓘ', iconDrawn ? 'PASS' : 'FAIL', 'ⓘ', iconDrawn ? 'ⓘ' : 'none', 'contract slot 9: always drawn');
    return results;
  }
  if (!d.okSnapshot) {
    const plain = band.kind === 'nonok' && band.text.split(SEP).length === 2;
    const tp = tailProblem(band, d);
    res('nonok', plain && !tp ? 'PASS' : 'FAIL', '`<reason> │ ⓘ` (one dim line, no slots)', band.text, 'envelope.json missing / not fresh (non-ok snapshot)', tp || '');
    res('ⓘ', iconDrawn ? 'PASS' : 'FAIL', 'ⓘ', iconDrawn ? 'ⓘ' : 'none', 'contract slot 9: always drawn');
    return results;
  }
  if (band.kind === 'nonok') {
    res('verdict', 'FAIL', `${d.mark} ${d.verdict}`, band.text, d.slots.verdict.source, 'the snapshot is ok (envelope fresh) but the band is the non-ok line');
    res('ⓘ', 'PASS', 'ⓘ', 'ⓘ', 'contract slot 9: always drawn');
    return results;
  }
  const segs = band.text.split(SEP);
  if (iconDrawn) segs.pop(); // the trailing `ⓘ`
  const drawn = {}; const extra = []; const order = [];
  segs.forEach((s, i) => {
    const c = classify(s, i);
    if (c === null) extra.push(`unclassified "${s}"`);
    else if (drawn[c] !== undefined) extra.push(`second ${c} "${s}"`);
    else { drawn[c] = s; order.push(c); }
  });
  for (const name of SLOT_ORDER) {
    const s = d.slots[name];
    const got = drawn[name];
    if (s.state !== 'present') {
      if (got === undefined) res(name, 'ABSENT', `absent (${s.why})`, 'absent', s.source);
      else res(name, 'FAIL', `absent (${s.why})`, got, s.source, 'drawn although it must be absent');
      continue;
    }
    if (got === undefined) { res(name, 'FAIL', s.text, 'absent', s.source); continue; }
    if (name === 'position') {
      const m = /^(.*?▸ )(.*?)(?: ◷(\S+))?$/.exec(got);
      const exp = s.parts;
      const stageOk = m && m[1] === exp.head + '▸ ' && (m[2] === (exp.stageCut !== undefined ? exp.stageCut : exp.stage));
      const expAge = s.parts.ageRemoved ? null : exp.age;
      let ageOk = false; let ageNote = '';
      if (m) {
        if (expAge === null) { ageOk = m[3] === undefined; ageNote = ageOk ? '' : `age ◷${m[3]} must be absent`; }
        else if (m[3] === undefined) ageNote = `age ◷${expAge} missing`;
        else {
          const a = parseElapsedMin(m[3]); const e = parseElapsedMin(expAge);
          ageOk = a !== null && e !== null && Math.abs(a - e) <= AGE_TOLERANCE_MIN;
          ageNote = ageOk ? '' : `age ◷${m[3]} vs ◷${expAge} (+-${AGE_TOLERANCE_MIN} min)`;
        }
      }
      res(name, stageOk && ageOk ? 'PASS' : 'FAIL', s.text, got, s.source, stageOk ? ageNote : `head/stage differ${ageNote ? `; ${ageNote}` : ''}`);
    } else res(name, got === s.text ? 'PASS' : 'FAIL', s.text, got, s.source);
  }
  res('ⓘ', iconDrawn ? 'PASS' : 'FAIL', 'ⓘ', iconDrawn ? 'ⓘ' : 'none', 'contract slot 9: always drawn');
  // layout: classification complete, no duplicates / empty segment, slots in priority order, fits bodyColumns, ⓘ last
  const problems = [...extra];
  const rank = order.map((n) => SLOT_ORDER.indexOf(n));
  if (rank.some((r, i) => i > 0 && r < rank[i - 1])) problems.push(`slots out of priority order: ${order.join(',')}`);
  if (segs.some((s) => s === '')) problems.push('an empty segment (doubled separator)');
  const tp = tailProblem(band, d);
  if (tp) problems.push(tp);
  const lineWidth = displayWidth(band.text);
  if (lineWidth > d.columns) problems.push(`line is ${lineWidth} cells wide, over bodyColumns ${d.columns}`);
  res('layout', problems.length === 0 ? 'PASS' : 'FAIL', `one line of at most ${d.columns} cells, slots in priority order, joined by " │ ", ⓘ last`, `${lineWidth} cells`, 'contract section 2', problems.join('; '));
  return results;
}

// The drawn reason is the full text (optionally followed by the wait suffix), or a display-width prefix of it (at least the label and
// one more character) followed by `…`. Other reasons (decision file / foreman / turn) keep the plain substring rule.
function reasonDrawn(r, drawn) {
  if (typeof r.full !== 'string') return drawn.includes(r.expected);
  const body = drawn.replace(/（等了 \d+ 分）$/, '');
  if (body === r.full) return true;
  if (!drawn.endsWith('…')) return false;
  const prefix = drawn.slice(0, -1);
  return r.full.startsWith(prefix) && Array.from(prefix).length > Array.from(r.label).length;
}

function judgePanelLike(d, band) {
  const results = [];
  const res = (name, status, expected, got, source, detail) => results.push({ name, status, expected, got, source, detail: detail || '' });
  res('verdict', band.verdict === d.verdict ? 'PASS' : 'FAIL', d.verdict, band.verdict, d.slots.verdict.source, `${band.surface} shows ${band.verdict}`);
  for (const r of d.reasons) {
    if (band.surface === 'panel') res('reason', reasonDrawn(r, band.line2) ? 'PASS' : 'FAIL', r.expected, band.line2, r.source);
    else res('reason', 'SKIP', r.expected, 'hidden', r.source, 'a dialog hides the band and the panel');
  }
  for (const name of SLOT_ORDER.slice(1)) res(name, 'SKIP', '-', '-', d.slots[name].source, band.surface === 'panel' ? 'not shown on the panel' : 'a dialog hides the band and the panel');
  return results;
}

function run(dir, opts = {}) {
  const d = derive(dir, opts);
  const pane = readText(path.join(dir, 'pane.txt')) || `${readText(path.join(dir, 'band.txt')) || ''}\n${readText(path.join(dir, 'panel.txt')) || ''}`;
  let band = findBand(pane) || findNonOk(pane) || findPanel(pane);
  // neither band nor panel, but a permission / question dialog is on screen: the verdict is judged from attention.json alone
  if (!band && findDialog(pane)) {
    const kind = d.attentionKind;
    band = { verdict: kind === 'permission' || kind === 'question' ? '要你決定' : '(a dialog is shown but attention.json is not permission / question)', line1: '(dialog)', line2: '', kind: 'dialog', surface: 'dialog' };
  }
  let results;
  if (!band) results = [{ name: 'verdict', status: 'FAIL', expected: d.okSnapshot ? `${d.mark} ${d.verdict}` : 'non-ok line', got: 'NOT FOUND', source: 'pane.txt', detail: 'no band, non-ok line or panel verdict found in the pane' }];
  else if (band.surface === 'band') results = judgeBand(d, band);
  else results = judgePanelLike(d, band);
  const judged = results.filter((r) => r.status !== 'SKIP');
  const failed = [...new Set(results.filter((r) => r.status === 'FAIL').map((r) => r.name))];
  return {
    derived: d, band, results, surface: band ? band.surface : null, fields: judged.length, failed,
    ok: failed.length === 0 && results.some((r) => r.status === 'PASS'),
  };
}

function summary(out) {
  return out.ok ? `PASS ${out.derived.mode} fields=${out.fields}` : `FAIL ${out.derived.mode} fields=${out.fields} failed=${out.failed.join(',')}`;
}

function main(argv) {
  const opts = {};
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--body-columns') { opts.bodyColumns = Number(argv[i + 1]); i += 1; }
    else if (!argv[i].startsWith('--')) args.push(argv[i]);
  }
  if (args.length !== 1 || !fs.existsSync(args[0]) || !fs.statSync(args[0]).isDirectory() || ('bodyColumns' in opts && !Number.isFinite(opts.bodyColumns))) {
    process.stderr.write('usage: check.js <capture-dir> [--json] [--body-columns N]\n');
    return 2;
  }
  const out = run(args[0], opts);
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ok: out.ok, mode: out.derived.mode, fields: out.fields, failed: out.failed, results: out.results, surface: out.surface, notes: out.derived.notes, body_columns: out.derived.columns, summary: summary(out) }, null, 2)}\n`);
    return out.ok ? 0 : 1;
  }
  const w = (s) => process.stdout.write(`${s}\n`);
  w(`capture ${args[0]}  cell=${out.derived.meta.cell || '?'}`);
  w(`surface: ${out.surface || 'none'}`);
  w(`width: bodyColumns=${out.derived.columns} [${out.derived.columnsHow}]`);
  w(`${out.surface === 'panel' ? 'panel' : out.surface === 'dialog' ? 'dialog' : 'band'}: ${out.band ? out.band.line1 : 'NOT FOUND'}`);
  for (const r of out.results) w(`${r.status} ${r.name} expected ${r.expected} got ${r.got} [${r.source}]${r.detail ? ` (${r.detail})` : ''}`);
  for (const n of out.derived.notes) w(`note: ${n}`);
  w(summary(out));
  return out.ok ? 0 : 1;
}

module.exports = { dockOf, derive, findBand, findNonOk, findPanel, findDialog, classify, displayWidth, run, summary, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
