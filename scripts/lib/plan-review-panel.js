'use strict';
// Panel-level progress manifest for dispatch-plan-review. Seats have been individually
// observable since v2.34.21 (one dispatch-author run manifest per seat), but the PANEL
// had no artifact: seats run sequentially and the driver prints nothing until the last
// seat returns, so a 3-seat run at 20m/seat is indistinguishable from a hang (measured
// 2026-08-18, then three more times 2026-08-20). This module writes ONE json manifest
// into the shared dispatch-runs dir at every transition; `dispatch-status.js --panels`
// renders it. EVERY write is best-effort (try/catch): observability must never fail
// the review it observes.
const fs = require('fs');
const path = require('path');

function runsDir() {
  if (process.env.AUTOPILOT_DISPATCH_RUNS_DIR) return process.env.AUTOPILOT_DISPATCH_RUNS_DIR;
  return path.join(process.env.TMPDIR || '/tmp', 'autopilot-dispatch-runs');
}

function createPanelManifest({
  ticket, logicalPlanId, generation, sessionKey, startedAt, deadlineAt, seats, now,
}) {
  // Same opt-out every other emitter into this dir honors (dispatch-author.sh,
  // dispatch-hetero.sh, dispatch-review.sh; references/hetero-dispatch.md).
  if (process.env.AUTOPILOT_DISPATCH_MANIFEST === '0') {
    return { file: null, seatStart() {}, seatSettle() {}, end() {} };
  }
  const clock = typeof now === 'function' ? now : () => Date.now();
  const stamp = () => new Date(clock()).toISOString();
  const file = path.join(
    runsDir(),
    `panel-${String(sessionKey).slice(0, 8)}-g${generation}-${process.pid}.manifest.json`,
  );
  const body = {
    schema_version: 1,
    artifact_type: 'plan_review_panel_manifest',
    ticket,
    logical_plan_id: logicalPlanId,
    generation,
    session_key: sessionKey,
    pid: process.pid,
    started_at: startedAt,
    deadline_at: deadlineAt,
    updated_at: startedAt,
    ended_at: null,
    verdict: null,
    seats: seats.map((seat) => ({
      seat_id: seat.id,
      target_id: seat.id,
      status: 'pending',
      attempt: 0,
      started_at: null,
      ended_at: null,
      transport_status: null,
    })),
  };
  const flush = () => {
    try {
      fs.mkdirSync(runsDir(), { recursive: true });
      body.updated_at = stamp();
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
      fs.renameSync(tmp, file);
    } catch { /* best-effort observability */ }
  };
  const seatOf = (id) => body.seats.find((seat) => seat.seat_id === id);
  flush();
  return {
    file,
    seatStart(seatId, targetId, attempt) {
      const seat = seatOf(seatId);
      if (!seat) return;
      seat.status = 'in_flight';
      seat.target_id = targetId;
      seat.attempt = attempt;
      if (!seat.started_at) seat.started_at = stamp();
      seat.transport_status = null;
      flush();
    },
    seatSettle(seatId, { status, transportStatus }) {
      const seat = seatOf(seatId);
      if (!seat) return;
      seat.status = status;
      seat.transport_status = transportStatus || null;
      seat.ended_at = stamp();
      flush();
    },
    end(verdict) {
      body.verdict = verdict || null;
      body.ended_at = stamp();
      flush();
    },
  };
}

module.exports = { createPanelManifest, runsDir };
