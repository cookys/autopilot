# Final-panel resume after a seat transport failure re-runs every seat, discarding valid verdicts

Source: PEER-REPORTED by cuda/chatgpt-tunnel via fleet, 2026-10-03 (message 01M3Z05AC452K6EHJ0A4F3MZMP); verified by reading code at 2b312c35, not by running it.

- **Trigger**: next touch of the final-panel resume path, or the next peer/operator run blocked by a single failing QC seat.
- **Context**: `classifyFullDiffReviewFault` (`src/engine/campaign-composition.js:240-264`) makes `final_panel_seat_(no_verdict|transport_failed|parser_failed)` gate_transient → `retry_full_diff_review`; `--resume` re-runs the review without the implementer (`:2136-2140`). But `runPanel` (`src/engine/autopilot-engine.js:5465+`) re-dispatches every seat, and panel reuse (`stationPanelReuse`, `campaign-composition.js:2924-2964`) applies only when the whole previous panel was reviewed. Seats that already returned a valid bound verdict for the same packet are re-run (cost, and a fresh chance of a transport failure). Desired: per-seat reuse of verdicts bound to the identical packet digest/roster seat, re-dispatching only failed seats, within a per-seat attempt budget. Must stay ADR-0001-clean (re-derive from the stored seat artifact bound to the same packet; no attestation).
- **Effort**: M
