#!/usr/bin/env node
/**
 * probe-unknown.js — the unknown-escalation ladder probe
 * (plan: docs/plans/2026-09-07-unknown-escalation-ladder.md, P1).
 *
 * Turns "I'm stuck" into a measured signal and a bounded recommendation. It
 * never dispatches anything, never blocks anything (exit 0 on every
 * classification), and never writes authority — receipts are plain telemetry
 * rows in the decision ledger (ADR-0001).
 *
 * Signals (all deterministic; S6 is the only claim):
 *   S1 refuted hypotheses ≥ --refuted-threshold (default 2)   — kind:hypothesis rows
 *   S2 review loop not converging                             — --convergence <json> from check-loop-convergence.js (verdict TRIP)
 *   S3 stall fuse tripped                                     — --stall <json> from check-stall-fuse.js check
 *   S4 novelty: a --terms term with zero hits in knowledge/memory/repo, or --fast-moving (needs ≥1 term)
 *   S5 decision without consensus                             — --consensus LOW (think-tank Decision Brief)
 *   S6 self-report                                            — kind:unknown rows (claim: caps at U1 alone)
 *
 * Rungs: U0 local knowledge · U1 consult seat · U2 web research (survey /
 * issue-search) · U3 multi-perspective (think-tank / PUA) · U4 owner.
 * Chains: how U1→U2 · why U1→U2→U3 · whether U1→U3.
 *
 * Rules (plan §3, frozen rubric R10/R11/R12/R13/R16):
 *   co-signal      S4 alone or S6 alone ⇒ at most U1. U2 needs S4 + one of S1/S2/S3/S5,
 *                  or S4 + --fast-moving. U3 needs a why/whether signal (S1/S2/S3/S5).
 *   heterogeneity  U1 is skipped (skipped_rungs:[U1], reason not-heterogeneous) when
 *                  consult_resolved_from is native-fallback or consult_dispatch is off.
 *   exhaustion     a rung with used ≥ budget is never repeated; a higher rung is
 *                  recommended only when the signals make it eligible — exhaustion never
 *                  buys it. When every eligible rung is spent: recommend none,
 *                  reason budget-exhausted. Never U4 from exhaustion.
 *   U4             classify NEVER emits U4. The owner rung is reached by the caller's own
 *                  stop (stall fuse §8 / DOA boundary), which attaches the ladder receipts;
 *                  a spent budget is `none`, never an escalation (G2 R11).
 *   knob           unknown_escalation off ⇒ recommend none, reason knob-off (one knob-off
 *                  ladder row per work unit is appended so the skip is visible).
 *   rail-failed    a ladder row with reason rail-failed (written by dispatch-consult.sh
 *                  --ladder-receipt on a transport/protocol/qualification failure, or by the
 *                  caller after a failed survey/think-tank rail) consumes that rung's budget
 *                  without counting as a climb — a dead seat is retried at most budget times.
 *
 * Modes (stdout is always exactly one JSON object; diagnostics on stderr):
 *   classify --ledger <file> [--work-unit <id>] [--round <n>] [--terms a,b,c] [--fast-moving]
 *            [--convergence <json>] [--stall <json>] [--consensus LOW|MEDIUM|HIGH]
 *            [--consult-resolved-from <v>] [--consult-dispatch <v>] [--knob auto|on|off]
 *            [--budget-u1 N] [--budget-u2 N] [--budget-u3 N]
 *            [--knowledge-dir <dir>] [--memory-dir <dir>] [--repo-root <dir>]
 *            [--refuted-threshold N] [--strict]
 *     → {unknown_type, signals[], recommend, reason?, skipped_rungs[], heterogeneous_u1,
 *        eligible_max, budget:{u1,u2,u3,used:{U1,U2,U3}}, knob, terms_hits}
 *     exit 0 always; 2 on usage; with --strict, 2 when recommend ∈ {U2,U3,U4}.
 *   receipt  --ledger <file> --rung Ux --unknown-type <t> --terms a,b,c --signals S1,S3   (--signals "" ⇒ [] = judgment-only climb, visible in report.judgment_only)
 *            [--reason knob-off|budget-exhausted|not-heterogeneous|rail-failed] [--run-id <id>]
 *            [--heterogeneous true|false] [--work-unit <id>] [--round <n>]
 *     → runs decision-ledger.js append --kind ladder (one writer, existing lock),
 *       captures its stdout and prints exactly the appended row.
 *   report   --ledger <file> | --project-dir <dir>
 *     → {climbs[{rung,unknown_type,terms,signal_ids,signal_coverage,work_unit,reason?}],
 *        skips[], judgment_only, s6_only[], repeat_terms{}, learn_required[]}
 *
 * Ledger default when --ledger is omitted: $AUTOPILOT_LADDER_LEDGER, else
 * ~/.autopilot/ladder/<first 12 hex of sha256(git common dir)>.jsonl.
 * Knob / budgets / consult fields default to `resolve-review-loop.sh --field …`
 * when present (P2 adds the fields), else auto / 2,1,1 / topology.
 *
 * Node ≥ 20.10, built-ins only. Exit: 0 ok · 2 usage (or --strict).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const RUNGS = ['U0', 'U1', 'U2', 'U3', 'U4'];
const CHAINS = { how: ['U1', 'U2'], why: ['U1', 'U2', 'U3'], whether: ['U1', 'U3'] };
const DEFAULT_BUDGETS = { U1: 2, U2: 1, U3: 1 };
// Skip reasons: the first three mean the rung was never attempted; `rail-failed` means the rung was
// attempted and the rail itself failed (transport, protocol, qualification) — it CONSUMES budget so a
// dead seat cannot be recommended forever, but it is not a climb (no outside source was consumed, so
// it never triggers learn). Found by the P4 dogfood: a consult seat without credentials would otherwise
// be recommended on every round.
const SKIP_REASONS = new Set(['knob-off', 'budget-exhausted', 'not-heterogeneous', 'rail-failed']);
const STRICT_SET = new Set(['U2', 'U3', 'U4']);

function usage(message) {
  process.stderr.write(`probe-unknown: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (!['classify', 'receipt', 'report'].includes(mode)) usage('mode must be classify|receipt|report');
  const opts = { mode, fastMoving: false, strict: false };
  const flags = new Set(['--fast-moving', '--strict']);
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (flags.has(arg)) {
      if (arg === '--fast-moving') opts.fastMoving = true;
      else opts.strict = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    switch (arg) {
      case '--ledger': opts.ledger = value; break;
      case '--project-dir': opts.projectDir = value; break;
      case '--work-unit': opts.workUnit = value; break;
      case '--round': opts.round = Number(value); if (!Number.isFinite(opts.round)) usage('--round must be a number'); break;
      case '--terms': opts.terms = value.split(',').map((t) => t.trim()).filter(Boolean); break;
      case '--convergence': opts.convergence = value; break;
      case '--stall': opts.stall = value; break;
      case '--consensus': opts.consensus = value.toUpperCase(); break;
      case '--consult-resolved-from': opts.consultResolvedFrom = value; break;
      case '--consult-dispatch': opts.consultDispatch = value; break;
      case '--knob': opts.knob = value; break;
      case '--budget-u1': opts.budgetU1 = value; break;
      case '--budget-u2': opts.budgetU2 = value; break;
      case '--budget-u3': opts.budgetU3 = value; break;
      case '--knowledge-dir': opts.knowledgeDir = value; break;
      case '--memory-dir': opts.memoryDir = value; break;
      case '--repo-root': opts.repoRoot = value; break;
      case '--refuted-threshold': opts.refutedThreshold = Number(value); if (!Number.isInteger(opts.refutedThreshold) || opts.refutedThreshold < 1) usage('--refuted-threshold must be a positive integer'); break;
      case '--rung': opts.rung = value; break;
      case '--unknown-type': opts.unknownType = value; break;
      case '--signals': opts.signals = value.split(',').map((t) => t.trim()).filter(Boolean); break;
      case '--reason': opts.reason = value; break;
      case '--run-id': opts.runId = value; break;
      case '--heterogeneous': opts.heterogeneous = value; break;
      default: usage(`unknown argument: ${arg}`);
    }
    i += 1;
  }
  return opts;
}

function emit(obj) { process.stdout.write(`${JSON.stringify(obj)}\n`); }

// ── ledger helpers ───────────────────────────────────────────────────────────
function repoRootOf(opts) {
  if (opts.repoRoot) return path.resolve(opts.repoRoot);
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}

function defaultLedger(opts) {
  if (process.env.AUTOPILOT_LADDER_LEDGER) return process.env.AUTOPILOT_LADDER_LEDGER;
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRootOf(opts), encoding: 'utf8' });
  const common = r.status === 0 ? path.resolve(repoRootOf(opts), r.stdout.trim()) : repoRootOf(opts);
  const hash = crypto.createHash('sha256').update(common).digest('hex').slice(0, 12);
  return path.join(os.homedir(), '.autopilot', 'ladder', `${hash}.jsonl`);
}

function readRows(ledger) {
  if (!ledger || !fs.existsSync(ledger)) return [];
  const rows = [];
  for (const line of fs.readFileSync(ledger, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch (err) { /* malformed telemetry is skipped */ }
  }
  return rows;
}

