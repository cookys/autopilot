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
// The band is ONE line (TUI v2 grammar, both locales): groups joined by ` │ ` (items inside a group by one space), last segment `ⓘ`. A non-ok
// snapshot (no project / error / stale) is one dim line `<reason> │ ⓘ`. Slots, in priority order (contract section 2):
//   verdict   `<glyph> <word>` (zh-TW: 要你決定 / 疑似卡住 / 完成待驗收 / 進行中 / 待命; en: Needs you / Stalled / Awaiting acceptance / Running / Idle), from
//             attention / decision file / stall / foreman / completion / live work (the W4 precedence below). At >= 160 columns a 要你決定 / 疑似卡住
//             verdict carries its one-phrase REASON after the word (the attention summary, the decision question, the quietest dispatch ...), clipped
//             to 48 cells and to the room left, and only when >= 8 cells of room are left
//   position  `<size>[!]·<level> ▸ <stage>`; >= 160: `<size>[!]·<level> <walk> <stage> ◷<age>` with the stage walk `●─●─◐─○─○` (stage.json walk, the marker
//             stage is the `◐`; no walk drawn when it has < 2 or > 9 nodes or the stage is not on it: then `▸ <stage> ◷<age>`); `·<level>` omitted when
//             level is null; empty when the marker has no stage
//   unit      `<bar> <k>/<N>` + ` ·<n>族` / ` ·<n>fam` (marker.unit, marker.review_families); bar = k-1 done + the current cell (`▰`) + the rest `▱`,
//             N > 10 scaled to 10 cells (current cell = ceil(k*10/N): the contract names no rounding, this is the assumption)
//   dispatch  `⚙<live>` + ` ⏸<stalled>` (envelope counts / stall rows over the fresh root set; zero is left out)
//   review    `⟲R<n>` (review.json: code.generation, else plan.generation) + ` QC✓` / ` QC▲` (qc.json state); in the SAME group as dispatch (one space)
//   decisions `◆<proxy>` + ` ?<undocumented>` + ` <rung>` (decisions sidecars summed over the root set; latest ladder rung)
//   spend     `$<brain today> <bar> <pct>%` (envelope host_today_brain_usd / brain_cap_usd; amount rounded to an integer, bar cells = round(ratio*n), pct =
//             round(ratio*100)); empty when not published
//   hygiene   load-source chip (dev / dev↓n / dev⚠ ... : `dev↓3`, `dev ⚠`, `cache <v> ⚠`, `src ? ⚠`) + ` ⚑<n>` (residue.json needs_human_count, n > 0)
//   ⓘ         always last
// Width table (applied to bodyColumns):
//   >= 160  everything: walk, age, families, decisions, 10-cell spend bar + percent, the load-source chip, the verdict reason
//   120-159 verdict, `<size>·<level> ▸ <stage>`, unit bar + k/N, `⚙ ⏸ ⟲R QC`, `$<n>` + 5-cell bar, `⚑N`
//   80-119  verdict, unit bar (no k/N), `⚙N ⏸N QC▲/QC✓` (no round), `$` + 3-cell bar (no amount), `⚑N`
//   < 80    verdict, `⚙N ⏸N`, `⚑N`
// A slot or part the table removes must be ABSENT (drawn = FAIL). If the line still does not fit, only the position's stage text may be cut with `…`.
// Overflow fallback (contract section 2, as accepted from review of the mod): after the stage cut, still over -> remove the unit bar, then the
//   ⏸ stalled count, then the ⚙ live count, then shorten the verdict word with `…` (glyph alone below 2 cells); never the glyph, never ⓘ, never `⚑N`.
// bodyColumns: the engine's AbovePrompt prop `bodyColumns` = "the column's width less the engine's five at the right end" (plugin-authoring
//   types/claude-code.d.ts, UiSite props). The column is the terminal, or the transcript's beside a docked Pane. ASSUMPTION recorded in the
//   output: precedence --body-columns > meta.json body_columns > a docked pane found in pane.txt (the same cell offset of `│` on >= 6 rows; bodyColumns = that offset - 5) > window_width - 5.
// Locale: --locale / meta.json `locale` ("en" | "zh-TW"), else the locale of the verdict word the band draws, else zh-TW.
// Root set (mods P1W SCOPE): the session's band follows the root of its marker AND every root in marker.json `campaign_roots`; live counts,
//   stall rows and proxy decisions are summed over the marker root's envelope and every FRESH extra envelope (published_at within
//   valid_for_s, default 180, of the capture instant). A missing or stale extra envelope contributes nothing.
// Verdict precedence (W4):
//   attention kind permission|question OR an open decision file -> decide; else any envelope run with stall:true -> stalled;
//   else an un-ended agent quiet >= 180 s -> stalled; else (frozen done==total OR every session task done) AND no live run AND no fresh
//   agent -> waiting; else a live run OR a fresh agent OR a task in progress OR an active turn -> running; else idle.
// Surface (dialogs): while a permission / AskUserQuestion dialog is open the band row is hidden and only the mod's top-right panel
//   shows the verdict word alone in its cell, the reason in the cell below (verdict + reason judged, the slots print SKIP). A dialog
//   raised by a subagent hides BOTH: only the verdict is judged, from attention.json alone; `surface: dialog`.
// Output: one line per judged slot `PASS|FAIL|ABSENT <slot> expected <..> got <..> [source]`, then the final line
//   `PASS <mode> fields=<n>` or `FAIL <mode> fields=<n> failed=<slot,...>` (n = slots judged, SKIP not counted).
// Exit: 0 PASS, 1 any FAIL, 2 usage / unreadable capture.

