'use strict';

// Producer for the `autopilot status task --root-run-id <id>` input bundle.
//
// The reader (task-runtime.js collectTaskStatus) loads
//   ${AUTOPILOT_TASK_STATUS_DIR:-${TMPDIR:-/tmp}/autopilot-task-status}/<root>.json
// and hands it to buildTaskStatus, which re-derives every verdict (replays the
// campaign events, recomputes digests, asks git). This module only assembles the
// evidence the reader consumes, from state that already exists on disk:
//
//   * Mission state          <git-common-dir>/autopilot/mission/states/*.json
//   * campaign events/state  <git-common-dir>/autopilot/implementation-campaign.jsonl
//   * campaign contract      <git-common-dir>/autopilot/mission/artifacts/**/campaign.json
//   * verification receipt   <git-common-dir>/autopilot/work-orders/<root>/*.json (controller)
//   * lifecycle receipt      the path pinned by the ledger's terminal event
//   * integration refs       git (main worktree branch, its upstream)
//
// The ONE artifact that exists nowhere on disk is the campaign terminal receipt
// body: the ledger pins only its digest. The engine therefore hands it over at
// the terminal site (in-memory `composition`), and a later refresh re-reads it
// from the previous bundle. In both cases the body is accepted ONLY when its
// digest equals the one the ledger's terminal event pins — a claim checked
// against independent state, never trusted (ADR-0001).
//
// No field here is a caller-asserted verdict: there are no booleans about
// merge/push/residue in the input; the reader recomputes them.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  canonicalDigest,
  CAMPAIGN_STATES,
  CAMPAIGN_EVENTS,
} = require('../engine/implementation-campaign');
const mission = require('../mission/interface');
const { loadRows, projectCampaign } = require('../campaign/cli');
const { withWriteLock } = require('../../scripts/lib/jsonl-store');
const { taskArtifactPath, repoIdentity } = require('./task-runtime');

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function authorityRoot(repo) {
  const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  try {
    return path.join(fs.realpathSync(common), 'autopilot');
  } catch (_error) {
    return null;
  }
}

function bodyDigest(receipt) {
  if (!receipt || typeof receipt !== 'object' || typeof receipt.receipt_digest !== 'string') {
    return null;
  }
  const { receipt_digest: ignored, ...body } = receipt;
  return canonicalDigest(body);
}

// ---- Mission ---------------------------------------------------------------

function findMissionState(root, rootRunId) {
  const dir = path.join(root, 'mission', 'states');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_error) {
    return null;
  }
  const matches = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const state = readJsonSafe(path.join(dir, name));
    if (state && state.root_run_id === rootRunId) matches.push(state);
  }
  // Ambiguity is not resolved by guessing: the reader gets no Mission evidence.
  return matches.length === 1 ? matches[0] : null;
}

function missionTerminalReceipt(state, lifecycleReceipt) {
  if (!state || !mission.TERMINAL_STATES.has(state.state) || !state.terminal) return null;
  if (!lifecycleReceipt || !Array.isArray(lifecycleReceipt.blockers)) return null;
  const body = { lifecycle_residue: plain(lifecycleReceipt.blockers) };
  const residue = { ...body, residue_digest: mission.sha256(body) };
  try {
    return plain(mission.buildMissionTerminalReceipt(state, residue));
  } catch (_error) {
    return null;
  }
}

// ---- Campaigns -------------------------------------------------------------

function contractCandidates(root, rootRunId, extraContractFiles) {
  const found = [];
  const artifacts = path.join(root, 'mission', 'artifacts');
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (entry.isFile() && entry.name === 'campaign.json') found.push(full);
    }
  };
  walk(artifacts, 0);
  for (const file of extraContractFiles) found.push(file);
  const contracts = [];
  const seenFiles = new Set();
  for (const file of found) {
    let real;
    try { real = fs.realpathSync(file); } catch (_error) { continue; }
    if (seenFiles.has(real)) continue; // same contract reached by two routes
    seenFiles.add(real);
    const contract = readJsonSafe(file);
    if (!contract || typeof contract !== 'object') continue;
    const runtime = contract.mission_runtime;
    if (!runtime || runtime.root_run_id !== rootRunId) continue;
    contracts.push(contract);
  }
  return contracts;
}

function contractDigests(contract) {
  return new Set([
    canonicalDigest(contract),
    mission.sha256(`${JSON.stringify(contract, null, 2)}\n`),
  ]);
}

