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

  // (b) enum parity: every x-shell-validated schema field must be enforced by the
  // shell via a `case "$<x-shell-var>" in ...)` arm whose allowed-value set matches
  // the schema enum EXACTLY. Keying on the field's specific shell variable (not a
  // global value-set scan) is what lets this catch a REMOVED validation on a field
  // whose enum is SHARED with another field (e.g. reviewer_effort/implementer_effort,
  // spec_review/independent_harness).
  let shellSrc;
  try {
    shellSrc = fs.readFileSync(SHELL_PATH, 'utf8');
  } catch (e) {
    fail(`cannot read shell resolver ${SHELL_PATH}: ${e.message}`);
  }
  const props = schema.properties || {};
  for (const field of fieldOrder) {
    const prop = props[field];
    if (!prop || !prop['x-shell-validated']) continue;
    if (!Array.isArray(prop.enum) || prop.enum.length === 0) {
      fail(`schema field ${field} is x-shell-validated but has no enum`);
    }
    const shellVar = prop['x-shell-var'];
    if (!shellVar) {
      fail(`schema field ${field} is x-shell-validated but has no x-shell-var`);
    }
    const armRe = new RegExp('case\\s+"\\$' + shellVar + '"\\s+in\\s+([a-z0-9][a-z0-9|-]*)\\)');
    const armMatch = shellSrc.match(armRe);
    if (!armMatch) {
      fail(`shell has no \`case "$${shellVar}"\` validation arm for schema field ${field}`);
    }
    const shellSet = armMatch[1].split('|').sort().join('|');
    const schemaSet = [...prop.enum].sort().join('|');
    if (shellSet !== schemaSet) {
      fail(`enum drift for ${field} (shell $${shellVar}): shell={${armMatch[1]}} vs schema={${prop.enum.join('|')}}`);
    }
  }

  console.log(`contract-schema-ok (${fieldOrder.length} fields, field-set + enum parity verified)`);
  process.exit(0);
}

main();
