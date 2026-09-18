# Evidence — mission `blind-review-panel-station-2026-09-18` (v2.36.68; blind review redesign cut 2-C, deliverable 1: the panel as the review station)

- Plan: `../../2026-09-18-blind-review-panel-station.md` (base `9a0dac5b` = v2.36.67; frozen after G2).
  `base-suites-9a0dac5b.txt`: the thirteen §4.1 commands at base, detached checkout.
- Plan hetero loop (GLM-5.2 architecture + claude-fable-5-1 skeptic, MiniMax-M3 fallback): G1 `g1-*` (GLM STOP, 1
  blocker folded — hardlinks are not isolation; claude seat → MiniMax fallback READY); G2 `g2-*` terminal at the cap
  (GLM READY, claude CONDITIONAL, 7 folded — station budgeted like the terminal panel, legacy snapshot = single,
  newline-safe batched hashing, seat-qualified colliding ids, separate build/hash counts, evidence outside the
  campaign, red-<suite>.txt per case). Receipts rc 0. Growth 1.17×.
- **Two lineages from one plan.** The graph checker maps each source plan id to exactly one node, and one plan file
  is one id, so the plan's two deliverables ship as two sequential lineages sealing the same plan bytes:
  `scratch/freeze-c2c.js` with `NODE=station` (this graph, `panel-review-station`, digest `ed90f54a…`) and, after the
  station merge, `NODE=packet` (`blind-review-shared-packet-2026-09-18`, node `shared-packet`). Each graph claims all
  eight rubric ids — a coverage rule of the checker, not the node's acceptance (`acceptance_ids` are per node).
- Campaign attempt 1 (`grant.json`, `prepared.json`, `impl-brief.md`, `scratch/dispatch.sh`; the sealed contract carried
  `final_panel_reserve_seconds: 900` — the v2.36.67 projection measured live): hand cursor-grok-4.6-low ran ~85 min
  and committed `316c1d4b` (26 files ⊆ §2.5, +972/−67); the rail's acceptance then failed on command #10
  (`mission-runtime-v2.test.sh`, exit 1) and the terminal journal refused (`MUTATION_FAILURE_EVIDENCE_REQUIRED`,
  the open BACKLOG row — campaign stuck IMPLEMENTING with a live lease, unresumable;
  `impl-run1-acceptance-failed-session-env.json`). **Cause: depth-0 exported `AUTOPILOT_SESSION_ID` in the dispatch
  environment** (unnecessary — intake matches the marker through `CLAUDE_CODE_SESSION_ID`); that suite goes 50/53
  red under the variable on develop too (its engine spawns read the live marker of that session), while the
  candidate is green without it. Not a candidate defect; BACKLOG row filed (suites must pin their session id; the
  acceptance runner should scrub `AUTOPILOT_*` session vars). Degraded per doc to l3; candidate = the retained
  worktree's `316c1d4b`.
- Depth-0 at `316c1d4b`: scope = §2.5 (26 of 27); `review.js`/`review-packet.js`/`review-fanout.js`/
  `dispatch-review.sh`/`cleanroom-launch.sh`/`resolve-dispatch.sh` byte-identical; ten codex mirrors byte-identical;
  13/13 green on a detached scratch checkout without the session var (`head-suites-316c1d4b.txt`).
- Second-family reviews of `ae7ea5ce..316c1d4b` (113 KB, no path filter): claude-fable-5-1 FIX-THEN-SHIP (3 🟠 1 🟡 4 🔵,
  `review-claude-r2.json`); GLM-5.2 FIX-THEN-SHIP (4 🟠 2 🔵) — the parser refused the envelope (`duplicate derived
  BEGIN marker`, `review-glm-r2-no-verdict.json`) but the verdict block in `review-glm-r2-raw.log` is complete and was
  adopted from raw. Adjudication → repair r2 `ac57dc8d` by a sonnet hand (`scratch/repair-brief-r2.md`): ✅ 🟠
  terminal-receipt-drift (verdict aggregation + new keys leaked into the terminal panel — gated to the station;
  terminal byte-identical to base, checked against a base capture); ✅ 🟠 single-gate-identity (`station` and the
  extra `lastReview` keys only in panel mode); ✅ 🟠 reuse-requires-two-seats (`>= 1`); ✅ 🟠 station-reuse-packet-null
  (reuse needs a canonical `packet_hash`; RED fixture); ✅ 🟡 dropped-2b-assert (restored); ✅ 🟠 below-quorum-test-weak
  (concrete reason pinned — the fixture produces `final_panel_seat_transport_failed` + durable wait); ✅ 🟠
  station-id-qualify-third-seat (per-id digest list; three-seat RED fixture); ✅ 🔵 doc whitespace. ❌ 🟠
  station-panel-journal-generation: refuted — `reviewPayload` carries `repair_generation` (`campaign-composition.js:1825`).
  Deferred 🔵: prepared single-seat review computed then discarded in panel mode (shared-packet deliverable); terminal
  reuse not journaled as `joint_review` (a resume after `final_panel` fans out — allowed by §1.1.2); unused
  `qcPanelSnapshotIdentityBody` export; runPanel resolves the live station via the roster when computing drift.
  Hand deviation recorded honestly: the routing-suite gate-digest pin (B) is not observable (journal stores
  `input_digest` only) — B is verified by code diff + parity; the engine-suite base-comparison case was dropped for a
  pre-existing `gitWorktreeRemove` mock gap, the routing `station_single_control` covers it.
- Delta review (claude-fable-5-1) `review-claude-r3.json` on `316c1d4b..ac57dc8d`: SHIP-AS-IS, 2 🔵. 13/13 green at
  `ac57dc8d` (`head-suites-ac57dc8d.txt`).
- Plan §5 live proof (four seats, one `full_diff_review` panel row, `final_panel_gate_reused`, one `packet_hash`):
  **NOT produced** — the rail stopped at acceptance before any review station ran. Same three unmeasured items as
  2-B carry to the `shared-packet` campaign (next lineage), now with the fourth seat pinned.
- Merge `21ecc030`; `integration-record.json`, `pin-anchors-scan.json`, `reap-*.json`, `residue-receipt.json` (zero
  residue) = closeout; marker retired against the integration receipt.
