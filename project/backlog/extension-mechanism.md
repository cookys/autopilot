# autopilot extension mechanism, codeforge as the first extension (BL-0356)

Source: codeforge, owner decision on codeforge card d-0e2e6e0d "start from alpha.8" (2026-11-01). Codeforge-side records: codeforge main b12c8d0, BACKLOG B31 and the agent-coupling ADR.

## Why
- A normal user should not have to install autopilot, codeforge and other packages one by one.
- The band has one mod chain per host at a time; who draws the shared tabs is undecided.

## Consensus
- Define an extension contract. Codeforge's Rust code is not moved into the autopilot repo.
- An extension declares what it provides in a manifest: hooks, band tabs, status fragments, config keys, and which binary and version it needs.
- Autopilot is the host and owns install and enable. Hooks are registered through autopilot's opt-in list, no longer written into global settings.
- Shipping to Mnemos is codeforge's critical path. Autopilot only guarantees: the call is made, the exit code is recorded, a failure is visible. Retry and re-send stay with codeforge.
- Every piece must still degrade to working alone without autopilot (Solo Smith positioning).
- The first contract piece already exists: the band tab label Box format. With maxRows=1 it returns the outer row Box holding one `<Box key="speed|trend|sep|pet">` per item, each wrapping one Text. Text carries no colour; autopilot's PALETTE decides colour.
- The fleet tab (card d-d99e2d99) may later use the same path.

## Sequencing
- Trigger is after 3.0.0-alpha.7 is released: during relayout P1-P5 the mount point is not fixed because paths still change.
- Write a plan first. Codeforge takes part in the plan review; focus: mount point, manifest format, binary requirement, responsibility split on ship failure.
- Implementation starts only after the plan review passes. Must finish before 3.0.0 final.
