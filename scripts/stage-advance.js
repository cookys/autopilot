#!/usr/bin/env node
'use strict';

// stage-advance.js — record the session's position in the dev-flow stage graph (plan §2.7 / §2.9).
//
//   stage-advance.js --to <node> [--unit kind:i/N:label] [--review-families a,b]
//                    [--session-id <id>] [--repo-root <dir>]
//   stage-advance.js --coarse <explore|plan|build|review|merged|shipped|used>
//                    [--session-id <id>] [--repo-root <dir>]
//   stage-advance.js --resume-from <old-session-id> [--session-id <id>]
//
// Writes `stage`, `stage_set_at`, `unit`, `review_families`, `high_risk` into the session marker found the
// same way session-mode.js finds it (AUTOPILOT_SESSION_MODE_DIR + the session id), under the marker lock with
// an atomic rename. Legality comes from scripts/stage-graph.js (CLI); this script owns no graph rules.
// The marker is telemetry (ADR-0001): gates re-derive, never trust a stage claim.
//
// Fleet (D8a): after a `--to` write succeeds, a marker with `fleet_task_id` gets one progress line
// `[stage:<coarse>/<node>]` plus ` <unit>` when the marker has a unit (`scripts/lib/fleet-task.js`,
// `$FLEET_BIN task update`). Coarse map: plan -> plan; implement, verify -> build; code-review, qc-gate -> review;
// finish -> merged; intent, diagnose, research, proposal -> explore; plan-review -> plan. No fleet_task_id: no call
// and no extra output. A fleet failure is one stderr line; the exit code stays the marker write's code.
// `--coarse <stage>` is mutually exclusive with --to / --unit / --review-families / --resume-from. It writes only
// `coarse_stage` (no graph check). The progress line is `[stage:<stage>]`. Without fleet_task_id the marker is
// still written and one stderr line says so. An unknown stage exits 2 and writes nothing.
//
// Rules, in order:
//   - first write (no `stage` yet) must target the entry node for (size, bug);
//   - otherwise `--to` must be in `stage-graph.js next --from <stage> --size .. [--bug] [--urgent] [--high-risk]`;
//     `--to <current stage>` is a same-node update: legal, records unit / review_families, and KEEPS stage_set_at
//     (the time the stage was entered, not the time it was last annotated);
//   - unit: kind and total are fixed once set; index never regresses and never exceeds total; verify -> implement
//     keeps the index (repair) or adds one; leaving the loop (verify -> anything but implement) needs index = total;
//     a unit kind must match the size's unit kind when it has one;
//   - high_risk: when the marker is urgent and the move leaves the LAST verify toward code-review / qc-gate, the
//     diff is sampled once (classify-diff-risk.sh -> resolve-review-loop.sh --field review_risk) and stored as
//     `high_risk = (review_risk == "high")`, used for that move's legality. A sampling failure counts as high
//     (the normal review order is never silently dropped) and says so on stderr;
//   - E1 size bump: entering verify or qc-gate, the WORKING-TREE change against base_ref is measured, run in the
//     cwd's toplevel when it belongs to the marker's repository (repo_identity; a linked worktree of it), else in
//     the marker repo_root: `git diff --numstat <base_ref>` (tracked, committed + staged + unstaged) plus every
//     untracked non-ignored file (`git ls-files --others --exclude-standard`; 1 file + its line count). Binary
//     files = 1 file, 0 lines; renames follow git's default; ignored files never count. (dev-flow runs qc-gate
//     BEFORE commit, so a committed-only count would never fire; this deliberately deviates from the plan's
//     `..HEAD` text.) The result is compared with `stage-graph.js limits`; equal fits, over exits 4 with the next
//     size up and writes nothing. A null base_ref falls back to the default-branch merge-base; if that fails
//     too the check is skipped with a stderr note.
//   - high_risk sampling sees the same working-tree change: `git diff --unified=0 <base_ref>` plus each untracked
//     file synthesized as an all-additions hunk is handed to classify-diff-risk.sh through `--diff-file`.
//
// Resume (`--resume-from <old-id>`, takes no --to): a session that came back with a NEW id (compaction, `claude
// --resume`) has an empty marker (`session-mode.js set --size ..` first) and would have to re-walk from the entry
// node. This copies size / bug / urgent / stage / unit / base_ref / high_risk / review_families / fleet_task_id /
// coarse_stage from the OLD id's
// marker instead, so the position is re-read from a record, never taken from the caller's word (ADR-0001). Fail closed
// (exit 6, nothing written, no downgrade to a bare `--to`): the new marker already has a stage; the old marker is
// absent / expired / unreadable / has no stage or size; the old id is the current id; the two markers do not share a
// repo_identity; or size / urgent / bug differ from the old marker (the new session must `set` the same size and
// flags first; if it already set a larger size or opened bug/urgent, `set --new-task --size <old> [flags]` lowers it
// again because size only moves up otherwise). The old marker
// is only read, never changed. The write takes the same marker lock as every other stage write.
//
// Test injection: AUTOPILOT_STAGE_ADVANCE_CLASSIFY / AUTOPILOT_STAGE_ADVANCE_RESOLVE replace the two sampling
// scripts (executable paths receiving the same arguments).
//
// Exit codes: 0 written; 1 usage / unreadable marker write; 2 no marker, or an invalid --coarse (stderr lists the
// legal stages); 3 illegal transition or unit-rule
// violation (stdout {allowed:false, from, to, legal_next, reason}); 6 `--resume-from` refused; 4 bump required (stdout {bump_to, files,
// lines}); 5 `size` missing from the marker, or leaving `plan` with declared `## Inputs` not yet landed on target.
// One JSON object on stdout, diagnostics on stderr.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { withWriteLock } = require('./lib/jsonl-store');
const sessionMode = require('./session-mode');
const fleetTask = require('./lib/fleet-task');
const { scopeFromCwd } = require('../src/status/project-key');

