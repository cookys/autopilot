# Backlog Convergence Rubric

## R1 Inventory and bounded admission

The 65 real backlog entries are mapped exactly once; only the three executable tracks are admitted
to this Mission, while Track 4, Track 5, and the trigger bank remain out of scope.

## R2 Legacy Mission authority is reconciled without replay

The two canonical ready B/C terminal roots are validated against their journals and accepted Git
history, then receive an explicit authority-preserving disposition. No Work Order, receipt, or
ready state is synthesized, backdated, relabelled, or silently discarded.

## R3 Mission admission is deterministic

The production routing admission accepts the new bounded Mission graph and fails closed for a
missing, foreign, mismatched, or replayed controller Work Order. The old B/C evidence remains
unchanged and cannot authorize the new graph.

## R4 Dispatch/session tests are authority-isolated

Non-Mission dispatch/session fixtures use an isolated Git common dir and authority store; Mission
fixtures seed the exact state they assert. The six affected test surfaces no longer inherit this
checkout's production registry.

## R5 E1 provenance backstop is mechanical

The merge gate rejects an unmanifested product commit or unauthorized depth-0 edit and accepts a
dispatch-manifest-bound commit. It derives provenance from artifacts, not commit prose.

## R6 Codex lifecycle evidence is current

A fresh Codex 0.146 probe records the actual `spawn_agent` schema, model/effort identity, and
lifecycle/teardown boundary; stale 0.144 claims are removed from canonical and Codex-facing docs.

## R7 Portability probes are rerunnable and fail closed

The committed Codex slash-entry probe and the preflight meta-smoke prove their planted failures,
remain rerunnable, and do not silently pass when the required tool surface is unsupported.

## R8 agy isolation and alias resolution are real

The agy reviewer and verification-author probes prove the observed filesystem/process boundary
before wiring, unsupported sandbox behavior blocks, and `gemini-flash` resolves to a current
canonical slug before roster dispatch.

## R9 Identity containment covers the non-strict author path

The explicit non-strict author path resolves the repository root and runs the identity snapshot /
restore rail without exposing identity values in public output.

## R10 Owner Kernel P4 qualification is authority-bound

A host-injected exact-role qualification provider covers implementer, verification-author, and QC
reviewer-role receipts. Transport probes, stale scorecards, and disk telemetry alone cannot promote
a role, and ICC consumes the receipt before effectful spend.

## R11 Deferred tracks stay deferred

No implementation diff changes the reviewer-budget contract, `--max-tokens` runner semantics,
Fable methodology, Tree-engine status, t14 experiments, or any trigger-bank item. These remain
explicitly gated in the plan/backlog.

## R12 Combined final evidence is complete

The single Mission candidate has one immutable-base diff, one final whole-diff review, focused
regression evidence for each track, no unresolved Critical/Major finding, no unauthorized output
path, and a fresh terminal `can_close=true` receipt.
