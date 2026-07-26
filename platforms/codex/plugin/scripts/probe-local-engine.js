#!/usr/bin/env node
'use strict';

const process = require('process');
const {
  DEFAULT_ROSTER,
  LocalDeploymentError,
  loadLocalEngineRoster,
  probeLocalDeployment,
} = require('../src/engine/local-deployment');

const HELP = `Usage:
  node scripts/probe-local-engine.js list [--roster <path>]
  node scripts/probe-local-engine.js probe --endpoint <id> [--roster <path>]
    [--observed-at <UTC-ISO>]

The user-local roster is non-secret. Authentication stays in the existing protected endpoint
environment referenced by credential_endpoint. Probe output separates semantic identity,
stable operational identity, transient capacity, network containment, and SLO observations.
CLI probes can report local_endpoint containment only; offline_verified requires an independent
host verifier and cannot be reconstructed from a caller-authored file.

Exit codes:
  0 = identity verified
  1 = unavailable, degraded, or identity unverifiable
  2 = invalid/not configured
`;

function parseArgs(argv) {
  const command = argv[2];
  if (!command || ['help', '--help', '-h'].includes(command)) return { help: true };
  if (!['list', 'probe'].includes(command)) {
    throw new LocalDeploymentError(`unknown command: ${command}`, 'INVALID_ARGUMENT');
  }
  const options = { command, rosterPath: DEFAULT_ROSTER, endpointId: '', observedAt: null };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--roster', '--endpoint', '--observed-at'].includes(argument)) {
      throw new LocalDeploymentError(`unknown argument: ${argument}`, 'INVALID_ARGUMENT');
    }
    if (index + 1 >= argv.length) {
      throw new LocalDeploymentError(`${argument} requires a value`, 'INVALID_ARGUMENT');
    }
    const value = argv[++index];
    if (argument === '--roster') options.rosterPath = value;
    else if (argument === '--endpoint') options.endpointId = value;
    else options.observedAt = value;
  }
  if (command === 'probe' && !options.endpointId) {
    throw new LocalDeploymentError('--endpoint is required', 'INVALID_ARGUMENT');
  }
  if (command === 'list' && (options.endpointId || options.observedAt)) {
    throw new LocalDeploymentError(
      'list accepts only --roster',
      'INVALID_ARGUMENT',
    );
  }
  if (options.observedAt) {
    const parsed = Date.parse(options.observedAt);
    if (!/Z$/u.test(options.observedAt) || Number.isNaN(parsed)) {
      throw new LocalDeploymentError(
        '--observed-at must be a UTC ISO-8601 timestamp',
        'INVALID_ARGUMENT',
      );
    }
    options.observedAt = new Date(parsed).toISOString();
  }
  return options;
}

function failureStatus(error) {
  if (error.code === 'IDENTITY_UNVERIFIABLE') return 'identity_unverifiable';
  if (error.code === 'CAPACITY_UNVERIFIABLE') return 'capacity_unverifiable';
  if ([
    'ROSTER_UNAVAILABLE',
    'ROSTER_UNTRUSTED',
    'INVALID_LOCAL_ENGINE_CONFIG',
    'ENDPOINT_NOT_FOUND',
    'ENDPOINT_CREDENTIAL_UNAVAILABLE',
    'INVALID_ARGUMENT',
  ].includes(error.code)) return 'not_configured';
  return 'degraded';
}

function failureExit(error) {
  return failureStatus(error) === 'not_configured' ? 2 : 1;
}

async function run(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.command === 'list') {
    const record = loadLocalEngineRoster(options.rosterPath);
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      roster_hash: record.roster_hash,
      endpoints: record.roster.endpoints.map((endpoint) => ({
        id: endpoint.id,
        runtime: endpoint.runtime,
        model: endpoint.model,
        roles: endpoint.roles,
        loopback: endpoint.loopback,
        transport_security: endpoint.transport_security,
        credential_endpoint: endpoint.credential_endpoint,
      })),
    })}\n`);
    return 0;
  }
  const observation = await probeLocalDeployment({
    rosterPath: options.rosterPath,
    endpointId: options.endpointId,
    observedAt: options.observedAt,
  });
  process.stdout.write(`${JSON.stringify(observation)}\n`);
  return 0;
}

if (require.main === module) {
  run().then((status) => {
    process.exitCode = status;
  }).catch((rawError) => {
    const error = rawError instanceof LocalDeploymentError
      ? rawError
      : new LocalDeploymentError(rawError.message || 'local probe failed');
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      status: failureStatus(error),
      reason: error.code,
    })}\n`);
    if (error.code === 'INVALID_ARGUMENT') process.stderr.write(HELP);
    process.exitCode = failureExit(error);
  });
}

module.exports = {
  failureExit,
  failureStatus,
  parseArgs,
  run,
};
