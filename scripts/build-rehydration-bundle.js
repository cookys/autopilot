#!/usr/bin/env node
'use strict';

/**
 * build-rehydration-bundle.js — the stateless brain's boot bundle
 * (autonomous-brain-integration P2; plan: docs/plans/2026-08-17-autonomous-brain-integration.md).
 *
 * Kills sol shapes F8/F9 (post-compaction state amnesia → progress misreporting,
 * ownership split-brain). The brain holds NO load-bearing state in context: at
 * every round start it rehydrates from this bundle; at every round boundary it
 * persists and resets. Hour 7 is judged like hour 1 because every hour boots
 * from disk.
 *
 * FROZEN five-section layout (order and content are part of the plan's contract;
 * every section is load-bearing and bounded by construction — there is NO
 * truncation: a bundle over the cap is a BUILD ERROR that stops the round and
 * surfaces in the report, never a silent trim):
 *   ① frozen_four_tuple  — verbatim from the campaign contract
 *   ② red lines          — contract.no_go + optional --red-lines file content
 *   ③ control-plane digests — the pin map (roster/preference/task-class/gates)
 *   ④ decision-ledger tail — last 20 rows (bounded view)
 *   ⑤ owned-process table  — {run_id, pid, alive} from the manifest dir
 * Cap: 80,000 bytes (the plan's 20k-token budget at the documented 4-bytes/token
 * approximation).
 *
 * Modes:
 *   build --contract <file> [--ledger <file>] [--manifest-dir <dir>]
 *         [--red-lines <file>] [--out <file>]
 *   quiz  --contract <file> --intent <file> [--ledger <file>] [--manifest-dir <dir>]
 *     Emits DISK TRUTH for the fixed-schema state quiz:
 *     {current_unit_id, four_tuple_digest, owned_pids, last3_decision_ids}
 *   grade --contract <file> --intent <file> --answer <file> [--ledger <file>]
 *         [--manifest-dir <dir>]
 *     Exact-match grades a brain's answer JSON against disk truth (KR2). Any
 *     mismatch exits 1 and the round must refuse to proceed.
 *
 * Exit: 0 ok · 1 cap breach / quiz mismatch · 2 usage. Node >= 20.10 built-ins.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUNDLE_CAP_BYTES = 80000; // 20k tokens × ~4 bytes/token
const LEDGER_TAIL_ROWS = 20;

function usage(message) {
  process.stderr.write(`build-rehydration-bundle: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (!['build', 'quiz', 'grade'].includes(mode)) usage('mode must be build|quiz|grade');
  const opts = { mode };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    if (arg === '--contract') opts.contract = value;
    else if (arg === '--ledger') opts.ledger = value;
    else if (arg === '--manifest-dir') opts.manifestDir = value;
    else if (arg === '--red-lines') opts.redLines = value;
    else if (arg === '--out') opts.out = value;
    else if (arg === '--intent') opts.intent = value;
    else if (arg === '--answer') opts.answer = value;
    else usage(`unknown argument: ${arg}`);
    i += 1;
  }
  if (!opts.contract) usage('--contract is required');
  if ((mode === 'quiz' || mode === 'grade') && !opts.intent) usage('--intent is required');
  if (mode === 'grade' && !opts.answer) usage('--answer is required');
  return opts;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    usage(`${label} unreadable or invalid JSON: ${file}`);
  }
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function ledgerTail(ledgerFile) {
  if (!ledgerFile || !fs.existsSync(ledgerFile)) return [];
  const rows = [];
  for (const line of fs.readFileSync(ledgerFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) { /* skip malformed telemetry */ }
  }
  return rows.slice(-LEDGER_TAIL_ROWS);
}

function ownedProcesses(manifestDir) {
  if (!manifestDir || !fs.existsSync(manifestDir)) return [];
  const out = [];
  for (const file of fs.readdirSync(manifestDir).filter((f) => f.endsWith('.manifest.json')).sort()) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf8'));
    } catch (err) { continue; }
    if (!manifest || typeof manifest.run_id !== 'string') continue;
    const pid = Number(manifest.pid);
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; } catch (err) { alive = false; }
    }
    out.push({ run_id: manifest.run_id, pid: Number.isInteger(pid) ? pid : null, alive });
  }
  return out;
}

function fourTupleDigest(fft) {
  return crypto.createHash('sha256').update(canonicalJson(fft)).digest('hex');
}

function diskTruth(opts) {
  const contract = readJson(opts.contract, 'contract');
  if (!contract.frozen_four_tuple) usage('contract carries no frozen_four_tuple');
  const intent = readJson(opts.intent, 'intent');
  const tail = ledgerTail(opts.ledger);
  const decisions = tail.filter((r) => r.decision_id).map((r) => r.decision_id);
  return {
    current_unit_id: intent.unit_id,
    four_tuple_digest: fourTupleDigest(contract.frozen_four_tuple),
    owned_pids: ownedProcesses(opts.manifestDir)
      .filter((p) => p.alive).map((p) => p.pid).sort((a, b) => a - b),
    last3_decision_ids: decisions.slice(-3),
  };
}

function build(opts) {
  const contract = readJson(opts.contract, 'contract');
  if (!contract.frozen_four_tuple) usage('contract carries no frozen_four_tuple');
  const redLines = {
    contract_no_go: contract.no_go || {},
    red_lines_doc: opts.redLines && fs.existsSync(opts.redLines)
      ? fs.readFileSync(opts.redLines, 'utf8')
      : null,
  };
  const bundle = {
    schema_version: 1,
    artifact_type: 'rehydration_bundle',
    built_at: new Date().toISOString(),
    cap_bytes: BUNDLE_CAP_BYTES,
    sections: {
      '1_frozen_four_tuple': contract.frozen_four_tuple,
      '2_red_lines': redLines,
      '3_control_plane_digests': contract.frozen_four_tuple.control_plane_pins,
      '4_ledger_tail': ledgerTail(opts.ledger),
      '5_owned_processes': ownedProcesses(opts.manifestDir),
    },
  };
  const serialized = `${JSON.stringify(bundle, null, 1)}\n`;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > BUNDLE_CAP_BYTES) {
    process.stderr.write(
      `build-rehydration-bundle: BUILD ERROR — bundle is ${bytes} bytes > cap ${BUNDLE_CAP_BYTES}. `
      + 'No section is truncatable (all five are load-bearing); shrink the SOURCES '
      + '(smaller DAG, fewer live processes) and rebuild. The round must not start.\n',
    );
    process.exit(1);
  }
  if (opts.out) fs.writeFileSync(opts.out, serialized, { mode: 0o600 });
  else process.stdout.write(serialized);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'build') { build(opts); return; }
  const truth = diskTruth(opts);
  if (opts.mode === 'quiz') {
    process.stdout.write(`${JSON.stringify(truth)}\n`);
    return;
  }
  const answer = readJson(opts.answer, 'answer');
  const mismatches = [];
  for (const key of ['current_unit_id', 'four_tuple_digest', 'owned_pids', 'last3_decision_ids']) {
    if (canonicalJson(answer[key]) !== canonicalJson(truth[key])) {
      mismatches.push({ field: key, expected: truth[key], got: answer[key] === undefined ? null : answer[key] });
    }
  }
  const result = { schema_version: 1, artifact_type: 'rehydration_quiz_grade', pass: mismatches.length === 0, mismatches };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(mismatches.length === 0 ? 0 : 1);
}

main();