function campaignEvents(rows, campaignId) {
  const seen = new Set();
  const events = [];
  for (const row of rows) {
    if (!row || row.run_id !== campaignId || row.kind !== 'journal' || row.op !== 'campaign_event') {
      continue;
    }
    let wrapper;
    try {
      wrapper = JSON.parse(row.payload);
    } catch (_error) {
      return null;
    }
    const event = wrapper && wrapper.event;
    if (!event || typeof event !== 'object') return null;
    if (seen.has(event.idempotency_key)) continue; // rotation carry copies
    seen.add(event.idempotency_key);
    events.push(event);
  }
  return events;
}

// The controller work order is keyed by the managed campaign's own root id
// (the campaign id), which differs from the Mission root; try both. A receipt is
// accepted only when its digest is the one the ledger's vertical_verified event pins.
function workOrderVerification(root, ids, evidenceDigest) {
  for (const id of ids) {
    const safe = String(id).replace(/[^A-Za-z0-9._:-]/gu, '_');
    const dir = path.join(root, 'work-orders', safe);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (_error) {
      continue;
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const order = readJsonSafe(path.join(dir, name));
      const receipt = order && order.controller && order.controller.verification_receipt;
      if (receipt && receipt.receipt_digest === evidenceDigest) return plain(receipt);
    }
  }
  return null;
}

function priorBundleReceipts(previous, campaignId) {
  const out = { terminal: null, verification: null };
  const entry = previous && Array.isArray(previous.campaigns)
    ? previous.campaigns.find((item) => item && item.state && item.state.campaign_id === campaignId)
    : null;
  if (entry) {
    out.terminal = entry.terminal_receipt || null;
    out.verification = entry.verification_receipt || null;
  }
  return out;
}

function deriveCampaignEntry({
  rows, campaignId, contract, root, rootRunId, suppliedTerminal, previous,
}) {
  let projection;
  try {
    projection = projectCampaign(rows, campaignId);
  } catch (_error) {
    return null;
  }
  if (!projection || !projection.candidate_reference) return null;
  const phase = projection.state.phase;
  if (phase !== CAMPAIGN_STATES.TERMINAL_READY
      && phase !== CAMPAIGN_STATES.TERMINAL_FOLLOW_UP) return null;
  const events = campaignEvents(rows, campaignId);
  if (!events || events.length === 0) return null;
  const terminalEvent = events[events.length - 1];
  const pinned = terminalEvent.payload && terminalEvent.payload.convergence_digest;

  const prior = priorBundleReceipts(previous, campaignId);
  const terminal = [suppliedTerminal, prior.terminal].find(
    (candidate) => candidate && typeof candidate === 'object'
      && bodyDigest(candidate) === candidate.receipt_digest
      && candidate.receipt_digest === pinned,
  ) || null;
  if (!terminal) return null;

  const verifiedEvent = [...events].reverse()
    .find((event) => event.event_type === CAMPAIGN_EVENTS.VERTICAL_VERIFIED);
  const evidenceDigest = verifiedEvent && verifiedEvent.payload
    && verifiedEvent.payload.evidence_digest;
  const verification = workOrderVerification(root, [campaignId, rootRunId], evidenceDigest)
    || (prior.verification && prior.verification.receipt_digest === evidenceDigest
      ? prior.verification : null);
  if (!verification) return null;

  return {
    contract: plain(contract),
    events: plain(events),
    state: plain(projection.state),
    terminal_receipt: plain(terminal),
    verification_receipt: plain(verification),
    candidate: plain(projection.candidate_reference),
    _lifecycle_ref: projection.lifecycle_receipt_ref,
    _ticket: contract.ticket,
    _phase: phase,
  };
}

// ---- Lifecycle residue (re-derived from the repo, bound to the TASK root) ----

// The ledger's lifecycle_receipt_ref is bound to the campaign id; the reader
// inspects the receipt against the task root id, so a receipt for that root is
// issued here through the shipped rail (worktree scan -> lifecycle-residue-receipt).
// Residue that still exists is reported as residue (blockers), never hidden.
const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts');

