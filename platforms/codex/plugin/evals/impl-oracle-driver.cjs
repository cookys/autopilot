#!/usr/bin/env node
'use strict';

// impl-oracle-driver — frozen oracle driver for the implementer qualification
// suite (plan: docs/plans/2026-08-22-implementer-qualification-suite.md, R2
// FROZEN). Runs INSIDE bwrap. Architecture pinned by G1-F14 / G2-F2:
//
//   qualifier (host, holds expectations in memory)
//     └─ bwrap: node impl-oracle-driver.cjs            <- THIS process (driver)
//          └─ node impl-oracle-driver.cjs --worker M E <- grandchild (candidate isolate)
//
// The driver receives {module_path, export_name, vectors:[{args, expect}]} on
// STDIN. It forwards ONLY the args to the worker (one JSON line per call) and
// compares the worker's observed results against the expectations HERE — the
// candidate isolate never sees an expectation, so a same-isolate frame walk
// (the t15/t17 exploit family) has nothing to steal. Any worker non-success
// (crash, timeout handled by the host wall, malformed line, missing line) is a
// deviation — reported, never masked (candidate-induced driver death is the
// host's oracle_miss, G2-F2).
//
// Output (stdout, single JSON line):
//   { schema_version: 1, ok: <bool>, checked: N,
//     deviations: [{index, kind, detail}] }
// Exit 0 = protocol completed (ok may be false); nonzero = driver-level fault.

const { spawn } = require('child_process');
const path = require('path');

function normalize(value) {
  // Fail-closed value algebra: only JSON-representable values ever satisfy an
  // expectation; undefined / NaN / -0 / functions / cycles normalize to a
  // sentinel that equals nothing.
  try {
    if (value === undefined) return { unsupported: 'undefined' };
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return { unsupported: 'nan' };
      if (Object.is(value, -0)) return { unsupported: 'negative-zero' };
    }
    const round = JSON.parse(JSON.stringify({ v: value }));
    return round.v === undefined ? { unsupported: 'undefined' } : round.v;
  } catch {
    return { unsupported: 'unserializable' };
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------- worker mode
if (process.argv[2] === '--worker') {
  const modulePath = process.argv[3];
  const exportName = process.argv[4];
  let target;
  try {
    const mod = require(path.resolve(modulePath));
    target = exportName ? mod[exportName] : mod;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ fatal: `require_failed: ${error && error.message}` })}\n`);
    process.exit(0);
  }
  if (typeof target !== 'function') {
    process.stdout.write(`${JSON.stringify({ fatal: 'export_not_function' })}\n`);
    process.exit(0);
  }
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let call;
      try {
        call = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ fatal: 'bad_call_line' })}\n`);
        process.exit(0);
      }
      let out;
      try {
        out = { returned: normalize(target(...call.args)) };
      } catch (error) {
        out = {
          threw: {
            name: error && error.name ? String(error.name) : 'Error',
            message: error && error.message ? String(error.message) : '',
          },
        };
      }
      process.stdout.write(`${JSON.stringify(out)}\n`);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  return;
}

// ---------------------------------------------------------------- driver mode
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.stderr.write('driver: malformed stdin payload\n');
    process.exit(2);
  }
  const vectors = Array.isArray(payload.vectors) ? payload.vectors : [];
  const worker = spawn(process.execPath, [
    __filename, '--worker', payload.module_path, payload.export_name || '',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const deviations = [];
  let lines = [];
  let workerOut = '';
  worker.stdout.setEncoding('utf8');
  worker.stdout.on('data', (chunk) => { workerOut += chunk; });
  worker.stderr.resume();
  for (const vector of vectors) {
    worker.stdin.write(`${JSON.stringify({ args: vector.args })}\n`);
  }
  worker.stdin.end();
  worker.on('close', (code, signal) => {
    lines = workerOut.split('\n').filter((line) => line.trim() !== '');
    for (let i = 0; i < vectors.length; i += 1) {
      const expect = vectors[i].expect;
      const raw = lines[i];
      if (raw === undefined) {
        deviations.push({ index: i, kind: 'missing_observation', detail: `worker ended (code=${code} signal=${signal || ''})` });
        continue;
      }
      let observed;
      try {
        observed = JSON.parse(raw);
      } catch {
        deviations.push({ index: i, kind: 'malformed_observation', detail: raw.slice(0, 120) });
        continue;
      }
      if (observed.fatal) {
        deviations.push({ index: i, kind: 'worker_fatal', detail: observed.fatal });
        continue;
      }
      if (expect.kind === 'returns') {
        if (!('returned' in observed)
          || canonicalJson(observed.returned) !== canonicalJson(expect.value)) {
          deviations.push({ index: i, kind: 'value_mismatch', detail: JSON.stringify(observed).slice(0, 200) });
        }
      } else if (expect.kind === 'throws') {
        const threw = observed.threw;
        if (!threw || threw.name !== expect.name
          || (expect.message_includes && !String(threw.message).includes(expect.message_includes))) {
          deviations.push({ index: i, kind: 'throw_mismatch', detail: JSON.stringify(observed).slice(0, 200) });
        }
      } else {
        deviations.push({ index: i, kind: 'bad_expectation', detail: String(expect.kind) });
      }
    }
    if (lines.length > vectors.length) {
      deviations.push({ index: vectors.length, kind: 'excess_observations', detail: String(lines.length) });
    }
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      ok: deviations.length === 0,
      checked: vectors.length,
      deviations,
    })}\n`);
    process.exit(0);
  });
});