const REPO_ROOT = path.resolve(__dirname, '..');
const STAGE_GRAPH = path.join(__dirname, 'stage-graph.js');
const CHECK_INPUTS_LANDED = path.join(__dirname, 'check-inputs-landed.js');
const GRAPH_JSON = path.join(REPO_ROOT, 'references', 'stage-graph.json');
const LABEL_MAX = 64;
const UNIT_RE = /^(phase|deliverable):(\d+)\/(\d+)(?::(.*))?$/su;
const FAMILY_RE = /^[A-Za-z0-9._-]+$/u;
const VALUED = new Set(['--to', '--resume-from', '--unit', '--review-families', '--session-id', '--repo-root', '--coarse']);
const COARSE_STAGES = Object.freeze(['explore', 'plan', 'build', 'review', 'merged', 'shipped', 'used']);
// Stated default: plan; implement+verify -> build; code-review+qc-gate -> review; finish -> merged.
// Added default so every graph node has a coarse name: pre-plan nodes -> explore; plan-review stays plan.
const COARSE_OF_NODE = Object.freeze({
  intent: 'explore',
  diagnose: 'explore',
  research: 'explore',
  proposal: 'explore',
  plan: 'plan',
  'plan-review': 'plan',
  implement: 'build',
  verify: 'build',
  'code-review': 'review',
  'qc-gate': 'review',
  finish: 'merged',
});

class Usage extends Error {}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!VALUED.has(a)) throw new Usage(`unknown argument ${a}`);
    if (argv[i + 1] === undefined) throw new Usage(`${a} needs a value`);
    o[a.slice(2)] = argv[++i];
  }
  if (o.coarse !== undefined && (o.to || o.unit || o['review-families'] || o['resume-from'] !== undefined)) {
    throw new Usage('--coarse is mutually exclusive with --to, --unit, --review-families and --resume-from');
  }
  if (o['resume-from'] !== undefined) {
    if (o.to) throw new Usage('--resume-from takes no --to (the stage comes from the old marker)');
    if (o.unit || o['review-families']) throw new Usage('--resume-from takes no --unit / --review-families');
  } else if (!o.to && o.coarse === undefined) throw new Usage('--to <node> is required');
  return o;
}

function formatUnit(unit) {
  if (!unit || typeof unit !== 'object' || typeof unit.kind !== 'string') return '';
  const base = `${unit.kind}:${unit.index}/${unit.total}`;
  return unit.label ? `${base}:${unit.label}` : base;
}

function stageProgressText(marker) {
  const node = marker && marker.stage;
  const coarse = COARSE_OF_NODE[node];
  if (typeof node !== 'string' || !coarse) return null;
  const unit = formatUnit(marker.unit);
  return unit ? `[stage:${coarse}/${node}] ${unit}` : `[stage:${coarse}/${node}]`;
}

// One stderr line. The marker write already happened; the exit code is not this call's.
function reportFleet(taskId, text) {
  let result;
  try {
    result = fleetTask.progress(taskId, text);
  } catch (error) {
    result = { ok: false, status: null, error: error.message };
  }
  if (result.ok) return;
  const why = result.status === null || result.status === undefined
    ? (result.error || 'spawn failed')
    : `exit ${result.status}`;
  process.stderr.write(`stage-advance: fleet progress failed (${why}); marker write kept\n`);
}

function afterWrite(result, marker, text, coarse) {
  if (!result || result.code !== 0 || !marker) return result;
  const id = typeof marker.fleet_task_id === 'string' ? marker.fleet_task_id : '';
  if (!id) {
    if (coarse) {
      process.stderr.write(
        `stage-advance: recorded coarse_stage ${marker.coarse_stage}; no fleet_task_id, so no fleet progress line\n`,
      );
    }
    return result;
  }
  if (text) reportFleet(id, text);
  else process.stderr.write(`stage-advance: no coarse stage for node ${marker.stage}; no fleet progress line\n`);
  return result;
}

