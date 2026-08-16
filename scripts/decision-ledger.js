#!/usr/bin/env node
'use strict';

/**
 * decision-ledger.js — the brain's proxy-decision ledger + round-end report
 * (autonomous-brain-integration P3; plan: docs/plans/2026-08-17-autonomous-brain-integration.md).
 *
 * Kills sol failure shape F12 (polling death-spiral): every autonomous decision
 * lands here with a rationale BEFORE the round ends, and the round-end report
 * renders from the ledger so the operator never has to poll. The veto channel is
 * the operator's asynchronous authority: `veto <decision_id>` refuses every later
 * round that builds on that decision (enforced by check-blueprint-conformance.js
 * preflight, which reads this file's veto rows).
 *
 * PLAIN TELEMETRY, NOT TRUST MACHINERY (ADR-0001): append-only JSONL, no chains,
 * no signatures, nothing verifies the ledger itself. Independent detection of
 * UNLOGGED decisions lives in check-blueprint-conformance.js audit, which
 * cross-references dispatch manifests / run-ledger / git — sources this file
 * cannot influence.
 *
 * Row shapes (kind → extra fields):
 *   decision  {decision_id, round, class, rationale, reversibility, refs[]}
 *   dispatch  {decision_id, round, run_id, rationale}
 *   pick      {decision_id, round, row_title, pick_record:{backlog_digest,
 *              preference_digest, readiness_snapshot}, rationale}
 *   refreeze  {decision_id, round, old_digest, new_digest, reason}
 *   veto      {target_decision_id, reason}          (operator-authored)
 *   note      {round, text}                          (non-decision telemetry)
 * All rows carry {schema_version:1, ts, kind}.
 *
 * Usage:
 *   node scripts/decision-ledger.js append --ledger <file> --kind <k> --json '<row-json>'
 *   node scripts/decision-ledger.js veto   --ledger <file> --id <decision_id> [--reason <text>]
 *   node scripts/decision-ledger.js query  --ledger <file> [--kind <k>] [--round <n>] [--json]
 *   node scripts/decision-ledger.js report --ledger <file> [--round <n>] [--stall <file>]
 *                                          [--critic <file>]
 *     Renders the round-end report (markdown): proxy decisions with veto handles,
 *     auto-picks, ask-first queue (rows with class=ask-first), experience-critic
 *     findings (--critic JSON), stall status (--stall JSON from check-stall-fuse).
 *
 * Exit: 0 ok · 1 refused/invalid · 2 usage. Node >= 20.10 built-ins + lib/jsonl-store.
 */

const fs = require('fs');
const path = require('path');
const { appendRow, ensureDir, withWriteLock } = require('./lib/jsonl-store');

const KINDS = new Set(['decision', 'dispatch', 'pick', 'refreeze', 'veto', 'note']);

