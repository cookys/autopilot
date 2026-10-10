#!/usr/bin/env node
'use strict';

// mission-terminal-reconcile — retire the exact legacy B/C Mission terminals so a
// later graph can seal cleanly. Deliberately hardcoded to ONE graph (`LEGACY`):
// exact validation, immutable disposition, no generic registry surgery.
//
// If you are here to generalize it into a disposition table, read this first —
// measured 2026-08-06 against the second real case, the archived next-touch graph
// `c1c6f577…`, which had accumulated SIX same-graph adoptions (a1×3, a2, aborted,
// final) from retries. Two layers block re-admission of such a graph:
//
//   1. AMBIGUITY — five adoptions carry a valid `outcome: ready` terminal for the
//      same node, so mission-routing-admission.js fails MISSION_EVIDENCE_AMBIGUOUS
//      (it refuses to guess which history is authoritative). Selecting one is
//      already expressible: the loader honours an explicit terminal receipt and
//      skips non-matching candidates.
//   2. MISSING WORK ORDER — and this is the one that makes generalization more
//      than a constant swap. Once a canonical terminal is selected, admission
//      REQUIRES that terminal's exact controller Work Order, because treating a
//      missing WO as a first run would replay an effectful node. For the canonical
//      final adoption `fcca6ea6…` the terminal receipt names campaign
//      `campaign-v1-97a4ceae…`, and no Work Order for it exists under
//      `.git/autopilot/work-orders/`. Synthesizing one is not an option — that WO
//      requirement IS the replay protection.
//
// The `rollover` subcommand below is the answer to that second layer, and the
// escape hatch above turned out NOT to be one in practice: a different graph digest
// is indeed filtered out by the admission loader, but `.claude/mission-routing-config.json`
// still pointed at the ARCHIVED project's graph, so nothing was ever sealing a
// different digest. The ambiguity blocked every new Mission in the repo, not just a
// re-admission of the completed one. (2026-08-07)
//
// What makes skipping the Work Order sound for a rolled-over route: issuing a
// rollover requires proving the canonical adoption's `observed_head` is an ANCESTOR
// OF HEAD. The WO requirement exists to stop a missing WO being read as "first run"
// and replaying an effectful node; a node whose output is already in shipped history
// cannot be replayed. That is a stronger guarantee than the WO, not a weaker one,
// and it is the single assumption the whole exemption rests on — see the ancestry
// case in hooks/tests/mission-terminal-rollover.test.sh, which is negative-controlled.
//
// The durable fix is still upstream in src/mission/runtime.js: it fences a same-graph
// adoption only while the prior mission is UNRESOLVED, so every retry after a
// COMPLETE mints another permanent "current ready" terminal. Rollover retires them
// after the fact; retiring them AT CLOSE would stop the ambiguity accruing at all.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const mission = require('../src/engine/mission-convergence');

