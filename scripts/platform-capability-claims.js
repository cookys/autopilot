#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const VALIDATOR_VERSION = '1.0.0';
const CONSUMER_ORDER = Object.freeze(['D2', 'D3', 'D4']);
const SHA256_RE = /^[a-f0-9]{64}$/;
const CLAIM_ID_RE = /^cap-v1-[a-f0-9]{64}$/;

class ClaimsError extends Error {}

function usage() {
  return [
    'Usage:',
    '  platform-capability-claims.js generate --input FILE --output FILE',
    '  platform-capability-claims.js validate-consumers --receipt FILE --consumer D2 --consumer D3 --consumer D4 [--reprobe]',
    '  platform-capability-claims.js validate-consumer --receipt FILE --consumer D2 [--claim-id ID ...] [--emit-claim-ids] [--reprobe]',
  ].join('\n');
}

function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalValue(value[key]);
  return output;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ClaimsError(`${label} is not valid JSON: ${error.message}`);
  }
}

function exactKeys(value, expected, label) {
  if (!isObject(value)) throw new ClaimsError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const unknown = actual.filter((key) => !wanted.includes(key));
  const missing = wanted.filter((key) => !actual.includes(key));
  if (unknown.length) throw new ClaimsError(`${label} has unknown field: ${unknown[0]}`);
  if (missing.length) throw new ClaimsError(`${label} is missing field: ${missing[0]}`);
}

function stringValue(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length === 0) {
    throw new ClaimsError(`${label} must be ${nullable ? 'null or ' : ''}a non-empty string`);
  }
}

function shaValue(value, label) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new ClaimsError(`${label} must be a lowercase SHA-256 digest`);
  }
}

function isoMillis(value, label) {
  stringValue(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ClaimsError(`${label} must be a canonical ISO-8601 millisecond timestamp`);
  }
  return parsed;
}

function extractVersion(output) {
  const match = String(output).match(/(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:$|[^0-9])/);
  return match ? match[1] : null;
}

function validateTarget(target, label) {
  exactKeys(target, ['runner', 'model', 'role', 'effort', 'endpoint', 'family', 'binary_realpath', 'cli_version'], label);
  stringValue(target.runner, `${label}.runner`);
  stringValue(target.model, `${label}.model`, { nullable: true });
  stringValue(target.role, `${label}.role`);
  stringValue(target.effort, `${label}.effort`, { nullable: true });
  stringValue(target.endpoint, `${label}.endpoint`, { nullable: true });
  stringValue(target.family, `${label}.family`);
  stringValue(target.binary_realpath, `${label}.binary_realpath`);
  if (!path.isAbsolute(target.binary_realpath)) throw new ClaimsError(`${label}.binary_realpath must be absolute`);
  stringValue(target.cli_version, `${label}.cli_version`);
}

function validateOfficial(official, label) {
  exactKeys(official, ['locator', 'retrieved_at', 'document_sha256', 'assertion'], label);
  stringValue(official.locator, `${label}.locator`);
  isoMillis(official.retrieved_at, `${label}.retrieved_at`);
  shaValue(official.document_sha256, `${label}.document_sha256`);
  stringValue(official.assertion, `${label}.assertion`);
}

function validateTransportBinding(binding, target, label) {
  exactKeys(binding, ['execution_model', 'execution_effort_argument', 'normalized_model', 'normalized_effort'], label);
  for (const key of Object.keys(binding)) stringValue(binding[key], `${label}.${key}`, { nullable: true });
  if (target.runner === 'agy') {
    if (binding.execution_effort_argument !== null) {
      throw new ClaimsError(`${label}.execution_effort_argument must be null for agy production transport`);
    }
    const displayMatch = target.model && target.model.match(/^Gemini (\d+\.\d+) Flash \((Low|Medium|High)\)$/);
    const slugMatch = binding.normalized_model && binding.normalized_model.match(/^gemini-(\d+\.\d+)-flash-(low|medium|high)$/);
    if (!displayMatch || !slugMatch || displayMatch[1] !== slugMatch[1]
        || displayMatch[2].toLowerCase() !== slugMatch[2]
        || target.effort !== slugMatch[2]) {
      throw new ClaimsError(`${label} has mismatched agy model-tier/effort metadata`);
    }
    if (![target.model, binding.normalized_model].includes(binding.execution_model)) {
      throw new ClaimsError(`${label}.execution_model is not the declared agy model or normalized slug`);
    }
  } else if (binding.normalized_model !== target.model || binding.normalized_effort !== target.effort) {
    throw new ClaimsError(`${label} does not match target model/effort tuple`);
  }
}

