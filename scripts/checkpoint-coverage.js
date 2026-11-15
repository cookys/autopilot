#!/usr/bin/env node
'use strict';

/**
 * checkpoint-coverage.js — how many things a post-compaction checkpoint failed to name (orphans). A measurement: exit 0 always.
 *
 *   node scripts/checkpoint-coverage.js --session <id> [--now <ms>] [--cwd <dir>] [--json]
 *
 * Reads the record SessionStart(compact) wrote when it injected the checkpoint (checkpoint-coverage/1 in the live dir:
 * {schema, session, compacted_at_ms, ids}; scripts/lib/compaction-handoff.js recordCoverage) and counts items the
 * injected text never named:
 *   a  fleet tasks (`fleet tasks --mine --json`) created within 60 min AFTER compacted_at. A task row carries no
 *      creation time, so it is read from the ULID task_id (its first 10 characters are the creation time in ms).
 *   b  BACKLOG rows created in that window: `unsupported`. BACKLOG `Since` is a date (no time of day) and
 *      project-record.js has no list command, so no machine-readable creation time exists; nothing is invented.
 *   c  open decision cards (`open-decision.js list --json`, `opened_at`) opened within 60 min AFTER compacted_at.
 *   d  PM go-ledger lines (newest *-go-ledger.md in $AUTOPILOT_PM_LEDGER_DIR, default ~/projects/pm/log) dated within
 *      60 min BEFORE compacted_at that carry a decision (`PM go`, `OPERATOR`, `PM:`) and name no id that is a known
 *      fleet task (`fleet tasks --all --json`); the record's ids do not count here (the ledger tail is itself injected). `unsupported` when the ledger directory is absent.
 * For a, c an id in the record's `ids` is covered, never an orphan. Fleet binary: $AUTOPILOT_FLEET_BIN.
 * Output: {orphans:{a,b,c,d}, total, items:[{kind,id,note}]}; an unreadable source reads `unsupported`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const handoff = require('./lib/compaction-handoff.js');

const WINDOW_MS = 60 * 60 * 1000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/g;

function ulidMs(id) {
  let t = 0;
  for (const c of String(id).slice(0, 10)) { const i = CROCKFORD.indexOf(c); if (i < 0) return null; t = t * 32 + i; }
  return t;
}

function fleetJson(args) {
  const r = spawnSync(handoff.fleetBinResolved(), args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 << 20 });
  if (r.error || r.status !== 0) return null;
  try { const v = JSON.parse(r.stdout); return Array.isArray(v) ? v : null; } catch { return null; }
}

function decisions(cwd) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'open-decision.js'), 'list', '--json', '--cwd', cwd], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 << 20 });
  if (r.error) return null;
  if (r.status === 1) return []; // no open decision
  if (r.status !== 0) return null;
  try { const v = JSON.parse(r.stdout); return Array.isArray(v.decisions) ? v.decisions : null; } catch { return null; }
}

function ledgerLines() {
  const dir = process.env.AUTOPILOT_PM_LEDGER_DIR || path.join(os.homedir(), 'projects', 'pm', 'log');
  try {
    let newest = null;
    for (const n of fs.readdirSync(dir)) {
      if (!/-go-ledger\.md$/.test(n)) continue;
      const m = fs.statSync(path.join(dir, n)).mtimeMs;
      if (!newest || m > newest.m) newest = { n, m };
    }
    return newest ? fs.readFileSync(path.join(dir, newest.n), 'utf8').split('\n') : [];
  } catch { return null; }
}

function measure({ session, now, cwd }) {
  const empty = { orphans: { a: 'unsupported', b: 'unsupported', c: 'unsupported', d: 'unsupported' }, total: 0, items: [] };
  let rec;
  try { rec = JSON.parse(fs.readFileSync(handoff.coverageRecordFile(session), 'utf8')); } catch { return { ...empty, error: 'no coverage record for this session' }; }
  if (!rec || rec.schema !== 'checkpoint-coverage/1' || !Number.isFinite(rec.compacted_at_ms)) return { ...empty, error: 'unreadable coverage record' };
  const known = new Set(Array.isArray(rec.ids) ? rec.ids : []);
  const t0 = rec.compacted_at_ms;
  const upper = Math.min(t0 + WINDOW_MS, Number.isFinite(now) ? now : Infinity); // nothing created after --now exists yet
  const items = [];
  const orphans = { a: 'unsupported', b: 'unsupported', c: 'unsupported', d: 'unsupported' };

  const mine = fleetJson(['tasks', '--mine', '--json']);
  if (mine) {
    orphans.a = 0;
    for (const r of mine) {
      const ms = ulidMs(r.task_id);
      if (ms !== null && ms >= t0 && ms <= upper && !known.has(r.task_id)) { orphans.a += 1; items.push({ kind: 'a', id: r.task_id, note: String(r.title || '').slice(0, 80) }); }
    }
  }
  // b: no machine-readable creation time with minute resolution (see header).
  const cards = decisions(cwd);
  if (cards) {
    orphans.c = 0;
    for (const c of cards) {
      const ms = Date.parse(c.opened_at);
      if (Number.isFinite(ms) && ms >= t0 && ms <= upper && !known.has(c.id)) { orphans.c += 1; items.push({ kind: 'c', id: c.id, note: String(c.title || c.question || '').slice(0, 80) }); }
    }
  }
  const lines = ledgerLines();
  const all = lines ? fleetJson(['tasks', '--all', '--json']) : null;
  if (lines && all) {
    const tasks = new Set(all.map((r) => r.task_id));
    orphans.d = 0;
    for (const l of lines) {
      const m = /^- (\d{4}-\d\d-\d\dT\d\d:\d\dZ)\s/.exec(l);
      if (!m || !/\b(PM go|OPERATOR)\b|\bPM:/.test(l)) continue;
      const ms = Date.parse(m[1]);
      if (!(ms <= t0 && ms >= t0 - WINDOW_MS)) continue;
      const ids = l.match(ULID_RE) || [];
      // the ledger tail is itself injected, so its ULIDs are always in the record: only a real fleet task covers a line
      if (ids.some((i) => tasks.has(i))) continue;
      orphans.d += 1; items.push({ kind: 'd', id: m[1], note: l.slice(0, 120) });
    }
  }
  const total = Object.values(orphans).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0);
  return { orphans, total, items };
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') a.json = true;
    else if (/^--(session|now|cwd)$/.test(argv[i]) && i + 1 < argv.length) a[argv[i].slice(2)] = argv[++i];
  }
  const res = measure({ session: a.session || '', now: a.now !== undefined ? Number(a.now) : Date.now(), cwd: a.cwd || process.cwd() });
  if (a.json) process.stdout.write(`${JSON.stringify(res)}\n`);
  else {
    process.stdout.write(`orphans: a=${res.orphans.a} b=${res.orphans.b} c=${res.orphans.c} d=${res.orphans.d} total=${res.total}${res.error ? ` (${res.error})` : ''}\n`);
    for (const it of res.items) process.stdout.write(`  ${it.kind} ${it.id} ${it.note}\n`);
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { measure, ulidMs };
