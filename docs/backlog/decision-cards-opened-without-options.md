# Decision cards get opened with no options the owner can press

BL-0321. Reported by hangar--claude (cookys/openclaw, operator agreed to the send) over fleet on 2026-10-28; replied the same day.

Symptom: after a context compaction the hangar session opened two cards with only `--question` (cards d-fcd5771e and d-782fe50a). The mod panel showed no option to press. The operator asked why the session again did not open the panel with options; this was not the first time.

Root cause 1: the open-card hint at `src/hooks/handlers/session-start.js:66` (mirrored at `platforms/codex/plugin/src/hooks/handlers/session-start.js:66`) reads `open --question ... --not-authorized <boundary>` and never mentions `--option`, `--recommendation` or `--why`. After compaction that single line is all the context that remains.

Root cause 2: `scripts/open-decision.js` rejects exactly one `--option` (line 261) but accepts zero, storing `options: null` (line 262; header comment at line 31 documents this).

Peer requests:
- (a) Write the full usage in the hint and say at least two options are expected; keep `hooks/tests/session-start-token-discipline.test.sh` (its `OPEN=` line 11 pins the hint text) in step.
- (b) With no `--option`, report an error or warning; a plain one-sentence question uses an explicit flag (for example `--free-text`) to be let through.

Status: fix is in lane dcopt (dispatched, in parallel). This entry only records the report.
