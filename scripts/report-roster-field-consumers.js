#!/usr/bin/env node
'use strict';
// report-roster-field-consumers — ADVISORY report (never a gate).
//
// Mechanizes the manual dead-field recipe from the owner-kernel P0 semantic inventory:
// for every always-on field in schemas/review-loop-contract.schema.json, count literal
// matches across the scan roots and report which bucket each field falls in.
//
// WHAT THIS MEASURES: literal matches under the classifier below. It does NOT determine
// consumption. It cannot tell an executable read from a same-shaped token in a string,
// nor an instruction in a skills/** document from an incidental mention there, nor see a
// consumer reached by forwarding or by an accessor shape not modelled here. The output
// vocabulary is therefore "no detected modeled match" — never "unenforced" or "dead".
//
// EXIT CODES:
//   0 — the report ran, whatever it found. Findings never change the exit code; an exit
//       code varying with findings would make this a gate by accident.
//   2 — the report could NOT run (schema unreadable/unparseable, git failure, bad usage),
//       accompanied by a `REPORT-HEALTH: FAILED <reason>` line on stderr. A broken tool is
//       not a verdict about fields: without this, a schema or git failure would produce no
//       table while CI stayed green, defeating the report's only purpose.
//
// Plan: docs/plans/2026-07-25-roster-field-report.md
// Node built-ins only.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// --- contract: scan roots. Deliberately the SAME set as the sync-manifest triggers, so
// the scanned set and the triggered set are equal by construction. A tracked file outside
// these roots is invisible to this report — a stated limit, not an accident.
const SCAN_ROOTS = ['src/', 'scripts/', 'skills/', 'hooks/', 'references/', 'bin/', 'agents/'];

// --- contract: exclusions. Places that are not where an agent or program is instructed from.
// Entries marked (redundant today) sit outside SCAN_ROOTS already and are kept so the
// exclusion contract survives a future widening of the roots.
const EXCLUDE_FILES = new Set([
  'scripts/resolve-review-loop.sh',      // producer
  'src/engine/resolve-review-loop.js',   // producer
  'scripts/check-contract-schema.js',    // the producers' parity gate
  'CHANGELOG.md',                        // (redundant today) release notes
  'CLAUDE.md',                           // (redundant today) script-inventory table
  'project-config-template/review-loop-config.md', // (redundant today) names every field by construction
]);
const EXCLUDE_PREFIXES = [
  'hooks/tests/',        // tests of the producers
  'schemas/',            // (redundant today) the SSOT
  'platforms/',          // (redundant today) generated mirror
  'docs/',               // (redundant today) plans and project records
  'evals/',              // (redundant today) fixtures
];

const EXECUTABLE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh', '.bash', '.py']);

function usage() {
  return [
    'usage: report-roster-field-consumers.js [repo-dir] [--json]',
    '',
    'Advisory report over the always-on review-loop roster fields.',
    'Exit 0 = ran (any findings). Exit 2 = could not run (see REPORT-HEALTH on stderr).',
  ].join('\n');
}

function healthFail(reason) {
  process.stderr.write(`REPORT-HEALTH: FAILED ${reason}\n`);
  process.exit(2);
}

// --- classifier -------------------------------------------------------------
// The ten access shapes, numbered to match the plan's §1a enumeration. Quote
// alternatives inside one entry are ONE shape, not two.
function accessPatterns(field) {
  const F = field.toUpperCase();
  return [
    new RegExp(`\\.${field}\\b`),                          // 1  property access
    new RegExp(`\\[["']${field}["']\\]`),                  // 2  bracketed key
    new RegExp(`["']${field}["']`),                        // 3  quoted string / object key
    new RegExp(`\\$\\{?${F}\\b`),                          // 4  $FIELD / ${FIELD}
    new RegExp(`\\b${F}=`),                                // 5  FIELD=
    new RegExp(`\\b${field}=`),                            // 6  field=
    new RegExp(`\\$\\{?${field}\\b`),                      // 7  $field / ${field}
    new RegExp(`--field\\s+${field}\\b`),                  // 8  resolver flag
    new RegExp(`read_review_loop_field\\s+${field}\\b`),   // 9  repo accessor
    new RegExp(`\\b${field}\\)`),                          // 10 shell case arm
  ];
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*');
}

function isExcluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PREFIXES.some((p) => rel.startsWith(p));
}

function inScanRoots(rel) {
  return SCAN_ROOTS.some((r) => rel.startsWith(r));
}

