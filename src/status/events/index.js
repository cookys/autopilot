'use strict';

// src/status/events/index.js - assembles the events feed envelope (autopilot.events/1, plan E3 "index.js").
//
//   collectEvents({ cwd, env, home, now, since, limit, kinds, projectKey, reviewLedgers, deps }) -> envelope | error object
//
//   since          undefined | 0 | '0' (from the start) | an ISO instant | a cursor string
//   limit          page size, default 1000, 1..10000
//   kinds          array of kind names (or a comma list) or empty = all
//   projectKey     optional --project value; must equal the key of cwd's own repository
//   reviewLedgers  the repeated --review-ledger values (configured review roots)
//   deps           test seam: { resolveProject, readers, loadReader, mergePage, encodeCursor, buildEnvelope, now }
//
// Returns the envelope, or the second top-level shape {schema, error:{code}} for exit 2 (`project_unresolved`, `project_mismatch`,
// `bad_cursor`); exitCodeOf(result) says which. Project and failure rules (docs/dev/events-contract.md):
//  (1) a project that cannot be resolved is exit 2 `project_unresolved`;
//  (2) a reader problem is a warning in the envelope (each reader runs in its own try/catch: `source_failed`, state degraded);
//  (3) anything else (merge, cursor encode, envelope build) is caught by the outer catch: events [], has_more false, the INPUT cursor
//      returned unchanged, every source degraded, one warning `internal_error` (error name only, no stack and no path).
// Read-only: nothing here writes to a source or to the repository.
//
// ctx.project, the one shape every reader gets: { project_key, repo_identity, repo_name, root, common_dir }.
// Test fault injection: AUTOPILOT_EVENTS_TEST_FAULT=merge|cursor|envelope, honoured only when AUTOPILOT_TEST_ALLOW_EVENTS_FAULT=1.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { cleanGitEnv } = require('../git-env');
const { projectKey: projectKeyOf } = require('../project-key');
const { parseInstantMs } = require('./instant');
const cursorLib = require('./cursor');
const mergeLib = require('./merge');

const SCHEMA = 'autopilot.events/1';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;
const CAP_BUFFER = 64;
const SOURCE_NAMES = ['dispatch', 'cost', 'review', 'qc', 'decision', 'runledger'];
const STATES = new Set(['ok', 'absent', 'degraded']);

// Readers are loaded lazily, one at a time inside runReader's try: a reader module that fails to load is that source's `source_failed`.
const loadReaderDefault = (name) => require(`./sources/${name}`);

const errorObject = (code) => ({ schema: SCHEMA, error: { code } });
const exitCodeOf = (result) => (result && result.error ? 2 : 0);
const natural = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const errorName = (error) => (error && typeof error.name === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(error.name) ? error.name : 'Error');

// -> the unified ctx.project, or null when cwd is not inside a git repository / git cannot answer.
function resolveProject({ cwd, env }) {
  const gitEnv = { ...cleanGitEnv(env), LC_ALL: 'C' };
  const git = (args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common) return null;
    const commonDir = fs.realpathSync(common);
    const repoIdentity = `git-common-dir:${commonDir}`;
    let root = null;
    try { root = git(['rev-parse', '--show-toplevel']) || null; } catch (_error) { root = null; } // a bare repo has no work tree
    if (root) { try { root = fs.realpathSync(root); } catch (_error) { /* keep as given */ } }
    const repoName = path.basename(commonDir) === '.git' ? path.basename(path.dirname(commonDir)) : (root ? path.basename(root) : path.basename(commonDir));
    return { project_key: projectKeyOf(repoIdentity), repo_identity: repoIdentity, repo_name: repoName, root, common_dir: commonDir };
  } catch (_error) {
    return null;
  }
}

function parseSince(since, projectKey) {
  if (since === undefined || since === null || since === 0 || since === '0' || since === '') return { state: cursorLib.syntheticCursor(0, projectKey), text: null };
  if (typeof since === 'string') {
    const ms = parseInstantMs(since);
    if (ms !== null) return { state: cursorLib.syntheticCursor(ms, projectKey), text: null };
    return { state: cursorLib.decodeCursor(since, projectKey), text: since };
  }
  throw new cursorLib.CursorError('bad_cursor');
}

function normaliseKinds(kinds) {
  if (typeof kinds === 'string') return kinds.split(',').map((k) => k.trim()).filter(Boolean);
  return Array.isArray(kinds) ? kinds.filter((k) => typeof k === 'string' && k !== '') : [];
}

function normaliseWarning(w, fallbackSource) {
  if (!w || typeof w !== 'object') return null;
  const count = Number.isInteger(w.count) && w.count >= 1 ? w.count : 1;
  return { source: typeof w.source === 'string' ? w.source : fallbackSource, code: typeof w.code === 'string' ? w.code : 'source_failed', detail: typeof w.detail === 'string' ? w.detail : '', count };
}

// One reader, in its own try/catch. -> { name, events, files, warnings, stat }
function runReader(name, loadReader, ctx, window) {
  const warnings = [];
  try {
    const reader = loadReader(name);
    const res = reader.read(ctx, window);
    if (!res || typeof res !== 'object' || !res.stats || typeof res.stats !== 'object') throw new TypeError('BadReaderResult');
    for (const w of Array.isArray(res.warnings) ? res.warnings : []) {
      const norm = normaliseWarning(w, name);
      if (norm) warnings.push(norm);
    }
    return {
      name,
      events: Array.isArray(res.events) ? res.events : [],
      bounded: res.bounded && typeof res.bounded === 'object' ? res.bounded : null,
      files: Array.isArray(res.files) ? res.files : [],
      warnings,
      stat: {
        name,
        state: STATES.has(res.stats.state) ? res.stats.state : 'degraded',
        rows_read: natural(res.stats.rows_read),
        rows_skipped: natural(res.stats.rows_skipped),
        rows_filtered: natural(res.stats.rows_filtered),
        redactions: natural(res.stats.redactions),
      },
    };
  } catch (error) {
    warnings.push({ source: name, code: 'source_failed', detail: errorName(error), count: 1 });
    return { name, events: [], files: [], bounded: null, warnings, stat: { name, state: 'degraded', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 } };
  }
}