function issueLifecycleReceipt(repo, root, rootRunId, afterScanWrite = null) {
  const dir = path.join(root, 'task-status-lifecycle');
  const safe = String(rootRunId).replace(/[^A-Za-z0-9._-]/gu, '_');
  const scanPath = path.join(dir, `${safe}.scan.json`);
  const out = path.join(dir, `${safe}.json`);
  // Concurrent producers share the canonical names: every write goes to a per-process
  // temp name first and is renamed into place, so a reader sees only complete files.
  const uniq = `${process.pid}.${process.hrtime.bigint()}`;
  const scanTmp = `${scanPath}.${uniq}.tmp`;
  const outTmp = `${out}.${uniq}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const scan = spawnSync('bash', [
      path.join(SCRIPTS, 'reap-dispatch-worktrees.sh'), 'scan',
      '--repo', repo, '--root-run-id', rootRunId,
    ], { encoding: 'utf8', timeout: 60000 });
    if (scan.error || scan.status !== 0) return null;
    fs.writeFileSync(scanTmp, scan.stdout.endsWith('\n') ? scan.stdout : `${scan.stdout}\n`);
    if (typeof afterScanWrite === 'function') afterScanWrite({ scanTmp, outTmp });
    const issued = spawnSync(process.execPath, [
      path.join(SCRIPTS, 'lifecycle-residue-receipt.js'), 'issue',
      '--repo', repo, '--root-run-id', rootRunId,
      '--worktree-result', scanTmp, '--out', outTmp,
    ], { encoding: 'utf8', timeout: 60000 });
    if (issued.error || issued.status !== 0) return null;
    const receipt = readJsonSafe(outTmp);
    fs.renameSync(scanTmp, scanPath);
    fs.renameSync(outTmp, out);
    return { path: out, receipt };
  } catch (_error) {
    return null;
  } finally {
    fs.rmSync(scanTmp, { force: true });
    fs.rmSync(outTmp, { force: true });
  }
}

// ---- Integration policy (derived from git, never asserted) -----------------

function integrationFromGit(repo, overrides) {
  const porcelain = git(repo, ['worktree', 'list', '--porcelain']) || '';
  const mainWorktree = (porcelain.split('\n').find((line) => line.startsWith('worktree ')) || '')
    .slice('worktree '.length) || repo;
  const targetRef = overrides.targetRef
    || git(mainWorktree, ['symbolic-ref', '-q', 'HEAD']);
  let remoteRef = overrides.remoteRef;
  if (remoteRef === undefined && targetRef) {
    const upstream = git(repo, ['rev-parse', '--symbolic-full-name', `${targetRef}@{upstream}`]);
    remoteRef = upstream || null;
  }
  const consumerRef = overrides.consumerRef || null;
  return {
    target_ref: targetRef || null,
    consumer_ref: consumerRef,
    remote_ref: remoteRef || null,
    push_required: Boolean(remoteRef),
    required_consumer_update: Boolean(consumerRef),
  };
}

// ---- Public API ------------------------------------------------------------

function deriveTaskStatusInput({
  repo,
  rootRunId,
  goal = null,
  terminalReceipts = {},
  previousBundle = null,
  contractFiles = [],
  ledgerPath = null,
  lifecycle,
  mergePreflight = null,
  mergeExecution = null,
  mergeProvenance = null,
  integration = {},
} = {}) {
  if (typeof repo !== 'string' || repo.length === 0) {
    throw Object.assign(new Error('repo is required'), { code: 'TASK_STATUS_INPUT_REPO' });
  }
  const absoluteRepo = path.resolve(repo);
  const root = authorityRoot(absoluteRepo);
  if (!root || !repoIdentity(absoluteRepo)) {
    throw Object.assign(new Error(`not a git repository: ${absoluteRepo}`), {
      code: 'TASK_STATUS_INPUT_REPO',
    });
  }

  // Mission evidence first: its terminal receipt binds the lifecycle residue.
  const missionState = findMissionState(root, rootRunId);

  let rows = [];
  const ledgerFile = ledgerPath || path.join(root, 'implementation-campaign.jsonl');
  try {
    if (fs.existsSync(ledgerFile)) rows = loadRows(ledgerFile);
  } catch (_error) {
    rows = [];
  }

  const campaigns = [];
  let lifecycleReceiptPath = null;
  let lifecycleReceipt = null;
  let phase = missionState ? missionState.state : 'unknown';
  let derivedGoal = goal;
  for (const contract of contractCandidates(root, rootRunId, contractFiles)) {
    const digests = contractDigests(contract);
    const campaignIds = [...new Set(rows
      .filter((row) => row && row.kind === 'journal' && row.op === 'campaign_intake')
      .map((row) => row.run_id))];
    for (const campaignId of campaignIds) {
      let intake;
      try {
        intake = JSON.parse(rows.find((row) => row.run_id === campaignId
          && row.kind === 'journal' && row.op === 'campaign_intake').payload);
      } catch (_error) {
        continue;
      }
      if (!digests.has(intake.contract_digest)) continue;
      // The reader rejects duplicate campaign bindings; one entry per campaign id.
      if (campaigns.some((item) => item.state && item.state.campaign_id === campaignId)) continue;
      const entry = deriveCampaignEntry({
        rows,
        campaignId,
        contract,
        root,
        rootRunId,
        suppliedTerminal: terminalReceipts[campaignId] || terminalReceipts['*'] || null,
        previous: previousBundle,
      });
      if (!entry) continue;
      const ref = entry._lifecycle_ref;
      if (ref && typeof ref === 'object' && typeof ref.path === 'string') {
        lifecycleReceiptPath = ref.path;
        lifecycleReceipt = readJsonSafe(ref.path);
      }
      phase = entry._phase;
      if (derivedGoal === null) derivedGoal = entry._ticket;
      delete entry._lifecycle_ref;
      delete entry._ticket;
      delete entry._phase;
      campaigns.push(entry);
    }
  }

  const task = lifecycle !== undefined ? lifecycle : issueLifecycleReceipt(absoluteRepo, root, rootRunId);
  if (task && task.receipt) {
    lifecycleReceiptPath = task.path;
    lifecycleReceipt = task.receipt;
  }
  const terminalReceipt = missionTerminalReceipt(missionState, lifecycleReceipt);
  return {
    repo: absoluteRepo,
    root_run_id: rootRunId,
    observed_at: new Date().toISOString(),
    goal: derivedGoal === null ? rootRunId : derivedGoal,
    phase,
    mission: {
      state: missionState ? plain(missionState) : null,
      terminal_receipt: terminalReceipt,
    },
    campaigns,
    lifecycle_receipt_path: lifecycleReceiptPath,
    integration: integrationFromGit(absoluteRepo, integration),
    merge_preflight: mergePreflight,
    merge_execution: mergeExecution,
    merge_provenance: mergeProvenance,
  };
}

function writeTaskStatusInput(bundle, env = process.env) {
  const target = taskArtifactPath(bundle.root_run_id, env); // throws on unsafe ids
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(bundle, null, 2)}\n`);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, target);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return target;
}

