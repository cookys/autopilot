'use strict';

// src/status/events/sources/cost.js - reader of kind `cost.turn` (autopilot.events/1, plan E2 step 2).
//
//   read(ctx, window) -> { events, warnings, stats, files }       never throws, read-only
//   ctx    = { project:{project_key, repo_identity, cwd?,...}, env, home, now }
//   window = { sinceTs, slackMs, hints }                          hints: {"cost:<12 hex head>": byte offset}
//
// Source: the costs file (scripts/lib/brain-spend.js:costsFileOf), rows as hooks/cost-tracker.js writes them. cost-tracker appends a
// whole transcript delta per Stop, so a row can carry a `ts` earlier than rows already read: the reader never assumes ts order and
// applies the window slack (floor = sinceTs - slackMs; an older event is dropped, lines are still counted). Subagent rows
// (sidechain:true) are events; brain-spend.js:isSubagentRow is deliberately NOT used.
//
// Project filter (host-wide file): `cwd` -> `git rev-parse --git-common-dir`, compared with project.repo_identity, memoised per
// distinct cwd INSIDE one read() call (no module-level state). A cwd that no longer exists is matched by path prefix against the
// project's worktrees (`git worktree list --porcelain` + the `worktree` field of this project's dispatch manifests), so rows of a
// reaped dispatch worktree stay in the feed. Anything else (other repos, their deleted worktrees, a row without cwd) is counted in
// stats.rows_filtered only: no warning, no state change.
//
// id = `cost.turn:` + sha256(raw line)[0:24] + `#n`, n = 1-based ordinal of this line among byte-identical lines counted from the START OF
// THIS READ (the counter is local to the call). An absent token field counts as 0 (rows older than the cache fields); a wrong type is
// schema_mismatch. A git resolution that FAILS (missing, timeout, dubious ownership, broken .git; as opposed to "not a repository") is one aggregated
// warning `git_unavailable` per read, state degraded; the cwd then falls back to the worktree-prefix match. An absent costs file is state `absent` with one aggregated source_absent warning (a configured source).
// Events carry a non-enumerable `_src` = {source, file, head, offset, end} for the E3 hint computation.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { readLines, windowFloorMs } = require('../jsonl-tail');
const { parseInstant, parseInstantMs } = require('../instant');
const { costsFileOf } = require('../../../../scripts/lib/brain-spend');
const { tierOf } = require('../../../../scripts/cost-digest');
const { runsDir } = require('../../../../scripts/lib/runtime-paths');
const { cleanGitEnv } = require('../../git-env');

const SOURCE = 'cost';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonNegInt = (v) => Number.isInteger(v) && v >= 0;

function hasDotGitUp(dir) {
  for (let here = path.resolve(dir); ; here = path.dirname(here)) {
    try { fs.lstatSync(path.join(here, '.git')); return true; } catch (_error) { /* none here */ }
    if (path.dirname(here) === here) return false;
  }
}

function commonDirOf(project) {
  const id = project && project.repo_identity;
  return typeof id === 'string' && id.startsWith('git-common-dir:') ? id.slice('git-common-dir:'.length) : null;
}

// One matcher per read() call: owns the cwd memo and the lazily built worktree-prefix list.
function makeProjectMatcher(project, env, onGitMissing) {
  // Fixed C locale: the "not a repository" message below is matched as text. Local to this reader (cleanGitEnv is shared).
  const gitEnv = { ...cleanGitEnv(env), LC_ALL: 'C', LANGUAGE: '' };
  const memo = new Map();
  let prefixes = null;
  const git = (args, cwd) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });

  function worktreePrefixes() {
    if (prefixes) return prefixes;
    prefixes = [];
    const commonDir = commonDirOf(project);
    if (commonDir) {
      try {
        for (const line of git([`--git-dir=${commonDir}`, 'worktree', 'list', '--porcelain'], undefined).split('\n')) {
          if (line.startsWith('worktree ')) prefixes.push(path.resolve(line.slice('worktree '.length)));
        }
      } catch (_error) { onGitMissing(); }
    }
    try {
      const dir = runsDir(env);
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.manifest.json') || name.startsWith('panel-')) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
          if (isObj(manifest) && manifest.repo_identity === project.repo_identity && typeof manifest.worktree === 'string' && path.isAbsolute(manifest.worktree)) {
            prefixes.push(path.resolve(manifest.worktree));
          }
        } catch (_error) { /* the dispatch reader owns manifest corruption */ }
      }
    } catch (_error) { /* no runs dir: only git's list */ }
    return prefixes;
  }

  // -> identity string, null (git says exactly "not a git repository (or any of the parent directories)": discovery found no
  // repository, a definite "other project"), or undefined (resolution FAILED: git missing, timeout, dubious ownership, a broken
  // .git whose message carries a quoted path, any other exit 128, an empty answer; reported once per read via onGitMissing).
  function identityOf(cwd) {
    try {
      const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim();
      if (common) return `git-common-dir:${fs.realpathSync(common)}`;
    } catch (error) {
      // A `.git` directory without HEAD gives the very same text as "no repository" (git skips it and walks up), so a `.git`
      // entry on the way up proves the answer is a failure, not an "other project".
      if (error && error.status === 128 && /not a git repository \(or any of the parent directories\)/.test(String(error.stderr || '')) && !hasDotGitUp(cwd)) return null;
    }
    onGitMissing();
    return undefined;
  }

  return function matches(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
    if (memo.has(cwd)) return memo.get(cwd);
    let verdict;
    let exists = false;
    try { exists = fs.statSync(cwd).isDirectory(); } catch (_error) { exists = false; }
    if (exists) {
      const identity = identityOf(cwd);
      if (identity === undefined) {
        // resolution failed: the manifest/worktree prefix list may still place the cwd in this project
        const here = path.resolve(cwd);
        verdict = worktreePrefixes().some((wt) => here === wt || here.startsWith(`${wt}/`));
      } else {
        verdict = identity === project.repo_identity;
      }
    } else {
      const here = path.resolve(cwd);
      verdict = worktreePrefixes().some((wt) => here === wt || here.startsWith(`${wt}/`));
    }
    memo.set(cwd, verdict);
    return verdict;
  };
}

