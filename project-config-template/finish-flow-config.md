# finish-flow — Project Config
# Place this file at: .claude/finish-flow-config.md
#
# finish-flow is a size-aware closing sequence forcing function. It TaskCreates
# discrete sub-tasks at workflow close so nothing gets silently compressed or
# skipped. This config file supplies project-specific reinforcements that apply
# whether finish-flow is invoked via dev-flow or standalone (context continuation).
#
# If this file does not exist, finish-flow falls back to generic behavior with
# no project-specific hints. That's fine for simple projects. Create this file
# only when you have project conventions that differ from defaults.

## Project-specific reinforcement
# Optional: reference your dev-flow-config.md's L-5 / H-9 section so the rules
# are reachable even if finish-flow is invoked standalone without going through
# dev-flow first (e.g., context continuation jumping straight to closing).
#
# Example:
# See .claude/dev-flow-config.md → "L-5 / H-9 Closing Forcing Function"
# section for the full project rules.

## Size-specific tooling
# Override the defaults for each sub-task where project conventions differ.
#
# Common overrides:
# - Quality gate command during L-5.2 / H-9.2 (e.g., project-specific pipeline script)
# - Merge target branch for L-5.3 (e.g., `develop` vs `main`)
# - Merge target branch + flags for H-9.3 (e.g., `main` with `--no-ff`)
# - Archive procedure during L-5.5 (where to move project dir, how to update INDEX)

## Per-phase quality pipeline
# If your project runs quality-pipeline at every Phase advance (not only at L-5),
# state it here so finish-flow understands L-5.2 is the FINAL review, not the only
# one. Gaps from skipped per-phase runs should be surfaced in the CEO Final Report.

## Known pitfalls
# Document project-specific historical incidents that finish-flow should avoid.
# Examples:
# - "Do not archive before merge — rename conflicts in merge commit"
# - "Merge to develop is within CEO DOA; do not pause for user approval"
# - "autopilot:learn is evaluated (not auto-skipped) at L-5.6; MANDATORY at H-9.4"

## Feature flags (optional)
# - enforce_fix: true   # Require finish-flow invocation for Fix workflow too
# - enforce_s: true     # Require finish-flow invocation for S workflow too
#
# Default: finish-flow is MANDATORY for L and H only, OPTIONAL for Fix and S.
# Enabling enforce_fix / enforce_s adds bureaucracy to lightweight flows —
# only do this if your project has specifically suffered from skipped Fix/S
# closing steps.
