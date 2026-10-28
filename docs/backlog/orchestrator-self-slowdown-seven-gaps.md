# Orchestrator slows itself down: seven process gaps from a peer

BL-0309. Peer report from twgs-revival (peace--claude), 2026-10-26, "the orchestrator slows its own progress"; replied the same day. Efficiency class, so it jumps the queue. Guidance changes need ON/OFF eval evidence first.

1. The handoff template does not separate owner instructions from the predecessor's judgement, and resume says to run item 1 of the next steps directly (`skills/handoff/SKILL.md` lines 69-73 and 126-128). Wanted: a grading plus a premise column. Guidance, needs eval.
2. The stall fuse cannot see "plan edited, nothing pushed or merged". Wanted: a process-doc category, and a hint when the top of the next-pick queue has not moved.
3. Inside the DOA the orchestrator still asks, because only prose says not to: `open-decision --not-authorized` should be required and checked against `resolve-doa`, and autonomous mode should refuse to open a card. The DOA table should list tests, regressions and quality gates as autonomous.
4. The code loop should shrink with the previous generation's highest severity (at most Minor: dispatch one family, or depth-0 finalizes).
5. Lessons that carry an applicability scope (implanted calibration) live only in memory.
6. context-budget mode "once".
7. How to look up a seat's qualification standard (seat-status plus adopt list, `admission_status` decides) should be written into engine-onboarding.

## Status 2026-10-28

- Items 2 and 6: shipped c9366c79a (stall fuse process-doc category with mechanical `classify --append` writes; context-budget mode `once`). The next-pick `top-stale` hint was implemented in the same commit c9366c79a and currently has no caller; wiring it means editing skill guidance and needs ON/OFF eval.
- Item 4: closed 2026-10-28. The owner answered card d-f1aea07b with option A: reviews stay at four seats regardless of the previous generation's highest severity. Not implemented.
- Item 3: the mechanism part shipped 4a34aa3a0 (lane doagate). `open-decision.js open` requires `--not-authorized <boundary>[:<reason>]`; the boundary is a resolve-doa category (`read_only`, `reversible`, `external`, `irreversible`) or one of `goal-change`, `scope-expansion`, `resources-2x`, `red-line`; a missing flag or unknown boundary exits 2, old free text is refused. In an autonomous session (marker level l3-l6, shared `isAutonomousSession` in `session-mode.js`) a category boundary opens a card only when `resolve-doa --role manager --tier sonnet` says `escalate`, otherwise exit 3; the four board boundaries always open without consulting resolve-doa. If resolve-doa fails, only `irreversible` opens (with a warning) and the other categories are refused. The library path `openDecision()` is unchecked: BL-0320. The guidance part (adding tests, regressions and quality gates to the DOA table as autonomous) needs ON/OFF eval and is not done.
- Items 1, 5, 7: guidance changes, need ON/OFF eval.
