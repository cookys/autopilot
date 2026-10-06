#!/usr/bin/env node
'use strict';

/**
 * decision-ledger.js — the brain's proxy-decision ledger + round-end report
 * (autonomous-brain-integration P3; plan: docs/plans/_archive/2026/08/2026-08-17-autonomous-brain-integration.md).
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
 *   hypothesis {hypothesis_id, text, status: open|refuted|confirmed, evidence_refs[], round?, work_unit?}
 *   unknown    {type: how|why|whether, rationale, round?, work_unit?}   (agent self-report — a claim, S6)
 *   ladder     {rung: U0..U4 | the terminal rung, unknown_type, terms[], signal_ids[], heterogeneous, reason?, dispatch_run_id?, round?, work_unit?}
 *             The v3 ladder (see probe-unknown.js header) adds, only when present: rail (dispatch-discuss|think-tank|debugger-pua)
 *             + families[] on U3 rows; question + criterion + result (pass|fail|inconclusive) on rung-four rows.
 * The last three are unknown-escalation-ladder telemetry (plan
 * docs/plans/_archive/2026/09/2026-09-07-unknown-escalation-ladder.md): exempt from decision_id /
 * rationale like `note`, each validated against its own required-field set. A
 * `ladder` row is written once per rung dispatch by probe-unknown.js receipt or
 * dispatch-consult.sh --ladder-receipt; a `reason` of knob-off | budget-exhausted |
 * not-heterogeneous marks a skip, not a climb; `rail-failed` marks an attempted rung
 * whose rail died (budget consumed, nothing learned).
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
 * Default ledger (mods P1W W1h): when --ledger is omitted every mode uses
 * <git-common-dir>/autopilot/ledger/decisions.jsonl of the cwd's repo — shared by every
 * worktree of the repo, never inside the work tree. Not in a git repo and no --ledger → exit 2.
 * `append` stamps repo_identity (`git-common-dir:<realpath>`, same value as
 * src/status/task-runtime.js repoIdentity) and root_run_id (AUTOPILOT_ROOT_RUN_ID, else the
 * session-mode marker's root_run_id, else null — never invented); a caller-supplied value wins.
 * `append --dedupe` skips (exit 0, prints the existing row) when a row with the same kind and
 * decision_id is already in the ledger, so a replayed engine step cannot double-record.
 *
 * Exit: 0 ok · 1 refused/invalid · 2 usage. Node >= 20.10 built-ins + lib/jsonl-store.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { appendRow, ensureDir, withWriteLock } = require('./lib/jsonl-store');

const KINDS = new Set(['decision', 'dispatch', 'pick', 'refreeze', 'veto', 'note', 'hypothesis', 'unknown', 'ladder']);
const TELEMETRY_KINDS = new Set(['note', 'hypothesis', 'unknown', 'ladder']);
const RUNGS = ['U0', 'U1', 'U2', 'U3', 'U4'];
const UNKNOWN_TYPES = ['how', 'why', 'whether'];
const OWNER_RUNG = 'U5'; // recorded by a caller that stops; the probe never recommends it
const SKIP_REASONS = new Set(['knob-off', 'budget-exhausted', 'not-heterogeneous', 'rail-failed']);
const U3_RAILS = new Set(['dispatch-discuss', 'think-tank', 'debugger-pua']);
const U4_RESULTS = new Set(['pass', 'fail', 'inconclusive']);
const LADDER_KINDS = new Set(['hypothesis', 'unknown', 'ladder']);

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

// Per-kind required fields for the ladder telemetry kinds. Returns an error
// message or null. Extra fields pass through untouched (same as every kind).
function validateLadderRow(kind, row) {
  if (kind === 'hypothesis') {
    if (!isNonEmptyString(row.hypothesis_id)) return 'hypothesis rows require hypothesis_id';
    if (!isNonEmptyString(row.text)) return 'hypothesis rows require text';
    if (!['open', 'refuted', 'confirmed'].includes(row.status)) return 'hypothesis.status must be open|refuted|confirmed';
    if (row.evidence_refs !== undefined && !isStringArray(row.evidence_refs)) return 'hypothesis.evidence_refs must be a string array';
    return null;
  }
  if (kind === 'unknown') {
    if (!UNKNOWN_TYPES.includes(row.type)) return 'unknown.type must be how|why|whether';
    if (!isNonEmptyString(row.rationale)) return 'unknown rows require a rationale (it is a self-reported claim)';
    return null;
  }
  if (kind === 'ladder') {
    if (!RUNGS.includes(row.rung) && row.rung !== OWNER_RUNG) return 'ladder.rung must be U0..U5';
    if (![...UNKNOWN_TYPES, 'none'].includes(row.unknown_type)) return 'ladder.unknown_type must be how|why|whether|none';
    if (!isStringArray(row.terms)) return 'ladder.terms must be a string array';
    if (!isStringArray(row.signal_ids)) return 'ladder.signal_ids must be a string array';
    if (typeof row.heterogeneous !== 'boolean') return 'ladder.heterogeneous must be boolean';
    if (row.reason !== undefined && !SKIP_REASONS.has(row.reason)) return `ladder.reason must be one of ${[...SKIP_REASONS].join('|')}`;
    // v3 fields (additive; validated only when present).
    if (row.rail !== undefined && !U3_RAILS.has(row.rail)) return `ladder.rail must be one of ${[...U3_RAILS].join('|')}`;
    if (row.families !== undefined && !isStringArray(row.families)) return 'ladder.families must be a string array';
    if (row.result !== undefined) {
      if (!U4_RESULTS.has(row.result)) return `ladder.result must be one of ${[...U4_RESULTS].join('|')}`;
      if (!isNonEmptyString(row.question) || !isNonEmptyString(row.criterion)) return 'ladder.result requires question and criterion';
    }
    // Rung four is the experiment rung: a new row needs a result unless it is a skip row. No alias for the
    // old meaning; historical rows are read, never re-validated (validation runs on append only).
    if (row.rung === 'U4' && row.result === undefined && row.reason === undefined) return 'a ladder row at rung four needs question, criterion and result, or a skip reason';
    return null;
  }
  return null;
}

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
    if (arg === '--dedupe' && mode === 'append') { opts.dedupe = true; continue; }
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
  if (!opts.ledger) {
    opts.ledger = defaultLedgerPath();
    if (!opts.ledger) usage('--ledger is required (not inside a git repository, so there is no default ledger)');
  }
  return opts;
}

function gitCommonDir() {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) return null;
  try {
    return fs.realpathSync(r.stdout.trim());
  } catch (err) {
    return null;
  }
}

function defaultLedgerPath() {
  const common = gitCommonDir();
  return common ? path.join(common, 'autopilot', 'ledger', 'decisions.jsonl') : null;
}

// Attribution stamp. null = underivable; never a guess.
function stampFields() {
  const common = gitCommonDir();
  let root = process.env.AUTOPILOT_ROOT_RUN_ID || null;
  if (!root) {
    try {
      const marker = require('./session-mode').readSessionRecord(); // l3-l6 or plain: only root_run_id is read
      if (marker && typeof marker.root_run_id === 'string' && marker.root_run_id) root = marker.root_run_id;
    } catch (err) {
      root = null;
    }
  }
  return { repo_identity: common ? `git-common-dir:${common}` : null, root_run_id: root };
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
  if (LADDER_KINDS.has(opts.kind)) {
    const err = validateLadderRow(opts.kind, row);
    if (err) usage(err);
  }
  if (opts.kind !== 'veto' && !TELEMETRY_KINDS.has(opts.kind)) {
    if (typeof row.decision_id !== 'string' || !row.decision_id.trim()) {
      usage('decision rows require a decision_id');
    }
    if (typeof row.rationale !== 'string' || !row.rationale.trim()) {
      process.stderr.write('decision-ledger: refused — a decision without a rationale is not reportable (KR3)\n');
      process.exit(1);
    }
  }
  const full = { schema_version: 1, ts: new Date().toISOString(), kind: opts.kind, ...stampFields(), ...row };
  ensureDir(path.dirname(path.resolve(opts.ledger)));
  // The dedupe read happens INSIDE the write lock so two concurrent appends of one decision_id
  // cannot both pass the check.
  let duplicate = null;
  withWriteLock(
    { storeDir: path.dirname(path.resolve(opts.ledger)), lockFile: `${path.resolve(opts.ledger)}.lock`, name: 'decision-ledger' },
    () => {
      if (opts.dedupe && isNonEmptyString(row.decision_id)) {
        duplicate = readRows(opts.ledger).find((r) => r && r.kind === opts.kind && r.decision_id === row.decision_id) || null;
        if (duplicate) return;
      }
      appendRow(opts.ledger, full);
    },
  );
  if (duplicate) {
    process.stderr.write(`decision-ledger: duplicate decision_id '${row.decision_id}' skipped (--dedupe)\n`);
    process.stdout.write(`${JSON.stringify(duplicate)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(full)}\n`);
}

function veto(opts) {
  if (!opts.id) usage('veto requires --id <decision_id>');
  const rows = readRows(opts.ledger);
  const target = rows.find((r) => r && r.decision_id === opts.id && r.kind !== 'veto');
  if (!target) {
    process.stderr.write(`decision-ledger: no decision '${opts.id}' in the ledger — nothing to veto\n`);
    process.stderr.write('decision-ledger: list vetoable ids with query --ledger <ledger> [--kind decision|dispatch|refreeze] [--json] or report --ledger <ledger>\n');
    process.exit(1);
  }
  const full = {
    schema_version: 1,
    ts: new Date().toISOString(),
    kind: 'veto',
    ...stampFields(),
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
  lines.push('## Ladder (unknown-escalation climbs this round)');
  const ladderRows = inRound.filter((r) => r.kind === 'ladder');
  const refuted = inRound.filter((r) => r.kind === 'hypothesis' && r.status === 'refuted').length;
  const climbs = ladderRows.filter((r) => !r.reason);
  const skips = ladderRows.filter((r) => r.reason);
  const used = {};
  for (const c of ladderRows) if (!c.reason || c.reason === 'rail-failed') used[c.rung] = (used[c.rung] || 0) + 1;
  lines.push(`- refuted hypotheses: ${refuted}`);
  lines.push(`- climbs used per rung: ${RUNGS.slice(1, 4).map((r) => `${r}=${used[r] || 0}`).join(' ')}`);
  if (ladderRows.length === 0) lines.push('- (no ladder rows this round)');
  for (const c of climbs) lines.push(`- ${c.rung} ${c.unknown_type} [${(c.signal_ids || []).join(',')}] terms=${(c.terms || []).join(',')}${c.heterogeneous === false ? ' (not heterogeneous)' : ''}${c.dispatch_run_id ? ` run=${c.dispatch_run_id}` : ''}`);
  for (const k of skips) lines.push(`- skip ${k.rung} reason=${k.reason} terms=${(k.terms || []).join(',')}`);
  const s6Only = climbs.filter((c) => Array.isArray(c.signal_ids) && c.signal_ids.length > 0 && c.signal_ids.every((id) => id === 'S6'));
  lines.push(`- S6-only climbs (self-reported unknown, no mechanical co-signal): ${s6Only.length === 0 ? 'none' : s6Only.map((c) => `${c.rung} terms=${(c.terms || []).join(',')}`).join('; ')}`);
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
