#!/usr/bin/env node
'use strict';

// scaffold-mission.js — generate the /l5 mission scaffold (rubric, sources manifest, execution
// graph, task-authority envelope) from a committed plan, then self-check it with the same
// validators the rail runs. Plan: docs/plans/_archive/2026/10/2026-10-13-l5-mission-scaffold-generator.md.
//
// Exit codes: 0 generated (or --check passed), 1 usage error, 2 pre-check / validation failure
// (nothing is left half-written: a failed write restores or removes every touched file), 3 an output already exists (use --force).
//
// It never edits docs/projects/INDEX.md or .claude/mission-routing-config.json, never runs
// `mission prepare|grant` or the legacy reconcile, and never runs the verification commands:
// those mutate shared state or spend a grant. They are printed as next_steps.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// Paths come from the layout registry (scripts/lib/repo-layout.js), never from literals here.
const LAYOUT = require('./lib/repo-layout.js');
const PLANS_DIR = LAYOUT.path('plans_dir');
const PLANS_ARCHIVE_DIR = LAYOUT.path('plans_archive_dir');
const PROJECTS_INDEX = LAYOUT.path('projects_index');
const MISSIONS_DIR = LAYOUT.path('missions_dir');
const SCRIPTS_DIR = LAYOUT.path('scripts_dir');
const MISSION_ROUTING = LAYOUT.path('mission_routing_config');
const OWNER_KERNEL_GOVERNANCE = LAYOUT.path('owner_kernel_governance');
const { freezeMissionExecutionGraph } = require('../src/engine/mission-execution-graph');
const { resolveMissionPolicy } = require('../src/engine/mission-policy');
const owner = require('../src/engine/owner-kernel');
const graphCheck = require('./mission-execution-graph-check');
const { validBoundedVerifyCommand } = require('./implementation-campaign-check');

const REPEATABLE = new Map([
  ['--output-path', 'outputPaths'], ['--create', 'creates'], ['--required-path', 'requiredPaths'],
  ['--verify-cmd', 'verifyCmds'], ['--allowed-prefix', 'prefixes'],
  ['--required-change-path', 'changePaths'], ['--acceptance-id', 'acceptanceIds'],
]);
const SINGLE = new Map([
  ['--plan', 'plan'], ['--slug', 'slug'], ['--node-id', 'nodeId'], ['--spec-section', 'specSection'],
  ['--objective', 'objective'], ['--rubric', 'rubric'], ['--governance', 'governance'],
  ['--repo-root', 'repoRoot'], ['--out-dir', 'outDir'], ['--authority-out', 'authorityOut'],
  ['--profile', 'profile'], ['--max-changed-files', 'maxChangedFiles'],
  ['--baseline-churn', 'baselineChurn'], ['--max-repair-generations', 'maxRepair'],
  ['--max-wall-seconds', 'maxWall'], ['--languages', 'languages'],
]);
const BOOLEAN = new Map([['--check', 'check'], ['--force', 'force'], ['--no-affected-suites', 'noAffectedSuites']]);

function usage() {
  return [
    'Usage: node scripts/scaffold-mission.js --plan <repo-relative .md> --output-path <p> [--output-path <p>...]',
    '         --verify-cmd <cmd> [--verify-cmd <cmd>...] [options]',
    '',
    'Generates <out-dir>/mission-<slug>-sources.json, <out-dir>/mission-<slug>-execution-graph.json,',
    '<stem>.rubric.md (only when absent) and the task-authority envelope (outside the repo), then',
    'validates them with mission-execution-graph-check.',
    '',
    'Repeatable: --output-path --create --required-path --verify-cmd --allowed-prefix',
    '            --required-change-path --acceptance-id',
    'Single:     --slug --node-id --spec-section --objective --rubric --governance --repo-root',
    '            --out-dir --authority-out --profile --max-changed-files --baseline-churn',
    '            --max-repair-generations --max-wall-seconds --languages',
    'Flags:      --check (validate only, write nothing)  --force (overwrite existing outputs)',
    '            --no-affected-suites (do not append the default affected-suites --run command)',
  ].join('\n');
}

