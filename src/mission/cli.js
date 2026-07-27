'use strict';

// Machine-oriented Mission Convergence CLI (plan P2 surface). Every operation
// drives the canonical pure reducer in src/engine/mission-convergence.js and the
// host-injected AuthenticatedControlAdapter; no operation bypasses canonical
// state, grant, or control validation. State is persisted as JSON between calls
// so the deterministic checker scripts/mission-convergence-check.js and the
// `node bin/autopilot.js mission ...` route share one implementation.
//
// Subcommands:
//   init    --contract <file> --out <state>
//   grant   --state <file> --out <file> --idempotency-key <k> --campaign-id <id>
//           --contract-digest <sha256> --base-sha <sha> --acceptance-ids <a,b>
//           [--reserved <n>] [--now <iso>]
//   consume --state <file> --out <file> --claim-id <id> [--reserved <n>]
//   control --state <file> --out <file> --action <a> --sequence <n>
//           [--authority <auth>] [--now <iso>]
//   check   --state <file>
//   receipt --state <file> [--residue <file>]

const fs = require('fs');
const path = require('path');
const mission = require('../engine/mission-convergence');
const { AuthenticatedControlAdapter } = require('../engine/authenticated-control');

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

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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

function cmdGrant(flags) {
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

function cmdControl(flags) {
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
  const authority = flags.authority || 'authenticated_user';
  let canonical;
  try {
    const adapter = new AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority }),
    });
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
  init: cmdInit,
  grant: cmdGrant,
  consume: cmdConsume,
  control: cmdControl,
  check: cmdCheck,
  receipt: cmdReceipt,
};

function runMissionCli(argv, options = {}) {
  const command = argv[0];
  if (!command || command === '-h' || command === '--help' || command === 'help') {
    process.stdout.write(`${[
      'usage: mission <init|grant|consume|control|check|receipt> [flags]',
      '  init    --contract <file> --out <state>',
      '  grant   --state <file> --out <file> --idempotency-key <k> --campaign-id <id>',
      '          --contract-digest <sha256> --base-sha <sha> --acceptance-ids <a,b> [--reserved <n>] [--now <iso>]',
      '  consume --state <file> --out <file> --claim-id <id> [--reserved <n>]',
      '  control --state <file> --out <file> --action <a> --sequence <n> [--authority <auth>] [--now <iso>]',
      '  check   --state <file>',
      '  receipt --state <file> [--residue <file>]',
    ].join('\n')}\n`);
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`mission: unknown subcommand: ${command}\n`);
    return 2;
  }
  let flags;
  try {
    flags = parseFlags(argv.slice(1));
  } catch (error) {
    process.stderr.write(`mission: ${error.message}\n`);
    return error instanceof MissionCliError ? error.exitCode : 2;
  }
  try {
    return handler(flags, options);
  } catch (error) {
    const code = error instanceof MissionCliError ? error.exitCode : 1;
    process.stderr.write(`mission: ${error.message}\n`);
    return code;
  }
}

module.exports = { runMissionCli, buildReservation, MissionCliError };
