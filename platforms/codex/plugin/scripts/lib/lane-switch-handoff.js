'use strict';
/**
 * lane-switch-handoff.js — P2 step 2 (plan project/plans/2026-11-10-profile-switch.md).
 *
 * requestHandoff(opts, deps) asks the lane, over `fleet send`, to run autopilot:handoff.
 * The message text names the order id. It then waits until BOTH are true: the handoff
 * file at opts.handoffPath is newer than the request (mtimeMs, stat only — the file is
 * never read), and `fleet peers --json` shows exactly one member for the seat whose
 * activity is idle. Bound by opts.timeoutMs (default 15 min) via deps.now / deps.sleep.
 *
 * The path is an option. autopilot:handoff writes it (skills/handoff/SKILL.md): the
 * active project's `<projects_dir>/<project>/HANDOFF.md`, or, with no project, the path
 * `resolve-repo-placement.js handoff --route manual` prints. This module does not invent one.
 *
 * Returns {ok:true, handoff_path, waited_ms} or {ok:false, reason:'timeout'|'send_failed'}.
 * Journals handoff-send and handoff-wait through switch-journal.js. No credential file
 * is opened; account identity is not computed here. Node >= 20.10, built-ins only.
 *
 * opts: { order, lane, seat, handoffPath, timeoutMs?, pollMs?, base?, from?, to?, fleetBin? }
 * deps: { run(cmd, args, options) -> {status, stdout, stderr, error?}, now() -> epoch ms,
 *         sleep(ms), fs? }  — fs defaults to node:fs; tests pass a stub.
 */
const path = require('path');
const { appendJournal, checkRow } = require('./switch-journal');
const { defaultBase } = require('./lane-manifest');

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;
const LANE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ORDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/;
const SEAT_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;

function handoffMessage(order) {
  return `order ${order}: run autopilot:handoff`;
}

function assertOpts(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('handoff_opts_invalid');
  if (typeof opts.order !== 'string' || !ORDER_RE.test(opts.order)) throw new Error('handoff_order_invalid');
  if (typeof opts.lane !== 'string' || !LANE_RE.test(opts.lane)) throw new Error('handoff_lane_invalid');
  if (typeof opts.seat !== 'string' || !SEAT_RE.test(opts.seat)) throw new Error('handoff_seat_invalid');
  if (typeof opts.handoffPath !== 'string' || !path.isAbsolute(opts.handoffPath)) throw new Error('handoff_path_invalid');
  if (opts.from !== undefined && (typeof opts.from !== 'string' || !LANE_RE.test(opts.from))) throw new Error('handoff_from_invalid');
  if (opts.to !== undefined && (typeof opts.to !== 'string' || !LANE_RE.test(opts.to))) throw new Error('handoff_to_invalid');
}

function fileNewer(fs, file, sinceMs) {
  let st;
  try { st = fs.statSync(file); } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw e;
  }
  return typeof st.mtimeMs === 'number' && st.mtimeMs > sinceMs;
}

function memberMatches(member, seat) {
  if (!member || typeof member.member !== 'string') return false;
  if (member.member === seat) return true;
  if (typeof member.courier === 'string' && `${member.courier}/${member.member}` === seat) return true;
  if (typeof member.namespace === 'string' && typeof member.courier === 'string'
    && `${member.namespace}/${member.courier}/${member.member}` === seat) return true;
  return false;
}

function laneIdle(parsed, seat) {
  const members = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.members) ? parsed.members : null);
  if (!members) return false;
  const hits = members.filter((m) => memberMatches(m, seat));
  return hits.length === 1 && hits[0].activity === 'idle';
}

function iso(ms) { return new Date(ms).toISOString(); }

function journal(base, opts, step, outcome, nowIso, detail) {
  const row = { order: opts.order, lane: opts.lane, step, outcome };
  if (opts.from !== undefined) row.from = opts.from;
  if (opts.to !== undefined) row.to = opts.to;
  if (detail !== undefined) row.detail = detail;
  appendJournal(base, row, nowIso);
}

function peersIdle(deps, bin, seat) {
  let r;
  try { r = deps.run(bin, ['peers', '--json'], { encoding: 'utf8' }); } catch { return false; }
  if (!r || r.status !== 0 || r.error) return false;
  try { return laneIdle(JSON.parse(String(r.stdout || '')), seat); } catch { return false; }
}

async function requestHandoff(opts, deps) {
  assertOpts(opts);
  if (!deps || typeof deps.run !== 'function' || typeof deps.now !== 'function' || typeof deps.sleep !== 'function') {
    throw new Error('handoff_deps_invalid');
  }
  const timeoutMs = opts.timeoutMs == null ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const pollMs = opts.pollMs == null ? DEFAULT_POLL_MS : opts.pollMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('handoff_timeout_invalid');
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error('handoff_poll_invalid');
  const fs = deps.fs || require('fs');
  const bin = opts.fleetBin || process.env.AUTOPILOT_FLEET_BIN || 'fleet';
  const base = opts.base || defaultBase();
  const started = deps.now();
  const requestedAt = started;
  // Refuse a row the journal would reject before any send.
  const probe = { ts: iso(started), order: opts.order, lane: opts.lane, step: 'handoff-send', outcome: 'sent' };
  if (opts.from !== undefined) probe.from = opts.from;
  if (opts.to !== undefined) probe.to = opts.to;
  checkRow(probe);

  let send;
  try { send = deps.run(bin, ['send', opts.seat, handoffMessage(opts.order)], { encoding: 'utf8' }); } catch { send = { status: 1 }; }
  const sentOk = !!(send && send.status === 0 && !send.error);
  const failDetail = `status_${send && send.status != null ? send.status : 'error'}`;
  journal(base, opts, 'handoff-send', sentOk ? 'sent' : 'send_failed', iso(deps.now()), sentOk ? undefined : failDetail);
  if (!sentOk) return { ok: false, reason: 'send_failed' };

  while (deps.now() - started <= timeoutMs) {
    const fresh = fileNewer(fs, opts.handoffPath, requestedAt);
    const idle = peersIdle(deps, bin, opts.seat);
    if (fresh && idle) {
      const waited = deps.now() - started;
      journal(base, opts, 'handoff-wait', 'ok', iso(deps.now()));
      return { ok: true, handoff_path: opts.handoffPath, waited_ms: waited };
    }
    const remain = timeoutMs - (deps.now() - started);
    if (remain <= 0) break;
    await deps.sleep(Math.min(pollMs, remain));
  }
  journal(base, opts, 'handoff-wait', 'timeout', iso(deps.now()));
  return { ok: false, reason: 'timeout' };
}

module.exports = { requestHandoff, DEFAULT_TIMEOUT_MS, DEFAULT_POLL_MS };
