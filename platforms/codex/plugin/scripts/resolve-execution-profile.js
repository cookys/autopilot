#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  resolveRoleExecutionGrant,
  verifyRoleExecutionGrant,
} = require('../src/engine/execution-profile');

const EXIT_SUCCESS = 0;
const EXIT_POLICY_DENIED = 3;

const HELP = `Usage:
  node scripts/resolve-execution-profile.js grant --envelope <envelope.json> --input <grant-input.json>
  node scripts/resolve-execution-profile.js verify --envelope <envelope.json> --grant <grant.json>
    --at <ISO> --identity-hash <sha256> --semantic-fingerprint <sha256>
    --containment-fingerprint <sha256>
    --capability-state <state>

Commands accept an existing task authority envelope and inspect only its child projection.
Every successful result is explicitly unanchored: this CLI cannot write an Owner Kernel ledger,
admit a role, grant host authority, or perform an effect.
Serialized evidence is never accepted here. Qualified grants require the live, in-process
roleCapabilityVerifier supplied by the host to Owner Kernel.
`;

class CliError extends Error {
  constructor(message, code = 'USAGE_ERROR') {
    super(message);
    this.code = code;
  }
}

function parseArgs(argv) {
  const command = argv[2];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    return { help: true };
  }
  const options = {};
  for (let index = 3; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new CliError(`unexpected argument: ${item}`);
    const key = item.slice(2).replace(/-/g, '_');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new CliError(`${item} requires a value`);
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      throw new CliError(`${item} may appear only once`);
    }
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function assertOptions(options, allowed) {
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new CliError(`unsupported option(s): ${unknown.join(', ')}`);
  }
}

function requireOption(options, name) {
  if (!options[name]) throw new CliError(`--${name.replace(/_/g, '-')} is required`);
  return options[name];
}

function readJson(file, label) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new CliError(`${label} unreadable: ${error.message}`, 'INPUT_UNREADABLE');
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new CliError(`${label} is not valid JSON: ${error.message}`, 'INPUT_INVALID');
  }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function run(argv = process.argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return EXIT_SUCCESS;
  }
  const { command, options } = parsed;
  if (command === 'grant') {
    assertOptions(options, new Set(['envelope', 'input']));
    const envelopeFile = readJson(requireOption(options, 'envelope'), 'task envelope');
    const envelope = envelopeFile.envelope || envelopeFile;
    const input = readJson(requireOption(options, 'input'), 'grant input');
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    if (evidence.length > 0) {
      throw new CliError(
        'serialized capability evidence cannot mint a grant; use the Owner Kernel host verifier',
        'UNTRUSTED_CAPABILITY_EVIDENCE',
      );
    }
    const result = resolveRoleExecutionGrant({ ...input, envelope }, {
      evidenceVerifier: () => false,
    });
    output(result);
    return result.status === 'candidate' ? EXIT_SUCCESS : EXIT_POLICY_DENIED;
  }
  if (command === 'verify') {
    assertOptions(options, new Set([
      'envelope',
      'grant',
      'at',
      'identity_hash',
      'semantic_fingerprint',
      'containment_fingerprint',
      'capability_state',
    ]));
    const envelopeFile = readJson(requireOption(options, 'envelope'), 'task envelope');
    const envelope = envelopeFile.envelope || envelopeFile;
    const grantFile = readJson(requireOption(options, 'grant'), 'role grant');
    const grant = grantFile.grant || grantFile;
    output({
      status: 'structurally_consistent_unanchored',
      authority_status: 'shadow',
      trust: 'caller_supplied_anchor_not_execution_authority',
      grant: verifyRoleExecutionGrant(grant, envelope, {
        expectedGrantId: grant.grant_id,
        expectedTaskAuthorityId: envelope.task_authority_id,
        evaluationTime: requireOption(options, 'at'),
        identityHash: requireOption(options, 'identity_hash'),
        semanticFingerprint: requireOption(options, 'semantic_fingerprint'),
        containmentFingerprint: requireOption(options, 'containment_fingerprint'),
        capabilityState: requireOption(options, 'capability_state'),
      }),
    });
    return EXIT_SUCCESS;
  }
  throw new CliError(`unknown command: ${command}`);
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    const code = error && error.code ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = code === 'USAGE_ERROR' ? 2 : 1;
  }
}

module.exports = { CliError, parseArgs, run };
