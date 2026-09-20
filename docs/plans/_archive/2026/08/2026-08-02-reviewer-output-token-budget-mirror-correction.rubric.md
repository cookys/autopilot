# Acceptance rubric — reviewer output-token budget mirror correction

These items supplement, not replace, original R1–R8.

## R9 Pre-correction boundary is honest

The project record states that the first graph omitted two generated mirrors, the sync check found
the omission before either mirror was written, the interrupted full suite has no verdict, and the
old stage was terminally superseded rather than rewritten as successful.

## R10 Mirror closure is exact

The canonical sync script generates only the two newly authorized Codex package paths. Each mirror
is byte-equal to its canonical source, and `scripts/sync-codex-plugin-skills.sh --check` passes.

## R11 Original contract remains frozen

Original R1–R8, the supported/unsupported runner matrix, range, omission compatibility, truncation
polarity, no-push boundary, and exactly-one first-pass verifier remain unchanged. The correction
does not add product semantics.

## R12 Successor lifecycle closes

The final diff contains exactly ten authorized output paths, all original verification commands
pass from the successor state, one independent first-pass review occurs after the complete bundle,
depth-0 final QC finds no unresolved Critical/Major, and local merge/cleanup complete without push.
