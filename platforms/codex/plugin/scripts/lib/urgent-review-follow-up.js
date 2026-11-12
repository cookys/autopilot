#!/usr/bin/env node
'use strict';

// urgent-review-follow-up.js — print the review follow-up after an urgent, non-high-risk finish.
//
//   node scripts/lib/urgent-review-follow-up.js [--marker <file>] [--sha <hex>]
//        [--session-id <id>] [--repo-root <dir>]
//
// Prints nothing and exits 0 unless the marker has urgent === true and high_risk === false
// (absent high_risk, high_risk true, and urgent not true all print nothing). A missing session
// record with no --marker also prints nothing. There is no fleet call and this process does not
// run project-record; it prints one ready-to-run command plus the backlog row that command adds.
//
// The command is `node scripts/project-record.js backlog new ... --effort M ...` with the fix sha
// in the title and in Context. The sha is --sha, else `git -C <repo> rev-parse HEAD`
// (repo: --repo-root, else marker.repo_root, else cwd).
//
// Exit 1 on usage, an unreadable --marker, or no sha when a follow-up is due.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const { spawnSync } = require('child_process');
const { renderRow } = require('./backlog-rules');

const SHA_RE = /^[0-9a-f]{7,64}$/;

class Usage extends Error {}

function parseArgs(argv) {
  const valued = new Set(['--marker', '--sha', '--session-id', '--repo-root']);
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!valued.has(a)) throw new Usage(`unknown argument ${a}`);
    if (argv[i + 1] === undefined) throw new Usage(`${a} needs a value`);
    o[a.slice(2)] = argv[++i];
  }
  if (o.sha !== undefined && !SHA_RE.test(o.sha)) throw new Usage('--sha must be 7-64 hex characters');
  return o;
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function loadMarker(opts) {
  if (opts.marker) {
    let text;
    try { text = fs.readFileSync(opts.marker, 'utf8'); }
    catch (e) { throw new Usage(`cannot read marker: ${e.message}`); }
    try { return JSON.parse(text); }
    catch (e) { throw new Usage(`marker is not JSON: ${e.message}`); }
  }
  if (opts['session-id']) process.env.AUTOPILOT_SESSION_ID = opts['session-id'];
  const sessionMode = require('../session-mode');
  const id = opts['session-id'];
  return sessionMode.readSessionRecord(id);
}

function fixSha(opts, marker) {
  if (opts.sha) return opts.sha;
  const root = opts['repo-root'] || (marker && marker.repo_root) || process.cwd();
  const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Usage('cannot resolve the fix sha (pass --sha or a repo with a commit)');
  const sha = String(r.stdout || '').trim();
  if (!SHA_RE.test(sha)) throw new Usage('git rev-parse HEAD did not return a hex sha');
  return sha;
}

// null when this marker does not get a follow-up. Otherwise the stdout text.
function followUp(marker, sha) {
  if (!marker || marker.urgent !== true || marker.high_risk !== false) return null;
  const short = sha.slice(0, 7);
  const title = `Review urgent fix ${short}`;
  const trigger = 'urgent fix merged and the post-finish review is still manual';
  const problem = '緊急修復已合併，事後審查尚未建立。';
  const impact = '未審查的緊急修復可能帶著未發現的缺陷。';
  const source = 'finish-flow urgent';
  const context = `fix ${sha}`;
  const cmd = [
    'node scripts/project-record.js backlog new',
    '--title', shQuote(title),
    '--trigger', shQuote(trigger),
    '--trigger-type', 'ready',
    '--effort', 'M',
    '--origin', 'self',
    '--source', shQuote(source),
    '--problem', shQuote(problem),
    '--impact', shQuote(impact),
    '--pointer', 'none',
    '--context', shQuote(context),
  ].join(' ');
  const row = renderRow({
    Title: title,
    Status: 'open',
    Origin: 'self',
    Problem: problem,
    Impact: impact,
    Trigger: trigger,
    'Trigger-Type': 'ready',
    Effort: 'M',
    Source: source,
    Pointer: 'none',
    Context: context,
  });
  return `${cmd}\n\n${row}\n`;
}

function run(argv) {
  let opts;
  try { opts = parseArgs(argv); }
  catch (e) {
    if (e instanceof Usage) return { code: 1, err: `urgent-review-follow-up: ${e.message}`, out: '' };
    throw e;
  }
  let marker;
  try { marker = loadMarker(opts); }
  catch (e) {
    if (e instanceof Usage) return { code: 1, err: `urgent-review-follow-up: ${e.message}`, out: '' };
    throw e;
  }
  if (!marker || marker.urgent !== true || marker.high_risk !== false) return { code: 0, out: '' };
  let sha;
  try { sha = fixSha(opts, marker); }
  catch (e) {
    if (e instanceof Usage) return { code: 1, err: `urgent-review-follow-up: ${e.message}`, out: '' };
    throw e;
  }
  return { code: 0, out: followUp(marker, sha) };
}

function main() {
  const r = run(process.argv.slice(2));
  if (r.err) process.stderr.write(`${r.err}\n`);
  if (r.out) process.stdout.write(r.out);
  return r.code;
}

if (require.main === module) process.exit(main());
module.exports = { run, followUp };