function inWorkUnit(row, opts) {
  if (opts.workUnit === undefined) return true;
  return row.work_unit === opts.workUnit;
}

function readOptionalJson(file) {
  if (!file) return null;
  if (!fs.existsSync(file)) { process.stderr.write(`probe-unknown: ${file} not found — signal skipped\n`); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { process.stderr.write(`probe-unknown: ${file} is not JSON — signal skipped\n`); return null; }
}

// ── resolver access (soft: absent field ⇒ default) ───────────────────────────
function resolverField(field, opts) {
  const script = path.join(SCRIPT_DIR, 'resolve-review-loop.sh');
  if (!fs.existsSync(script)) return null;
  const r = spawnSync('bash', [script, '--field', field], { cwd: repoRootOf(opts), encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) return null;
  const v = (r.stdout || '').trim().split('\n').pop();
  return v === '' ? null : v;
}

function resolveKnob(opts) {
  const v = opts.knob || resolverField('unknown_escalation', opts) || 'auto';
  if (!['auto', 'on', 'off'].includes(v)) usage(`--knob must be auto|on|off (got ${v})`);
  return v;
}

function resolveBudgets(opts) {
  const out = {};
  for (const [rung, flag, field] of [['U1', 'budgetU1', 'unknown_budget_u1'], ['U2', 'budgetU2', 'unknown_budget_u2'], ['U3', 'budgetU3', 'unknown_budget_u3']]) {
    const raw = opts[flag] !== undefined ? opts[flag] : resolverField(field, opts);
    const n = raw === null || raw === undefined || raw === '' ? DEFAULT_BUDGETS[rung] : Number(raw);
    if (!Number.isInteger(n) || n < 0) usage(`budget for ${rung} must be a non-negative integer (got ${raw})`);
    out[rung] = n;
  }
  return out;
}

function resolveConsult(opts) {
  const resolvedFrom = opts.consultResolvedFrom || resolverField('consult_resolved_from', opts) || 'topology';
  const dispatch = opts.consultDispatch || resolverField('consult_dispatch', opts) || 'auto';
  return { resolvedFrom, dispatch };
}

// ── S4 term lookup ───────────────────────────────────────────────────────────
// Corpus cap: the S4 lookup reads at most `limit` files per directory tree. When the cap is hit
// a term may be a false zero-hit, so the cap is reported on stderr rather than silently applied.
function listMarkdown(dir, limit = 400) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length && out.length < limit) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (err) { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') || e.name === '.claude') stack.push(p); } else if (/\.(md|json|jsonl)$/i.test(e.name)) out.push(p);
    }
  }
  if (out.length >= limit) process.stderr.write(`probe-unknown: S4 corpus cap (${limit} files) reached under ${dir} — a zero-hit term may be a false novelty\n`);
  return out;
}

