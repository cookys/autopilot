#!/usr/bin/env node
'use strict';
/**
 * check-guidance-eval.js — the guidance-eval cut gate (plan docs/plans/2026-10-06-dev-flow-stage-graph.md
 * §2.8 and §4 P0). "Guidance ships only on a cut where this passes."
 *
 * Guidance manifest (plan §2.8): skills/<s>/SKILL.md, skills/<s>/references/**, references/*.md,
 * agents/*.md, project-config-template/*.md. At a cut it asserts two things, both re-derived, never
 * trusted from a claim (ADR-0001):
 *   1. every manifest file that differs between --base and --head is byte-equal to its copy in the
 *      evaluated change pack — by sha256 recorded in <packs-dir>/manifest.json AND by the pack's bytes
 *      on disk. A differing file that is not in the prereg guidance file set, has no pack entry, or
 *      differs from its pack copy fails the gate. A deleted file must be absent from the pack.
 *   2. re-running score-stage-graph.js on the recorded results reproduces SHIP.
 * When no manifest file differs from the base there is nothing to evaluate: gate 1 passes vacuously
 * and the scorer is not required (`score: null`).
 *
 * Pack mapping (prereg guidance.pack_ids): skills/<s>/<rest> -> pack <s>-sg-change, file <rest>;
 * every other manifest path -> pack guidance-files-sg-change, file = the repo path itself.
 *
 * Usage:
 *   check-guidance-eval.js --base <ref> [--head <ref, default HEAD>] [--repo <dir, default cwd>]
 *       [--prereg <json>] [--packs-dir <dir>] [--results <jsonl>] [--scorer <script>]
 *   Defaults: prereg/packs/scorer from evals/skill-onoff next to this script; --results required
 *   whenever a manifest file differs.
 * stdout: ONE JSON object {ok, base, head, differing[], failures[], score}. Diagnostics on stderr.
 * Exit: 0 gate passes · 1 gate fails · 2 usage / unreadable input.
 * Wiring into scripts/preflight-release.sh is P8, not now.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m) => { console.error(`check-guidance-eval: ${m}`); process.exit(2); };
const EVAL = path.join(__dirname, '..', 'evals', 'skill-onoff');
const base = val('--base');
const head = val('--head') || 'HEAD';
const repo = path.resolve(val('--repo') || process.cwd());
const preregPath = val('--prereg') || path.join(EVAL, 'prereg', 'stage-graph.json');
const packsDir = path.resolve(val('--packs-dir') || path.join(EVAL, 'packs'));
const resultsPath = val('--results');
const scorer = val('--scorer') || path.join(EVAL, 'score-stage-graph.js');
if (!base) die('usage: check-guidance-eval.js --base <ref> [--head <ref>] [--repo <dir>] [--prereg <json>] [--packs-dir <dir>] [--results <jsonl>]');

const git = (args) => {
  const r = cp.spawnSync('git', ['-C', repo, ...args], { encoding: null, maxBuffer: 1 << 28 });
  if (r.status !== 0) die(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
  return r.stdout;
};
let P;
let man;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`unreadable prereg: ${e.message}`); }
try { man = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8')); } catch (e) { die(`unreadable pack manifest: ${e.message}`); }

const IS_MANIFEST = [
  /^skills\/[^/]+\/SKILL\.md$/,
  /^skills\/[^/]+\/references\/.+/,
  /^references\/[^/]+\.md$/,
  /^agents\/[^/]+\.md$/,
  /^project-config-template\/[^/]+\.md$/,
];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function packFor(p) {
  const m = p.match(/^skills\/([^/]+)\/(.+)$/);
  if (m) return { id: `${m[1]}-sg-change`, rel: m[2] };
  return { id: 'guidance-files-sg-change', rel: p };
}

const diff = git(['diff', '--name-status', '--no-renames', '-z', base, head]).toString('utf8').split('\0').filter(Boolean);
const differing = [];
for (let i = 0; i + 1 < diff.length; i += 2) {
  const status = diff[i][0];
  const p = diff[i + 1];
  if (IS_MANIFEST.some((re) => re.test(p))) differing.push({ path: p, status });
}
const listed = new Set(P.guidance.files);
const failures = [];
for (const d of differing) {
  const { id, rel } = packFor(d.path);
  d.pack = id;
  d.pack_file = rel;
  const key = `${id}/${rel}`;
  const entry = man.packs && man.packs[id] ? man.packs[id][key] : undefined;
  const fail = (reason) => { d.ok = false; d.reason = reason; failures.push(`${d.path}: ${reason}`); };
  if (!listed.has(d.path)) { fail('not in the prereg guidance file set (an unevaluated guidance change: new pack + new arm required)'); continue; }
  if (!man.packs || !man.packs[id]) { fail(`change pack ${id} is not frozen in packs/manifest.json`); continue; }
  if (d.status === 'D') {
    if (entry !== undefined) fail('file deleted at head but still present in the change pack');
    else d.ok = true;
    continue;
  }
  if (entry === undefined) { fail(`no digest for ${key} in packs/manifest.json`); continue; }
  const shipped = git(['show', `${head}:${d.path}`]);
  if (sha(shipped) !== entry) { fail('shipped file digest != pack manifest digest'); continue; }
  let packBytes = null;
  try { packBytes = fs.readFileSync(path.join(packsDir, id, rel)); } catch { /* handled below */ }
  if (!packBytes) { fail('pack file missing on disk'); continue; }
  if (!shipped.equals(packBytes)) { fail('shipped bytes != pack bytes on disk'); continue; }
  d.ok = true;
}

let score = null;
if (differing.length) {
  if (!resultsPath) failures.push('results file required: manifest files differ from base but --results was not given');
  else {
    const r = cp.spawnSync('node', [scorer, 'score', '--results', resultsPath, '--prereg', preregPath], { encoding: 'utf8', maxBuffer: 1 << 26 });
    let parsed = null;
    try { parsed = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* leave null */ }
    score = { exit: r.status, verdict: parsed ? parsed.verdict : 'UNPARSEABLE', reasons: parsed ? parsed.reasons : [String(r.stderr || '').trim()] };
    if (r.status !== 0 || !parsed || parsed.verdict !== 'SHIP') failures.push(`scorer did not reproduce SHIP (exit ${r.status}, verdict ${score.verdict})`);
  }
}

const out = { ok: failures.length === 0, base, head, differing, failures, score };
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(out.ok ? 0 : 1);
