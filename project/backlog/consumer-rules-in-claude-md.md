# Consumer-facing rules in autopilot CLAUDE.md never reach consumers (BL-0388)

Source: the BL-0383 live injection test, relayed by the PM (2026-11-04).

## Problem
- Evidence: a `--plugin-dir` test in BL-0383. The consumer session loaded only its own `CLAUDE.md`; no plugin `CLAUDE.md` was loaded, neither the root one nor any subdirectory one.
- So any rule in autopilot's root or subdirectory `CLAUDE.md` that was meant for consumer sessions has never reached them.

## Work
- Scan the root and subdirectory `CLAUDE.md` files for rules addressed to consumers.
- For each one, make sure something consumers actually load carries it: a skill, a hook or a reference.

## Notes
- Trigger: PM dispatch; not for now. Effort M.
