# Orchestrator slows itself down: seven process gaps from a peer

BL-0309. Peer report from twgs-revival (peace--claude), 2026-10-26, "the orchestrator slows its own progress"; replied the same day. Efficiency class, so it jumps the queue. Guidance changes need ON/OFF eval evidence first.

1. The handoff template does not separate owner instructions from the predecessor's judgement, and resume says to run item 1 of the next steps directly (`skills/handoff/SKILL.md` lines 69-73 and 126-128). Wanted: a grading plus a premise column. Guidance, needs eval.
2. The stall fuse cannot see "plan edited, nothing pushed or merged". Wanted: a process-doc category, and a hint when the top of the next-pick queue has not moved.
3. Inside the DOA the orchestrator still asks, because only prose says not to: `open-decision --not-authorized` should be required and checked against `resolve-doa`, and autonomous mode should refuse to open a card. The DOA table should list tests, regressions and quality gates as autonomous.
4. The code loop should shrink with the previous generation's highest severity (at most Minor: dispatch one family, or depth-0 finalizes).
5. Lessons that carry an applicability scope (implanted calibration) live only in memory.
6. context-budget mode "once".
7. How to look up a seat's qualification standard (seat-status plus adopt list, `admission_status` decides) should be written into engine-onboarding.

## Status 2026-10-27

- Items 2 and 6: shipped c9366c79a (stall fuse process-doc category with mechanical `classify --append` writes; context-budget mode `once`). The next-pick `top-stale` hint was implemented in the same commit c9366c79a and currently has no caller; wiring it means editing skill guidance and needs ON/OFF eval.
- Item 4: waits on owner decision card d-f1aea07b. It conflicts with the rule "reviews always use four seats".
- Item 3: the mechanism part (`open-decision` requires `--not-authorized` and checks it against `resolve-doa`; autonomous mode refuses to open a card) is dispatched to lane doagate, in progress. The guidance part (adding tests, regressions and quality gates to the DOA table as autonomous) needs ON/OFF eval and is not done.
- Items 1, 5, 7: guidance changes, need ON/OFF eval.
