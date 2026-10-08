'use strict';

// src/status/decisions-sidecar.js — the decisions sidecar of the runs watcher (mods plan P1W WATCH-B, W2d publisher
// + W2g (b)(c)).
//
//   <live>/runs/<scope_key>.decisions.json   schema autopilot.decisions-sidecar/1   (does NOT extend runs-live/1)
//
// Sources (read-only, plain telemetry — nothing here verifies a ledger, ADR-0001):
//   ledger_default  <git-common-dir>/autopilot/ledger/decisions.jsonl                (W1h default per-repo ledger)
//   ledger_root     <git-common-dir>/autopilot/work-orders/<root>/decision-ledger.jsonl   (what `<campaign>` means in
//                   skills/ceo-agent/references/depth0-control-loop.md §6; owner ruling 2026-10-05)
// Row filter, both files: row.repo_identity === the watcher's repo_identity AND (row.root_run_id || null) === the scope's
// root (project-wide scope = root null = rows with no root; same convention as the per-root envelopes and the `unbound` job).
// Counted kinds: decision, dispatch, pick, refreeze (proxy decisions). veto/note/hypothesis/unknown/ladder are telemetry.
// P7 D2: the one telemetry fact the band shows is the escalation rung — `ladder: { rung: "U0".."U5", at } | null`, the latest
// kind:"ladder" row (by ts, later file order wins a tie; a row whose ts is missing or not an ISO date-time is ignored; `at` is the normalised ISO string) under the same repo+root filter. Ladder rows stay out of rows/count.
//
// Gap count (W2g b): runs (dispatch manifests) of this scope whose run_id has NO ledger row of kind === "dispatch" ->
// `undocumented_dispatches`. Same rule as scripts/check-blueprint-conformance.js audit `unlogged_decision`, evaluated
// against an independent source (manifests) so it cannot be self-satisfied. This module NEVER writes a ledger row.
//
// writers_wired: which ledger writers this plugin install ships ("engine" = W1h adjudication proxy decisions in
// src/engine/autopilot-engine.js; "next-pick" = scripts/next-pick.js default-ledger auto-pick append, PHASE+PICK row).
// Derived from the shipped files each call (file contains the writer's marker string), never hard-coded.

const fs = require('fs');
const path = require('path');

const SCHEMA = 'autopilot.decisions-sidecar/1';
const COUNTED_KINDS = new Set(['decision', 'dispatch', 'pick', 'refreeze']);
const IRREVERSIBLE = new Set(['one-way', 'irreversible']);
const PLUGIN_ROOT = path.join(__dirname, '..', '..');
const RUNG = /^U[0-5]$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;

function commonDirOf(identity) {
  const m = typeof identity === 'string' ? /^git-common-dir:(.+)$/.exec(identity) : null;
  return m ? m[1] : null;
}

// Plain JSONL read; malformed lines are skipped (a bad line never grants or removes anything).
function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object' && !Array.isArray(row)) out.push(row);
    } catch (_error) { /* skip */ }
  }
  return out;
}

