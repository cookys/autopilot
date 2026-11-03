# The library path openDecision() skips the --not-authorized and DOA checks

BL-0320. Follow-on of BL-0309 item 3 (mechanism shipped 4a34aa3a0).

`scripts/open-decision.js` exports `openDecision()`. Its callers are `hooks/ask-decision.js`, `hooks/subagent-budget.js` and `scripts/lib/qualification-confirm.js`; they open cards on the owner's behalf and none passes through the `--not-authorized` and DOA checks that only the command-line `open` runs (`checkNotAuthorized`, `isAutonomous`). In an autonomous session (marker level l3-l6) these paths can still open a card whose boundary is inside the DOA.

The depth-0 ruling on doagate deliberately did not add the check here. Open work: inventory which boundary each caller's cards belong to, then decide whether the library path should carry the same check.

Side note: `docs/plans/evidence/2026-10-04-mods-p1c/briefs-p1w/w-row-evalprep.md` line 8 still shows the old free-text `--not-authorized "<why ...>"` form. It is frozen historical evidence; the depth-0 ruling is to leave it unchanged.