function parseUnit(raw) {
  const m = UNIT_RE.exec(raw);
  if (!m) throw new Usage(`invalid --unit "${raw}" (want kind:i/N:label, kind phase|deliverable)`);
  const unit = { kind: m[1], index: Number(m[2]), total: Number(m[3]), label: m[4] === undefined ? '' : m[4] };
  if (!(unit.index >= 1) || !(unit.total >= 1)) throw new Usage('invalid --unit: index and total must be >= 1');
  if ([...unit.label].length > LABEL_MAX) throw new Usage(`invalid --unit: label longer than ${LABEL_MAX} characters`);
  return unit;
}

function parseFamilies(raw) {
  const fams = raw.split(',').map((s) => s.trim());
  if (fams.length === 0 || fams.some((f) => !FAMILY_RE.test(f))) {
    throw new Usage(`invalid --review-families "${raw}" (want comma-separated ids of [A-Za-z0-9._-])`);
  }
  return fams;
}

function graphJson(args) {
  const r = spawnSync(process.execPath, [STAGE_GRAPH, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`stage-graph.js ${args.join(' ')} exited ${r.status}: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

function variantFlags(marker, highRisk, research) {
  const f = ['--size', marker.size];
  if (research) f.push('--research');
  if (marker.bug === true) f.push('--bug');
  if (marker.urgent === true) f.push('--urgent');
  if (highRisk) f.push('--high-risk');
  return f;
}

// `stage-graph.js next` only knows `research` as a member of the walk when asked with --research, so that flag
// rides along when the current stage is research (taking the research edge is the ladder's call, not ours).

// The two sampling scripts. Injected paths run directly; the shipped defaults run under bash.
function sampleCommand(envName, defaultScript) {
  const injected = process.env[envName];
  return injected ? { cmd: injected, pre: [] } : { cmd: 'bash', pre: [path.join(__dirname, defaultScript)] };
}

// -> true when review_risk is "high". Any failure counts as high (never silently lowers review).
function sampleHighRisk(repoRoot, baseRef) {
  const fail = (why) => {
    process.stderr.write(`stage-advance: high_risk sampling failed (${why}); recording high_risk: true\n`);
    return true;
  };
  if (!baseRef) return fail('no base_ref');
  const c = sampleCommand('AUTOPILOT_STAGE_ADVANCE_CLASSIFY', 'classify-diff-risk.sh');
  const patch = workingTreePatch(repoRoot, baseRef);
  if (patch === null) return fail('could not build the working-tree diff');
  const patchFile = path.join(os.tmpdir(), `stage-advance-diff-${process.pid}-${Date.now()}.patch`);
  fs.writeFileSync(patchFile, patch);
  let cr;
  try {
    cr = spawnSync(c.cmd, [...c.pre, '--diff-file', patchFile], { cwd: repoRoot, encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(patchFile); } catch (_e) { /* best effort */ }
  }
  if (cr.status !== 0) return fail(`classify-diff-risk exited ${cr.status}`);
  let flags;
  try { flags = JSON.parse(cr.stdout).risk_flags; } catch (_e) { flags = null; }
  if (!flags || typeof flags !== 'object') return fail('classify-diff-risk gave no risk_flags');
  const r = sampleCommand('AUTOPILOT_STAGE_ADVANCE_RESOLVE', 'resolve-review-loop.sh');
  const rr = spawnSync(r.cmd, [
    ...r.pre, '--field', 'review_risk',
    '--source-trust', String(flags.source_trust),
    '--diff-lines', String(flags.diff_lines),
    '--protected-path', String(flags.protected_path),
    '--oracle-available', String(flags.oracle_available),
    '--security-surface', String(flags.security_surface),
  ], { cwd: repoRoot, encoding: 'utf8' });
  if (rr.status !== 0) return fail(`resolve-review-loop exited ${rr.status}`);
  const verdict = (rr.stdout || '').trim();
  if (verdict !== 'high' && verdict !== 'low') return fail(`unexpected review_risk "${verdict}"`);
  return verdict === 'high';
}

function gitOut(repoRoot, args) {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function untrackedFiles(repoRoot) {
  const out = gitOut(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  return out === null ? null : out.toString('utf8').split('\0').filter(Boolean);
}

// Line count of a file's bytes; null for binary (contains a NUL).
function textLines(buf) {
  if (buf.includes(0)) return null;
  if (buf.length === 0) return 0;
  let n = 0;
  for (const b of buf) if (b === 10) n++;
  return buf[buf.length - 1] === 10 ? n : n + 1;
}

// -> { files, lines } of the working tree against base (tracked diff + untracked non-ignored files), or null.
function diffSize(repoRoot, baseRef) {
  const tracked = gitOut(repoRoot, ['diff', '--numstat', baseRef, '--']);
  const untracked = untrackedFiles(repoRoot);
  if (tracked === null || untracked === null) return null;
  let files = 0;
  let lines = 0;
  for (const row of tracked.toString('utf8').split('\n')) {
    if (!row) continue;
    const [add, del] = row.split('\t');
    files += 1;
    if (add !== '-' && del !== '-') lines += Number(add) + Number(del);
  }
  for (const f of untracked) {
    files += 1;
    try { lines += textLines(fs.readFileSync(path.join(repoRoot, f))) || 0; } catch (_e) { /* unreadable: 1 file, 0 lines */ }
  }
  return { files, lines };
}

// Unified-0 patch of the working tree against base, untracked files appended as all-additions hunks; null on failure.
function workingTreePatch(repoRoot, baseRef) {
  const tracked = gitOut(repoRoot, ['diff', '--no-ext-diff', '--unified=0', baseRef, '--']);
  const untracked = untrackedFiles(repoRoot);
  if (tracked === null || untracked === null) return null;
  let out = tracked.toString('utf8');
  for (const f of untracked) {
    let buf;
    try { buf = fs.readFileSync(path.join(repoRoot, f)); } catch (_e) { continue; }
    out += `diff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n`;
    if (textLines(buf) === null) { out += 'Binary files /dev/null and b/' + f + ' differ\n'; continue; }
    const body = buf.toString('utf8').replace(/\n$/u, '').split('\n');
    if (buf.length > 0) out += `@@ -0,0 +1,${body.length} @@\n${body.map((l) => `+${l}`).join('\n')}\n`;
  }
  return out;
}

// First rule violated by moving `from` -> `to` with `unitArg`; null when the unit rules hold.
function unitViolation(marker, from, to, unitArg, unitKind) {
  const cur = marker.unit && typeof marker.unit === 'object' ? marker.unit : null;
  if (unitArg) {
    if (unitKind && unitArg.kind !== unitKind) return `unit kind ${unitArg.kind} does not match ${marker.size}'s unit kind ${unitKind}`;
    if (unitArg.index > unitArg.total) return `unit index ${unitArg.index} exceeds total ${unitArg.total}`;
    if (cur) {
      if (unitArg.kind !== cur.kind) return `unit kind is fixed at ${cur.kind}`;
      if (unitArg.total !== cur.total) return `unit total is fixed at ${cur.total}`;
      if (unitArg.index < cur.index) return `unit index cannot regress (${cur.index} -> ${unitArg.index})`;
      if (from === 'verify' && to === 'implement' && unitArg.index !== cur.index && unitArg.index !== cur.index + 1) {
        return `verify -> implement keeps the unit index (${cur.index}) or advances it by one`;
      }
    }
  }
  const eff = unitArg || cur;
  if (from === 'verify' && to !== 'implement' && to !== 'verify' && eff && eff.index !== eff.total) {
    return `leaving the unit loop needs index = total (unit ${eff.index}/${eff.total})`;
  }
  return null;
}

// The cwd's toplevel when it belongs to the marker's repository (worktree-placement plan D5: a session that moved
// into a linked worktree is measured there); null otherwise, so a cwd in another repository never takes over.
function sessionRepoRoot(marker) {
  if (typeof marker.repo_identity !== 'string' || !marker.repo_identity) return null;
  const top = gitOut(process.cwd(), ['rev-parse', '--show-toplevel']);
  const dir = top === null ? '' : top.toString('utf8').trim();
  if (!dir) return null;
  let identity = null;
  try { identity = scopeFromCwd(dir).repo_identity; } catch (_e) { return null; }
  return identity === marker.repo_identity ? dir : null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// D8b Open Q2 default: "## Inputs" section containing a fenced JSON block `{"inputs":[{"id","sha"}]}`.
// Empty `{"inputs":[]}` or absent section/fence => null (no declared inputs, no check).
function extractPlanInputsJson(markdown) {
  if (typeof markdown !== 'string' || !markdown) return null;
  const norm = markdown.replace(/\r\n/g, '\n');
  const heading = /^##[ \t]+Inputs[ \t]*$/im.exec(norm);
  if (!heading) return null;
  const rest = norm.slice(heading.index + heading[0].length).replace(/^\n/, '');
  const nextHeading = /^#{1,2}[ \t]+\S/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const fence = /```(?:json|jsonc)?[ \t]*\n([\s\S]*?)```/i.exec(section);
  if (!fence) return null;
  const raw = fence[1].trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.inputs) && parsed.inputs.length === 0) {
      return null;
    }
  } catch (_e) {
    // Malformed JSON is handed to check-inputs-landed.js so it fails closed rather than skipping.
  }
  return raw;
}