// Engine/CLI entry: derive, then write. `previous` is read from the target path
// so a refresh keeps receipts the ledger can still vouch for.
function refreshTaskStatusInput(options = {}) {
  const env = options.env || process.env;
  const target = taskArtifactPath(options.rootRunId, env);
  // Read-previous + derive + write is a read-modify-write of the only copy of the
  // terminal receipt body, so concurrent producers (engine terminal, CLI refresh)
  // serialise on a per-bundle lock. Bounded wait; released in finally.
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  // The lifecycle scan spawns subprocesses (up to 2 x 60 s); do it before taking the lock.
  let lifecycle;
  if (options.lifecycle === undefined && options.repo) {
    const authority = authorityRoot(path.resolve(options.repo));
    lifecycle = authority ? issueLifecycleReceipt(path.resolve(options.repo), authority, options.rootRunId, options.afterScanWrite) : null;
  }
  return withWriteLock({
    storeDir: path.dirname(target),
    lockFile: `${target}.lock`,
    name: 'task-status-input',
    timeoutMs: 15000,
  }, () => {
    const previousBundle = options.previousBundle || readJsonSafe(target);
    if (typeof options.afterReadPrevious === 'function') options.afterReadPrevious();
    const bundle = deriveTaskStatusInput({
      ...options,
      ...(lifecycle !== undefined ? { lifecycle } : {}),
      previousBundle,
    });
    return { path: writeTaskStatusInput(bundle, env), bundle };
  });
}

// Telemetry-grade wrapper for the engine: a failed write leaves `status task`
// at TASK_STATUS_INPUT_UNAVAILABLE (today's behaviour), never blocks the run.
function refreshTaskStatusInputBestEffort(options = {}) {
  try {
    return { ok: true, ...refreshTaskStatusInput(options) };
  } catch (error) {
    return { ok: false, error: error.code || error.message };
  }
}

module.exports = {
  deriveTaskStatusInput,
  writeTaskStatusInput,
  refreshTaskStatusInput,
  refreshTaskStatusInputBestEffort,
};
