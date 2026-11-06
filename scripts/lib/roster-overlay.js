#!/usr/bin/env node
// roster-overlay.js - the one implementation of "roster + repo file" for review-loop-config.
//
//   node scripts/lib/roster-overlay.js --template <roster.md> --repo <repo-config.md> --out <effective.md>
//
// The template (project-config-template/review-loop-config.md) is the only roster. A repo file
// may hold seat fields only inside an override block: a declaration line
//   - override: <group> | until YYYY-MM-DD | <reason>
// plus the group's fields. The effective file takes, per group, the repo's whole group when it
// declared an override and the roster's whole group otherwise; non-seat knobs come from the repo
// when it writes them and from the roster otherwise.
//
// stdout: [{"group","until","reason"}] (the declared overrides). Exit 0 ok, 3 refused (message on stderr).
// Node built-ins only. Parsing matches scripts/lib/resolve-config.sh: HTML comments are removed
// first, a field is `key: value` with an optional leading dash.
'use strict';

const fs = require('fs');

// Group membership of every seat field. Fields not matched here are non-seat knobs.
const GROUPS = [
  { name: 'reviewer', re: /^reviewer_(engine|effort|runner|endpoint|limitation|limitation_required|engine_low_risk|effort_low_risk|fallback_preference|fallback_preference_low_risk)$/,
    required: ['reviewer_engine', 'reviewer_runner', 'reviewer_effort'] },
  { name: 'implementer', re: /^implementer_(engine|effort|runner|endpoint|ladder)$/,
    required: ['implementer_engine', 'implementer_runner', 'implementer_effort'] },
  { name: 'verification_author', re: /^verification_author_(present|engine|runner|effort|endpoint)$/,
    required: ['verification_author_present'] },
  { name: 'qc_panel', re: /^(qc_panel|qc_panel_runners|qc_panel_efforts|qc_panel_endpoints|min_panel_size|qc_panel_aggregation)$/,
    required: ['qc_panel', 'qc_panel_runners', 'qc_panel_efforts'] },
  { name: 'consult', re: /^consult_(engine|effort|runner|endpoint)$/, required: [] },
  { name: 'discuss', re: /^discuss_(engine|effort|runner|endpoint)$/, required: [] },
  { name: 'plan_deep_reviewer', re: /^plan_deep_reviewer_[a-z_]+$/, required: [] },
  { name: 'plan_reviewer', re: /^plan_reviewer_[a-z_]+$/, required: [] },
];

function groupOf(key) {
  for (const g of GROUPS) if (g.re.test(key)) return g.name;
  return null;
}

// The file with HTML comments (multi-line or inline) removed, split into lines.
function visibleLines(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, '')).split('\n');
}

const FIELD_RE = /^\s*-?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/;
const OVERRIDE_RE = /^\s*-?\s*override\s*:\s*(.*?)\s*$/i;

function parse(text) {
  const entries = [];
  const decls = [];
  for (const line of visibleLines(text)) {
    const o = OVERRIDE_RE.exec(line);
    if (o) { decls.push(o[1]); continue; }
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    entries.push({ key: m[1].toLowerCase(), value: m[2], raw: line.replace(/\s+$/, '') });
  }
  return { entries, decls };
}

function fail(lines) {
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(3);
}

function parseDecl(decl) {
  const parts = decl.split('|').map((s) => s.trim());
  if (parts.length < 3) return { error: `needs three parts "<group> | until YYYY-MM-DD | <reason>": ${decl}` };
  const group = parts[0];
  const until = /^until\s+(\d{4}-\d{2}-\d{2})$/.exec(parts[1]);
  const reason = parts.slice(2).join('|').trim();
  if (!GROUPS.some((g) => g.name === group)) return { error: `unknown group "${group}": ${decl}` };
  if (!until) return { error: `second part must be "until YYYY-MM-DD": ${decl}` };
  if (!reason) return { error: `reason is empty: ${decl}` };
  return { group, until: until[1], reason };
}

function overlay(templateText, repoText) {
  const tpl = parse(templateText);
  const repo = parse(repoText);
  const problems = [];

  const declared = new Map();
  for (const d of repo.decls) {
    const p = parseDecl(d);
    if (p.error) { problems.push(`override declaration ${p.error}`); continue; }
    if (declared.has(p.group)) { problems.push(`override declared twice for group ${p.group}`); continue; }
    declared.set(p.group, { group: p.group, until: p.until, reason: p.reason });
  }

  const repoSeatFields = repo.entries.filter((e) => groupOf(e.key));
  const outside = repoSeatFields.filter((e) => !declared.has(groupOf(e.key)));
  if (outside.length) {
    const groups = [...new Set(outside.map((e) => groupOf(e.key)))];
    problems.push(
      `seat fields outside an override block: ${outside.map((e) => e.key).join(', ')}`,
      'The roster (project-config-template/review-loop-config.md) is the only place seats are written.',
      'Fix: delete those lines so this repo follows the roster, or keep a group on purpose by putting a line',
      `  - override: ${groups[0]} | until YYYY-MM-DD | <reason>`,
      'above that group\'s whole field set.',
    );
  }
  for (const [group, d] of declared) {
    const have = new Set(repoSeatFields.filter((e) => groupOf(e.key) === group).map((e) => e.key));
    if (!have.size) problems.push(`override for ${group} has no fields (${d.until})`);
    const need = GROUPS.find((g) => g.name === group).required.filter((k) => !have.has(k));
    if (have.size && need.length) problems.push(`override for ${group} is incomplete, missing: ${need.join(', ')}`);
  }
  if (problems.length) return { problems };

  const repoKeys = new Set(repo.entries.filter((e) => !groupOf(e.key)).map((e) => e.key));
  const out = [];
  for (const e of tpl.entries) {
    const g = groupOf(e.key);
    if (g) { if (!declared.has(g)) out.push(e.raw); continue; }
    if (!repoKeys.has(e.key)) out.push(e.raw);
  }
  for (const e of repo.entries) out.push(e.raw);
  return { text: `${out.join('\n')}\n`, overrides: [...declared.values()] };
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i]] = argv[i + 1];
  if (!args['--template'] || !args['--repo'] || !args['--out']) {
    process.stderr.write('usage: roster-overlay.js --template <roster.md> --repo <repo-config.md> --out <effective.md>\n');
    process.exit(2);
  }
  let t;
  let r;
  try { t = fs.readFileSync(args['--template'], 'utf8'); } catch (e) { fail([`roster template unreadable: ${args['--template']}`]); }
  try { r = fs.readFileSync(args['--repo'], 'utf8'); } catch (e) { fail([`repo review-loop config unreadable: ${args['--repo']}`]); }
  const res = overlay(t, r);
  if (res.problems) fail([`resolve-review-loop: roster overlay refused ${args['--repo']}`, ...res.problems.map((p) => `  ${p}`)]);
  fs.writeFileSync(args['--out'], res.text);
  process.stdout.write(`${JSON.stringify(res.overrides)}\n`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { overlay, parse, groupOf, GROUPS };