function usage(message) {
  process.stderr.write(`decision-ledger: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (!['append', 'veto', 'query', 'report'].includes(mode)) {
    usage('mode must be append|veto|query|report');
  }
  const opts = { mode, json: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json' && mode === 'query') { opts.json = true; continue; }
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    if (arg === '--ledger') opts.ledger = value;
    else if (arg === '--kind') opts.kind = value;
    else if (arg === '--json') opts.rowJson = value;
    else if (arg === '--id') opts.id = value;
    else if (arg === '--reason') opts.reason = value;
    else if (arg === '--round') opts.round = Number(value);
    else if (arg === '--stall') opts.stall = value;
    else if (arg === '--critic') opts.critic = value;
    else usage(`unknown argument: ${arg}`);
    i += 1;
  }
  if (!opts.ledger) usage('--ledger is required');
  return opts;
}

function readRows(ledger) {
  if (!fs.existsSync(ledger)) return [];
  const rows = [];
  for (const line of fs.readFileSync(ledger, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      // Malformed telemetry is skipped on read; it never becomes authority.
    }
  }
  return rows;
}

function append(opts) {
  if (!KINDS.has(opts.kind)) usage(`--kind must be one of ${[...KINDS].join('|')}`);
  let row;
  try {
    row = JSON.parse(opts.rowJson || '');
  } catch (err) {
    usage('--json must be a JSON object');
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) usage('--json must be a JSON object');
  if (opts.kind !== 'veto' && opts.kind !== 'note') {
    if (typeof row.decision_id !== 'string' || !row.decision_id.trim()) {
      usage('decision rows require a decision_id');
    }
    if (typeof row.rationale !== 'string' || !row.rationale.trim()) {
      process.stderr.write('decision-ledger: refused — a decision without a rationale is not reportable (KR3)\n');
      process.exit(1);
    }
  }
  const full = { schema_version: 1, ts: new Date().toISOString(), kind: opts.kind, ...row };
  ensureDir(path.dirname(path.resolve(opts.ledger)));
  withWriteLock(
    { storeDir: path.dirname(path.resolve(opts.ledger)), lockFile: `${path.resolve(opts.ledger)}.lock`, name: 'decision-ledger' },
    () => appendRow(opts.ledger, full),
  );
  process.stdout.write(`${JSON.stringify(full)}\n`);
}

function veto(opts) {
  if (!opts.id) usage('veto requires --id <decision_id>');
  const rows = readRows(opts.ledger);
  const target = rows.find((r) => r && r.decision_id === opts.id && r.kind !== 'veto');
  if (!target) {
    process.stderr.write(`decision-ledger: no decision '${opts.id}' in the ledger — nothing to veto\n`);
    process.exit(1);
  }
  const full = {
    schema_version: 1,
    ts: new Date().toISOString(),
    kind: 'veto',
    target_decision_id: opts.id,
    reason: opts.reason || 'operator veto',
  };
  withWriteLock(
    { storeDir: path.dirname(path.resolve(opts.ledger)), lockFile: `${path.resolve(opts.ledger)}.lock`, name: 'decision-ledger' },
    () => appendRow(opts.ledger, full),
  );
  process.stdout.write(`${JSON.stringify(full)}\n`);
}

function query(opts) {
  let rows = readRows(opts.ledger);
  if (opts.kind) rows = rows.filter((r) => r.kind === opts.kind);
  if (Number.isFinite(opts.round)) rows = rows.filter((r) => r.round === opts.round);
  process.stdout.write(opts.json
    ? `${JSON.stringify(rows)}\n`
    : rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

function readOptionalJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function report(opts) {
  const rows = readRows(opts.ledger);
  const inRound = Number.isFinite(opts.round)
    ? rows.filter((r) => r.round === opts.round || r.kind === 'veto')
    : rows;
  const vetoed = new Set(rows.filter((r) => r.kind === 'veto').map((r) => r.target_decision_id));
  const decisions = inRound.filter((r) => ['decision', 'dispatch', 'refreeze'].includes(r.kind));
  const picks = inRound.filter((r) => r.kind === 'pick');
  const askFirst = inRound.filter((r) => r.kind === 'decision' && r.class === 'ask-first');
  const stall = readOptionalJson(opts.stall);
  const critic = readOptionalJson(opts.critic);

  const lines = [];
  lines.push(`# Round-end report${Number.isFinite(opts.round) ? ` — round ${opts.round}` : ''}`);
  lines.push('');
  lines.push('## 代決(你不在期間我們幫你拍的板 — 每條可否決)');
  if (decisions.length === 0) lines.push('- (none)');
  for (const d of decisions) {
    lines.push(`- [${d.decision_id}]${vetoed.has(d.decision_id) ? ' **VETOED**' : ''} (${d.kind}${d.reversibility ? `, ${d.reversibility}` : ''}) ${d.rationale}`);
    lines.push(`  veto: \`decision-ledger.js veto --ledger <ledger> --id ${d.decision_id}\``);
  }
  lines.push('');
  lines.push('## Auto-picks');
  if (picks.length === 0) lines.push('- (none)');
  for (const p of picks) lines.push(`- [${p.decision_id}] ${p.row_title || '(untitled)'} — ${p.rationale}`);
  lines.push('');
  lines.push('## 待你拍板(ask-first queue — 絕不代決)');
  if (askFirst.length === 0) lines.push('- (empty)');
  for (const a of askFirst) lines.push(`- [${a.decision_id}] ${a.rationale}`);
  lines.push('');
  lines.push('## Stall status');
  lines.push(stall
    ? `- ${stall.tripped ? `**TRIPPED** after ${stall.consecutive_zero_product} zero-product bursts — halted` : `healthy (${stall.consecutive_zero_product || 0}/${stall.threshold || 3} zero-product bursts)`}`
    : '- (no stall data this round)');
  lines.push('');
  lines.push('## Experience-critic findings (queued to BACKLOG, never blocking)');
  if (critic && Array.isArray(critic.findings) && critic.findings.length > 0) {
    for (const f of critic.findings) lines.push(`- [${f.id || 'finding'}] ${f.summary || ''}`);
    if (Array.isArray(critic.human_only) && critic.human_only.length > 0) {
      lines.push('- 需要你的手(machine cannot judge): ' + critic.human_only.join('; '));
    }
  } else {
    lines.push('- (none this round)');
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'append') append(opts);
  else if (opts.mode === 'veto') veto(opts);
  else if (opts.mode === 'query') query(opts);
  else report(opts);
}

main();
