'use strict';
// autopilot status — one human/agent-legible control surface over the three
// observation substrates that already exist (never re-derive, always reuse):
//   quota  → scripts/engine-capability-state.js report --capability quota
//   runs   → scripts/dispatch-status.js --list (+ per-live-run --run enrich)
//   roster → scripts/resolve-review-loop.sh --check-scorecard
//
// Subcommands:
//   autopilot status              overview (quota + live runs + roster seats)
//   autopilot status quota [--json] [--probe]
//   autopilot status runs  [--json]
//   autopilot status roster [--json]
//   autopilot status readiness [--json] [--probe]
//
// HONESTY CONTRACT: subscription CLIs (codex/grok/agy) expose no "remaining %"
// programmatically — what we CAN show is the recorded per-pool status, its
// reset_at, and HOW OLD the observation is (quota pools are per-model, not
// per-vendor: the 2026-07-14 lesson — gpt-5.3-codex-spark stayed available
// while gpt-5.5/gpt-5.6-sol were exhausted). `quota --probe` refreshes via
// probe-engine-capability.sh --safe (binary/auth surface only, NO model spend).
// `readiness --probe` is explicit bounded live spend through the readiness
// coordinator. Stale rows are flagged, never silently trusted.

const path = require('path');
const { spawnSync } = require('child_process');
const {
  collectProviderReadiness,
} = require('../readiness/status');
const { collectTaskStatus } = require('./task-runtime');

const ROOT = path.resolve(__dirname, '..', '..');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 30000, cwd: opts.cwd || ROOT });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error || null };
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch (_e) { return null; }
}

