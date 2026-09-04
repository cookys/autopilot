# D2 hetero review — attempt 1 (aborted: driver parser defect)

First real run of `scripts/hetero-review-loop.js collect` over the D2 diff (`1e5c2841..8a7523f7`, branch
`review/D2`, seats gpt-5.6-sol/max@codex, GLM-5.2/high@cc-shim:glm, MiniMax-M3/high@cc-shim:minimax).

- Attempt 0 (default seats): the driver read `qc_panel_runners`/`qc_panel_efforts` keys the resolver never
  emits, produced seats with empty runners, and every seat returned precondition_failed. Fixed by cut
  `cut/D2-fix1` (reads `qc_panel_seats`, refuses an empty runner before dispatch).
- Attempt 1 (explicit seats): all three seats `reviewed`, all three `FIX-THEN-SHIP`, but the driver's
  finding parser extracted **zero** findings from non-empty findings text (sol's own finding
  "emoji-finding-loss" names the regex defect), so `findings.json` is empty and `finalize` cannot be run
  honestly. Generation left `pending`; seat artifacts kept here as evidence (diff.txt dropped, 150 KB);
  the repairs (parser, fail-closed on unparseable output, receipt re-derivation, immutability, strict
  validation, trusted dispatcher, scaffold exclusive create) are deliverable **D2-repair**. The review is
  re-run from generation 1 over the full range after D2-repair integrates.

Depth-0 adjudication of the 14 MUST-FIX findings: all accepted (sol 9, GLM 4, MiniMax 1); the 7
CUT/FOLLOW-UP findings are in `docs/BACKLOG.md` (2026-09-04 rows).
