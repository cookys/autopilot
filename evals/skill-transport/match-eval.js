#!/usr/bin/env node
'use strict';
// match-eval.js — defect-matched predicate evaluator for the skill-transport A/B.
// A review counts as `caught` for a case ONLY when BOTH hold (KR1, plan §2.5):
//   1. verdict is a real non-ship verdict (FIX-THEN-SHIP), NOT SHIP-AS-IS / no_verdict / null
//   2. the findings text satisfies the case's defect-matched predicate (<case>.match.json)
// This makes `caught` a diagnosis test, never any-fail — flagging something unrelated does
// not count. Node built-ins only (dep-minimal). No LLM in the count path.
//
// Predicate schema (<case>.match.json):
//   { "case": "<id>", "class": "critical|major", "defect_summary": "...",
//     "any_of": [ {"all_of": ["t1","t2"]}, {"regex": "pat"}, ... ] }
// Match rule: any_of is satisfied if AT LEAST ONE group matches. A group matches when
//   - all_of : EVERY listed term is a case-insensitive substring of the findings, OR
//   - regex  : the case-insensitive pattern matches the findings.
//
// CLI:
//   match-eval.js eval   --case <id> --verdict <V> --findings-file <f> [--match-dir <d>]
//        -> prints "caught" | "missed"; exit 0. Unknown verdict / empty findings -> missed.
//   match-eval.js literals --case <id> [--match-dir <d>]
//        -> prints each all_of literal term on its own line (for the disjointness gate).
//   match-eval.js check-caught --case <id> --verdict <V> --findings-file <f> [--match-dir <d>]
//        -> exit 0 if caught, exit 1 if missed (script-gate form).

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { a[t.slice(2)] = argv[i + 1]; i++; }
    else a._.push(t);
  }
  return a;
}

function defaultMatchDir() {
  return path.join(__dirname, 'match');
}

function loadPredicate(caseId, matchDir) {
  const p = path.join(matchDir, `${caseId}.match.json`);
  const raw = fs.readFileSync(p, 'utf8');
  const pred = JSON.parse(raw);
  if (!Array.isArray(pred.any_of) || pred.any_of.length === 0) {
    throw new Error(`predicate ${caseId} has no any_of groups`);
  }
  return pred;
}

// A non-ship verdict string. Fail-closed: anything not a recognized FIX verdict is NOT caught.
function isNonShipVerdict(v) {
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  if (s === '' ) return false;
  if (s === 'SHIP-AS-IS' || s === 'SHIP') return false;
  if (s === 'NO_VERDICT' || s === 'NULL' || s === 'NONE') return false;
  // FIX-THEN-SHIP (and any explicit fix/block verdict) is the only "flagged" state.
  return s.includes('FIX') || s.includes('BLOCK') || s.includes('REJECT');
}

function groupMatches(group, findingsLower, findingsRaw) {
  if (Array.isArray(group.all_of)) {
    return group.all_of.every((t) => findingsLower.includes(String(t).toLowerCase()));
  }
  if (typeof group.regex === 'string') {
    let re;
    try { re = new RegExp(group.regex, 'i'); } catch (e) { return false; }
    return re.test(findingsRaw);
  }
  return false;
}

function predicateSatisfied(pred, findings) {
  const raw = String(findings || '');
  const lower = raw.toLowerCase();
  if (lower.trim() === '' || lower.trim() === 'none') return false;
  return pred.any_of.some((g) => groupMatches(g, lower, raw));
}

function collectLiterals(pred) {
  const out = [];
  for (const g of pred.any_of) {
    if (Array.isArray(g.all_of)) for (const t of g.all_of) out.push(String(t));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const matchDir = args['match-dir'] || defaultMatchDir();
  const caseId = args.case;
  if (!cmd || !caseId) {
    process.stderr.write('usage: match-eval.js <eval|literals|check-caught> --case <id> [...]\n');
    process.exit(2);
  }
  const pred = loadPredicate(caseId, matchDir);

  if (cmd === 'literals') {
    for (const t of collectLiterals(pred)) process.stdout.write(t + '\n');
    process.exit(0);
  }

  const verdict = args.verdict;
  let findings = '';
  if (args['findings-file']) {
    try { findings = fs.readFileSync(args['findings-file'], 'utf8'); } catch (e) { findings = ''; }
  } else if (typeof args.findings === 'string') {
    findings = args.findings;
  }

  const caught = isNonShipVerdict(verdict) && predicateSatisfied(pred, findings);

  if (cmd === 'eval') {
    process.stdout.write(caught ? 'caught\n' : 'missed\n');
    process.exit(0);
  }
  if (cmd === 'check-caught') {
    process.exit(caught ? 0 : 1);
  }
  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}

if (require.main === module) main();
module.exports = { isNonShipVerdict, predicateSatisfied, collectLiterals, loadPredicate };
