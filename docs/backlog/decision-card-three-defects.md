# Owner decision cards: three ways a card is lost or never opened

BL-0307. Peer report from twgs-revival PEACE, 2026-10-27 (session 5eb5d332, autopilot ab2b1d9f6, CC 2.1.310); answered the same day. Fix in progress in lane decfix; when it merges, tell PEACE.

1. `open-decision.js` `sessionRoot()` reads the marker's `expires_at` (started_at + 24 h). After a long session passes it, root is null and the card is silently written into the unbound scope file `.git/autopilot/decisions/<scope>.json`; stdout prints only the id. `workflow-snapshot` ignores `expires_at` and still reports a root, so the two disagree; `show` and `close` scan every scope and hide the error. Suggested: a live session keeps a valid root (or renews it); when a card lands unbound, warn on stderr with scope and path; snapshot and open-decision share one root rule.
2. `owner-question-guard` `findOwnerQuestion()` misses: "合入之後，推到遠端那一步要你批准。", "push 會等你批准。", "要我推到遠端嗎？". `OWNER_WAIT_PATTERNS` lacks 批准／核准／同意／授權; `ADDRESSES_OWNER` lacks "要我…嗎" and "嗎？".
3. When the stop hook triggers opening a card it should require and verify that the card landed in this session's root scope (hint `--root-run-id`, or the hook reads the decisions file to confirm).
