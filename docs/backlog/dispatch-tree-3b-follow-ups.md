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
  - tmux or another long-lived shell started from inside a rail child keeps `AUTOPILOT_PARENT_SESSION_ID`;
    a session later started in that shell would record the old rail session as its parent (plan D6 residual).
    Not reproduced.
  - kimi: the review's stub made `dispatch-author-kimi.js` exit 2, so the child env was checked only by
    reading code (the child node process inherits the rail shell after `child_session_apply_env`).
  - Mutations were run on the author rail only; review and explore `child_session_pin` /
    `child_session_apply_env` have no per-rail negative control.
