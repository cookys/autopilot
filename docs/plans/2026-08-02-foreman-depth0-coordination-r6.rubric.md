# Foreman-depth-0 coordination R6 rubric

## R1 Typed condition is evidence-bound

The implementation distinguishes `working`, `waiting`, `blocked`, `dead`, and `unknown` from durable
signals. Quietness, polling absence, or unreadable evidence cannot manufacture `dead`.

## R2 Stage ownership is lease-safe

Only the exact live generation/nonce holder owns the stage. Inquiry does not seize authority, and a
second controller cannot mutate, kill, or replace the live owner.

## R3 Intervention ordering is enforced

The executable path is inquiry, bounded wait, exact-identity/liveness re-observation, bounded
SIGTERM/grace/SIGKILL for a verified alive-but-nonresponsive holder, reconciliation, generation
advance, then one same-lineage replacement. Identity mismatch/unreadability fails closed; D-state or
unkillable resources are quarantined.

## R4 Reconciliation prevents duplicate work and effects

Committed Git truth is adopted, unresolved side effects block replacement, and late stale-generation
results cannot overwrite canonical state, merge twice, or replay an effect.

## R5 Rollback and scope stay bounded

Feature-off preserves the report-only watcher/advisory channel. No scheduler, new Mission authority,
width fan-out, quota-reset scheduler, or malicious-worker isolation is introduced.

## R6 Verification and review are independent

Focused concurrency/recovery negative controls, the complete suite, deterministic sync gates, and one
whole-diff independent panel pass with no unresolved Critical or Major finding.

## R7 Execution, compatibility, and rollback are bounded

The source plan, dependency, exact acceptance argv, resource reservation, and four-attempt gate budget
match the Mission graph. Repairs reuse the same node/lineage; feature-off is the executable rollback,
and no new runtime dependency or open design question remains.
