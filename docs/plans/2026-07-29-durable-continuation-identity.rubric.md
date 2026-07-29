# Frozen rubric — Durable Continuation Identity

- R1: All active-campaign readers consume one rotation-aware oldest-to-live view.
- R2: Last-write semantics and idempotency are deterministic across rotated segments.
- R3: Rotation cannot hide active state or lease from a later heartbeat/transition.
- R4: Compaction recovery binds root, phase, accepted commit, and next action before dispatch.
- R5: The `16/34` replay resumes at `16/34` with duplicate dispatch equal to zero.
- R6: Truly absent IDs and incomplete/tampered checkpoints fail closed.
- R7: Existing non-rotated and non-compacted campaign behavior remains green.
