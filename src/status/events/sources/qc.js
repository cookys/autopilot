'use strict';

// src/status/events/sources/qc.js - git `QC-Verdict` trailers -> `qc.verdict` (autopilot.events/1).
//
// read(ctx, window) -> { events, warnings, stats }
//   ctx    = { project: { project_key, repo_identity, repo_name, root, common_dir }, env, home, now }
//   window = { sinceTs (epoch ms | ISO | null), slackMs, hints }
// One `git log --branches HEAD` of the project through execFileSync (GIT_* repo selectors dropped by cleanGitEnv, timeout 20 s,
// maxBuffer 32 MiB, --since = sinceTs - slack when a window exists). One event per commit that carries a non-empty QC-Verdict
// trailer; `ts` is the committer date (%cI, numeric offset) read through parseInstant. `basis` is always `self_reported`: a
// trailer is text any process can write. Read-only, never throws. Out of contract (documented in the plan): a commit that
// becomes reachable later with a committer date older than the window is not delivered by a resumed read.

const { execFileSync } = require('child_process');
const { cleanGitEnv } = require('../../git-env');
const { parseInstant, parseInstantMs } = require('../instant');
const { redactText, truncateText } = require('../redact');
const { createCollector } = require('../collector');

const SOURCE = 'qc';
const EVENT_SOURCE = 'git_trailer';
const FIELD = '\x1f';
const RECORD = '\x1d';
const TRAILER_SEP = '\x1e';
const FORMAT = ['%H', '%cI', '%(trailers:key=QC-Verdict,valueonly,unfold,separator=%x1e)', '%s'].join('%x1f') + '%x1d';

function warner() {
  const map = new Map();
  return {
    add(code, detail) {
      const entry = map.get(code) || { source: SOURCE, code, details: [], count: 0 };
      entry.count += 1;
      if (detail && entry.details.length < 3 && !entry.details.includes(detail)) entry.details.push(detail);
      map.set(code, entry);
    },
    list() {
      return [...map.values()].map(({ source, code, details, count }) => ({ source, code, detail: details.join(', '), count }));
    },
  };
}

function sinceIso(window) {
  if (!window || window.sinceTs === null || window.sinceTs === undefined || window.sinceTs === 0) return null;
  let since = window.sinceTs;
  if (typeof since === 'string') since = parseInstantMs(since);
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return null;
  const slack = Number.isFinite(window.slackMs) ? window.slackMs : 0;
  return new Date(Math.max(0, since - slack)).toISOString();
}

// -> { prefix: [git args placed before `log`], cwd } for the project's repository.
function repoArgs(ctx) {
  const project = (ctx && ctx.project) || {};
  if (typeof project.root === 'string' && project.root !== '') return { prefix: ['-C', project.root], cwd: undefined };
  if (typeof project.common_dir === 'string' && project.common_dir !== '') return { prefix: [`--git-dir=${project.common_dir}`], cwd: undefined };
  return null;
}

function read(ctx, window) {
  const events = createCollector(window);
  const warn = warner();
  const stats = { name: SOURCE, state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 };
  const finish = () => ({ ...events.result(), warnings: warn.list(), stats });
  try {
    const project = (ctx && ctx.project) || {};
    const repo = repoArgs(ctx);
    if (!repo) { stats.state = 'degraded'; warn.add('git_unavailable', 'no repository'); return finish(); }
    const args = [...repo.prefix, 'log', `--format=${FORMAT}`];
    const since = sinceIso(window);
    if (since) args.push(`--since=${since}`);
    args.push('--branches', 'HEAD');
    try { // an unborn HEAD (a fresh repo, no commit yet) is a normal state: no events, no warning
      execFileSync('git', [...repo.prefix, 'rev-parse', '--verify', '-q', 'HEAD'], {
        env: cleanGitEnv((ctx && ctx.env) || process.env), encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (error) {
      if (error && error.status === 1) return finish();
    }
    let out;
    try {
      out = execFileSync('git', args, {
        env: cleanGitEnv((ctx && ctx.env) || process.env), encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (_error) {
      stats.state = 'degraded';
      warn.add('git_unavailable', 'git log');
      return finish();
    }
    for (const rawRecord of out.split(RECORD)) {
      const record = rawRecord.replace(/^\n+/, '');
      if (!record) continue;
      stats.rows_read += 1;
      const parts = record.split(FIELD);
      const sha = parts[0];
      if (parts.length < 4 || !/^[0-9a-f]{40,64}$/.test(sha)) { stats.rows_skipped += 1; warn.add('line_unparseable', 'git log'); stats.state = 'degraded'; continue; }
      const values = parts[2].split(TRAILER_SEP).map((v) => v.trim()).filter((v) => v.length > 0);
      if (values.length === 0) { stats.rows_filtered += 1; continue; } // no trailer, or an empty one: not an event
      const ts = parseInstant(parts[1]);
      if (ts === null) { stats.rows_skipped += 1; warn.add('ts_invalid', 'git log'); stats.state = 'degraded'; continue; }
      // redact the WHOLE text first, then cap: a token cut at the cap would no longer match its length threshold
      const verdictRaw = values[0].split('\n')[0].trim();
      if (!verdictRaw) { stats.rows_filtered += 1; continue; }
      const verdictRed = redactText(verdictRaw);
      const verdict = truncateText(verdictRed.text, 64);
      const subjectRed = redactText(parts.slice(3).join(FIELD).replace(/\n+$/, ''));
      const subject = { text: truncateText(subjectRed.text, 120) };
      stats.redactions += verdictRed.redactions + subjectRed.redactions;
      events.push({
        id: `qc.verdict:${sha}`, kind: 'qc.verdict', ts, ts_basis: 'source', source: EVENT_SOURCE,
        project_key: project.project_key, root_run_id: null, run_id: null,
        data: { commit: sha, verdict, subject: subject.text, basis: 'self_reported' },
      });
    }
  } catch (_error) {
    stats.state = 'degraded';
    warn.add('source_failed', 'qc');
  }
  return finish();
}

module.exports = { read };
