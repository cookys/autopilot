# dispatch-tree 3b follow-ups (BL-0176)

Left open by the 3b review (three rounds, merged as `92002f7f`, 2026-10-15). Plan:
[`docs/plans/2026-10-13-dispatch-tree.md`](../plans/2026-10-13-dispatch-tree.md) §4 and §6.

- **BL-0176 — live gaps the 3b review could not close.**
  - Per-rail negative controls: done (merge of `lane/bl0176`, 2026-10-15). Review and explore pin removals were
    already red; review `child_session_apply_env` was not, and `dispatch-runner-session-id-scrub` case 2b now
    covers it.
  - tmux or another long-lived shell started from inside a rail child: **reproduced** (2026-10-15, stub probe).
    The shell keeps `AUTOPILOT_PARENT_SESSION_ID=P`; a brand-new top-level session started there gets a marker
    `{"session_id":"<new>","parent_session_id":"P"}` from `ensure-child`/SessionStart, because
    `ensurePlainMarker` reads P from the environment and only refuses id == P. Only the provenance field is wrong:
    `set` without a distinct `CLAUDE_CODE_SESSION_ID` fails closed (exit 3), and `write-target --rail` returns the
    new session's own id, so no other session's marker is written. Options, not yet chosen (plan change, so plan
    review first):
    (1) the rail mints the child id and passes it next to P (for example `AUTOPILOT_CHILD_SESSION_ID`);
    `ensure-child` records a parent only when the payload id equals it. Cost: rail, hook and tests change;
    `child_session_mint` exists only on the claude branch, so non-claude runners carry no child id.
    (2) a liveness/time-window check on P's marker: heuristic, can misjudge, against ADR-0001. Preferred: (1).
    **Chosen and shipped: (1)**, as plan step 3d (plan review frozen after two generations, receipts in
    `docs/plans/evidence/2026-10-13-dispatch-tree/plan-review-3d/`), merged 2026-10-15. Still open: the live
    §7 row l run and the codex row d2 re-run.
  - kimi: the review's stub made `dispatch-author-kimi.js` exit 2, so the child env was checked only by
    reading code. Needs a credentialed environment (owner).
