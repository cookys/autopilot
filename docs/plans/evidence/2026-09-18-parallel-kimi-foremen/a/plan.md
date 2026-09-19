# Plan A — parser tolerates a BEGIN-closed frame
1. RED: new dispatch-review.test.sh cases (BEGIN-closed frame accepted; BEGIN + trailing content still refused; end-marker receipt key).
2. GREEN: awk locator `pending_close`; result JSON `frame_closed_by`.
3. Sync codex mirror; verify list; one commit on the hands branch.
Acceptance: the 2026-09-18 GLM envelope shape parses to `reviewed`; a planted second frame is still `no_verdict`.
