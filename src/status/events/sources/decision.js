'use strict';

// src/status/events/sources/decision.js - reader of kind `decision.row` (autopilot.events/1, plan E2 step 6).
//
//   read(ctx, window) -> { events, warnings, stats, files }       never throws, read-only
//   ctx    = { project:{project_key, repo_identity, repo_name, root, common_dir}, env, home, now }
//   window = { sinceTs, slackMs, hints }                          hints: {"decision:<12 hex head>": byte offset}
//
// Files: <git-common-dir>/autopilot/ledger/decisions.jsonl (absent: state `absent`, no warning: a fresh repo is normal) and
// <git-common-dir>/autopilot/work-orders/<root>/decision-ledger.jsonl (optional candidates, silent). Rows per the header of
// scripts/decision-ledger.js. Filter: row.repo_identity must equal the project's (a row without it is included: the files live
// inside this repo's own common dir). A row needs a string `kind` (else schema_mismatch) and a strict RFC 3339 `ts` (else
// ts_invalid). Unknown kinds are kept verbatim as row_kind. rationale is redacted, then capped at 240 characters (the last one
// is an ellipsis when it was cut). basis is always `self_reported` (the ledger has no authenticated writer, ADR-0001).
// id = `<decision_id|target_decision_id>:<kind>:` + sha256(canonical row)[0:12], else sha256(canonical row)[0:24]; byte-identical
// rows collapse into one event (documented under-count). Each event carries a non-enumerable `_src` = {source, file, head, offset,
// end} for the E3 hint computation.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readLines, windowFloorMs } = require('../jsonl-tail');
const { parseInstant, parseInstantMs } = require('../instant');
const { canonical } = require('../../../../scripts/validate-json-schema');
const { createCollector } = require('../collector');
const { redactText } = require('../redact');

const SOURCE = 'decision';
const RATIONALE_MAX = 240;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v !== '';

function cap(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function commonDirOf(project) {
  const dir = project && project.common_dir;
  return typeof dir === 'string' && dir !== '' ? dir : null;
}

function read(ctx = {}, window = {}) {
  const events = createCollector(window);
  const files = [];
  const warnings = new Map();
  const stats = { state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 };
  const warn = (code, detail, count = 1) => {
    const key = `${code}\u0000${detail}`;
    const hit = warnings.get(key);
    if (hit) hit.count += count; else warnings.set(key, { source: SOURCE, code, detail, count });
    stats.state = 'degraded';
  };
  try {
    const project = ctx.project || {};
    const commonDir = commonDirOf(project);
    if (!commonDir) { stats.state = 'absent'; return finish(); }
    const floor = windowFloorMs(window);
    const ledgerRoot = path.join(commonDir, 'autopilot');
    const defaultLedger = path.join(ledgerRoot, 'ledger', 'decisions.jsonl');
    const candidates = [{ file: defaultLedger, optional: false }];
    try {
      const orders = path.join(ledgerRoot, 'work-orders');
      for (const entry of fs.readdirSync(orders, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (entry.isDirectory()) candidates.push({ file: path.join(orders, entry.name, 'decision-ledger.jsonl'), optional: true });
      }
    } catch (_error) { /* no work orders: nothing to add */ }

    const seen = new Set();
    let anyFile = false;
    for (const candidate of candidates) {
      const res = readLines(candidate.file, { parse: true, hints: window.hints, hintPrefix: SOURCE, onLine: (line, info) => {
        try { handle(line, candidate.file, info.head); } catch (_error) { stats.rows_skipped += 1; }
      } });
      if (res.state === 'absent') { if (candidate.optional) stats.rows_filtered += 1; continue; }
      anyFile = true;
      for (const w of res.warnings) warn(w.code, w.detail, w.count);
      if (res.state === 'unreadable') { stats.state = 'degraded'; continue; }
      files.push({ key: `${SOURCE}:${res.head}`, file: candidate.file, size: res.size, head: res.head, startOffset: res.startOffset, endOffset: res.endOffset });
    }
    if (!anyFile) stats.state = 'absent';

    function handle(line, file, head) {
      stats.rows_read += 1;
      const base = path.basename(file);
      if (line.bad) { stats.rows_skipped += 1; return; } // line_unparseable already counted by readLines
      const row = line.value;
      if (!isObj(row) || typeof row.kind !== 'string' || row.kind === '') { stats.rows_skipped += 1; warn('schema_mismatch', base || 'decisions.jsonl'); return; }
      if (nonEmptyString(row.repo_identity) && row.repo_identity !== project.repo_identity) { stats.rows_filtered += 1; return; }
      const ts = typeof row.ts === 'string' ? parseInstant(row.ts) : null;
      if (ts === null) { stats.rows_skipped += 1; warn('ts_invalid', base || 'decisions.jsonl'); return; }
      const canon = canonical(row);
      const digest = sha(canon);
      const idOf = nonEmptyString(row.decision_id) ? row.decision_id : (nonEmptyString(row.target_decision_id) ? row.target_decision_id : null);
      const key = idOf ? `${idOf}:${row.kind}:${digest.slice(0, 12)}` : digest.slice(0, 24);
      if (seen.has(key)) { stats.rows_filtered += 1; return; } // a byte-identical row: one event
      seen.add(key);
      if (floor !== null && parseInstantMs(ts) < floor) return;

      const data = { basis: 'self_reported', row_kind: row.kind };
      if (typeof row.decision_id === 'string') data.decision_id = row.decision_id;
      if (Number.isInteger(row.round)) data.round = row.round;
      if (typeof row.class === 'string') data.class = row.class;
      if (typeof row.reversibility === 'string') data.reversibility = row.reversibility;
      if (typeof row.rationale === 'string') {
        const red = redactText(row.rationale); // redact the whole text, then cap: a token cut at the cap would escape its length threshold
        stats.redactions += red.redactions;
        data.rationale = cap(red.text, RATIONALE_MAX);
      }
      if (typeof row.target_decision_id === 'string') data.target_decision_id = row.target_decision_id;
      if (typeof row.rung === 'string') data.rung = row.rung;
      if (typeof row.result === 'string') data.result = row.result;
      const event = {
        id: `decision.row:${key}`, kind: 'decision.row', ts, ts_basis: 'source', source: 'decision_ledger',
        project_key: project.project_key, root_run_id: nonEmptyString(row.root_run_id) ? row.root_run_id : null,
        run_id: nonEmptyString(row.run_id) ? row.run_id : null, data,
      };
      Object.defineProperty(event, '_src', {
        value: { source: SOURCE, file, head, offset: line.offset, end: line.end }, enumerable: false,
      });
      events.push(event);
    }
  } catch (error) {
    warn('source_failed', error && error.name ? error.name : 'Error');
  }
  return finish();

  function finish() {
    return { ...events.result(), warnings: [...warnings.values()], stats, files };
  }
}

module.exports = { read, SOURCE };
