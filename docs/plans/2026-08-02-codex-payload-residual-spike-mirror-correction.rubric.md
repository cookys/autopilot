# Acceptance rubric — Codex payload residual spike mirror correction

These items supplement, not replace, original R1–R6.

## R7 Pre-correction boundary is honest

The project record states that the original graph omitted one deterministic Codex reference mirror,
the bundled sync gate exposed it before the mirror was written or candidate committed, and the old
ledger stage was terminally superseded rather than rewritten as passing.

## R8 Mirror closure is exact

The canonical sync generator changes only the newly authorized Codex package reference. Canonical
and mirror bytes are equal, and both `scripts/sync-codex-plugin-skills.sh --check` and
`scripts/sync-all.sh --check` pass.

## R9 Original residual-spike contract remains frozen

Original R1–R6, all three probe observations, the conjunctive GO/NO-GO decision, zero-residue proof,
no-migration boundary, and exactly-one first-pass verifier remain unchanged. The correction adds no
claim or production behavior.

## R10 Successor lifecycle closes

The candidate diff from the successor bootstrap contains exactly seven authorized output paths. All
verification commands pass, one independent first-pass review occurs after the complete bundle,
depth-0 authoritative QC has no unresolved Critical/Major, and local integration/cleanup complete
without push, release, PR, publication, or migration.