function termHits(terms, opts) {
  const root = repoRootOf(opts);
  const knowledgeDir = opts.knowledgeDir || path.join(root, '.claude', 'knowledge');
  const memoryDir = opts.memoryDir || defaultMemoryDir(root);
  const files = [...listMarkdown(knowledgeDir), ...listMarkdown(memoryDir)];
  const hits = {};
  for (const t of terms) hits[t] = { knowledge_or_memory: 0, repo: 0 };
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8').toLowerCase(); } catch (err) { continue; }
    for (const t of terms) if (text.includes(t.toLowerCase())) hits[t].knowledge_or_memory += 1;
  }
  for (const t of terms) {
    const r = spawnSync('git', ['grep', '-il', '--', t], { cwd: root, encoding: 'utf8', timeout: 15000 });
    if (r.status === 0) hits[t].repo = r.stdout.split('\n').filter(Boolean).length;
  }
  return hits;
}

function defaultMemoryDir(root) {
  // Claude Code memory dir convention: ~/.claude/projects/<slug>/memory where slug = root with '/' → '-'.
  const slug = root.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
}

// ── classify ─────────────────────────────────────────────────────────────────
function classify(opts) {
  const ledger = opts.ledger || defaultLedger(opts);
  const rows = readRows(ledger).filter((r) => r && inWorkUnit(r, opts));
  const threshold = Number.isFinite(opts.refutedThreshold) ? opts.refutedThreshold : 2;
  const signals = [];

  const refuted = rows.filter((r) => r.kind === 'hypothesis' && r.status === 'refuted');
  if (refuted.length >= threshold) signals.push({ id: 'S1', value: refuted.length, evidence: refuted.map((r) => r.hypothesis_id) });

  const conv = readOptionalJson(opts.convergence);
  if (conv && (conv.verdict === 'TRIP' || (conv.gate1_zero_execution && conv.gate1_zero_execution.tripped) || (conv.gate3_generation_cap && conv.gate3_generation_cap.tripped))) {
    signals.push({ id: 'S2', value: conv.verdict || 'TRIP', evidence: Array.isArray(conv.reasons) ? conv.reasons.slice(0, 5) : [] });
  }

  const stall = readOptionalJson(opts.stall);
  if (stall && stall.tripped === true) signals.push({ id: 'S3', value: stall.consecutive_zero_product, evidence: (stall.violations || []).map((v) => v.code).slice(0, 5) });

  let termsHits = {};
  const zeroHit = [];
  if (opts.terms && opts.terms.length) {
    termsHits = termHits(opts.terms, opts);
    for (const t of opts.terms) if (termsHits[t].knowledge_or_memory === 0 && termsHits[t].repo === 0) zeroHit.push(t);
  }
  if (zeroHit.length || opts.fastMoving) {
    signals.push({ id: 'S4', value: zeroHit.length, evidence: zeroHit, fast_moving: opts.fastMoving });
  }

  if (opts.consensus === 'LOW') signals.push({ id: 'S5', value: 'LOW', evidence: ['think-tank Decision Brief consensus LOW'] });

  const selfReports = rows.filter((r) => r.kind === 'unknown');
  if (selfReports.length) signals.push({ id: 'S6', value: selfReports.length, evidence: selfReports.map((r) => r.type) });

  const has = (id) => signals.some((s) => s.id === id);
  const hard = has('S1') || has('S2') || has('S3') || has('S5');

  // unknown type
  let unknownType = 'none';
  if (has('S5')) unknownType = 'whether';
  else if (has('S1') || has('S2') || has('S3')) unknownType = 'why';
  else if (has('S4')) unknownType = 'how';
  else if (has('S6')) unknownType = selfReports[selfReports.length - 1].type;

  // eligible max rung (co-signal rule)
  let eligibleMax = 'U0';
  if (unknownType !== 'none') {
    if (hard) eligibleMax = unknownType === 'how' ? 'U2' : 'U3';
    else if (has('S4') && opts.fastMoving) eligibleMax = 'U2';
    else eligibleMax = 'U1'; // S4-only or S6-only
  }

  const knob = resolveKnob(opts);
  const budgets = resolveBudgets(opts);
  const consult = resolveConsult(opts);
  const heterogeneousU1 = consult.dispatch !== 'off' && consult.resolvedFrom !== 'native-fallback';

  const used = { U1: 0, U2: 0, U3: 0 };
  for (const r of rows) if (r.kind === 'ladder' && (!r.reason || r.reason === 'rail-failed') && used[r.rung] !== undefined) used[r.rung] += 1;

  const out = {
    schema_version: 1,
    artifact_type: 'unknown_probe',
    ledger,
    work_unit: opts.workUnit || null,
    unknown_type: unknownType,
    signals,
    recommend: 'none',
    skipped_rungs: [],
    heterogeneous_u1: heterogeneousU1,
    eligible_max: eligibleMax,
    budget: { u1: budgets.U1, u2: budgets.U2, u3: budgets.U3, used },
    knob,
    terms_hits: termsHits,
  };

  if (knob === 'off') {
    out.reason = 'knob-off';
    recordKnobOff(ledger, rows, opts, unknownType);
    return finish(out, opts);
  }
  if (unknownType === 'none') {
    out.recommend = opts.terms && opts.terms.length ? 'U0' : 'none';
    if (out.recommend === 'U0') out.reason_detail = 'all terms have local hits — read them first';
    return finish(out, opts);
  }

  const chain = CHAINS[unknownType];
  const maxIdx = RUNGS.indexOf(eligibleMax);
  let anyEligible = false;
  for (const rung of chain) {
    if (RUNGS.indexOf(rung) > maxIdx) break;
    if (rung === 'U1' && !heterogeneousU1) {
      out.skipped_rungs.push('U1');
      continue;
    }
    anyEligible = true;
    if (used[rung] < budgets[rung]) {
      out.recommend = rung;
      if (out.skipped_rungs.length) out.reason = 'not-heterogeneous';
      return finish(out, opts);
    }
  }
  if (!anyEligible) {
    // Only U1 was eligible and it was skipped: the caller may climb the next rung only if the signals allow it.
    out.recommend = 'none';
    out.reason = 'not-heterogeneous';
    return finish(out, opts);
  }
  // Every signal-eligible rung is spent. The frozen contract (plan §3, G2 R11): exhaustion
  // is always `none` — never a higher rung, never U4. classify never emits U4 at all; the
  // owner escalation is the stall fuse / DOA boundary the foreman already has, to which it
  // attaches the ladder receipts (level-front-door.md §6).
  out.recommend = 'none';
  out.reason = 'budget-exhausted';
  return finish(out, opts);
}