function readTaskCardPlan(repoRoot, sid) {
  if (!sid) return null;
  const cardDir = process.env.AUTOPILOT_TASK_CARD_DIR || path.join(os.homedir(), '.autopilot', 'task-card');
  const safeId = String(sid).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (!safeId) return null;
  try {
    const card = JSON.parse(fs.readFileSync(path.join(cardDir, `${safeId}.json`), 'utf8'));
    if (!card || card.schema !== 'autopilot.task-card/1' || typeof card.plan !== 'string' || !card.plan.trim()) return null;
    const p = path.isAbsolute(card.plan) ? card.plan : path.join(repoRoot, card.plan);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null;
  } catch (_e) {
    return null;
  }
}

function candidatePlanDirs(repoRoot) {
  const dirs = [];
  for (const cfgName of ['project-lifecycle-config.md', 'next-config.md', 'dev-flow-config.md']) {
    try {
      const txt = fs.readFileSync(path.join(repoRoot, '.claude', cfgName), 'utf8');
      const m = /(?:Plans directory|Where plans live)\s*:\s*`?([^`\r\n]+?)`?\s*$/im.exec(txt);
      if (m && m[1] && !path.isAbsolute(m[1])) dirs.push(m[1].replace(/\/+$/, ''));
    } catch (_e) { /* optional */ }
  }
  for (const d of ['project/plans', 'docs/plans']) {
    if (!dirs.includes(d)) dirs.push(d);
  }
  return dirs;
}

function findPlanFromIndex(repoRoot, branch) {
  if (!branch) return null;
  const bRe = new RegExp(`(?:^|\\||\\s)\`?${escapeRegExp(branch)}\`?(?:\\s|\\||$)`);
  for (const idxRel of ['project/projects/INDEX.md', 'docs/projects/INDEX.md']) {
    let txt;
    try { txt = fs.readFileSync(path.join(repoRoot, idxRel), 'utf8'); } catch (_e) { continue; }
    for (const line of txt.split('\n')) {
      if (!line.includes('|') || !bRe.test(line)) continue;
      const link = /\(([^)\s]+\.md)\)/.exec(line);
      if (!link) continue;
      const resolved = path.resolve(path.dirname(path.join(repoRoot, idxRel)), link[1]);
      try {
        if (fs.statSync(resolved).isFile()) return fs.readFileSync(resolved, 'utf8');
      } catch (_e) { /* try next */ }
    }
  }
  return null;
}