function read(ctx = {}, window = {}) {
  const events = [];
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
    const env = ctx.env || process.env;
    const file = costsFileOf({ env, home: ctx.home });
    const name = path.basename(file);
    const floor = windowFloorMs(window);
    let gitMissing = false;
    const matches = makeProjectMatcher(project, env, () => { gitMissing = true; });
    const ordinals = new Map(); // byte-identical line -> how many seen so far IN THIS CALL (the `#n` rule)

    const res = readLines(file, { parse: true, hints: window.hints, hintPrefix: SOURCE, onLine: (line, info) => {
      try {
        stats.rows_read += 1;
        if (line.bad) { stats.rows_skipped += 1; return; } // line_unparseable already counted by readLines
        const row = line.value;
        if (!isObj(row)) { stats.rows_skipped += 1; warn('schema_mismatch', name); return; }
        if (!matches(row.cwd)) { stats.rows_filtered += 1; return; }
        const tokens = {};
        for (const field of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
          const value = row[field] === undefined ? 0 : row[field];
          if (!nonNegInt(value)) { stats.rows_skipped += 1; warn('schema_mismatch', name); return; }
          tokens[field] = value;
        }
        if (typeof row.session !== 'string' || typeof row.model !== 'string' || typeof row.cost_usd !== 'number' || !(row.cost_usd >= 0) || !Number.isFinite(row.cost_usd)) {
          stats.rows_skipped += 1; warn('schema_mismatch', name); return;
        }
        const ts = typeof row.ts === 'string' ? parseInstant(row.ts) : null;
        if (ts === null) { stats.rows_skipped += 1; warn('ts_invalid', name); return; }
        const digest = sha(line.raw).slice(0, 24);
        const n = (ordinals.get(digest) || 0) + 1;
        ordinals.set(digest, n);
        if (floor !== null && parseInstantMs(ts) < floor) return;
        const data = {
          session: row.session, model: row.model, tier: tierOf(row.model), ...tokens, cost_usd: row.cost_usd, sidechain: row.sidechain === true,
        };
        if (typeof row.agent_id === 'string') data.agent_id = row.agent_id;
        const event = {
          id: `cost.turn:${digest}#${n}`, kind: 'cost.turn', ts, ts_basis: 'source', source: 'costs',
          project_key: project.project_key, root_run_id: null, run_id: null, data,
        };
        Object.defineProperty(event, '_src', { value: { source: SOURCE, file, head: info.head, offset: line.offset, end: line.end }, enumerable: false });
        events.push(event);
      } catch (_error) { stats.rows_skipped += 1; }
    } });

    for (const w of res.warnings) warn(w.code, w.detail, w.count);
    if (res.state === 'absent') {
      stats.state = 'absent';
      warn('source_absent', name);
      stats.state = 'absent';
    } else if (res.state === 'unreadable') {
      stats.state = 'degraded';
    } else {
      files.push({ key: `${SOURCE}:${res.head}`, file, size: res.size, head: res.head, startOffset: res.startOffset, endOffset: res.endOffset });
    }
    if (gitMissing) warn('git_unavailable', 'git');
  } catch (error) {
    warn('source_failed', error && error.name ? error.name : 'Error');
  }
  return { events, warnings: [...warnings.values()], stats, files };
}

module.exports = { read, SOURCE };
