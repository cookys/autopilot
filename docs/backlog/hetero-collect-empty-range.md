# hetero-review-loop collect accepts an empty review range

BL-0269. File: scripts/hetero-review-loop.js (collect).

collect resolves base and head, builds the diff and records its sha and byte count, but never checks that the range has any commit or any changed file, so a zero-byte diff is reviewed and recorded like a normal one.

Suggested fix: fail closed in collect when the range has zero commits or zero changed files (and, in the caller, require a clean work tree); add a negative control with an empty range that must be refused.

Trigger: next change to the collect subcommand of the review loop driver

Source: landdocs 2026-10-21 empty-range finding
