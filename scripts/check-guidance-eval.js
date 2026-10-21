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
 *      Optional prereg guidance.out_of_arm is an array of {path, commit, reason} (all three
 *      non-empty strings). A differing manifest file that is not in guidance.files is accepted
 *      when it has one valid entry and the gate re-derives both of the following itself: the
 *      commit resolves, is an ancestor of --head, is not an ancestor of --base (it lies in
 *      base..head; compared by full sha), and git diff-tree --no-renames of that commit lists
 *      the path; and the path is not loaded by any arm manifest named base.json, change.json or
 *      red.json next to --arm (plus --arm itself). A path under skills/<name>/ is loaded when
 *      <name> is a key of that arm's skills object. Any other path is loaded when packs/manifest.json
 *      has "<pack id>/<path>" for a pack named by that arm's files field (string or array) or by
 *      a skills entry. The declaration's commit and reason are echoed; they are never trusted.
 *      An entry that does not differ, that is also in guidance.files, that is malformed, or whose
 *      path is duplicated fails the gate. Accepted out_of_arm files do not by themselves require
 *      packs or a results file.
 *   2. re-running score-stage-graph.js on the recorded results reproduces SHIP.
 * When no manifest file differs from the base, or every differing file is an accepted out_of_arm
 * file, there is nothing to evaluate: gate 1 passes vacuously and the scorer is not required
 * (`score: null`).
 *
 * Pack mapping comes from the arm manifest (--arm; the evaluated arm's pack ids carry a version suffix
 * on later runs, v2..v5). arm.files is a non-empty string or a non-empty array of non-empty pack ids.
 * skills/<s>/<rest> -> pack arm.skills[<s>], file <rest>. Every other manifest path maps to pack
 * arm.files when that field is a string (file = the repo path itself). When arm.files is an array,
 * the path maps to the single pack in that list whose manifest holds "<pack id>/<path>". Exactly one
 * pack must hold it. Zero packs: the same failure as a path with no pack entry. Two or more: the gate
 * fails because the path is in more than one arm pack (it never picks the first). Only the `change`
 * arm is evaluated.
 *
 * Usage:
 *   check-guidance-eval.js --base <ref> [--head <ref, default HEAD>] [--repo <dir, default cwd>]
 *       [--prereg <json>] [--packs-dir <dir>] [--arm <json>] [--results <jsonl>] [--scorer <script>]
 *   --arm's files field is a non-empty string or a non-empty array of non-empty pack ids. A non-skill
 *   manifest path must be held by exactly one of those packs.
 *   Defaults: prereg/packs/scorer/arm (arms/stage-graph/change.json) from evals/skill-onoff next to this script; --results required
 *   whenever a manifest file differs.
 * stdout: ONE JSON object {ok, base, head, arm, differing[], failures[], score, out_of_arm[]}.
 * out_of_arm lists every declared entry: {path, commit, reason, ok, reason_failed?}. Diagnostics on stderr.
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
const armPath = path.resolve(val('--arm') || path.join(EVAL, 'arms', 'stage-graph', 'change.json'));
const resultsPath = val('--results');
const scorer = val('--scorer') || path.join(EVAL, 'score-stage-graph.js');
if (!base) die('usage: check-guidance-eval.js --base <ref> [--head <ref>] [--repo <dir>] [--prereg <json>] [--packs-dir <dir>] [--arm <json>] [--results <jsonl>]');

