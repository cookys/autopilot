# Durable Continuation Identity

## Deliverable contract

Implement only the rotation-aware active campaign view and compaction-safe continuation identity
selected by the bounded backlog review.

Required behavior:

1. every campaign/state/lease/journal/status/resume reader uses one deterministic oldest-to-live
   rotated-ledger view with last-write semantics;
2. rotation and append cannot expose a heartbeat without its active state and lease;
3. compaction rehydrates authoritative root run, phase cursor, accepted commit, and next action
   before dispatch;
4. a stable continuation identity attaches/resumes an existing active or terminal matching run
   rather than dispatching again.

The authoritative enforcement point is the engine/dispatcher pre-dispatch boundary. A generic
rehydration command may be invoked by a platform lifecycle hook, but this deliverable does not
claim or require activation of hooks in the Codex skills-only package. Existing uncommitted
Codex hook-probe work remains user-owned and outside this change.

Acceptance: force rotation during an active campaign and replay the recorded `16/34` compaction
incident. The campaign remains found, resumes at `16/34`, and records zero duplicate dispatch.
Absent IDs remain `not_found`; incomplete checkpoints fail closed before dispatch.

Out of scope: orphan adoption, worktree leases, scheduler work, version bump, release, and unrelated
backlog entries. Converting the warning-only Codex hook probe into production enforcement is also
out of scope; correctness must not depend on that probe.
