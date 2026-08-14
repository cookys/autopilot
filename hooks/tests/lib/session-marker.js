'use strict';

// Managed dev-flow admission gates every campaign loop, in the Engine and in
// dispatch-hetero.sh alike. It wants two things production always has and a
// test rarely does: a sealed session marker whose Mission projection matches
// the campaign contract in hand, and a live AUTOPILOT_LEVEL to compare that
// marker's level against. Without them the loop blocks at dev_flow_admission
// long before it reaches whatever the test is actually about.
//
// Two details decide how a fixture has to be shaped:
//   - Admission resolves exactly ONE marker file, <session id>.json. The
//     marker-to-campaign bridge that runs after it instead scans every marker
//     in the directory, so the two gates do not see the same set and a marker
//     named after a test case is invisible to admission.
//   - Admission reads only three fields off the contract. A test that has no
//     real sealed campaign can pass `contract: null` and get a synthetic one
//     that carries exactly those three.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_SESSION_ID = 'autopilot-test-session';
const SYNTHETIC_POLICY_DIGEST = '1'.repeat(64);
const SYNTHETIC_GRAPH_DIGEST = '2'.repeat(64);

function repoIdentityOf(repoRoot) {
  const common = execFileSync(
    'git',
    ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  return `git-common-dir:${fs.realpathSync(common)}`;
}

function readContract(contract) {
  if (!contract) return null;
  if (typeof contract === 'string') {
    return JSON.parse(fs.readFileSync(contract, 'utf8'));
  }
  return contract;
}

// Mirrors the shape session-mode.js enforces: exact keys, and a digest taken
// over the body with admission_digest removed.
function buildAdmission({ repoIdentity, policyDigest, graphDigest, canonicalDigest }) {
  const body = {
    schema_version: 1,
    artifact_type: 'mission_routing_admission',
    authority_status: 'enforce',
    repo_identity: repoIdentity,
    mission_policy_digest: policyDigest,
    mission_graph_digest: graphDigest,
    sources_digest: 'a'.repeat(64),
    deliverable_count: 2,
    source_authoring_unit_count: 2,
    critical_path: 2,
    batch_count: 2,
    reservation_totals: {
      campaigns: 2,
      wall_seconds: 200,
      tool_calls: 6,
      engine_attempts: 4,
      external_wait_seconds: 0,
      canonical_changed_files: 4,
      output_bytes: 2048,
    },
  };
  return { ...body, admission_digest: canonicalDigest(body) };
}

/**
 * Seal a session marker that managed dev-flow admission accepts, and put the
 * matching env in place for this process and anything it spawns with
 * `...process.env`.
 *
 * @param {object}  options
 * @param {string}  options.root       autopilot repo root (to resolve canonicalDigest)
 * @param {string}  options.dir        directory to hold the marker (created if absent)
 * @param {string}  options.repoRoot   repository the managed loop runs against
 * @param {string|object|null} [options.contract]  sealed campaign contract, path or
 *                                     object; null synthesizes one admission accepts
 * @param {string}  [options.contractPath]  where to write a synthesized contract
 * @param {string}  [options.sessionId]
 * @param {string}  [options.level]
 * @param {boolean} [options.exportEnv=true]  set process.env as well as writing files
 * @returns {{markerDir, markerPath, sessionId, level, contractPath, repoIdentity, env}}
 */
function sealSessionMarker({
  root,
  dir,
  repoRoot,
  contract = null,
  contractPath = null,
  sessionId = DEFAULT_SESSION_ID,
  level = 'l6',
  exportEnv = true,
} = {}) {
  if (!root) throw new TypeError('sealSessionMarker requires the autopilot repo root');
  if (!dir) throw new TypeError('sealSessionMarker requires a marker directory');
  if (!repoRoot) throw new TypeError('sealSessionMarker requires the managed repository root');

  const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
  const repoIdentity = repoIdentityOf(repoRoot);
  const loaded = readContract(contract);

  let resolvedContractPath = typeof contract === 'string' ? contract : contractPath;
  let policyDigest = SYNTHETIC_POLICY_DIGEST;
  let graphDigest = SYNTHETIC_GRAPH_DIGEST;

  if (loaded) {
    const runtime = loaded.mission_runtime || loaded.campaign_projection;
    if (!runtime) {
      throw new TypeError('campaign contract carries no mission_runtime for the marker');
    }
    policyDigest = runtime.mission_policy_digest;
    graphDigest = runtime.mission_graph_digest;
  } else {
    // No real campaign to bind to: write the minimum admission reads, so the
    // gate has something coherent to compare the marker against.
    if (!resolvedContractPath) {
      resolvedContractPath = path.join(dir, 'synthetic-campaign-contract.json');
    }
    fs.mkdirSync(path.dirname(resolvedContractPath), { recursive: true });
    fs.writeFileSync(resolvedContractPath, `${JSON.stringify({
      repo_identity: repoIdentity,
      mission_runtime: {
        mission_policy_digest: policyDigest,
        mission_graph_digest: graphDigest,
      },
    }, null, 2)}\n`);
  }

  fs.mkdirSync(dir, { recursive: true });
  const markerPath = path.join(dir, `${sessionId}.json`);
  fs.writeFileSync(markerPath, `${JSON.stringify({
    level,
    session_id: sessionId,
    repo_root: repoRoot,
    started_at: '2026-07-28T00:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    entry_level: level,
    fallback_reason: 'none',
    mission_routing: {
      status: 'READY',
      admitted: true,
      would_block: false,
      prior_marker_status: 'absent',
      admission: buildAdmission({
        repoIdentity, policyDigest, graphDigest, canonicalDigest,
      }),
    },
  }, null, 2)}\n`);

  const env = {
    AUTOPILOT_SESSION_MODE_DIR: dir,
    CLAUDE_CODE_SESSION_ID: sessionId,
    AUTOPILOT_LEVEL: level,
  };
  if (exportEnv) Object.assign(process.env, env);

  return {
    markerDir: dir,
    markerPath,
    sessionId,
    level,
    contractPath: resolvedContractPath,
    repoIdentity,
    env,
  };
}

module.exports = { sealSessionMarker, repoIdentityOf, DEFAULT_SESSION_ID };