function recordKnobOff(ledger, rows, opts, unknownType) {
  const already = rows.some((r) => r.kind === 'ladder' && r.reason === 'knob-off');
  if (already) return;
  const row = { rung: 'U0', unknown_type: unknownType, terms: opts.terms || [], signal_ids: [], heterogeneous: false, reason: 'knob-off' };
  if (opts.workUnit) row.work_unit = opts.workUnit;
  if (Number.isFinite(opts.round)) row.round = opts.round;
  const r = appendLadderRow(ledger, row, opts);
  if (r.error) process.stderr.write(`probe-unknown: could not record knob-off row: ${r.error}\n`);
}

function finish(out, opts) {
  emit(out);
  if (opts.strict && STRICT_SET.has(out.recommend)) process.exit(2);
  process.exit(0);
}

// ── receipt ──────────────────────────────────────────────────────────────────
function appendLadderRow(ledger, row, opts) {
  const script = path.join(SCRIPT_DIR, 'decision-ledger.js');
  const r = spawnSync(process.execPath, [script, 'append', '--ledger', ledger, '--kind', 'ladder', '--json', JSON.stringify(row)], { cwd: repoRootOf(opts), encoding: 'utf8' });
  if (r.status !== 0) return { error: (r.stderr || '').trim() || `decision-ledger exited ${r.status}` };
  try { return { row: JSON.parse((r.stdout || '').trim().split('\n').pop()) }; } catch (err) { return { error: 'decision-ledger printed no row' }; }
}

