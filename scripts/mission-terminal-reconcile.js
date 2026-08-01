#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const mission = require('../src/engine/mission-convergence');

const HEX64 = /^[a-f0-9]{64}$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function reconcileLegacyMissionTerminals({ repoRoot, currentGraphDigest }) {
  const root = fs.realpathSync(execFileSync('git', ['-C', repoRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  const common = fs.realpathSync(execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
  if (!HEX64.test(currentGraphDigest || '')) fail('LEGACY_RECONCILE_GRAPH', 'current graph digest is required');
  const missionRoot = path.join(common, 'autopilot', 'mission');
  const registryPath = path.join(missionRoot, 'registry.json');
  if (!fs.existsSync(registryPath)) return { status: 'RECONCILED', retired_terminals: [], writes: 0 };
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (!registry || registry.artifact_type !== 'mission_runtime_registry' || !registry.missions) {
    fail('LEGACY_RECONCILE_REGISTRY', 'canonical Mission registry is malformed');
  }
  const retired = [];
  for (const [adoptionKey, entry] of Object.entries(registry.missions)) {
    const statePath = path.join(missionRoot, entry.state_ref || '');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    mission.validateMissionState(state);
    if (state.mission_graph_digest === currentGraphDigest) continue;
    for (const [nodeId, progress] of Object.entries(state.graph_progress || {})) {
      if (!progress || progress.status !== 'ready' || !HEX64.test(progress.last_receipt_digest || '')) continue;
      const dir = path.join(missionRoot, 'journals', adoptionKey);
      const match = fs.readdirSync(dir).filter((name) => name.endsWith('.applied.json')).map((name) => {
        const file = path.join(dir, name);
        return { file, receipt: JSON.parse(fs.readFileSync(file, 'utf8')) };
      }).find(({ receipt }) => receipt.receipt_digest === progress.last_receipt_digest);
      if (!match || match.receipt.artifact_type !== 'campaign_terminal_receipt'
          || match.receipt.graph_node_id !== nodeId || match.receipt.outcome !== 'ready') {
        fail('LEGACY_RECONCILE_JOURNAL', `ready terminal ${adoptionKey}/${nodeId} lacks its exact applied journal`);
      }
      const claim = state.claims && Object.values(state.claims)
        .find((c) => c && c.graph_node_id === nodeId && c.terminal && c.reconciled === true);
      const accepted = match.receipt.accepted_commit || (claim && (claim.accepted_commit || claim.base_sha));
      if (typeof accepted !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(accepted)) {
        fail('LEGACY_RECONCILE_COMMIT', `ready terminal ${adoptionKey}/${nodeId} lacks accepted Git history`);
      }
      try {
        execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', accepted, 'HEAD'], { stdio: 'ignore' });
      } catch (_error) {
        fail('LEGACY_RECONCILE_COMMIT', `accepted commit ${accepted} is not retained by HEAD`);
      }
      retired.push({
        adoption_key: adoptionKey,
        graph_node_id: nodeId,
        mission_graph_digest: state.mission_graph_digest,
        receipt_digest: progress.last_receipt_digest,
        git_history_anchor: accepted,
        disposition: 'retired_foreign_graph_history',
      });
    }
  }
  retired.sort((a, b) => `${a.adoption_key}/${a.graph_node_id}`.localeCompare(`${b.adoption_key}/${b.graph_node_id}`));
  const body = {
    schema_version: 1,
    artifact_type: 'legacy_mission_terminal_reconciliation',
    repo_identity: `git-common-dir:${common}`,
    current_graph_digest: currentGraphDigest,
    retired_terminals: retired,
    writes: 0,
    synthesized_work_orders: 0,
    mutated_receipts: 0,
  };
  return { status: 'RECONCILED', ...body, digest: sha256(canonicalJson(body)) };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  try {
    const result = reconcileLegacyMissionTerminals({
      repoRoot: value('--repo-root') || '.',
      currentGraphDigest: value('--graph-digest'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'LEGACY_RECONCILE_FAILED'}: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { reconcileLegacyMissionTerminals };
