#!/usr/bin/env node
'use strict';

// BL-0172: every --raw-dir *.jsonl sink in engine-qualify.js (usage, VA, brain, implementer ledger
// and exchanges, consult/discuss, reviewer/owner) writes an EMPTY file for zero rows and
// `row\nrow\n` otherwise. They all route through rawRowsText(); this pins the helper's bytes and
// pins that no sink bypasses it.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const eq = require('./engine-qualify');

const src = fs.readFileSync(path.join(__dirname, 'engine-qualify.js'), 'utf8');
let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

// 1. Helper bytes: zero rows -> size 0 on disk; two rows -> exact bytes (unchanged from before).
check(typeof eq.rawRowsText === 'function', 'rawRowsText is exported');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-raw-sinks-'));
try {
  const zero = path.join(tmp, 'zero.jsonl');
  fs.writeFileSync(zero, eq.rawRowsText([]));
  check(fs.statSync(zero).size === 0, 'zero rows: the file is empty (size 0), never a lone newline');
  const two = [{ a: 1, s: 'x\ny' }, { b: [2, 3] }];
  check(eq.rawRowsText(two) === '{"a":1,"s":"x\\ny"}\n{"b":[2,3]}\n',
    'two rows: one JSON row per line, each newline-terminated (pre-change bytes)');
  check(eq.rawRowsText([{ k: 1 }]) === '{"k":1}\n', 'one row: exactly one trailing newline');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 2. No sink bypasses the helper: the only inline JSONL join left is inside rawRowsText itself,
// and every writeFileSync to a rawDir *.jsonl takes its content from rawRowsText(...).
const inlineJoin = /JSON\.stringify\(row\)\)\.join\('\\n'\)/g;
check((src.match(inlineJoin) || []).length === 1, 'exactly one inline JSONL join remains (inside rawRowsText)');
const sinkWrites = [...src.matchAll(/fs\.writeFileSync\(\s*path\.join\(options\.rawDir,\s*([^)]*\.jsonl[^)]*)\),\s*([^,]+),/g)];
check(sinkWrites.length >= 7, `found every rawDir jsonl sink (got ${sinkWrites.length}, expected >= 7)`);
for (const [, target, content] of sinkWrites) {
  check(/^rawRowsText\(/.test(content.trim()), `sink ${target.trim()} writes via rawRowsText (got ${content.trim()})`);
}

process.stdout.write(`engine-qualify raw sinks: ${assertions} assertions passed\n`);