function ageLabel(iso, nowMs) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return 'unknown-age';
  const mins = Math.round((nowMs - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// --- quota --------------------------------------------------------------------

function collectQuota() {
  const r = sh('node', [path.join(ROOT, 'scripts', 'engine-capability-state.js'), 'report', '--capability', 'quota']);
  const rows = parseJsonSafe(r.stdout) || [];
  const nowMs = Date.now();
  return rows.map((row) => {
    const q = (row.capability && row.capability.quota) || {};
    const observedMs = Date.parse(String(row.observed_at || ''));
    const ttl = Number(q.ttl_seconds) || 0;
    const stale = Number.isFinite(observedMs) && ttl > 0
      ? (nowMs - observedMs) / 1000 > ttl
      : true;
    return {
      runner: row.runner,
      model: row.model,
      source_class: sourceClassOf(row.runner),
      status: q.status || 'unknown',
      reset_at: q.reset_at || null,
      observed_at: row.observed_at || null,
      observed_age: ageLabel(row.observed_at, nowMs),
      stale,
      evidence: q.evidence || null,
    };
  });
}

function probeQuotaSafe(rows, stderr) {
  // SAFE surface only (binary/--version/auth status) — never a model prompt.
  const probe = path.join(ROOT, 'scripts', 'probe-engine-capability.sh');
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.runner}:${row.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = sh('bash', [probe, 'quota', '--runner', row.runner, '--model', row.model, '--safe'], { timeout: 60000 });
    if (r.status !== 0 && r.status !== null) {
      stderr.write(`probe ${key}: exit ${r.status}\n`);
    }
  }
}

// Engine SOURCE CLASSES have different quota semantics — never render a local
// model as if it had a subscription pool, and never key a metered endpoint's
// wallet on runner+model alone:
//   subscription      OAuth CLIs (codex/grok/agy/claude-native): vendor pools,
//                     PER-MODEL (2026-07-14 lesson), reset windows, no remaining-%.
//   metered-endpoint  token-billed via a named endpoint (cc-shim /
//                     anthropic-compatible): the WALLET identity is the endpoint,
//                     not runner+model. The capability store records exact
//                     runner/model/effort/endpoint tuples for strict admission;
//                     this status surface is non-authorizing telemetry and must
//                     not present endpoint-omitted rows as authoritative.
//   provider-config   pi: metered OR local depending on ~/.pi/agent/models.json.
//   local             no quota concept at all — availability/load is the signal
//                     (no local runner is wired yet; class reserved).
const RUNNER_SOURCE_CLASS = {
  codex: 'subscription',
  grok: 'subscription',
  agy: 'subscription',
  'claude-native': 'subscription',
  'cc-shim': 'metered-endpoint',
  'anthropic-compatible': 'metered-endpoint',
  pi: 'provider-config',
};
const CLASS_CAPTION = {
  subscription: 'vendor pools, PER-MODEL — never extrapolate across models; no remaining-% API, status+reset+age is the ceiling',
  'metered-endpoint': 'token-billed; wallet identity = the NAMED ENDPOINT (DIFFERENT wallet per endpoint). Store records endpoint on exact tuples for admission; this status probe is non-authorizing telemetry and must not treat endpoint-omitted rows as authoritative',
  'provider-config': 'pi routes per ~/.pi/agent/models.json — semantics follow the configured provider (metered or local)',
  local: 'no quota concept — availability/load is the signal',
  unknown: 'unrecognized runner — semantics unknown, verify before relying',
};

function sourceClassOf(runner) {
  return RUNNER_SOURCE_CLASS[runner] || 'unknown';
}

function quotaHuman(rows, stdout) {
  if (rows.length === 0) {
    stdout.write('quota: no recorded observations (run a dispatch, or probe per-model with a tiny codex exec)\n');
    return;
  }
  stdout.write('QUOTA (recorded state, grouped by engine SOURCE CLASS — each class means something different)\n');
  const byClass = new Map();
  for (const r of rows) {
    const cls = sourceClassOf(r.runner);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(r);
  }
  for (const [cls, group] of byClass) {
    stdout.write(`  [${cls}] ${CLASS_CAPTION[cls] || CLASS_CAPTION.unknown}\n`);
    for (const r of group) {
      const flags = [r.stale ? 'STALE' : 'fresh', r.reset_at ? `reset ${r.reset_at}` : null].filter(Boolean).join(', ');
      stdout.write(`    ${r.runner}/${r.model}: ${r.status} (${r.observed_age}; ${flags})\n`);
    }
  }
  stdout.write('note: a model ABSENT here has no fresh observation (TTL-expired or never probed) — treat as unknown, probe before relying.\n');
}

// --- runs ---------------------------------------------------------------------

function collectRuns() {
  const dispatch = path.join(ROOT, 'scripts', 'dispatch-status.js');
  const list = parseJsonSafe(sh('node', [dispatch, '--list']).stdout);
  const runs = Array.isArray(list) ? list : (list && Array.isArray(list.runs) ? list.runs : []);
  const out = [];
  let enriched = 0;
  for (const run of runs) {
    const entry = { ...run };
    const live = !(run.ended_at || run.final_status);
    if (live && run.run_id && enriched < 8) { // cap enrichment: each is a liveness probe
      enriched += 1;
      const s = parseJsonSafe(sh('node', [dispatch, '--run', String(run.run_id)]).stdout);
      if (s) {
        entry.phase = s.phase;
        entry.alive = s.alive;
        entry.stall = s.stall;
        entry.last_event_age_s = s.last_event_age_s;
      }
    }
    out.push(entry);
  }
  return out;
}

function runsHuman(runs, stdout) {
  const live = runs.filter((r) => !(r.ended_at || r.final_status));
  const done = runs.length - live.length;
  stdout.write(`RUNS (${live.length} live, ${done} finished manifests)\n`);
  for (const r of live) {
    const stall = r.stall ? ' STALL(report-only — cross-check before reacting)' : '';
    stdout.write(`  LIVE ${r.run_id} role=${r.role || '?'} ${r.runner || '?'}/${r.model || '?'} phase=${r.phase || '?'} alive=${r.alive}${stall}\n`);
  }
  if (live.length === 0) stdout.write('  (none live)\n');
}

function runsTree(runs) {
  // Shape: each node keeps existing run fields and gains `children: []`; synthetic
  // roots for missing parents are explicit nodes: { synthetic_external: true, run_id,
  // parent_run_id: null, children: [...] }. A node whose parent chain loops back to
  // itself (self-ref or A→B→A cycle — malformed lineage) is routed to `roots` with
  // `cycle_detected: true` instead of being folded: a malformed chain must NEVER
  // silently hide runs (the flat view stays the source of truth).
  const nodeById = new Map();
  for (const run of runs) {
    if (!run || !run.run_id) continue;
    nodeById.set(`${run.run_id}`, { ...run, children: [] });
  }
  // inCycle: walk the parent chain from `startId`; true iff it returns to startId.
  // A missing parent (synthetic external) or parentless ancestor terminates honestly.
  const inCycle = (startId) => {
    const seen = new Set([startId]);
    let cur = nodeById.get(startId);
    while (cur) {
      const p = cur.parent_run_id;
      if (!p) return false;
      const pid = `${p}`;
      if (pid === startId) return true;
      if (seen.has(pid)) return false; // a cycle strictly above startId, handled at its own nodes
      seen.add(pid);
      cur = nodeById.get(pid);
    }
    return false;
  };
  const roots = [];
  const synthetic = new Map();
  for (const node of nodeById.values()) {
    const parent = node.parent_run_id;
    if (!parent) {
      roots.push(node);
      continue;
    }
    const parentId = `${parent}`;
    if (inCycle(`${node.run_id}`)) {
      node.cycle_detected = true;
      roots.push(node);
      continue;
    }
    const parentNode = nodeById.get(parentId);
    if (parentNode) {
      parentNode.children.push(node);
      continue;
    }
    let syn = synthetic.get(parentId);
    if (!syn) {
      syn = {
        synthetic_external: true,
        run_id: parentId,
        role: 'external',
        runner: null,
        model: null,
        phase: null,
        started_at: null,
        ended_at: null,
        final_status: null,
        parent_run_id: null,
        root_run_id: null,
        depth: null,
        children: [],
      };
      synthetic.set(parentId, syn);
      roots.push(syn);
    }
    syn.children.push(node);
  }
  return roots;
}

function runsTreeHuman(nodes, stdout, indent = '') {
  const render = (node, prefix, depth) => {
    const linePrefix = `${indent}${'  '.repeat(depth)}`;
    if (node.synthetic_external) {
      stdout.write(`${linePrefix}SYNTHETIC ROOT (external): ${node.run_id}\n`);
    } else {
      const live = !(node.ended_at || node.final_status);
      const status = live ? 'LIVE' : 'DONE';
      const phase = node.phase || (live ? 'running' : 'exited');
      const alive = node.alive === undefined || node.alive === null ? 'null' : node.alive;
      const stall = node.stall ? ' STALL(report-only — cross-check before reacting)' : '';
      const cycle = node.cycle_detected ? ` CYCLE(parent=${node.parent_run_id} — malformed lineage, flat \`runs\` is the source of truth)` : '';
      stdout.write(`${linePrefix}${status} ${node.run_id} role=${node.role || '?'} ${node.runner || '?'}/${node.model || '?'} phase=${phase} alive=${alive}${stall}${cycle}\n`);
    }
    for (const child of (node.children || [])) render(child, prefix, depth + 1);
  };
  for (const node of nodes) render(node, indent, 0);
}

// --- roster -------------------------------------------------------------------

function collectRoster(cwd) {
  const r = sh('bash', [path.join(ROOT, 'scripts', 'resolve-review-loop.sh'), '--check-scorecard'], { cwd });
  const j = parseJsonSafe(r.stdout);
  if (!j) return null;
  return {
    source: j.source,
    implementer: `${j.implementer_engine}@${j.implementer_effort} (${j.implementer_runner})`,
    reviewer_high_risk: `${j.reviewer_engine}@${j.reviewer_effort} (${j.reviewer_runner})`,
    reviewer_low_risk: j.reviewer_engine_low_risk
      ? `${j.reviewer_engine_low_risk}@${j.reviewer_effort_low_risk}`
      : '(tiering off)',
    on_family_conflict: j.on_family_conflict,
    fallback_preference: j.reviewer_fallback_preference,
    fallback_preference_low_risk: j.reviewer_fallback_preference_low_risk,
    reviewer_qualified: j.reviewer_qualified,
    fallback_ladder: (j.fallback_ladder || []).map((row) => `${row.engine}(${row.runner}${row.effort ? `@${row.effort}` : ''})`),
    qc_panel: j.qc_panel,
  };
}

function rosterHuman(ro, stdout) {
  if (!ro) { stdout.write('roster: resolver unavailable\n'); return; }
  stdout.write(`ROSTER (source: ${ro.source})\n`);
  stdout.write(`  implementer:        ${ro.implementer}\n`);
  stdout.write(`  reviewer high-risk: ${ro.reviewer_high_risk} (qualified=${ro.reviewer_qualified})\n`);
  stdout.write(`  reviewer low-risk:  ${ro.reviewer_low_risk}\n`);
  stdout.write(`  family conflict:    ${ro.on_family_conflict} | preference: ${JSON.stringify(ro.fallback_preference)} low-risk: ${JSON.stringify(ro.fallback_preference_low_risk)}\n`);
  stdout.write(`  fallback ladder:    ${ro.fallback_ladder.join(' > ') || '(empty)'}\n`);
  stdout.write(`  qc panel:           ${JSON.stringify(ro.qc_panel)}\n`);
}

// --- readiness ----------------------------------------------------------------

function readinessHuman(receipt, stdout) {
  stdout.write(`READINESS (${receipt.overall_status})\n`);
  for (const seat of receipt.seats) {
    const selected = seat.selected
      ? ` via ${seat.selected.source}:${seat.selected.tuple.runner}/${seat.selected.tuple.model}`
      : '';
    const axes = seat.failing_axes.length === 0
      ? 'all axes ready'
      : seat.failing_axes
        .map((axis) => `${axis.axis}=${axis.status}:${axis.reason}`)
        .join(', ');
    stdout.write(`  ${seat.seat_id}: ${seat.status}${selected} (${axes})\n`);
  }
  stdout.write(`  receipt: ${receipt.receipt_digest} expires ${receipt.expires_at}\n`);
}

// --- task ---------------------------------------------------------------------

const NEXT_ACTION = Object.freeze({
  mission_terminal_false: 'finish the Mission and issue a terminal receipt',
  mission_terminal_unknown: 'repair or provide the authoritative Mission receipt',
  mission_not_complete: 'satisfy the remaining Mission acceptance and budget predicates',
  campaigns_terminal_false: 'finish every required implementation campaign',
  campaigns_terminal_unknown: 'repair or provide the complete campaign evidence set',
  campaigns_not_terminal: 'finish every required implementation campaign',
  acceptance_unknown: 'repair the Mission-to-campaign acceptance evidence',
  acceptance_not_accepted: 'resolve the first accepted blocker under its current campaign',
  accepted_blockers_present: 'resolve the first accepted blocker under its current campaign',
  product_merged_false: 'execute the sealed required product merge edge',
  product_merged_unknown: 'repair the integration refs or candidate evidence',
  consumer_updated_false: 'execute the sealed required consumer update edge',
  consumer_updated_unknown: 'repair the consumer integration evidence',
  pushed_false: 'push the required integration ref after explicit approval',
  pushed_unknown: 'repair the remote-ref evidence',
  zero_residue_false: 'reap or explicitly preserve owned worktrees and branches, then issue a fresh lifecycle receipt',
  zero_residue_unknown: 'issue and validate a fresh lifecycle residue receipt',
  merge_edges_incomplete: 'execute every required sealed merge edge',
  merge_edges_unknown: 'provide a digest-valid merge preflight or execution receipt',
  merge_execution_unknown: 'execute the sealed merge intent and provide its receipt',
  merge_preflight_unknown: 'produce a fresh sealed merge preflight',
  merge_preflight_not_safe: 'resolve the preflight blockers or approve exact preservation paths',
});

function stateLabel(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'unknown';
}

function taskHuman(receipt, stdout) {
  const labels = [
    `product_merged=${stateLabel(receipt.product_merged)}`,
    `consumer_updated=${stateLabel(receipt.consumer_updated)}`,
    `pushed=${stateLabel(receipt.pushed)}`,
    `zero_residue=${stateLabel(receipt.zero_residue)}`,
  ].join(' ');
  stdout.write(`${receipt.can_close === true ? 'DONE' : 'NOT DONE'} ${labels}\n`);
  if (receipt.can_close !== true) {
    const blocker = receipt.failed_predicates[0] || 'can_close_unknown';
    stdout.write(`Blocker: ${blocker}\n`);
    stdout.write(`Next action: ${NEXT_ACTION[blocker] || 'inspect the JSON evidence and repair this predicate'}\n`);
  }
}

// --- entry --------------------------------------------------------------------

function runStatusCli(argv, {
  stdout = process.stdout,
  stderr = process.stderr,
  cwd = process.cwd(),
  env = process.env,
  collectTask = collectTaskStatus,
} = {}) {
  const args = argv.slice();
  const sub = args[0] && !args[0].startsWith('--') ? args.shift() : 'overview';
  const json = args.includes('--json');
  const tree = args.includes('--tree');
  const probe = args.includes('--probe');
  let rootRunId = null;
  const rootRunIndex = args.indexOf('--root-run-id');
  if (rootRunIndex !== -1) {
    rootRunId = args[rootRunIndex + 1] || null;
    args.splice(rootRunIndex, 2);
  }
  for (const a of args) {
    if (a !== '--json' && a !== '--probe' && !(a === '--tree' && sub === 'runs')) {
      stderr.write(`unknown status argument: ${a}\n`);
      return 2;
    }
  }

  if (sub === 'task') {
    if (!rootRunId) {
      stderr.write('status task requires --root-run-id <id>\n');
      return 2;
    }
    let receipt;
    try {
      receipt = collectTask(rootRunId, { cwd, env });
    } catch (error) {
      stderr.write(`task status: ${error.code || 'unavailable'}: ${error.message}\n`);
      return 1;
    }
    if (json) stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    else taskHuman(receipt, stdout);
    return 0;
  }
  if (rootRunId !== null) {
    stderr.write('--root-run-id is only valid for status task\n');
    return 2;
  }
  if (sub === 'quota') {
    let rows = collectQuota();
    if (probe) { probeQuotaSafe(rows, stderr); rows = collectQuota(); }
    if (json) stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    else quotaHuman(rows, stdout);
    return 0;
  }
  if (sub === 'runs') {
    const runs = collectRuns();
    if (json) stdout.write(`${JSON.stringify(tree ? runsTree(runs) : runs, null, 2)}\n`);
    else if (tree) runsTreeHuman(runsTree(runs), stdout);
    else runsHuman(runs, stdout);
    return 0;
  }
  if (sub === 'roster') {
    const ro = collectRoster(cwd);
    if (json) stdout.write(`${JSON.stringify(ro, null, 2)}\n`);
    else rosterHuman(ro, stdout);
    return 0;
  }
  if (sub === 'readiness') {
    let receipt;
    try {
      receipt = collectProviderReadiness({ cwd, probe });
    } catch (error) {
      stderr.write(`readiness: ${error.code || 'unavailable'}\n`);
      return 1;
    }
    if (json) stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    else readinessHuman(receipt, stdout);
    return 0;
  }
  if (sub === 'overview') {
    if (json) {
      stdout.write(`${JSON.stringify({ quota: collectQuota(), runs: collectRuns(), roster: collectRoster(cwd) }, null, 2)}\n`);
      return 0;
    }
    quotaHuman(collectQuota(), stdout);
    stdout.write('\n');
    runsHuman(collectRuns(), stdout);
    stdout.write('\n');
    rosterHuman(collectRoster(cwd), stdout);
    return 0;
  }
  stderr.write(`unknown status subcommand: ${sub} (quota|runs|roster|readiness|task or no subcommand for overview)\n`);
  return 2;
}

module.exports = { runStatusCli, taskHuman };