function validateLive(live, target, label) {
  exactKeys(live, ['cli_version', 'probe_command_sha256', 'probe_output_sha256', 'behavior_class', 'observed_at', 'ttl_seconds', 'result', 'transport_binding'], label);
  stringValue(live.cli_version, `${label}.cli_version`);
  shaValue(live.probe_command_sha256, `${label}.probe_command_sha256`);
  shaValue(live.probe_output_sha256, `${label}.probe_output_sha256`);
  stringValue(live.behavior_class, `${label}.behavior_class`);
  isoMillis(live.observed_at, `${label}.observed_at`);
  if (!Number.isInteger(live.ttl_seconds) || live.ttl_seconds < 1 || live.ttl_seconds > 1209600) {
    throw new ClaimsError(`${label}.ttl_seconds must be an integer from 1 through 1209600`);
  }
  stringValue(live.result, `${label}.result`);
  validateTransportBinding(live.transport_binding, target, `${label}.transport_binding`);
}

function revalidationCommandDigest(target) {
  return sha256(canonicalJson({ argv: [target.binary_realpath, '--version'] }));
}

function currentVersionResult(target) {
  try {
    const resolved = fs.realpathSync(target.binary_realpath);
    if (resolved !== target.binary_realpath) return `binary_realpath_drift:${resolved}`;
  } catch (error) {
    return `binary_unavailable:${error.code || 'unknown'}`;
  }
  const run = childProcess.spawnSync(target.binary_realpath, ['--version'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (run.error) return `version_probe_error:${run.error.code || run.error.message}`;
  if (run.status !== 0) return `version_probe_exit:${run.status}`;
  const actual = extractVersion(`${run.stdout || ''}\n${run.stderr || ''}`);
  return actual === target.cli_version ? 'passed' : `current_version_drift:${actual || 'unparseable'}`;
}

function expiration(live) {
  return new Date(Date.parse(live.observed_at) + live.ttl_seconds * 1000).toISOString();
}

function coreEvidenceReasons(source, nowMs, { reprobe = true } = {}) {
  const reasons = [];
  const target = source.target_identity;
  const official = source.official_contract;
  const live = source.live_evidence;
  if (target.cli_version !== live.cli_version) reasons.push('target_live_version_mismatch');
  if (source.agreement !== true || official.assertion !== live.result) reasons.push('contract_live_contradiction');
  if (Date.parse(expiration(live)) <= nowMs) reasons.push('stale_live_evidence');
  if (reprobe) {
    const result = currentVersionResult(target);
    if (result !== 'passed') reasons.push(result);
  }
  return reasons;
}

function claimBodyForId(claim) {
  const body = JSON.parse(JSON.stringify(claim));
  delete body.claim_id;
  delete body.status;
  delete body.revalidation.validated_at;
  return body;
}

function claimId(claim) {
  return `cap-v1-${sha256(canonicalJson(claimBodyForId(claim)))}`;
}

function validateInputClaim(source, label) {
  exactKeys(source, ['capability_id', 'consumer_id', 'target_identity', 'official_contract', 'live_evidence', 'agreement'], label);
  stringValue(source.capability_id, `${label}.capability_id`);
  if (source.consumer_id !== null && !CONSUMER_ORDER.includes(source.consumer_id)) {
    throw new ClaimsError(`${label}.consumer_id must be D2, D3, D4, or null`);
  }
  validateTarget(source.target_identity, `${label}.target_identity`);
  validateOfficial(source.official_contract, `${label}.official_contract`);
  validateLive(source.live_evidence, source.target_identity, `${label}.live_evidence`);
  if (typeof source.agreement !== 'boolean') throw new ClaimsError(`${label}.agreement must be boolean`);
}

function generate(inputPath, outputPath) {
  const input = readJson(inputPath, 'probe input');
  exactKeys(input, ['schema_version', 'claims'], 'probe input');
  if (input.schema_version !== 1) throw new ClaimsError('probe input.schema_version must equal 1');
  if (!Array.isArray(input.claims) || input.claims.length === 0) throw new ClaimsError('probe input.claims must be a non-empty array');
  const now = new Date();
  const claims = [];
  const bindings = new Map(CONSUMER_ORDER.map((consumer) => [consumer, []]));
  const optional = [];
  const capabilityIds = new Set();
  for (let index = 0; index < input.claims.length; index += 1) {
    const source = input.claims[index];
    validateInputClaim(source, `probe input.claims[${index}]`);
    if (capabilityIds.has(source.capability_id)) throw new ClaimsError(`duplicate capability_id: ${source.capability_id}`);
    capabilityIds.add(source.capability_id);
    const reasons = coreEvidenceReasons(source, now.getTime(), { reprobe: true });
    const claim = {
      claim_id: '',
      capability_id: source.capability_id,
      target_identity: source.target_identity,
      official_contract: source.official_contract,
      live_evidence: source.live_evidence,
      agreement: source.agreement,
      freshness: { expires_at: expiration(source.live_evidence) },
      revalidation: {
        validator_version: VALIDATOR_VERSION,
        command_sha256: revalidationCommandDigest(source.target_identity),
        validated_at: now.toISOString(),
        result: reasons.length ? reasons.join(',') : 'passed',
      },
      status: reasons.length ? 'blocked' : 'validated',
    };
    claim.claim_id = claimId(claim);
    claims.push(claim);
    if (source.consumer_id === null) optional.push(claim.claim_id);
    else bindings.get(source.consumer_id).push(claim.claim_id);
  }
  claims.sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  const consumers = CONSUMER_ORDER.map((consumerId) => ({
    consumer_id: consumerId,
    required_claim_ids: bindings.get(consumerId).sort(),
  }));
  for (const consumer of consumers) {
    if (consumer.required_claim_ids.length === 0) throw new ClaimsError(`consumer ${consumer.consumer_id} must have at least one claim`);
    for (const id of consumer.required_claim_ids) {
      const claim = claims.find((candidate) => candidate.claim_id === id);
      if (!claim || claim.status !== 'validated') throw new ClaimsError(`required claim ${id} for ${consumer.consumer_id} is blocked`);
    }
  }
  optional.sort();
  const consumerManifest = {
    schema_version: 1,
    consumers,
    optional_unconsumed_claim_ids: optional,
  };
  const receipt = {
    schema_version: 1,
    artifact_type: 'platform-capability-claims',
    generated_at: now.toISOString(),
    validator_version: VALIDATOR_VERSION,
    claims,
    consumer_manifest: consumerManifest,
    consumer_manifest_digest: sha256(canonicalJson(consumerManifest)),
    receipt_digest: '',
  };
  receipt.receipt_digest = sha256(canonicalJson({ ...receipt, receipt_digest: undefined }));
  const destination = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, destination);
  process.stdout.write(`${receipt.receipt_digest}\n`);
}

function validateClaim(claim, index) {
  const label = `receipt.claims[${index}]`;
  exactKeys(claim, ['claim_id', 'capability_id', 'target_identity', 'official_contract', 'live_evidence', 'agreement', 'freshness', 'revalidation', 'status'], label);
  if (!CLAIM_ID_RE.test(claim.claim_id)) throw new ClaimsError(`${label}.claim_id has invalid format`);
  stringValue(claim.capability_id, `${label}.capability_id`);
  validateTarget(claim.target_identity, `${label}.target_identity`);
  validateOfficial(claim.official_contract, `${label}.official_contract`);
  validateLive(claim.live_evidence, claim.target_identity, `${label}.live_evidence`);
  if (typeof claim.agreement !== 'boolean') throw new ClaimsError(`${label}.agreement must be boolean`);
  exactKeys(claim.freshness, ['expires_at'], `${label}.freshness`);
  isoMillis(claim.freshness.expires_at, `${label}.freshness.expires_at`);
  if (claim.freshness.expires_at !== expiration(claim.live_evidence)) throw new ClaimsError(`${label} freshness digest drift`);
  exactKeys(claim.revalidation, ['validator_version', 'command_sha256', 'validated_at', 'result'], `${label}.revalidation`);
  if (claim.revalidation.validator_version !== VALIDATOR_VERSION) throw new ClaimsError(`${label} validator version drift`);
  shaValue(claim.revalidation.command_sha256, `${label}.revalidation.command_sha256`);
  if (claim.revalidation.command_sha256 !== revalidationCommandDigest(claim.target_identity)) throw new ClaimsError(`${label} revalidation command digest drift`);
  isoMillis(claim.revalidation.validated_at, `${label}.revalidation.validated_at`);
  stringValue(claim.revalidation.result, `${label}.revalidation.result`);
  if (!['validated', 'blocked'].includes(claim.status)) throw new ClaimsError(`${label}.status must be validated or blocked`);
  if (claim.claim_id !== claimId(claim)) throw new ClaimsError(`${label} claim-ID tampering detected`);
}

function validateManifest(receipt) {
  const manifest = receipt.consumer_manifest;
  exactKeys(manifest, ['schema_version', 'consumers', 'optional_unconsumed_claim_ids'], 'receipt.consumer_manifest');
  if (manifest.schema_version !== 1) throw new ClaimsError('receipt.consumer_manifest.schema_version must equal 1');
  if (!Array.isArray(manifest.consumers) || manifest.consumers.length !== CONSUMER_ORDER.length) {
    throw new ClaimsError('consumer manifest must contain exactly D2, D3, and D4');
  }
  if (!Array.isArray(manifest.optional_unconsumed_claim_ids)) throw new ClaimsError('optional_unconsumed_claim_ids must be an array');
  const declaredConsumers = manifest.consumers.map((consumer) => consumer && consumer.consumer_id);
  if (declaredConsumers.some((consumer) => !CONSUMER_ORDER.includes(consumer))) {
    throw new ClaimsError('consumer manifest contains an unknown consumer');
  }
  if (new Set(declaredConsumers).size !== declaredConsumers.length) {
    throw new ClaimsError('consumer manifest contains a duplicate consumer');
  }
  const allIds = new Set(receipt.claims.map((claim) => claim.claim_id));
  const partition = [];
  for (let index = 0; index < manifest.consumers.length; index += 1) {
    const consumer = manifest.consumers[index];
    exactKeys(consumer, ['consumer_id', 'required_claim_ids'], `receipt.consumer_manifest.consumers[${index}]`);
    if (consumer.consumer_id !== CONSUMER_ORDER[index]) throw new ClaimsError('consumer manifest order must be D2,D3,D4');
    if (!Array.isArray(consumer.required_claim_ids) || consumer.required_claim_ids.length === 0) {
      throw new ClaimsError(`consumer ${consumer.consumer_id} must have a non-empty required_claim_ids array`);
    }
    if (canonicalJson(consumer.required_claim_ids) !== canonicalJson([...consumer.required_claim_ids].sort())) {
      throw new ClaimsError(`consumer ${consumer.consumer_id} claim IDs are not in canonical order`);
    }
    partition.push(...consumer.required_claim_ids);
  }
  if (canonicalJson(manifest.optional_unconsumed_claim_ids) !== canonicalJson([...manifest.optional_unconsumed_claim_ids].sort())) {
    throw new ClaimsError('optional claim IDs are not in canonical order');
  }
  const optional = new Set(manifest.optional_unconsumed_claim_ids);
  for (const consumer of manifest.consumers) {
    for (const id of consumer.required_claim_ids) {
      if (optional.has(id)) throw new ClaimsError(`optional claim smuggled into consumer ${consumer.consumer_id}`);
    }
  }
  partition.push(...manifest.optional_unconsumed_claim_ids);
  const unique = new Set(partition);
  if (unique.size !== partition.length) throw new ClaimsError('duplicate claim ID across consumer partition');
  for (const id of partition) if (!allIds.has(id)) throw new ClaimsError(`unknown or substituted claim ID in consumer partition: ${id}`);
  if (unique.size !== allIds.size) throw new ClaimsError('unpartitioned receipt claim row');
  for (const id of allIds) if (!unique.has(id)) throw new ClaimsError('unpartitioned receipt claim row');
  for (const consumer of manifest.consumers) {
    for (const id of consumer.required_claim_ids) {
      const claim = receipt.claims.find((candidate) => candidate.claim_id === id);
      if (!claim || claim.status !== 'validated' || claim.revalidation.result !== 'passed') {
        throw new ClaimsError(`required claim ${id} for ${consumer.consumer_id} is not validated`);
      }
    }
  }
}

function validateReceipt(receipt) {
  exactKeys(receipt, ['schema_version', 'artifact_type', 'generated_at', 'validator_version', 'claims', 'consumer_manifest', 'consumer_manifest_digest', 'receipt_digest'], 'receipt');
  if (receipt.schema_version !== 1) throw new ClaimsError('receipt.schema_version must equal 1');
  if (receipt.artifact_type !== 'platform-capability-claims') throw new ClaimsError('receipt.artifact_type is invalid');
  isoMillis(receipt.generated_at, 'receipt.generated_at');
  if (receipt.validator_version !== VALIDATOR_VERSION) throw new ClaimsError('receipt.validator_version drift');
  if (!Array.isArray(receipt.claims) || receipt.claims.length === 0) throw new ClaimsError('receipt.claims must be non-empty');
  const ids = new Set();
  const capabilities = new Set();
  for (let index = 0; index < receipt.claims.length; index += 1) {
    const claim = receipt.claims[index];
    validateClaim(claim, index);
    if (ids.has(claim.claim_id)) throw new ClaimsError(`duplicate claim ID: ${claim.claim_id}`);
    if (capabilities.has(claim.capability_id)) throw new ClaimsError(`duplicate capability ID: ${claim.capability_id}`);
    ids.add(claim.claim_id);
    capabilities.add(claim.capability_id);
  }
  const sortedIds = receipt.claims.map((claim) => claim.claim_id).sort();
  if (canonicalJson(receipt.claims.map((claim) => claim.claim_id)) !== canonicalJson(sortedIds)) {
    throw new ClaimsError('receipt claims are not in canonical claim-ID order');
  }
  validateManifest(receipt);
  shaValue(receipt.consumer_manifest_digest, 'receipt.consumer_manifest_digest');
  if (receipt.consumer_manifest_digest !== sha256(canonicalJson(receipt.consumer_manifest))) {
    throw new ClaimsError('consumer manifest digest drift');
  }
  shaValue(receipt.receipt_digest, 'receipt.receipt_digest');
  if (receipt.receipt_digest !== sha256(canonicalJson({ ...receipt, receipt_digest: undefined }))) {
    throw new ClaimsError('receipt digest drift');
  }
}

function parseArgs(argv) {
  if (argv.length === 0 || ['-h', '--help'].includes(argv[0])) return { command: 'help' };
  const command = argv[0];
  const options = { consumers: [], claimIds: [], reprobe: false, emitClaimIds: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--reprobe') options.reprobe = true;
    else if (arg === '--emit-claim-ids') options.emitClaimIds = true;
    else if (['--input', '--output', '--receipt', '--consumer', '--claim-id'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new ClaimsError(`${arg} requires a value`);
      index += 1;
      if (arg === '--consumer') options.consumers.push(value);
      else if (arg === '--claim-id') options.claimIds.push(value);
      else options[arg.slice(2)] = value;
    } else throw new ClaimsError(`unknown argument: ${arg}`);
  }
  return { command, ...options };
}

function validateCommand(options, single) {
  if (!options.receipt) throw new ClaimsError('--receipt is required');
  if (options.consumers.length === 0) throw new ClaimsError('--consumer is required');
  if (single && options.consumers.length !== 1) throw new ClaimsError('validate-consumer accepts exactly one --consumer');
  if (!single && options.emitClaimIds) throw new ClaimsError('--emit-claim-ids is valid only with validate-consumer');
  if (!single && options.claimIds.length) throw new ClaimsError('--claim-id is valid only with validate-consumer');
  if (new Set(options.consumers).size !== options.consumers.length) throw new ClaimsError('duplicate consumer argument');
  for (const consumer of options.consumers) if (!CONSUMER_ORDER.includes(consumer)) throw new ClaimsError(`unknown consumer: ${consumer}`);
  const receipt = readJson(options.receipt, 'receipt');
  validateReceipt(receipt);
  for (const consumerId of options.consumers) {
    const binding = receipt.consumer_manifest.consumers.find((consumer) => consumer.consumer_id === consumerId);
    const expected = binding.required_claim_ids;
    if (single && options.claimIds.length && canonicalJson(options.claimIds) !== canonicalJson(expected)) {
      throw new ClaimsError(`downstream claim-ID drift for ${consumerId}`);
    }
    if (options.reprobe) {
      for (const id of expected) {
        const claim = receipt.claims.find((candidate) => candidate.claim_id === id);
        const reasons = coreEvidenceReasons(claim, Date.now(), { reprobe: true });
        if (reasons.length) throw new ClaimsError(`reprobe failed for ${id}: ${reasons.join(',')}`);
      }
    }
  }
  if (single && options.emitClaimIds) {
    const binding = receipt.consumer_manifest.consumers.find((consumer) => consumer.consumer_id === options.consumers[0]);
    process.stdout.write(`${JSON.stringify(binding.required_claim_ids)}\n`);
  } else {
    process.stdout.write(`validated consumers ${options.consumers.join(',')}\n`);
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'help') {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    if (options.command === 'generate') {
      if (!options.input || !options.output) throw new ClaimsError('generate requires --input and --output');
      generate(options.input, options.output);
      return;
    }
    if (options.command === 'validate-consumers') {
      validateCommand(options, false);
      return;
    }
    if (options.command === 'validate-consumer') {
      validateCommand(options, true);
      return;
    }
    throw new ClaimsError(`unknown command: ${options.command}`);
  } catch (error) {
    if (error instanceof ClaimsError) fail(error.message);
    throw error;
  }
}

main();
