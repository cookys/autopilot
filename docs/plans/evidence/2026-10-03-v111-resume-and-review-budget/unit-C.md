# Unit C — final-panel resume reuses valid seat verdicts
Worktree `wt-C`, branch `hands/w111/C`, base = default BASE_SHA. (Unit A changes `src/campaign/cli.js` resume admission in parallel; do not touch that file. Depth-0 reconciles at landing.)
Sidecar: `docs/backlog/final-panel-resume-reruns-all-seats.md` — read it fully.

Defect: after a `final_panel_seat_(no_verdict|transport_failed|parser_failed)` gate_transient fault, `--resume` re-runs the review, but `runPanel` (`src/engine/autopilot-engine.js`) re-dispatches every seat; panel reuse (`stationPanelReuse` in `src/engine/campaign-composition.js`) only applies when the whole previous panel was reviewed. Seats that already returned a valid bound verdict for the same packet are re-run.

Do:
1. RED first: a fixture where a 3-seat panel had 2 valid verdicts and 1 transport failure; on resume, assert only the failed seat is dispatched and the 2 verdicts are reused. Follow existing `stationPanelReuse` / final-panel tests (`git grep -l stationPanelReuse -- '*.test.js' 'hooks/tests/*.sh'`).
2. Fix: per-seat reuse of verdicts bound to the identical packet digest AND the same roster seat; re-dispatch only failed seats. Verbatim constraint from the sidecar: "Must stay ADR-0001-clean (re-derive from the stored seat artifact bound to the same packet; no attestation)." — reuse means reading the stored seat artifact and re-checking its binding (packet digest, seat id, parseable verdict), never trusting a "reviewed" flag or a summary field.
3. A per-seat attempt budget as a named constant, with a test that a seat over budget is not re-dispatched and the panel ends in a named terminal reason.
4. Negative controls: a changed packet digest (diff changed) → every seat re-runs; a stored artifact whose seat id does not match the roster → not reused; a stored artifact that fails to parse → re-dispatched.
5. Report any place the engine and the campaign CLI disagree about the phase after the transient fault (unit A owns admission; you own what happens once resumed).
Commit message: `fix(engine): final-panel resume re-dispatches only failed seats, reusing verdicts re-derived from artifacts bound to the same packet`