const git = (args) => {
  const r = cp.spawnSync('git', ['-C', repo, ...args], { encoding: null, maxBuffer: 1 << 28 });
  if (r.status !== 0) die(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
  return r.stdout;
};
let P;
let man;
let arm;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`unreadable prereg: ${e.message}`); }
try { man = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8')); } catch (e) { die(`unreadable pack manifest: ${e.message}`); }
try { arm = JSON.parse(fs.readFileSync(armPath, 'utf8')); } catch (e) { die(`unreadable arm manifest: ${e.message}`); }
if (!arm || arm.arm !== 'change') die(`arm manifest ${armPath} is not the change arm (arm=${arm && arm.arm})`);
if (!arm.skills || typeof arm.skills !== 'object' || Array.isArray(arm.skills)) die('arm manifest: skills must be an object');
if (!packIdList(arm.files).length || (Array.isArray(arm.files) && packIdList(arm.files).length !== arm.files.length) || (typeof arm.files !== 'string' && !Array.isArray(arm.files))) {
  die('arm manifest: files must be a non-empty string or a non-empty array of non-empty strings');
}

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
  if (m) return { id: Object.hasOwn(arm.skills, m[1]) ? arm.skills[m[1]] : undefined, skill: m[1], rel: m[2] };
  if (typeof arm.files === 'string') return { id: arm.files, rel: p };
  const ids = packIdList(arm.files);
  const holders = ids.filter((id) => packContains(id, p));
  if (holders.length > 1) return { rel: p, ambiguous: holders };
  if (holders.length === 1) return { id: holders[0], rel: p };
  // No pack holds the path: same later failure as a string files field with no pack entry.
  return { id: ids[0], rel: p };
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
const diffSet = new Set(differing.map((d) => d.path));

function gitStatus(args) {
  return cp.spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}
function resolveCommit(rev) {
  const r = gitStatus(['rev-parse', '--verify', `${rev}^{commit}`]);
  if (r.status !== 0) return null;
  return r.stdout.trim();
}
function isAncestor(ancestor, desc) {
  return gitStatus(['merge-base', '--is-ancestor', ancestor, desc]).status === 0;
}
function commitChangesPath(full, filePath) {
  const listedNames = git(['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', full]).toString('utf8').split('\0').filter(Boolean);
  return listedNames.includes(filePath);
}
function commitInRange(rev, filePath) {
  const full = resolveCommit(rev);
  if (!full) return 'out_of_arm commit does not resolve (not in base..head)';
  if (!isAncestor(full, head) || isAncestor(full, base)) return 'out_of_arm commit is not in base..head';
  if (!commitChangesPath(full, filePath)) return 'out_of_arm commit did not change the path';
  return null;
}

function packIdList(field) {
  if (typeof field === 'string' && field) return [field];
  if (Array.isArray(field)) return field.filter((x) => typeof x === 'string' && x);
  return [];
}
function readSiblingArms() {
  const arms = [arm];
  const seen = new Set([path.resolve(armPath)]);
  for (const name of ['base.json', 'change.json', 'red.json']) {
    const p = path.join(path.dirname(armPath), name);
    const resolved = path.resolve(p);
    if (seen.has(resolved) || !fs.existsSync(p)) continue;
    seen.add(resolved);
    try { arms.push(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (e) { failures.push(`unreadable arm manifest ${name}: ${e.message}`); }
  }
  return arms;
}
const loadArms = readSiblingArms();
function packContains(id, repoPath) {
  const packs = man.packs && man.packs[id];
  return !!(packs && Object.hasOwn(packs, `${id}/${repoPath}`));
}
function loadedByArm(repoPath) {
  const skillName = (/^skills\/([^/]+)\//.exec(repoPath) || [])[1];
  for (const a of loadArms) {
    const skills = a && a.skills && typeof a.skills === 'object' && !Array.isArray(a.skills) ? a.skills : {};
    if (skillName && Object.hasOwn(skills, skillName)) return true;
    if (!skillName) {
      const ids = packIdList(a && a.files);
      for (const v of Object.values(skills)) if (typeof v === 'string' && v) ids.push(v);
      if (ids.some((id) => packContains(id, repoPath))) return true;
    }
  }
  return false;
}

function blankEntry(e) {
  const pathOk = !!(e && typeof e.path === 'string' && e.path);
  const commitOk = !!(e && typeof e.commit === 'string' && e.commit);
  const reasonOk = !!(e && typeof e.reason === 'string' && e.reason);
  return {
    path: pathOk ? e.path : '',
    commit: commitOk ? e.commit : '',
    reason: reasonOk ? e.reason : '',
    pathOk, commitOk, reasonOk,
  };
}
const outOfArm = [];
const declByPath = new Map();
const rawOut = P.guidance && P.guidance.out_of_arm;
if (rawOut !== undefined && !Array.isArray(rawOut)) {
  failures.push('malformed out_of_arm entry (guidance.out_of_arm must be an array)');
} else if (Array.isArray(rawOut)) {
  rawOut.forEach((e) => {
    const rec = blankEntry(e);
    if (!rec.pathOk || !rec.commitOk || !rec.reasonOk) {
      rec.ok = false;
      rec.reason_failed = 'malformed out_of_arm entry (path, commit and reason must be non-empty strings)';
      failures.push(rec.path ? `${rec.path}: ${rec.reason_failed}` : rec.reason_failed);
      outOfArm.push(rec);
      return;
    }
    if (declByPath.has(rec.path)) {
      rec.ok = false;
      rec.reason_failed = 'duplicate out_of_arm path';
      failures.push(`${rec.path}: ${rec.reason_failed}`);
      const first = declByPath.get(rec.path);
      if (first.ok !== false) {
        first.ok = false;
        first.reason_failed = rec.reason_failed;
        failures.push(`${first.path}: ${first.reason_failed}`);
      }
      declByPath.delete(rec.path);
      outOfArm.push(rec);
      return;
    }
    rec.ok = true;
    declByPath.set(rec.path, rec);
    outOfArm.push(rec);
  });
  for (const rec of declByPath.values()) {
    if (listed.has(rec.path)) {
      rec.ok = false;
      rec.reason_failed = 'a file cannot be both in guidance.files and out_of_arm';
      failures.push(`${rec.path}: ${rec.reason_failed}`);
      continue;
    }
    if (!diffSet.has(rec.path)) {
      rec.ok = false;
      rec.reason_failed = 'declared out_of_arm but unchanged';
      failures.push(`${rec.path}: ${rec.reason_failed}`);
      continue;
    }
    const commitFail = commitInRange(rec.commit, rec.path);
    const loaded = loadedByArm(rec.path);
    if (commitFail || loaded) {
      rec.ok = false;
      rec.reason_failed = [commitFail, loaded ? 'path is loaded by an arm' : null].filter(Boolean).join('; ');
    }
  }
}

for (const d of differing) {
  const { id, rel, skill, ambiguous } = packFor(d.path);
  d.pack = id;
  d.pack_file = rel;
  const key = `${id}/${rel}`;
  const entry = id && man.packs && man.packs[id] ? man.packs[id][key] : undefined;
  const fail = (reason) => { d.ok = false; d.reason = reason; failures.push(`${d.path}: ${reason}`); };
  if (!listed.has(d.path)) {
    const rec = declByPath.get(d.path);
    if (rec && rec.ok) {
      d.ok = true;
      d.out_of_arm = true;
      d.commit = rec.commit;
      d.reason = rec.reason;
      continue;
    }
    if (rec && rec.reason_failed) { fail(rec.reason_failed); continue; }
    fail('not in the prereg guidance file set (an unevaluated guidance change: new pack + new arm required)');
    continue;
  }
  if (ambiguous) { fail('path is in more than one arm pack'); continue; }
  if (!id) { fail(`skill ${skill} has no change pack in the arm manifest`); continue; }
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

// Bind the results file to the arm manifest. Either every change-arm row carries arm_manifest_sha256
// equal to the sha256 of --arm (written by run-skill-onoff-eval.sh), or - for committed legacy
// evidence that must stay byte-identical - a sidecar <results-basename>.arm-binding.json sits next
// to the results file, whose results_sha256 matches the file and whose arm_manifest_sha256 equals
// the --arm digest.
function armBindingFailures(file) {
  const want = sha(fs.readFileSync(armPath));
  let raw;
  let rows;
  try { raw = fs.readFileSync(file); rows = raw.toString('utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch (e) { return [`results file unreadable for arm binding: ${e.message}`]; }
  const changeRows = rows.filter((r) => r && r.arm === 'change');
  if (!changeRows.length) return ['results file has no change-arm rows to bind to the arm manifest'];
  const stamped = changeRows.filter((r) => typeof r.arm_manifest_sha256 === 'string');
  if (stamped.length === changeRows.length) {
    const wrong = stamped.filter((r) => r.arm_manifest_sha256 !== want).length;
    return wrong ? [`${wrong} change-arm row(s) were produced under a different arm manifest (arm_manifest_sha256 != sha256 of ${path.basename(armPath)})`] : [];
  }
  if (stamped.length) return [`${changeRows.length - stamped.length} change-arm row(s) carry no arm_manifest_sha256 (partially stamped results)`];
  const sidecarPath = path.join(path.dirname(file), `${path.basename(file).replace(/\.jsonl$/, '')}.arm-binding.json`);
  let side;
  try { side = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')); } catch { return [`change-arm rows carry no arm_manifest_sha256 and no readable arm-binding sidecar at ${sidecarPath} (results not bound to the arm manifest)`]; }
  if (!side || side.schema !== 'autopilot.results-arm-binding/1') return [`arm-binding sidecar ${sidecarPath} has an unknown schema`];
  const out = [];
  if (side.results_sha256 !== sha(raw)) out.push(`arm-binding sidecar results_sha256 is stale (does not match ${path.basename(file)})`);
  if (side.arm_manifest_sha256 !== want) out.push(`arm-binding sidecar names a different arm manifest (arm_manifest_sha256 != sha256 of ${path.basename(armPath)})`);
  return out;
}

let score = null;
const needsScore = differing.some((d) => d.out_of_arm !== true);
if (needsScore) {
  if (!resultsPath) failures.push('results file required: manifest files differ from base but --results was not given');
  else {
    failures.push(...armBindingFailures(resultsPath));
    const r = cp.spawnSync('node', [scorer, 'score', '--results', resultsPath, '--prereg', preregPath], { encoding: 'utf8', maxBuffer: 1 << 26 });
    let parsed = null;
    try { parsed = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* leave null */ }
    score = { exit: r.status, verdict: parsed ? parsed.verdict : 'UNPARSEABLE', reasons: parsed ? parsed.reasons : [String(r.stderr || '').trim()] };
    if (r.status !== 0 || !parsed || parsed.verdict !== 'SHIP') failures.push(`scorer did not reproduce SHIP (exit ${r.status}, verdict ${score.verdict})`);
  }
}

const outOfArmOut = outOfArm.map((rec) => {
  const row = { path: rec.path, commit: rec.commit, reason: rec.reason, ok: rec.ok === true };
  if (!row.ok) row.reason_failed = rec.reason_failed;
  return row;
});
const out = { ok: failures.length === 0, base, head, arm: armPath, differing, failures, score, out_of_arm: outOfArmOut };
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(out.ok ? 0 : 1);