function findBranchPlanMarkdown(repoRoot, branch) {
  const fromIdx = findPlanFromIndex(repoRoot, branch);
  if (fromIdx !== null) return fromIdx;

  const IGNORED = new Set(['README.md', 'TEMPLATE.md', 'INDEX.md']);
  const entries = [];
  for (const relDir of candidatePlanDirs(repoRoot)) {
    const absDir = path.join(repoRoot, relDir);
    let names;
    try { names = fs.readdirSync(absDir); } catch (_e) { continue; }
    for (const name of names.sort()) {
      if (!name.endsWith('.md') || IGNORED.has(name)) continue;
      const full = path.join(absDir, name);
      try {
        if (fs.statSync(full).isFile()) entries.push({ name, full });
      } catch (_e) { /* ignore */ }
    }
  }
  if (entries.length === 0) return null;

  if (branch) {
    const branchMetaRe = new RegExp(`\\bBranch\\*\\*?\\s*:\\s*\`?${escapeRegExp(branch)}(?:\`|[\\s,;|)]|$)`, 'i');
    for (const e of entries) {
      try {
        const text = fs.readFileSync(e.full, 'utf8');
        const head = text.split('\n', 40).join('\n');
        if (branchMetaRe.test(head)) return text;
      } catch (_e) { /* ignore */ }
    }
    const slug = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch;
    const flat = branch.replace(/\//g, '-');
    const namePatterns = [slug, flat].filter(Boolean).map((s) => new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}-)?${escapeRegExp(s)}\\.md$`, 'i'));
    for (const e of entries) {
      if (namePatterns.some((re) => re.test(e.name))) {
        try { return fs.readFileSync(e.full, 'utf8'); } catch (_e) { /* ignore */ }
      }
    }
  }

  if (entries.length === 1) {
    try { return fs.readFileSync(entries[0].full, 'utf8'); } catch (_e) { return null; }
  }
  return null;
}

function findSessionPlanMarkdown(repoRoot, sid) {
  const cardPlan = readTaskCardPlan(repoRoot, sid);
  if (cardPlan !== null) return cardPlan;
  const headOut = gitOut(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const branch = headOut === null ? '' : headOut.toString('utf8').trim();
  return findBranchPlanMarkdown(repoRoot, branch);
}

function readConfiguredInputsTarget(repoRoot) {
  const files = [];
  if (process.env.DEV_FLOW_CONFIG_OVERRIDE) files.push(process.env.DEV_FLOW_CONFIG_OVERRIDE);
  if (repoRoot) {
    files.push(path.join(repoRoot, '.claude', 'dev-flow-config.md'));
    files.push(path.join(repoRoot, '.claude', 'qc-gate-config.md'));
  }
  for (const f of files) {
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (_e) { continue; }
    for (const line of txt.split('\n')) {
      const m = /^\s*-\s*inputs_target\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const val = m[1].replace(/^`+|`+$/g, '').replace(/^['"]+|['"]+$/g, '').trim();
      if (val) return val;
    }
  }
  return '';
}

function resolveInputsTarget(repoRoot, marker) {
  const configured = readConfiguredInputsTarget(repoRoot);
  if (configured) return configured;
  if (marker && typeof marker.base_branch === 'string' && marker.base_branch.trim()) {
    return marker.base_branch.trim();
  }
  const pairs = [['develop', 'origin/develop'], ['main', 'origin/main'], ['master', 'origin/master']];
  for (const [local, remote] of pairs) {
    if (gitOut(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}^{commit}`]) !== null) {
      return remote;
    }
    if (gitOut(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${local}^{commit}`]) !== null) {
      return local;
    }
  }
  if (marker && typeof marker.base_ref === 'string' && marker.base_ref.trim()) {
    return marker.base_ref.trim();
  }
  return 'origin/develop';
}

function checkPlanInputsLanded(repoRoot, marker, sid) {
  const rawInputs = extractPlanInputsJson(findSessionPlanMarkdown(repoRoot, sid));
  if (rawInputs === null) return null;
  const target = resolveInputsTarget(repoRoot, marker);
  const inputsFile = path.join(os.tmpdir(), `stage-advance-diff-inputs-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(inputsFile, `${rawInputs}\n`);
  let r;
  try {
    r = spawnSync(process.execPath, [CHECK_INPUTS_LANDED, '--inputs', inputsFile, '--target', target, '--repo', repoRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  } finally {
    try { fs.unlinkSync(inputsFile); } catch (_e) { /* best effort */ }
  }
  if (r.status === 0) return null;
  const stderrText = String(r.stderr || '').trim();
  const failingIds = [];
  for (const line of stderrText.split('\n')) {
    const m = /^NOT-LANDED id=(\S+)/.exec(line.trim());
    if (m) failingIds.push(m[1]);
  }
  const detail = failingIds.length > 0
    ? `inputs not landed on ${target}: ${failingIds.join(', ')}`
    : `inputs check failed against ${target}${stderrText ? `: ${stderrText}` : ''}`;
  return {
    code: 5,
    err: `stage-advance: ${detail}${failingIds.length > 0 && stderrText ? `\n${stderrText}` : ''}`,
    out: { allowed: false, from: 'plan', target, failing_inputs: failingIds, reason: detail },
  };
}

// Pure decision over one marker snapshot. -> { code, err?, out } | { patch, out }
function decide(marker, opts, repoRootArg, sid) {
  const to = opts.to;
  const ids = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8')).node_ids;
  if (!ids.includes(to)) throw new Usage(`unknown node "${to}" (want one of ${ids.join('|')})`);
  const from = typeof marker.stage === 'string' ? marker.stage : null;
  const repoRoot = repoRootArg || sessionRepoRoot(marker) || marker.repo_root || process.cwd();
  const unitArg = opts.unit || null;
  const eff = unitArg || (marker.unit && typeof marker.unit === 'object' ? marker.unit : null);

  // high_risk: sampled once when an urgent session leaves the LAST verify toward a review node.
  let highRisk = marker.high_risk === true;
  let sampled = false;
  if (marker.urgent === true && from === 'verify' && (to === 'code-review' || to === 'qc-gate')
      && (!eff || eff.index === eff.total)) {
    highRisk = sampleHighRisk(repoRoot, marker.base_ref);
    sampled = true;
  }

  const deny = (legalNext, reason) => ({ code: 3, out: { allowed: false, from, to, legal_next: legalNext, reason } });
  const nodes = graphJson(['nodes', ...variantFlags(marker, highRisk)]);
  if (from === null) {
    if (to !== nodes.entry) return deny([nodes.entry], `first write must target the entry node ${nodes.entry} for size ${marker.size}${marker.bug ? ' (bug)' : ''}`);
  } else if (to !== from) {
    const legal = graphJson(['next', '--from', from, ...variantFlags(marker, highRisk, from === 'research')]);
    if (!legal.includes(to)) return deny(legal, `${from} -> ${to} is not an edge for size ${marker.size}`);
  }
  const uv = unitViolation(marker, from, to, unitArg, nodes.unit_kind);
  if (uv) {
    const legal = from === null ? [nodes.entry] : graphJson(['next', '--from', from, ...variantFlags(marker, highRisk, from === 'research')]);
    return deny(legal, uv);
  }

  // D8b Open Q1 default: leaving `plan` runs check-inputs-landed when the session's plan declares `## Inputs`.
  if (from === 'plan' && to !== 'plan') {
    const il = checkPlanInputsLanded(repoRoot, marker, sid);
    if (il) return { code: il.code, err: il.err, out: { ...il.out, from, to } };
  }

  // E1 bump: entering verify or qc-gate.
  if ((to === 'verify' || to === 'qc-gate') && to !== from) {
    const limits = graphJson(['limits', '--size', marker.size]);
    if (limits.files !== null || limits.lines !== null) {
      const base = marker.base_ref || sessionMode.defaultBaseRef(repoRoot);
      const d = base ? diffSize(repoRoot, base) : null;
      if (!d) {
        process.stderr.write('stage-advance: size-bump check skipped (no usable base_ref / git diff failed)\n');
      } else if ((limits.files !== null && d.files > limits.files) || (limits.lines !== null && d.lines > limits.lines)) {
        const bumpTo = sessionMode.SIZES[sessionMode.SIZES.indexOf(marker.size) + 1];
        return { code: 4, out: { bump_to: bumpTo, files: d.files, lines: d.lines } };
      }
    }
  }

  const patch = {};
  if (to !== from) { patch.stage = to; patch.stage_set_at = new Date().toISOString(); }
  if (unitArg) patch.unit = unitArg;
  if (opts.families) patch.review_families = opts.families;
  if (sampled) patch.high_risk = highRisk;
  return { patch, out: { allowed: true, from, to } };
}

// Snapshot of everything decide() reads, to detect a marker change between decision and locked write.
function fingerprint(m) {
  return JSON.stringify([m.stage, m.unit, m.size, m.urgent, m.bug, m.high_risk, m.base_ref, m.level]);
}

const RESUME_HINT = 'fall back to the re-walk in skills/dev-flow/references/context-continuation.md (session-mode.js set, then stage-advance --to from the entry node)';
const RESUME_COPY = ['size', 'bug', 'urgent', 'stage', 'unit', 'base_ref', 'high_risk', 'review_families', 'fleet_task_id', 'coarse_stage'];

// -> { code, err } | { patch }. Pure over the two marker snapshots.
function decideResume(marker, old, oldId, currentId = sessionMode.getSessionId()) {
  const refuse = (why) => ({ code: 6, err: `stage-advance: --resume-from ${oldId} refused: ${why}; ${RESUME_HINT}` });
  if (!old) return refuse('no unexpired readable marker for that session id');
  if (sessionMode.normalizeSessionId(oldId) === currentId) return refuse('that is the current session id');
  if (typeof marker.stage === 'string') return refuse(`this session already has stage ${marker.stage}`);
  if (typeof old.stage !== 'string') return refuse('the old marker has no stage yet');
  if (!sessionMode.SIZES.includes(old.size)) return refuse('the old marker has no size');
  if (typeof old.repo_identity !== 'string' || !old.repo_identity || old.repo_identity !== marker.repo_identity) {
    return refuse('the old marker belongs to a different (or unidentifiable) repository');
  }
  // size only moves up and urgent / bug only turn on (session-mode.js), so a copy that could lower the new marker is
  // refused: the new session must first `set` the same size and flags as the old one.
  if (old.size !== marker.size || (old.urgent === true) !== (marker.urgent === true) || (old.bug === true) !== (marker.bug === true)) {
    const d = (m) => `${m.size}${m.urgent === true ? ' urgent' : ''}${m.bug === true ? ' bug' : ''}`;
    const fix = `node scripts/session-mode.js set --new-task --size ${old.size}${old.urgent === true ? ' --urgent' : ''}${old.bug === true ? ' --bug' : ''}`;
    return refuse(`size/urgent/bug differ (old ${d(old)}, new ${d(marker)}); \`set\` cannot lower the new marker (size only moves up, urgent/bug only turn on), so run \`${fix}\` in the new session to match the old one, then retry`);
  }
  const patch = { stage_set_at: new Date().toISOString() };
  for (const k of RESUME_COPY) if (old[k] !== undefined) patch[k] = old[k];
  return { patch };
}

function runResume(opts, file, sid) {
  const oldId = opts['resume-from'];
  const timeoutMs = Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) > 0
    ? Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) : sessionMode.PHASE_LOCK_TIMEOUT_MS;
  let result = null;
  try {
    withWriteLock({ storeDir: sessionMode.markerDir(), lockFile: `${file}.lock`, name: 'session-mode marker', timeoutMs }, () => {
      const current = sessionMode.readSessionRecord(sid);
      if (!current) { result = { code: 2, err: 'stage-advance: no unexpired session marker for this session (run `session-mode.js set --size <S>` first)', out: null }; return; }
      const d = decideResume(current, sessionMode.readSessionRecord(oldId), oldId, sid);
      if (d.err) { result = { code: d.code, err: d.err, out: null }; return; }
      const next = { ...current, ...d.patch };
      sessionMode.writeMarkerFile(file, next);
      result = { code: 0, out: { allowed: true, resumed_from: sessionMode.normalizeSessionId(oldId), marker_path: file, stage: next.stage, stage_set_at: next.stage_set_at, unit: next.unit, size: next.size } };
    });
  } catch (e) {
    return { code: 1, err: `stage-advance: marker not written: ${e.message}`, out: null };
  }
  return result;
}

function runCoarse(opts, file, sid) {
  const stage = opts.coarse;
  const timeoutMs = Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) > 0
    ? Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) : sessionMode.PHASE_LOCK_TIMEOUT_MS;
  let result = null;
  let written = null;
  try {
    withWriteLock({ storeDir: sessionMode.markerDir(), lockFile: `${file}.lock`, name: 'session-mode marker', timeoutMs }, () => {
      const current = sessionMode.readSessionRecord(sid);
      if (!current) { result = { code: 2, err: 'stage-advance: no unexpired session marker for this session (run `session-mode.js set --size <S>` first)', out: null }; return; }
      const next = { ...current, coarse_stage: stage };
      sessionMode.writeMarkerFile(file, next);
      written = next;
      result = { code: 0, out: { allowed: true, coarse_stage: stage, marker_path: file } };
    });
  } catch (e) {
    return { code: 1, err: `stage-advance: marker not written: ${e.message}`, out: null };
  }
  return afterWrite(result, written, `[stage:${stage}]`, true);
}

