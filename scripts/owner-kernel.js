#!/usr/bin/env node
'use strict';

// Owner Kernel intentionally has no generic append command. Authoritative
// events are minted only by the host-resident adapter APIs in src/engine.

const fs = require('fs');
const path = require('path');

const {
  deriveTranslationStatus,
  parseLedgerJsonl,
  resolveGovernancePolicy,
  translateLegacyLevel,
  verifyLedger,
} = require('../src/engine/owner-kernel');
const { deriveDisclosure } = require('../src/engine/owner-kernel/state');

const USAGE = `Usage:
  node scripts/owner-kernel.js resolve --config <governance.json> [--mode owner-led|milestone-led] [--check]
  node scripts/owner-kernel.js verify --ledger <owner-kernel.jsonl>
  node scripts/owner-kernel.js status --ledger <owner-kernel.jsonl>
  node scripts/owner-kernel.js disclose --ledger <owner-kernel.jsonl>
  node scripts/owner-kernel.js translate-level --config <governance.json> --level <l3|l4|l5|l6> [--mode owner-led|milestone-led] [--expand] [--solo] [-x <red-line-csv>] [--check]
  node scripts/owner-kernel.js translate-level --config <governance.json> --all [--mode owner-led|milestone-led] [--check]

The CLI is intentionally read-only for ledgers. It cannot append, mint, approve,
or accept events; those operations require trusted host adapters outside model and
workspace reach.`;

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { help: true };
  }
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check' || arg === '--expand' || arg === '--solo' || arg === '--all') {
      const key = arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error(`duplicate option "${arg}"`);
      options[key] = true;
      continue;
    }
    const isShortRedLines = arg === '-x';
    if (!isShortRedLines && !arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const key = isShortRedLines ? 'redLines' : arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (!['config', 'mode', 'ledger', 'level', 'redLines'].includes(key)) throw new Error(`unknown option "${arg}"`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for "${arg}"`);
    if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error(`duplicate option "${arg}"`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function readJson(filePath, label) {
  const absolute = path.resolve(filePath);
  let source;
  try {
    source = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${label} "${absolute}": ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} "${absolute}" is not valid JSON: ${error.message}`);
  }
}

function readLedger(filePath) {
  const absolute = path.resolve(filePath);
  let source;
  try {
    source = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ledger "${absolute}": ${error.message}`);
  }
  return parseLedgerJsonl(source);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseRedLineCsv(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('-x requires one or more comma-separated red-line tokens');
  const values = value.split(',');
  if (values.some((entry) => !/^[A-Za-z0-9._:-]{1,128}$/.test(entry))) {
    throw new Error('-x values must be comma-separated bounded red-line tokens without whitespace');
  }
  if (new Set(values).size !== values.length) throw new Error('-x must not repeat a red-line token');
  return values.sort();
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(`${error.message}\n\n${USAGE}`);
    return;
  }
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  try {
    const { command, options } = parsed;
    if (command === 'resolve') {
      if (!options.config || options.ledger || Object.keys(options).some((key) => !['config', 'mode', 'check'].includes(key))) {
        throw new Error('resolve requires --config and accepts only --mode and --check');
      }
      const config = readJson(options.config, 'governance config');
      const resolved = resolveGovernancePolicy(config, { modeOverride: options.mode });
      emit({
        status: 'ok',
        check: options.check === true,
        policy: resolved.policy,
        policy_hash: resolved.policy_hash,
      });
      return;
    }

    if (command === 'translate-level') {
      if (!options.config || options.ledger
        || Object.keys(options).some((key) => !['config', 'mode', 'check', 'level', 'redLines', 'expand', 'solo', 'all'].includes(key))) {
        throw new Error('translate-level requires --config and accepts only --level/--all, --mode, --expand, --solo, -x, and --check');
      }
      if (Boolean(options.level) === Boolean(options.all)) {
        throw new Error('translate-level requires exactly one of --level or --all');
      }
      if (options.all && (options.expand || options.solo || options.redLines)) {
        throw new Error('translate-level --all cannot combine with --expand, --solo, or -x');
      }
      const resolved = resolveGovernancePolicy(readJson(options.config, 'governance config'), {
        modeOverride: options.mode,
      });
      const flags = {
        expand: options.expand === true,
        solo: options.solo === true,
        red_line_additions: options.redLines === undefined ? [] : parseRedLineCsv(options.redLines),
      };
      const levels = options.all ? ['l3', 'l4', 'l5', 'l6'] : [options.level];
      const translations = levels.map((level) => translateLegacyLevel({
        level,
        flags,
        policy: resolved.policy,
        policyHash: resolved.policy_hash,
      }));
      emit({
        status: 'ok',
        check: options.check === true,
        policy_hash: resolved.policy_hash,
        ...(options.all ? { translations } : { translation: translations[0] }),
        owner_kernel_authority: 'none',
        acceptance: 'not_available',
      });
      return;
    }

    if (!['verify', 'status', 'disclose'].includes(command)) {
      throw new Error(`unknown command "${command}"`);
    }
    if (!options.ledger || Object.keys(options).some((key) => key !== 'ledger')) {
      throw new Error(`${command} requires --ledger`);
    }
    const ledger = readLedger(options.ledger);
    const verified = verifyLedger(ledger, {
      allowUnverifiedAcceptanceProof: true,
    });
    if (command === 'verify') {
      emit({
        status: 'structural_valid',
        run_id: verified.header.run_id,
        event_count: verified.event_count,
        ledger_head: verified.state.event_head,
        witness_status: 'receipt_chain_structural_only',
        acceptance_proof: verified.acceptance_proof_unverified ? 'unverified' : 'not_applicable_or_verified',
        production_activation: 'blocked_without_external_witness_adapter',
      });
      return;
    }
    if (command === 'status') {
      emit({
        status: 'ok',
        run_id: verified.state.run_id,
        run_status: verified.state.status,
        active_principal: verified.state.active_principal ? verified.state.active_principal.identity : null,
        current_intent_id: verified.state.current_intent_id,
        ledger_head: verified.state.event_head,
        blocked_since: verified.state.blocked_since,
        acceptance_attempt: verified.state.acceptance_attempt
          ? {
            attempt_id: verified.state.acceptance_attempt.attempt_id,
            status: verified.state.acceptance_attempt.status,
          }
          : null,
        acceptance_recovery_required: Boolean(verified.state.acceptance_attempt
          && verified.state.acceptance_attempt.status === 'pending'),
        acceptance_proof: verified.acceptance_proof_unverified ? 'unverified' : 'not_applicable_or_verified',
        translations: {
          ...deriveTranslationStatus(ledger.events),
          verification: 'unverified_without_external_witness_adapter',
          alias_retirement_eligible: false,
        },
      });
      return;
    }
    emit({
      status: 'ok',
      disclosure: deriveDisclosure(verified.state),
      acceptance_proof: verified.acceptance_proof_unverified ? 'unverified' : 'not_applicable_or_verified',
    });
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }
}

main();