const fs = require('fs');
const path = require('path');

const KINDS = ['decide', 'stalled', 'waiting', 'running', 'idle'];
const MARKS = { decide: '▲', stalled: '⏸', waiting: '✓', running: '●', idle: '◌' };
const WORDS = {
  'zh-TW': { decide: '要你決定', stalled: '疑似卡住', waiting: '完成待驗收', running: '進行中', idle: '待命' },
  en: { decide: 'Needs you', stalled: 'Stalled', waiting: 'Awaiting acceptance', running: 'Running', idle: 'Idle' },
};
// the contract's locale strings the checker needs (written here from the contract, never imported from mods/live)
const TEXT = {
  'zh-TW': {
    permission: '等你批准：', question: '等你回答：', waitedRe: /（等了 \d+ 分）$/, stalledAge: (m) => `最久的派工 ${m}m 沒有輸出`, stalledCount: (n) => `有 ${n} 個派工疑似沒有輸出`,
    foremanStalled: (m) => `工頭 ${m} 分沒有動作`, foremanRunning: '工頭在跑：', turn: '回合進行中', fam: (n) => `·${n}族`,
  },
  en: {
    permission: 'waiting for your approval: ', question: 'waiting for your answer: ', waitedRe: / \(waited \d+ min\)$/, stalledAge: (m) => `quietest dispatch silent for ${m}m`,
    stalledCount: (n) => (n === 1 ? '1 dispatch looks silent' : `${n} dispatches look silent`), foremanStalled: (m) => `foreman silent for ${m} min`, foremanRunning: 'foreman running: ', turn: 'turn in progress', fam: (n) => `·${n}fam`,
  },
};
const LOCALES = Object.keys(WORDS);
// every verdict of every locale: { kind, locale, mark, word }
const VERDICTS = LOCALES.flatMap((locale) => KINDS.map((kind) => ({ kind, locale, mark: MARKS[kind], word: WORDS[locale][kind] })));
const SLOT_ORDER = ['verdict', 'position', 'unit', 'dispatch', 'review', 'decisions', 'spend', 'hygiene'];
const SEP = ' │ ';
const ICON = 'ⓘ';
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const FOREMAN_STALL_S = 180; // the dispatch stall bound (dispatch-status.js DEFAULT_STALL_SECS); written here from the plan text, not imported
const MARKER_TTL_MS = 24 * 3600 * 1000;
const REASON_MAX = 48; // cells
const REASON_MIN = 8; // cells of room needed before a reason is drawn
const WALK_MAX = 9;
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
    const behind = count(ls.behind_upstream) && ls.behind_upstream > 0 ? `↓${ls.behind_upstream}` : '';
    const bad = flags.includes('marketplace_not_directory') || flags.includes('marketplace_not_this_repo');
    return `dev${behind}${bad ? ' ⚠' : ''}`;
  }
  return 'src ? ⚠';
}