function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
    if (opts.unit) opts.unit = parseUnit(opts.unit);
    if (opts['review-families']) opts.families = parseFamilies(opts['review-families']);
  } catch (e) {
    if (e instanceof Usage) return { code: 1, err: `stage-advance: ${e.message}`, out: null };
    throw e;
  }
  if (opts.coarse !== undefined && !COARSE_STAGES.includes(opts.coarse)) {
    return { code: 2, err: `stage-advance: invalid --coarse "${opts.coarse}" (want ${COARSE_STAGES.join('|')})`, out: null };
  }
  if (opts['session-id']) process.env.AUTOPILOT_SESSION_ID = opts['session-id'];
  const repoRootArg = opts['repo-root'] ? path.resolve(opts['repo-root']) : null;
  // dispatch-tree 3b: the marker this process writes comes from the one resolver (--session-id is the explicit id).
  const target = sessionMode.resolveMarkerWriteTarget({ explicitId: opts['session-id'] });
  if (target.refused) return { code: 3, err: `stage-advance: marker write refused (source ${target.source}): ${target.reason}; no file touched`, out: null };
  const sid = target.id;
  const file = path.join(sessionMode.markerDir(), `${sid}.json`);
  if (opts.coarse !== undefined) return runCoarse(opts, file, sid);
  if (opts['resume-from'] !== undefined) return runResume(opts, file, sid);

  const timeoutMs = Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) > 0
    ? Number(process.env.AUTOPILOT_SESSION_MODE_LOCK_TIMEOUT_MS) : sessionMode.PHASE_LOCK_TIMEOUT_MS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const marker = sessionMode.readSessionRecord(sid);
    if (!marker) return { code: 2, err: 'stage-advance: no unexpired session marker for this session (run `session-mode.js set --size <S>` first)', out: null };
    if (!sessionMode.SIZES.includes(marker.size)) return { code: 5, err: 'stage-advance: the marker has no size (run `session-mode.js set --size <S>`)', out: null };
    let d;
    try { d = decide(marker, opts, repoRootArg, sid); } catch (e) {
      if (e instanceof Usage) return { code: 1, err: `stage-advance: ${e.message}`, out: null };
      return { code: 1, err: `stage-advance: ${e.message}`, out: null };
    }
    if (!d.patch) return { code: d.code, err: d.err, out: d.out };
    let result = null;
    let written = null;
    try {
      withWriteLock({ storeDir: sessionMode.markerDir(), lockFile: `${file}.lock`, name: 'session-mode marker', timeoutMs }, () => {
        const current = sessionMode.readSessionRecord(sid);
        if (!current) { result = { code: 2, err: 'stage-advance: marker disappeared while waiting for the lock; nothing written', out: null }; return; }
        if (fingerprint(current) !== fingerprint(marker)) { result = { retry: true }; return; }
        const next = { ...current, ...d.patch };
        sessionMode.writeMarkerFile(file, next);
        written = next;
        result = { code: 0, out: { ...d.out, marker_path: file, stage: next.stage, stage_set_at: next.stage_set_at, unit: next.unit, review_families: next.review_families, high_risk: next.high_risk } };
      });
    } catch (e) {
      return { code: 1, err: `stage-advance: marker not written: ${e.message}`, out: null };
    }
    if (result && !result.retry) return afterWrite(result, written, written ? stageProgressText(written) : null, false);
  }
  return { code: 1, err: 'stage-advance: marker kept changing; nothing written', out: null };
}

function main() {
  const r = run(process.argv.slice(2));
  if (r.err) process.stderr.write(`${r.err}\n`);
  if (r.out) fs.writeSync(1, `${JSON.stringify(r.out)}\n`);
  return r.code;
}

if (require.main === module) process.exit(main());
module.exports = {
  run,
  parseUnit,
  unitViolation,
  extractPlanInputsJson,
  findSessionPlanMarkdown,
  resolveInputsTarget,
};
