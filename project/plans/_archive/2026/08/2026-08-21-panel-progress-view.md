# Plan-review panel progress view (BACKLOG M, triggers fired 2026-08-20 ×2)

> 狀態: ✅ Shipped in v2.34.30 — merged as f9aecfca

## 0. Context
v2.34.21 made SEATS observable (dispatch-author run manifests). The PANEL layer is still
blind: seats run sequentially, the driver prints nothing until the last seat returns — a
3-seat panel at 20m/seat is indistinguishable from a hang for an hour. Measured 2026-08-18
(0 bytes for ~20 min) and three more times 2026-08-20 (dispatch-1 / G1 retry / G2, each
babysat by hand-reading /tmp manifests).

## 1. Problem
An operator (human or depth-0 session) must be able to answer "which seat is in flight,
which are done, how much deadline remains" with one command, mid-run.

## 2. OKR
- KR1: during a live panel run, `node scripts/dispatch-status.js --panels` shows the panel
  with per-seat status (pending/in_flight/done/failed), attempt, elapsed, deadline remaining.
- KR2: red-green: the panel test FAILS against the pre-change dispatch-plan-review (no
  manifest emitted) and PASSES after — verified by stash-run.
- KR3: full suite green; preflight 8/8; PATCH v2.34.31.

## 3. Design
- **Panel manifest**: `dispatch-plan-review.js` writes
  `/tmp/autopilot-dispatch-runs/panel-<sessionKey8>-g<N>-<pid>.manifest.json` (same discovery
  root as author manifests), atomic tmp+rename, updated at every transition:
  run start → each seat attempt start → each attempt settle → run end (verdict).
  Schema v1: {schema_version, artifact_type:"plan_review_panel_manifest", ticket,
  logical_plan_id, generation, started_at, deadline_at, updated_at, ended_at, verdict,
  seats:[{seat_id, target_id, status, attempt, started_at, ended_at, transport_status,
  author_run_id?}]}. Emission is best-effort (try/catch; a manifest write failure never
  fails the review).
- **Renderer**: `dispatch-status.js --panels` lists panel manifests (newest first, default
  cap 10), deriving in_flight elapsed + deadline-remaining from timestamps; `--panel <file|
  prefix>` prints one panel's seat table. Read-only.
- **Concurrency decision (this plan DECIDES, does not implement)**: stay SEQUENTIAL.
  Rationale: seats share endpoint env + provider quota; the 7200s wall cap and
  remainingSeconds accounting assume serial spend; concurrent seats would need per-seat
  quota isolation and a new wall-accounting model — separate design if ever needed.
  The BACKLOG row's "decision" clause is satisfied by this recorded ruling.

## 4. Phases
- P1: panel manifest emission in dispatch-plan-review.js (+ unit of atomic writer).
- P2: dispatch-status.js `--panels` / `--panel` rendering.
- P3: tests (seam-driven lifecycle red-green + renderer fixture) + docs (scripts-inventory
  rows + CLAUDE.md group list for the new lib) + CHANGELOG/INDEX/bump.

## 5. Verification contract (驗證合約)
Command: `bash hooks/tests/plan-review-panel-status.test.sh` — red on pre-change code
(stash verification), green after. Plus full `hooks/tests/run.sh`.

## 6. Out of scope
Concurrent seat execution; panel-level notifications/wakeups; changes to seat semantics,
timeouts, or state machine; retro-fitting old runs.