function receipt(opts) {
  const ledger = opts.ledger || defaultLedger(opts);
  if (!RUNGS.includes(opts.rung)) usage('--rung must be U0..U4');
  if (!['how', 'why', 'whether', 'none'].includes(opts.unknownType)) usage('--unknown-type must be how|why|whether|none');
  if (!opts.terms) usage('--terms is required (comma-separated; the task nouns the climb was about)');
  if (!opts.signals) usage('--signals is required (comma-separated signal ids, e.g. S1,S3)');
  if (opts.reason !== undefined && !SKIP_REASONS.has(opts.reason)) usage(`--reason must be one of ${[...SKIP_REASONS].join('|')}`);
  let heterogeneous = true;
  if (opts.heterogeneous !== undefined) {
    if (!['true', 'false'].includes(opts.heterogeneous)) usage('--heterogeneous must be true|false');
    heterogeneous = opts.heterogeneous === 'true';
  }
  const row = { rung: opts.rung, unknown_type: opts.unknownType, terms: opts.terms, signal_ids: opts.signals, heterogeneous };
  if (opts.reason) row.reason = opts.reason;
  if (opts.runId) row.dispatch_run_id = opts.runId;
  if (opts.workUnit) row.work_unit = opts.workUnit;
  if (Number.isFinite(opts.round)) row.round = opts.round;
  const r = appendLadderRow(ledger, row, opts);
  if (r.error) { process.stderr.write(`probe-unknown: receipt refused — ${r.error}\n`); process.exit(2); }
  emit(r.row);
}