// a bar of n cells with f filled: `▰▰▰▱▱`
function fillBar(f, n) { return '▰'.repeat(f) + '▱'.repeat(n - f); }
// the stage walk `●─●─◐─○─○`; null when it cannot be drawn (< 2 or > 9 nodes, or the current stage is not on it)
function walkText(stageFile, current) {
  if (!isObj(stageFile) || stageFile.schema !== 'autopilot.stage-walk/1' || current === null || !Array.isArray(stageFile.walk)) return null;
  const names = stageFile.walk.map((n) => (typeof n === 'string' ? n : isObj(n) ? (str(n.id) || str(n.node_id) || str(n.name)) : null)).filter((n) => n !== null);
  const at = names.indexOf(current);
  if (at < 0 || names.length < 2 || names.length > WALK_MAX) return null;
  return names.map((_n, i) => (i < at ? '●' : i === at ? '◐' : '○')).join('─');
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
  const locale = LOCALES.includes(opts.locale) ? opts.locale : LOCALES.includes(meta.locale) ? meta.locale : 'zh-TW';
  const T = TEXT[locale];
  const attKind = isObj(attention) ? attention.kind : null;
  const decisionOpen = isObj(decisionFile) && typeof decisionFile.question === 'string' && decisionFile.question !== '';
  const frozenDone = frozen && frozen.done === frozen.total;
  const turnActive = isObj(turnFile) && turnFile.schema === 'autopilot.session-turn/1' && turnFile.state === 'active'
    && ms(turnFile.since) !== null && nowMs !== null && nowMs - ms(turnFile.since) <= MARKER_TTL_MS
    // an Escape interrupt fires no Stop; the watcher publishes `ended` for that ONE turn (same `since`)
    && !(isObj(turnEff) && turnEff.schema === 'autopilot.session-turn-effective/1' && turnEff.state === 'ended' && turnEff.turn_since === turnFile.since);
  const tasksDone = tasks && tasks.total > 0 && tasks.completed === tasks.total;
  let kind; let verdictSource;
  if (attKind === 'permission' || attKind === 'question') { kind = 'decide'; verdictSource = `attention.json kind=${attKind}`; }
  else if (decisionOpen) { kind = 'decide'; verdictSource = 'decision-file.json (open)'; }
  else if (stalledRows > 0) { kind = 'stalled'; verdictSource = 'envelope.json run stall:true'; }
  else if (foremanStalled) { kind = 'stalled'; verdictSource = `${foremen.stalled[0].file} un-ended, quiet ${Math.max(...foremen.stalled.map((x) => x.ageS))} s`; }
  else if ((frozenDone || tasksDone) && !liveRun && !foremanFresh) { kind = 'waiting'; verdictSource = frozenDone ? `${frozen.source} frozen ${frozen.done}/${frozen.total}` : 'tasks.json all completed'; }
  else if (liveRun || foremanFresh || (tasks && tasks.inProgress.length > 0) || turnActive) {
    kind = 'running';
    verdictSource = liveRun ? 'envelope.json live run' : foremanFresh ? `${foremen.fresh[0].file} un-ended, quiet < ${FOREMAN_STALL_S} s` : (tasks && tasks.inProgress.length > 0) ? 'tasks.json in_progress' : 'turn.json active';
  } else { kind = 'idle'; verdictSource = 'nothing live, awaited or complete'; }
  const verdict = WORDS[locale][kind];
  const mark = MARKS[kind];

  // legacy panel reason (the reason moved to the panel's Now tab; it is still judged on the dialog-time top-right panel)
  if (kind === 'decide') {
    // the panel draws `<label><summary>` (+ the wait suffix), cut by DISPLAY width with a trailing `…` (mods/live/model.ts reason line)
    if (attKind === 'permission' || attKind === 'question') {
      const label = attKind === 'permission' ? T.permission : T.question;
      reasons.push({ expected: label + String(attention.summary || ''), label, full: label + String(attention.summary || ''), source: 'attention.json summary' });
    }
    else reasons.push({ expected: String(decisionFile.question).slice(0, 30), source: 'decision-file.json question' });
  } else if (kind === 'stalled' && stalledRows === 0 && foremanStalled) reasons.push({ expected: locale === 'en' ? 'foreman silent for ' : '工頭 ', source: foremen.stalled[0].file });
  else if (kind === 'running' && !liveRun && foremanFresh) reasons.push({ expected: T.foremanRunning, source: foremen.fresh[0].file });
  else if (kind === 'running' && !liveRun && !(tasks && tasks.inProgress.length > 0)) reasons.push({ expected: T.turn, source: 'turn.json active' });

  // the band's own reason phrase (wide bands only, 要你決定 / 疑似卡住 only): { full, label } or null when the facts do not determine it
  let bandReason = null;
  if (kind === 'decide') {
    if (attKind === 'permission' || attKind === 'question') { const label = attKind === 'permission' ? T.permission : T.question; bandReason = { full: label + String(attention.summary || ''), label, source: 'attention.json summary' }; }
    else if (decisionOpen) bandReason = { full: String(decisionFile.question), label: '', source: 'decision-file.json question' };
  } else if (kind === 'stalled') {
    if (stalledRows > 0) {
      const ages = runs.filter((r) => r.stall === true).map((r) => r.last_event_age_s).filter((a) => Number.isFinite(a));
      bandReason = { full: ages.length > 0 ? T.stalledAge(Math.floor(Math.max(...ages) / 60)) : T.stalledCount(stalledRows), label: '', source: 'envelope.json stall rows' };
    } else if (foremanStalled) bandReason = { full: T.foremanStalled(Math.floor(Math.max(...foremen.stalled.map((x) => x.ageS)) / 60)), label: '', source: foremen.stalled[0].file };
  }

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
    put('position', '', 'marker.json size/urgent/level/stage/stage_set_at (+ stage.json walk)',
      { head: head === '' ? '' : `${head} `, stage: mStage, age: age === '—' ? null : age, walk: walkText(J('stage.json'), mStage) });
  } else put('position', null, 'marker.json has no stage');

  const u = marker && isObj(marker.unit) ? marker.unit : null;
  if (u && str(u.kind) && posInt(u.index) && posInt(u.total)) {
    const fams = Array.isArray(marker.review_families) ? marker.review_families.filter((f) => typeof f === 'string' && f !== '').length : 0;
    put('unit', '', 'marker.json unit/review_families', { bar: unitBar(u.index, u.total), kn: ` ${u.index}/${u.total}`, fam: fams > 0 ? ` ${T.fam(fams)}` : '' });
  } else put('unit', null, 'marker.json has no unit');

  const stalledN = stalledRows + (foremanStalled ? 1 : 0);
  put('dispatch', liveN > 0 || stalledN > 0 ? [liveN > 0 ? `⚙${liveN}` : null, stalledN > 0 ? `⏸${stalledN}` : null].filter(Boolean).join(' ') : null,
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
  const chip = qcOk ? (qc.state === 'ok' ? 'QC✓' : qc.state === 'owed' ? 'QC▲' : null) : null;
  put('review', rn === null && chip === null ? null : '', 'review.json generation + qc.json state', { round: rn === null ? null : `⟲R${rn}`, chip });

  // decisions: sidecars of the root set (summed), the latest ladder rung by `at`
  const sidecars = [J('decisions-sidecar.json'), ...extras.map((x) => x.sidecar)].filter(isObj);
  const sum = (k) => sidecars.reduce((n, sc) => n + (count(sc[k]) ? sc[k] : 0), 0);
  const ladders = sidecars.map((sc) => sc.ladder).filter((l) => isObj(l) && /^U[0-5]$/.test(l.rung) && ms(l.at) !== null).sort((a, b) => ms(b.at) - ms(a.at));
  const dparts = [sum('count') > 0 ? `◆${sum('count')}` : null, sum('undocumented_dispatches') > 0 ? `?${sum('undocumented_dispatches')}` : null, ladders[0] ? ladders[0].rung : null].filter(Boolean);
  put('decisions', dparts.length ? dparts.join(' ') : null, 'decisions-sidecar*.json count / undocumented_dispatches / ladder');

  // spend: D1 on the envelope
  const brain = isObj(envelope) ? envelope.host_today_brain_usd : null;
  const cap = isObj(envelope) ? envelope.brain_cap_usd : null;
  put('spend', Number.isFinite(brain) && Number.isFinite(cap) && cap > 0 ? '' : null, 'envelope.json host_today_brain_usd / brain_cap_usd',
    Number.isFinite(brain) && Number.isFinite(cap) && cap > 0 ? { brain, cap } : {});

  // hygiene: load-source chip + `⚑N` = needs_human_count (residue auto-reap R4 supersedes the P7 reapable-only ruling: reapable
  // residue is auto-reaped within 24 h, so only what a person must act on is counted). Absent field = 0 = hidden.
  const ls = J('load-source.json');
  const lsOk = isObj(ls) && ls.schema === 'autopilot.load-source/1';
  const res = J('residue.json');
  let wt = 0;
  if (isObj(res) && res.schema === 'autopilot.residue/1' && res.project_key === pkey && count(res.reapable_worktrees)) {
    if (count(res.needs_human_count)) {
      wt = res.needs_human_count;
      if (Array.isArray(res.needs_human) && res.needs_human.length > Math.min(wt, 20)) notes.push(`residue.json is inconsistent: needs_human_count=${wt} but needs_human lists ${res.needs_human.length} entries`);
    }
  }
  const hchip = lsOk ? hygieneChip(ls) : null;
  put('hygiene', hchip === null && wt === 0 ? null : '', 'load-source.json + residue.json', { wt, chip: hchip });

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
  const wide = columns >= 160; const mid = columns >= 120; const small = columns >= 80;
  // what each slot's text is at this width (null = the slot is gone), and the table rule that removed it
  const text = {};
  const rule = {};
  const pos = slots.position; const un = slots.unit; const rv = slots.review; const sp = slots.spend; const hy = slots.hygiene;
  let stageDrawn = pos.state === 'present' ? pos.parts.stage : '';
  const posText = () => `${pos.parts.head}${wide && pos.parts.walk !== null ? `${pos.parts.walk} ` : '▸ '}${stageDrawn}${wide && pos.parts.age !== null ? ` ◷${pos.parts.age}` : ''}`;
  if (pos.state === 'present') { if (mid) text.position = posText(); else rule.position = '< 120'; }
  if (un.state === 'present') { if (small) text.unit = `${un.parts.bar}${mid ? un.parts.kn : ''}${wide ? un.parts.fam : ''}`; else rule.unit = '< 80'; }
  if (rv.state === 'present') {
    const t = [mid ? rv.parts.round : null, rv.parts.chip].filter(Boolean).join(' ');
    if (small && t !== '') text.review = t; else rule.review = small ? 'empty at this width' : '< 80';
  }
  if (slots.decisions.state === 'present') { if (wide) text.decisions = slots.decisions.text; else rule.decisions = '< 160'; }
  if (sp.state === 'present') {
    const { brain: b, cap: c } = sp.parts;
    const bar = (n) => fillBar(Math.min(n, Math.max(0, Math.round((b / c) * n))), n);
    if (wide) text.spend = `$${Math.round(b)} ${bar(10)} ${Math.round((b / c) * 100)}%`;
    else if (mid) text.spend = `$${Math.round(b)} ${bar(5)}`;
    else if (small) text.spend = `$${bar(3)}`;
    else rule.spend = '< 80';
  }
  if (hy.state === 'present') {
    const chipText = hy.parts.chip === null ? null : hy.parts.chip.replace(' ↓', '↓');
    text.hygiene = [wide ? chipText : null, hy.parts.wt > 0 ? `⚑${hy.parts.wt}` : null].filter(Boolean).join(' ');
    if (text.hygiene === '') { delete text.hygiene; rule.hygiene = '< 160'; }
  }
  text.dispatch = slots.dispatch.state === 'present' ? slots.dispatch.text : null;
  for (const name of SLOT_ORDER) {
    const sl = slots[name];
    if (name === 'verdict') continue;
    if (sl.state === 'present' && (text[name] === undefined || text[name] === null)) { sl.state = 'width'; sl.why = `removed by the width table (bodyColumns ${columns} ${rule[name] || (name === 'dispatch' ? '' : '< 80')})`; }
    else if (sl.state === 'empty') sl.why = `empty: ${sl.source}`;
    else if (sl.state === 'present') sl.text = text[name];
  }
  // does the line fit? (only the position's stage text may be cut)
  const GROUP = { verdict: 0, position: 1, unit: 2, dispatch: 3, review: 3, decisions: 4, spend: 5, hygiene: 6 };
  const present = () => SLOT_ORDER.filter((n) => slots[n].state === 'present');
  const lineText = () => {
    let out = '';
    present().forEach((n, i, list) => {
      const txt = n === 'position' ? posText() : slots[n].text;
      if (i > 0) out += GROUP[n] === GROUP[list[i - 1]] ? ' ' : SEP;
      out += txt;
    });
    return `${out}${SEP}${ICON}`;
  };
  const widthNow = () => displayWidth(lineText());
  const over = widthNow() - columns;
  // 1. the position's stage text is cut with `…` (never below 2 cells); 2. still over: the overflow fallback of contract section 2, in order:
  //    remove the unit bar, then the ⏸ stalled count, then the ⚙ live count; 3. still over: shorten the verdict word with `…` (the glyph stays)
  if (over > 0 && pos.state === 'present') {
    const stageW = Math.max(2, displayWidth(pos.parts.stage) - over);
    stageDrawn = truncateTo(pos.parts.stage, stageW); // the EXACT cut: only as far as needed, never below 2 cells
    pos.parts.stageCut = stageDrawn;
    pos.text = posText();
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
    vs.parts.shortened = true;
  }
  // the verdict's reason phrase: wide bands, a 要你決定 / 疑似卡住 verdict that was not shortened, whatever room is left (>= 8 cells), at most 48 cells
  const room = columns - widthNow() - 1;
  const reasonExpected = wide && !vs.parts.shortened && (kind === 'decide' || kind === 'stalled') && room >= REASON_MIN;
  const reasonSlot = { applies: reasonExpected, room, max: Math.min(room, REASON_MAX), known: bandReason };

  return {
    meta, mode: meta.mode || String(meta.cell || '').split('-')[0] || '?', verdict, kind, locale, mark, attentionKind: attKind, okSnapshot, noScope, dock: dockOf(readText(path.join(dir, 'pane.txt'))), columns, columnsHow, slots, over, notes, reasons, nowMs, reasonSlot,
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
// the band: the last line carrying a verdict mark + word (any locale); it runs up to ` │ ⓘ` (a docked pane to its right is not part of it).
// A line may hold several candidates (the `✓` of `QC✓` is also a verdict mark): the leftmost valid one is the band's own verdict.
function findBand(paneText) {
  const lines = String(paneText || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let best = null;
    for (const v of VERDICTS) {
      for (let at = lines[i].indexOf(v.mark); at >= 0; at = lines[i].indexOf(v.mark, at + 1)) {
        const iconAt = lines[i].indexOf(`${SEP}${ICON}`, at);
        const text = iconAt >= 0 ? lines[i].slice(at, iconAt + SEP.length + ICON.length) : lines[i].slice(at).replace(/\s+$/, '');
        const first = text.split(SEP)[0];
        const head = `${v.mark} ${v.word}`;
        // the verdict word in full, optionally followed by the reason phrase (` <reason>`)
        // (without the ⓘ a verdict + reason is a band only when groups follow it: a transcript line that merely mentions a verdict has none)
        const full = first === head || (first.startsWith(`${head} `) && (iconAt >= 0 || text.includes(SEP)));
        // the overflow fallback shortens the verdict word to a prefix + `…`, or to the glyph alone; only with the ⓘ drawn (else it is just a mention)
        const cutForm = iconAt >= 0 && (first === v.mark || first === `${v.mark}…` || first === `${v.mark} …` || (first.startsWith(`${v.mark} `) && /^.*…$/.test(first) && v.word.startsWith(first.slice(2, -1)) && first.length > 3));
        if (!full && !cutForm) continue;
        if (iconAt < 0 && !(text === first || text.startsWith(`${first}${SEP}`))) continue; // a transcript line that merely mentions a verdict
        if (best === null || at < best.at) best = { at, iconAt, v, text };
      }
    }
    if (best !== null) {
      return { verdict: best.v.word, kind: best.v.kind, locale: best.v.locale, text: best.text, line1: best.text, line2: '', icon: best.iconAt >= 0, lineKind: 'ok', surface: 'band', ...tailOf(lines[i], best.iconAt >= 0 ? best.iconAt + SEP.length + ICON.length : -1) };
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
    if (text.length > SEP.length + ICON.length) return { text, line1: text, line2: '', icon: true, lineKind: 'nonok', surface: 'band', ...tailOf(lines[i], at + SEP.length + ICON.length) };
  }
  return null;
}
// the panel (right-hand column, after the last │): a cell that is exactly one verdict word (the pre-v2 Now tab), or the TUI v2 Now-tab hero row
// `<glyph> <word>  <project> · <since>` (the verdict word followed by two spaces); the first non-blank cell after it is the reason
function findPanel(paneText) {
  const cells = String(paneText || '').split('\n').map((l) => { const parts = l.split('│').map((p) => p.trim()).filter(Boolean); return l.includes('│') ? (parts[parts.length - 1] || '') : l.trim(); });
  for (let i = 0; i < cells.length; i += 1) {
    const v = VERDICTS.find((x) => cells[i] === x.word || cells[i].startsWith(`${x.mark} ${x.word}  `));
    if (v) {
      const hero = cells[i] !== v.word;
      const next = hero ? cells.slice(i + 1).find((c) => c !== '') || '' : cells[i + 1] || '';
      return { verdict: v.word, kind: v.kind, locale: v.locale, line1: hero ? cells[i] : v.word, line2: next, lineKind: 'panel', surface: 'panel' };
    }
  }
  return null;
}
// A permission / question dialog drawn by Claude Code itself (full width: it can hide the band AND the panel).
function findDialog(paneText) {
  // permission dialogs, and the AskUserQuestion dialog (footer `Enter to select · ↑/↓ to navigate · Esc to cancel`)
  return /This command requires approval|Do you want to (proceed|make this edit|create|run)|❯ 1\. Yes|Esc to cancel · Tab to amend|Enter to select · ↑\/↓ to navigate/.test(String(paneText || ''));
}

// classify one drawn segment by its own text (independent of what is expected); a group segment may hold the dispatch AND the review parts
function classify(seg, index) {
  if (index === 0) return /^[▲⏸✓●◌](…| \S.*)?$/.test(seg) ? 'verdict' : null;
  if (seg.includes('▸') || seg.includes('◐')) return 'position';
  if (/^[▰▱]/.test(seg)) return 'unit';
  if (/^(⚙\d+( ⏸\d+)?|⏸\d+)( (⟲R\d+( QC[✓▲])?|QC[✓▲]))?$/.test(seg)) return 'dispatch';
  if (/^(⟲R\d+( QC[✓▲])?|QC[✓▲])$/.test(seg)) return 'review';
  if (/^\$\d*( ?[▰▱]+)?( \d+%)?$/.test(seg) && /[▰▱]/.test(seg)) return 'spend';
  if (/^(dev|cache |src \?|⚑)/.test(seg)) return 'hygiene';
  if (seg.split(' ').every((tok) => /^(◆\d+|\?\d+|U\d)$/.test(tok))) return 'decisions';
  return null;
}

// ---- judging
function judgeBand(d, band) {
  const results = [];
  const res = (name, status, expected, got, source, detail) => results.push({ name, status, expected, got, source, detail: detail || '' });
  const iconDrawn = band.icon;
  const nonOkRe = /^(no project|unavailable|沒有專案|無法取得)( · .*)? · (run: |請執行：).* │ ⓘ$/;
  // the non-ok snapshot
  if (!d.okSnapshot && d.noScope) {
    // No marker, so the mod resolves the project from the cwd path map instead: either no project / no envelope (the mod's plain
    // `no project · run: …` / `unavailable · run: …` line), or the project-level envelope the capture driver does not copy, which
    // draws the verdict alone. The capture holds no slot facts, so only a bare verdict band (derived from attention / turn) is accepted.
    const bare = `${d.mark} ${d.verdict} │ ⓘ`;
    const plainLine = band.lineKind === 'nonok' && nonOkRe.test(band.text);
    const tp = tailProblem(band, d); // nothing but the engine's [-] toggle (or a docked pane's border) may follow the ⓘ
    const ok = (plainLine || band.text === bare) && !tp;
    res('no-scope', ok ? 'PASS' : 'FAIL', `\`${bare}\` or the mod's no-project / unavailable line (no marker, no envelope)`, band.text, 'marker.json and envelope.json both missing', tp || '');
    res('ⓘ', iconDrawn ? 'PASS' : 'FAIL', 'ⓘ', iconDrawn ? 'ⓘ' : 'none', 'contract slot 9: always drawn');
    return results;
  }
  if (!d.okSnapshot) {
    const plain = band.lineKind === 'nonok' && band.text.split(SEP).length === 2;
    const tp = tailProblem(band, d);
    res('nonok', plain && !tp ? 'PASS' : 'FAIL', '`<reason> │ ⓘ` (one dim line, no slots)', band.text, 'envelope.json missing / not fresh (non-ok snapshot)', tp || '');
    res('ⓘ', iconDrawn ? 'PASS' : 'FAIL', 'ⓘ', iconDrawn ? 'ⓘ' : 'none', 'contract slot 9: always drawn');
    return results;
  }
  if (band.lineKind === 'nonok') {
    res('verdict', 'FAIL', `${d.mark} ${d.verdict}`, band.text, d.slots.verdict.source, 'the snapshot is ok (envelope fresh) but the band is the non-ok line');
    res('ⓘ', 'PASS', 'ⓘ', 'ⓘ', 'contract slot 9: always drawn');
    return results;
  }
  const segs = band.text.split(SEP);
  if (iconDrawn) segs.pop(); // the trailing `ⓘ`
  // the verdict segment: the verdict (whole, or shortened by the fallback) + optionally the reason phrase after it
  const vs = d.slots.verdict;
  let verdictSeg = segs[0] || '';
  let reasonDrawnText = null;
  if (!vs.parts.shortened && verdictSeg.startsWith(`${vs.text} `)) { reasonDrawnText = verdictSeg.slice(vs.text.length + 1); verdictSeg = vs.text; }
  const drawn = {}; const extra = []; const order = [];
  const take = (name, text, i) => {
    if (drawn[name] !== undefined) extra.push(`second ${name} "${text}"`);
    else { drawn[name] = text; order.push(name); }
    return i;
  };
  segs.forEach((sg, i) => {
    const c = classify(i === 0 ? segs[0] : sg, i);
    if (c === null) { extra.push(`unclassified "${sg}"`); return; }
    if (c === 'dispatch' && / (⟲R\d+|QC[✓▲])/.test(sg)) {
      // one group: the dispatch part, then the review part (a single space between)
      const m = /^(⚙\d+(?: ⏸\d+)?|⏸\d+) (.+)$/.exec(sg);
      take('dispatch', m[1], i); take('review', m[2], i);
    } else take(c, i === 0 ? verdictSeg : sg, i);
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
      const exp = s.parts;
      // `<head><walk> <stage> ◷<age>` (wide, with a walk) or `<head>▸ <stage>` (+ ` ◷<age>` when wide without a walk)
      const m = exp.walk !== null && d.columns >= 160
        ? /^(?:(\S+) )?([●◐○─]+) (\S+?)(?: ◷(\S+))?$/.exec(got)
        : /^(.*?▸ )(\S*?)(?: ◷(\S+))?$/.exec(got);
      let headOk = false; let stageOk = false; let age;
      if (m && exp.walk !== null && d.columns >= 160) { headOk = (m[1] === undefined ? '' : `${m[1]} `) === exp.head && m[2] === exp.walk; stageOk = m[3] === (exp.stageCut !== undefined ? exp.stageCut : exp.stage); age = m[4]; }
      else if (m) { headOk = m[1] === exp.head + '▸ '; stageOk = m[2] === (exp.stageCut !== undefined ? exp.stageCut : exp.stage); age = m[3]; }
      const expAge = d.columns >= 160 ? exp.age : null;
      let ageOk = false; let ageNote = '';
      if (m) {
        if (expAge === null) { ageOk = age === undefined; ageNote = ageOk ? '' : `age ◷${age} must be absent`; }
        else if (age === undefined) ageNote = `age ◷${expAge} missing`;
        else {
          const a = parseElapsedMin(age); const e = parseElapsedMin(expAge);
          ageOk = a !== null && e !== null && Math.abs(a - e) <= AGE_TOLERANCE_MIN;
          ageNote = ageOk ? '' : `age ◷${age} vs ◷${expAge} (+-${AGE_TOLERANCE_MIN} min)`;
        }
      }
      res(name, headOk && stageOk && ageOk ? 'PASS' : 'FAIL', s.text, got, s.source, headOk && stageOk ? ageNote : `head/walk/stage differ${ageNote ? `; ${ageNote}` : ''}`);
    } else res(name, got === s.text ? 'PASS' : 'FAIL', s.text, got, s.source);
  }
  // the reason phrase after the verdict
  const rs = d.reasonSlot;
  if (reasonDrawnText !== null || rs.applies) {
    if (!rs.applies) res('reason', 'FAIL', `absent (${d.columns < 160 ? `bodyColumns ${d.columns} < 160` : 'no reason for this verdict, or no room'})`, reasonDrawnText, vs.source, 'drawn although it must be absent');
    else if (reasonDrawnText === null) res('reason', rs.known === null ? 'SKIP' : 'FAIL', rs.known === null ? 'unknown' : rs.known.full, 'absent', rs.known === null ? 'facts do not determine it' : rs.known.source, rs.known === null ? '' : `room left ${rs.room} cells (>= ${REASON_MIN}): the reason must be drawn`);
    else if (rs.known === null) res('reason', 'SKIP', 'unknown', reasonDrawnText, 'facts do not determine it');
    else {
      const ok = reasonPhraseOk(rs.known, reasonDrawnText, rs.max);
      res('reason', ok ? 'PASS' : 'FAIL', rs.known.full, reasonDrawnText, rs.known.source, ok ? '' : `at most ${rs.max} cells; the full text or a display-width prefix + …`);
    }
  }
  res('ⓘ', iconDrawn ? 'PASS' : 'FAIL', 'ⓘ', iconDrawn ? 'ⓘ' : 'none', 'contract slot 9: always drawn');
  // layout: classification complete, no duplicates / empty segment, slots in priority order, fits bodyColumns, ⓘ last
  const problems = [...extra];
  // dispatch and review are ONE group: both drawn, but in different segments, is a layout fault (a lone review segment is legal)
  if (drawn.dispatch !== undefined && drawn.review !== undefined && !segs.some((sg) => / (⟲R\d+|QC[✓▲])/.test(sg) && /^(⚙|⏸)/.test(sg))) problems.push('dispatch and review are one group (joined by a space), drawn in separate segments');
  const rank = order.map((n) => SLOT_ORDER.indexOf(n));
  if (rank.some((r, i) => i > 0 && r < rank[i - 1])) problems.push(`slots out of priority order: ${order.join(',')}`);
  if (segs.some((sg) => sg === '')) problems.push('an empty segment (doubled separator)');
  const tp = tailProblem(band, d);
  if (tp) problems.push(tp);
  const lineWidth = displayWidth(band.text);
  if (lineWidth > d.columns) problems.push(`line is ${lineWidth} cells wide, over bodyColumns ${d.columns}`);
  res('layout', problems.length === 0 ? 'PASS' : 'FAIL', `one line of at most ${d.columns} cells, slots in priority order, joined by " │ " (dispatch and review share one group), ⓘ last`, `${lineWidth} cells`, 'contract section 2', problems.join('; '));
  return results;
}

// The drawn band reason: the full text (optionally with the wait suffix), or a display-width prefix of it followed by `…`; at most `max` cells.
function reasonPhraseOk(r, drawn, max) {
  if (displayWidth(drawn) > max) return false;
  const body = drawn.replace(/（等了 \d+ 分）$| \(waited \d+ min\)$/, '');
  if (body === r.full) return true;
  if (!drawn.endsWith('…')) return false;
  const prefix = drawn.slice(0, -1);
  if (r.full.startsWith(prefix)) return Array.from(prefix).length >= Math.max(2, Array.from(r.label || '').length + 1);
  // the cut fell inside the wait suffix that follows the full text
  return prefix.startsWith(r.full) && /^(（|\s\()/.test(prefix.slice(r.full.length));
}

// The drawn reason is the full text (optionally followed by the wait suffix), or a display-width prefix of it (at least the label and
// one more character) followed by `…`. Other reasons (decision file / foreman / turn) keep the plain substring rule.
function reasonDrawn(r, drawn) {
  if (typeof r.full !== 'string') return drawn.includes(r.expected);
  const body = drawn.replace(/（等了 \d+ 分）$| \(waited \d+ min\)$/, '');
  if (body === r.full) return true;
  if (drawn.startsWith(r.full)) return true; // the Now tab's reason line continues with the proxy-decision tail (` · ...`)
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
  const pane = readText(path.join(dir, 'pane.txt')) || `${readText(path.join(dir, 'band.txt')) || ''}\n${readText(path.join(dir, 'panel.txt')) || ''}`;
  let band = findBand(pane) || findNonOk(pane) || findPanel(pane);
  // the locale: --locale, else meta.locale, else the locale of the verdict word the band draws, else zh-TW
  const meta = readJson(path.join(dir, 'meta.json')) || {};
  const locale = LOCALES.includes(opts.locale) ? opts.locale : LOCALES.includes(meta.locale) ? meta.locale : band && band.locale ? band.locale : 'zh-TW';
  const d = derive(dir, { ...opts, locale });
  d.derivedWords = WORDS[locale];
  // neither band nor panel, but a permission / question dialog is on screen: the verdict is judged from attention.json alone
  if (!band && findDialog(pane)) {
    const kind = d.attentionKind;
    band = { verdict: kind === 'permission' || kind === 'question' ? WORDS[locale].decide : '(a dialog is shown but attention.json is not permission / question)', kind: 'decide', lineKind: 'dialog', line1: '(dialog)', line2: '', surface: 'dialog' };
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
    else if (argv[i] === '--locale') { opts.locale = argv[i + 1]; i += 1; }
    else if (!argv[i].startsWith('--')) args.push(argv[i]);
  }
  if (args.length !== 1 || !fs.existsSync(args[0]) || !fs.statSync(args[0]).isDirectory() || ('bodyColumns' in opts && !Number.isFinite(opts.bodyColumns))) {
    process.stderr.write('usage: check.js <capture-dir> [--json] [--body-columns N] [--locale en|zh-TW]\n');
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

module.exports = { dockOf, derive, findBand, findNonOk, findPanel, findDialog, classify, displayWidth, run, summary, main, WORDS };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
