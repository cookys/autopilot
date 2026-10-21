#!/usr/bin/env node
// build-dcard-hook-pack.js — stage a plugin-root slice of the decision-card hooks at a git ref.
//
//   node build-dcard-hook-pack.js --ref <git-ref> [--hooks a.js,b.js]
//
// Default --hooks is the decision-card mechanism set that exists today:
//   ask-decision.js, audit-log.js, awaiting-owner.js, owner-question-guard.js
// The stage dir holds those hook files, the transitive closure of their relative requires,
// and a generated hooks/hooks.json with only the real hooks.json entries (matcher + event
// kept verbatim) whose command names one of the listed hooks.
// Prints the stage directory. Freeze it with freeze-pack.js --from-dir (do not hand-edit a pack).
// Exit 2 if a listed hook is absent from hooks.json or a relative require cannot be resolved.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const ref = opt('--ref');
const hooksArg = opt('--hooks') || 'ask-decision.js,audit-log.js,awaiting-owner.js,owner-question-guard.js';
const die = (m) => { console.error(`build-dcard-hook-pack: ${m}`); process.exit(2); };
if (!ref) die('--ref <git-ref> required');

const here = __dirname;
const repoRoot = cp.execFileSync('git', ['-C', here, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, enc = 'buffer') => cp.execFileSync('git', ['-C', repoRoot, ...args], { encoding: enc === 'buffer' ? null : enc, maxBuffer: 1 << 28 });
const resolved = git(['rev-parse', '--verify', `${ref}^{commit}`], 'utf8').trim();

const bases = hooksArg.split(',').map((s) => s.trim()).filter(Boolean);
if (!bases.length) die('--hooks is empty');
for (const b of bases) if (!/^[a-zA-Z0-9._-]+\.js$/.test(b)) die(`bad hook basename: ${b}`);

function existsAt(p) {
  try { cp.execFileSync('git', ['-C', repoRoot, 'cat-file', '-e', `${resolved}:${p}`], { stdio: 'ignore' }); return true; } catch { return false; }
}
function readAt(p) {
  const data = git(['show', `${resolved}:${p}`]);
  const mode = git(['ls-tree', resolved, p], 'utf8').split(' ')[0];
  return { data, mode };
}

let hooksJson;
try { hooksJson = JSON.parse(git(['show', `${resolved}:hooks/hooks.json`], 'utf8').toString('utf8')); }
catch (e) { die(`cannot read hooks/hooks.json at ${ref}: ${e.message}`); }
const events = hooksJson.hooks || hooksJson;
if (!events || typeof events !== 'object' || Array.isArray(events)) die('hooks.json has no hooks object');

const named = (cmd) => bases.some((b) => cmd.includes(`/${b}`) || cmd.endsWith(b));
const seen = new Set();
const outHooks = {};
for (const [event, groups] of Object.entries(events)) {
  if (!Array.isArray(groups)) continue;
  const kept = [];
  for (const group of groups) {
    const hs = Array.isArray(group.hooks) ? group.hooks : [];
    const match = hs.filter((h) => h && typeof h.command === 'string' && named(h.command));
    if (!match.length) continue;
    for (const h of match) for (const b of bases) if (h.command.includes(b)) seen.add(b);
    kept.push({ ...group, hooks: match });
  }
  if (kept.length) outHooks[event] = kept;
}
for (const b of bases) if (!seen.has(b)) die(`listed hook is not in hooks.json: ${b}`);

const files = new Map();
const queue = bases.map((b) => `hooks/${b}`);
const queued = new Set();
while (queue.length) {
  const p = path.posix.normalize(queue.shift());
  if (queued.has(p)) continue;
  queued.add(p);
  if (!existsAt(p)) die(`path not in ${ref}: ${p}`);
  const f = readAt(p);
  files.set(p, f);
  if (!p.endsWith('.js')) continue;
  const src = f.data.toString('utf8').replace(/^[ \t]*\/\/.*$/gm, '');
  for (const m of src.matchAll(/require\(\s*['"`](\.{1,2}\/[^'"`]+)['"`]\s*\)/g)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1]));
    const cands = [base, `${base}.js`, `${base}.json`, `${base}/index.js`];
    const hit = cands.find((c) => existsAt(c));
    if (!hit) die(`unresolvable require ${m[1]} from ${p}`);
    queue.push(hit);
  }
}
files.set('hooks/hooks.json', { data: Buffer.from(`${JSON.stringify({ hooks: outHooks }, null, 2)}\n`), mode: '100644' });

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'onoff-dcard-stage-'));
for (const [rel, f] of files) {
  const out = path.join(stage, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, f.data, { mode: f.mode === '100755' ? 0o755 : 0o644 });
}
process.stdout.write(`${stage}\n`);
