#!/usr/bin/env node
'use strict';
// scripts/render-review-page.js — JSON -> owner review page (mods plan P1b, row B1a: render only).
//
// Pure functions: buildJobModel(inputs) -> model; renderJobHtml(model) -> the nine-section page;
// renderProjectIndex(models) -> the project index with the two-axis count line. Node built-ins only,
// no network, no image library. Everything printed is HTML-escaped; unknown is printed as "unknown",
// never 0; manifest free-text fields are never read into the model.
//
// B1b adds publish(): versioned job dirs, atomic `current` switch, project + host indexes, content-addressed
// assets, --reap, --serve-stop (see the "publishing" section). Publishing runs its switch under flock(1).
//
// CLI (no --print publishes under --out-root; --print prints the page to stdout):
//   render-review-page.js --runs <runs-live.json|status-runs.json> [--root <root_run_id>]
//     [--task-receipt <file|none>] [--progress-receipt <file>] [--compare <dir>] [--decision <file>]
//     [--planned <file>] --job <id> --date <YYYY-MM-DD> --project <project_key>
//     [--repo <dir>] [--commit <sha>] [--now <iso>] [--out-root <dir>] [--print]
//   render-review-page.js --reap [--days N] --project <project_key> [--out-root <dir>] [--now <iso>]
//   render-review-page.js --serve-stop
// The acceptance axis comes only from `autopilot status task --root-run-id <id> --json`. With --root and no
// --task-receipt the renderer calls it itself; AUTOPILOT_RENDER_TASK_STATUS_BIN replaces the
// `node bin/autopilot.js` prefix (tests inject a fixture there). `--task-receipt none` skips the call.
// Exit: 0 printed/published, 1 publish failed (current unchanged), 2 usage / unreadable --runs / bad --now.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const NO_VERDICT_SENTENCE = '本回合尚無驗收 verdict；下表是執行狀態，不是進度';
const EXEC_CHIP = { running: 'RUNNING', exited: 'EXITED', unknown: 'UNKNOWN' };
const ACC_CHIP = { accepted: 'ACCEPTED', rejected: 'REJECTED', unknown: 'PENDING' };
const DEFAULT_FRESH_BOUND_S = 180;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// ---- small helpers ---------------------------------------------------------------------------------------
function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function unknownSpan() { return '<span class="unknown">unknown</span>'; }
function show(value) {
  if (value === null || value === undefined || value === '') return unknownSpan();
  return esc(value);
}
function chip(text, cls) { return `<span class="chip chip-${cls}">${esc(text)}</span>`; }
function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function sha256Of(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function fmtElapsed(s) {
  if (!Number.isFinite(s)) return unknownSpan();
  return `${Math.floor(s / 60)}m${s % 60}s`;
}
function iso(now) {
  const ms = typeof now === 'number' ? now : Date.parse(now);
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

// ---- execution / acceptance axes (A12 mapping) -----------------------------------------------------------
function execState(row, boundS) {
  if (row.phase === 'exited' || row.ended_at || row.final_status) return 'exited';
  if (row.alive === true && Number.isFinite(row.probe_age_s) && row.probe_age_s <= boundS) return 'running';
  return 'unknown';
}
function acceptanceChip(verdict, canClose) {
  const base = ACC_CHIP[verdict] || ACC_CHIP.unknown;
  return verdict === 'accepted' && canClose === false ? `${base} · 未收尾` : base;
}

// ---- model -----------------------------------------------------------------------------------------------
function validTaskReceipt(receipt, root) {
  if (!isObject(receipt) || receipt.artifact_type !== 'task_status_receipt') return null;
  if (root && receipt.root_run_id !== root) return null; // a receipt of another root is not this job's
  return receipt;
}
function buildProgress(receipt, root) {
  if (!isObject(receipt) || receipt.artifact_type !== 'controller_progress_receipt') return null;
  if (root && receipt.root_run_id !== root) return null;
  const completed = Array.isArray(receipt.completed_deliverables) ? receipt.completed_deliverables.map(String) : null;
  const remaining = Array.isArray(receipt.remaining_deliverables) ? receipt.remaining_deliverables.map(String) : null;
  const count = Number.isInteger(receipt.deliverable_count) && receipt.deliverable_count > 0 ? receipt.deliverable_count : null;
  const digest = typeof receipt.frozen_denominator_digest === 'string' && receipt.frozen_denominator_digest ? receipt.frozen_denominator_digest : null;
  const frozen = Boolean(digest && count !== null && completed);
  const done = completed ? completed.length : null;
  const percent = frozen ? Math.round((done / count) * 1000) / 10 : null;
  const per = [];
  for (const id of completed || []) per.push({ id, state: 'done', percent: frozen ? 100 : null });
  for (const id of remaining || []) per.push({ id, state: 'open', percent: null });
  return {
    frozen, percent, done, total: frozen ? count : null,
    remaining: frozen ? count - done : null, per_deliverable: per, denominator_digest: digest,
  };
}
// MATCH / 舊候選 / LIVE GATE · 未綁定候選 / UNVERIFIED — plan 7 (join = ledger-dir membership + head ancestry).
function gateRow(entry, candidate, isAncestor) {
  const r = entry.receipt;
  if (r.kind !== 'review') {
    return { phase: String(r.phase || ''), generation: null, base: null, head: null, verdict: String(r.kind || 'unknown'), status: '—', branch_differs: false, source: entry.file, dir: entry.dir, opt_out: true };
  }
  const chain = Array.isArray(r.chain) ? r.chain.filter((c) => isObject(c) && c.status === 'finalized') : [];
  chain.sort((a, b) => (a.generation || 0) - (b.generation || 0));
  const last = chain.length ? chain[chain.length - 1] : null;
  const head = last && typeof last.head === 'string' ? last.head : null;
  let status;
  if (!candidate) status = 'LIVE GATE · 未綁定候選';
  else if (!head) status = 'UNVERIFIED';
  else {
    const anc = isAncestor ? isAncestor(head, candidate) : null;
    status = anc === true ? 'MATCH' : (anc === false ? '舊候選' : 'UNVERIFIED');
  }
  const rBranch = typeof r.branch === 'string' && r.branch ? r.branch : null;
  return {
    phase: String(r.phase || ''), generation: last && Number.isInteger(last.generation) ? last.generation : null,
    base: last && typeof last.base === 'string' ? last.base : null, head,
    verdict: typeof r.verdict === 'string' ? r.verdict : null, status,
    branch_differs: Boolean(rBranch && entry.manifestBranch && rBranch !== entry.manifestBranch),
    source: entry.file, dir: entry.dir, opt_out: false,
  };
}
function markConflicts(rows) {
  const byPhase = new Map();
  for (const g of rows) if (g.status === 'MATCH') byPhase.set(g.phase, [...(byPhase.get(g.phase) || []), g]);
  for (const list of byPhase.values()) {
    if (list.length >= 2 && new Set(list.map((g) => g.verdict)).size > 1) for (const g of list) g.conflict = true;
  }
}

function buildJobModel(inputs) {
  const o = inputs || {};
  const envelope = isObject(o.runs) ? o.runs : null;
  const allRows = envelope ? (Array.isArray(envelope.runs) ? envelope.runs : []) : (Array.isArray(o.runs) ? o.runs : []);
  const root = o.root || null;
  const rows = allRows.filter((r) => isObject(r) && (!root || r.root_run_id === root));
  const bound = envelope && envelope.counts && Number.isFinite(envelope.counts.fresh_bound_s) ? envelope.counts.fresh_bound_s : DEFAULT_FRESH_BOUND_S;

  const dispatch = rows.map((r) => {
    const state = execState(r, bound);
    return {
      run_id: r.run_id == null ? null : String(r.run_id), role: r.role == null ? null : String(r.role),
      runner: r.runner == null ? null : String(r.runner), model: r.model == null ? null : String(r.model),
      started_at: r.started_at || null, elapsed_s: Number.isFinite(r.elapsed_s) ? r.elapsed_s : null,
      phase: r.phase == null ? null : String(r.phase), rc: Number.isInteger(r.rc) ? r.rc : null,
      final_status: r.final_status == null ? null : String(r.final_status),
      probe_age_s: Number.isFinite(r.probe_age_s) ? r.probe_age_s : null,
      execution: state, unverified: state === 'unknown',
      manifest: isObject(r.source) && r.source.manifest ? String(r.source.manifest) : (r.manifest ? String(r.manifest) : null),
      exit_file: isObject(r.source) && r.source.exit_file ? String(r.source.exit_file) : null,
    };
  });
  const execution = { running: 0, exited: 0, unknown: 0 };
  for (const d of dispatch) execution[d.execution] += 1;

  const task = validTaskReceipt(o.taskReceipt, root);
  const verdict = task ? (['accepted', 'rejected', 'unknown'].includes(task.acceptance_verdict) ? task.acceptance_verdict : 'unknown') : 'unknown';
  const candidate = task && typeof task.candidate_commit === 'string' && OID.test(task.candidate_commit) ? task.candidate_commit : null;
  const canClose = task && typeof task.can_close === 'boolean' ? task.can_close : null;
  let conclusion;
  if (!task) conclusion = NO_VERDICT_SENTENCE;
  else if (verdict === 'unknown') conclusion = '驗收結論：unknown（task_status_receipt 沒有 verdict）';
  else conclusion = `驗收結論：${verdict}（來源 task_status_receipt）`;

  const gates = (o.reviewReceipts || []).map((e) => gateRow(e, candidate, o.isAncestor));
  markConflicts(gates);
  gates.sort((a, b) => (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : (a.generation || 0) - (b.generation || 0) || String(a.source).localeCompare(String(b.source))));

  const decision = isObject(o.decision) && typeof o.decision.question === 'string' ? {
    question: o.decision.question,
    options: (Array.isArray(o.decision.options) ? o.decision.options : []).filter(isObject)
      .map((x) => ({ label: String(x.label == null ? '' : x.label), consequence: String(x.consequence == null ? '' : x.consequence) })),
    not_authorized: o.decision.not_authorized == null ? null : String(o.decision.not_authorized),
  } : null;

  const progress = buildProgress(o.progressReceipt, root);
  const planned = Array.isArray(o.planned) ? o.planned.map((p) => (isObject(p) ? { id: String(p.id == null ? '' : p.id), title: p.title == null ? null : String(p.title) } : { id: String(p), title: null })) : [];

  return {
    schema: 'review-job-model/1',
    job: o.job == null ? null : String(o.job), date: o.date == null ? null : String(o.date),
    project: o.project == null ? null : String(o.project), root_run_id: root,
    published_at: iso(o.now === undefined ? Date.now() : o.now),
    commit: typeof o.commit === 'string' && o.commit ? o.commit : null,
    axes: { execution, acceptance: verdict, can_close: canClose },
    acceptance: task ? {
      verdict, can_close: canClose, candidate_commit: candidate,
      candidate_tree_sha: typeof task.candidate_tree_sha === 'string' ? task.candidate_tree_sha : null,
      receipt_digest: typeof task.receipt_digest === 'string' ? task.receipt_digest : null,
      issued_at: task.issued_at || null,
      failed_predicates: Array.isArray(task.failed_predicates) ? task.failed_predicates.map(String) : [],
    } : null,
    conclusion, needs_decision: Boolean(decision), decision,
    progress, planned, compare: o.compare || [], dispatch, gates,
    scope: envelope && isObject(envelope.scope) ? {
      project_key: envelope.scope.project_key || null, repo_identity: envelope.scope.repo_identity || null,
    } : null,
    envelope: envelope ? {
      published_at: envelope.published_at || null, valid_for_s: Number.isFinite(envelope.valid_for_s) ? envelope.valid_for_s : null,
      counts: isObject(envelope.counts) ? envelope.counts : null,
    } : null,
    sources: o.sources || [],
  };
}

// ---- HTML ------------------------------------------------------------------------------------------------
const CSS = `:root{--bg:#fafaf8;--fg:#1d1d1b;--mute:#6b6b66;--line:#d8d8d2;--card:#fff;--ok:#1a7f37;--bad:#b42318;--warn:#8a5a00;--info:#0b5cad}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#161615;--fg:#ecece8;--mute:#9a9a94;--line:#3a3a36;--card:#1f1f1d;--ok:#4cc26a;--bad:#ff7b72;--warn:#e3b341;--info:#6cb6ff}}
:root[data-theme="dark"]{--bg:#161615;--fg:#ecece8;--mute:#9a9a94;--line:#3a3a36;--card:#1f1f1d;--ok:#4cc26a;--bad:#ff7b72;--warn:#e3b341;--info:#6cb6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}a{color:var(--info)}
main{max-width:980px;margin:0 auto;padding:16px}section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px;margin:12px 0}
section.head{background:none;border:0;padding:0;margin:4px 0 8px}section.head h2{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}section.head p{margin:.1rem 0}
h1{font-size:1.4rem;margin:.2rem 0}h2{font-size:1.05rem;margin:.1rem 0 .5rem}h3{font-size:1rem;margin:.6rem 0 .3rem}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;font-size:.85rem;overflow-wrap:break-word}.nb{white-space:nowrap}.unknown{color:var(--mute);font-style:italic}
.chip{display:inline-block;border:1px solid var(--line);border-radius:10px;padding:0 8px;font-size:.84rem;margin:0 4px 2px 0}
.chip-running,.chip-info{color:var(--info)}.chip-accepted,.chip-match{color:var(--ok)}.chip-rejected,.chip-conflict,.chip-unverified{color:var(--bad)}
.chip-pending,.chip-unknown,.chip-warn{color:var(--warn)}.muted{color:var(--mute)}figure{margin:0 8px 8px 0;display:inline-block;vertical-align:top;max-width:100%}
figcaption{font-size:.8rem;color:var(--mute);overflow-wrap:anywhere}figure img{max-width:100%;height:auto;border:1px solid var(--line)}code{font-size:.85em;word-break:break-all}
.counts{word-break:keep-all}.summary{font-weight:600;margin:.2rem 0 .6rem}section>p,li,dd{overflow-wrap:anywhere}
@media (max-width:640px){main{padding:8px}section{padding:8px 12px;margin:6px 0}section p{margin:.25rem 0}section ol,section ul{margin:.25rem 0}h1{font-size:1.2rem}h2{font-size:1rem;margin:0 0 .25rem}h3{margin:.3rem 0 .15rem}.updated{font-size:.75rem}th,td{padding:2px 6px}
table.cards,table.cards thead,table.cards tbody,table.cards tr,table.cards td{display:block;width:100%}
table.cards thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
table.cards tr{border:1px solid var(--line);border-radius:6px;margin:6px 0;padding:2px 8px}
table.cards td{display:flex;justify-content:space-between;gap:12px;border:0;padding:2px 0;text-align:right}
table.cards td::before{content:attr(data-label);color:var(--mute);text-align:left;flex:none}}`;

function page(title, body) {
  return `<!doctype html>\n<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(title)}</title>\n<style>${CSS}</style></head>\n<body><main>\n${body}\n</main></body></html>\n`;
}
function section(n, heading, inner, cls) {
  return `<section data-section="${n}" id="s${n}"${cls ? ` class="${cls}"` : ''}><h2>${esc(heading)}</h2>\n${inner}\n</section>`;
}
// cards = the table collapses to one stacked card per row under 640 px (cells carry data-label); compact tables stay tables.
function table(head, bodyRows, kind = 'cards') {
  const rows = bodyRows.map((row) => { let i = 0; return row.replace(/<td>/g, () => `<td data-label="${esc(head[i++] === undefined ? '' : head[i - 1])}">`); });
  return `<table class="${kind}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>\n${rows.join('\n')}\n</tbody></table>`;
}
function td(html) { return `<td>${html}</td>`; }
function shortSha(s) { return typeof s === 'string' && s ? s.slice(0, 12) : null; }

function renderProgress(model) {
  const p = model.progress;
  let head;
  let counts;
  if (p && p.frozen) {
    head = `<p><strong>總進度 ${esc(p.percent)}%</strong>（分母已凍結：${esc(p.total)}）</p>`;
    counts = `<p>完成 ${esc(p.done)} · 未完成 ${esc(p.remaining)}</p>`;
  } else {
    head = `<p><strong>總進度：分母未凍結 · ${p && p.done !== null ? esc(p.done) : 'done 未知'}${p && p.done !== null ? ' done' : ''}</strong></p>`;
    counts = p && p.done !== null ? `<p>完成 ${esc(p.done)} · 未完成 ${unknownSpan()}</p>` : `<p>完成 ${unknownSpan()} · 未完成 ${unknownSpan()}</p>`;
  }
  const per = p && p.per_deliverable.length
    ? table(['deliverable', '完成度', '狀態'], p.per_deliverable.map((d) => `<tr>${td(esc(d.id))}${td(d.percent === null ? unknownSpan() : `${esc(d.percent)}%`)}${td(d.state === 'done' ? '完成' : '未完成')}</tr>`), 'compact')
    : '<p class="muted">沒有 controller_progress_receipt 的 deliverable 清單。</p>';
  const planned = model.planned.length
    ? `<ul>${model.planned.map((x) => `<li>${esc(x.id)}${x.title ? ` — ${esc(x.title)}` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">沒有規劃清單輸入。</p>';
  const ex = model.axes.execution;
  const axes = `<p>執行軸 ${chip(`RUNNING ${ex.running}`, 'running')}${chip(`EXITED ${ex.exited}`, 'info')}${chip(`UNKNOWN ${ex.unknown}`, 'unknown')} ｜ 驗收軸 ${chip(acceptanceChip(model.axes.acceptance, model.axes.can_close), model.axes.acceptance === 'unknown' ? 'pending' : model.axes.acceptance)}</p>`;
  return `<h3>實際（receipt）</h3>\n${head}\n${counts}\n${per}\n${axes}\n<h3>規劃（graph／README，display-only，不進分母）</h3>\n${planned}`;
}

function renderCompare(model) {
  if (!model.compare.length) return '<p class="muted">沒有 compare-record。</p>';
  return model.compare.map((c) => {
    if (c.error) return `<div><p>${chip('UNVERIFIED', 'unverified')} compare-record 無法使用：${esc(c.file)}（${esc(c.error)}）</p></div>`;
    const dirty = c.before_dirty !== false || c.after_dirty !== false;
    const fig = (label, im) => {
      if (!im) return '';
      if (im.missing) return `<figure><div class="unknown">asset missing · sha256 ${im.sha256 ? esc(im.sha256) : 'unknown'}</div><figcaption>${esc(label)}</figcaption></figure>`;
      return `<figure><a href="${esc(im.rel_path)}"><img src="${esc(im.rel_path)}" alt="${esc(label)}"></a><figcaption>${esc(label)}${im.commit ? ` @ ${esc(shortSha(im.commit))}` : ''} · sha256 ${esc(shortSha(im.sha256))}${im.mismatch ? ` ${chip('UNVERIFIED', 'unverified')} sha256 mismatch` : ''}</figcaption></figure>`;
    };
    const metrics = c.metrics.length
      ? table(['metric', 'kind', 'before', 'after', 'delta', 'unit'], c.metrics.map((m) => `<tr>${td(show(m.name))}${td(show(m.kind))}${td(show(m.before))}${td(show(m.after))}${td(show(m.delta))}${td(show(m.unit))}</tr>`))
      : '';
    const review = c.image_review
      ? `<p>審圖席：${show(c.image_review.by)} @ ${show(c.image_review.at)}${c.image_review.notes.length ? `<ul>${c.image_review.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</p>`
      : '<p class="muted">審圖席：尚無紀錄。</p>';
    return `<div class="compare"><h3>${esc(c.scene)} <span class="muted">${esc(c.id)}</span> ${dirty ? chip('UNVERIFIED', 'unverified') : ''}</h3>
<p class="muted">${esc(c.viewport || c.camera || '')} · ${esc(c.renderer || c.browser || '')} · ${esc(c.fixture)} · ${esc(c.capture_method)}</p>
<div>${fig('before', c.images.before)} ${fig('after', c.images.after)} ${fig('overlay', c.images.overlay)}</div>
${metrics}\n${review}${c.observer_note ? `<p class="muted">observer: ${esc(c.observer_note.text)} — ${esc(c.observer_note.by)}</p>` : ''}</div>`;
  }).join('\n');
}

function renderDispatch(model) {
  if (!model.dispatch.length) return '<p class="muted">這個 root 沒有 dispatch run。</p>';
  const rows = model.dispatch.map((d) => `<tr>${td(esc(d.run_id))}${td(show(d.role))}${td(`${show(d.runner)} / ${show(d.model)}`)}${td(`<span class="nb">${show(d.started_at)}</span>`)}${td(fmtElapsed(d.elapsed_s))}${td(show(d.phase))}${td(d.rc === null ? unknownSpan() : esc(d.rc))}${td(show(d.final_status))}${td(d.probe_age_s === null ? unknownSpan() : `${esc(d.probe_age_s)}s`)}${td(chip(EXEC_CHIP[d.execution], d.execution === 'exited' ? 'info' : d.execution) + (d.unverified ? chip('UNVERIFIED', 'unverified') : ''))}</tr>`);
  return `<p class="muted">執行狀態，不是進度</p>\n${table(['run_id', 'role', 'runner / model', 'started', 'elapsed', 'phase', 'rc', 'final_status', 'probe_age_s', 'axis'], rows)}`;
}

function renderGates(model) {
  if (!model.gates.length) return '<p class="muted">沒有 review receipt。</p>';
  const rows = model.gates.map((g) => {
    const chips = [];
    if (g.status === 'MATCH') chips.push(chip('MATCH', 'match'));
    else if (g.status === '舊候選') chips.push(chip('舊候選', 'warn'));
    else if (g.status === 'UNVERIFIED') chips.push(chip('UNVERIFIED', 'unverified'));
    else chips.push(chip(g.status, 'warn'));
    if (g.conflict) chips.push(chip('CONFLICT', 'conflict'));
    if (g.branch_differs) chips.push(chip('branch differs', 'info'));
    const range = g.base || g.head ? `${show(shortSha(g.base))} → ${show(shortSha(g.head))}` : unknownSpan();
    return `<tr>${td(esc(g.phase))}${td(g.generation === null ? unknownSpan() : esc(g.generation))}${td(range)}${td(show(g.verdict))}${td(chips.join(''))}</tr>`;
  });
  return table(['phase', 'generation', 'base → head', 'verdict', '匹配狀態'], rows);
}

function renderDetails(model) {
  const a = model.acceptance;
  const kv = [];
  const add = (k, v) => kv.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`);
  add('project_key', show(model.scope ? model.scope.project_key : model.project));
  add('repo_identity', show(model.scope ? model.scope.repo_identity : null));
  add('root_run_id', show(model.root_run_id));
  add('candidate_commit', show(a ? a.candidate_commit : null));
  add('candidate_tree_sha', show(a ? a.candidate_tree_sha : null));
  add('receipt_digest', show(a ? a.receipt_digest : null));
  add('failed_predicates', a && a.failed_predicates.length ? a.failed_predicates.map(esc).join(', ') : (a ? '—' : unknownSpan()));
  add('runs-live', model.envelope ? `published_at ${show(model.envelope.published_at)} · valid_for_s ${show(model.envelope.valid_for_s)}` : unknownSpan());
  const runs = model.dispatch.map((d) => `<li>${esc(d.run_id)} · manifest ${show(d.manifest)} · exit_file ${show(d.exit_file)}</li>`).join('');
  const gates = model.gates.map((g) => `<li>${esc(g.phase)} · ${esc(g.source)}</li>`).join('');
  return `<details><summary>工程細節</summary>\n<dl>${kv.join('')}</dl>\n<p>runs</p><ul>${runs}</ul>\n<p>review receipts</p><ul>${gates}</ul>\n</details>`;
}

function renderJobHtml(model) {
  const m = model;
  const accCls = m.axes.acceptance === 'unknown' ? 'pending' : m.axes.acceptance;
  const dd = m.decision;
  const s1 = `<h1>${esc(m.job)} <span class="muted">· ${esc(m.project)}</span></h1>\n<p class="updated muted">updated ${esc(m.published_at)} @ ${m.commit ? esc(m.commit) : 'unknown'}</p>`;
  const s2 = `<p>${chip(acceptanceChip(m.axes.acceptance, m.axes.can_close), accCls)}${m.needs_decision ? chip('需要你決定', 'warn') : chip('知會', 'info')}</p>\n<p><strong>${esc(m.conclusion)}</strong></p>\n<p>${m.needs_decision ? `需要你決定：${dd && typeof dd.question === 'string' ? esc(dd.question) : unknownSpan()}` : '知會：目前沒有待你決定的事項。'}</p>`;
  const d = m.decision;
  const s3 = d
    ? `<p><strong>${esc(d.question)}</strong></p>\n<ol>${d.options.map((x) => `<li>${esc(x.label)} — ${esc(x.consequence)}</li>`).join('')}</ol>\n<p>這份裁決不授權的事：${d.not_authorized ? esc(d.not_authorized) : unknownSpan()}</p>`
    : '<p class="muted">本回合沒有待決事項。</p>';
  const sources = m.sources.length
    ? `<ul>${m.sources.map((s) => `<li>${esc(s.role)} · <code>${esc(s.path)}</code> · sha256 <code>${esc(s.sha256)}</code></li>`).join('')}</ul>`
    : '<p class="muted">沒有來源輸入。</p>';
  const s9 = `<p>commit：<code>${m.commit ? esc(m.commit) : 'unknown'}</code></p>\n<details><summary>來源（${m.sources.length}）</summary>${sources}</details>\n<p class="muted">這頁不主張的事：不判定轉換、不產生 verdict、不提升層級；派工表是執行狀態不是進度；review receipt 只代表該 gate 的結果；未知值顯示為 unknown，不補 0。</p>`;
  return page(`${m.job} · ${m.project}`, [
    section(1, '標題', s1, 'head'), section(2, '結論', s2), section(3, '待決事項', s3),
    section(4, '進度', renderProgress(m)), section(5, '證據', renderCompare(m)),
    section(6, '派工表', renderDispatch(m)), section(7, 'gate 結果', renderGates(m)),
    section(8, '工程細節', renderDetails(m)), section(9, '來源與聲明', s9),
  ].join('\n'));
}

function renderProjectIndex(models, opts = {}) {
  const list = [...(models || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.job).localeCompare(String(b.job)));
  const ex = { running: 0, exited: 0, unknown: 0 };
  const acc = { accepted: 0, rejected: 0, unknown: 0 };
  for (const m of list) {
    for (const k of Object.keys(ex)) ex[k] += Number.isInteger(m.axes.execution[k]) ? m.axes.execution[k] : 0;
    acc[['accepted', 'rejected'].includes(m.axes.acceptance) ? m.axes.acceptance : 'unknown'] += 1;
  }
  const counts = `執行 RUNNING ${ex.running} · EXITED ${ex.exited} · UNKNOWN ${ex.unknown} ｜ 驗收 ACCEPTED ${acc.accepted} · REJECTED ${acc.rejected} · PENDING ${acc.unknown}`;
  const rows = list.map((m) => {
    const e = m.axes.execution;
    return `<tr>${td(`<a href="${esc(m.date)}/${esc(m.job)}/current/index.html">${esc(m.job)}</a>`)}${td(esc(m.date))}${td(`<span class="nb">${show(m.published_at)}</span>`)}${td(`${esc(`${EXEC_CHIP.running} ${e.running}`)} · ${esc(`${EXEC_CHIP.exited} ${e.exited}`)} · ${esc(`${EXEC_CHIP.unknown} ${e.unknown}`)}`)}${td(chip(acceptanceChip(m.axes.acceptance, m.axes.can_close), m.axes.acceptance === 'unknown' ? 'pending' : m.axes.acceptance))}${td(m.needs_decision ? chip('需要你決定', 'warn') : '—')}</tr>`;
  });
  const project = opts.project || (list[0] && list[0].project) || null;
  const body = `<h1>Review index <span class="muted">· ${show(project)}</span></h1>\n<p class="summary" data-summary="decisions">需要你決定：${list.filter((m) => m.needs_decision).length}</p>\n<p class="counts" data-counts="two-axis">${esc(counts)}</p>\n${list.length ? table(['job', 'date', 'published_at', '執行', '驗收', '需要決定'], rows) : '<p class="muted">沒有 job。</p>'}`;
  return page(`Review index · ${project || 'unknown'}`, body);
}

// ---- input loading (CLI side; pure functions above take parsed values) --------------------------------------
function readJsonFile(file) {
  const bytes = fs.readFileSync(file);
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256Of(bytes), bytes };
}
function tryReadJson(file) {
  try { return readJsonFile(file); } catch (_e) { return null; }
}
// An explicitly passed input that is missing or malformed: one stderr line naming it; the page still renders.
function readExplicit(flag, file, accept) {
  const rec = tryReadJson(file);
  if (!rec) { process.stderr.write(`render-review-page: --${flag} ${file} is missing or not valid JSON; ignored\n`); return null; }
  if (accept && !accept(rec.value)) { process.stderr.write(`render-review-page: --${flag} ${file} is malformed; ignored\n`); return null; }
  return rec;
}
function gitIsAncestor(repo) {
  return (a, b) => {
    if (!OID.test(a) || !OID.test(b)) return null;
    const r = cp.spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', a, b], { encoding: 'utf8' });
    if (r.status === 0) return true;
    if (r.status === 1) return false;
    return null;
  };
}
function discoverReviewReceipts(rows, root) {
  const dirs = new Map(); // dir -> {manifestBranch}
  for (const r of rows) {
    if (root && r.root_run_id !== root) continue;
    const mp = (isObject(r.source) && r.source.manifest) || r.manifest;
    const m = mp ? tryReadJson(mp) : null;
    if (!m || !isObject(m.value) || typeof m.value.ledger !== 'string' || !m.value.ledger) continue;
    let dir = path.dirname(m.value.ledger);
    try { if (fs.statSync(m.value.ledger).isDirectory()) dir = m.value.ledger; } catch (_e) { /* a file path or not yet there: use its parent */ }
    if (!dirs.has(dir)) dirs.set(dir, { manifestBranch: typeof m.value.branch === 'string' ? m.value.branch : null });
  }
  const out = [];
  for (const [dir, info] of [...dirs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => /^receipt-.+\.json$/.test(n)).sort(); } catch (_e) { continue; }
    for (const n of names) {
      const file = path.join(dir, n);
      const rec = tryReadJson(file);
      if (!rec || !isObject(rec.value)) continue;
      if (root && typeof rec.value.root_run_id === 'string' && rec.value.root_run_id !== root) continue;
      out.push({ dir, file, receipt: rec.value, sha256: rec.sha256, manifestBranch: info.manifestBranch });
    }
  }
  return out;
}
function loadCompare(dir) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch (_e) { return out; }
  let validate = null;
  let schema = null;
  try {
    validate = require('./validate-json-schema').validateJsonSchema;
    schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas', 'compare-record.schema.json'), 'utf8'));
  } catch (_e) { /* schema check unavailable: shape checks below still apply */ }
  for (const n of names) {
    const file = path.join(dir, n);
    const rec = tryReadJson(file);
    if (!rec) { out.push({ file, error: 'unreadable JSON', sha256: null }); continue; }
    let valid = isObject(rec.value) && rec.value.schema === 'compare-record/1' && isObject(rec.value.before) && isObject(rec.value.after);
    if (valid && validate && schema) { try { valid = validate(schema, rec.value).valid === true; } catch (_e) { valid = false; } }
    if (!valid) { out.push({ file, error: 'not a valid compare-record/1', sha256: rec.sha256 }); continue; }
    out.push(compareEntry(file, rec, dir));
  }
  return out;
}
function compareEntry(file, rec, dir) {
  const r = rec.value;
  const image = (label, side) => {
    const rel = r.images && r.images[label];
    if (!rel) return null;
    const abs = path.resolve(dir, rel);
    const declared = side ? side.sha256 : null;
    let bytes = null;
    try { bytes = fs.readFileSync(abs); } catch (_e) { /* missing */ }
    if (!bytes) return { missing: true, sha256: declared || null, source: abs };
    const actual = sha256Of(bytes);
    const ext = (path.extname(abs).replace(/[^A-Za-z0-9.]/g, '') || '.bin').toLowerCase();
    return { missing: false, sha256: actual, source: abs, rel_path: `../assets/${actual.slice(0, 12)}${ext}`, commit: side ? side.commit : null, mismatch: Boolean(declared && declared !== actual) };
  };
  return {
    file, sha256: rec.sha256, id: r.id, scene: r.scene, viewport: r.viewport || null, camera: r.camera || null,
    renderer: r.renderer || null, browser: r.browser || null, fixture: r.fixture, capture_method: r.capture_method,
    before_dirty: r.before.dirty, after_dirty: r.after.dirty,
    metrics: Array.isArray(r.metrics) ? r.metrics : [],
    images: { before: image('before', r.before), after: image('after', r.after), overlay: image('overlay', null) },
    image_review: r.image_review ? { by: r.image_review.by, at: r.image_review.at, notes: Array.isArray(r.image_review.notes) ? r.image_review.notes.map(String) : [] } : null,
    observer_note: r.observer_note || null,
  };
}
function callTaskStatus(root, repo, env) {
  const bin = env.AUTOPILOT_RENDER_TASK_STATUS_BIN;
  const args = ['status', 'task', '--root-run-id', root, '--json'];
  const res = bin
    ? cp.spawnSync(bin, args, { encoding: 'buffer', cwd: repo, env, timeout: 30000 })
    : cp.spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'autopilot.js'), ...args], { encoding: 'buffer', cwd: repo, env, timeout: 30000 });
  if (res.status !== 0) {
    process.stderr.write(`render-review-page: status task unavailable for ${root} (rc ${res.status === null ? 'signal' : res.status})\n`);
    return null;
  }
  try { return { value: JSON.parse(res.stdout.toString('utf8')), sha256: sha256Of(res.stdout) }; } catch (_e) {
    process.stderr.write('render-review-page: status task output is not JSON\n');
    return null;
  }
}