const HEX64 = /^[a-f0-9]{64}$/;
const LEGACY = Object.freeze({
  adoption_key: 'baa18c972660cf5a67783e507a83849e4a3c6ccd61ba93bdf29a31ba893d9d3e',
  graph_digest: 'd904c9d1042c9e78d85c8084c5449e9fe0be381c96870c1efd1318c294baab96',
  git_history_anchor: 'b658b69f059b0737c7253a9f54e84ec9c1a31287',
  terminals: Object.freeze([
    Object.freeze({ graph_node_id: 'correctness-gates', receipt_digest: '3abc74dc35b08b177871854cdb218f7d94bfaf0793ad0704060515753974de16' }),
    Object.freeze({ graph_node_id: 'evidence-eval-truth', receipt_digest: 'b17b7d15915ac911960b574c928c588671f0ef1802b2ba3f67a9b580e43bb358' }),
  ]),
});

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function digestBody(value, digestKey = 'receipt_digest') {
  const body = { ...value }; delete body[digestKey]; return sha256(canonicalJson(body));
}
function canonicalPaths(repoRoot) {
  const root = fs.realpathSync(execFileSync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const common = fs.realpathSync(execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  return { root, common, missionRoot: path.join(common, 'autopilot', 'mission') };
}
function dispositionPath(common) { return path.join(common, 'autopilot', 'mission', 'legacy-terminal-dispositions.json'); }
function rolloverPath(common) { return path.join(common, 'autopilot', 'mission', 'terminal-rollovers.json'); }

// rollover — retire the SUPERSEDED same-graph adoptions a retry chain leaves behind.
//
// runtime.js fences a same-graph adoption only while the prior Mission is UNRESOLVED.
// Once it reaches COMPLETE the fence lifts, so every retry after a completion mints
// another permanent "current ready" terminal, and nothing ever retires them. Six
// attempts at one graph therefore leave five COMPLETE adoptions that all look
// authoritative, and admission refuses to guess between them.
//
// This does NOT decide which attempt "won" by chronology or by preference. It accepts
// a caller-named canonical adoption and then refuses it unless the evidence proves it
// is the integrated one — the burden is on the claim, not on the reviewer.
//
// The load-bearing check is `observed_head` being an ancestor of HEAD. That is what
// lets admission safely skip the controller Work Order requirement for this route.
// The WO exists to prevent replaying an effectful node; a node whose output is
// provably already in shipped history cannot be replayed by definition. Anything
// weaker (a receipt that merely SAYS integrated) would not carry that argument, which
// is why integration_state alone is insufficient here.
function rolloverMissionTerminals({ repoRoot, graphDigest, canonicalAdoption }) {
  const { root, common, missionRoot } = canonicalPaths(repoRoot);
  if (!HEX64.test(graphDigest || '')) fail('ROLLOVER_GRAPH', 'graph digest is required');
  if (!HEX64.test(canonicalAdoption || '')) fail('ROLLOVER_CANONICAL', 'canonical adoption key is required');

  const registry = JSON.parse(fs.readFileSync(path.join(missionRoot, 'registry.json'), 'utf8'));
  const missions = registry.missions || {};

  const sameGraph = Object.entries(missions)
    .filter(([, v]) => v && v.mission_graph_digest === graphDigest)
    .map(([key, v]) => {
      const state = JSON.parse(fs.readFileSync(path.join(missionRoot, v.state_ref), 'utf8'));
      mission.validateMissionState(state);
      return { key, entry: v, state };
    });
  if (sameGraph.length === 0) fail('ROLLOVER_REGISTRY', 'no adoption of that graph exists');

  const canonical = sameGraph.find((a) => a.key === canonicalAdoption);
  if (!canonical) fail('ROLLOVER_CANONICAL', 'canonical adoption does not belong to that graph');
  if (canonical.state.state !== 'COMPLETE') fail('ROLLOVER_CANONICAL', 'canonical adoption is not COMPLETE');

  // The canonical adoption's ready terminals must each resolve to exactly one
  // journal receipt whose recomputed digest matches. Ambiguity or corruption here
  // means we cannot identify what was integrated, so nothing is retired.
  const terminals = [];
  const journalDir = path.join(missionRoot, 'journals', canonicalAdoption);
  for (const [nodeId, progress] of Object.entries(canonical.state.graph_progress || {})) {
    if (!progress || progress.status !== 'ready') continue;
    const digest = progress.last_receipt_digest;
    if (!HEX64.test(digest || '')) fail('ROLLOVER_TERMINAL', `${nodeId} has no canonical terminal receipt digest`);
    const matches = fs.readdirSync(journalDir)
      .filter((n) => n.endsWith('.applied.json'))
      .map((n) => JSON.parse(fs.readFileSync(path.join(journalDir, n), 'utf8')))
      .filter((r) => r.receipt_digest === digest);
    if (matches.length !== 1 || matches[0].outcome !== 'ready'
        || matches[0].artifact_type !== 'campaign_terminal_receipt'
        || matches[0].graph_node_id !== nodeId
        || digestBody(matches[0]) !== digest) {
      fail('ROLLOVER_JOURNAL', `${nodeId} terminal receipt is absent, ambiguous, or corrupt`);
    }
    terminals.push({ graph_node_id: nodeId, receipt_digest: digest });
  }
  if (terminals.length === 0) fail('ROLLOVER_TERMINAL', 'canonical adoption has no ready terminal');

  // Integration proof. Every field is required; a receipt that claims integration
  // while still owning branches or worktrees has not finished.
  const evidenceRoots = fs.readdirSync(missionRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => path.join(missionRoot, d.name, canonicalAdoption))
    .filter((p) => fs.existsSync(p));
  let integration = null;
  for (const base of evidenceRoots) {
    for (const attempt of fs.readdirSync(base).filter((n) => n.startsWith('attempt-'))) {
      const bundle = path.join(base, attempt, 'authority', 'terminal-bundle.json');
      const lifecycle = path.join(base, attempt, 'terminal', 'icc-lifecycle-receipt.json');
      if (!fs.existsSync(bundle) || !fs.existsSync(lifecycle)) continue;
      const B = JSON.parse(fs.readFileSync(bundle, 'utf8'));
      const L = JSON.parse(fs.readFileSync(lifecycle, 'utf8'));
      if (B.integration_state !== 'integrated') continue;
      if (L.zero_residue !== true) continue;
      if (Array.isArray(L.branches) && L.branches.length !== 0) continue;
      if (!/^[0-9a-f]{40}$/.test(L.observed_head || '')) continue;
      integration = { observed_head: L.observed_head, attempt, evidence_dir: path.relative(common, path.join(base, attempt)) };
      break;
    }
    if (integration) break;
  }
  if (!integration) fail('ROLLOVER_INTEGRATION', 'canonical adoption has no integrated, zero-residue terminal evidence');

  // THE check that makes skipping the Work Order safe.
  try {
    execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', integration.observed_head, 'HEAD'], { stdio: 'ignore' });
  } catch {
    fail('ROLLOVER_NOT_SHIPPED', `observed_head ${integration.observed_head} is not an ancestor of HEAD; the node's output is not in shipped history so a replay is still possible`);
  }

  const superseded = sameGraph
    .filter((a) => a.key !== canonicalAdoption && a.state.state === 'COMPLETE')
    .map((a) => ({ adoption_key: a.key, state: a.state.state, disposition: `superseded_by:${canonicalAdoption}` }))
    .sort((x, y) => (x.adoption_key < y.adoption_key ? -1 : 1));
  const retained = sameGraph
    .filter((a) => a.key !== canonicalAdoption && a.state.state !== 'COMPLETE')
    .map((a) => ({ adoption_key: a.key, state: a.state.state, disposition: 'retained_non_complete' }))
    .sort((x, y) => (x.adoption_key < y.adoption_key ? -1 : 1));

  const body = {
    schema_version: 1,
    artifact_type: 'mission_terminal_rollover',
    repo_identity: `git-common-dir:${common}`,
    mission_graph_digest: graphDigest,
    integrated_adoption_key: canonicalAdoption,
    integrated_terminals: terminals.sort((x, y) => (x.graph_node_id < y.graph_node_id ? -1 : 1)),
    integration_observed_head: integration.observed_head,
    integration_evidence_dir: integration.evidence_dir,
    superseded,
    retained,
    synthesized_work_orders: 0,
    mutated_receipts: 0,
    history_rewritten: false,
  };
  const artifact = { ...body, rollover_digest: sha256(canonicalJson(body)) };

  const target = rolloverPath(common);
  let store = { schema_version: 1, artifact_type: 'mission_terminal_rollovers', rollovers: {} };
  if (fs.existsSync(target)) store = JSON.parse(fs.readFileSync(target, 'utf8'));
  const existing = store.rollovers && store.rollovers[graphDigest];
  if (existing) {
    if (canonicalJson(existing) === canonicalJson(artifact)) return { status: 'ROLLED_OVER', ...artifact, writes: 0 };
    fail('ROLLOVER_REPLAY', 'an different rollover already exists for this graph; refusing to overwrite a recorded disposition');
  }
  store.rollovers = { ...(store.rollovers || {}), [graphDigest]: artifact };
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
  return { status: 'ROLLED_OVER', ...artifact, writes: 1 };
}

function reconcileLegacyMissionTerminals({ repoRoot, currentGraphDigest }) {
  const { root, common, missionRoot } = canonicalPaths(repoRoot);
  if (!HEX64.test(currentGraphDigest || '')) fail('LEGACY_RECONCILE_GRAPH', 'current graph digest is required');
  const registry = JSON.parse(fs.readFileSync(path.join(missionRoot, 'registry.json'), 'utf8'));
  const entry = registry.missions && registry.missions[LEGACY.adoption_key];
  if (!entry || entry.mission_graph_digest !== LEGACY.graph_digest) fail('LEGACY_RECONCILE_REGISTRY', 'exact legacy B/C Mission root is unavailable');
  const state = JSON.parse(fs.readFileSync(path.join(missionRoot, entry.state_ref), 'utf8'));
  mission.validateMissionState(state);
  if (state.state !== 'COMPLETE' || state.mission_graph_digest !== LEGACY.graph_digest) fail('LEGACY_RECONCILE_STATE', 'legacy B/C state is not the exact COMPLETE authority');
  execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', LEGACY.git_history_anchor, 'HEAD'], { stdio: 'ignore' });

  const dispositions = LEGACY.terminals.map((expected) => {
    const progress = state.graph_progress && state.graph_progress[expected.graph_node_id];
    if (!progress || progress.status !== 'ready' || progress.last_receipt_digest !== expected.receipt_digest) fail('LEGACY_RECONCILE_TERMINAL', `legacy ${expected.graph_node_id} terminal mismatch`);
    const journalPath = path.join(missionRoot, 'journals', LEGACY.adoption_key);
    const matches = fs.readdirSync(journalPath).filter((name) => name.endsWith('.applied.json')).map((name) => JSON.parse(fs.readFileSync(path.join(journalPath, name), 'utf8'))).filter((receipt) => receipt.receipt_digest === expected.receipt_digest);
    if (matches.length !== 1 || matches[0].artifact_type !== 'campaign_terminal_receipt' || matches[0].graph_node_id !== expected.graph_node_id || matches[0].outcome !== 'ready' || digestBody(matches[0]) !== expected.receipt_digest) fail('LEGACY_RECONCILE_JOURNAL', `legacy ${expected.graph_node_id} receipt is absent, ambiguous, or corrupt`);
    return { ...expected, mission_graph_digest: LEGACY.graph_digest, git_history_anchor: LEGACY.git_history_anchor, disposition: 'retired_exact_legacy_terminal' };
  });
  const body = { schema_version: 1, artifact_type: 'legacy_mission_terminal_dispositions', repo_identity: `git-common-dir:${common}`, current_graph_digest: currentGraphDigest, legacy_adoption_key: LEGACY.adoption_key, dispositions, synthesized_work_orders: 0, mutated_receipts: 0, history_rewritten: false };
  const artifact = { ...body, disposition_digest: sha256(canonicalJson(body)) };
  const target = dispositionPath(common);
  if (fs.existsSync(target)) {
    const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (canonicalJson(existing) === canonicalJson(artifact)) return { status: 'RECONCILED', ...artifact, writes: 0 };
    const { current_graph_digest: _oldGraph, disposition_digest: _oldDigest, ...oldStable } = existing;
    const { current_graph_digest: _newGraph, disposition_digest: _newDigest, ...newStable } = artifact;
    if (canonicalJson(oldStable) !== canonicalJson(newStable)) fail('LEGACY_RECONCILE_REPLAY', 'existing legacy disposition differs from exact reconciliation');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
  return { status: 'RECONCILED', ...artifact, writes: 1 };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'legacy';
  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write([
      'Usage:',
      '  mission-terminal-reconcile.js [legacy] --repo-root <dir> --graph-digest <sha256>',
      '      retire the exact hardcoded legacy B/C Mission terminals',
      '',
      '  mission-terminal-reconcile.js rollover --repo-root <dir> --graph-digest <sha256>',
      '      --canonical-adoption <adoption-key>',
      '      retire the superseded same-graph adoptions a retry chain left behind.',
      '      Refuses unless the named adoption is COMPLETE, its terminals resolve to',
      '      exactly one matching journal receipt each, its evidence says integrated',
      '      with zero residue, and its observed_head is an ancestor of HEAD.',
      '',
    ].join('\n'));
    process.exit(0);
  }
  try {
    if (sub === 'rollover') {
      process.stdout.write(`${JSON.stringify(rolloverMissionTerminals({
        repoRoot: value('--repo-root') || '.',
        graphDigest: value('--graph-digest'),
        canonicalAdoption: value('--canonical-adoption'),
      }))}\n`);
    } else if (sub === 'legacy') {
      process.stdout.write(`${JSON.stringify(reconcileLegacyMissionTerminals({
        repoRoot: value('--repo-root') || '.',
        currentGraphDigest: value('--graph-digest'),
      }))}\n`);
    } else {
      process.stderr.write(`unknown subcommand: ${sub}\n`);
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`${error.code || 'RECONCILE_FAILED'}: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  LEGACY, dispositionPath, reconcileLegacyMissionTerminals,
  rolloverPath, rolloverMissionTerminals,
};
