# Frozen review rubric — Cross-Harness Transcript Retro

Only the following criteria may admit a blocking plan finding.

- R1: Claude and Codex use separate adapters feeding a normalized event contract.
- R2: Output reports scanned roots, adapters, candidate/included/excluded/error counts and reasons.
- R3: Recent supported candidates with zero inclusion emit an explicit warning.
- R4: Attribution uses canonical repo/worktree identity and bounded time, with confidence/reasons.
- R5: Metrics cover structured provider/review/worktree/status events and label heuristics separately.
- R6: Missing evidence renders unknown, not numeric zero.
- R7: Processing is local, read-only, bounded, redacted, and persists no prompt/reasoning body.
- R8: Existing Claude output remains compatible.
- R9: Tests include Codex date-tree discovery, malformed input, unrelated repo, warning, and privacy sentinel.

Next-slice readiness means the implementer need not invent adapter, attribution, privacy, evidence,
compatibility, or metric semantics.