// ---- publishing (row B1b) --------------------------------------------------------------------------------------
// Layout:  <out-root>/<date>/<job>/v-<compact published_at>/{index.html,model.json}   immutable versions
//          <out-root>/<date>/<job>/current -> v-...                                      atomic symlink
//          <out-root>/<date>/<job>/assets/<sha256[0:12]>.<ext>                           shared by all versions
//          <out-root>/index.html, <out-root>/project.json                                project index + its row data
//          <autopilot_home>/review/index.html                                            host root index
// Locks (flock(1), same `exec 9>lock; flock 9` form as src/status/runs-watch.js): project
// <live>/review/<project_key>.index.lock, then host <live>/review/root-index.lock (order is always project, host).
// The switch + index regeneration run in a child process started under the lock (Node has no flock).
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const VERSION = /^v-(\d{8})T(\d{6})\.(\d{3})Z$/;
const LOCK_WAIT_S = 60;
// Same shape as WRAPPER in src/status/runs-watch.js but a blocking wait: $1 lock, $2 wait seconds.
const LOCK_WRAPPER = 'exec 9>"$1" || exit 1; flock -w "$2" 9 || exit 75; shift 2; exec "$@"';

function compactOf(isoText) { return isoText.replace(/[-:]/g, ''); }
function versionMs(name) {
  const m = VERSION.exec(name);
  if (!m) return null;
  const d = m[1]; const t = m[2];
  return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${m[3]}Z`);
}
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function rmTree(p) { fs.rmSync(p, { recursive: true, force: true }); }
function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function smokeDir(dir, { requireSections }) {
  let html;
  try { html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); } catch (e) { return `index.html unreadable (${e.code || e.message})`; }
  if (!/<html[\s>]/.test(html) || !/<\/html>\s*$/.test(html)) return 'HTML does not parse (no <html>…</html>)';
  if (requireSections) {
    for (let n = 1; n <= 9; n += 1) if (!html.includes(`<section data-section="${n}"`)) return `section marker ${n} missing`;
  }
  for (const m of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (url === '' || url.startsWith('#')) continue;
    if (url.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return `non-relative URL ${url}`;
    const target = path.resolve(dir, decodeURIComponent(url.split('#')[0].split('?')[0]));
    if (!fs.existsSync(target)) return `referenced file missing: ${url}`;
  }
  return null;
}

function renderRootIndex(projects) {
  const list = [...(projects || [])].sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)) || String(a.project_key).localeCompare(String(b.project_key)));
  const rows = list.map((p) => `<tr>${td(`<a href="${esc(p.project_key)}/index.html">${esc(p.display_name || p.project_key)}</a>`)}${td(`<code>${esc(p.project_key)}</code>`)}${td(show(p.last_published_at))}${td(Number.isInteger(p.decisions_needed) ? esc(p.decisions_needed) : unknownSpan())}</tr>`);
  const body = `<h1>Review projects</h1>\n${list.length ? table(['project', 'project_key', 'last published_at', '需要你決定'], rows) : '<p class="muted">沒有 project。</p>'}`;
  return page('Review projects', body);
}

function readModelOf(jobDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(jobDir, 'current', 'model.json'), 'utf8'));
    return isObject(m) && isObject(m.axes) ? m : null;
  } catch (_e) { return null; }
}
function listJobs(outRoot) {
  const jobs = [];
  let dates = [];
  try { dates = fs.readdirSync(outRoot).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort(); } catch (_e) { return jobs; }
  for (const date of dates) {
    let names = [];
    try { names = fs.readdirSync(path.join(outRoot, date)).sort(); } catch (_e) { continue; }
    for (const job of names) jobs.push({ date, job, dir: path.join(outRoot, date, job) });
  }
  return jobs;
}

function regenProjectIndex({ outRoot, project, displayName }) {
  const models = [];
  for (const j of listJobs(outRoot)) { const m = readModelOf(j.dir); if (m) models.push(m); }
  const html = renderProjectIndex(models, { project });
  // candidate -> smoke -> tmp -> rename; links are relative to outRoot
  let problem = null;
  if (!/<html[\s>]/.test(html) || !html.includes('data-counts="two-axis"')) problem = 'two-axis count line missing';
  else for (const m of html.matchAll(/\bhref="([^"]*)"/g)) if (!fs.existsSync(path.join(outRoot, m[1]))) problem = `index link target missing: ${m[1]}`;
  if (problem) throw new Error(`project index smoke failed: ${problem}`);
  writeFileAtomic(path.join(outRoot, 'index.html'), html);
  const published = models.map((m) => m.published_at).filter(Boolean).sort();
  writeFileAtomic(path.join(outRoot, 'project.json'), `${JSON.stringify({
    schema: 'review-project/1', project_key: project, display_name: displayName || project,
    last_published_at: published.length ? published[published.length - 1] : null,
    decisions_needed: models.filter((m) => m.needs_decision).length,
  })}\n`);
}

function regenRootIndex({ home }) {
  const root = path.join(home, 'review');
  const projects = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch (_e) { /* no projects yet */ }
  for (const n of names.sort()) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(root, n, 'project.json'), 'utf8'));
      if (isObject(v) && v.schema === 'review-project/1' && typeof v.project_key === 'string' && SEGMENT.test(v.project_key) && v.project_key === n) projects.push(v);
    } catch (_e) { /* not a project dir */ }
  }
  const html = renderRootIndex(projects);
  for (const m of html.matchAll(/\bhref="([^"]*)"/g)) if (!fs.existsSync(path.join(root, m[1]))) throw new Error(`root index smoke failed: link target missing: ${m[1]}`);
  fs.mkdirSync(root, { recursive: true });
  writeFileAtomic(path.join(root, 'index.html'), html);
}

function cleanStaleCandidates(jobDir) {
  let names = [];
  try { names = fs.readdirSync(jobDir); } catch (_e) { return; }
  for (const n of names) {
    const m = /^v-.*\.cand-(\d+)$/.exec(n) || /^current\.tmp-(\d+)$/.exec(n);
    if (m && !pidAlive(Number(m[1]))) rmTree(path.join(jobDir, n));
  }
}

// The locked project step (runs in a child under the project lock).
function projectStep(p) {
  const { jobDir, outRoot, version, publishedAt } = p;
  cleanStaleCandidates(jobDir);
  const cand = p.cand;
  const current = path.join(jobDir, 'current');
  let curTarget = null;
  try { curTarget = fs.readlinkSync(current); } catch (_e) { /* first publish */ }
  let curMs = null;
  if (curTarget) {
    try { curMs = Date.parse(JSON.parse(fs.readFileSync(path.join(jobDir, curTarget, 'model.json'), 'utf8')).published_at); } catch (_e) { curMs = versionMs(curTarget); }
    if (!fs.existsSync(path.join(jobDir, curTarget))) { curTarget = null; curMs = null; }
  }
  if (curMs !== null && Number.isFinite(curMs) && curMs >= Date.parse(publishedAt)) {
    rmTree(cand);
    return { status: 'not_newer', current: curTarget };
  }
  const hold = Number(process.env.AUTOPILOT_REVIEW_HOLD_MS);
  if (Number.isFinite(hold) && hold > 0) sleepMs(hold);
  if (process.env.AUTOPILOT_REVIEW_FAIL_AT === 'before-switch') throw new Error('injected failure before switch (AUTOPILOT_REVIEW_FAIL_AT)');
  let oldSwitchMs = null;
  try { oldSwitchMs = fs.lstatSync(current).mtimeMs; } catch (_e) { /* none */ }
  const finalDir = path.join(jobDir, version);
  if (cand !== finalDir) { rmTree(finalDir); fs.renameSync(cand, finalDir); }
  const tmp = path.join(jobDir, `current.tmp-${process.pid}`);
  try { fs.unlinkSync(tmp); } catch (_e) { /* none */ }
  fs.symlinkSync(version, tmp);
  fs.renameSync(tmp, current);
  // keep new + previous; older ones only once >= retain ms after the switch that superseded them
  const retain = Number.isFinite(Number(process.env.AUTOPILOT_REVIEW_RETAIN_MS)) && process.env.AUTOPILOT_REVIEW_RETAIN_MS !== undefined && process.env.AUTOPILOT_REVIEW_RETAIN_MS !== ''
    ? Number(process.env.AUTOPILOT_REVIEW_RETAIN_MS) : 10 * 60 * 1000;
  const windowPassed = oldSwitchMs === null || Date.now() - oldSwitchMs >= retain;
  if (windowPassed) {
    for (const n of fs.readdirSync(jobDir)) {
      if (VERSION.test(n) && n !== version && n !== curTarget) rmTree(path.join(jobDir, n));
    }
  }
  // The switch has happened: a failure from here on is a warning, never "current unchanged".
  const warnings = [];
  try {
    if (process.env.AUTOPILOT_REVIEW_FAIL_AT === 'after-switch') throw new Error('injected failure after switch (AUTOPILOT_REVIEW_FAIL_AT)');
    regenProjectIndex({ outRoot, project: p.project, displayName: p.displayName });
  } catch (e) { warnings.push(`project index step failed: ${e.message}`); }
  try { hostStep(p); } catch (e) { warnings.push(`host root index step failed: ${e.message}`); }
  return warnings.length ? { status: 'published', version, warnings } : { status: 'published', version };
}

function reapStep(p) {
  const { outRoot, nowMs, days } = p;
  const cutoff = nowMs - days * 86400000;
  const out = { removed_jobs: 0, removed_versions: 0, removed_assets: 0 };
  for (const j of listJobs(outRoot)) {
    let names = [];
    try { names = fs.readdirSync(j.dir); } catch (_e) { continue; }
    cleanStaleCandidates(j.dir);
    const versions = names.filter((n) => VERSION.test(n));
    let target = null;
    try { target = fs.readlinkSync(path.join(j.dir, 'current')); } catch (_e) { /* none */ }
    const old = (n) => versionMs(n) < cutoff;
    if (versions.every(old)) { rmTree(j.dir); out.removed_jobs += 1; continue; }
    for (const n of versions) if (old(n) && n !== target) { rmTree(path.join(j.dir, n)); out.removed_versions += 1; }
    const referenced = new Set();
    for (const n of versions) {
      if (!fs.existsSync(path.join(j.dir, n))) continue;
      let html = '';
      try { html = fs.readFileSync(path.join(j.dir, n, 'index.html'), 'utf8'); } catch (_e) { continue; }
      for (const m of html.matchAll(/\.\.\/assets\/([A-Za-z0-9._-]+)/g)) referenced.add(m[1]);
    }
    let assets = [];
    try { assets = fs.readdirSync(path.join(j.dir, 'assets')); } catch (_e) { /* no assets */ }
    for (const a of assets) if (!referenced.has(a)) { rmTree(path.join(j.dir, 'assets', a)); out.removed_assets += 1; }
  }
  for (const date of fs.readdirSync(outRoot).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))) {
    try { fs.rmdirSync(path.join(outRoot, date)); } catch (_e) { /* not empty */ }
  }
  regenProjectIndex({ outRoot, project: p.project, displayName: p.displayName });
  hostStep(p);
  return { status: 'reaped', ...out };
}

function lockedArgv(lock, inner) {
  return ['-c', LOCK_WRAPPER, 'sh', lock, String(LOCK_WAIT_S), ...inner];
}
function hostStep(p) {
  const r = cp.spawnSync('sh', lockedArgv(p.hostLock, [process.execPath, __filename, '--internal', 'host']), {
    encoding: 'utf8', env: { ...process.env, AUTOPILOT_RRP_PAYLOAD: JSON.stringify({ home: p.home }) }, timeout: (LOCK_WAIT_S + 30) * 1000,
  });
  if (r.status !== 0) throw new Error(`host index step failed (rc ${r.status === null ? 'signal' : r.status}): ${(r.stderr || '').trim().split('\n').pop()}`);
}
function runLocked(p, op) {
  const r = cp.spawnSync('sh', lockedArgv(p.projectLock, [process.execPath, __filename, '--internal', op]), {
    encoding: 'utf8', env: { ...process.env, AUTOPILOT_RRP_PAYLOAD: JSON.stringify(p) }, timeout: (LOCK_WAIT_S * 2 + 60) * 1000,
  });
  if (r.status !== 0) {
    const last = ((r.stderr || '').trim().split('\n').pop()) || (r.status === 75 ? `lock wait timed out (${p.projectLock})` : `rc ${r.status}`);
    return { ok: false, message: last };
  }
  try { return { ok: true, result: JSON.parse(r.stdout) }; } catch (_e) { return { ok: false, message: 'locked step printed no result' }; }
}

function internalMain(op, env) {
  try {
    const payload = JSON.parse(env.AUTOPILOT_RRP_PAYLOAD);
    if (op === 'host') { regenRootIndex(payload); return 0; }
    const result = op === 'reap' ? reapStep(payload) : projectStep(payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`render-review-page: ${e.message}\n`);
    return 1;
  }
}

function copyAssets(compare, jobDir) {
  const dir = path.join(jobDir, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  for (const c of compare) {
    for (const im of Object.values(c.images || {})) {
      if (!im || im.missing) continue;
      const dest = path.join(dir, path.basename(im.rel_path));
      if (fs.existsSync(dest)) continue;
      // temp copy then rename: a reader (the review server) never sees a truncated asset
      const tmp = `${dest}.tmp-${process.pid}`;
      try { fs.copyFileSync(im.source, tmp); fs.renameSync(tmp, dest); } catch (e) { try { fs.unlinkSync(tmp); } catch (_e) { /* none */ } throw e; }
    }
  }
}

function displayNameOf(repo, projectKey) {
  const r = cp.spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0) return projectKey;
  const common = r.stdout.trim().replace(/\/+$/, '');
  const base = path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(common);
  return base || projectKey;
}

function envPaths(env) {
  const { pointerPath } = require('../src/status/live-pointer');
  const { resolveLiveDir } = require('./lib/live-state-dir');
  const home = path.dirname(pointerPath(env));
  const live = resolveLiveDir({ env, warn: () => {} }).base;
  return { home, liveReview: path.join(live, 'review') };
}

function publish({ model, html, compare, outRoot, home, liveReview, project, displayName, env }) {
  if (!SEGMENT.test(model.job || '') || !SEGMENT.test(model.date || '') || !SEGMENT.test(project || '')) {
    return { rc: 2, message: '--job, --date and --project must match [A-Za-z0-9._-]+' };
  }
  const { flockAvailable } = require('../src/status/runs-watch');
  if (!flockAvailable(env)) return { rc: 1, message: 'flock_unavailable: flock(1) (util-linux) is required on PATH; no lockfile fallback' };
  const jobDir = path.join(outRoot, model.date, model.job);
  const version = `v-${compactOf(model.published_at)}`;
  const cand = path.join(jobDir, `${version}.cand-${process.pid}`);
  try {
    fs.mkdirSync(liveReview, { recursive: true, mode: 0o700 });
    copyAssets(compare, jobDir);
    rmTree(cand);
    fs.mkdirSync(cand, { recursive: true });
    fs.writeFileSync(path.join(cand, 'index.html'), html);
    fs.writeFileSync(path.join(cand, 'model.json'), `${JSON.stringify(model)}\n`);
    const problem = smokeDir(cand, { requireSections: true });
    if (problem) return { rc: 1, message: `smoke failed, current unchanged: ${problem}` };
  } catch (e) {
    return { rc: 1, message: `build failed, current unchanged: ${e.message}` };
  }
  const r = runLocked({
    jobDir, outRoot, cand, version, publishedAt: model.published_at, project, displayName, home,
    projectLock: path.join(liveReview, `${project}.index.lock`), hostLock: path.join(liveReview, 'root-index.lock'),
  }, 'publish');
  if (!r.ok) return { rc: 1, message: `publish failed, current unchanged: ${r.message}` };
  return { rc: 0, result: { ...r.result, current: path.join(jobDir, 'current', 'index.html') } };
}

// The one path from loaded inputs to a model (the CLI and the watcher's --render both go through it):
// discovers the review receipts next to the manifests' ledgers, resolves the candidate commit, builds the model.
// `sources` is the caller's list so far (runs / task / progress / decision / planned / compare); receipts are appended.
function assemble(o) {
  const sources = o.sources || [];
  const reviewReceipts = discoverReviewReceipts(o.rows, o.root);
  for (const e of reviewReceipts) sources.push({ role: 'review_receipt', path: e.file, sha256: e.sha256 });
  for (const c of o.compare || []) if (c.sha256) sources.push({ role: 'compare_record', path: c.file, sha256: c.sha256 });
  let commit = o.commit || null;
  if (!commit) {
    const r = cp.spawnSync('git', ['-C', o.repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    commit = r.status === 0 ? r.stdout.trim() : null;
  }
  const model = buildJobModel({
    runs: o.runsValue, root: o.root, job: o.job, date: o.date, project: o.project,
    now: o.now, commit,
    taskReceipt: o.task ? o.task.value : null, progressReceipt: o.progress ? o.progress.value : null,
    reviewReceipts, compare: o.compare || [], decision: o.decision ? o.decision.value : null, planned: o.planned ? o.planned.value : null,
    isAncestor: gitIsAncestor(o.repo), sources,
  });
  return { model, reviewReceipts };
}

function parseArgs(argv) {
  const flags = {};
  const valued = new Set(['runs', 'root', 'task-receipt', 'progress-receipt', 'compare', 'decision', 'planned', 'job', 'date', 'project', 'repo', 'commit', 'now', 'out-root', 'days']);
  const bool = new Set(['print', 'reap', 'serve-stop']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--') && bool.has(a.slice(2))) flags[a.slice(2)] = true;
    else if (a.startsWith('--') && valued.has(a.slice(2))) {
      if (i + 1 >= argv.length) throw new Error(`${a} requires a value`);
      flags[a.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return flags;
}

// Full write to stdout even on a pipe (a single writeSync may be partial; process.exit would cut async output).
function writeAll(text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
  }
}

function resolveNow(flags, env) {
  const raw = flags.now || (env.AUTOPILOT_REVIEW_NOW ? env.AUTOPILOT_REVIEW_NOW : null);
  if (raw === null) return { ms: Date.now() };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { error: `unparseable time ${JSON.stringify(raw)} (${flags.now ? '--now' : 'AUTOPILOT_REVIEW_NOW'}); expected an ISO-8601 timestamp` };
  return { ms, raw };
}

function main(argv, env) {
  if (argv[0] === '--internal') return internalMain(argv[1], env);
  let flags;
  try { flags = parseArgs(argv); } catch (e) { process.stderr.write(`render-review-page: ${e.message}\n`); return 2; }
  if (flags['serve-stop']) {
    const { stopReviewServer } = require('../src/status/review-server');
    const r = stopReviewServer({ env });
    if (r.status === 'stopped' || r.status === 'not_running') { writeAll(`${JSON.stringify(r)}\n`); return 0; }
    process.stderr.write(`render-review-page: ${r.message || r.status}\n`);
    return 1;
  }
  const clock = resolveNow(flags, env);
  if (clock.error) { process.stderr.write(`render-review-page: ${clock.error}\n`); return 2; }
  if (flags.reap) return reapMain(flags, env, clock);
  for (const req of ['runs', 'job', 'date', 'project']) {
    if (!flags[req]) { process.stderr.write(`render-review-page: --${req} is required\n`); return 2; }
  }
  const runs = tryReadJson(flags.runs);
  if (!runs) { process.stderr.write(`render-review-page: cannot read --runs ${flags.runs}\n`); return 2; }
  const repo = flags.repo ? path.resolve(flags.repo) : process.cwd();
  const root = flags.root || null;
  const sources = [{ role: 'runs', path: path.resolve(flags.runs), sha256: runs.sha256 }];
  const rows = Array.isArray(runs.value) ? runs.value : (isObject(runs.value) && Array.isArray(runs.value.runs) ? runs.value.runs : []);

  let task = null;
  if (flags['task-receipt'] && flags['task-receipt'] !== 'none') {
    task = readExplicit('task-receipt', flags['task-receipt'], isObject);
    if (task) sources.push({ role: 'task_status_receipt', path: path.resolve(flags['task-receipt']), sha256: task.sha256 });
  } else if (!flags['task-receipt'] && root) {
    task = callTaskStatus(root, repo, env);
    if (task) sources.push({ role: 'task_status_receipt', path: `status task --root-run-id ${root} --json`, sha256: task.sha256 });
  }
  let progress = null;
  if (flags['progress-receipt']) {
    progress = readExplicit('progress-receipt', flags['progress-receipt'], isObject);
    if (progress) sources.push({ role: 'controller_progress_receipt', path: path.resolve(flags['progress-receipt']), sha256: progress.sha256 });
  }
  const decision = flags.decision ? readExplicit('decision', flags.decision, (v) => isObject(v) && typeof v.question === 'string') : null;
  if (decision) sources.push({ role: 'decision', path: path.resolve(flags.decision), sha256: decision.sha256 });
  const planned = flags.planned ? readExplicit('planned', flags.planned, Array.isArray) : null;
  if (planned) sources.push({ role: 'planned', path: path.resolve(flags.planned), sha256: planned.sha256 });
  const compare = flags.compare ? loadCompare(flags.compare) : [];
  const { model } = assemble({
    runsValue: runs.value, rows, root, job: flags.job, date: flags.date, project: flags.project, now: clock.ms, commit: flags.commit || null, repo,
    task, progress, decision, planned, compare, sources,
  });
  const html = renderJobHtml(model);
  if (flags.print) { writeAll(html); return 0; }
  const ep = envPaths(env);
  const outRoot = flags['out-root'] ? path.resolve(flags['out-root']) : path.join(ep.home, 'review', flags.project);
  const r = publish({ model, html, compare, outRoot, home: ep.home, liveReview: ep.liveReview, project: flags.project, displayName: displayNameOf(repo, flags.project), env });
  if (r.rc !== 0) { process.stderr.write(`render-review-page: ${r.message}\n`); return r.rc; }
  for (const w of r.result.warnings || []) process.stderr.write(`render-review-page: published; warning: ${w}\n`);
  writeAll(`${JSON.stringify(r.result)}\n`);
  return 0;
}

function reapMain(flags, env, clock) {
  if (!flags.project) { process.stderr.write('render-review-page: --project is required\n'); return 2; }
  if (!SEGMENT.test(flags.project)) { process.stderr.write('render-review-page: --project must match [A-Za-z0-9._-]+\n'); return 2; }
  const days = flags.days === undefined ? 90 : Number(flags.days);
  if (!Number.isFinite(days) || days < 0) { process.stderr.write(`render-review-page: --days must be a non-negative number, got ${flags.days}\n`); return 2; }
  const { flockAvailable } = require('../src/status/runs-watch');
  if (!flockAvailable(env)) { process.stderr.write('render-review-page: flock_unavailable: flock(1) (util-linux) is required on PATH\n'); return 1; }
  const ep = envPaths(env);
  const outRoot = flags['out-root'] ? path.resolve(flags['out-root']) : path.join(ep.home, 'review', flags.project);
  if (!fs.existsSync(outRoot)) { writeAll(`${JSON.stringify({ status: 'reaped', removed_jobs: 0, removed_versions: 0, removed_assets: 0 })}\n`); return 0; }
  fs.mkdirSync(ep.liveReview, { recursive: true, mode: 0o700 });
  const repo = flags.repo ? path.resolve(flags.repo) : process.cwd();
  const r = runLocked({
    outRoot, nowMs: clock.ms, days, project: flags.project, displayName: displayNameOf(repo, flags.project), home: ep.home,
    projectLock: path.join(ep.liveReview, `${flags.project}.index.lock`), hostLock: path.join(ep.liveReview, 'root-index.lock'),
  }, 'reap');
  if (!r.ok) { process.stderr.write(`render-review-page: reap failed: ${r.message}\n`); return 1; }
  writeAll(`${JSON.stringify(r.result)}\n`);
  return 0;
}

module.exports = {
  buildJobModel, renderJobHtml, renderProjectIndex, renderRootIndex, discoverReviewReceipts, loadCompare, publish, smokeDir, esc,
  assemble, callTaskStatus, displayNameOf, envPaths,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
