# dispatch-tree 3b follow-ups (BL-0174, BL-0175, BL-0176)

Left open by the 3b review (three rounds, merged as `92002f7f`, 2026-10-15). Plan:
[`docs/plans/2026-10-13-dispatch-tree.md`](../plans/2026-10-13-dispatch-tree.md) §4 and §6.

- **BL-0174 — `ensure-child` refuses silently.** `session-mode.js ensure-child` (the SessionStart hook 3a
  installs on author/review claude children) exits without a stderr line when it declines to write the child
  marker (no child id, child id equals the parent, no marker dir). A missing child marker therefore leaves no
  trace in the rail log. Fix: one stderr line per refusal reason, with the reason code; exit code unchanged
  so the hook never blocks the child.
- **BL-0175 — managed dev-flow admission still reads the old session id.** `validateManagedDevFlowAdmission`
  (`scripts/session-mode.js` about :453-505, compare at :489) uses `markerPath()` and `getSessionId()`, not
  `resolveMarkerWriteTarget`. Under a launcher that carries only `CLAUDE_SESSION_ID`, or only a cwd, a nested
  l5/l6 child's admission compares against the wrong marker and fails closed. Out of 3b's scope (the 3b spec
  is the write target); the reviewer flagged it in rounds 1 and 3.
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
  - kimi: the review's stub made `dispatch-author-kimi.js` exit 2, so the child env was checked only by
    reading code. Needs a credentialed environment (owner).