// ── report ───────────────────────────────────────────────────────────────────
function findLedgers(projectDir) {
  const out = [];
  const stack = [projectDir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (err) { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  }
  return out.sort();
}

function report(opts) {
  let ledgers;
  if (opts.projectDir) ledgers = findLedgers(opts.projectDir);
  else ledgers = [opts.ledger || defaultLedger(opts)];
  const climbs = [];
  const skips = [];
  for (const ledger of ledgers) {
    for (const r of readRows(ledger)) {
      if (!r || r.kind !== 'ladder') continue;
      const entry = { ledger, rung: r.rung, unknown_type: r.unknown_type, terms: r.terms || [], signal_ids: r.signal_ids || [], signal_coverage: (r.signal_ids || []).length, work_unit: r.work_unit || null, heterogeneous: r.heterogeneous, dispatch_run_id: r.dispatch_run_id || null, ts: r.ts || null };
      if (r.reason) { entry.reason = r.reason; skips.push(entry); } else climbs.push(entry); // rail-failed rows are skips: budget spent, nothing learned
    }
  }
  const judgmentOnly = climbs.filter((c) => c.signal_coverage === 0);
  const s6Only = climbs.filter((c) => c.signal_ids.length > 0 && c.signal_ids.every((id) => id === 'S6'));
  const termCount = {};
  for (const c of climbs) for (const t of c.terms) termCount[t] = (termCount[t] || 0) + 1;
  const repeatTerms = Object.fromEntries(Object.entries(termCount).filter(([, n]) => n > 1));
  const learnRequired = climbs.filter((c) => RUNGS.indexOf(c.rung) >= 1);
  emit({
    schema_version: 1,
    artifact_type: 'unknown_probe_report',
    ledgers,
    climbs,
    skips,
    judgment_only: judgmentOnly.length,
    s6_only: s6Only,
    repeat_terms: repeatTerms,
    learn_required: learnRequired,
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'classify' && opts.fastMoving && !(opts.terms && opts.terms.length)) usage('--fast-moving needs at least one --terms term (a cue without a name is not evidence)');
  if (opts.mode === 'classify') classify(opts);
  else if (opts.mode === 'receipt') receipt(opts);
  else report(opts);
}

main();
