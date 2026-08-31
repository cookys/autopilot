'use strict';

// Machine-oriented Mission Convergence CLI (plan P2 surface). Every operation
// drives the canonical pure reducer in src/engine/mission-convergence.js and the
// host-injected AuthenticatedControlAdapter; no operation bypasses canonical
// state, grant, or control validation. State is persisted as JSON between calls
// so the deterministic checker scripts/mission-convergence-check.js and the
// `node bin/autopilot.js mission ...` route share one implementation.
//
// Subcommands:
//   prepare --repo <git-repo> --authority <file> --graph <file> --out <receipt>
//   successor --repo <git-repo> --prepared <receipt> --generation <n> --out <receipt>
//   grant   --repo <git-repo> --prepared <receipt> --node <graph-node>
//   init    --contract <file> --out <state>
//   grant   --state <file> --out <file> --idempotency-key <k> --campaign-id <id>
//           --contract-digest <sha256> --base-sha <sha> --acceptance-ids <a,b>
//           [--reserved <n>] [--now <iso>]
//   consume --state <file> --out <file> --claim-id <id> [--reserved <n>]
//   control --state <file> --out <file> --action <a> --sequence <n>
//           [--authority <auth>] [--now <iso>]
//   finalize-abort --state <file> --out <file>
//   check   --state <file>
//   receipt --state <file> [--residue <file>]

const fs = require('fs');
const path = require('path');
const mission = require('../engine/mission-convergence');
const runtime = require('./runtime');
const { loadRows, projectCampaign, TERMINAL: CAMPAIGN_TERMINAL } = require('../campaign/cli');

const DEFAULT_NOW = '2026-07-27T00:00:00.000Z';
const DEFAULT_EXPIRY = '2026-07-27T01:00:00.000Z';

class MissionCliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'MissionCliError';
    this.exitCode = exitCode;
  }
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new MissionCliError(`${label}: cannot read ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new MissionCliError(`${label}: ${file} is not valid JSON: ${error.message}`);
  }
}

function writeState(file, state) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function loadState(file) {
  const state = readJson(file, 'state');
  try {
    mission.validateMissionState(state);
  } catch (error) {
    throw new MissionCliError(`state: loaded Mission state failed validation: ${error.message}`);
  }
  return state;
}

function buildReservation(state, reserved) {
  return {
    per_axis: mission.SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls'
        ? reserved
        : (axisName === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axisName].durable_consumed,
      known: true,
    })),
  };
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new MissionCliError(`unknown argument: ${arg}`, 2);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new MissionCliError(`--${key} requires a value`, 2);
    }
    flags[key] = value;
    i += 1;
  }
  return flags;
}

function requireFlag(flags, name) {
  if (typeof flags[name] !== 'string' || flags[name].length === 0) {
    throw new MissionCliError(`--${name} is required`, 2);
  }
  return flags[name];
}

function rejectUnknownFlags(flags, allowed, label) {
  const unexpected = Object.keys(flags).filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    throw new MissionCliError(
      `${label} rejects unsupported flags: ${unexpected.map((name) => `--${name}`).join(', ')}`,
      2,
    );
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function emitTo(payload, options = {}) {
  const stdout = options.stdout || process.stdout;
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function cmdPrepare(flags, options = {}) {
  rejectUnknownFlags(
    flags,
    new Set(['repo', 'authority', 'graph', 'governance', 'out', 'now']),
    'prepared Mission prepare',
  );
  const repo = path.resolve(flags.repo || options.cwd || process.cwd());
  const authority = readJson(requireFlag(flags, 'authority'), 'task authority');
  const graph = readJson(requireFlag(flags, 'graph'), 'execution graph');
  const governancePath = flags.governance
    ? path.resolve(repo, flags.governance)
    : path.join(repo, '.claude', 'owner-kernel-governance.json');
  const governance = readJson(governancePath, 'authoritative governance');
  const prepare = options.testOnlyDependencies
    ? runtime.prepareMissionRuntimeForTest
    : runtime.prepareMissionRuntime;
  const prepared = prepare({
    repo,
    taskAuthority: authority,
    executionGraph: graph,
    authoritativeGovernance: governance,
    preparedAt: flags.now,
  }, options.testOnlyDependencies);
  runtime.atomicWriteJson(requireFlag(flags, 'out'), prepared.receipt);
  emitTo({
    status: 'prepared',
    adopted: prepared.adopted,
    mission_lineage_id: prepared.receipt.mission_lineage_id,
    adoption_key: prepared.receipt.adoption_key,
    mission_policy_digest: prepared.receipt.mission_policy_digest,
    mission_graph_digest: prepared.receipt.mission_graph_digest,
    state_hash: prepared.receipt.state_hash,
    receipt: prepared.receipt,
  }, options);
  return 0;
}

function cmdSuccessor(flags, options = {}) {
  rejectUnknownFlags(
    flags,
    new Set(['repo', 'prepared', 'generation', 'out', 'now']),
    'successor Mission prepare',
  );
  const repo = path.resolve(flags.repo || options.cwd || process.cwd());
  const rawGeneration = requireFlag(flags, 'generation');
  if (!/^\d+$/.test(rawGeneration)) {
    throw new MissionCliError('--generation must be a positive integer', 2);
  }
  const generation = Number(rawGeneration);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new MissionCliError('--generation must be a positive integer', 2);
  }
  const predecessorReceipt = readJson(requireFlag(flags, 'prepared'), 'predecessor Mission prepare receipt');
  const prepared = runtime.prepareMissionRuntimeSuccessor({
    repo,
    predecessorReceipt,
    generation,
    preparedAt: flags.now,
  });
  runtime.atomicWriteJson(requireFlag(flags, 'out'), prepared.receipt);
  emitTo({
    status: 'successor_prepared',
    adopted: prepared.adopted,
    predecessor_adoption_key: prepared.predecessor_adoption_key,
    successor_generation: prepared.successor_generation,
    mission_lineage_id: prepared.receipt.mission_lineage_id,
    adoption_key: prepared.receipt.adoption_key,
    mission_policy_digest: prepared.receipt.mission_policy_digest,
    mission_graph_digest: prepared.receipt.mission_graph_digest,
    state_hash: prepared.receipt.state_hash,
    receipt: prepared.receipt,
  }, options);
  return 0;
}

function cmdGrantV2(flags, options = {}) {
  rejectUnknownFlags(
    flags,
    new Set(['repo', 'prepared', 'node', 'now']),
    'prepared Mission grant',
  );
  const repo = path.resolve(flags.repo || options.cwd || process.cwd());
  const preparedReceipt = readJson(requireFlag(flags, 'prepared'), 'Mission prepare receipt');
  let granted;
  try {
    granted = runtime.grantMissionCampaign({
      repo,
      preparedReceipt,
      nodeId: requireFlag(flags, 'node'),
      now: flags.now,
    });
  } catch (error) {
    if (
      error
      && error.code === 'MISSION_GRANT_ATTEMPT_BLOCKED'
      && error.details
      && typeof error.details === 'object'
    ) {
      emitTo({
        status: 'rejected',
        code: error.details.code,
        reason: error.message,
        claim_id: error.details.claim_id,
        campaign_id: error.details.campaign_id,
        graph_node_id: error.details.graph_node_id,
        graph_attempt: error.details.graph_attempt,
        base_sha: error.details.base_sha,
        head_sha: error.details.head_sha,
      }, options);
      return 1;
    }
    throw error;
  }
  emitTo(granted, options);
  return 0;
}

function cmdInit(flags) {
  const contract = readJson(requireFlag(flags, 'contract'), 'contract');
  const state = mission.createMissionState(contract);
  writeState(requireFlag(flags, 'out'), state);
  emit({
    status: 'initialized',
    mission_lineage_id: state.mission_lineage_id,
    state_hash: mission.stateHash(state),
    enforcement_mode: state.enforcement_mode,
  });
  return 0;
}

function reduceOrReject(state, event, label) {
  let result;
  try {
    result = mission.reduceMissionState(state, event);
  } catch (error) {
    const code = error && error.code ? error.code : 'MISSION_REDUCER_INVALID';
    throw new MissionCliError(
      `${label}: ${error.message || String(error)}`,
      code === 'MISSION_STATE_TERMINAL' ? 1 : 1,
    );
  }
  return result;
}

function cmdGrant(flags, options = {}) {
  if (flags.prepared !== undefined) return cmdGrantV2(flags, options);
  const state = loadState(requireFlag(flags, 'state'));
  if (state.terminal || mission.TERMINAL_STATES.has(state.state)) {
    emit({
      status: 'rejected',
      code: 'mission_state_terminal',
      reason: 'cannot claim a grant against a terminal Mission state',
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const reserved = flags.reserved === undefined ? 1 : Number.parseInt(flags.reserved, 10);
  if (!Number.isSafeInteger(reserved) || reserved < 0) {
    throw new MissionCliError('--reserved must be a non-negative integer', 2);
  }
  const now = flags.now || DEFAULT_NOW;
  const event = {
    event_type: 'grant_claimed',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: requireFlag(flags, 'idempotency-key'),
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: requireFlag(flags, 'campaign-id'),
      campaign_contract_digest: requireFlag(flags, 'contract-digest'),
      base_sha: requireFlag(flags, 'base-sha'),
      acceptance_ids: requireFlag(flags, 'acceptance-ids').split(',').filter(Boolean),
      reservation: buildReservation(state, reserved),
      issued_at: now,
      expires_at: flags.expires || DEFAULT_EXPIRY,
    },
  };
  const result = reduceOrReject(state, event, 'grant');
  const rejected = !result
    || !result.receipt
    || result.receipt.artifact_type === 'mission_grant_rejected';
  // Never persist rejected or mismatched state.
  if (!rejected) writeState(requireFlag(flags, 'out'), result.state);
  emit({
    status: rejected ? 'rejected' : 'claimed',
    code: rejected ? (result.receipt.reason || 'mission_grant_rejected') : undefined,
    reason: rejected ? result.receipt.reason : undefined,
    claim_id: rejected ? undefined : result.receipt.claim_id,
    binding_digest: rejected ? undefined : result.receipt.binding_digest,
    state_hash: mission.stateHash(rejected ? state : result.state),
    receipt: result.receipt,
  });
  return rejected ? 1 : 0;
}

function cmdConsume(flags) {
  const state = loadState(requireFlag(flags, 'state'));
  if (state.terminal || mission.TERMINAL_STATES.has(state.state)) {
    emit({
      status: 'rejected',
      code: 'mission_state_terminal',
      reason: 'cannot consume a claim against a terminal Mission state',
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const claimId = requireFlag(flags, 'claim-id');
  const claim = state.claims[claimId];
  if (!claim) {
    emit({
      status: 'rejected',
      code: 'mission_claim_missing',
      reason: `consume: no such claim ${claimId}`,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  if (claim.released) {
    emit({
      status: 'rejected',
      code: 'mission_claim_released',
      reason: `consume: claim ${claimId} was already released`,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const reserved = flags.reserved === undefined
    ? (claim.reservation.tool_calls ? claim.reservation.tool_calls.reserved_active : 0)
    : Number.parseInt(flags.reserved, 10);
  if (!Number.isSafeInteger(reserved) || reserved < 0) {
    throw new MissionCliError('--reserved must be a non-negative integer', 2);
  }
  const event = {
    event_type: 'reconciliation',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      claim_id: claimId,
      actual_usage: buildReservation(state, reserved),
    },
  };
  const result = reduceOrReject(state, event, 'consume');
  const rejected = !result
    || !result.receipt
    || result.receipt.artifact_type === 'mission_grant_rejected';
  if (!rejected) writeState(requireFlag(flags, 'out'), result.state);
  emit({
    status: rejected ? 'rejected' : 'reconciled',
    code: rejected ? (result.receipt.reason || 'mission_consume_rejected') : undefined,
    reason: rejected ? result.receipt.reason : undefined,
    replay: result.receipt.replay,
    state_hash: mission.stateHash(rejected ? state : result.state),
    receipt: result.receipt,
  });
  return rejected ? 1 : 0;
}

function cmdWithdraw(flags) {
  rejectUnknownFlags(
    flags,
    new Set(['state', 'out', 'claim-id', 'campaign-ledger']),
    'withdraw Mission withdraw',
  );
  const state = loadState(requireFlag(flags, 'state'));
  const claimId = requireFlag(flags, 'claim-id');
  const outPath = requireFlag(flags, 'out');
  const claim = state.claims[claimId];
  if (!claim) {
    emit({
      status: 'rejected',
      code: 'mission_withdraw_claim_not_found',
      reason: `withdraw: no such claim ${claimId}`,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  if (claim.released) {
    emit({
      status: 'rejected',
      code: 'mission_withdraw_claim_already_released',
      reason: `withdraw: claim ${claimId} was already released`,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  if (claim.reconciled) {
    emit({
      status: 'rejected',
      code: 'mission_withdraw_claim_reconciled',
      reason: `withdraw: claim ${claimId} was already reconciled`,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  let projection = null;
  try {
    const campaignLedger = requireFlag(flags, 'campaign-ledger');
    const rows = loadRows(campaignLedger);
    projection = projectCampaign(rows, claim.campaign_id);
    if (!projection) {
      throw new Error('campaign not found');
    }
  } catch (error) {
    emit({
      status: 'rejected',
      code: 'mission_withdraw_campaign_unreadable',
      reason: `withdraw: claim ${claimId} campaign ${claim.campaign_id} ledger unreadable: ${error.message || String(error)}`,
      claim_id: claimId,
      campaign_id: claim.campaign_id,
      phase: null,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  if (!CAMPAIGN_TERMINAL.has(projection.state.phase)) {
    emit({
      status: 'rejected',
      code: 'mission_withdraw_campaign_not_terminal',
      reason: `withdraw: claim ${claimId} bound to campaign ${projection.campaign_id} phase ${projection.state.phase} is not terminal`,
      claim_id: claimId,
      campaign_id: projection.campaign_id,
      phase: projection.state.phase,
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const event = {
    event_type: 'no_effect_release',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { claim_id: claimId },
  };
  const result = reduceOrReject(state, event, 'withdraw');
  const rejected = !result
    || !result.receipt
    || result.receipt.artifact_type === 'mission_grant_rejected';
  if (rejected) {
    emit({
      status: 'rejected',
      code: result && result.receipt && result.receipt.reason ? result.receipt.reason : 'mission_withdraw_rejected',
      reason: result && result.receipt && result.receipt.reason ? result.receipt.reason : 'withdraw rejected',
      state_hash: mission.stateHash(state),
      receipt: result && result.receipt,
    });
    return 1;
  }
  writeState(outPath, result.state);
  emit({
    status: 'withdrawn',
    claim_id: claimId,
    campaign_id: claim.campaign_id,
    graph_node_id: claim.graph_node_id || null,
    state_hash: mission.stateHash(result.state),
    receipt: result.receipt,
  });
  return 0;
}

function cmdControl(flags, options = {}) {
  const state = loadState(requireFlag(flags, 'state'));
  if (state.terminal || mission.TERMINAL_STATES.has(state.state)) {
    emit({
      status: 'rejected',
      code: 'mission_state_terminal',
      reason: 'cannot apply control against a terminal Mission state',
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  // Control never mints its own always-authenticated adapter. A host must
  // inject an already-authenticated adapter with acceptEvent; the root
  // machine CLI has no host adapter and therefore fails closed without
  // writing --out.
  const adapter = options.authenticatedControlAdapter;
  if (!adapter || typeof adapter.acceptEvent !== 'function') {
    emit({
      status: 'rejected',
      code: 'mission_control_authentication_required',
      reason: 'control requires a host-injected authenticatedControlAdapter with acceptEvent',
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const authority = flags.authority || 'authenticated_user';
  let canonical;
  try {
    canonical = adapter.acceptEvent({
      mission_lineage_id: state.mission_lineage_id,
      action: requireFlag(flags, 'action'),
      authority,
      sequence: Number.parseInt(requireFlag(flags, 'sequence'), 10),
      issued_at: flags.now || DEFAULT_NOW,
      reason: flags.reason || 'mission cli control',
    });
  } catch (error) {
    emit({
      status: 'rejected',
      code: error.code || 'mission_control_rejected',
      reason: error.message || String(error),
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const event = {
    event_type: 'control_event',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { event: canonical },
  };
  const result = reduceOrReject(state, event, 'control');
  const rejected = !result || !result.state;
  if (rejected) {
    emit({
      status: 'rejected',
      code: 'mission_control_rejected',
      reason: (result && result.receipt && result.receipt.reason) || 'mission_control_rejected',
      state_hash: mission.stateHash(state),
      receipt: result && result.receipt,
    });
    return 1;
  }
  writeState(requireFlag(flags, 'out'), result.state);
  emit({
    status: 'controlled',
    next_state: result.state.state,
    control_sequence: result.state.control_sequence,
    reason: result.receipt.reason,
    state_hash: mission.stateHash(result.state),
    receipt: result.receipt,
  });
  return 0;
}

function cmdFinalizeAbort(flags) {
  rejectUnknownFlags(flags, new Set(['state', 'out']), 'finalize-abort');
  const state = loadState(requireFlag(flags, 'state'));
  const outPath = requireFlag(flags, 'out');

  // Idempotent success only for reducer-owned canonical ABORTED that is fully
  // drained. A truthy terminal marker alone must not bypass drain provenance.
  if (state.state === 'ABORTED') {
    const canonical = mission.evaluateCanonicalAbortedTerminal(state);
    if (!canonical.ok) {
      emit({
        status: 'rejected',
        code: canonical.reason || 'mission_abort_rejected',
        reason: canonical.reason || 'abort finalization rejected',
        state_hash: mission.stateHash(state),
      });
      return 1;
    }
    writeState(outPath, state);
    emit({
      status: 'aborted',
      next_state: 'ABORTED',
      idempotent: true,
      mission_terminal: true,
      control_sequence: state.control_sequence,
      state_hash: mission.stateHash(state),
      receipt: null,
    });
    return 0;
  }

  const event = {
    event_type: 'abort_finalized',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {},
  };
  let result;
  try {
    result = mission.reduceMissionState(state, event);
  } catch (error) {
    emit({
      status: 'rejected',
      code: error.code || 'mission_abort_rejected',
      reason: error.message || String(error),
      state_hash: mission.stateHash(state),
    });
    return 1;
  }
  const rejected = !result
    || !result.state
    || result.state.state !== 'ABORTED'
    || !result.state.terminal
    || !mission.TERMINAL_STATES.has(result.state.state)
    || (result.receipt && result.receipt.artifact_type === 'mission_abort_rejected');
  // Fail closed: never write --out on rejection.
  if (rejected) {
    emit({
      status: 'rejected',
      code: (result && result.receipt && result.receipt.reason) || 'mission_abort_rejected',
      reason: (result && result.receipt && result.receipt.reason) || 'abort finalization rejected',
      state_hash: mission.stateHash(state),
      receipt: result && result.receipt,
    });
    return 1;
  }
  writeState(outPath, result.state);
  emit({
    status: 'aborted',
    next_state: 'ABORTED',
    idempotent: false,
    mission_terminal: true,
    control_sequence: result.state.control_sequence,
    state_hash: mission.stateHash(result.state),
    receipt: result.receipt,
  });
  return 0;
}

function cmdCheck(flags) {
  const state = loadState(requireFlag(flags, 'state'));
  emit({
    status: 'ok',
    state: state.state,
    terminal: state.terminal || null,
    mission_terminal: !!(state.terminal && mission.TERMINAL_STATES.has(state.state)),
    mission_lineage_id: state.mission_lineage_id,
    control_sequence: state.control_sequence,
    state_hash: mission.stateHash(state),
  });
  return 0;
}

function cmdReceipt(flags) {
  const state = loadState(requireFlag(flags, 'state'));
  const isTerminal = !!(state.terminal && mission.TERMINAL_STATES.has(state.state));
  if (flags.residue) {
    const residue = readJson(flags.residue, 'residue');
    let receipt;
    try {
      receipt = mission.buildMissionTerminalReceipt(state, residue);
    } catch (error) {
      emit({
        status: 'rejected',
        code: error.code || 'mission_terminal_receipt_rejected',
        reason: error.message || String(error),
        mission_terminal: isTerminal,
        state_hash: mission.stateHash(state),
      });
      return 1;
    }
    emit({
      status: 'terminal',
      mission_terminal: true,
      state_hash: mission.stateHash(state),
      receipt,
    });
    return 0;
  }
  // Terminal state without residue is an explicit machine-readable outcome:
  // projection is still available, but the terminal receipt requires residue.
  if (isTerminal) {
    const projection = mission.buildProjection(state);
    emit({
      status: 'terminal_projection',
      mission_terminal: true,
      code: 'mission_terminal_residue_required',
      reason: 'terminal Mission receipt requires --residue; projection is returned without closeout authority',
      state_hash: mission.stateHash(state),
      projection,
    });
    return 0;
  }
  const projection = mission.buildProjection(state);
  emit({
    status: 'projection',
    mission_terminal: projection.mission_terminal === true,
    state_hash: mission.stateHash(state),
    projection,
  });
  return 0;
}

const COMMANDS = {
  prepare: cmdPrepare,
  successor: cmdSuccessor,
  init: cmdInit,
  grant: cmdGrant,
  consume: cmdConsume,
  withdraw: cmdWithdraw,
  control: cmdControl,
  'finalize-abort': cmdFinalizeAbort,
  check: cmdCheck,
  receipt: cmdReceipt,
};

function runMissionCli(argv, options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const command = argv[0];
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    stdout.write(`${[
      'usage: mission <prepare|successor|init|grant|consume|withdraw|control|finalize-abort|check|receipt> [flags]',
      '  prepare --repo <git-repo> --authority <file> --graph <file> --out <receipt>',
      '  successor --repo <git-repo> --prepared <receipt> --generation <n> --out <receipt>',
      '  grant   --repo <git-repo> --prepared <receipt> --node <graph-node> [--now <iso>]',
      '  init    --contract <file> --out <state>',
      '  grant   --state <file> --out <file> --idempotency-key <k> --campaign-id <id>',
      '          --contract-digest <sha256> --base-sha <sha> --acceptance-ids <a,b> [--reserved <n>] [--now <iso>]',
      '  consume --state <file> --out <file> --claim-id <id> [--reserved <n>]',
      '  withdraw --state <file> --out <file> --claim-id <id> --campaign-ledger <file>',
      '  control --state <file> --out <file> --action <a> --sequence <n> [--authority <auth>] [--now <iso>]',
      '  finalize-abort --state <file> --out <file>',
      '  check   --state <file>',
      '  receipt --state <file> [--residue <file>]',
    ].join('\n')}\n`);
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    stderr.write(`mission: unknown subcommand: ${command}\n`);
    return 2;
  }
  let flags;
  try {
    flags = parseFlags(argv.slice(1));
  } catch (error) {
    stderr.write(`mission: ${error.message}\n`);
    return error instanceof MissionCliError ? error.exitCode : 2;
  }
  try {
    return handler(flags, options);
  } catch (error) {
    const code = error instanceof MissionCliError ? error.exitCode : 1;
    const runtimeCode = error && error.code ? `[${error.code}] ` : '';
    stderr.write(`mission: ${runtimeCode}${error.message}\n`);
    return code;
  }
}

module.exports = { runMissionCli, buildReservation, MissionCliError };