class Refusal extends Error {
  constructor(message, code = 2) { super(message); this.exitCode = code; }
}

function parse(argv) {
  const o = { repeat: {}, check: false, force: false };
  for (const name of REPEATABLE.values()) o.repeat[name] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { o.help = true; continue; }
    if (BOOLEAN.has(arg)) { o[BOOLEAN.get(arg)] = true; continue; }
    const rep = REPEATABLE.get(arg);
    const one = SINGLE.get(arg);
    if (!rep && !one) throw new Refusal(`unknown flag: ${arg}`, 1);
    if (argv[i + 1] === undefined) throw new Refusal(`missing value for ${arg}`, 1);
    if (rep) o.repeat[rep].push(argv[++i]); else o[one] = argv[++i];
  }
  return o;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const unique = (list) => Array.from(new Set(list)).sort();

function git(repo, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Refusal(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
  }
  return r.stdout;
}

function intOpt(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(String(value))) throw new Refusal(`${label} must be a non-negative integer`, 1);
  return Number(value);
}

function mirrorRootsFor(repoRoot) {
  const script = path.join(repoRoot, SCRIPTS_DIR, 'sync-codex-plugin-skills.sh');
  if (!fs.existsSync(script)) return null;
  const r = spawnSync('bash', [script, '--mirror-roots-json'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) throw new Refusal(`mirror roots unavailable: ${String(r.stderr).trim()}`);
  return JSON.parse(r.stdout);
}

function mirrorOf(p, mirror) {
  if (!mirror) return null;
  if (p === mirror.root || p.startsWith(`${mirror.root}/`)) return null;
  return mirror.dirs.some((d) => p === d || p.startsWith(`${d}/`)) ? `${mirror.root}/${p}` : null;
}

function prefixOf(p, mirror) {
  if (mirror && (p === mirror.root || p.startsWith(`${mirror.root}/`))) return mirror.root;
  return p.split('/')[0];
}

function shellToken(s) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function affectedSuitesCommand(paths) {
  return ['node', `${SCRIPTS_DIR}/affected-suites.js`, '--run', '--files', ...paths].map(shellToken).join(' ');
}

function relPath(label, p) {
  if (typeof p !== 'string' || p.length === 0 || p.startsWith('/') || p.includes('\\')
      || path.posix.normalize(p) !== p || p.split('/').some((s) => s === '..' || s === '.')) {
    throw new Refusal(`${label} must be a normalized repo-relative path: ${p}`, 1);
  }
  return p;
}

function build(o) {
  const repoRoot = fs.realpathSync(path.resolve(o.repoRoot || process.cwd()));
  const toplevel = (git(repoRoot, ['rev-parse', '--show-toplevel']) || '').trim();
  if (fs.realpathSync(toplevel) !== repoRoot) throw new Refusal(`--repo-root must be the repository top level (${toplevel})`, 1);
  if (!o.plan) throw new Refusal('--plan is required', 1);
  const plan = relPath('--plan', o.plan);
  if (!/^[^/].*\.md$/.test(plan) || plan.endsWith('.rubric.md')) throw new Refusal('--plan must be a .md plan file', 1);
  const stem = path.posix.basename(plan, '.md');
  const slug = o.slug || stem;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) throw new Refusal('--slug must be a bounded token', 1);
  const nodeId = o.nodeId || slug;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(nodeId)) throw new Refusal('--node-id must be a bounded token', 1);
  const outputs0 = o.repeat.outputPaths.map((p) => relPath('--output-path', p));
  const creates0 = o.repeat.creates.map((p) => relPath('--create', p));
  if (outputs0.length === 0 && creates0.length === 0) throw new Refusal('at least one --output-path is required', 1);
  if (o.repeat.verifyCmds.length === 0) throw new Refusal('at least one --verify-cmd is required', 1);

  // Mission nodes must not run the whole suite. When the caller names the paths this node
  // touches, append the selector that runs only those suites (unless it is already listed).
  let affectedHint = null;
  if (o.noAffectedSuites) {
    affectedHint = null;
  } else if (o.repeat.changePaths.length === 0) {
    affectedHint = 'no affected-suites --run command appended: --required-change-path was empty';
  } else {
    const cmd = affectedSuitesCommand(o.repeat.changePaths);
    if (!o.repeat.verifyCmds.includes(cmd)) o.repeat.verifyCmds.push(cmd);
  }

  // Pre-check 1: verify commands in the shape campaign intake admits (BACKLOG: pipe/quote burned an attempt).
  for (const cmd of o.repeat.verifyCmds) {
    if (!validBoundedVerifyCommand(cmd)) {
      throw new Refusal(`verify_cmd rejected by campaign intake (bounded space-delimited argv, no pipe, quote, redirect, ";" or "$"): ${cmd}`);
    }
  }
  if (o.repeat.verifyCmds.join(' && ').length > 4096) throw new Refusal('verification_commands projection exceeds 4096 characters');
  if (new Set(o.repeat.verifyCmds).size !== o.repeat.verifyCmds.length) throw new Refusal('--verify-cmd entries must be unique');

  // Pre-check 2: the plan is committed and clean (spec.path is read at the base commit).
  const planAbs = path.join(repoRoot, plan);
  if (!fs.existsSync(planAbs)) throw new Refusal(`plan not found: ${plan}`);
  if (git(repoRoot, ['cat-file', '-e', `HEAD:${plan}`], { allowFail: true }) === null) {
    throw new Refusal(`plan is not committed at HEAD (spec.path would be missing at base): ${plan}`);
  }
  if (git(repoRoot, ['status', '--porcelain', '--', plan]).trim() !== '') {
    throw new Refusal(`plan has uncommitted changes; commit it first so its sha matches the base: ${plan}`);
  }
  const specSection = o.specSection || 'Deliverable contract';
  const heading = new RegExp(`^ {0,3}#{1,6}\\s+${specSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const planText = fs.readFileSync(planAbs, 'utf8');
  if (!planText.split(/\r?\n/).some((line) => heading.test(line))) {
    throw new Refusal(`plan lacks a heading "${specSection}" (campaign.spec.section); add it or pass --spec-section`);
  }

  // Pre-check 3: plan registered active in docs/projects/INDEX.md.
  const gate = require('./check-plan-graduation.js');
  const indexExists = fs.existsSync(path.join(repoRoot, PROJECTS_INDEX));
  const m = plan.match(new RegExp(`^${PLANS_DIR.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')}/([^/]+)\\.md$`));
  let registerRow = null;
  if (indexExists && m) {
    const reg = gate.planIndexRegistration(repoRoot, m[1]);
    if (!reg.activeRow) {
      registerRow = gate.registerTemplateRow(repoRoot, path.join(repoRoot, PLANS_DIR),
        path.join(repoRoot, PLANS_ARCHIVE_DIR), m[1]);
      throw new Refusal(`spec_plan_unregistered: paste into ${PROJECTS_INDEX} (Version "active"): ${registerRow}`);
    }
  }

  // Rubric: reuse, or generate through the existing scaffold.
  const rubric = o.rubric ? relPath('--rubric', o.rubric) : `${plan.slice(0, -3)}.rubric.md`;
  const rubricAbs = path.join(repoRoot, rubric);
  const rubricExisted = fs.existsSync(rubricAbs);

  const mirror = mirrorRootsFor(repoRoot);
  const outDir = relPath('--out-dir', o.outDir || MISSIONS_DIR);
  const sourcesRel = `${outDir}/mission-${slug}-sources.json`;
  const graphRel = `${outDir}/mission-${slug}-execution-graph.json`;
  const governancePath = path.resolve(repoRoot, o.governance || OWNER_KERNEL_GOVERNANCE);
  if (!fs.existsSync(governancePath)) throw new Refusal(`governance file not found: ${governancePath}`);

  const common = fs.realpathSync(path.resolve(repoRoot, (git(repoRoot, ['rev-parse', '--git-common-dir']) || '').trim()));
  // null = default name, completed in generate() with the graph digest so two worktrees cannot overwrite each other.
  const authorityOut = o.authorityOut ? path.resolve(o.authorityOut) : null;

  // Path closure: mirrors of every output, required = existing inputs only.
  const createSet = new Set(creates0);
  const outputs = new Set([...outputs0, ...creates0]);
  const created = new Set(createSet);
  for (const p of [...outputs]) {
    const mir = mirrorOf(p, mirror);
    if (mir) { outputs.add(mir); if (createSet.has(p)) created.add(mir); }
  }
  const required = new Set([plan, rubric, ...o.repeat.requiredPaths.map((p) => relPath('--required-path', p))]);
  for (const p of outputs) if (!created.has(p)) required.add(p);
  for (const p of o.repeat.requiredPaths) { const mir = mirrorOf(p, mirror); if (mir) required.add(mir); }
  const requiredList = [...required].filter((p) => !created.has(p));
  const outputList = unique([...outputs]);

  // Pre-check 4: every required (existing-input) path exists at HEAD; a file the hand will CREATE
  // belongs in --create (listing it as required burned an attempt on 2026-09-15).
  const absent = requiredList.filter((p) => p !== rubric
    && git(repoRoot, ['cat-file', '-e', `HEAD:${p}`], { allowFail: true }) === null);
  if (absent.length > 0) {
    throw new Refusal(`required path(s) absent at HEAD (pass --create for files the hand will create, or commit them): ${absent.join(', ')}`);
  }

  const prefixes = o.repeat.prefixes.length > 0
    ? unique(o.repeat.prefixes.map((p) => relPath('--allowed-prefix', p).replace(/\/$/, '')))
    : unique([...outputList, ...requiredList].map((p) => prefixOf(p, mirror)));

  const maxChanged = intOpt(o.maxChangedFiles, outputList.length + 8, '--max-changed-files');
  const baselineChurn = intOpt(o.baselineChurn, 1600, '--baseline-churn');
  const maxRepair = intOpt(o.maxRepair, 2, '--max-repair-generations');
  const maxWall = intOpt(o.maxWall, 3600, '--max-wall-seconds');
  const profile = o.profile || 'standard';

  return {
    repoRoot, plan, rubric, rubricAbs, rubricExisted, stem, slug, nodeId, mirror, outDir, sourcesRel, graphRel,
    governancePath, authorityOut, common, outputList, requiredList, created: unique([...created]), prefixes,
    maxChanged, baselineChurn, maxRepair, maxWall, profile, specSection, planText,
    verifyCmds: o.repeat.verifyCmds, changePaths: o.repeat.changePaths, acceptanceIds: o.repeat.acceptanceIds,
    affectedHint,
    objective: o.objective, languages: (o.languages || 'javascript').split(',').filter(Boolean),
  };
}

function ensureRubric(b, scratch) {
  if (b.rubricExisted) return fs.readFileSync(b.rubricAbs);
  const target = scratch || b.rubricAbs;
  const r = spawnSync(process.execPath, [path.join(ROOT, SCRIPTS_DIR, 'plan-rubric-scaffold.js'), '--plan', b.plan, '--out', target], {
    cwd: b.repoRoot, encoding: 'utf8',
  });
  if (r.status !== 0) throw new Refusal(`rubric generation failed (${String(r.stderr).trim()}); write ${b.rubric} by hand with R<n>: lines`);
  return fs.readFileSync(target);
}

function scratchDirOf(b) {
  // Scratch lives inside the common dir (never tracked, never in the shared temp root).
  const dir = path.join(b.common, 'autopilot-scaffold', `scratch-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generate(b, o) {
  const governance = JSON.parse(fs.readFileSync(b.governancePath, 'utf8'));
  const missionPolicy = resolveMissionPolicy(governance);
  const planBytes = fs.readFileSync(path.join(b.repoRoot, b.plan));
  // The scratch dir holds the rubric render (--check must leave the repo untouched) and the
  // manifest the validator's own loader reads; main() removes it.
  const scratchDir = scratchDirOf(b);
  const rubricBytes = ensureRubric(b, path.join(scratchDir, 'rubric.render.md'));
  const planSha = sha256(planBytes);
  const rubricSha = sha256(rubricBytes);

  // Sources manifest paths are relative to the manifest dir, which must contain plan and rubric.
  const rel = (p) => path.posix.relative(b.outDir, p);
  for (const p of [b.plan, b.rubric]) {
    if (rel(p).startsWith('..')) throw new Refusal(`--out-dir ${b.outDir} must contain ${p} (manifest paths stay under the manifest root)`, 1);
  }
  const sources = {
    schema_version: 1,
    sources: [{ plan_path: rel(b.plan), rubric_path: rel(b.rubric), plan_sha256: planSha, rubric_sha256: rubricSha }],
  };

  // Content-bound ids come from the validator's own loader, over the exact bytes we will write.
  const tmp = path.join(scratchDir, 'src');
  fs.mkdirSync(path.join(tmp, path.posix.dirname(rel(b.plan))), { recursive: true });
  fs.mkdirSync(path.join(tmp, path.posix.dirname(rel(b.rubric))), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel(b.plan)), planBytes);
  fs.writeFileSync(path.join(tmp, rel(b.rubric)), rubricBytes);
  fs.writeFileSync(path.join(tmp, 'sources.json'), `${JSON.stringify(sources)}\n`);
  const coverage = graphCheck.loadSourceCoverageManifest(path.join(tmp, 'sources.json'));

  const rubricNumbers = rubricBytes.toString('utf8').split(/\r?\n/)
    .map((l) => l.match(/^(?:#{2,6}\s+|\s*-\s+)?(R[0-9]+)(?:\s|:|$)/)).filter(Boolean).map((x) => x[1]);
  const acceptanceIds = b.acceptanceIds.length > 0 ? b.acceptanceIds : unique(rubricNumbers.map((id) => `accept-${id}`));

  const campaign = {
    profile: b.profile,
    allowed_path_prefixes: b.prefixes,
    max_changed_files: b.maxChanged,
    baseline_churn: b.baselineChurn,
    max_growth_ratio: 1.5,
    max_extra_churn: Math.floor(b.baselineChurn * 0.5 + 1e-9),
    max_repair_generations: b.maxRepair,
    max_wall_seconds: b.maxWall,
    spec: { path: b.plan, section: b.specSection },
    required_paths: b.requiredList,
    output_paths: b.outputList,
  };
  if (b.created.length > 0) campaign.authorized_creates = b.created;
  if (b.changePaths.length > 0) campaign.required_change_paths = unique(b.changePaths);
  const graphInput = {
    schema_version: 1,
    artifact_type: 'mission_execution_graph',
    nodes: [{
      id: b.nodeId,
      source_plan_ids: coverage.planIds,
      source_rubric_ids: coverage.rubricIds,
      dependencies: [],
      acceptance_ids: acceptanceIds,
      verification_commands: b.verifyCmds,
      gate_attempt_budget: b.maxRepair + 1,
      reservation: {
        campaigns: 1, wall_seconds: Math.max(10800, b.maxWall), tool_calls: 450, engine_attempts: 2,
        external_wait_seconds: 1800, canonical_changed_files: b.maxChanged, output_bytes: 8000000,
      },
      campaign,
    }],
  };
  const frozen = freezeMissionExecutionGraph(graphInput, missionPolicy.policy || missionPolicy);

  const resolved = owner.resolveGovernancePolicy(governance);
  const authority = owner.freezeTaskAuthorityEnvelope({
    taskId: `scaffold-${b.slug}`.slice(0, 128),
    policy: resolved.policy,
    policyHash: resolved.policy_hash,
    intent: {
      objective: b.objective || (b.planText.match(/^#\s+(.+)$/m) || [null, b.slug])[1].trim().slice(0, 500),
      requirements_hash: planSha,
      scope: {
        task_classes: ['implementation'], domains: ['repository'], languages: b.languages,
        allowed_tools: [], artifact_roots: b.prefixes,
      },
    },
    acceptance: { contract_hash: planSha, criteria_hash: rubricSha, required_evidence: ['tests'] },
    redLineAdditions: [],
    effectPermissions: { effects: [] },
    resourceCeiling: {
      max_tokens: 20000000, max_wall_seconds: b.maxWall * 3, max_tool_calls: 450,
      max_cost_usd_micros: 0, max_grant_ttl_seconds: b.maxWall * 3,
    },
    dataEgressRules: [],
    escalationPolicy: {
      on_role_denied: 'block', on_scope_mismatch: 'block', protected_effects_require_escalation: true,
    },
    finishReceiptSchema: {
      schema_id: 'finish-receipt-v1',
      required_fields: ['authority_status', 'decisions_outside_user_intent', 'effective_profile', 'evidence'],
    },
    missionAuthority: { repoIdentity: `git-common-dir:${b.common}`, graphDigest: frozen.graph_digest },
  });
  if (!b.authorityOut) {
    b.authorityOut = path.join(b.common, 'autopilot-scaffold', `${b.slug}-${frozen.graph_digest.slice(0, 12)}-authority.json`);
  }
  return { sources, graph: frozen.graph, graphDigest: frozen.graph_digest, authority: authority.envelope,
    planSha, rubricSha, rubricBytes, scratchDir, missionPolicy };
}

function writeAll(b, g, o) {
  const targets = [
    [path.join(b.repoRoot, b.sourcesRel), `${JSON.stringify(g.sources, null, 2)}\n`],
    [path.join(b.repoRoot, b.graphRel), `${JSON.stringify(g.graph, null, 2)}\n`],
    [b.authorityOut, `${JSON.stringify(g.authority, null, 2)}\n`],
  ];
  if (!b.rubricExisted) targets.unshift([b.rubricAbs, g.rubricBytes]);
  if (!o.force) {
    for (const [file] of targets) {
      if (fs.existsSync(file) && !(file === b.rubricAbs && b.rubricExisted)) {
        throw new Refusal(`output exists (use --force): ${path.relative(b.repoRoot, file) || file}`, 3);
      }
    }
  }
  // Snapshot what exists so a failure restores it byte for byte (--force) or removes the new file.
  const before = new Map(targets.map(([file]) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
  const touched = [];
  const madeDirs = [];
  try {
    for (const [file, content] of targets) {
      touched.push(file);
      // Remember each directory this run creates (outermost first) so a failure removes only those.
      const missing = [];
      for (let d = path.dirname(file); !fs.existsSync(d); d = path.dirname(d)) missing.unshift(d);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      madeDirs.push(...missing);
      fs.writeFileSync(file, content);
    }
    validate(b, g.graphDigest, g.scratchDir);
  } catch (error) {
    const unrestored = [];
    for (const file of touched) {
      try {
        if (before.get(file) === null) fs.rmSync(file, { force: true });
        else fs.writeFileSync(file, before.get(file));
      } catch (restoreError) { unrestored.push(`${file} (${restoreError.message})`); }
    }
    for (const dir of madeDirs.reverse()) {
      try { fs.rmdirSync(dir); } catch (_e) { /* only empty directories created by this run */ }
    }
    if (unrestored.length > 0) {
      fs.writeSync(2, `scaffold-mission: ROLLBACK INCOMPLETE, restore by hand: ${unrestored.join('; ')}\n`);
    }
    throw error instanceof Refusal ? error : new Refusal(error.message);
  }
}

function validate(b, expectedDigest, scratchDir, overrides = {}) {
  const mirrorFile = b.mirror ? path.join(scratchDir, 'mirror-roots.json') : null;
  if (mirrorFile) fs.writeFileSync(mirrorFile, JSON.stringify(b.mirror));
  const result = graphCheck.inspect({
    graph: overrides.graph || path.join(b.repoRoot, b.graphRel),
    governance: b.governancePath,
    sources: overrides.sources || path.join(b.repoRoot, b.sourcesRel),
    mirrorRoots: mirrorFile || undefined,
    repoRoot: b.repoRoot,
  });
  if (result.graph_digest !== expectedDigest) throw new Error('graph digest differs from the generated graph');
  return result;
}

function nextSteps(b, g) {
  const rel = (p) => path.relative(b.repoRoot, p) || p;
  const lineage = g.authority.mission_lineage_id;
  return {
    commit: `git add ${b.rubric} ${b.sourcesRel} ${b.graphRel} && git commit (required_paths must exist at base; the envelope stays outside the repo)`,
    verify_at_base: 'run every verification_commands entry in a DETACHED scratch checkout of the base commit before sealing',
    routing_config: `${MISSION_ROUTING} -> {"schema_version":1,"graph_path":"${b.graphRel}","sources_path":"${b.sourcesRel}"}`,
    legacy_reconcile: `node ${SCRIPTS_DIR}/mission-terminal-reconcile.js legacy --repo-root . --graph-digest ${g.graphDigest}`,
    prepare: `node bin/autopilot.js mission prepare --repo . --authority ${rel(b.authorityOut)} --graph ${b.graphRel} --out prepared.json`,
    grant: `node bin/autopilot.js mission grant --repo . --prepared prepared.json --node ${b.nodeId}`,
    dispatch_env: 'export ONLY AUTOPILOT_LEVEL=l5 and AUTOPILOT_ROOT_RUN_ID=<contract.mission_runtime.root_run_id>; never AUTOPILOT_SESSION_ID; do not pass --campaign-ledger',
    mission_lineage_id: lineage,
  };
}

function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) { process.stdout.write(`${usage()}\n`); return 0; }
  const b = build(o);
  let g = null;
  try {
    g = generate(b, o);
    if (o.check) {
      // Validate the in-memory artifacts through scratch files; the repo is left untouched.
      const tmp = path.join(g.scratchDir, 'check');
      fs.mkdirSync(path.join(tmp, path.dirname(b.plan)), { recursive: true });
      fs.mkdirSync(path.join(tmp, path.dirname(b.rubric)), { recursive: true });
      fs.mkdirSync(path.join(tmp, b.outDir), { recursive: true });
      fs.copyFileSync(path.join(b.repoRoot, b.plan), path.join(tmp, b.plan));
      fs.writeFileSync(path.join(tmp, b.rubric), g.rubricBytes);
      fs.writeFileSync(path.join(tmp, b.sourcesRel), JSON.stringify(g.sources));
      fs.writeFileSync(path.join(tmp, b.graphRel), JSON.stringify(g.graph));
      validate(b, g.graphDigest, g.scratchDir, { graph: path.join(tmp, b.graphRel), sources: path.join(tmp, b.sourcesRel) });
    } else {
      writeAll(b, g, o);
    }
  } finally {
    const scaffoldDir = path.join(b.common, 'autopilot-scaffold');
    fs.rmSync(path.join(scaffoldDir, `scratch-${process.pid}`), { recursive: true, force: true });
    try { fs.rmdirSync(scaffoldDir); } catch (_e) { /* not empty (envelopes live here) or absent */ }
  }
  const out = {
    status: o.check ? 'CHECKED' : 'GENERATED',
    plan: b.plan,
    rubric: b.rubric,
    rubric_generated: !b.rubricExisted && !o.check,
    sources: b.sourcesRel,
    graph: b.graphRel,
    authority: o.check ? null : b.authorityOut,
    plan_sha256: g.planSha,
    rubric_sha256: g.rubricSha,
    graph_digest: g.graphDigest,
    output_paths: b.outputList,
    required_paths: b.requiredList,
    next_steps: nextSteps(b, g),
    ...(b.affectedHint ? { hints: [b.affectedHint] } : {}),
  };
  fs.writeSync(1, `${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    fs.writeSync(2, `scaffold-mission: ${error.message}\n`);
    process.exitCode = error instanceof Refusal ? error.exitCode : 2;
  }
}

module.exports = { build, generate, parse };
