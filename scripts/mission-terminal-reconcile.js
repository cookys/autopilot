#!/usr/bin/env node
'use strict';

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
  const args = process.argv.slice(2); const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  try { process.stdout.write(`${JSON.stringify(reconcileLegacyMissionTerminals({ repoRoot: value('--repo-root') || '.', currentGraphDigest: value('--graph-digest') }))}\n`); }
  catch (error) { process.stderr.write(`${error.code || 'LEGACY_RECONCILE_FAILED'}: ${error.message}\n`); process.exitCode = 2; }
}

module.exports = { LEGACY, dispositionPath, reconcileLegacyMissionTerminals };