// --- main -------------------------------------------------------------------
function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const asJson = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--'));
  if (positional.length > 1) healthFail(`too many arguments (got ${positional.length})`);
  const repo = path.resolve(positional[0] || process.cwd());

  let schema;
  const schemaPath = path.join(repo, 'schemas/review-loop-contract.schema.json');
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    healthFail(`cannot read or parse ${schemaPath}: ${err.message}`);
  }
  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    healthFail(`${schemaPath}: "required" must be a non-empty array (the always-on field set)`);
  }
  const FIELDS = schema.required;

  let tracked;
  try {
    tracked = execFileSync('git', ['-C', repo, 'ls-files'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }).split('\n').filter(Boolean);
  } catch (err) {
    healthFail(`git ls-files failed in ${repo}: ${err.message}`);
  }

  const files = tracked.filter((rel) => inScanRoots(rel) && !isExcluded(rel));
  const results = Object.fromEntries(FIELDS.map((f) => [f, { access: [], incidental: [], skills: [] }]));
  // The pre-filters are case-INSENSITIVE on purpose: access shapes 4 and 5 are the
  // uppercase shell forms ($FIELD / FIELD=), so a case-sensitive lowercase pre-filter
  // would make those two shapes unreachable — the classifier would document ten shapes
  // and only ever fire eight. Caught by the per-shape positive cases in the oracle.
  const anyField = new RegExp(`\\b(${FIELDS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  const perField = Object.fromEntries(FIELDS.map((f) => [f, { word: new RegExp(`\\b${f}\\b`, 'i'), pats: accessPatterns(f) }]));

  for (const rel of files) {
    const abs = path.join(repo, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) continue;
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch (err) {
      healthFail(`unreadable scan-root file ${rel}: ${err.message}`);
    }
    if (!anyField.test(text)) continue;

    const executable = EXECUTABLE_EXT.has(path.extname(rel));
    const underSkills = rel.startsWith('skills/');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!anyField.test(line)) continue;
      for (const f of FIELDS) {
        const { word, pats } = perField[f];
        if (!word.test(line)) continue;
        const site = { file: rel, line: i + 1 };
        if (executable) {
          const shaped = !isComment(line) && pats.some((r) => r.test(line));
          (shaped ? results[f].access : results[f].incidental).push(site);
        } else if (underSkills) {
          results[f].skills.push(site);
        }
        // a non-executable file outside skills/ inside the scan roots is neither
        // an access nor a skills match; it is not counted.
      }
    }
  }

  const summary = FIELDS.map((f) => {
    const r = results[f];
    const bucket = r.access.length > 0 ? 'code-match'
      : r.skills.length > 0 ? 'skills-match'
        : 'no-detected-modeled-match';
    return {
      field: f,
      access_shaped: r.access.length,
      incidental: r.incidental.length,
      skills: r.skills.length,
      bucket,
      access_sites: r.access.slice(0, 3).map((s) => `${s.file}:${s.line}`),
      skills_sites: r.skills.slice(0, 3).map((s) => `${s.file}:${s.line}`),
    };
  });

  const totals = summary.reduce((acc, s) => {
    acc[s.bucket] = (acc[s.bucket] || 0) + 1;
    return acc;
  }, {});

  if (asJson) {
    process.stdout.write(`${JSON.stringify({
      schema: schemaPath, scan_roots: SCAN_ROOTS, fields: FIELDS.length, totals, summary,
    }, null, 1)}\n`);
    return 0;
  }

  const w = Math.max(5, ...FIELDS.map((f) => f.length));
  const out = [];
  out.push(`${'field'.padEnd(w)}  access  incid  skills  bucket`);
  for (const s of summary) {
    out.push(
      `${s.field.padEnd(w)}  ${String(s.access_shaped).padStart(6)}  ${String(s.incidental).padStart(5)}` +
      `  ${String(s.skills).padStart(6)}  ${s.bucket}`,
    );
  }
  out.push('');
  out.push('--- totals ---');
  for (const k of ['code-match', 'skills-match', 'no-detected-modeled-match']) {
    if (totals[k]) out.push(`${k}: ${totals[k]}`);
  }
  const dead = summary.filter((s) => s.bucket === 'no-detected-modeled-match');
  if (dead.length) {
    out.push('');
    out.push('no detected modeled match (advisory — see the plan for what this does and does not mean):');
    for (const s of dead) out.push(`  - ${s.field}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

process.exit(main(process.argv));
