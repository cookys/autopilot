#!/usr/bin/env node
'use strict';

// check-contract-schema.js — drift gate reconciling scripts/resolve-review-loop.sh
// against the canonical schemas/review-loop-contract.schema.json SSOT.
//
// The JS resolver (src/engine/resolve-review-loop.js) DERIVES its field list and
// enum tables from the schema, so JS-vs-schema can never drift. This gate closes
// the OTHER side: it proves the SHELL resolver still agrees with the schema.
//
//   (a) field-set parity: the shell's default emitted JSON keys must be exactly
//       the schema's always-on contract field set (x-field-order). Catches the
//       on_engine_unavailable-class incident (a field present on one side only).
//   (b) enum parity: for every schema enum field marked x-shell-validated, the
//       shell must enforce that exact allowed-value set via a `case` alternation.
//
// Exit 0 + "contract-schema-ok" on agreement; exit 1 naming the drifting field(s).
// Node built-ins only. Consumed by hooks/tests/contract-parity.test.sh.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'review-loop-contract.schema.json');
const SHELL_PATH = path.join(REPO_ROOT, 'scripts', 'resolve-review-loop.sh');
const TEMPLATE_CONFIG = path.join(REPO_ROOT, 'project-config-template', 'review-loop-config.md');

function fail(msg) {
  console.error(`check-contract-schema: DRIFT — ${msg}`);
  process.exit(1);
}

function main() {
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (e) {
    fail(`cannot read/parse schema ${SCHEMA_PATH}: ${e.message}`);
  }
  const fieldOrder = schema['x-field-order'];
  if (!Array.isArray(fieldOrder) || fieldOrder.length === 0) {
    fail('schema x-field-order missing or empty');
  }
  const schemaFields = new Set(fieldOrder);

  // (a) field-set parity vs shell default output
  const run = spawnSync(SHELL_PATH, [], {
    cwd: REPO_ROOT,
    env: { ...process.env, REVIEW_LOOP_CONFIG_OVERRIDE: TEMPLATE_CONFIG },
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    fail(`resolve-review-loop.sh exited ${run.status}: ${run.stderr || ''}`);
  }
  let emitted;
  try {
    emitted = JSON.parse(run.stdout);
  } catch (e) {
    fail(`resolve-review-loop.sh stdout is not valid JSON: ${e.message}`);
  }
  const emittedKeys = new Set(Object.keys(emitted));
  const missing = [...schemaFields].filter((f) => !emittedKeys.has(f));
  const extra = [...emittedKeys].filter((k) => !schemaFields.has(k));
  if (missing.length) {
    fail(`shell output is MISSING schema field(s): ${missing.join(', ')}`);
  }
  if (extra.length) {
    fail(`shell output emits field(s) NOT in schema: ${extra.join(', ')}`);
  }

  // (b) enum parity: every x-shell-validated schema enum set must appear as a
  // shell `case` alternation (order-insensitive set match).
  let shellSrc;
  try {
    shellSrc = fs.readFileSync(SHELL_PATH, 'utf8');
  } catch (e) {
    fail(`cannot read shell resolver ${SHELL_PATH}: ${e.message}`);
  }
  const shellSets = new Set();
  const caseRe = /([a-z0-9][a-z0-9-]*(?:\|[a-z0-9][a-z0-9-]*)+)\)/g;
  let m;
  while ((m = caseRe.exec(shellSrc)) !== null) {
    shellSets.add(m[1].split('|').sort().join('|'));
  }
  const props = schema.properties || {};
  for (const field of fieldOrder) {
    const prop = props[field];
    if (!prop || !prop['x-shell-validated']) continue;
    if (!Array.isArray(prop.enum) || prop.enum.length === 0) {
      fail(`schema field ${field} is x-shell-validated but has no enum`);
    }
    const key = [...prop.enum].sort().join('|');
    if (!shellSets.has(key)) {
      fail(`shell has no case-set matching schema enum for ${field}: expected {${prop.enum.join('|')}}`);
    }
  }

  console.log(`contract-schema-ok (${fieldOrder.length} fields, field-set + enum parity verified)`);
  process.exit(0);
}

main();