function fileContains(rel, needle) {
  try { return fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8').includes(needle); } catch (_error) { return false; }
}

function writersWired() {
  const out = [];
  if (fileContains('src/engine/autopilot-engine.js', 'recordAdjudicationProxyDecisions')) out.push('engine');
  // PHASE+PICK row: the implicit (marker/env-gated) append is the one that reads AUTOPILOT_ROOT_RUN_ID.
  if (fileContains('scripts/next-pick.js', 'AUTOPILOT_ROOT_RUN_ID')) out.push('next-pick');
  return out;
}

function writerOf(row) {
  if (typeof row.writer === 'string' && row.writer) return row.writer;
  if (row.class === 'adjudication') return 'engine';
  if (row.kind === 'pick') return 'next-pick';
  return 'depth0';
}

function decisionText(row) {
  for (const k of ['rationale', 'row_title', 'reason']) {
    if (typeof row[k] === 'string' && row[k].trim()) return row[k];
  }
  return typeof row.decision_id === 'string' && row.decision_id ? row.decision_id : row.kind;
}

function toSidecarRow(row, source) {
  return {
    round: Number.isFinite(row.round) ? row.round : null,
    decision: decisionText(row),
    irreversible: IRREVERSIBLE.has(row.reversibility),
    at: typeof row.ts === 'string' ? row.ts : null,
    writer: writerOf(row),
    kind: row.kind,
    decision_id: typeof row.decision_id === 'string' ? row.decision_id : null,
    source,
  };
}

/**
 * Pure builder.
 *   ledgers: [{ source: 'ledger_default'|'ledger_root', rows: [...] }]  (already read, any root)
 *   runs: the watcher's run rows (manifest-backed; run_id + root_run_id)
 * -> the sidecar object.
 */
function buildDecisionsSidecar({ scope, ledgers, runs, wired = writersWired() }) {
  const root = scope.root_run_id || null;
  const mine = [];
  const dispatchLogged = new Set();
  let ladder = null;
  let ladderMs = -Infinity;
  for (const { source, rows } of ledgers) {
    for (const row of rows) {
      if (row.repo_identity !== scope.repo_identity) continue;
      if ((row.root_run_id || null) !== root) continue;
      if (row.kind === 'dispatch' && typeof row.run_id === 'string') dispatchLogged.add(row.run_id);
      if (COUNTED_KINDS.has(row.kind)) mine.push(toSidecarRow(row, source));
      if (row.kind === 'ladder' && typeof row.rung === 'string' && RUNG.test(row.rung) && typeof row.ts === 'string' && ISO_TS.test(row.ts)) {
        const ms = Date.parse(row.ts);
        if (Number.isFinite(ms) && ms >= ladderMs) { ladderMs = ms; ladder = { rung: row.rung, at: new Date(ms).toISOString() }; }
      }
    }
  }
  mine.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  const manifests = runs.filter((r) => (r.root_run_id || null) === root && typeof r.run_id === 'string' && r.run_id);
  const undocumented = manifests.filter((r) => !dispatchLogged.has(r.run_id)).length;
  return {
    schema: SCHEMA,
    scope: { project_key: scope.project_key, repo_identity: scope.repo_identity, root_run_id: root },
    rows: mine,
    count: mine.length,
    irreversible_count: mine.filter((r) => r.irreversible).length,
    writers_wired: wired,
    undocumented_dispatches: undocumented,
    ladder,
  };
}

/**
 * Watcher-side publisher. publish({ runs, roots, nowMs }) writes one sidecar per scope (null + every root) next to the
 * envelopes, only when the text changed (or the file vanished). Ledger files are read once per call, cached by stat.
 */
function createDecisionsPublisher({ runsDir, key, getIdentity, writeAtomic, safeSegment, log = () => {} }) {
  const fileCache = new Map(); // file -> { sig, rows }
  const lastText = new Map(); // scopeKey -> text

  function cachedRows(file) {
    let st;
    try { st = fs.statSync(file); } catch (_error) { fileCache.delete(file); return []; }
    const sig = `${st.mtimeMs}:${st.size}`;
    const hit = fileCache.get(file);
    if (hit && hit.sig === sig) return hit.rows;
    const rows = readJsonl(file);
    fileCache.set(file, { sig, rows });
    return rows;
  }

  function publish({ runs, roots }) {
    const identity = getIdentity();
    const common = commonDirOf(identity);
    if (!common) return; // not in a git repo: nothing to read, nothing to claim
    const wired = writersWired();
    const defaultRows = cachedRows(path.join(common, 'autopilot', 'ledger', 'decisions.jsonl'));
    for (const root of [null, ...roots]) {
      const scopeKey = root === null ? key : `${key}--${safeSegment(root)}`;
      const ledgers = [{ source: 'ledger_default', rows: defaultRows }];
      if (root !== null && SAFE_ROOT.test(root) && root !== '.' && root !== '..') {
        ledgers.push({ source: 'ledger_root', rows: cachedRows(path.join(common, 'autopilot', 'work-orders', root, 'decision-ledger.jsonl')) });
      }
      const sidecar = buildDecisionsSidecar({
        scope: { project_key: key, repo_identity: identity, root_run_id: root }, ledgers, runs, wired,
      });
      const text = `${JSON.stringify(sidecar, null, 2)}\n`;
      const file = path.join(runsDir, `${scopeKey}.decisions.json`);
      if (lastText.get(scopeKey) === text && fs.existsSync(file)) continue;
      try { writeAtomic(file, text); lastText.set(scopeKey, text); } catch (error) { log(`decisions sidecar write failed for ${scopeKey}: ${error.message}`); }
    }
  }

  return { publish };
}

module.exports = { SCHEMA, buildDecisionsSidecar, createDecisionsPublisher, writersWired, readJsonl, COUNTED_KINDS };
