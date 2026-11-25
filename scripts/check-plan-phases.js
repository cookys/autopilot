#!/usr/bin/env node
'use strict';

/**
 * check-plan-phases.js — lint the machine-readable §4 phase table (`phases:v1`).
 *
 * Usage:
 *   node scripts/check-plan-phases.js <plan.md>
 *
 * Exit:
 *   0 — valid phases:v1 table
 *   1 — missing/invalid phases:v1 table (each problem printed to stderr with `phases:v1`)
 */

const fs = require('fs');
const { lintPlanInventory } = require('./lib/plan-inventory-lint');

const VALID_SIZES = new Set(['XS', 'S', 'M', 'L', 'XL']);
const VALID_NEEDS_LOOK = new Set(['yes', 'no']);
const EXPECTED_HEADER = ['id', 'size', 'depends_on', 'acceptance_cmd', 'needs_look', 'title'];
const PLACEHOLDER_RE = /\b(TODO|TBD)\b/i;

function parseRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  const inner = trimmed.slice(1, -1);
  return inner.split('|').map((c) => c.trim());
}

function isSeparatorRow(cells) {
  return cells.length === EXPECTED_HEADER.length && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function lintPlanPhases(markdown) {
  const errors = [];
  const startMatches = [...markdown.matchAll(/^<!--\s*phases:v1\s*-->[ \t]*$/gm)];
  if (startMatches.length === 0) {
    errors.push('phases:v1: missing <!-- phases:v1 --> table');
    return errors;
  }
  if (startMatches.length > 1) {
    errors.push(`phases:v1: expected exactly 1 <!-- phases:v1 --> table, found ${startMatches.length}`);
    return errors;
  }

  const startIdx = startMatches[0].index + startMatches[0][0].length;
  const endRe = /<!--\s*\/phases\s*-->/g;
  endRe.lastIndex = startIdx;
  const endMatch = endRe.exec(markdown);
  if (!endMatch) {
    errors.push('phases:v1: missing closing <!-- /phases --> marker');
    return errors;
  }

  const block = markdown.slice(startIdx, endMatch.index);
  const lines = block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 3) {
    errors.push('phases:v1: table must include header, separator, and at least one phase row');
    return errors;
  }

  const header = parseRow(lines[0]);
  if (!header || header.length !== EXPECTED_HEADER.length ||
      !EXPECTED_HEADER.every((col, idx) => header[idx] === col)) {
    errors.push(
      `phases:v1: header must be | ${EXPECTED_HEADER.join(' | ')} |`
    );
    return errors;
  }

  const sep = parseRow(lines[1]);
  if (!sep || !isSeparatorRow(sep)) {
    errors.push('phases:v1: missing or malformed markdown table separator row');
    return errors;
  }

  const seenIds = new Set();
  for (let i = 2; i < lines.length; i++) {
    const rowNum = i - 1;
    const cells = parseRow(lines[i]);
    if (!cells || cells.length !== EXPECTED_HEADER.length) {
      errors.push(
        `phases:v1: row ${rowNum} must have ${EXPECTED_HEADER.length} columns (got ${cells ? cells.length : 0})`
      );
      continue;
    }

    const [id, size, dependsOn, acceptanceCmd, needsLook, title] = cells;

    if (!id) {
      errors.push(`phases:v1: row ${rowNum} has empty id`);
    } else if (seenIds.has(id)) {
      errors.push(`phases:v1: duplicate id "${id}" at row ${rowNum}`);
    }

    if (!VALID_SIZES.has(size)) {
      errors.push(`phases:v1: row ${rowNum} (${id || '?'}) has invalid size "${size}" (expected XS|S|M|L|XL)`);
    }

    if (dependsOn !== '-') {
      const deps = dependsOn.split(',').map((d) => d.trim()).filter(Boolean);
      if (deps.length === 0) {
        errors.push(`phases:v1: row ${rowNum} (${id || '?'}) has invalid depends_on "${dependsOn}"`);
      } else {
        for (const dep of deps) {
          if (dep === id) {
            errors.push(`phases:v1: row ${rowNum} (${id}) has self-dependency/cycle on "${dep}"`);
          } else if (!seenIds.has(dep)) {
            errors.push(
              `phases:v1: row ${rowNum} (${id || '?'}) depends_on "${dep}" which is unknown or not defined in an earlier row`
            );
          }
        }
      }
    }

    if (!acceptanceCmd) {
      errors.push(`phases:v1: row ${rowNum} (${id || '?'}) has empty acceptance_cmd`);
    } else if (PLACEHOLDER_RE.test(acceptanceCmd)) {
      errors.push(`phases:v1: row ${rowNum} (${id || '?'}) acceptance_cmd contains TODO/TBD`);
    }

    if (!VALID_NEEDS_LOOK.has(needsLook)) {
      errors.push(`phases:v1: row ${rowNum} (${id || '?'}) has invalid needs_look "${needsLook}" (expected yes|no)`);
    }

    if (!title) {
      errors.push(`phases:v1: row ${rowNum} (${id || '?'}) has empty title`);
    }

    if (id) seenIds.add(id);
  }

  errors.push(...lintPlanInventory(markdown));

  return errors;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === '-h' || args[0] === '--help') {
    process.stderr.write('Usage: node scripts/check-plan-phases.js <plan.md>\n');
    process.exit(args.length === 1 ? 0 : 1);
  }
  const filePath = args[0];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    process.stderr.write(`phases:v1: cannot read "${filePath}": ${err.message}\n`);
    process.exit(1);
  }

  const errors = lintPlanPhases(content);
  if (errors.length > 0) {
    for (const e of errors) {
      process.stderr.write(`${e}\n`);
    }
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { lintPlanPhases };
