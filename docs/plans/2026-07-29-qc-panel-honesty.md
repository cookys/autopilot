# QC Panel Honesty

## Deliverable contract

Enforce the configured `min_panel_size` at the authoritative QC acceptance/finalization seam.
Transport or parser loss may produce an explicit non-accepting degradation result, but never a
successful terminal receipt below the sealed minimum.

Acceptance:

- a three-seat roster with a minimum of three and one valid response cannot finalize accepted;
- the failure reports configured minimum, valid final count, and a stable reason;
- a complete three-seat panel succeeds;
- an explicitly configured one-seat minimum preserves the supported single-seat path;
- transport failure, parser failure, and genuine reviewer no-finding stay distinguishable.

Out of scope: reviewer qualification, fallback selection, parser redesign, version bump, release,
and unrelated backlog entries.