function buildEnvelope({ generatedAt, project, events, cursor, hasMore, sources, warnings }) {
  return {
    schema: SCHEMA,
    generated_at: generatedAt,
    project: { project_key: project.project_key, repo_name: project.repo_name },
    events,
    cursor,
    has_more: hasMore,
    sources,
    warnings,
  };
}

function fallbackEnvelope({ generatedAt, project, cursor, error }) {
  return buildEnvelope({
    generatedAt,
    project,
    events: [],
    cursor,
    hasMore: false,
    sources: SOURCE_NAMES.map((name) => ({ name, state: 'degraded', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 })),
    warnings: [{ source: 'index', code: 'internal_error', detail: errorName(error), count: 1 }],
  });
}

function collectEvents(opts = {}) {
  const env = opts.env || process.env;
  const deps = opts.deps || {};
  const faultOn = (name) => env.AUTOPILOT_TEST_ALLOW_EVENTS_FAULT === '1' && env.AUTOPILOT_EVENTS_TEST_FAULT === name;
  const nowMs = () => {
    const raw = typeof deps.now === 'function' ? deps.now() : (opts.now !== undefined ? opts.now : Date.now());
    return Number.isFinite(raw) ? raw : Date.now();
  };

  let project = null;
  try {
    project = (deps.resolveProject || resolveProject)({ cwd: opts.cwd || process.cwd(), env });
  } catch (_error) {
    project = null;
  }
  if (!project || typeof project.project_key !== 'string') return errorObject('project_unresolved');
  if (typeof opts.projectKey === 'string' && opts.projectKey !== '' && opts.projectKey !== project.project_key) return errorObject('project_mismatch');

  let input;
  try {
    input = parseSince(opts.since, project.project_key);
  } catch (_error) {
    return errorObject('bad_cursor');
  }
  // the cursor a failure or an empty page returns: the text the caller passed, else the synthetic cursor that value decodes to
  const inputCursor = input.text !== null ? input.text : cursorLib.encodeCursor(input.state);

  let generatedAt;
  try {
    generatedAt = new Date(nowMs()).toISOString();
  } catch (_error) {
    generatedAt = new Date().toISOString();
  }

  try {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, MAX_LIMIT) : DEFAULT_LIMIT;
    const kinds = normaliseKinds(opts.kinds);
    const loadReader = typeof deps.loadReader === 'function' ? deps.loadReader
      : (deps.readers ? (name) => { if (!deps.readers[name]) throw new Error('NoReader'); return deps.readers[name]; } : loadReaderDefault);
    const ctx = {
      project, env, home: opts.home || env.HOME, now: nowMs(),
      reviewLedgers: Array.isArray(opts.reviewLedgers) ? opts.reviewLedgers.filter((d) => typeof d === 'string' && d !== '') : [],
    };
    // The bounded collector of every reader (collector.js): keep = the cursor filter and --kinds, cap = limit plus a small buffer.
    const delivered = new Set(input.state.w.map((pair) => pair[0]));
    const floor = cursorLib.floorOf(input.state);
    const kindSet = kinds.length > 0 ? new Set(kinds) : null;
    const keep = (event) => {
      const tsMs = Date.parse(event.ts);
      if (!(tsMs >= floor) || delivered.has(cursorLib.idHash(event.id))) return false;
      if (input.state.e && tsMs === input.state.e[0] && event.id <= input.state.e[1]) return false;
      return kindSet === null || kindSet.has(event.kind);
    };
    const window = { sinceTs: floor, slackMs: 0, hints: input.state.h, keep, cap: limit + CAP_BUFFER };

    const ran = SOURCE_NAMES.map((name) => runReader(name, loadReader, ctx, window));

    if (faultOn('merge')) throw new Error('InjectedMergeFault');
    const merged = (deps.mergePage || mergeLib.mergePage)({
      results: ran.map((r) => ({ events: r.events, files: r.files, bounded: r.bounded })), cursor: input.state, kinds, limit, projectKey: project.project_key,
    });

    let cursor = inputCursor;
    if (!merged.empty) {
      if (faultOn('cursor')) throw new Error('InjectedCursorFault');
      cursor = (deps.encodeCursor || cursorLib.encodeCursor)(merged.state);
    }

    const warnings = [];
    for (const r of ran) warnings.push(...r.warnings);
    for (const w of merged.warnings) warnings.push(w);

    if (faultOn('envelope')) throw new Error('InjectedEnvelopeFault');
    return (deps.buildEnvelope || buildEnvelope)({
      generatedAt, project, events: merged.events, cursor, hasMore: merged.hasMore, sources: ran.map((r) => r.stat), warnings,
    });
  } catch (error) {
    try {
      return fallbackEnvelope({ generatedAt, project, cursor: inputCursor, error });
    } catch (_inner) {
      return {
        schema: SCHEMA, generated_at: generatedAt, project: { project_key: project.project_key, repo_name: String(project.repo_name || '') },
        events: [], cursor: inputCursor, has_more: false, sources: [], warnings: [{ source: 'index', code: 'internal_error', detail: 'Error', count: 1 }],
      };
    }
  }
}

module.exports = { collectEvents, resolveProject, exitCodeOf, SOURCE_NAMES, SCHEMA, DEFAULT_LIMIT, MAX_LIMIT };
